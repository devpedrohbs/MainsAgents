import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir,rename,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {inspectLocalAsset} from './editorial-local-files.mjs';
import {artifactHash} from './editorial-jobs.mjs';

const stamp=()=>new Date().toISOString();
const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){return error.code==='EPERM';}};
export function runMediaProcess(binary,args,{signal,onProgress,timeoutMs=120000}={}){
  return new Promise((resolve,reject)=>{
    let child,stdout='',stderr='',finished=false;
    const finish=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
    const abort=()=>{child?.kill();};
    const timer=setTimeout(()=>{child?.kill();finish(new Error('Media operation exceeded its time limit.'));},timeoutMs);timer.unref?.();
    if(signal?.aborted){finish(new Error('Media operation canceled.'));return;}
    try{child=spawn(binary,args,{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});}catch(error){finish(error);return;}
    signal?.addEventListener('abort',abort,{once:true});
    child.stdout.on('data',data=>{stdout+=data.toString();if(stdout.length>1000000){child.kill();finish(new Error('Media output exceeded its limit.'));}else onProgress?.(stdout);});
    child.stderr.on('data',data=>{stderr=(stderr+data.toString()).slice(-16000)});
    child.on('error',error=>finish(new Error(`${binary} unavailable: ${error.message}`)));
    child.on('close',code=>finish(signal?.aborted?new Error('Media operation canceled.'):code!==0?new Error(`Media process failed (${code}): ${stderr.slice(-1500)}`):null,stdout));
  });
}
export async function probeVideo(path,{signal,ffprobe='ffprobe',run=runMediaProcess}={}){
  const raw=await run(ffprobe,['-v','error','-protocol_whitelist','file,pipe','-show_format','-show_streams','-of','json',path],{signal});
  const data=JSON.parse(raw),video=data.streams?.find(item=>item.codec_type==='video'),audio=data.streams?.find(item=>item.codec_type==='audio');
  const duration=Number(data.format?.duration??video?.duration);
  if(!video||!Number.isFinite(duration)||duration<=0||!Number.isInteger(video.width)||!Number.isInteger(video.height))throw new Error('This file has no readable video stream.');
  return {duration,width:video.width,height:video.height,hasAudio:Boolean(audio),videoCodec:video.codec_name,audioCodec:audio?.codec_name};
}

