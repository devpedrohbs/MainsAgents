import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {decodeChatDelivery} from '../chat-delivery-protocol.mjs';

const options={hooks:['One','Two','Three'],ctas:['Save','Share'],paths:[{title:'Explain',outline:'Explain this with a practical example'},{title:'Story',outline:'Tell the story of building this project'}],improvisationTopics:['Example','Demo'],thumbnailDirection:'Show the project',draftScript:'This is a complete script about a personal project. Show the practical problem, explain the solution and demonstrate a useful example before ending with a reminder.'};
const proposal={title:'A new personal project',category:'Tech',summary:'A practical project helps people solve a daily problem.',whyItMatters:'It illustrates an accessible use of automation.',angles:['A demo','A tutorial'],sources:[{title:'Project',url:'https://example.com'}],factualQuestions:['Which version?']};
const seed=()=>({schemaVersion:1,topics:[{...proposal,id:'topic',workspaceId:'workspace',status:'approved',contentId:'content'}],contents:[{id:'content',workspaceId:'workspace',topicId:'topic',title:proposal.title,status:'script-review',format:'short-video',platforms:['LinkedIn'],scriptOptionsArtifactId:'old-options'}],artifacts:[{id:'old-options',topicId:'topic',workspaceId:'workspace',contentId:'content',type:'script-options',version:1,data:options}],runs:[],approvals:[]});
function fixture(content=JSON.stringify(options)) {
  const path=join(mkdtempSync(join(tmpdir(),'chat-deliveries-')),'workspace.sqlite');
  let active='owner';
  const session={id:'session',agentId:'agent',title:'Personal project',messages:[{id:'message',type:'message',role:'agent',content,deliveryState:'completed'}]};
  const settings={dbPath:path,getSessions:profile=>profile==='owner'?[session]:[],getAgents:()=>[{id:'agent',workspaceId:'workspace'}],getCurrentProfile:()=>active};
  let bridge=createContentWorkflowBridge(settings);
  const db=new DatabaseSync(path);db.prepare('INSERT INTO editorial_state VALUES (?,?,?,?)').run('owner',1,JSON.stringify(seed()),'now');
  return {db,session,get bridge(){return bridge},capture:(overrides={})=>bridge.deliveries.capture('owner',{revision:db.prepare('SELECT revision FROM editorial_state WHERE profile_id=?').get('owner').revision,sessionId:'session',messageId:'message',expectedContent:session.messages[0].content,contentId:'content',...overrides}),profile:next=>{active=next},state:()=>JSON.parse(db.prepare('SELECT state_json FROM editorial_state WHERE profile_id=?').get('owner').state_json),reopen:async()=>{await bridge.close();bridge=createContentWorkflowBridge(settings)},close:async()=>{await bridge.close();db.close()}};
}
test('plain text and incomplete research are not silently converted to an approvable delivery',()=>{
  assert.equal(decodeChatDelivery('I approve this script'),null);
  assert.equal(decodeChatDelivery(JSON.stringify({...options,hooks:['Only one']})),null);
  assert.equal(decodeChatDelivery(JSON.stringify({topics:[{...proposal,sources:[{title:'Bad',url:'javascript:alert(1)'}]}]})),null);
  assert.equal(decodeChatDelivery('```json\n'+JSON.stringify(options)+'\n```').kind,'script-options');
});
test('saving one completed response records provenance, creates a version and survives restart without duplication',async()=>{
  const f=fixture();try {
    const receipt=f.capture();assert.equal(receipt.state.contents[0].status,'script-review');
    const artifact=receipt.state.artifacts[0];assert.equal(artifact.version,2);assert.equal(artifact.source.agentId,'agent');assert.match(artifact.source.messageHash,/^[a-f0-9]{64}$/);
    await f.reopen();const repeated=f.capture();assert.equal(repeated.revision,receipt.revision);assert.equal(repeated.state.artifacts.length,2);assert.equal(repeated.state.artifacts[0].id,artifact.id);
  } finally{await f.close()}
});
test('stale text, partial responses, user messages, wrong profile and foreign workspace cannot import',async()=>{
  const f=fixture();try {
    const original=f.state();assert.throws(()=>f.capture({expectedContent:'tampered'}),/completed/);
    f.session.messages[0].deliveryState='streaming';assert.throws(()=>f.capture(),/completed/);
    f.session.messages[0].deliveryState='interrupted';assert.throws(()=>f.capture(),/completed/);
    f.session.messages[0].deliveryState='completed';f.session.messages[0].role='user';assert.throws(()=>f.capture(),/completed/);
    f.session.messages[0].role='agent';f.profile('other');assert.throws(()=>f.capture(),/profile changed/);f.profile('owner');
    assert.throws(()=>f.capture({contentId:'foreign'}),/approved topic/);
    assert.deepEqual(f.state(),original);
  }finally{await f.close()}
});
test('research import creates reviewable topics with real sources, never an implicit approval',async()=>{
  const f=fixture(JSON.stringify({topics:[proposal,{...proposal,title:'Another idea'}]}));try {
    const receipt=f.capture();assert.equal(receipt.state.topics.length,3);
    assert.equal(receipt.state.topics.filter(item=>item.status==='review').length,2);assert.equal(receipt.state.approvals.length,0);
    assert.equal(receipt.state.artifacts[0].source.sessionId,'session');assert.deepEqual(receipt.state.topics[0].sources,proposal.sources);
    assert.equal(f.capture().state.topics.length,3);
  }finally{await f.close()}
});
test('chat approval uses the same outbox as Studio and requires exactly the reviewed version and destination',async()=>{
  const f=fixture();try {
    const receipt=f.capture(),artifact=receipt.state.artifacts[0];
    const script={hook:options.hooks[0],cta:options.ctas[0],path:options.paths[0],text:options.draftScript,improvisationTopics:options.improvisationTopics,thumbnailDirection:options.thumbnailDirection};
    const source='12345678-1234-1234-1234-123456789abc';
    f.bridge.jobs.configure('owner','workspace',{dataSourceId:source,autoSync:true});
    const input={revision:receipt.revision,contentId:'content',scriptOptionsArtifactId:artifact.id,script,expectedArtifact:artifact,expectedDestination:source,syncNotion:true};
    assert.throws(()=>f.bridge.jobs.approve('owner',{...input,expectedArtifact:{...artifact,version:1}}),/version changed/);
    assert.throws(()=>f.bridge.jobs.approve('owner',{...input,expectedArtifact:{...artifact,data:{...options,draftScript:'changed'}}}),/version changed/);
    assert.throws(()=>f.bridge.jobs.approve('owner',{...input,expectedDestination:'different'}),/destination changed/);
    assert.equal(f.bridge.jobs.list('owner').length,0);
    const approved=f.bridge.jobs.approve('owner',input);assert.equal(approved.state.approvals[0].action,'notion-upsert');assert.equal(approved.state.artifacts[0].source.messageId,'message');
    f.bridge.jobs.approve('owner',{...input,revision:approved.revision});assert.equal(f.bridge.jobs.list('owner').length,1);
  }finally{await f.close()}
});
test('new chat options revoke the old current approval without erasing approval history',async()=>{
  const f=fixture();try{
    const state=f.state();state.contents[0].approvedScriptArtifactId='approved';state.contents[0].status='script-approved';state.approvals=[{id:'old-decision',artifactId:'approved',decision:'approved'}];
    f.db.prepare('UPDATE editorial_state SET state_json=?').run(JSON.stringify(state));
    const result=f.capture();assert.equal(result.state.contents[0].approvedScriptArtifactId,undefined);assert.equal(result.state.contents[0].status,'script-review');assert.deepEqual(result.state.approvals,state.approvals);
    assert.throws(()=>f.bridge.jobs.approve('owner',{revision:result.revision,contentId:'content',scriptOptionsArtifactId:'old-options',script:{hook:'One',cta:'Save',path:options.paths[0],text:options.draftScript,improvisationTopics:[],thumbnailDirection:''}}),/options changed/);
  }finally{await f.close()}
});

