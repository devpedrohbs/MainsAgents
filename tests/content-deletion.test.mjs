import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,createHash} from 'node:crypto';
import {createDesktopStateStore} from '../desktop-state-store.mjs';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {sanitizeLinkedValue} from '../content-deletion.mjs';
import {publicationPayload} from '../publication-model.mjs';
import {mergeProductionSessions} from '../src/features/production/model.ts';
import {mergeNativeDelegations} from '../src/features/chat/nativeDelegations.ts';

// Real path: ONE SQLite file shared by the desktop state store and the content bridge (as in the installed app).
const at='2026-10-15T10:00:00.000Z',ws='space',owner='owner',other='other';
const agent=(id,name)=>({id,name,role:name,workspaceId:ws,providerId:'codex',tools:['files','subagents'],skills:[],instructions:'',createdAt:at,updatedAt:at});
const agents=[agent('source','Editor de Conteúdo'),agent('editor','Editor de Vídeo'),agent('publisher','Publicador')];
const msg=(id,role='user',content=id)=>({id,type:'message',role,content,createdAt:at});
const chat=(id,agentId,title,contentId,messages=[msg(`${id}-m`)])=>({id,agentId,providerId:'codex',title,...(contentId?{contentId,topicId:`topic-${contentId}`}:{}),messages,createdAt:at,updatedAt:at});
const content=(id,title)=>({id,workspaceId:ws,topicId:`topic-${id}`,title,format:'short-video',platforms:['LinkedIn'],status:'planning',taskId:`task-${id}`,createdAt:at,updatedAt:at});
const run=(id,contentId,stage,roles)=>({id,profileId:owner,workspaceId:ws,contentId,topicId:`topic-${contentId}`,flowId:'flow',name:`Produção ${contentId}`,stage,revision:1,events:[],sourceAgent:agents[0],editorAgent:agents[1],publisherAgent:agents[2],
 sourceSession:{...chat(roles[0],'source','Produção',contentId,[msg(`production:${id}:1`,'agent','Roteiro pronto')])},editorSession:{...chat(roles[1],'editor','Produção · edição',contentId,[msg(`production:${id}:2`,'agent','Edição pronta')])},...(roles[2]?{publisherSession:chat(roles[2],'publisher','Produção · publicação',contentId,[msg(`production:${id}:3`,'agent','Pacote pronto')])}:{}),createdAt:at,updatedAt:at});
const publication=(id,contentId,phase)=>({id,contentId,workspaceId:ws,platform:'LinkedIn',text:'TEXTO PRIVADO DO POST',media:[],timeZone:'America/Sao_Paulo',version:1,status:phase==='confirmed'?'scheduled':'sending',history:[],createdAt:at,updatedAt:at,
 receipt:phase==='confirmed'?{id:'ext-1',checkedAt:at,version:1,provider:'zernio'}:undefined,operation:{id:`op-${id}`,provider:'zernio',phase,mode:'schedule',accountId:'acc',payloadHash:'a'.repeat(64),arguments:{idempotencyKey:`key-${id}`,content:'TEXTO PRIVADO DO POST'},externalId:phase==='confirmed'?'ext-1':undefined,createdAt:at,expiresAt:at}});

