// Real SQLite, FFmpeg frames and MCP image serialization. Provider decisions are scripted: no paid inference.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createServer} from 'node:http';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createEditingReferences} from '../editing-reference-runtime.mjs';
import {createEditorAuthoring,hashFile} from '../editor-authoring.mjs';
import {runMediaProcess} from '../editorial-media.mjs';
import {createHyperframesEngine} from '../hyperframes-engine.mjs';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {parseInspirationState} from '../src/features/content/inspiration.ts';
const scope={profile:'p',workspaceId:'w'};
const waitFor=async(fn,timeout=30000)=>{const start=Date.now();for(;;){const value=await fn();if(value)return value;if(Date.now()-start>timeout)throw Error('Timed out waiting for task');await new Promise(r=>setTimeout(r,30));}};
function scriptedVisualProvider(){const editor=createEditorAuthoring();let delivered=0;return {get delivered(){return delivered;},openEditorSession:args=>editor.open(args),closeEditorSession:(...args)=>editor.close(...args),forgetEditorSession:id=>editor.forget(id),cancel:async()=>{},
 async send(_thread,prompt,agent){const executionId='scripted-execution',token=editor.attach(agent.editorSessionId,executionId);const available=JSON.parse(prompt.match(/Available image IDs\/times: (\[.*?\])\./)[1]);
  for(let offset=0;offset<available.length;offset+=6){const frames=await editor.call(token,'get_frames',{target:'source',times:available.slice(offset,offset+6).map(f=>f.time)});assert.equal(frames.isError,undefined,JSON.stringify(frames));for(const block of frames.content.filter(b=>b.type==='image')){assert.equal(block.mimeType,'image/jpeg');assert.ok(Buffer.from(block.data,'base64').length>100);delivered++;}}
  const saved=await editor.call(token,'submit_reference_analysis',{observations:[{start:0,end:1,text:'Shapes change across temporal samples',adaptation:'Reveal sequentially',frameIds:available.filter(f=>f.time<=1).map(f=>f.id),limitations:['Scripted provider used in test']}],limitations:['Sampled only']});assert.equal(saved.isError,undefined);return {executionId};
 },async *events(){yield {type:'execution.completed'};}};}
