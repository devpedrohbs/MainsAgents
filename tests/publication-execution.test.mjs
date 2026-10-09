import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createEditorialPublications} from '../editorial-publications.mjs';
import {createPublicationExecution} from '../editorial-publication-execution.mjs';
import {createPublicationConnector,unpackPublication} from '../publication-connector.mjs';
import {createDesktopStateStore} from '../desktop-state-store.mjs';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {Readable} from 'node:stream';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

function fixture(){
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE editorial_state(profile_id TEXT PRIMARY KEY,revision INTEGER,state_json TEXT,updated_at TEXT)');
 let now=Date.now(),profile='owner',creates=0,reads=0,cancels=0,accountPresent=true,failCreate=false,failRead=false,failCancel=false,failUpdate=false,release;
 const at=new Date(now).toISOString(),state={schemaVersion:1,topics:[],contents:[{id:'c',workspaceId:'w'}],runs:[],artifacts:[],approvals:[]};
 db.prepare('INSERT INTO editorial_state VALUES (?,?,?,?)').run('owner',0,JSON.stringify(state),at);
 const local=createEditorialPublications(db),snap=()=>{const row=db.prepare('SELECT * FROM editorial_state').get();return {revision:row.revision,state:JSON.parse(row.state_json)}};
 const command=(action,extra={})=>{const v=snap(),d=v.state.publications?.[0];return local.command('owner',{revision:v.revision,contentId:'c',id:d?.id,expectedDelivery:d,action,...extra})};
 command('create',{platform:'LinkedIn',draft:{text:'Approved exact text',assetIds:[],timeZone:'UTC',plannedAt:new Date(now+3600000).toISOString()}});command('submit');command('approve');
 let external;
 const transport={async call(tool,args){if(tool==='list_connections')return {structuredContent:{connections:accountPresent?[{platformId:'linkedin-a',displayName:'Work',tokenStatus:'valid',connectionStatus:'active'}]:[]}};
 if(tool==='create_post'){creates++;if(release)await release;if(failCreate)throw Error('lost response');external={postGroupId:'external',platforms:args.platforms,posts:[{platform:'linkedin',platformId:'a',content:args.content,status:args.scheduledTime?'scheduled':'draft'}],media:[],status:args.scheduledTime?'scheduled':'draft',scheduledTime:args.scheduledTime};return {structuredContent:{success:true,postGroupId:'external'}};}
 if(tool==='update_post'&&args.content!==undefined){external.posts[0].content=args.content;external.status=args.status;external.posts[0].status=args.status;external.scheduledTime=args.scheduledTime;if(failUpdate)throw Error('Lost edit result');return {structuredContent:{success:true}};}
 if(tool==='update_post'){cancels++;assert.equal(args.status,'draft');external.status='draft';external.posts[0].status='draft';if(failCancel)throw Error('Lost cancellation result');return {structuredContent:{success:true}};}
 if(tool==='get_post'){reads++;if(failRead)throw Error('offline');return {structuredContent:external}};throw Error('Unexpected tool');}};
 const options={getConnector:()=>createPublicationConnector(()=>transport),getCurrentProfile:()=>profile,clock:()=>now};let service=createPublicationExecution(db,options);
 const input=()=>{const s=snap();return {id:s.state.publications[0].id,revision:s.revision,expectedDelivery:s.state.publications[0]}};
 return {db,snap,command,input,get service(){return service},prepare:(mode='draft')=>service.prepare('owner',{...input(),mode,accountId:'linkedin-a'}),execute:()=>service.execute('owner',{...input(),authorize:true}),reconcile:extra=>service.reconcile('owner',{...input(),...extra}),get creates(){return creates},get reads(){return reads},get cancels(){return cancels},cancel:()=>service.cancel('owner',{...input(),authorize:true}),failCancel:()=>{failCancel=true},failUpdate:()=>{failUpdate=true},get external(){return external},set external(v){external=v},failCreate:()=>{failCreate=true},failRead:()=>{failRead=true},online:()=>{failRead=false},loseAccount:()=>{accountPresent=false},advance:ms=>{now+=ms},profile:v=>{profile=v},block:p=>{release=p},reopen:async()=>{await service.close();service=createPublicationExecution(db,options)},close:async()=>{await service.close();db.close()}};
}
test('Publora drafts and schedules require exact explicit approval and verified per-account readback',async()=>{
 for(const mode of ['draft','schedule']){const f=fixture();try{f.prepare(mode);assert.equal(f.creates,0);await assert.rejects(f.service.execute('owner',f.input()),/authorization/);const result=await f.execute();const d=result.state.publications[0];assert.equal(f.creates,1);assert.equal(f.reads,1);assert.equal(d.receipt.id,'external');assert.equal(d.receipt.status,mode==='draft'?'draft':'scheduled');assert.equal(d.status,mode==='draft'?'approved':'scheduled');assert.throws(()=>f.command('edit',{draft:{text:'mutated',assetIds:[],timeZone:'UTC'}}),/Reconcile/);await assert.rejects(f.execute(),/authorization/);}finally{await f.close()}}
});
test('missing accounts, expired previews and changed snapshots never submit',async()=>{
 const f=fixture();try{f.prepare();const old=f.input();f.advance(600001);await assert.rejects(f.execute(),/authorization/);f.prepare();f.loseAccount();await assert.rejects(f.execute(),/unavailable/);await assert.rejects(f.service.execute('owner',{...old,authorize:true}),/changed/);assert.equal(f.creates,0);f.profile('other');await assert.rejects(f.execute(),/profile/);}finally{await f.close()}
});
test('unknown create blocks duplicates across restart; manual ID binding only reads exact matching post',async()=>{
 const f=fixture();try{f.prepare('schedule');f.failCreate();await assert.rejects(f.execute(),/unconfirmed/);assert.equal(f.snap().state.publications[0].operation.phase,'uncertain');const interrupted=f.snap();interrupted.state.publications[0].operation.phase='requesting';f.db.prepare('UPDATE editorial_state SET state_json=?').run(JSON.stringify(interrupted.state));await f.reopen();assert.equal(f.snap().state.publications[0].operation.phase,'uncertain');await assert.rejects(f.execute(),/authorization/);await assert.rejects(f.reconcile(),/no identifier/);f.external={postGroupId:'external',platforms:['linkedin-a'],posts:[{platform:'linkedin',platformId:'a',content:'wrong',status:'scheduled'}],media:[],status:'scheduled',scheduledTime:f.snap().state.publications[0].plannedAt};await assert.rejects(f.reconcile({externalId:'external'}),/differs/);f.external.posts[0].content='Approved exact text';await f.reconcile({externalId:'external'});assert.equal(f.creates,1);assert.equal(f.snap().state.publications[0].status,'scheduled');}finally{await f.close()}
});
test('failed readback keeps the external identifier and reconciliation never repeats create',async()=>{
 const f=fixture();try{f.prepare('schedule');f.failRead();await assert.rejects(f.execute(),/unconfirmed/);assert.equal(f.snap().state.publications[0].operation.externalId,'external');f.online();f.external.posts[0].status='published';f.external.posts[0].postedId='real-platform-id';f.external.status='published';await f.reconcile();assert.equal(f.creates,1);assert.equal(f.snap().state.publications[0].status,'published');}finally{await f.close()}
});
test('concurrent requests and restore of a preview cannot reuse native authorization',async()=>{
 const f=fixture();let unblock;try{f.prepare();const preview=f.snap();const gate=new Promise(resolve=>unblock=resolve);f.block(gate);const first=f.execute();await new Promise(resolve=>setImmediate(resolve));await assert.rejects(f.execute(),/already running/);unblock();await first;f.db.prepare('UPDATE editorial_state SET revision=?,state_json=?').run(preview.revision,JSON.stringify(preview.state));await assert.rejects(f.execute(),/authorization/);assert.equal(f.creates,1);}finally{unblock?.();await f.close()}
});
test('non-JSON replies, ambiguous provider results and fabricated success fail closed',()=>{
 assert.throws(()=>unpackPublication({content:[{type:'text',text:'Published!'}]}),/verifiable/);assert.throws(()=>unpackPublication({structuredContent:{success:false}}),/confirm/);
});
test('cancellation requires a separate explicit authorization and verifies draft before reporting success',async()=>{
 const f=fixture();try{f.prepare('schedule');await f.execute();await assert.rejects(f.service.cancel('owner',f.input()),/authorizing/);assert.equal(f.cancels,0);await f.cancel();assert.equal(f.cancels,1);assert.equal(f.snap().state.publications[0].receipt.status,'draft');assert.equal(f.snap().state.publications[0].status,'approved');await assert.rejects(f.cancel(),/confirmed scheduled/);assert.equal(f.creates,1);}finally{await f.close()}
});
test('lost cancellation response and external edits reconcile without repeating any write',async()=>{
 const f=fixture();try{f.prepare('schedule');await f.execute();f.failCancel();await assert.rejects(f.cancel(),/unconfirmed/);await f.reopen();await f.reconcile();assert.equal(f.cancels,1);assert.equal(f.creates,1);assert.equal(f.snap().state.publications[0].receipt.status,'draft');f.external.posts[0].content='Externally changed';await assert.rejects(f.reconcile(),/differs/);assert.equal(f.snap().state.publications[0].status,'sending');assert.equal(f.snap().state.publications[0].operation.phase,'uncertain');}finally{await f.close()}
});
test('restored previews without a native intent are not executable',async()=>{
 const f=fixture();try{f.prepare();f.db.exec('DELETE FROM publication_intents');await assert.rejects(f.execute(),/authorization/);assert.equal(f.creates,0);}finally{await f.close()}
});
test('generic HTTP saves cannot forge or erase provider operations, while unrelated edits remain savable',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'publishing-http-')),path=join(directory,'workspace-state.sqlite'),store=createDesktopStateStore(directory,'test'),bridge=createContentWorkflowBridge({dbPath:path,getCurrentProfile:()=> 'owner'}),db=new DatabaseSync(path);
 store.initialize('owner',{agents:[]});const at=new Date().toISOString();db.prepare('INSERT INTO editorial_state VALUES (?,?,?,?)').run('owner',0,JSON.stringify({schemaVersion:1,topics:[],contents:[{id:'c',workspaceId:'w'}],runs:[],artifacts:[],approvals:[]}),at);
 const snapshot=()=>{const row=db.prepare('SELECT * FROM editorial_state').get();return {revision:row.revision,state:JSON.parse(row.state_json)}};
 const local=(action,extra={})=>{const s=snapshot(),d=s.state.publications?.[0];return bridge.publications.command('owner',{...s,action,id:d?.id,contentId:'c',expectedDelivery:d,...extra})};
 const put=async value=>{const request=Readable.from([Buffer.from(JSON.stringify(value))]);request.method='PUT';let status;await bridge.handle(request,{writeHead:code=>{status=code},end:()=>{}},new URL('http://localhost/api/content/state?profile=owner'));return status;};
 try{local('create',{platform:'LinkedIn',draft:{text:'Approved text',assetIds:[],timeZone:'UTC'}});local('submit');local('approve');let s=snapshot();bridge.publishing.prepare('owner',{revision:s.revision,id:s.state.publications[0].id,expectedDelivery:s.state.publications[0],accountId:'linkedin-a',mode:'draft'});s=snapshot();const forged=structuredClone(s);forged.state.publications[0].operation.arguments.content='Unapproved';assert.equal(await put(forged),400);const removed=structuredClone(s);removed.state.publications=[];assert.equal(await put(removed),409);const receipt=structuredClone(s);receipt.state.publications[0].receipt={id:'fake',version:1,checkedAt:at};assert.equal(await put(receipt),409);s.state.contents[0].title='Unrelated local title';assert.equal(await put(s),200);let changed=snapshot();changed.state.publications[0].status='sending';changed.state.publications[0].operation.phase='requesting';db.prepare('UPDATE editorial_state SET state_json=?').run(JSON.stringify(changed.state));let saved=store.workspaceSnapshot('owner');assert.throws(()=>store.restoreWorkspace('owner',saved.values,saved.editorial.state,{revisions:saved.revisions,editorialRevision:saved.editorial.revision}),/provider operation/);changed.state.publications[0].operation.phase='uncertain';db.prepare('UPDATE editorial_state SET state_json=?').run(JSON.stringify(changed.state));saved=store.workspaceSnapshot('owner');const replaced=structuredClone(saved.editorial.state);replaced.publications=[];assert.throws(()=>store.restoreWorkspace('owner',saved.values,replaced,{revisions:saved.revisions,editorialRevision:saved.editorial.revision}),/unresolved provider/);}finally{await bridge.close();db.close();store.close();rmSync(directory,{recursive:true,force:true})}
});