async function fixture({extraPublications=[],sessionsExtra=[],stopTimeoutMs=600,plain=false}={}){
 const dir=mkdtempSync(join(tmpdir(),'content-deletion-')),dbPath=join(dir,'workspace-state.sqlite');
 // A raw recording "chosen on disk": it must never be touched.
 const raw=join(dir,'gravacao.mp4');writeFileSync(raw,'RAW-BYTES');
 const store=createDesktopStateStore(dir,'test');
 const sessions=[
  chat('a-source','source','Linkedin','content-a'),chat('a-editor','editor','Linkedin','content-a'),chat('a-pub','publisher','Linkedin · publicação','content-a'),
  chat('a-run-src','source','Produção','content-a',[msg('production:run-a:1','agent','Roteiro pronto')]),chat('a-run-ed','editor','Produção · edição','content-a',[msg('production:run-a:2','agent','Edição pronta')]),
  chat('b-source','source','Linkedin','content-b'),chat('b-editor','editor','Linkedin','content-b'),chat('c-source','source','Linkedin','content-c'),
  chat('general','source','Linkedin'),chat('general-2','editor','Ideias soltas'),...sessionsExtra];
 const values={agents,sessions,'active-sessions':{source:'a-source',editor:'b-editor',publisher:'a-pub'},
  'content-scopes':{schemaVersion:1,selected:{[ws]:'content:content-a'},active:{[JSON.stringify([ws,'source','content:content-a'])]:'a-source',[JSON.stringify([ws,'source','content:content-b'])]:'b-source',[JSON.stringify([ws,'editor','general'])]:'general-2'}},
  'production-flows':{schemaVersion:1,flows:[{id:'flow',workspaceId:ws,name:'Fluxo',contentId:'content-a',nodes:[{id:'n1',kind:'content-agent',agentId:'source',sessionId:'a-run-src'},{id:'n2',kind:'video-agent',agentId:'editor',sessionId:'b-editor'}]}],activeByWorkspace:{[ws]:'flow'}},
  'chat-drafts':{[JSON.stringify(['source','a-source'])]:{text:'rascunho A',skill:null},[JSON.stringify(['source',null,ws,'content:content-a'])]:{text:'novo A',skill:null},[JSON.stringify(['source','b-source'])]:{text:'rascunho B',skill:null}},
  'studio-drafts':{[JSON.stringify(['production-run',ws,'run-a','script'])]:{fields:{notes:'A'},updatedAt:at},[JSON.stringify(['production-run',ws,'run-b','script'])]:{fields:{notes:'B'},updatedAt:at}}};
 store.initialize(owner,values);store.initialize(other,{agents,sessions:[chat('a-source','source','Linkedin','content-a')]});
 let profile=owner;
 const options={dbPath,getCurrentProfile:()=>profile,getAgents:p=>store.read(p,'agents'),getSessions:p=>store.read(p,'sessions'),getFlows:p=>store.read(p,'production-flows'),getRuntime:()=>null,deletionOptions:{stopTimeoutMs,pollMs:20}};
 let bridge=createContentWorkflowBridge(options);
 const db=new DatabaseSync(dbPath);db.exec('PRAGMA busy_timeout=5000');
 const editorial={schemaVersion:1,topics:[{id:'topic-content-a',contentId:'content-a',workspaceId:ws,title:'Linkedin'},{id:'topic-content-b',contentId:'content-b',workspaceId:ws,title:'Linkedin'}],
  contents:[content('content-a','Linkedin'),content('content-b','Linkedin'),content('content-c','Linkedin')],
  artifacts:[{id:'art-a',workspaceId:ws,topicId:'topic-content-a',contentId:'content-a',type:'script',version:1,data:{text:'ROTEIRO A'},createdAt:at},{id:'art-b',workspaceId:ws,topicId:'topic-content-b',contentId:'content-b',type:'script',version:1,data:{text:'ROTEIRO B'},createdAt:at}],
  approvals:[{id:'ap-a',workspaceId:ws,topicId:'topic-content-a',artifactId:'art-a',artifactVersion:1,decision:'approved',notes:'',decidedAt:at},{id:'ap-b',workspaceId:ws,topicId:'topic-content-b',contentId:'content-b',artifactId:'art-b',artifactVersion:1,decision:'approved',notes:'',decidedAt:at}],
  runs:[{id:'wr-a',workspaceId:ws,topicId:'topic-content-a',contentId:'content-a',stage:'script',state:'completed',agentId:'source',providerId:'codex',input:'',outputArtifactIds:[]}],
  assets:[{id:'asset-a',workspaceId:ws,contentId:'content-a',kind:'video',role:'source',status:'available',name:'gravacao.mp4',versions:[{id:'ver-a',path:raw,sha256:'b'.repeat(64)}]},{id:'asset-b',workspaceId:ws,contentId:'content-b',kind:'video',role:'source',status:'available',name:'gravacao.mp4',versions:[{id:'ver-b',path:raw,sha256:'b'.repeat(64)}]}],
  publications:[publication('pub-a','content-a','confirmed'),publication('pub-b','content-b','confirmed'),...extraPublications]};
 if(plain){editorial.assets=[];editorial.publications=[];}
 db.prepare('INSERT INTO editorial_state VALUES(?,?,?,?)').run(owner,1,JSON.stringify(editorial),at);
 db.prepare('INSERT INTO editorial_state VALUES(?,?,?,?)').run(other,1,JSON.stringify({...editorial,contents:[content('content-a','Linkedin')],artifacts:[],approvals:[],runs:[],assets:[],publications:[]}),at);
 const putRun=value=>db.prepare('INSERT INTO production_runs VALUES(?,?,?,?,?,?,?)').run(value.id,value.profileId,value.workspaceId,value.contentId,value.revision,JSON.stringify(value),at);
 putRun(run('run-a','content-a','blocked',['a-run-src','a-run-ed','a-run-pub']));putRun(run('run-b','content-b','complete',['b-source','b-editor']));
 db.prepare('INSERT INTO production_commands VALUES(?,?,?,?)').run(owner,'req-a','sig','run-a');db.prepare('INSERT INTO production_authority VALUES(?,?,?)').run(owner,'run-a','h');
 const srt=(id,contentId,job)=>db.prepare('INSERT INTO content_srt_documents VALUES(?,?,?,?,?)').run(owner,id,contentId,JSON.stringify({id,contentId,workspaceId:ws,title:'Legenda',versions:[],source:{kind:'video'},...(job?{job}:{})}),at);
 srt('srt-a','content-a');srt('srt-b','content-b');srt('srt-c','content-c');
 db.prepare('INSERT INTO agent_delegation_sessions VALUES(?,?,?)').run('a-delegated',owner,JSON.stringify(chat('a-delegated','editor','Especialista','content-a')));
 db.prepare('INSERT INTO agent_delegation_jobs VALUES(?,?,?,?,?)').run('job-a',owner,'key-a','completed',JSON.stringify({id:'job-a',profileId:owner,sourceSessionId:'a-source',targetSessionId:'a-delegated',status:'completed',title:'Corte'}));
 const receipt=(id,data)=>db.prepare('INSERT INTO delivery_receipts VALUES(?,?,?,?,?,?)').run(id,owner,`src-${id}`,'content',JSON.stringify({id,profileId:owner,...data}),at);
 receipt('r-a',{contentId:'content-a',source:{kind:'production-video',id:'run-a'}});receipt('r-b',{contentId:'content-b',source:{kind:'production-video',id:'run-b'}});
 db.prepare('INSERT INTO editorial_transcripts VALUES(?,?,?,?,?,?)').run(owner,'ver-a','b'.repeat(64),'pt','{}',at);db.prepare('INSERT INTO editorial_transcripts VALUES(?,?,?,?,?,?)').run(owner,'ver-b','b'.repeat(64),'pt','{}',at);
 const reopen=async(extra={})=>{await bridge.close();bridge=createContentWorkflowBridge({...options,...extra});return bridge;};
 return {dir,dbPath,raw,store,db,options,get bridge(){return bridge;},reopen,setProfile:p=>{profile=p;},srt,putRun,receipt,editorial:p=>JSON.parse(db.prepare('SELECT state_json FROM editorial_state WHERE profile_id=?').get(p).state_json),
  close:async()=>{await bridge.close();db.close();store.close();}};
}
const dump=(db,sql,...args)=>JSON.stringify(db.prepare(sql).all(...args));
/** Everything that belongs to content B, content C, General chats and profile "other", byte for byte. */
function untouched(f){
 const sessions=f.store.read(owner,'sessions').filter(s=>!['content-a'].includes(s.contentId)&&!['a-run-src','a-run-ed','a-run-pub','a-delegated'].includes(s.id));
 const state=f.editorial(owner);
 return JSON.stringify({sessions,b:state.contents.filter(c=>c.id!=='content-a'),art:state.artifacts.filter(a=>a.contentId!=='content-a'),assets:state.assets.filter(a=>a.contentId!=='content-a'),pubs:state.publications.filter(p=>p.contentId!=='content-a'),topicB:state.topics.find(t=>t.id==='topic-content-b'),
  runs:dump(f.db,"SELECT * FROM production_runs WHERE id!='run-a'"),srt:dump(f.db,"SELECT * FROM content_srt_documents WHERE content_id!='content-a' OR profile_id!=?",owner),receipts:dump(f.db,"SELECT * FROM delivery_receipts WHERE id!='r-a'"),transcripts:dump(f.db,"SELECT * FROM editorial_transcripts WHERE version_id!='ver-a'"),
  other:[f.store.readAll(other),f.editorial(other)],agents:f.store.read(owner,'agents')});
}
const request=()=>randomUUID();
const del=(f,preview,extra={})=>f.bridge.deletion.delete(owner,{contentId:preview.contentId,workspaceId:ws,fingerprint:preview.fingerprint,requestId:request(),...extra});

