import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createReferenceStore,editingLibrariesSnapshot,restoreEditingLibraries} from '../editing-reference-store.mjs';
import {createEditingReferences} from '../editing-reference-runtime.mjs';
import {createKnowledgeManifest} from '../editing-knowledge-context.mjs';
import {validateInspirationState} from '../editorial-inspiration.mjs';
const scope={profile:'p',workspaceId:'w'};
function fixture(){const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE editorial_state(profile_id TEXT PRIMARY KEY,revision INTEGER,state_json TEXT,updated_at TEXT)');const store=createReferenceStore(db);return {db,store};}
const bookmark=(store,folderId)=>store.command(scope,{type:'reference.link',title:'Motion',sourceUrl:'https://example.com/reference',folderId}).entityId;
test('folders isolate workspaces, reject cycles, move without duplication, delete and undo preserve reference knowledge',()=>{
 const {db,store}=fixture();try{
  const parent=store.command(scope,{type:'folder.create',name:'Motion'}).entityId;
  const child=store.command(scope,{type:'folder.create',name:'Type',parentId:parent}).entityId;
  const ref=bookmark(store,child);
  assert.throws(()=>store.command(scope,{type:'folder.update',id:parent,expectedRevision:1,parentId:child}),/itself/);
  const deletion=store.command(scope,{type:'folder.delete',id:parent,expectedRevision:1});
  let value=store.read(scope);assert.equal(value.data.folders.length,0);assert.equal(value.data.references[ref].folderId,null);assert.equal(value.state.inspiration.references.length,1);
  store.command(scope,{type:'folder.restore',undoId:deletion.undoId,expectedRevision:value.revision});
  value=store.read(scope);assert.equal(value.data.references[ref].folderId,child);assert.equal(value.data.folders.length,2);
  assert.throws(()=>store.command({...scope,workspaceId:'other'},{type:'folder.update',id:parent,expectedRevision:1,name:'Escape'}),/not found/);
  assert.equal(store.read({...scope,profile:'other'}).data.folders.length,0);
 }finally{db.close();}
});
test('revision conflicts, unsafe links and destructive undo after intervening edits are refused atomically',()=>{
 const {db,store}=fixture();try{
  const f=store.command(scope,{type:'folder.create',name:'A'}).entityId,ref=bookmark(store,f);
  store.command(scope,{type:'reference.update',id:ref,expectedRevision:1,notes:'Only approved facts'});
  assert.throws(()=>store.command(scope,{type:'reference.update',id:ref,expectedRevision:1,notes:'Lost update'}),/changed/);
  assert.throws(()=>store.command(scope,{type:'reference.link',title:'Bad',sourceUrl:'javascript:alert(1)'}),/HTTP/);
  const deleted=store.command(scope,{type:'folder.delete',id:f,expectedRevision:1}),revision=store.read(scope).revision;
  store.command(scope,{type:'folder.create',name:'B'});
  assert.throws(()=>store.command(scope,{type:'folder.restore',undoId:deleted.undoId,expectedRevision:revision}),/no longer safe/);
  assert.equal(store.read(scope).state.inspiration.references[0].notes,'Only approved facts');
 }finally{db.close();}
});
test('canonical inspiration bridge reuses legacy IDs and live notes without a duplicated library',()=>{
 const {db,store}=fixture();try{const ref=bookmark(store);store.transaction(scope,(_d,s)=>{s.inspiration.references[0].notes='Updated from legacy UI';});
 const value=store.read(scope),refs=store.publicReferences(scope,value.data,value.state);assert.equal(refs.length,1);assert.equal(refs[0].id,ref);assert.equal(refs[0].notes,'Updated from legacy UI');assert.equal(validateInspirationState(value.state),true);
 }finally{db.close();}
});
test('knowledge approval, observation decisions and guideline history are explicit; manifests are bounded and scoped',()=>{
 const {db,store}=fixture();try{
 const ref=bookmark(store);store.transaction(scope,d=>{d.analyses.push({id:'a',referenceId:ref,versionId:null,status:'completed',observations:[{id:'o',text:'Observed',frameIds:['f'],start:0,end:1,adaptation:'Adapt',limitations:[]}]});});
 store.command(scope,{type:'observation.decide',analysisId:'a',observationId:'o',decision:'keep'});
 assert.equal(store.read(scope).data.guidelines.length,0);
 const gid=store.command(scope,{type:'guideline.approve',text:'Reveal one step at a time',referenceId:ref,analysisId:'a',observationId:'o'}).entityId;
 assert.equal(store.read(scope).data.analyses[0].observations[0].decision,'approved');
 store.command(scope,{type:'guideline.update',id:gid,expectedRevision:1,enabled:false});
 const value=store.read(scope);assert.equal(value.data.guidelines[0].history.length,2);
 const manifest=createKnowledgeManifest(scope,value.data,store.publicReferences(scope,value.data,value.state),{referenceIds:[ref]});assert.equal(manifest.guidelines.length,0);assert.ok(Buffer.byteLength(manifest.text)<=24000);
 assert.throws(()=>createKnowledgeManifest({...scope,workspaceId:'elsewhere'},value.data,[],{referenceIds:[ref]}),/unavailable/);
 }finally{db.close();}
});
test('backup roundtrip preserves versions, marks running work interrupted, and old snapshots retain newer knowledge',()=>{
 const {db,store}=fixture();try{bookmark(store);store.transaction(scope,d=>{d.jobs.push({id:'j',status:'running'});});const rows=editingLibrariesSnapshot(db,'p');restoreEditingLibraries(db,'copy',rows,'replace');assert.equal(store.read({...scope,profile:'copy'}).data.jobs[0].status,'interrupted');restoreEditingLibraries(db,'p',undefined,'replace');assert.equal(editingLibrariesSnapshot(db,'p').length,1);
 }finally{db.close();}
});
test('kit pins an immutable rendered revision while studies are adjusted',()=>{
 const {db,store}=fixture();try{const spec={title:'A',text:'One',kind:'title',accent:'#00ffaa',background:'#111111',duration:2,width:640,height:360,fps:24};const studyId=store.command(scope,{type:'study.create',title:'Study',spec}).entityId;
 store.transaction(scope,d=>{const study=d.studies[0];study.status='completed';study.artifacts=[{id:'v',kind:'video',name:'preview.mp4'}];study.versions.push({revision:1,spec:structuredClone(spec),artifacts:study.artifacts});});
 store.command(scope,{type:'kit.approve',studyId,expectedRevision:1,name:'Approved'});
 store.command(scope,{type:'study.update',id:studyId,expectedRevision:1,spec:{...spec,title:'B'}});
 const value=store.read(scope);const manifest=createKnowledgeManifest(scope,value.data,[],{kitIds:[value.data.kit[0].id]});assert.equal(manifest.kit[0].studyRevision,1);assert.equal(manifest.kit[0].spec.title,'A');
 }finally{db.close();}
});
test('runtime refuses analysis without verified image capability, bookmark downloads and cross-profile writes',async()=>{
 const {db}=fixture(),directory=await mkdtemp(join(tmpdir(),'editing-reference-'));let profile='p';
 const runtime=createEditingReferences(db,{directory,getCurrentProfile:()=>profile,getAgents:()=>[{id:'text-only',workspaceId:'w',providerId:'codex'}]});
 try{const created=await runtime.command(scope,{type:'reference.link',title:'Link',sourceUrl:'https://127.0.0.1/private'});assert.equal(created.snapshot.agents[0].visual,false);await assert.rejects(runtime.command(scope,{type:'analysis.start',referenceId:created.entityId,versionId:'none',expectedRevision:1,agentId:'text-only',mode:'motion',start:0,end:1}),/version/);profile='other';await assert.rejects(runtime.command(scope,{type:'folder.create',name:'Wrong'}),/profile/);
 }finally{await runtime.close();db.close();await rm(directory,{recursive:true,force:true});}
});

test('request replay does not duplicate mutations or invalidate safe folder undo',async()=>{
 const {db}=fixture(),directory=await mkdtemp(join(tmpdir(),'references-replay-'));
 const service=createEditingReferences(db,{directory,engine:{status:async()=>({status:'not-configured',version:null,expectedVersion:'0.8.212'})}});
 try{const create={type:'folder.create',name:'Motion',requestKey:'create-once'};const one=await service.command(scope,create),two=await service.command(scope,create);assert.equal(one.entityId,two.entityId);assert.equal(two.snapshot.folders.length,1);
 const deleted=await service.command(scope,{type:'folder.delete',id:one.entityId,expectedRevision:1,requestKey:'delete-once'});const restored=await service.command(scope,{type:'folder.restore',undoId:deleted.undoId,expectedRevision:deleted.snapshot.revision,requestKey:'restore-once'});assert.equal(restored.snapshot.folders.length,1);
 await assert.rejects(service.command(scope,{...create,name:'Other'}),/different command/);
 }finally{await service.close();db.close();await rm(directory,{recursive:true,force:true});}
});

test('engine preparation is a persistent cancellable task; it cannot silently finish after cancellation',async()=>{
 const {db}=fixture(),directory=await mkdtemp(join(tmpdir(),'references-cancel-'));let preparing=false;
 const engine={status:async()=>({status:preparing?'preparing':'not-configured',version:null,expectedVersion:'0.8.212'}),prepare:async({signal,onProgress})=>{preparing=true;onProgress('Preparing test dependency');await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));}};
 const service=createEditingReferences(db,{directory,engine});
 try{const started=await service.command(scope,{type:'engine.prepare'});assert.equal(started.snapshot.engine.jobId,started.jobId);assert.equal(started.snapshot.jobs[0].phase,'Preparing test dependency');const stopped=await service.command(scope,{type:'job.cancel',id:started.jobId});assert.equal(stopped.snapshot.jobs[0].status,'cancelled');await service.close();assert.equal(service.store.read(scope).data.jobs[0].status,'cancelled');
 }finally{await service.close();db.close();await rm(directory,{recursive:true,force:true});}
});
