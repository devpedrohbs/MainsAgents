import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createDesktopStateStore} from '../desktop-state-store.mjs';
import {openDesktopWorkspaceStore} from '../desktop-storage-location.mjs';
import {openDesktopEditorialBridge} from '../desktop-editorial-storage.mjs';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {EditorialStateClient} from '../src/features/content/EditorialStateClient.ts';
import {SaveCoordinator} from '../src/data/SaveCoordinator.ts';
import {restoreWorkspaceRecoverably,recoverWorkspaceRestore} from '../src/data/WorkspaceRestore.ts';

const empty=()=>({schemaVersion:1,topics:[],contents:[],runs:[],artifacts:[],approvals:[]});
test('an invalid editorial service response never replaces state or crashes the workspace',async()=>{
  const client=new EditorialStateClient('/state',async()=>Response.json({revision:0,topics:[]}));
  await assert.rejects(client.load(),/invalid snapshot/);assert.equal(client.ready,false);assert.deepEqual(client.snapshot(),empty());
});
test('editorial WAL data migrates once into the permanent shared database across launcher views',async()=>{
  const root=mkdtempSync(join(tmpdir(),'editorial-migration-')),home=join(root,'home'),legacy=join(root,'overlay');mkdirSync(legacy);
  const old=new DatabaseSync(join(legacy,'editorial.sqlite'));old.exec('PRAGMA journal_mode=WAL;CREATE TABLE editorial_state(profile_id TEXT PRIMARY KEY,revision INTEGER,state_json TEXT,updated_at TEXT)');
  old.prepare('INSERT INTO editorial_state VALUES (?,?,?,?)').run('owner',4,JSON.stringify({...empty(),topics:[{id:'saved-topic'}]}),'today');
  const store=await openDesktopWorkspaceStore(home,legacy,'test');store.initialize('owner',{agents:[{id:'video'},{id:'linkedin'}]});
  let bridge=openDesktopEditorialBridge(home,legacy);
  assert.equal(store.workspaceSnapshot('owner').editorial.state.topics[0].id,'saved-topic');
  const snap=store.workspaceSnapshot('owner');store.restoreWorkspace('owner',snap.values,empty(),{revisions:snap.revisions,editorialRevision:4});
  await bridge.close();bridge=openDesktopEditorialBridge(home,legacy);
  assert.equal(store.workspaceSnapshot('owner').editorial.state.topics.length,0); // deletion not undone by old data
  assert.equal(store.read('owner','agents').length,2);
  const recovery=JSON.parse(readFileSync(store.recoverySnapshot(),'utf8'));assert.equal(recovery.editorialRows.length,1);
  await bridge.close();store.close();old.close();
});
test('corrupt editorial migration fails instead of opening an empty replacement',async()=>{
  const root=mkdtempSync(join(tmpdir(),'editorial-corrupt-')),home=join(root,'home'),legacy=join(root,'legacy');mkdirSync(legacy);
  const store=await openDesktopWorkspaceStore(home,legacy,'test');writeFileSync(join(legacy,'editorial.sqlite'),'broken-original');
  assert.throws(()=>openDesktopEditorialBridge(home,legacy));assert.equal(readFileSync(join(legacy,'editorial.sqlite'),'utf8'),'broken-original');store.close();
});
test('desktop restore rolls back every module if an intermediate core write fails',async()=>{
  const root=mkdtempSync(join(tmpdir(),'editorial-restore-')),store=createDesktopStateStore(root,'test');store.initialize('owner',{agents:[{id:'keep'}]});
  const bridge=createContentWorkflowBridge({dbPath:join(root,'workspace-state.sqlite')});
  const snap=store.workspaceSnapshot('owner');
  assert.throws(()=>store.restoreWorkspace('owner',{agents:[{id:'replace'}],['x'.repeat(300)]:true},{...empty(),topics:[{id:'replace-topic'}]},{revisions:snap.revisions,editorialRevision:0}),/Invalid storage key/);
  assert.deepEqual(store.workspaceSnapshot('owner'),snap);
  store.write('owner','agents',[{id:'newer'}]);
  assert.throws(()=>store.restoreWorkspace('owner',snap.values,empty(),{revisions:snap.revisions,editorialRevision:0}),/changed/);
  await bridge.close();store.close();
});
test('the close barrier waits for delayed editorial writes and refuses failure while preserving recovery state',async()=>{
  let disk=empty(),revision=0,fail=false,release;
  const client=new EditorialStateClient('/state',async(_url,init)=>{
    if(!init?.method)return Response.json({state:disk,revision});
    if(fail)return Response.json({error:'Disk full'},{status:500});
    await new Promise(resolve=>{release=resolve});
    const input=JSON.parse(init.body);disk=input.state;revision++;return Response.json({revision});
  });
  await client.load();const coordinator=new SaveCoordinator();coordinator.register('editorial',client);client.subscribe(coordinator.changed);
  const write=client.update(state=>({...state,topics:[{id:'one'}]}));await new Promise(resolve=>setImmediate(resolve));
  let closed=false;const close=coordinator.flush().then(()=>{closed=true});assert.equal(closed,false);release();await write;await close;assert.equal(disk.topics[0].id,'one');
  fail=true;await assert.rejects(client.update(state=>({...state,topics:[{id:'unsaved'}]})),/Disk full/);
  await assert.rejects(coordinator.flush(),/Disk full/);assert.equal(client.snapshot().topics[0].id,'unsaved');assert.equal(coordinator.getStatus().phase,'error');
});
test('browser partial restore is rolled back; an interrupted rollback can recover on the next launch',async()=>{
  let local={agents:[{id:'original'}]},remote={state:{...empty(),topics:[{id:'original-topic'}]},revision:2},coreFailures=2;
  const store={readAll:async()=>structuredClone(local),write:async(key,value)=>{local[key]=value},replaceAll:async(value)=>{if(coreFailures-- >0)throw new Error('IDB write failed');local=structuredClone(value)}};
  const editorial={read:async()=>structuredClone(remote),write:async(revision,state)=>{assert.equal(revision,remote.revision);remote={revision:revision+1,state};return remote.revision}};
  await assert.rejects(restoreWorkspaceRecoverably(store,editorial,{agents:[{id:'incoming'}]},empty()),/recovery journal/);
  assert.ok(local['backup-restore-journal']);
  assert.equal(local.agents[0].id,'original');assert.equal(remote.state.topics[0].id,'original-topic');
  await recoverWorkspaceRestore(store,editorial);assert.equal(local.agents[0].id,'original');
  assert.equal(local['backup-restore-journal'],undefined);
});