test('deleting a content removes every linked record by id, keeps B/C/General/other profile byte-identical and never touches files',async()=>{
 const f=await fixture();try{
  const before=untouched(f),rawBefore=statSync(f.raw).mtimeMs,dbBefore=dump(f.db,'SELECT * FROM production_runs');
  const preview=f.bridge.deletion.preview(owner,{contentId:'content-a',workspaceId:ws});
  assert.equal(dump(f.db,'SELECT * FROM production_runs'),dbBefore,'preview never mutates');
  assert.equal(preview.title,'Linkedin');assert.equal(preview.counts.chats,5,'3 chats + 2 production role chats, never the same-titled chats of B/C/General');
  assert.deepEqual(preview.counts.chatsByAgent,{source:2,editor:3,publisher:2},'all roles, including the publisher projection that only lives in the run');assert.equal(preview.counts.productions,1);assert.equal(preview.counts.srtDocuments,1);assert.equal(preview.counts.deliveryFactsKept,1);assert.deepEqual(preview.busy,[]);assert.deepEqual(preview.blockers,[]);
  const result=await del(f,preview);assert.equal(result.deleted,true);
  const sessions=f.store.read(owner,'sessions');
  assert.deepEqual(sessions.map(s=>s.id).sort(),['b-editor','b-source','c-source','general','general-2']);
  assert.deepEqual(f.store.read(owner,'active-sessions'),{editor:'b-editor'});
  const scopes=f.store.read(owner,'content-scopes');assert.equal(scopes.selected[ws],'general');assert.deepEqual(Object.values(scopes.active).sort(),['b-source','general-2']);
  const flow=f.store.read(owner,'production-flows').flows[0];assert.equal(flow.contentId,undefined);assert.deepEqual(flow.nodes.map(n=>n.sessionId),[undefined,'b-editor']);
  assert.deepEqual(Object.values(f.store.read(owner,'chat-drafts')).map(d=>d.text),['rascunho B']);assert.deepEqual(Object.keys(f.store.read(owner,'studio-drafts')),[JSON.stringify(['production-run',ws,'run-b','script'])]);
  const state=f.editorial(owner);assert.equal(state.contents.some(c=>c.id==='content-a'),false);assert.equal(state.artifacts.some(a=>a.contentId==='content-a'),false);assert.equal(state.approvals.some(a=>a.artifactId==='art-a'),false);assert.equal(state.runs.length,0);assert.equal(state.assets.some(a=>a.contentId==='content-a'),false);assert.equal(state.topics.find(t=>t.id==='topic-content-a').contentId,undefined,'the idea/topic stays, only its pointer goes');
  for(const [table,where] of [['production_runs',"id='run-a'"],['production_commands',"run_id='run-a'"],['production_authority',"run_id='run-a'"],['content_srt_documents',"id='srt-a'"],['agent_delegation_sessions',"id='a-delegated'"],['agent_delegation_jobs',"id='job-a'"],['delivery_receipts',"id='r-a'"],['editorial_transcripts',"version_id='ver-a'"]])assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${where}`).get().n,0,table);
  // The external schedule keeps only the minimal fact (no post text); nothing was sent to the provider.
  const fact=JSON.parse(f.db.prepare('SELECT data_json FROM deleted_content_delivery_facts').get().data_json);assert.equal(fact.operation.externalId,'ext-1');assert.equal(fact.operation.idempotencyKey,'key-pub-a');assert.doesNotMatch(JSON.stringify(fact),/TEXTO PRIVADO/);
  assert.equal(untouched(f),before,'B, C, General chats, agents and profile "other" are byte-identical');
  assert.equal(readFileSync(f.raw,'utf8'),'RAW-BYTES');assert.equal(statSync(f.raw).mtimeMs,rawBefore,'the raw recording on disk is untouched');
  // Idempotent: the same request replays, a new one sees it as already deleted.
  assert.equal((await f.bridge.deletion.delete(owner,{contentId:'content-a',workspaceId:ws,fingerprint:preview.fingerprint,requestId:result.requestId??request()})).deleted,true);
  assert.equal(f.bridge.deletion.preview(owner,{contentId:'content-a',workspaceId:ws}).alreadyDeleted,true);
 }finally{await f.close();}
});

test('nothing resurrects: production polls, stale renderer writes, late native/coordinator/SRT/receipt writes and a restart',async()=>{
 const f=await fixture();try{
  const staleSessions=f.store.read(owner,'sessions'),staleRuns=f.bridge.production.list(owner),staleEditorial=f.editorial(owner),staleRevision=f.db.prepare('SELECT revision FROM editorial_state WHERE profile_id=?').get(owner).revision;
  const staleShadows={...f.bridge.delegations.snapshot(owner),handoffs:f.bridge.delegations.handoffs(owner)};
  const preview=f.bridge.deletion.preview(owner,{contentId:'content-a',workspaceId:ws});await del(f,preview);
  const gone=id=>!f.store.read(owner,'sessions').some(s=>s.id===id);
  // Several polls of the real coordinator list merged by the renderer model: nothing comes back.
  let sessions=f.store.read(owner,'sessions');
  for(let i=0;i<5;i++){sessions=mergeProductionSessions(sessions,f.bridge.production.list(owner),agents);await new Promise(r=>setTimeout(r,30));}
  assert.equal(sessions.some(s=>s.contentId==='content-a'||['a-run-src','a-run-ed'].includes(s.id)),false);
  // A refresh response that started before the deletion (stale runs) merged into memory and saved: the store drops it.
  const resurrected=mergeNativeDelegations(mergeProductionSessions(f.store.read(owner,'sessions'),staleRuns,agents),staleShadows,agents.map(a=>a.id));
  assert.ok(resurrected.some(s=>s.id==='a-run-src'),'the stale response alone would recreate the chats');
  f.store.write(owner,'sessions',resurrected);f.store.write(owner,'sessions',staleSessions);
  for(const id of ['a-source','a-editor','a-run-src','a-run-ed','a-run-pub','a-delegated'])assert.ok(gone(id),id);
  f.store.write(owner,'active-sessions',{source:'a-source',editor:'b-editor'});assert.deepEqual(f.store.read(owner,'active-sessions'),{editor:'b-editor'});
  // Late coordinator write of the old run object, raw inserts of new work and a late native shadow are refused.
  assert.throws(()=>f.db.prepare('INSERT INTO production_runs VALUES(?,?,?,?,?,?,?)').run('run-a',owner,ws,'content-a',2,'{}',at),/deleted locally/);
  assert.throws(()=>f.db.prepare('INSERT INTO production_runs VALUES(?,?,?,?,?,?,?)').run('run-new',owner,ws,'content-a',1,'{}',at),/deleted locally/);
  assert.throws(()=>f.srt('srt-late','content-a'),/deleted locally/);
  assert.throws(()=>f.receipt('r-late',{contentId:'content-a',source:{kind:'production-video',id:'run-a'}}),/deleted locally/);
  assert.throws(()=>f.db.prepare('INSERT INTO agent_delegation_sessions VALUES(?,?,?)').run('a-delegated',owner,'{}'),/deleted locally/);
  assert.throws(()=>f.db.prepare('INSERT INTO agent_delegation_jobs VALUES(?,?,?,?,?)').run('job-late',owner,'k-late','queued',JSON.stringify({sourceSessionId:'a-source',targetSessionId:'x'})),/deleted locally/);
  assert.throws(()=>f.db.prepare('UPDATE editorial_state SET state_json=? WHERE profile_id=?').run(JSON.stringify(staleEditorial),owner),/deleted locally/,'any server writer holding the old state is refused');
  // Other content keeps working normally.
  f.srt('srt-b2','content-b');f.receipt('r-b2',{contentId:'content-b',source:{kind:'production-video',id:'run-b'}});
  // Restart services and reopen the store: still gone, fence durable.
  await f.reopen();f.store.close();const store=createDesktopStateStore(f.dir,'test-2');
  assert.equal(store.read(owner,'sessions').some(s=>s.contentId==='content-a'),false);
  store.write(owner,'sessions',staleSessions);assert.equal(store.read(owner,'sessions').some(s=>s.id==='a-source'),false,'still sanitized after restart');
  assert.equal(f.bridge.production.list(owner).some(r=>r.contentId==='content-a'),false);
  assert.equal(f.bridge.delegations.snapshot(owner).sessions.some(s=>s.id==='a-delegated'),false);
  f.store.close=()=>store.close();
 }finally{await f.close();}
});

test('a stale editorial PUT from another window is refused or stripped, never recreating the content',async()=>{
 const f=await fixture({plain:true});try{
  const staleEditorial=f.editorial(owner),staleRevision=f.db.prepare('SELECT revision FROM editorial_state WHERE profile_id=?').get(owner).revision;
  await del(f,f.bridge.deletion.preview(owner,{contentId:'content-a',workspaceId:ws}));
  // Stale window PUT (old revision) of the editorial state: 409, and a merged retry is stripped and flagged.
  const http=async body=>{let status,payload;await f.bridge.handle({method:'PUT',url:'/api/content/state',[Symbol.asyncIterator]:async function*(){yield Buffer.from(JSON.stringify(body));}},{writeHead:s=>{status=s;},end:t=>{payload=JSON.parse(t);}},new URL(`http://x/api/content/state?profile=${owner}`));return {status,payload};};
  assert.equal((await http({revision:staleRevision,state:staleEditorial})).status,409);
  const fresh=f.db.prepare('SELECT revision FROM editorial_state WHERE profile_id=?').get(owner).revision;
  const retry=await http({revision:fresh,state:{...staleEditorial,publications:f.editorial(owner).publications}});assert.equal(retry.status,200);assert.equal(retry.payload.stripped,true);
  assert.equal(f.editorial(owner).contents.some(c=>c.id==='content-a'),false);
 }finally{await f.close();}
});

