import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {createNotionEditorialConnector,notionEditorialBody} from '../notion-editorial-connector.mjs';

const source='12345678-1234-1234-1234-123456789abc',pageId='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const script=()=>({hook:'A useful hook',cta:'Save this',path:{title:'Explain',outline:'Start with a practical example'},text:'A concrete explanation that is long enough to be a complete script. Follow the example with the practical steps and a closing reminder.',improvisationTopics:['Example'],thumbnailDirection:'Simple headline'});
const seed=()=>({schemaVersion:1,topics:[{id:'topic',workspaceId:'workspace',title:'My project',summary:'Why it helps',sources:[]}],contents:[{id:'content',workspaceId:'workspace',topicId:'topic',title:'My project',format:'short-video',platforms:['Instagram','LinkedIn'],status:'script-review',scriptOptionsArtifactId:'options'}],runs:[],artifacts:[{id:'options',type:'script-options',contentId:'content',version:1}],approvals:[]});
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5))}throw new Error('Timed out waiting for a local job');}
function fixture(connector){
  const path=join(mkdtempSync(join(tmpdir(),'editorial-jobs-')),'editorial.sqlite');
  const bridge=createContentWorkflowBridge({dbPath:path,getConnector:()=>connector});
  const db=new DatabaseSync(path);db.prepare('INSERT INTO editorial_state VALUES (?,?,?,?)').run('owner',1,JSON.stringify(seed()),'today');
  bridge.jobs.configure('owner','workspace',{dataSourceId:source,autoSync:true});
  const approve=(revision=1,overrides={})=>bridge.jobs.approve('owner',{revision,contentId:'content',scriptOptionsArtifactId:'options',script:script(),syncNotion:true,...overrides});
  return {bridge,db,approve,close:async()=>{await bridge.close();db.close()}};
}
test('approval and immutable outbox input commit together and repeated approval never duplicates a job',async()=>{
  let calls=0;
  const f=fixture({upsert:async(payload,context)=>{calls++;context.authorize();return {pageId,url:`https://www.notion.so/${pageId}`,verifiedAt:'today',artifactVersion:payload.artifact.version}}});
  try{
    const receipt=f.approve();assert.equal(receipt.state.approvals[0].action,'notion-upsert');
    await until(()=>f.bridge.jobs.list('owner')[0].status==='succeeded');
    const again=f.approve(receipt.revision);assert.equal(again.state.artifacts.filter(item=>item.type==='script').length,1);
    assert.equal(f.bridge.jobs.list('owner').length,1);assert.equal(calls,1);
    assert.equal(f.bridge.jobs.list('owner')[0].result.pageId,pageId);
  }finally{await f.close()}
});
test('approving only a script does not authorize an external write; malformed or stale requests change nothing',async()=>{
  let calls=0;const f=fixture({upsert:async()=>{calls++}});
  try{
    assert.throws(()=>f.approve(1,{script:{...script(),text:'too short'}}),/Complete/);
    assert.throws(()=>f.approve(0),/changed/);
    assert.equal(f.db.prepare('SELECT revision FROM editorial_state').get().revision,1);
    f.approve(1,{syncNotion:false});assert.equal(f.bridge.jobs.list('owner').length,0);assert.equal(calls,0);
  }finally{await f.close()}
});
test('UUID spelling and object key order cannot duplicate an authorized version',async()=>{
  let calls=0;const f=fixture({upsert:async(payload)=>{calls++;return {pageId,url:`https://www.notion.so/${pageId}`,verifiedAt:'today',artifactVersion:payload.artifact.version}}});
  try{
    const receipt=f.approve();await until(()=>f.bridge.jobs.list('owner')[0].status==='succeeded');
    f.bridge.jobs.configure('owner','workspace',{dataSourceId:source.replaceAll('-','').toUpperCase(),autoSync:true});
    const reordered=Object.fromEntries(Object.entries(script()).reverse());
    const again=f.approve(receipt.revision,{script:reordered});
    assert.equal(again.state.artifacts.filter(item=>item.type==='script').length,1);assert.equal(f.bridge.jobs.list('owner').length,1);assert.equal(calls,1);
  }finally{await f.close()}
});
test('changed approved versions cannot pass the write gateway even during a running job',async()=>{
  let release,writes=0;
  const f=fixture({upsert:async(_payload,context)=>{await new Promise(resolve=>{release=resolve});context.authorize();writes++}});
  try{
    f.approve();await until(()=>release);
    const row=f.db.prepare('SELECT state_json FROM editorial_state').get(),state=JSON.parse(row.state_json);state.contents[0].approvedScriptArtifactId='another-version';
    f.db.prepare('UPDATE editorial_state SET state_json=?').run(JSON.stringify(state));release();
    await until(()=>f.bridge.jobs.list('owner')[0].status==='failed');assert.equal(writes,0);
  }finally{await f.close()}
});
test('a persisted create checkpoint survives a process restart and resumes verification',async()=>{
  const f=fixture({upsert:async(_payload,context)=>{context.saveCheckpoint({phase:'created',pageId});throw new Error('Network interrupted')}});
  f.approve();await until(()=>f.bridge.jobs.list('owner')[0].status==='failed');await f.bridge.close();
  f.db.prepare("UPDATE editorial_jobs SET status='running'").run();let checkpoint;
  const reopened=createContentWorkflowBridge({dbPath:f.db.location?.()??f.db.prepare('PRAGMA database_list').get().file,getConnector:()=>({upsert:async(_payload,context)=>{checkpoint=context.checkpoint;return {pageId,url:`https://www.notion.so/${pageId}`,verifiedAt:'today',artifactVersion:1}}})});
  reopened.jobs.kick();await until(()=>reopened.jobs.list('owner')[0].status==='succeeded');assert.equal(checkpoint.pageId,pageId);await reopened.close();f.db.close();
});