test('revision and rejection preserve previous versions, revoke current Notion permission and refuse stale reviews',async()=>{
  const f=fixture();try{
    let receipt=f.capture(),artifact=receipt.state.artifacts[0];
    const script={hook:options.hooks[0],cta:options.ctas[0],path:options.paths[0],text:options.draftScript,improvisationTopics:[],thumbnailDirection:''};
    receipt=f.bridge.jobs.approve('owner',{revision:receipt.revision,contentId:'content',scriptOptionsArtifactId:artifact.id,script});
    const input={revision:receipt.revision,artifactId:artifact.id,expectedArtifact:artifact,decision:'revision-requested',notes:'Shorten the introduction'};
    assert.throws(()=>f.bridge.deliveries.review('owner',{...input,expectedArtifact:{...artifact,data:{...artifact.data,draftScript:'changed'}}}),/version changed/);
    assert.throws(()=>f.bridge.deliveries.review('owner',{...input,notes:''}),/Describe/);
    receipt=f.bridge.deliveries.review('owner',input);assert.equal(receipt.state.contents[0].approvedScriptArtifactId,undefined);assert.equal(receipt.state.artifacts.filter(item=>item.type==='script').length,1);
    assert.equal(receipt.state.approvals[0].notes,'Shorten the introduction');
    const again=f.bridge.deliveries.review('owner',{...input,revision:receipt.revision});assert.equal(again.revision,receipt.revision);
    await f.reopen();receipt=f.bridge.deliveries.review('owner',{...input,revision:receipt.revision,decision:'rejected'});assert.equal(receipt.state.contents[0].status,'script-rejected');
    assert.equal(receipt.state.approvals[0].decision,'rejected');
  }finally{await f.close()}
});