test('stale preview, wrong profile, shared chats and external operations refuse without deleting anything',async()=>{
 const f=await fixture({sessionsExtra:[]});try{
  const preview=f.bridge.deletion.preview(owner,{contentId:'content-a',workspaceId:ws});
  const snapshot=()=>JSON.stringify([f.store.readAll(owner),f.editorial(owner),dump(f.db,'SELECT * FROM production_runs'),dump(f.db,'SELECT * FROM content_srt_documents'),dump(f.db,'SELECT * FROM content_tombstones')]);
  // A chat added to the content after the preview: the confirmed counts are stale.
  f.store.write(owner,'sessions',[...f.store.read(owner,'sessions'),chat('a-new','source','Novo','content-a')]);
  const before=snapshot();
  await assert.rejects(del(f,preview),error=>error.code==='stale');assert.equal(snapshot(),before);
  // Wrong/changed profile and a content of another workspace.
  f.setProfile(other);await assert.rejects(del(f,preview),/perfil ativo mudou/);assert.throws(()=>f.bridge.deletion.preview(owner,{contentId:'content-a',workspaceId:ws}),/perfil ativo mudou/);f.setProfile(owner);
  assert.throws(()=>f.bridge.deletion.preview(owner,{contentId:'content-a',workspaceId:'elsewhere'}),/não existe mais/);
  await assert.rejects(f.bridge.deletion.delete(owner,{contentId:'content-a',workspaceId:ws,fingerprint:'x',requestId:request()}),/inválido/);
  // A production role chat that belongs to ANOTHER content: never deleted, explicit blocker.
  const shared=run('run-a2','content-a','paused',['b-source','a-editor']);f.putRun(shared);
  const blocked=f.bridge.deletion.preview(owner,{contentId:'content-a',workspaceId:ws});assert.match(blocked.blockers[0].message,/pertence a outro conteúdo/);
  await assert.rejects(del(f,blocked),error=>error.code==='blocked');assert.ok(f.store.read(owner,'sessions').some(s=>s.id==='b-source'));
  f.db.prepare("DELETE FROM production_runs WHERE id='run-a2'").run();
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM content_tombstones').get().n,0,'a refused deletion leaves no fence behind');
 }finally{await f.close();}
});