function fakeNotion({loseCreate=false,indexed=true}={}){
  let body='',creates=0,updates=0,createdProperties;
  const schema={'Post Title':{type:'title'},Status:{type:'status',groups:{to_do:[{name:'Idea'}],in_progress:[{name:'Gravando'}]}},Channel:{type:'multi_select',options:[{name:'Instagram'},{name:'LinkedIn'}]}};
  const wrap=value=>({content:[{type:'text',text:JSON.stringify(value)}]});
  const mcp={thread:async()=> 'isolated-thread',call:async({tool,arguments:args})=>{
    if(tool==='notion-fetch'){
      if(args.id.startsWith('notion://'))return wrap({text:'Official Markdown syntax'});
      if(args.id.startsWith('collection://'))return wrap({text:`<data-source-state>${JSON.stringify({schema})}</data-source-state>`});
      return wrap({url:`https://www.notion.so/${pageId}`,text:`<data-source url="collection://${source}">${body}</data-source>`});
    }
    if(tool==='notion-search')return wrap({results:body&&indexed?[{id:pageId}]:[]});
    if(tool==='notion-create-pages'){creates++;assert.equal(args.parent.data_source_id,source);createdProperties=args.pages[0].properties;body=args.pages[0].content;if(loseCreate)throw new Error('Response lost after write');return wrap({pages:[{id:pageId,url:`https://www.notion.so/${pageId}`}]})}
    if(tool==='notion-update-page'){updates++;assert.deepEqual(args.position,{type:'end'});body+='\n'+args.content;return wrap({success:true})}
    throw new Error('Unexpected tool');
  }};
  return {mcp,creates:()=>creates,updates:()=>updates,properties:()=>createdProperties,setIndexed:value=>{indexed=value},append:value=>{body+='\n'+value},replace:(from,to)=>{body=body.replace(from,to)},body:()=>body};
}
const payload=()=>({content:seed().contents[0],topic:seed().topics[0],artifact:{id:'approved-1',version:1,data:script()},dataSourceId:source});
test('an authorized Idea-mode payload creates the real Notion card as Idea without fabricating a publish date',async()=>{
 const fake=fakeNotion(),connector=createNotionEditorialConnector(()=>fake.mcp),input={...payload(),notionStatus:'Idea'},context={checkpoint:{},authorize:()=>{},saveCheckpoint:()=>{}};
 await connector.upsert(input,context);assert.equal(fake.properties().Status,'Idea');assert.equal(fake.properties()['Publish Date'],undefined);assert.equal(fake.creates(),1);
});
test('Notion connector verifies actual card contents, appends later versions and preserves manual notes',async()=>{
  const fake=fakeNotion(),connector=createNotionEditorialConnector(()=>fake.mcp),input=payload();let checkpoint={};
  const context={checkpoint,authorize:()=>{},saveCheckpoint:value=>{checkpoint=value}};
  const result=await connector.upsert(input,context);assert.equal(fake.creates(),1);assert.equal(result.artifactVersion,1);
  fake.append('My manual notes');const next={...input,artifact:{...input.artifact,id:'approved-2',version:2}};
  await connector.upsert(next,{...context,checkpoint:{},previous:result});
  assert.equal(fake.creates(),1);assert.equal(fake.updates(),1);assert.match(fake.body(),/My manual notes/);assert.match(fake.body(),/approved-2/);
});
test('a lost create response is reconciled by identity without issuing another create',async()=>{
  const fake=fakeNotion({loseCreate:true,indexed:false}),connector=createNotionEditorialConnector(()=>fake.mcp);let checkpoint={};
  const context=()=>({checkpoint,authorize:()=>{},saveCheckpoint:value=>{checkpoint=value}});
  await assert.rejects(connector.upsert(payload(),context()),/Response lost/);
  await assert.rejects(connector.upsert(payload(),context()),/uncertain result/);assert.equal(fake.creates(),1);
  fake.setIndexed(true);await connector.upsert(payload(),context());assert.equal(fake.creates(),1);
});
test('version markers alone cannot certify a manually changed approved script',async()=>{
  const fake=fakeNotion(),connector=createNotionEditorialConnector(()=>fake.mcp),input=payload();
  const result=await connector.upsert(input,{checkpoint:{},authorize:()=>{},saveCheckpoint:()=>{}});
  fake.replace(input.artifact.data.text,'Changed manually; approved content is missing');
  await assert.rejects(connector.upsert(input,{checkpoint:{},previous:result,authorize:()=>{},saveCheckpoint:()=>{}}),/approved text could not be verified/);
  assert.equal(fake.creates(),1);assert.equal(fake.updates(),0);
});
test('unapproved payload never reaches a Notion write and generated body contains the recording checklist',async()=>{
  const fake=fakeNotion(),connector=createNotionEditorialConnector(()=>fake.mcp);
  await assert.rejects(connector.upsert(payload(),{checkpoint:{},authorize:()=>{throw new Error('No authorization')},saveCheckpoint:()=>{}}),/No authorization/);
  assert.equal(fake.creates(),0);assert.match(notionEditorialBody(payload()),/Editor de Vídeo/);
});