test('reference -> real visual evidence -> approval -> immutable context, with no duplicate on request replay',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'refs-integration-')),db=new DatabaseSync(join(directory,'state.sqlite'));db.exec('CREATE TABLE editorial_state(profile_id TEXT PRIMARY KEY,revision INTEGER,state_json TEXT,updated_at TEXT)');
 const provider=scriptedVisualProvider(),service=createEditingReferences(db,{directory:join(directory,'managed'),getCurrentProfile:()=>scope.profile,getChatRuntime:()=>provider,getAgents:()=>[{id:'editor',name:'Editor',providerId:'claude',workspaceId:'w'}],engine:{status:async()=>({status:'not-configured',version:null,expectedVersion:'0.8.212'})}});
 try{
  const file=join(directory,'original.mp4');await runMediaProcess('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=12','-t','1.5','-c:v','libx264','-pix_fmt','yuv420p',file]);const originalHash=await hashFile(file);
  const queued=await service.importVideos(scope,[file],{wait:false});assert.ok(queued.jobId);assert.equal(queued.snapshot.jobs.find(j=>j.id===queued.jobId).kind,'import');
  const imported=await waitFor(async()=>{const s=await service.snapshot(scope),job=s.jobs.find(j=>j.id===queued.jobId);if(job.status==='failed')throw Error(job.error);return job.status==='completed'?{snapshot:s}:null;});const ref=imported.snapshot.references[0];assert.equal(await hashFile(file),originalHash);assert.equal(ref.versions[0].sha256,originalHash);
  const legacy=JSON.parse(db.prepare('SELECT state_json FROM editorial_state').get().state_json);assert.equal(parseInspirationState(legacy.inspiration).references[0].id,ref.id);
  await service.command(scope,{type:'reference.update',id:ref.id,expectedRevision:1,markers:[{id:'marker',start:0,end:1,kind:'wanted',text:'Follow this rhythm'}]});
  const analyzed=await service.command(scope,{type:'analysis.start',referenceId:ref.id,versionId:ref.currentVersionId,expectedRevision:2,agentId:'editor',mode:'motion',start:0,end:1.2});
  const snapshot=await waitFor(async()=>{const s=await service.snapshot(scope);const j=s.jobs.find(j=>j.id===analyzed.jobId);if(j.status==='failed')throw Error(j.error);return j.status==='completed'?s:null;});const analysis=snapshot.analyses[0];assert.equal(analysis.status,'completed');assert.equal(analysis.coverage.kind,'sampled');assert.equal(analysis.coverage.pending.length,0);assert.equal(provider.delivered,analysis.frames.length);assert.ok(provider.delivered>=6);assert.equal(snapshot.guidelines.length,0);
  const approve={type:'guideline.approve',requestKey:'approval-1',text:'Reveal sequentially',referenceId:ref.id,analysisId:analysis.id,observationId:analysis.observations[0].id};
  const approved=await service.command(scope,approve);await service.command(scope,approve);assert.equal((await service.snapshot(scope)).guidelines.length,1);assert.equal(approved.snapshot.analyses[0].observations[0].decision,'approved');
  const manifest=service.context(scope,{referenceIds:[ref.id],executionId:'execution-1'});assert.equal(manifest.guidelines.length,1);assert.equal(manifest.references[0].observations[0].frameIds.length>0,true);assert.ok(manifest.text.length<24000);
  const evidence=await service.mediaFile(scope,'frame',analysis.id,analysis.frames[0].id);assert.ok((await readFile(evidence.path)).length>100);
  await assert.rejects(service.mediaFile({...scope,workspaceId:'other'},'frame',analysis.id,analysis.frames[0].id),/not found/);
 }finally{await service.close();db.close();await rm(directory,{recursive:true,force:true});}
});
test('HTTP routes enforce profile scope and real Range streaming; arbitrary path import is unavailable',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'refs-http-'));const bridge=createContentWorkflowBridge({dbPath:join(directory,'state.sqlite'),getCurrentProfile:()=>scope.profile});const server=createServer((req,res)=>void bridge.handle(req,res,new URL(req.url,'http://localhost')));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/api/content/editing-references`;
 try{
  const created=await fetch(`${base}?profile=p&workspaceId=w`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'folder.create',name:'Motion'})});assert.equal(created.status,200);assert.equal((await created.json()).snapshot.folders.length,1);
  const wrong=await fetch(`${base}?profile=other&workspaceId=w`);assert.equal(wrong.status,409);
  const arbitrary=await fetch(`${base}?profile=p&workspaceId=w`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'reference.import',path:'C:/Windows/private.mp4'})});assert.equal(arbitrary.status,400);
  const file=join(directory,'source.mp4');await runMediaProcess('ffmpeg',['-v','error','-f','lavfi','-i','color=blue:size=320x180:rate=12','-t','1','-c:v','libx264',file]);const imported=await bridge.editingReferences.importVideos(scope,[file]),r=imported.snapshot.references[0];
  const media=`${base}/media/reference/${r.id}/${r.currentVersionId}?profile=p&workspaceId=w`;const range=await fetch(media,{headers:{range:'bytes=0-99'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,100);const escaped=await fetch(media.replace('workspaceId=w','workspaceId=elsewhere'));assert.equal(escaped.status,404);
 }finally{await new Promise(r=>server.close(r));await bridge.close();await rm(directory,{recursive:true,force:true});}
});
test('REAL study render -> reviewable artifacts -> approved kit -> registered silent production asset',{skip:!process.env.MAINSAGENTS_HYPERFRAMES_HOME},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'refs-hf-')),db=new DatabaseSync(join(directory,'state.sqlite'));db.exec('CREATE TABLE editorial_state(profile_id TEXT PRIMARY KEY,revision INTEGER,state_json TEXT,updated_at TEXT)');const service=createEditingReferences(db,{directory:join(directory,'managed'),engine:createHyperframesEngine({root:process.env.MAINSAGENTS_HYPERFRAMES_HOME})});
 try{
  service.store.transaction(scope,(_d,s)=>{s.contents.push({id:'content',workspaceId:'w',assetIds:[]});});
  const spec={title:'Tech',text:'Input | Output',kind:'diagram',accent:'#22bbaa',background:'#121820',duration:2,width:640,height:360,fps:24};const created=await service.command(scope,{type:'study.create',title:'Motion',spec});const studyId=created.entityId;await service.command(scope,{type:'study.render',id:studyId,expectedRevision:1});
  const rendered=await waitFor(async()=>{const s=await service.snapshot(scope),study=s.studies[0];if(study.status==='failed')throw Error(study.error);return study.status==='completed'?study:null;});assert.ok(rendered.artifacts.find(a=>a.kind==='video'));const video=await service.mediaFile(scope,'study',studyId,rendered.artifacts.find(a=>a.kind==='video').id);assert.ok(video.size>1000);
  const approved=await service.command(scope,{type:'kit.approve',studyId,expectedRevision:1,name:'Tech motion'});await service.command(scope,{type:'project.attach',contentId:'content',referenceIds:[],kitIds:[approved.entityId],expectedRevision:0});assert.equal(service.projectContext(scope,'content','execution').kit[0].studyRevision,1);
  const asset=await service.attachStudy(scope,{contentId:'content',studyId,revision:1});assert.equal(asset.kind,'video');assert.equal(service.store.read(scope).state.assets[0].versions[0].sha256,video.sha);
  await service.command(scope,{type:'study.update',id:studyId,expectedRevision:1,spec:{...spec,title:'New revision'}});assert.equal(service.projectContext(scope,'content','execution2').kit[0].spec.title,'Tech');assert.ok((await service.mediaFile(scope,'study',studyId,rendered.artifacts.find(a=>a.kind==='video').id)).size>0);
 }finally{await service.close();db.close();await rm(directory,{recursive:true,force:true});}
});