test('an uncertain provider operation blocks; the deletion of a standalone SRT content works and touches nothing else',async()=>{
 const f=await fixture({extraPublications:[publication('pub-a2','content-a','uncertain')]});try{
  const preview=f.bridge.deletion.preview(owner,{contentId:'content-a',workspaceId:ws});
  assert.equal(preview.blockers[0].kind,'external');await assert.rejects(del(f,preview),error=>error.code==='blocked');
  assert.ok(f.editorial(owner).contents.some(c=>c.id==='content-a'));
  const c=f.bridge.deletion.preview(owner,{contentId:'content-c',workspaceId:ws});assert.equal(c.counts.srtDocuments,1);assert.equal(c.counts.productions,0);assert.equal(c.counts.chats,1);
  const before=JSON.stringify([f.store.read(owner,'sessions').filter(s=>s.id!=='c-source'),f.editorial(owner).contents.filter(x=>x.id!=='content-c'),dump(f.db,"SELECT * FROM content_srt_documents WHERE id!='srt-c'"),dump(f.db,'SELECT * FROM production_runs')]);
  await del(f,c);
  assert.equal(JSON.stringify([f.store.read(owner,'sessions'),f.editorial(owner).contents,dump(f.db,'SELECT * FROM content_srt_documents'),dump(f.db,'SELECT * FROM production_runs')]),before);
 }finally{await f.close();}
});