const editInput=(f,text='Edited exact text',mode='schedule')=>({...f.input(),mode,draft:{text,timeZone:'UTC',plannedAt:new Date(Date.now()+86400000).toISOString()}});
test('editing and rescheduling updates the existing ID only after separate approval, with version history',async()=>{
 const f=fixture();try{f.prepare('draft');await f.execute();const original=f.snap().state.publications[0];const {preview}=f.service.prepareChange('owner',editInput(f));assert.equal(f.external.posts[0].content,original.text);assert.equal(f.snap().state.publications[0].version,1);
 await assert.rejects(f.service.change('owner',{...f.input(),changeId:preview.id}),/authorization/);
 const result=await f.service.change('owner',{...f.input(),changeId:preview.id,authorize:true});const d=result.state.publications[0];assert.equal(d.receipt.id,'external');assert.equal(d.status,'scheduled');assert.equal(d.version,2);assert.equal(d.history.at(-1).payload.text,'Edited exact text');assert.equal(d.history[0].payload.text,original.text);assert.equal(f.creates,1);
 await assert.rejects(f.service.change('owner',{...f.input(),changeId:preview.id,authorize:true}),/authorization/);
 const next=f.service.prepareChange('owner',editInput(f,'New draft','draft')).preview;await f.service.change('owner',{...f.input(),changeId:next.id,authorize:true});assert.equal(f.snap().state.publications[0].receipt.status,'draft');assert.equal(f.snap().state.publications[0].version,3);assert.equal(f.creates,1);
 }finally{await f.close()}
});
test('lost edit response survives restart and reconciles the new version without creating or repeating',async()=>{
 const f=fixture();try{f.prepare('schedule');await f.execute();const {preview}=f.service.prepareChange('owner',editInput(f));f.failUpdate();await assert.rejects(f.service.change('owner',{...f.input(),changeId:preview.id,authorize:true}),/unconfirmed/);assert.equal(f.snap().state.publications[0].operation.phase,'uncertain');assert.equal(f.snap().state.publications[0].version,2);await f.reopen();await f.reconcile();assert.equal(f.snap().state.publications[0].receipt.version,2);assert.equal(f.snap().state.publications[0].status,'scheduled');assert.equal(f.creates,1);
 }finally{await f.close()}
});
test('edit previews reject stale content, expired approvals, unavailable accounts and external changes',async()=>{
 for(const reason of ['expired','account','external','stale']){const f=fixture();try{f.prepare();await f.execute();const expected=f.input();const {preview}=f.service.prepareChange('owner',editInput(f));if(reason==='expired')f.advance(600001);if(reason==='account')f.loseAccount();if(reason==='external')f.external.posts[0].content='Externally edited';if(reason==='stale')expected.expectedDelivery.text='Forged';await assert.rejects(f.service.change('owner',{...expected,changeId:preview.id,authorize:true}));assert.equal(f.snap().state.publications[0].version,1);assert.equal(f.creates,1);}finally{await f.close()}}
});
test('an expired scheduled edit fails before writing, and native approval rollback keeps its token usable',async()=>{
 const f=fixture();try{f.prepare();await f.execute();const input=editInput(f);input.draft.plannedAt=new Date(Date.now()+130000).toISOString();const {preview}=f.service.prepareChange('owner',input);f.advance(20000);await assert.rejects(f.service.change('owner',{...f.input(),changeId:preview.id,authorize:true}),/too close/);assert.equal(f.snap().state.publications[0].version,1);assert.equal(f.db.prepare('SELECT used FROM publication_changes WHERE id=?').get(preview.id).used,0);}finally{await f.close()}
});

