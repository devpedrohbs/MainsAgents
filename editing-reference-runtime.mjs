import {mkdir,stat,readFile,realpath} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {join,extname,resolve,relative} from 'node:path';
import {createReferenceStore,at,id,failure,scopeKey} from './editing-reference-store.mjs';
import {createHyperframesEngine,digest,safeFile} from './hyperframes-engine.mjs';
import {probeVideo,runMediaProcess} from './editorial-media.mjs';
import {hashFile} from './editor-authoring.mjs';
import {analyzeReferenceFrames} from './editing-reference-analysis.mjs';
import {createKnowledgeManifest} from './editing-knowledge-context.mjs';

const activeStatus=v=>['queued','running'].includes(v);
const sourceName='source.video';
const emptySources=s=>{s.inspiration??={schemaVersion:1,references:[]};return s.inspiration.references;};
export function createEditingReferences(db,{directory,getCurrentProfile,getAgents,getChatRuntime,getRuntime,getProviderStatus,engine=createHyperframesEngine(),ffmpeg='ffmpeg',ffprobe='ffprobe',analyze=analyzeReferenceFrames}={}){
 const store=createReferenceStore(db,{getCurrentProfile}),active=new Map(),requests=new Map(),reviewedStudies=new Set();let closed=false;
 const slug=value=>digest(value).slice(0,24);
 const root=scope=>join(directory,scopeKey(scope).slice(0,32));
 const refDir=(scope,r,v)=>join(root(scope),'references',slug(r),slug(v));
 const studyDir=(scope,study,revision,job)=>join(root(scope),'studies',slug(study),String(revision),slug(job));
 const managedFile=async(scope,path)=>{
  scopeKey(scope);const base=await realpath(directory),expected=resolve(base,relative(directory,path)),actual=await safeFile(directory,relative(directory,path));
  const normalize=value=>process.platform==='win32'?value.toLowerCase():value;
  if(normalize(expected)!==normalize(actual))failure('unsafe_path','Managed media cannot traverse symbolic links',403);return actual;
 };
 const runtimeFor=agent=>agent.providerId==='claude'?getChatRuntime?.('claude'):getRuntime?.();
 const visual=agent=>{const r=runtimeFor(agent);return typeof r?.openEditorSession==='function'||(typeof r?.sendVisual==='function'&&typeof r?.createSession==='function');};
 function recover(scope){const value=store.read(scope);const abandoned=value.data.jobs.filter(j=>activeStatus(j.status)&&!active.has(j.id));if(abandoned.length)store.transaction(scope,d=>{for(const job of d.jobs)if(abandoned.some(j=>j.id===job.id)){job.status='interrupted';job.error='The app stopped. Explicitly start a new attempt.';job.updatedAt=at();for(const target of [...d.analyses,...d.studies])if(target.id===job.targetId&&activeStatus(target.status)){target.status='interrupted';target.error=job.error;}}});}
 async function snapshot(scope){recover(scope);const {data:d,state,revision}=store.read(scope);const engineState=await engine.status(),engineJob=d.jobs.filter(j=>j.kind==='engine-prepare').at(-1);if(engineJob){engineState.jobId=engineJob.id;if(engineJob.status==='failed'&&engineState.status!=='ready'){engineState.status='error';engineState.message=engineJob.error;}}return {...scope,schemaVersion:1,revision,folders:d.folders,references:store.publicReferences(scope,d,state),analyses:d.analyses.map(({profileId:_profile,...a})=>a),profiles:d.profiles,guidelines:d.guidelines,studies:d.studies.map(({_artifactPaths,...s})=>s),kit:d.kit,jobs:d.jobs,projects:Object.entries(d.projectSelections).filter(([contentId])=>state.contents?.some(c=>c.id===contentId&&c.workspaceId===scope.workspaceId)).map(([contentId,selection])=>({contentId,...selection})),agents:(getAgents?.(scope.profile)??[]).filter(a=>a.workspaceId===scope.workspaceId).map(a=>({id:a.id,name:a.name,providerId:a.providerId??'codex',visual:visual(a),...(!visual(a)?{reason:'This connected runtime cannot deliver verified image inputs'}:{})})),engine:engineState};}
 const ensureOpen=()=>{if(closed)failure('closing','Reference service is closing',503);};
 function launch(scope,kind,targetId,operation,prepare){
  ensureOpen();const job={id:id(),kind,targetId,status:'running',phase:'Starting',createdAt:at(),updatedAt:at()},controller=new AbortController();
  active.set(job.id,{controller,scope,kind,targetId});
  try{store.transaction(scope,d=>{if(d.jobs.some(j=>j.targetId===targetId&&activeStatus(j.status)))failure('busy','This item already has an active operation',409);prepare?.(d,job);d.jobs.push(job);if(d.jobs.length>200)d.jobs=d.jobs.slice(-200);});}catch(error){active.delete(job.id);throw error;}
  const guard=()=>{ensureOpen();store.guard(scope);if(controller.signal.aborted)throw Error('Operation cancelled');};
  const progress=phase=>{guard();store.transaction(scope,d=>{const j=store.own(d.jobs,job.id);if(!activeStatus(j.status))throw Error('Operation no longer active');j.phase=phase;j.updatedAt=at();});};
  const promise=(async()=>{try{await operation({signal:controller.signal,guard,progress,job});guard();store.transaction(scope,d=>{const j=store.own(d.jobs,job.id);j.status='completed';j.phase='Completed';if(j.progress!==undefined)j.progress=100;j.updatedAt=at();});}catch(error){
    // A profile switch cancels work; finalize only that original profile's rows, without writing another profile.
    const saved=db.prepare('SELECT data_json FROM editing_reference_libraries WHERE profile_id=? AND workspace_id=?').get(scope.profile,scope.workspaceId);
    if(saved){const d=JSON.parse(saved.data_json),j=d.jobs.find(j=>j.id===job.id);if(j&&activeStatus(j.status)){j.status=controller.signal.aborted?'cancelled':'failed';j.error=String(error.message).slice(0,1200);j.updatedAt=at();for(const target of [...d.analyses,...d.studies])if(target.id===targetId&&activeStatus(target.status)){target.status=j.status;target.error=j.error;}db.prepare('UPDATE editing_reference_libraries SET revision=revision+1,data_json=? WHERE profile_id=? AND workspace_id=?').run(JSON.stringify(d),scope.profile,scope.workspaceId);}}
   }finally{active.delete(job.id);}})();
  active.get(job.id).promise=promise;return job.id;
 }
 async function versionSource(scope,referenceId,versionId){const {data,state}=store.read(scope),reference=store.reference(scope,state,referenceId),publicRef=store.publicReferences(scope,data,state).find(r=>r.id===referenceId),version=publicRef.versions.find(v=>v.id===versionId);if(!version||publicRef.currentVersionId!==versionId)failure('version_changed','Select the current reference version',409);let file;
  if(version.legacyAssetId){const asset=state.assets?.find(a=>a.id===version.legacyAssetId&&a.workspaceId===scope.workspaceId);file=asset?.versions?.find(v=>v.id===versionId)?.path;if(!file||/^\\\\|^https?:|^file:/i.test(file))failure('source_missing','Legacy reference file is unavailable',404);}else file=await managedFile(scope,join(refDir(scope,referenceId,versionId),sourceName));
  if(await hashFile(file)!==version.sha256)failure('source_changed','Reference file changed; import a new version',409);
  return {reference,version,file};
 }
 async function importVideos(scope,paths,{folderId=null,referenceId,expectedRevision,wait=true}={}){
  ensureOpen();store.guard(scope);const before=store.read(scope);store.folder(before.data,folderId);
  if(!Array.isArray(paths)||!paths.length||paths.length>5||referenceId&&paths.length!==1)failure('invalid_import','Choose one to five videos; a new version accepts one file');
  if(referenceId)store.expect(store.reference(scope,before.state,referenceId),expectedRevision);
  // Called ONLY by the trusted native picker IPC or host tests. No HTTP path import operation exists.
  let entityId,jobId;
  for(const source of paths){
   if(typeof source!=='string'||!resolve(source)||/^\\\\|^https?:|^file:/i.test(source)||!['.mp4','.mov','.m4v','.mkv','.webm','.avi'].includes(extname(source).toLowerCase()))failure('invalid_import','Use a local video file');
   const info=await stat(source);if(!info.isFile()||info.size>2*1024**3)failure('invalid_import','Video exceeds the 2 GB import limit');
   const rId=referenceId??id(),vId=id(),dir=refDir(scope,rId,vId),name=source.split(/[\\/]/).at(-1);entityId=rId;
   jobId=launch(scope,'import',rId,async({signal,guard,progress,job})=>{
    await mkdir(dir,{recursive:true});progress('Verifying selected video');const originalHash=await hashFile(source,signal);
    const input=createReadStream(source);let copied=0,last=0;input.on('data',chunk=>{copied+=chunk.length;if(Date.now()-last>300){last=Date.now();try{guard();store.transaction(scope,d=>{const j=store.own(d.jobs,job.id);j.phase='Copying managed video';j.progress=info.size?Math.min(99,Math.floor(copied/info.size*100)):0;j.updatedAt=at();});}catch(error){input.destroy(error);}}});
    await pipeline(input,createWriteStream(join(dir,sourceName),{flags:'wx'}),{signal});guard();progress('Inspecting managed video');
    if(await hashFile(join(dir,sourceName),signal)!==originalHash)failure('source_changed','Video changed during import; try again',409);
    const meta=await probeVideo(join(dir,sourceName),{ffprobe,signal});
    const version={id:vId,sha256:originalHash,name,size:info.size,duration:meta.duration,width:meta.display.width,height:meta.display.height,fps:meta.fps??null,createdAt:at()};
    // Originals remain untouched. Unsupported browser codecs get a local viewing proxy only.
    if(meta.videoCodec!=='h264'||extname(name).toLowerCase()!=='.mp4'){
     progress('Preparing browser preview');await runMediaProcess(ffmpeg,['-v','error','-nostdin','-protocol_whitelist','file,pipe','-i',join(dir,sourceName),'-map','0:v:0','-map','0:a?','-vf','scale=trunc(iw/2)*2:trunc(ih/2)*2','-c:v','libx264','-preset','veryfast','-crf','24','-c:a','aac','-movflags','+faststart',join(dir,'browser.mp4')],{signal,timeoutMs:600000});version.previewSha256=await hashFile(join(dir,'browser.mp4'),signal);
    }
    guard();store.transaction(scope,(d,s)=>{const r=store.reference(scope,s,rId),details=d.references[rId];if(details.versions.some(v=>v.sha256===originalHash))failure('duplicate_file','This reference already contains the selected file',409);details.versions.push(version);r.managedVideo={versionId:vId};r.updatedAt=at();if(referenceId)r.revision++;});
   },(d)=>{store.folder(d,folderId);if(referenceId)store.expect(store.reference(scope,store.read(scope).state,referenceId),expectedRevision);d.references[rId]??={folderId,markers:[],versions:[]};});
   // Canonical identity is present while the job runs; no fabricated video metadata is exposed.
   if(!referenceId)store.transaction(scope,(_d,s)=>{emptySources(s).push({...store.base(scope),id:rId,title:name,managedVideo:{versionId:vId}});});
   if(wait){await active.get(jobId)?.promise;const saved=store.own(store.read(scope).data.jobs,jobId);if(saved.status!=='completed')failure(saved.status,saved.error||'Import did not complete');}
  }
  return {entityId,jobId,snapshot:await snapshot(scope)};
 }
 async function performCommand(scope,c){ensureOpen();recover(scope);let result={};
  if(c.type==='job.cancel'){const value=store.read(scope),job=store.own(value.data.jobs,c.id);if(activeStatus(job.status)){active.get(job.id)?.controller.abort();store.transaction(scope,d=>{const j=store.own(d.jobs,job.id);j.status='cancelled';j.phase='Cancelled';j.updatedAt=at();for(const t of [...d.analyses,...d.studies])if(t.id===j.targetId&&activeStatus(t.status))t.status='cancelled';});}result.jobId=job.id;}
  else if(c.type==='engine.prepare'){
   if((await engine.status()).status==='ready')return {snapshot:await snapshot(scope)};
   if([...active.values()].some(value=>value.kind==='render'))failure('busy','Wait for active motion renders before preparing the engine',409);
   const jobId=launch(scope,'engine-prepare','engine',async({signal,progress})=>{await engine.prepare({signal,onProgress:progress});});result={jobId};
  }
  else if(c.type==='analysis.start'){
   const {reference,version,file}=await versionSource(scope,c.referenceId,c.versionId);store.expect(reference,c.expectedRevision);
   const agent=(getAgents?.(scope.profile)??[]).find(a=>a.id===c.agentId&&a.workspaceId===scope.workspaceId);if(!agent||!visual(agent))failure('vision_unavailable','Choose a connected agent capable of receiving real image inputs',422);
   const providerStatus=await getProviderStatus?.(agent.providerId??'codex');if(providerStatus&&providerStatus.state!=='connected')failure('login_required','Connect the selected provider before visual analysis',422);
   const metadata=version.duration?version:await probeVideo(file,{ffprobe});
   if(!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.start<0||c.end-c.start<.1||c.end>metadata.duration+.05||c.end-c.start>120||!['structure','motion'].includes(c.mode))failure('invalid_range','Choose a video interval between 0.1 and 120 seconds');
   const requested=c.mode==='motion'?Math.min(24,Math.max(6,Math.ceil((c.end-c.start)*4))):12;
   const count=Math.min(requested,runtimeFor(agent).visualInputLimit??24);
   const times=Array.from({length:count},(_,i)=>Number((c.start+(c.end-c.start-.04)*i/(count-1)).toFixed(3)));
   const a={id:id(),profileId:scope.profile,referenceId:reference.id,versionId:version.id,referenceRevision:reference.revision,providerId:agent.providerId??'codex',agentId:agent.id,status:'running',mode:c.mode,start:c.start,end:c.end,frames:[],coverage:{kind:'sampled',requested:[c.start,c.end],examined:[],pending:times},observations:[],limitations:[],createdAt:at(),updatedAt:at()};
   const jobId=launch(scope,'analysis',a.id,async({signal,guard,progress})=>{
    const dir=join(root(scope),'analyses',slug(a.id));await mkdir(dir,{recursive:true});const frames=[];
    for(let i=0;i<times.length;i++){guard();progress(`Extracting sample ${i+1}/${times.length}`);const frameId=id(),path=join(dir,`${slug(frameId)}.jpg`);await runMediaProcess(ffmpeg,['-v','error','-nostdin','-protocol_whitelist','file,pipe','-ss',String(times[i]),'-i',file,'-frames:v','1','-vf','scale=640:-2','-q:v','3',path],{signal});const bytes=await readFile(path);const frame={id:frameId,time:times[i],sha256:digest(bytes),width:640,height:Math.round(metadata.height*640/metadata.width/2)*2,path};frames.push(frame);store.transaction(scope,d=>{const row=store.own(d.analyses,a.id);row.frames=frames.map(({path:_path,...f})=>f);row.updatedAt=at();});}
    const boundGuard=()=>{guard();const current=store.read(scope);const r=store.reference(scope,current.state,reference.id);if(r.revision!==a.referenceRevision)throw Error('Reference changed during analysis');};
    progress('Inspecting visual samples with selected agent');
    const focus={notes:reference.notes,markers:store.read(scope).data.references[reference.id]?.markers??[]};
    const analyzed=await analyze({runtime:runtimeFor(agent),agent,analysis:a,version,frames,frameRoot:dir,focus,signal,guard:boundGuard,onExamined:keys=>{boundGuard();store.transaction(scope,d=>{const row=store.own(d.analyses,a.id);row.coverage.examined=frames.filter(f=>keys.includes(f.id)).map(f=>f.time);row.coverage.pending=frames.filter(f=>!keys.includes(f.id)).map(f=>f.time);});}});
    boundGuard();if(await hashFile(file,signal)!==version.sha256)failure('source_changed','Reference file changed during analysis',409);store.transaction(scope,d=>{const row=store.own(d.analyses,a.id);row.observations=analyzed.observations;row.limitations=analyzed.limitations;row.status=row.coverage.pending.length?'partial':'completed';row.updatedAt=at();});
   },d=>{if(d.analyses.filter(a=>activeStatus(a.status)).length>=2)failure('busy','At most two reference analyses can run together',409);d.analyses.push(a);});result={entityId:a.id,jobId};
  }
  else if(c.type==='study.render'){
   const value=store.read(scope),study=store.own(value.data.studies,c.id);store.expect(study,c.expectedRevision);if(study.status==='completed'&&study.versions?.some(v=>v.revision===study.revision))return {entityId:study.id,snapshot:await snapshot(scope)};
   if([...active.values()].filter(value=>value.kind==='render').length>=2)failure('busy','Two motion renders are already running; wait before starting another',409);
   if((await engine.status()).status!=='ready')failure('engine_unavailable','Prepare the local HyperFrames engine first',422);
   const frozen=structuredClone(study);const jobId=launch(scope,'render',study.id,async({signal,guard,progress,job})=>{
    const dir=studyDir(scope,study.id,frozen.revision,job.id);const report=await engine.render(dir,frozen.spec,{signal,onProgress:progress});guard();
    await runMediaProcess(ffmpeg,['-v','error','-nostdin','-i',join(dir,'preview.mp4'),'-ss',String(Math.min(.8,frozen.spec.duration/2)),'-frames:v','1',join(dir,'frame.jpg')],{signal});
    const artifacts=[];for(const [name,kind] of [['preview.mp4','video'],['frame.jpg','frame'],['report.json','report'],['index.html','project'],['spec.json','project']]){const bytes=await readFile(join(dir,name));artifacts.push({id:id(),kind,name,sha256:digest(bytes),size:bytes.length});}
    store.transaction(scope,d=>{const s=store.own(d.studies,study.id);store.expect(s,frozen.revision);if(!activeStatus(s.status))throw Error('Render was cancelled');s.status='completed';s.artifacts=artifacts;s.versions??=[];s.versions.push({revision:frozen.revision,spec:frozen.spec,artifacts,createdAt:at(),jobId:job.id});s.updatedAt=at();delete s.error;});
   },d=>{const s=store.own(d.studies,study.id);store.expect(s,frozen.revision);s.status='running';s.updatedAt=at();});store.transaction(scope,d=>{store.own(d.studies,study.id).jobId=jobId;});result={entityId:study.id,jobId};
  }
  else result=store.command(scope,c);
  return {...result,snapshot:await snapshot(scope)};
 }
 async function command(scope,c){
  if(!c||typeof c.type!=='string')failure('invalid_input','Missing reference command');
  if(!c.requestKey)return performCommand(scope,c);
  if(typeof c.requestKey!=='string'||c.requestKey.length>120)failure('invalid_input','Invalid request key');
  const key=`${scopeKey(scope)}:${c.requestKey}`,signature=digest(JSON.stringify(c));
  const previous=store.read(scope).data.requests?.find(r=>r.key===c.requestKey);
  if(previous){if(previous.signature!==signature)failure('request_conflict','Request key reused for a different command',409);return {...previous.result,snapshot:await snapshot(scope)};}
  const pending=requests.get(key);if(pending){if(pending.signature!==signature)failure('request_conflict','Request key reused',409);return pending.promise;}
  const promise=(async()=>{const result=await performCommand(scope,c);const {snapshot:_snapshot,...ids}=result;const value=store.read(scope);value.data.requests??=[];value.data.requests.push({key:c.requestKey,signature,result:ids});value.data.requests=value.data.requests.slice(-100);db.prepare('UPDATE editing_reference_libraries SET data_json=? WHERE profile_id=? AND workspace_id=? AND revision=?').run(JSON.stringify(value.data),scope.profile,scope.workspaceId,value.revision);return {...ids,snapshot:await snapshot(scope)};})();requests.set(key,{signature,promise});try{return await promise;}finally{requests.delete(key);}
 }
 function context(scope,selection={}){return store.transaction(scope,(d,s)=>{const manifest=createKnowledgeManifest(scope,d,store.publicReferences(scope,d,s),selection);d.manifests.push({...manifest,executionId:selection.executionId});d.manifests=d.manifests.slice(-60);return manifest;});}
 function projectContext(scope,contentId,executionId){const {data}=store.read(scope);return context(scope,{...(data.projectSelections[contentId]??{}),executionId});}
 async function attachStudy(scope,{studyId,revision,contentId}){
  const value=store.read(scope),study=store.own(value.data.studies,studyId),version=study.versions?.find(v=>v.revision===revision),video=version?.artifacts.find(a=>a.kind==='video');if(!video)failure('not_rendered','The requested study revision has no verified video');
  const file=await mediaFile(scope,'study',study.id,video.id);const assetId=`motion-${digest(`${contentId}/${study.id}/${revision}`).slice(0,24)}`;
  return store.transaction(scope,(_d,s)=>{const content=s.contents?.find(c=>c.id===contentId&&c.workspaceId===scope.workspaceId);if(!content)failure('not_found','Content not found in this workspace',404);s.assets??=[];let asset=s.assets.find(a=>a.id===assetId);if(!asset){const versionId=id();asset={id:assetId,contentId,workspaceId:scope.workspaceId,name:`${study.title} r${revision}`,role:'reference',kind:'video',status:'available',createdAt:at(),updatedAt:at(),currentVersionId:versionId,versions:[{id:versionId,path:file.path,name:`${study.title}.mp4`,size:file.size,sha256:file.sha,modifiedAt:at(),createdAt:at()}]};s.assets.push(asset);content.assetIds=[...new Set([...(content.assetIds??[]),asset.id])];}
   return {id:assetId,kind:'video',sha256:file.sha,role:'diagram',label:asset.name,studyId:study.id,revision};
  });
 }
 async function agentStudy(scope,contentId,executionId,args){
  const op=args.operation;
  if(op==='create'){const result=await command(scope,{type:'study.create',title:args.title,referenceId:args.referenceId,spec:args.spec});store.transaction(scope,d=>{store.own(d.studies,result.entityId).ownerExecutionId=executionId;});return {study:result.snapshot.studies.find(s=>s.id===result.entityId)};}
  const study=store.own(store.read(scope).data.studies,args.studyId);
  if(['update','render'].includes(op)&&study.ownerExecutionId!==executionId)failure('unbound_study','Only studies created in this execution may be modified by this agent',403);
  if(op==='update'||op==='render'){const result=await command(scope,op==='update'?{type:'study.update',id:study.id,expectedRevision:args.expectedRevision,spec:args.spec}:{type:'study.render',id:study.id,expectedRevision:args.expectedRevision});return {study:result.snapshot.studies.find(s=>s.id===study.id),...(result.jobId?{job:result.snapshot.jobs.find(j=>j.id===result.jobId)}:{})};}
  if(op==='status')return {study};
  if(op==='frames'){
   const version=study.versions?.find(v=>v.revision===args.expectedRevision),frame=version?.artifacts.find(a=>a.kind==='frame');if(!frame)failure('not_rendered','Render the study before inspecting its frame');const file=await mediaFile(scope,'study',study.id,frame.id);reviewedStudies.add(`${scopeKey(scope)}:${executionId}:${study.id}:${version.revision}`);return {_motionFrames:[{bytes:await readFile(file.path),mimeType:'image/jpeg'}],studyId:study.id,revision:version.revision};
  }
  if(op==='attach'){
   const approved=store.read(scope).data.kit.some(k=>k.studyId===study.id&&k.studyRevision===args.expectedRevision);
   if(!approved&&!reviewedStudies.has(`${scopeKey(scope)}:${executionId}:${study.id}:${args.expectedRevision}`))failure('review_required','Inspect the real study frames or use an approved kit revision before attaching');
   return {asset:await attachStudy(scope,{studyId:study.id,revision:args.expectedRevision,contentId})};
  }
  failure('unknown_operation','Unknown motion study operation');
 }
 async function mediaFile(scope,kind,first,second){store.guard(scope);const {data,state}=store.read(scope);let path,type,sha,name;
  if(kind==='reference'){const r=store.reference(scope,state,first),ref=store.publicReferences(scope,data,state).find(x=>x.id===r.id),v=ref.versions.find(v=>v.id===second);if(!v)failure('not_found','Video version not found',404);if(v.legacyAssetId){const asset=state.assets?.find(a=>a.id===v.legacyAssetId&&a.workspaceId===scope.workspaceId);path=asset?.versions?.find(v=>v.id===second)?.path;}else path=await managedFile(scope,join(refDir(scope,first,second),v.previewSha256?'browser.mp4':sourceName));sha=v.previewSha256??v.sha256;type=v.previewSha256?'video/mp4':v.name?.toLowerCase().endsWith('.webm')?'video/webm':v.name?.toLowerCase().endsWith('.mov')?'video/quicktime':'video/mp4';name=v.name;}
  else if(kind==='frame'){const a=store.own(data.analyses,first),f=store.own(a.frames,second);path=await managedFile(scope,join(root(scope),'analyses',slug(a.id),`${slug(f.id)}.jpg`));sha=f.sha256;type='image/jpeg';name='frame.jpg';}
  else if(kind==='study'){const s=store.own(data.studies,first),v=s.versions?.find(v=>v.artifacts.some(a=>a.id===second)),a=v?.artifacts.find(a=>a.id===second);if(!a)failure('not_found','Study artifact not found',404);if(!['preview.mp4','frame.jpg','report.json','index.html','spec.json'].includes(a.name))failure('invalid_artifact','Unknown artifact');path=await managedFile(scope,join(studyDir(scope,s.id,v.revision,v.jobId),a.name));sha=a.sha256;type=a.kind==='video'?'video/mp4':a.kind==='frame'?'image/jpeg':'application/octet-stream';name=a.name;}
  else failure('not_found','Media not found',404);
  if(!path||await hashFile(path)!==sha)failure('artifact_changed','File unavailable or changed',409);return {path,type,name,sha,size:(await stat(path)).size};
 }
 return {store,snapshot,command,importVideos,context,projectContext,mediaFile,engine,agentStudy,attachStudy,
  async stream(scope,kind,first,second,request,response){const file=await mediaFile(scope,kind,first,second);let start=0,end=file.size-1;const range=request.headers.range;if(range){const m=range.match(/^bytes=(\d+)-(\d*)$/);if(!m||Number(m[1])>=file.size){response.writeHead(416,{'content-range':`bytes */${file.size}`});response.end();return;}start=Number(m[1]);end=m[2]?Math.min(Number(m[2]),end):end;if(end<start)failure('invalid_range','Invalid byte range',416);}
   response.writeHead(range?206:200,{'content-type':file.type,'content-length':end-start+1,'accept-ranges':'bytes','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox",...(file.type==='application/octet-stream'?{'content-disposition':`attachment; filename="${file.name}"`}:{}),...(range?{'content-range':`bytes ${start}-${end}/${file.size}`}:{})});if(request.method==='HEAD'){response.end();return;}const source=createReadStream(file.path,{start,end});source.on('error',()=>response.destroy());response.on('close',()=>source.destroy());source.pipe(response);
  },
  async close(){closed=true;for(const value of active.values())value.controller.abort();await Promise.allSettled([...active.values()].map(v=>v.promise));},
 };
}