test('local work: busy refuses until the user asks to stop; an unconfirmable stop refuses recoverably; a confirmed stop deletes',async()=>{
 const f=await fixture({stopTimeoutMs:300});try{
  // A running SRT transcription (stoppable through its own cancel) and a video export owned by no executor (cannot be confirmed).
  f.db.prepare("DELETE FROM content_srt_documents WHERE id='srt-a'").run();f.srt('srt-a','content-a',{id:'j1',status:'running',target:{}});
  f.db.prepare('INSERT INTO editorial_media_jobs VALUES(?,?,?,?,?)').run('media-a',owner,'running',JSON.stringify({id:'media-a',contentId:'content-a',status:'running'}),at);
  let preview=f.bridge.deletion.preview(owner,{contentId:'content-a',workspaceId:ws});assert.deepEqual(preview.busy.map(b=>b.kind).sort(),['media','srt']);
  await assert.rejects(del(f,preview),error=>error.code==='busy');
  await assert.rejects(del(f,preview,{rendererBusy:['a-source']}),/ainda está respondendo/);
  await assert.rejects(del(f,preview,{stopLocalWork:true}),error=>error.code==='busy'&&/Nada foi apagado/.test(error.message));
  assert.ok(f.editorial(owner).contents.some(c=>c.id==='content-a'),'kept after the refused stop');
  assert.equal(JSON.parse(f.db.prepare("SELECT data_json FROM content_srt_documents WHERE id='srt-a'").get().data_json).job.status,'canceled','the local stop that could be confirmed was applied');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM content_tombstones').get().n,0);
  // The export finishes (terminal): now the deletion goes through.
  f.db.prepare("UPDATE editorial_media_jobs SET status='canceled' WHERE id='media-a'").run();
  preview=f.bridge.deletion.preview(owner,{contentId:'content-a',workspaceId:ws});assert.deepEqual(preview.busy,[]);
  assert.equal((await del(f,preview)).deleted,true);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM editorial_media_jobs WHERE id='media-a'").get().n,0);
  // While a purge is fencing, new work for that content is refused at once.
 }finally{await f.close();}
});

test('one ordinary chat deletes durably; a production role chat points to deleting the whole content',async()=>{
 const f=await fixture();try{
  const role=f.bridge.deletion.removeSession.bind(null,owner);
  assert.throws(()=>role({sessionId:'a-run-src'}),error=>error.code==='production-role'&&error.contentId==='content-a');
  const result=role({sessionId:'general'});assert.equal(result.deleted,true);
  assert.equal(f.store.read(owner,'sessions').some(s=>s.id==='general'),false);
  f.store.write(owner,'sessions',[...f.store.read(owner,'sessions'),chat('general','source','Linkedin')]);
  assert.equal(f.store.read(owner,'sessions').some(s=>s.id==='general'),false,'a stale copy cannot bring it back');
  assert.throws(()=>f.db.prepare('INSERT INTO agent_delegation_sessions VALUES(?,?,?)').run('general',owner,'{}'),/deleted locally/);
  assert.ok(f.store.read(owner,'sessions').some(s=>s.id==='b-source'));
 }finally{await f.close();}
});

test('sanitizer is pure, id-based and keeps identity when nothing is deleted',()=>{
 const value=[chat('x','a','Linkedin','content-b')];
 assert.equal(sanitizeLinkedValue('sessions',value,{sessions:new Set(['y']),contents:new Set(['content-a'])}),value);
 assert.deepEqual(sanitizeLinkedValue('sessions',value,{contents:new Set(['content-b'])}),[]);
 const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');assert.equal(typeof hash(value),'string');
});

test('a backup made before the deletion restores everything else; the deleted content and its chats stay deleted',async()=>{
 const f=await fixture({plain:true});try{
  const backup=f.store.workspaceSnapshot(owner);
  await del(f,f.bridge.deletion.preview(owner,{contentId:'content-a',workspaceId:ws}));
  for(const mode of ['replace','merge']){
   const current=f.store.workspaceSnapshot(owner);
   const result=f.store.restoreWorkspace(owner,backup.values,backup.editorial.state,{revisions:current.revisions,editorialRevision:current.editorial.revision,executionRevision:current.executionRevision},{state:backup.execution,mode});
   if(mode==='replace')assert.deepEqual(result.omittedDeleted,{contents:1,sessions:5},'the person is told what stayed deleted');
   assert.deepEqual(f.store.read(owner,'sessions').map(s=>s.id).sort(),['b-editor','b-source','c-source','general','general-2']);
   const state=f.editorial(owner);assert.deepEqual(state.contents.map(c=>c.id).sort(),['content-b','content-c']);assert.equal(state.topics.find(t=>t.id==='topic-content-a').contentId,undefined);
   assert.deepEqual(f.db.prepare('SELECT id FROM production_runs WHERE profile_id=?').all(owner).map(r=>r.id),['run-b']);
   assert.equal(f.db.prepare("SELECT COUNT(*) n FROM agent_delegation_sessions WHERE id='a-delegated'").get().n+f.db.prepare("SELECT COUNT(*) n FROM agent_delegation_jobs WHERE id='job-a'").get().n,0);
  }
  assert.equal(f.db.prepare("SELECT status FROM content_tombstones WHERE content_id='content-a'").get().status,'deleted','the tombstone survives the restore');
  assert.throws(()=>f.srt('srt-late','content-a'),/deleted locally/);
 }finally{await f.close();}
});