/** Bounded local exports. No shell, UI control, arbitrary arguments or original-file overwrite. */
export function createEditorialMedia(db,{directory,getCurrentProfile,inspect=inspectLocalAsset,ffmpeg='ffmpeg',ffprobe='ffprobe',run=runMediaProcess}={}){
  db.exec('CREATE TABLE IF NOT EXISTS editorial_media_jobs (id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,status TEXT NOT NULL,data_json TEXT NOT NULL,updated_at TEXT NOT NULL)');
  let closed=false;const active=new Map();
  const state=profile=>{const row=db.prepare('SELECT revision,state_json FROM editorial_state WHERE profile_id=?').get(profile);return row?{revision:row.revision,state:JSON.parse(row.state_json)}:null;};
  const read=(profile,id)=>{const row=db.prepare('SELECT data_json FROM editorial_media_jobs WHERE profile_id=? AND id=?').get(profile,id);return row?JSON.parse(row.data_json):null;};
  const put=job=>db.prepare('UPDATE editorial_media_jobs SET status=?,data_json=?,updated_at=? WHERE id=? AND profile_id=?').run(job.status,JSON.stringify(job),stamp(),job.id,job.profileId);
  for(const row of db.prepare("SELECT data_json FROM editorial_media_jobs WHERE status IN ('queued','running')").all()){
    const job=JSON.parse(row.data_json);if(job.ownerPid&&alive(job.ownerPid))continue;
    job.status='interrupted';job.error='The app closed during export. Verify and resume explicitly.';put(job);
  }
  const authorize=job=>{
    if(closed||getCurrentProfile&&getCurrentProfile()!==job.profileId)throw new Error('The active profile changed or the executor stopped.');
    const current=state(job.profileId),content=current?.state.contents.find(item=>item.id===job.contentId&&item.workspaceId===job.workspaceId);
    const asset=current?.state.assets?.find(item=>item.id===job.assetId&&item.contentId===content?.id&&item.workspaceId===job.workspaceId),version=asset?.versions.find(item=>item.id===asset.currentVersionId);
    if(!content||asset?.kind!=='video'||version?.id!==job.versionId||version.sha256!==job.sha256||version.path!==job.inputPath)throw new Error('The source video version changed. Review a new export.');
    return current;
  };
  const source=async job=>{authorize(job);const input=await inspect(job.inputPath);authorize(job);if(input.status!=='available'||input.sha256!==job.sha256)throw new Error('The source video changed or is unavailable. Verify its current version.');return input;};
  const finish=async job=>{
    const result=await inspect(job.outputPath);if(result.status!=='available'||result.kind!=='video')throw new Error(result.error||'The export did not produce a real video file.');
    const metadata=await probeVideo(job.outputPath,{ffprobe,run});
    if(Math.abs(metadata.duration-job.duration)>0.4||job.inputMetadata.hasAudio&&!metadata.hasAudio)throw new Error('The exported video duration or audio differs from the approved operation.');
    if(job.result?.file?.sha256&&job.result.file.sha256!==result.sha256)throw new Error('The exported file changed after verification.');
    authorize(job);if(read(job.profileId,job.id)?.status==='canceled')throw new Error('Export canceled.');
    job.result={file:result,metadata};job.phase='verified';put(job);
    db.exec('BEGIN IMMEDIATE');
    try{
      const current=authorize(job),content=current.state.contents.find(item=>item.id===job.contentId);
      current.state.assets??=[];
      let output=current.state.assets.find(item=>item.mediaJobId===job.id);
      if(!output){const at=stamp(),version={id:randomUUID(),path:result.path,name:result.name,size:result.size,sha256:result.sha256,modifiedAt:result.modifiedAt,createdAt:at};
        output={id:`asset-${randomUUID()}`,contentId:job.contentId,workspaceId:job.workspaceId,role:'output',kind:'video',name:result.name,sourceAssetId:job.assetId,mediaJobId:job.id,versions:[version],currentVersionId:version.id,status:'available',checkedAt:result.checkedAt,createdAt:at,updatedAt:at};current.state.assets.push(output);
      }
      content.assetIds=current.state.assets.filter(item=>item.contentId===job.contentId).map(item=>item.id);content.productionStage='video-review';content.updatedAt=stamp();
      current.state.artifacts??=[];
      if(!current.state.artifacts.some(item=>item.mediaJobId===job.id))current.state.artifacts.unshift({id:`artifact-${randomUUID()}`,mediaJobId:job.id,workspaceId:job.workspaceId,topicId:content.topicId,contentId:content.id,type:'specialist-result',version:current.state.artifacts.filter(item=>item.contentId===content.id&&item.type==='specialist-result').length+1,data:{summary:`Local video export: ${job.start}s to ${job.start+job.duration}s.`,outputFiles:[result],blockers:[]},createdAt:stamp()});
      db.prepare('UPDATE editorial_state SET revision=?,state_json=?,updated_at=? WHERE profile_id=?').run(current.revision+1,JSON.stringify(current.state),stamp(),job.profileId);
      job.status='succeeded';job.progress=100;job.result.assetId=output.id;job.updatedAt=stamp();job.error=undefined;put(job);db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
  };
  const launch=job=>{
    const controller=new AbortController();const promise=(async()=>{
      try{
        job.status='running';job.ownerPid=process.pid;job.updatedAt=stamp();put(job);await source(job);
        if(['exported','verified'].includes(job.phase)){await finish(job);return;}
        job.inputMetadata=await probeVideo(job.inputPath,{ffprobe,run,signal:controller.signal});
        if(job.start+job.duration>job.inputMetadata.duration+0.05)throw new Error('The selected interval exceeds the source video duration.');
        await mkdir(job.outputDirectory,{recursive:true});
        // Every attempt has a new file name; -n refuses any existing target.
        const part=join(job.outputDirectory,`attempt-${job.attempt}.partial.mp4`);job.outputPath=join(job.outputDirectory,`export-${job.attempt}.mp4`);job.phase='encoding';put(job);
        let lastUpdate=0;
        const filters=[job.edit?.format==='portrait'?'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920':'scale=trunc(iw/2)*2:trunc(ih/2)*2'];
        if(job.edit?.fadeSeconds)filters.push(`fade=t=in:st=0:d=${job.edit.fadeSeconds}`,`fade=t=out:st=${Math.max(0,job.duration-job.edit.fadeSeconds)}:d=${job.edit.fadeSeconds}`);
        const audio=job.edit?.normalizeAudio&&job.inputMetadata.hasAudio?['-af','loudnorm=I=-16:TP=-1.5:LRA=11']:[];
        await run(ffmpeg,['-nostdin','-hide_banner','-v','error','-n','-protocol_whitelist','file,pipe','-ss',String(job.start),'-i',job.inputPath,'-t',String(job.duration),'-map','0:v:0','-map','0:a:0?','-vf',filters.join(','),...audio,'-c:v','libx264','-preset','veryfast','-crf','22','-c:a','aac','-movflags','+faststart','-progress','pipe:1','-nostats',part],{signal:controller.signal,timeoutMs:1800000,onProgress:output=>{
          if(closed||controller.signal.aborted||Date.now()-lastUpdate<500)return;const matches=[...output.matchAll(/out_time_us=(\d+)/g)];if(matches.length){job.progress=Math.min(99,Number(matches.at(-1)[1])/1000000/job.duration*100);lastUpdate=Date.now();put(job);}
        }});
        if(controller.signal.aborted||closed||read(job.profileId,job.id)?.status!=='running')throw new Error('Export was interrupted.');
        await source(job);await rename(part,job.outputPath);job.phase='exported';put(job);await finish(job);
      }catch(error){if(!closed){const current=read(job.profileId,job.id);if(current?.status!=='canceled'){job.status='failed';job.error=error.message;job.updatedAt=stamp();put(job);}}}
    })().finally(()=>active.delete(job.id));active.set(job.id,{controller,promise});
  };
  return {
    async capabilities(){const result={available:false,ffmpeg:false,ffprobe:false,error:''};try{await run(ffmpeg,['-version']);result.ffmpeg=true;await run(ffprobe,['-version']);result.ffprobe=true;result.available=true;}catch(error){result.error=error.message;}return result;},
    async inspect(profile,{contentId,assetId}){
      const current=state(profile),asset=current?.state.assets?.find(item=>item.id===assetId&&item.contentId===contentId),version=asset?.versions.find(item=>item.id===asset.currentVersionId),content=current?.state.contents.find(item=>item.id===contentId);
      if(!asset||!version||asset.kind!=='video'||!content)throw new Error('Choose a linked video from this content.');
      const job={profileId:profile,workspaceId:content.workspaceId,contentId,assetId,versionId:version.id,sha256:version.sha256,inputPath:version.path};await source(job);const metadata=await probeVideo(version.path,{ffprobe,run});authorize(job);return {metadata,versionId:version.id,sha256:version.sha256};
    },
    enqueue(profile,input){
      if(closed)throw new Error('Media executor is stopping.');
      if(typeof input.requestKey!=='string'||!input.requestKey||input.requestKey.length>120||!Number.isFinite(input.start)||input.start<0||!Number.isFinite(input.duration)||input.duration<0.1||input.duration>3600)throw new Error('Choose an interval between 0.1 seconds and one hour.');
      if(input.edit&&(!['original','portrait'].includes(input.edit.format)||typeof input.edit.normalizeAudio!=='boolean'||!Number.isFinite(input.edit.fadeSeconds)||input.edit.fadeSeconds<0||input.edit.fadeSeconds>.8||input.edit.fadeSeconds*2>input.duration))throw new Error('Invalid basic editing options.');
      const hash=artifactHash({contentId:input.contentId,assetId:input.assetId,versionId:input.versionId,sha256:input.sha256,start:input.start,duration:input.duration,...(input.edit?{edit:input.edit}:{})});
      const prior=db.prepare('SELECT data_json FROM editorial_media_jobs WHERE profile_id=?').all(profile).map(row=>JSON.parse(row.data_json)).find(job=>job.requestKey===input.requestKey);
      if(prior){if(prior.requestHash!==hash)throw new Error('This request was already used for a different export.');return {...state(profile),job:prior};}
      if(db.prepare("SELECT id FROM editorial_media_jobs WHERE status IN ('queued','running')").get())throw new Error('Wait for the current video export or cancel it first.');
      const current=state(profile),asset=current?.state.assets?.find(item=>item.id===input.assetId&&item.contentId===input.contentId),version=asset?.versions.find(item=>item.id===asset.currentVersionId);
      if(current?.revision!==input.revision||!asset||version?.id!==input.versionId||version.sha256!==input.sha256)throw new Error('The reviewed source version changed. Inspect it again.');
      const id=`media-${randomUUID()}`,at=stamp(),job={id,profileId:profile,workspaceId:asset.workspaceId,contentId:asset.contentId,assetId:asset.id,versionId:version.id,sha256:version.sha256,inputPath:version.path,start:input.start,duration:input.duration,requestKey:input.requestKey,requestHash:hash,status:'queued',phase:'queued',progress:0,attempt:1,outputDirectory:join(directory,profile,id),createdAt:at,updatedAt:at,ownerPid:process.pid};
      if(input.edit)job.edit=structuredClone(input.edit);
      authorize(job);db.prepare('INSERT INTO editorial_media_jobs VALUES (?,?,?,?,?)').run(id,profile,job.status,JSON.stringify(job),at);launch(job);return {...current,job};
    },
    list(profile){return db.prepare('SELECT data_json FROM editorial_media_jobs WHERE profile_id=? ORDER BY updated_at DESC').all(profile).map(row=>JSON.parse(row.data_json));},
    async cancel(profile,id){const job=read(profile,id);if(!job||!['queued','running'].includes(job.status))throw new Error('This export is not active.');const running=active.get(id);if(!running)throw new Error('This export belongs to another executor.');job.status='canceled';job.error='Canceled by the user. Partial output is not a delivery.';job.updatedAt=stamp();put(job);running.controller.abort();await running.promise;return state(profile);},
    async retry(profile,id){const job=read(profile,id);if(!job||!['failed','interrupted'].includes(job.status)||active.size)throw new Error('This export cannot resume now.');if(job.imported)throw new Error('Imported history does not authorize execution. Review a new local export.');if(db.prepare("SELECT id FROM editorial_media_jobs WHERE status IN ('queued','running')").get())throw new Error('Another export is active.');await source(job);if(job.attempt>=3)throw new Error('Three attempts reached. Review a new export.');
      if(['exported','verified'].includes(job.phase)){await stat(job.outputPath);await finish(job);return state(profile);}
      job.attempt++;job.progress=0;job.phase='queued';job.status='queued';job.error=undefined;job.ownerPid=process.pid;put(job);launch(job);return state(profile);
    },
    async close(){if(closed)return;for(const id of active.keys()){const job=db.prepare('SELECT data_json FROM editorial_media_jobs WHERE id=?').get(id);if(job){const value=JSON.parse(job.data_json);if(value.status==='running'){value.status='interrupted';value.error='App closed during export. Resume explicitly.';put(value);}}}closed=true;for(const running of active.values())running.controller.abort();await Promise.allSettled([...active.values()].map(item=>item.promise));},
  };
}
