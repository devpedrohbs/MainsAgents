import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {stripDeletedFromRestore,sanitizeLinkedValue} from '../content-deletion.mjs';

const empty=()=>({schemaVersion:1,topics:[],contents:[],runs:[],artifacts:[],approvals:[]});
async function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'mains-topics-')),dbPath=join(root,'state.sqlite');let bridge=createContentWorkflowBridge({dbPath,getCurrentProfile:()=> 'owner',getRuntime:()=>null});const db=new DatabaseSync(dbPath);
 const state={...empty(),topics:[{id:'one',workspaceId:'w',title:'Same title',updatedAt:'today'},{id:'two',workspaceId:'other-workspace',title:'Same title'}],artifacts:[{id:'research-one',topicId:'one'},{id:'research-two',topicId:'two'}],approvals:[{id:'approval-one',topicId:'one'}],runs:[{id:'run-one',topicId:'one',state:'completed'}]};
 db.prepare('INSERT INTO editorial_state VALUES(?,?,?,?)').run('owner',1,JSON.stringify(state),'today');db.prepare('INSERT INTO editorial_state VALUES(?,?,?,?)').run('other',1,JSON.stringify(state),'today');
 db.exec('CREATE TABLE state(profile TEXT,key TEXT,value TEXT,PRIMARY KEY(profile,key))');
 const sessions=[{id:'chat',topicId:'one',messages:[{content:'Keep this chat'}]},{id:'chat-two',topicId:'two'}];
 db.prepare('INSERT INTO state VALUES(?,?,?)').run('owner','sessions',JSON.stringify(sessions));
 db.prepare('INSERT INTO state VALUES(?,?,?)').run('owner','studio-drafts',JSON.stringify({'["topic-review","w","one"]':{text:'remove'},'["topic-review","other-workspace","two"]':{text:'keep'}}));
 const get=()=>JSON.parse(db.prepare('SELECT state_json FROM editorial_state WHERE profile_id=?').get('owner').state_json);
 const revision=()=>db.prepare('SELECT revision FROM editorial_state WHERE profile_id=?').get('owner').revision;
 const call=async(method,path,body)=>{const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);req.method=method;const res={writeHead(status){this.status=status;},end(value){this.body=JSON.parse(value);}};await bridge.handle(req,res,new URL(`http://127.0.0.1/api/content/${path}?profile=owner`));return res;};
 const work=(status)=>db.prepare('INSERT OR REPLACE INTO workflow_work VALUES(?,?,?,?,?,?,?,?,?,?)').run('job','owner','w','one','research',status,'request',JSON.stringify({id:'job',topicId:'one'}),'today','today');
 t.after(async()=>{db.close();await bridge.close();rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 return {db,state,sessions,get,revision,call,work,reopen:async()=>{await bridge.close();bridge=createContentWorkflowBridge({dbPath,getCurrentProfile:()=> 'owner',getRuntime:()=>null});}};
}

test('deleting one topic persists, removes only its research records and fences stale writes and backup restores',async t=>{
 const f=await fixture(t);f.work('succeeded');
 const result=await f.call('POST','topics/delete',{topicId:'one',workspaceId:'w',revision:1});assert.equal(result.status,200);
 assert.deepEqual(result.body.state.topics.map(item=>item.id),['two']);assert.deepEqual(result.body.state.artifacts.map(item=>item.id),['research-two']);assert.deepEqual(result.body.state.approvals,[]);assert.deepEqual(result.body.state.runs,[]);
 assert.equal(f.db.prepare('SELECT count(*) AS n FROM workflow_work').get().n,0);
 assert.deepEqual(JSON.parse(f.db.prepare("SELECT value FROM state WHERE profile='owner' AND key='sessions'").get().value),[{id:'chat',messages:[{content:'Keep this chat'}]},{id:'chat-two',topicId:'two'}]);
 assert.equal(JSON.parse(f.db.prepare("SELECT state_json FROM editorial_state WHERE profile_id='other'").get().state_json).topics.length,2);
 const stale=await f.call('PUT','state',{revision:2,state:f.state});assert.equal(stale.status,200);assert.equal(stale.body.stripped,true);assert.deepEqual(f.get().topics.map(item=>item.id),['two']);
 assert.throws(()=>f.db.prepare("UPDATE editorial_state SET state_json=? WHERE profile_id='owner'").run(JSON.stringify(f.state)),/topic was deleted/);
 const restored=stripDeletedFromRestore(f.db,'owner',{editorial:f.state,values:{sessions:f.sessions},execution:{state:{work:[{data_json:'{"topicId":"one"}'},{data_json:'{"topicId":"two"}'}]}}});
 assert.deepEqual(restored.editorial.topics.map(item=>item.id),['two']);assert.equal(restored.execution.state.work.length,1);assert.equal(restored.values.sessions[0].topicId,undefined);
 await f.reopen();assert.deepEqual(f.get().topics.map(item=>item.id),['two']);
 assert.equal((await f.call('POST','topics/delete',{topicId:'one',workspaceId:'w',revision:f.revision()})).status,200,'retry is idempotent');
 assert.throws(()=>f.work('queued'),/deleted locally/,'a deleted topic cannot restart research');
});

test('topic deletion refuses stale revisions, foreign workspaces, linked content and running research without changing records',async t=>{
 const f=await fixture(t);
 for(const input of [{topicId:'one',workspaceId:'w',revision:0},{topicId:'one',workspaceId:'other-workspace',revision:1}])assert.notEqual((await f.call('POST','topics/delete',input)).status,200);
 const linked={...f.state,contents:[{id:'content',topicId:'one',workspaceId:'w'}]};f.db.prepare("UPDATE editorial_state SET state_json=? WHERE profile_id='owner'").run(JSON.stringify(linked));
 let refused=await f.call('POST','topics/delete',{topicId:'one',workspaceId:'w',revision:1,language:'en-US'});assert.equal(refused.status,409);assert.equal(refused.body.code,'linked-content');assert.match(refused.body.error,/linked content/);
 f.db.prepare("UPDATE editorial_state SET state_json=? WHERE profile_id='owner'").run(JSON.stringify(f.state));f.work('running');
 refused=await f.call('POST','topics/delete',{topicId:'one',workspaceId:'w',revision:1});assert.equal(refused.status,409);assert.equal(refused.body.code,'busy');
 assert.equal(f.db.prepare('SELECT count(*) AS n FROM content_tombstone_ids').get().n,0);assert.equal(f.revision(),1);assert.deepEqual(f.get(),f.state);
});

test('topic sanitization detaches metadata while preserving independent chats and other drafts',()=>{
 const sessions=[{id:'chat',topicId:'gone',messages:['keep']},{id:'other',topicId:'keep'}];
 assert.deepEqual(sanitizeLinkedValue('sessions',sessions,{topics:new Set(['gone'])}),[{id:'chat',messages:['keep']},sessions[1]]);
 const drafts={'["topic-review","w","gone"]':1,'["intake","w"]':2};assert.deepEqual(sanitizeLinkedValue('studio-drafts',drafts,{topics:new Set(['gone'])}),{'["intake","w"]':2});
});