test('a stale window holding a confirmed delivery of the deleted content is stripped, not refused as a provider edit',async()=>{
 const f=await fixture({plain:true});try{
  // A valid confirmed schedule of content A (receipt + provider operation), as the publishing service records it.
  const plannedAt='2026-10-20T12:00:00.000Z',text='TEXTO PRIVADO DO POST';
  const delivery={id:'pub-a',contentId:'content-a',workspaceId:ws,platform:'LinkedIn',text,media:[],plannedAt,timeZone:'America/Sao_Paulo',version:1,status:'scheduled',createdAt:at,updatedAt:at,
   history:[{version:1,status:'approved',notes:'',at,payloadHash:'a'.repeat(64),payload:publicationPayload({platform:'LinkedIn',text,media:[],plannedAt,timeZone:'America/Sao_Paulo'})}],receipt:{id:'ext-1',checkedAt:at,version:1},
   operation:{id:'op-a',provider:'zernio',platform:'linkedin',timeZone:'America/Sao_Paulo',phase:'confirmed',mode:'schedule',accountId:'acc',payloadHash:'a'.repeat(64),arguments:{content:text,platforms:['acc'],scheduledTime:plannedAt,idempotencyKey:'key-a'},externalId:'ext-1',createdAt:at,expiresAt:at}};
  f.db.prepare('UPDATE editorial_state SET state_json=? WHERE profile_id=?').run(JSON.stringify({...f.editorial(owner),publications:[delivery]}),owner);
  const staleEditorial=f.editorial(owner);
  await del(f,f.bridge.deletion.preview(owner,{contentId:'content-a',workspaceId:ws}));
  const fresh=f.db.prepare('SELECT revision FROM editorial_state WHERE profile_id=?').get(owner).revision;
  let status,payload;await f.bridge.handle({method:'PUT',url:'/api/content/state',[Symbol.asyncIterator]:async function*(){yield Buffer.from(JSON.stringify({revision:fresh,state:staleEditorial}));}},{writeHead:s=>{status=s;},end:t=>{payload=JSON.parse(t);}},new URL(`http://x/api/content/state?profile=${owner}`));
  assert.equal(status,200,payload?.error);assert.equal(payload.stripped,true);
  const state=f.editorial(owner);assert.equal(state.publications.some(p=>p.id==='pub-a'),false);assert.equal(state.topics.find(t=>t.id==='topic-content-a').contentId,undefined,'the stale topic pointer does not come back');
 }finally{await f.close();}
});

test('during a purge, acknowledgments pass but no existing work is restarted by UPDATE or REPLACE',async()=>{
 const f=await fixture();try{
  f.db.prepare('INSERT INTO agent_delegation_jobs VALUES(?,?,?,?,?)').run('job-r',owner,'k-r','running',JSON.stringify({id:'job-r',sourceSessionId:'a-source',targetSessionId:'a-delegated',status:'running'}));
  f.db.prepare('INSERT INTO content_tombstones VALUES(?,?,?,?,?,?,NULL)').run(owner,'content-a',ws,'purging','req',at);
  for(const [kind,id] of [['run','run-a'],['session','a-source'],['session','a-delegated']])f.db.prepare('INSERT INTO content_tombstone_ids VALUES(?,?,?,?)').run(owner,kind,id,'content-a');
  f.db.prepare("UPDATE agent_delegation_jobs SET status='cancelled' WHERE id='job-r'").run();
  assert.throws(()=>f.db.prepare("UPDATE agent_delegation_jobs SET status='queued' WHERE id='job-r'").run(),/deleted locally/,'a retry is new work');
  const runA=JSON.parse(f.db.prepare("SELECT data_json FROM production_runs WHERE id='run-a'").get().data_json);
  const replace=(value,revision)=>f.db.prepare('INSERT OR REPLACE INTO production_runs VALUES(?,?,?,?,?,?,?)').run(value.id,owner,ws,value.contentId,revision,JSON.stringify(value),at);
  assert.throws(()=>replace({...runA,stage:'editing'},2),/deleted locally/,'a resume through the coordinator put is refused');
  assert.throws(()=>f.db.prepare("UPDATE production_runs SET data_json=json_set(data_json,'$.stage','editing') WHERE id='run-a'").run(),/deleted locally/);
  replace({...runA,stage:'canceled'},2);
  f.db.prepare("UPDATE production_runs SET data_json=json_set(data_json,'$.stage','editing') WHERE id='run-b'").run();
 }finally{await f.close();}
});

test('the pre-deletion revision is accepted once; afterwards it never overwrites newer data (no ABA through the alias)',async()=>{
 const f=await fixture();try{
  const staleSessions=f.store.read(owner,'sessions'),from=f.store.readAllVersioned(owner).revisions.sessions;
  const result=await del(f,f.bridge.deletion.preview(owner,{contentId:'content-a',workspaceId:ws}));f.store.notePurge(owner,result.state);
  const purged=f.store.read(owner,'sessions'),to=result.state.sessions.revision;
  // The renderer saves B, then saves back exactly the purged value: the stored revision equals the alias target again.
  const edited=f.store.write(owner,'sessions',[...purged,chat('b-new','source','Novo B','content-b')],to);
  f.store.write(owner,'sessions',purged,edited.revision);
  assert.throws(()=>f.store.write(owner,'sessions',staleSessions,from),/Newer saved data/);
 }finally{await f.close();}
});

test('work created after the review makes the confirmation stale instead of being stopped without consent',async()=>{
 const f=await fixture();try{
  const preview=f.bridge.deletion.preview(owner,{contentId:'content-a',workspaceId:ws});
  f.db.prepare('INSERT INTO runtime_actions VALUES(?,?,?,?,?,?,?,?)').run('act-late',owner,'h','pending',JSON.stringify({sessionId:'a-source',executionId:'e'}),null,at,at);
  await assert.rejects(del(f,preview,{stopLocalWork:true}),error=>error.code==='stale');
  assert.ok(f.editorial(owner).contents.some(c=>c.id==='content-a'));assert.equal(f.db.prepare("SELECT status FROM runtime_actions WHERE id='act-late'").get().status,'pending');
 }finally{await f.close();}
});