import {createPublicationStatusRefresh,refreshCandidates} from '../publication-status-refresh.mjs';
test('B10 automatic status refresh is read-only: keeps scheduled on network failure, writes only trusted published/failed receipts, never writes externally',async()=>{
 const f=fixture();let refresher,active='owner';try{
  f.prepare('schedule');await f.execute();let d=f.snap().state.publications[0];assert.deepEqual([d.status,d.operation.phase],['scheduled','confirmed']);
  refresher=createPublicationStatusRefresh(f.db,{publishing:f.service,getCurrentProfile:()=>active,tickMs:3_600_000});
  assert.deepEqual(refreshCandidates(f.snap().state.publications),[d.id]);
  const writes=()=>[f.creates,f.cancels];const baseline=writes(),revision=f.snap().revision;
  f.failRead();let s=await refresher.refresh('owner',{reason:'manual'});
  assert.deepEqual(s.status.results.map(r=>[r.state,r.status]),[['unknown','scheduled']]);d=f.snap().state.publications[0];
  assert.deepEqual([d.status,d.operation.phase,d.operation.error,f.snap().revision],['scheduled','confirmed',undefined,revision],'a failed read changes nothing (no false failure, no uncertain)');
  f.online();s=await refresher.refresh('owner',{reason:'manual'});assert.equal(s.status.results[0].state,'unchanged');
  const reads=f.reads;s=await refresher.refresh('owner',{reason:'open'});assert.equal(s.cached,true);assert.equal(f.reads,reads,'opening the screen again within a minute uses the cache');
  // Externally moved back to draft: reported for attention, never written.
  f.external={...f.external,status:'draft',posts:[{...f.external.posts[0],status:'draft'}]};s=await refresher.refresh('owner',{reason:'manual'});
  assert.deepEqual([s.status.results[0].state,f.snap().state.publications[0].status,f.snap().revision],['attention','scheduled',revision]);
  f.external={...f.external,status:'published',posts:[{...f.external.posts[0],status:'published',postedId:'urn:li:share:1'}]};
  s=await refresher.refresh('owner',{reason:'manual'});d=f.snap().state.publications[0];
  assert.deepEqual([s.status.results[0].state,d.status,d.receipt.status,d.receipt.platformPostId],['updated','published','published','urn:li:share:1']);
  assert(s.status.notices.some(n=>n.state==='updated'&&n.status==='published'));assert.deepEqual(writes(),baseline,'no create/update/cancel from polling');
  s=await refresher.refresh('owner',{reason:'manual'});assert.deepEqual(s.status.results,[],'published deliveries are no longer polled');
  assert.throws(()=>refresher.configure('owner',{auto:true,intervalMinutes:7}),/intervalo/);assert.deepEqual(refresher.configure('owner',{auto:false,intervalMinutes:5}).settings,{auto:false,intervalMinutes:5});
  assert.deepEqual(refresher.dismiss('owner').status.notices,[]);
  f.profile('other');active='other';await assert.rejects(refresher.refresh('owner',{reason:'manual'}),/perfil/);
 }finally{await refresher?.close();await f.close()}
});