test('a lost approval receipt is reconciled before closing and is never sent twice',async()=>{
  let disk=empty(),revision=0,calls=0,offline=false;
  const client=new EditorialStateClient('/state',async(url)=>{
    if(offline)throw new Error('Offline');
    if(url==='/approve'){calls++;disk={...disk,approvals:[{id:'approved'}]};revision++;offline=true;throw new Error('Response lost')}
    return Response.json({state:disk,revision});
  });
  await client.load();await assert.rejects(client.command('/approve',{}),/Response lost/);
  assert.equal(client.pending(),true);await assert.rejects(client.flush(),/Offline/);
  offline=false;await client.flush();assert.equal(client.snapshot().approvals[0].id,'approved');assert.equal(calls,1);assert.equal(client.pending(),false);
});

test('execution receipts join atomic snapshots; restored work never automatically replays',async()=>{
  const root=mkdtempSync(join(tmpdir(),'execution-restore-')),path=join(root,'workspace-state.sqlite');
  const store=createDesktopStateStore(root,'test');store.initialize('owner',{agents:[{id:'keep'}]});
  const bridge=createContentWorkflowBridge({dbPath:path});const db=new DatabaseSync(path);
  const source='12345678-1234-1234-1234-123456789abc';
  bridge.jobs.configure('owner','workspace',{dataSourceId:source,autoSync:true});
  db.prepare('INSERT INTO editorial_jobs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('job','owner','content','artifact','hash',source,'running','{}','{"phase":"creating"}',null,null,1,'today','today');
  const snap=store.workspaceSnapshot('owner');
  assert.equal(snap.execution.connections.length,1);assert.equal(snap.execution.jobs.length,1);
  assert.throws(()=>store.restoreWorkspace('owner',snap.values,empty(),{revisions:snap.revisions,editorialRevision:0,executionRevision:snap.executionRevision},{state:snap.execution,mode:'replace'}),/active editorial/);
  db.prepare("UPDATE editorial_jobs SET status='failed'").run();const current=store.workspaceSnapshot('owner');
  store.restoreWorkspace('owner',current.values,empty(),{revisions:current.revisions,editorialRevision:0,executionRevision:current.executionRevision},{state:snap.execution,mode:'replace'});
  assert.equal(bridge.jobs.list('owner')[0].status,'failed');assert.equal(bridge.jobs.connection('owner','workspace').autoSync,false);
  assert.equal(JSON.parse(db.prepare('SELECT checkpoint_json FROM editorial_jobs').get().checkpoint_json).phase,'creating');
  const before=store.workspaceSnapshot('owner');
  assert.throws(()=>store.restoreWorkspace('owner',{agents:[]},empty(),{revisions:before.revisions,editorialRevision:before.editorial.revision},{state:{jobs:[{}],events:[],connections:[]},mode:'replace'}),/Invalid execution/);
  assert.deepEqual(store.workspaceSnapshot('owner'),before);
  await bridge.close();db.close();store.close();
});