// A real crash: the old host is another process that dies right after the fence (no finally, no unfence).
async function crashAfterFence(f,preview){
 const script=join(f.dir,'old-host.mjs'),url=file=>JSON.stringify(new URL(`../${file}`,import.meta.url).href);
 writeFileSync(script,`import {createDesktopStateStore} from ${url('desktop-state-store.mjs')};import {createContentWorkflowBridge} from ${url('content-workflow-bridge.mjs')};import {DatabaseSync} from 'node:sqlite';
const [dir,dbPath,input]=process.argv.slice(2),store=createDesktopStateStore(dir,'test'),profile=${JSON.stringify(owner)};
const bridge=createContentWorkflowBridge({dbPath,getCurrentProfile:()=>profile,getAgents:p=>store.read(p,'agents'),getSessions:p=>store.read(p,'sessions'),getFlows:p=>store.read(p,'production-flows'),getRuntime:()=>null,deletionOptions:{stopTimeoutMs:60000,pollMs:20}});
const watch=new DatabaseSync(dbPath);bridge.deletion.delete(profile,JSON.parse(input)).catch(()=>{});
setInterval(()=>{if(watch.prepare("SELECT 1 FROM content_tombstones WHERE status='purging'").get())process.exit(9);},10);`);
 const {spawn}=await import('node:child_process');
 const code=await new Promise(resolve=>spawn(process.execPath,[script,f.dir,f.dbPath,JSON.stringify({contentId:preview.contentId,workspaceId:ws,fingerprint:preview.fingerprint,requestId:request(),stopLocalWork:true})],{stdio:'ignore'}).on('exit',resolve));
 assert.equal(code,9,'the old host died in the middle of the purge');
}

test('a purge abandoned by a crashed host is released only by the next exclusive host; data stays and it can be deleted again',async()=>{
 const f=await fixture();try{
  await del(f,f.bridge.deletion.preview(owner,{contentId:'content-c',workspaceId:ws}));
  // An export no executor can confirm keeps the old host waiting after the fence.
  f.db.prepare('INSERT INTO editorial_media_jobs VALUES(?,?,?,?,?)').run('media-a',owner,'running',JSON.stringify({id:'media-a',profileId:owner,contentId:'content-a',status:'running',ownerPid:process.pid,updatedAt:at}),at);
  const preview=f.bridge.deletion.preview(owner,{contentId:'content-a',workspaceId:ws});

  await crashAfterFence(f,preview);
  const stone=()=>f.db.prepare("SELECT status FROM content_tombstones WHERE profile_id=? AND content_id='content-a'").get(owner)?.status;
  assert.equal(stone(),'purging');
  // Another connection/service (not the exclusive host) never releases it.
  const other=createContentWorkflowBridge(f.options);
  assert.equal(stone(),'purging');assert.throws(()=>other.deletion.preview(owner,{contentId:'content-a',workspaceId:ws}),/em andamento/);
  await other.close();
  // The next authorized host: fence released, every local record kept, the other content stays deleted.
  await f.reopen({hostExclusive:true});
  assert.equal(stone(),undefined);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM content_tombstone_ids WHERE content_id='content-a'").get().n,0);
  assert.ok(f.editorial(owner).contents.some(c=>c.id==='content-a'));assert.ok(f.store.read(owner,'sessions').some(s=>s.id==='a-source'));
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM production_runs WHERE id='run-a'").get().n,1);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM content_srt_documents WHERE id='srt-a'").get().n,1);
  assert.equal(f.db.prepare("SELECT status FROM content_tombstones WHERE content_id='content-c'").get().status,'deleted','a committed deletion survives the crash and the recovery');
  assert.throws(()=>f.srt('srt-late','content-c'),/deleted locally/);
  // A new review and confirmation now work (the canceled export stays canceled; it is not relaunched).
  f.db.prepare("UPDATE editorial_media_jobs SET status='canceled' WHERE id='media-a'").run();
  const again=f.bridge.deletion.preview(owner,{contentId:'content-a',workspaceId:ws});assert.deepEqual(again.busy,[]);
  assert.equal((await del(f,again)).deleted,true);assert.equal(stone(),'deleted');
 }finally{await f.close();}
});

test('a live purge keeps its fence while other connections, services or even a host recovery open the database',async()=>{
 const f=await fixture({stopTimeoutMs:1500});try{
  f.db.prepare('INSERT INTO editorial_media_jobs VALUES(?,?,?,?,?)').run('media-a',owner,'running',JSON.stringify({id:'media-a',profileId:owner,contentId:'content-a',status:'running',ownerPid:process.pid,updatedAt:at}),at);
  const live=del(f,f.bridge.deletion.preview(owner,{contentId:'content-a',workspaceId:ws}),{stopLocalWork:true});
  const stone=()=>f.db.prepare("SELECT status FROM content_tombstones WHERE content_id='content-a'").get()?.status;
  for(let i=0;i<50&&stone()!=='purging';i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(stone(),'purging');
  const store=createDesktopStateStore(f.dir,'test-2'),service=createContentWorkflowBridge(f.options),host=createContentWorkflowBridge({...f.options,hostExclusive:true});
  assert.equal(stone(),'purging','neither a second connection nor a recovery in the same process drops a live fence');
  assert.throws(()=>f.db.prepare('INSERT INTO workflow_work(id,profile_id,workspace_id,target_id,kind,status,request_key,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('w-late',owner,ws,'t','script','queued','k',JSON.stringify({contentId:'content-a'}),at,at),/deleted locally/);
  await service.close();await host.close();store.close();
  await assert.rejects(live,error=>error.code==='busy');assert.equal(stone(),undefined,'the live purge itself releases its fence');
 }finally{await f.close();}
});