test('B10 auto refresh runs only for the active profile while alive, respects the toggle and stops on close',async()=>{
 const f=fixture();let active='owner',refresher;try{
  f.prepare('schedule');await f.execute();
  refresher=createPublicationStatusRefresh(f.db,{publishing:f.service,getCurrentProfile:()=>active,tickMs:20});
  refresher.configure('owner',{auto:false,intervalMinutes:5});await new Promise(resolve=>setTimeout(resolve,120));assert.equal(refresher.snapshot('owner').status.lastRunAt,null,'auto off: no background read');
  refresher.configure('owner',{auto:true,intervalMinutes:5});
  const end=Date.now()+3000;while(refresher.snapshot('owner').status.lastReason!=='auto'&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(refresher.snapshot('owner').status.lastReason,'auto');const reads=f.reads;
  await new Promise(resolve=>setTimeout(resolve,150));assert.equal(f.reads,reads,'the interval bounds background reads');
  active='other';const before=f.reads;await refresher.refresh('owner',{reason:'manual'}).catch(()=>{});assert.equal(f.reads,before,'another active profile never reads');
  await refresher.close();active='owner';await assert.rejects(async()=>refresher.refresh('owner',{reason:'manual'}),/fechando/);
 }finally{await refresher?.close();await f.close()}
});
