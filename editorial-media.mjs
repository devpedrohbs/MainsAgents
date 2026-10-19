import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,readFile,readdir,rename,stat,unlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {inspectLocalAsset} from './editorial-local-files.mjs';
import {alignWordsToVoice,buildMotionPlan,describeMotion,extractVoicePcm,motionIntensities,normalizeMotion,safeMotionText,sfxBedWav,verifyExplainersAgainstTranscript,sfxMixFilter,transcriptWords,voiceTrack,wordProsody} from './editorial-motion-plan.mjs';
import {resolveAnimations} from './editorial-remotion.mjs';
import {assessAudio,assertMeasuredNoiseFloor} from './editorial-audio-cleanup.mjs';
import {refineSilenceCandidates,snapRemoval,speechEditCandidates,speechWords} from './editorial-speech-edit.mjs';
import {artifactHash} from './editorial-jobs.mjs';
import {measureOffset} from './source-sync.mjs';
import {mapScreenSegments,screenCutFilter,screenTrackSize,voiceCoverageProblem,pairHash,defaultScreenMode,shiftTranscript,overlapOf,pairVoices,pairLayouts} from './source-pairs.mjs';
import {needsAnimation,cutReview,remapTranscript,toSrt,remotionAnimations,assertAnalyzable,cutFilter,keptSegments,parseSilences,planHash,removedSegments,retakeCandidates,silenceCandidates,silenceDetectArgs,silenceOptions,smartEditLimits,validatePlan,validateTranscript} from './editorial-smart-edit.mjs';

const stamp=()=>new Date().toISOString();
const hashFile=path=>new Promise((resolve,reject)=>{const hash=createHash('sha256');createReadStream(path).on('data',chunk=>hash.update(chunk)).on('error',reject).on('end',()=>resolve(hash.digest('hex')));});
const outputTimelineOf=segments=>{let cursor=0;return segments.map(item=>{const value={start:item.start,end:item.end,outputStart:Math.round(cursor*1000)/1000};cursor+=item.end-item.start;return value;});};
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
  // Decoded orientation: FFmpeg auto-rotates, so a ±90° display matrix swaps the picture size the filters see.
  const rotation=Number(video.side_data_list?.find(item=>Number.isFinite(Number(item?.rotation)))?.rotation??video.tags?.rotate??0),turned=Math.abs(Math.round(rotation/90))%2===1;
  const [num,den]=String(video.avg_frame_rate&&video.avg_frame_rate!=='0/0'?video.avg_frame_rate:video.r_frame_rate??'').split('/').map(Number),fps=den?num/den:num;
  return {duration,width:video.width,height:video.height,...(Number.isFinite(fps)&&fps>0?{fps:Math.round(fps*1000)/1000}:{}),hasAudio:Boolean(audio),videoCodec:video.codec_name,audioCodec:audio?.codec_name,display:{width:turned?video.height:video.width,height:turned?video.width:video.height},...(video.time_base?{videoTimeBase:video.time_base,videoStart:Number(video.start_time??0)}:{}),...(audio?{audioChannels:Number(audio.channels),audioSampleRate:Number(audio.sample_rate),...(audio.time_base?{audioTimeBase:audio.time_base,audioStart:Number(audio.start_time??0)}:{})}:{})};
}

const sha=value=>createHash('sha256').update(value).digest('hex');
/** Edited output size of a plan, as the export will produce it (portrait crop, or the even-sized source turned like the decoded proxy). */
export function editedSize(plan,source,proxy){
  if(plan.format==='portrait')return {width:1080,height:1920};
  const turned=proxy&&proxy.width!==proxy.height&&(proxy.width>proxy.height)!==(source.width>source.height);
  const width=Math.floor((turned?source.height:source.width)/2)*2,height=Math.floor((turned?source.width:source.height)/2)*2;return {width,height};
}
/** Cache keys of the preview proxy: the cut part depends on everything that shapes picture/sound except overlays; SFX add their own key. */
export function previewKeys(sourceSha,plan,sfx=[]){
  const {animations:_a,motion:_m,theme:_t,...cut}=plan;void _a;void _m;void _t;
  // In the vertical format the 9:16 crop follows the framing focus, so the focus then shapes the cut picture too.
  const crop=plan.format==='portrait'&&plan.motion?.reframe?{reframe:plan.motion.reframe}:{};
  const cutKey=sha(JSON.stringify({v:1,source:sourceSha,cut,...crop}));return {cutKey,key:sfx.length?sha(JSON.stringify({v:1,cutKey,sfx})):cutKey};
}
/** Longest side of the preview proxy <= 960 px, never upscaled (the Player scales it to the composition size). */
export const PREVIEW_SCALE="scale=w='if(gte(iw,ih),min(960,iw),-2)':h='if(gte(iw,ih),-2,min(960,ih))'";
const sendFile=async(path,info,type,request,response)=>{
  const range=/^bytes=(\d*)-(\d*)$/.exec(String(request.headers.range??''));let start=0,end=info.size-1,status=200;
  if(range){start=range[1]?Number(range[1]):Math.max(0,info.size-Number(range[2]));end=range[1]&&range[2]?Math.min(Number(range[2]),info.size-1):info.size-1;if(start>end||start>=info.size){response.writeHead(416,{'content-range':`bytes */${info.size}`});response.end();return;}status=206;}
  response.writeHead(status,{'content-type':type,'content-length':end-start+1,'accept-ranges':'bytes','cache-control':'no-store','x-content-type-options':'nosniff',...(status===206?{'content-range':`bytes ${start}-${end}/${info.size}`}:{})});
  if(request.method==='HEAD'){response.end();return;}
  await new Promise((resolve,reject)=>{const stream=createReadStream(path,{start,end});stream.on('error',reject);response.on('close',()=>{stream.destroy();resolve();});stream.pipe(response).on('finish',resolve);});
};

/** Bounded local exports. No shell, UI control, arbitrary arguments or original-file overwrite. */
/** `animate` is the optional overlay engine with the renderAnimatedVideo contract (editorial-remotion.mjs):
 * ({inputPath,outputPath,metadata:{width,height,fps,durationSeconds,hasAudio},animations:<remotion spec>,signal,onProgress})=>Promise.
 * It must create a new outputPath with the same duration and audio. `animationCapabilities` reports whether it can run now. */
/** Readable name of a delivered edit: the original's name (filesystem-safe, bounded) + "-editado-N"; always a new file in the job folder. */
export const exportBase=path=>String(path??'').split(/[\\/]/).pop().replace(/\.[^.]+$/,'').normalize('NFC').replace(/[^\p{L}\p{N} _.-]+/gu,'-').replace(/\s+/g,' ').trim().slice(0,60).replace(/[ .-]+$/,'')||'video';
export function createEditorialMedia(db,{directory,getCurrentProfile,inspect=inspectLocalAsset,ffmpeg='ffmpeg',ffprobe='ffprobe',run=runMediaProcess,animate,animationCapabilities,transcriber,receipts,stills}={}){
  db.exec('CREATE TABLE IF NOT EXISTS editorial_media_jobs (id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,status TEXT NOT NULL,data_json TEXT NOT NULL,updated_at TEXT NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS editorial_silences (profile_id TEXT NOT NULL,version_id TEXT NOT NULL,sha256 TEXT NOT NULL,data_json TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(profile_id,version_id,sha256))');
  db.exec('CREATE TABLE IF NOT EXISTS editorial_transcripts (profile_id TEXT NOT NULL,version_id TEXT NOT NULL,sha256 TEXT NOT NULL,language TEXT NOT NULL,data_json TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(profile_id,version_id,sha256,language))');
  db.exec('CREATE TABLE IF NOT EXISTS editorial_audio (profile_id TEXT NOT NULL,version_id TEXT NOT NULL,sha256 TEXT NOT NULL,data_json TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(profile_id,version_id,sha256))');
  let closed=false;const active=new Map(),analyses=new Set(),transcriptions=new Set(),streamDigests=new Map(),voiceCache=new Map();let previewing=null;
  const storedTranscript=(profile,job,language)=>{const row=language?db.prepare('SELECT data_json FROM editorial_transcripts WHERE profile_id=? AND version_id=? AND sha256=? AND language=?').get(profile,job.versionId,job.sha256,language):db.prepare('SELECT data_json FROM editorial_transcripts WHERE profile_id=? AND version_id=? AND sha256=? ORDER BY created_at DESC').get(profile,job.versionId,job.sha256);return row?JSON.parse(row.data_json):null;};
  /** Audio assessment (noise floor measured in the pauses) of a source version; the noise measurement is only ever read from here, never from a request. */
  const storedAudio=(profile,job)=>{const row=db.prepare('SELECT data_json FROM editorial_audio WHERE profile_id=? AND version_id=? AND sha256=?').get(profile,job.versionId,job.sha256);return row?JSON.parse(row.data_json):null;};
  const saveAudio=(profile,job,assessment)=>db.prepare('INSERT OR REPLACE INTO editorial_audio VALUES (?,?,?,?,?)').run(profile,job.versionId,job.sha256,JSON.stringify(assessment),stamp());
  const checkAudio=(profile,job,plan)=>assertMeasuredNoiseFloor(plan.audio,storedAudio(profile,job)?.measurement,{versionId:job.versionId,sha256:job.sha256});
  /** Explainers that claim to come from the speech must quote words really recognized in THIS source's stored transcript. */
  const checkExplainers=(profile,job,plan)=>{
    if(!plan.motion?.cues?.some(cue=>cue.kind==='explainer'&&cue.explainer?.origin==='speech'))return;
    const check=verifyExplainersAgainstTranscript(plan.motion,transcriptWords(voiceTranscript(profile,job)).words);
    if(!check.ok)throw new Error(`Explainer not supported by the transcript: ${check.problems.map(item=>item.reason).slice(0,3).join(' ')}`);
  };
  /** Screen-pair rules: scene.screen only with a pair; voice from the screen needs every kept segment inside the screen recording. */
  const screenDurations=new Map();
  const checkPair=(job,plan)=>{
    const usesScreen=plan.storyboard?.scenes?.some(scene=>scene.screen&&scene.screen!=='off');
    if(!job.pair&&usesScreen)throw new Error('This edit has no screen recording: remove scene.screen (or use "off").');
    if(job.pair&&plan.motion?.cues?.length&&!plan.storyboard)throw new Error('With a camera + screen recording, motion comes only from the authored storyboard (scene.screen chooses the composition).');
    const duration=job.screen&&screenDurations.get(job.screen.sha256);
    if(job.pair?.voice==='screen'&&duration!==undefined){const problem=voiceCoverageProblem(plan.segments,{offsetSeconds:job.pair.offsetSeconds,screenDuration:duration});if(problem)throw new Error(problem);}
  };
  const checkPlan=(profile,job,plan)=>{checkPair(job,plan);checkAudio(profile,voiceJob(job),plan);checkExplainers(profile,job,plan);};
  /**
   * Storyboard images/clips: each declared asset must be a CURRENT file of this content's library with the same sha256
   * (the renderer re-hashes it). Paths come from the library, never from the plan.
   */
  const assetFilesFor=(profile,job,plan)=>{
    const wanted=plan?.storyboard?.assets??[];if(!wanted.length)return undefined;const assets=state(profile)?.state.assets??[];
    return Object.fromEntries(wanted.map(item=>{const asset=assets.find(a=>a.contentId===job.contentId&&a.workspaceId===job.workspaceId&&['image','video'].includes(a.kind)&&a.versions.find(v=>v.id===a.currentVersionId)?.sha256===item.sha256);
      if(!asset)throw new Error(`Storyboard asset ${item.id} is not a current file of this content's library.`);return [item.id,{path:asset.versions.find(v=>v.id===asset.currentVersionId).path,sha256:item.sha256}];}));
  };
  /** Library images/clips of the content the editor may place in a storyboard (alias, kind, sha256, name). No paths. */
  const libraryAssets=(profile,job)=>(state(profile)?.state.assets??[]).filter(a=>a.contentId===job.contentId&&a.workspaceId===job.workspaceId&&['image','video'].includes(a.kind)&&a.status==='available'&&a.id!==job.assetId&&a.id!==job.screen?.assetId).slice(0,8).map((a,index)=>({id:`asset${index+1}`,kind:a.kind,sha256:a.versions.find(v=>v.id===a.currentVersionId).sha256,label:a.name.slice(0,60)}));
  const cutsOf=plan=>outputTimelineOf(plan.segments).slice(1).map(item=>item.outputStart);
  /** Same cut (segments, format, audio) as the export at preview scale; cached by the same key as the Player preview. */
  const cutProxy=async(profile,job,metadata,plan,signal)=>{
    const folder=join(directory,profile,'previews');await mkdir(folder,{recursive:true});
    const {cutKey}=previewKeys(job.pair?`${job.sha256}|${job.pair.hash}`:job.sha256,plan),cutPath=join(folder,`${cutKey}.cut.mp4`);
    const voice=await voiceInput(job,metadata,signal);
    if(!await stat(cutPath).then(info=>info.isFile()&&info.size>0,()=>false)){
      const part=join(folder,`${cutKey}.${randomUUID()}.partial.mp4`);
      try{const filter=`${cutFilter(plan.segments,{hasAudio:voice.hasAudio,format:plan.format,normalizeAudio:plan.normalizeAudio,audio:plan.audio,motion:plan.motion,source:metadata.display,...voice.filter})};[vout]${PREVIEW_SCALE}[vprev]`;
        await run(ffmpeg,['-nostdin','-hide_banner','-v','error','-n','-protocol_whitelist','file,pipe','-i',job.inputPath,...voice.inputs,'-filter_complex',filter,'-map','[vprev]',...(voice.hasAudio?['-map','[aout]','-c:a','aac','-ar','48000']:[]),'-c:v','libx264','-preset','ultrafast','-crf','26','-g','12','-pix_fmt','yuv420p','-movflags','+faststart',part],{signal,timeoutMs:1800000});
        if(signal?.aborted)throw new Error('Preview canceled.');await rename(part,cutPath);}finally{await unlink(part).catch(()=>{});}
    }
    const proxy=await probeVideo(cutPath,{ffprobe,run,signal});if(!Number.isFinite(proxy.fps))throw new Error('The edited video frame rate is unreadable.');
    const screen=job.pair?await screenTrack(job,plan,{fps:proxy.fps,folder,key:cutKey,maxSide:960,signal}):null;
    return {cutPath,metadata:{width:proxy.width,height:proxy.height,fps:proxy.fps,durationSeconds:proxy.duration,hasAudio:proxy.hasAudio},...(screen?{screen}:{})};
  };
  /** The screen recording of a pair as a job-like source (its own version/sha/path, verified like the camera). */
  const screenJob=job=>({profileId:job.profileId,workspaceId:job.workspaceId,contentId:job.contentId,assetId:job.screen.assetId,versionId:job.screen.versionId,sha256:job.screen.sha256,inputPath:job.screen.inputPath});
  /** The source whose audio is THE voice of the edit (camera, or the screen when chosen); never both mixed. */
  const voiceJob=job=>job.pair?.voice==='screen'?screenJob(job):job;
  /** cameraTime = voiceTime + shift (screen voice: + offset). */
  const voiceShift=job=>job.pair?.voice==='screen'?job.pair.offsetSeconds:0;
  const screenMetadata=async(job,signal)=>{const metadata=await probeVideo(job.screen.inputPath,{ffprobe,run,signal});screenDurations.set(job.screen.sha256,metadata.duration);return metadata;};
  /** Extra inputs/filter options of the cut for the voice source. Without a pair: exactly the legacy single input. */
  const voiceInput=async(job,metadata,signal)=>{
    if(job.pair?.voice!=='screen')return {hasAudio:metadata.hasAudio,inputs:[],filter:{}};
    const screen=await screenMetadata(job,signal);
    return {hasAudio:screen.hasAudio,inputs:['-i',job.screen.inputPath],filter:{audioInput:1,audioShift:-job.pair.offsetSeconds},metadata:screen};
  };
  /**
   * Screen track cut with the SAME kept camera segments through the exact camera->screen transform (before the cut mapper).
   * Gaps are black frames marked out of `windows`. Cached next to the camera proxy (preview) or written in the export folder.
   */
  const screenTrack=async(job,plan,{fps,folder,key,maxSide=1920,out,signal})=>{
    const meta=await screenMetadata(job,signal),size=screenTrackSize(meta.display??meta,maxSide),map=mapScreenSegments(plan.segments,{offsetSeconds:job.pair.offsetSeconds,screenDuration:meta.duration});
    const path=out??join(folder,`${key}.screen.mp4`);
    if(out||!await stat(path).then(info=>info.isFile()&&info.size>0,()=>false)){
      const part=out?`${out}.part.mp4`:join(folder,`${key}.${randomUUID()}.screen.partial.mp4`);
      try{await run(ffmpeg,['-nostdin','-hide_banner','-v','error','-n','-protocol_whitelist','file,pipe','-i',job.screen.inputPath,'-filter_complex',screenCutFilter(map.pieces,{input:0,fps,size}),'-map','[sout]','-an','-c:v','libx264','-preset',out?'veryfast':'ultrafast','-crf',out?'20':'26','-g','12','-pix_fmt','yuv420p','-movflags','+faststart',part],{signal,timeoutMs:3600000});
        if(signal?.aborted)throw new Error('Screen track canceled.');await rename(part,path);}finally{await unlink(part).catch(()=>{});}
    }
    return {path,windows:map.windows,width:size.width,height:size.height,screenSeconds:map.screenSeconds,gapSeconds:map.gapSeconds};
  };
  /** Composition spec of a pair: default mode from the layout, real screen windows and track size. */
  const withScreen=(animations,job,track)=>job.pair?{...animations,screen:{mode:defaultScreenMode(job.pair.layout),windows:track.windows,width:track.width,height:track.height}}:animations;
  const animated=(job,plan)=>needsAnimation(plan)||Boolean(job.pair);
  /** Transcript of the voice source on the CAMERA timeline (screen voice: shifted by the offset, clipped to the camera). */
  const voiceTranscript=(profile,job)=>{const transcript=storedTranscript(profile,voiceJob(job));return job.pair?.voice==='screen'&&transcript?shiftTranscript(transcript,{shift:voiceShift(job),duration:job.cameraDuration??Infinity}):transcript;};
  /** JPEG frames of a local video at the given seconds (source recording or an authoring preview). */
  const grabFrames=async(path,times,{maxWidth=640,folder,signal})=>{
    await mkdir(folder,{recursive:true});const result=[];
    for(const time of times){const out=join(folder,`frame-${randomUUID()}.jpg`);
      await run(ffmpeg,['-nostdin','-hide_banner','-v','error','-n','-ss',String(Math.max(0,time)),'-i',path,'-frames:v','1','-vf',`scale='min(${maxWidth},iw)':-2`,'-q:v','3',out],{signal,timeoutMs:120000});
      if(await stat(out).then(info=>info.size>0,()=>false))result.push({time,path:out,mimeType:'image/jpeg'});}
    return result;
  };
  /** One contact sheet (<=16 tiles) of a local video between start and end, with the sampled times. */
  const grabSheet=async(path,{start=0,end,count=9,folder,signal})=>{
    const n=Math.min(16,Math.max(2,Math.round(count))),span=Math.max(0.2,end-start),cols=Math.min(4,n),rows=Math.ceil(n/cols);
    await mkdir(folder,{recursive:true});const out=join(folder,`sheet-${randomUUID()}.jpg`);
    await run(ffmpeg,['-nostdin','-hide_banner','-v','error','-n','-ss',String(Math.max(0,start)),'-t',String(span),'-i',path,'-frames:v','1','-vf',`fps=${n/span},scale=320:-2,tile=${cols}x${rows}:padding=6:margin=6:color=0x202020`,'-q:v','3',out],{signal,timeoutMs:180000});
    return {path:out,mimeType:'image/jpeg',times:Array.from({length:n},(_,i)=>Math.round((start+i*span/n)*1000)/1000)};
  };
  /** Voice energy/pitch track of a source version (8 kHz PCM), cached for the latest version only. */
  const voiceOf=async(job,signal)=>{const key=`${job.versionId}|${job.sha256}`;let track=voiceCache.get(key);if(!track){const pcm=await extractVoicePcm({ffmpeg,inputPath:job.inputPath,signal});track=voiceTrack(pcm.samples,pcm.sampleRate);voiceCache.clear();voiceCache.set(key,track);}return track;};
  /** Measures (once per version) the pause noise floor/levels that the opt-in voice treatment needs. */
  const measureAudio=async(profile,job,metadata,silences,signal)=>{
    const cached=storedAudio(profile,job);if(cached)return cached;
    const assessment=await assessAudio({ffmpeg,ffprobe,inputPath:job.inputPath,silences,duration:metadata.duration,versionId:job.versionId,sha256:job.sha256,signal});
    saveAudio(profile,job,assessment);return assessment;
  };
  /** Runs whisper.cpp once per source version and language; the result is cached and tied to the verified sha256. */
  const runTranscription=async(profile,job,metadata,language,signal)=>{
    if(!transcriber)throw new Error('Local transcription is not configured.');if(!metadata.hasAudio)throw new Error('This video has no audio to transcribe.');
    const cached=storedTranscript(profile,job,language);if(cached)return {...cached,cached:true};
    if(transcriptions.size)throw new Error('Wait for the current transcription to finish.');const controller=new AbortController(),abort=()=>controller.abort();transcriptions.add(controller);signal?.addEventListener('abort',abort,{once:true});
    try{
      const result=await transcriber.transcribe({inputPath:job.inputPath,duration:metadata.duration,language,signal:controller.signal});
      if(closed||controller.signal.aborted)throw new Error('Transcription canceled.');await source(job);
      const info={origin:'local-whisper',engine:result.engine,model:result.model,language:result.language,timing:Array.isArray(result.speech)&&result.speech.length?'words':'sentences'},transcript=result.segments.length?{...validateTranscript({segments:result.segments},metadata.duration,info),...(Array.isArray(result.speech)&&result.speech.length?{speech:result.speech}:{}),...(Array.isArray(result.words)&&result.words.length?{words:result.words.filter(word=>Number.isFinite(word?.start)&&Number.isFinite(word?.end)&&word.end>word.start&&word.start<metadata.duration&&typeof word.text==='string').slice(0,30000).map(word=>({start:word.start,end:Math.min(word.end,metadata.duration),text:word.text.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,40)}))}:{}),createdAt:stamp()}:{...info,segments:[],noSpeech:true,createdAt:stamp()};
      db.prepare('INSERT OR REPLACE INTO editorial_transcripts VALUES (?,?,?,?,?,?)').run(profile,job.versionId,job.sha256,language,JSON.stringify(transcript),transcript.createdAt);return transcript;
    }finally{transcriptions.delete(controller);signal?.removeEventListener('abort',abort);}
  };
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
    if(job.screen){const screen=current.state.assets?.find(item=>item.id===job.screen.assetId&&item.contentId===content.id&&item.workspaceId===job.workspaceId),sv=screen?.versions.find(item=>item.id===screen.currentVersionId);if(screen?.kind!=='video'||screen.status!=='available'||sv?.id!==job.screen.versionId||sv.sha256!==job.screen.sha256||sv.path!==job.screen.inputPath)throw new Error('The screen recording version changed. Review a new export.');}
    return current;
  };
  const source=async job=>{authorize(job);const input=await inspect(job.inputPath);authorize(job);if(input.status!=='available'||input.sha256!==job.sha256)throw new Error('The source video changed or is unavailable. Verify its current version.');
    if(job.screen){const screen=await inspect(job.screen.inputPath);authorize(job);if(screen.status!=='available'||screen.sha256!==job.screen.sha256)throw new Error('The screen recording changed or is unavailable. Verify its current version.');}
    return input;};
  const finish=async job=>{
    const result=await inspect(job.outputPath);if(result.status!=='available'||result.kind!=='video')throw new Error(result.error||'The export did not produce a real video file.');
    const metadata=await probeVideo(job.outputPath,{ffprobe,run});
    if(Math.abs(metadata.duration-job.duration)>(job.mode==='advanced'?Math.max(0.4,job.plan.segments.length*0.05):0.4)||(job.voiceMetadata??job.inputMetadata).hasAudio&&!metadata.hasAudio)throw new Error('The exported video duration or audio differs from the approved operation.');
    if(job.result?.file?.sha256&&job.result.file.sha256!==result.sha256)throw new Error('The exported file changed after verification.');
    authorize(job);if(read(job.profileId,job.id)?.status==='canceled')throw new Error('Export canceled.');
    job.result={file:result,metadata};job.phase='verified';
    // Host receipt of the verified export (name, absolute path, sha256). A receipt failure never hides the verified file.
    if(receipts){try{job.result.receipt=await receipts.issue(job.profileId,{source:{kind:'media-export',id:job.id},contentId:job.contentId,workspaceId:job.workspaceId,path:result.path,expectedSha256:result.sha256});}catch(error){job.receiptError=error.message;}}
    put(job);
    const subtitles=job.mode==='advanced'?await writeSubtitles(job,job.outputPath.replace(/\.mp4$/i,'.srt')).catch(error=>{job.subtitlesError=error.message;return null;}):null;
    db.exec('BEGIN IMMEDIATE');
    try{
      const current=authorize(job),content=current.state.contents.find(item=>item.id===job.contentId);
      current.state.assets??=[];
      let output=current.state.assets.find(item=>item.mediaJobId===job.id);
      if(!output){const at=stamp(),version={id:randomUUID(),path:result.path,name:result.name,size:result.size,sha256:result.sha256,modifiedAt:result.modifiedAt,createdAt:at};
        output={id:`asset-${randomUUID()}`,contentId:job.contentId,workspaceId:job.workspaceId,role:'output',kind:'video',name:result.name,sourceAssetId:job.assetId,mediaJobId:job.id,versions:[version],currentVersionId:version.id,status:'available',checkedAt:result.checkedAt,createdAt:at,updatedAt:at};current.state.assets.push(output);
      }
      if(subtitles&&!current.state.assets.some(item=>item.subtitlesForJobId===job.id))current.state.assets.push(subtitleAsset(job,subtitles,output.id));
      content.assetIds=current.state.assets.filter(item=>item.contentId===job.contentId).map(item=>item.id);content.productionStage='video-review';content.updatedAt=stamp();
      current.state.artifacts??=[];
      if(!current.state.artifacts.some(item=>item.mediaJobId===job.id))current.state.artifacts.unshift({id:`artifact-${randomUUID()}`,mediaJobId:job.id,workspaceId:job.workspaceId,topicId:content.topicId,contentId:content.id,type:'specialist-result',version:current.state.artifacts.filter(item=>item.contentId===content.id&&item.type==='specialist-result').length+1,data:{summary:job.mode==='advanced'?`Local edited video: ${job.plan.segments.length} kept segments, ${job.duration}s.`:`Local video export: ${job.start}s to ${job.start+job.duration}s.`,outputFiles:[result],blockers:[]},createdAt:stamp()});
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
        if(job.mode==='advanced'){assertAnalyzable(job.inputMetadata);if(planHash(job,validatePlan(job.plan,job.inputMetadata.duration).plan)!==job.planHash)throw new Error('The approved edit plan no longer matches this source.');checkAudio(job.profileId,voiceJob(job),job.plan);}
        else if(job.start+job.duration>job.inputMetadata.duration+0.05)throw new Error('The selected interval exceeds the source video duration.');
        await mkdir(job.outputDirectory,{recursive:true});
        // Every attempt has a new file name; -n refuses any existing target.
        const part=join(job.outputDirectory,`attempt-${job.attempt}.partial.mp4`);job.outputPath=join(job.outputDirectory,`${exportBase(job.inputPath)}-editado-${job.attempt}.mp4`);job.phase='encoding';put(job);
        let lastUpdate=0;
        const filters=[job.edit?.format==='portrait'?'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920':'scale=trunc(iw/2)*2:trunc(ih/2)*2'];
        if(job.edit?.fadeSeconds)filters.push(`fade=t=in:st=0:d=${job.edit.fadeSeconds}`,`fade=t=out:st=${Math.max(0,job.duration-job.edit.fadeSeconds)}:d=${job.edit.fadeSeconds}`);
        const audio=job.edit?.normalizeAudio&&job.inputMetadata.hasAudio?['-af','loudnorm=I=-16:TP=-1.5:LRA=11']:[];
        const voice=job.mode==='advanced'?await voiceInput(job,job.inputMetadata,controller.signal):{hasAudio:job.inputMetadata.hasAudio,inputs:[],filter:{}};if(voice.metadata)job.voiceMetadata=voice.metadata;
        if(job.pair){const screen=await screenMetadata(job,controller.signal);job.screenMetadata={duration:screen.duration,width:screen.width,height:screen.height,hasAudio:screen.hasAudio};checkPair(job,job.plan);}
        const hasAudio=voice.hasAudio,cut=job.mode==='advanced'?join(job.outputDirectory,`attempt-${job.attempt}.cut.partial.mp4`):part;
        const args=job.mode==='advanced'
          ?['-nostdin','-hide_banner','-v','error','-n','-protocol_whitelist','file,pipe','-i',job.inputPath,...voice.inputs,'-filter_complex',cutFilter(job.plan.segments,{hasAudio,format:job.plan.format,normalizeAudio:job.plan.normalizeAudio,audio:job.plan.audio,motion:job.plan.motion,source:job.inputMetadata.display,...voice.filter}),'-map','[vout]',...(hasAudio?['-map','[aout]','-c:a','aac','-ar','48000']:[]),'-c:v','libx264','-preset','veryfast','-crf','22','-movflags','+faststart','-progress','pipe:1','-nostats',cut]
          :['-nostdin','-hide_banner','-v','error','-n','-protocol_whitelist','file,pipe','-ss',String(job.start),'-i',job.inputPath,'-t',String(job.duration),'-map','0:v:0','-map','0:a:0?','-vf',filters.join(','),...audio,'-c:v','libx264','-preset','veryfast','-crf','22','-c:a','aac','-movflags','+faststart','-progress','pipe:1','-nostats',part];
        await run(ffmpeg,args,{signal:controller.signal,timeoutMs:job.mode==='advanced'?3600000:1800000,onProgress:output=>{
          if(closed||controller.signal.aborted||Date.now()-lastUpdate<500)return;const matches=[...output.matchAll(/out_time_us=(\d+)/g)];if(matches.length){job.progress=Math.min(99,Number(matches.at(-1)[1])/1000000/job.duration*(animated(job,job.plan)?60:100));lastUpdate=Date.now();put(job);}
        }});
        if(controller.signal.aborted||closed||read(job.profileId,job.id)?.status!=='running')throw new Error('Export was interrupted.');
        if(job.mode==='advanced'&&animated(job,job.plan)){
          if(!animate)throw new Error('The animation engine is unavailable.');
          const cutMetadata=await probeVideo(cut,{ffprobe,run,signal:controller.signal});job.phase='animating';put(job);
          if(!Number.isFinite(cutMetadata.fps))throw new Error('The edited video frame rate is unreadable.');
          const assetFiles=assetFilesFor(job.profileId,job,job.plan);
          // Camera + screen: the screen track is cut from the screen file with the same kept segments (offset applied before the cuts).
          const track=job.pair?await screenTrack(job,job.plan,{fps:cutMetadata.fps,out:join(job.outputDirectory,`attempt-${job.attempt}.screen.mp4`),signal:controller.signal}):null;
          if(track)job.screenTrack={windows:track.windows,width:track.width,height:track.height,screenSeconds:track.screenSeconds,gapSeconds:track.gapSeconds};
          const base=job.plan.storyboard||needsAnimation(job.plan)?remotionAnimations(job.plan,{source:job.inputMetadata.display}):{};
          await animate({inputPath:cut,outputPath:part,...(track?{screenPath:track.path}:{}),...(assetFiles?{assetFiles}:{}),...(job.plan.storyboard?{cutsAt:cutsOf(job.plan)}:{}),animations:withScreen(base,job,track),metadata:{width:cutMetadata.width,height:cutMetadata.height,fps:cutMetadata.fps,durationSeconds:cutMetadata.duration,hasAudio:cutMetadata.hasAudio},signal:controller.signal,onProgress:event=>{const value=typeof event==='number'?event:event?.phase==='render'?event.progress:event?.phase==='verify'?1:0;if(Number.isFinite(value)&&!closed&&!controller.signal.aborted&&read(job.profileId,job.id)?.status==='running'){job.progress=Math.min(99,Math.max(job.progress??0,60+Math.min(1,Math.max(0,value))*39));put(job);}}});
          if(controller.signal.aborted||closed||read(job.profileId,job.id)?.status!=='running')throw new Error('Export was interrupted.');
          const animated=await probeVideo(part,{ffprobe,run,signal:controller.signal});
          if(Math.abs(animated.duration-cutMetadata.duration)>2/cutMetadata.fps+0.1||cutMetadata.hasAudio&&!animated.hasAudio)throw new Error('The animated video changed duration or lost audio.');
        }else if(cut!==part)await rename(cut,part);
        // Visual-only adjustment of a delivered edit: the audio of THAT verified version is copied packet by packet (no
        // re-encode), so the new version's voice, SFX and timing are byte-identical to the one the person already reviewed.
        if(job.audioFrom){
          const base=await inspect(job.audioFrom.path);if(base.status!=='available'||base.sha256!==job.audioFrom.sha256)throw new Error('The previous version (audio source) changed or is unavailable.');
          const remux=join(job.outputDirectory,`attempt-${job.attempt}.audio.partial.mp4`);
          const audioMetadata=await probeVideo(job.audioFrom.path,{ffprobe,run,signal:controller.signal});
          await run(ffmpeg,['-nostdin','-hide_banner','-v','error','-n','-i',part,'-i',job.audioFrom.path,'-map','0:v:0','-map','1:a:0?','-c','copy','-movflags','+faststart',remux],{signal:controller.signal,timeoutMs:1800000});
          const [video,merged]=[await probeVideo(part,{ffprobe,run,signal:controller.signal}),await probeVideo(remux,{ffprobe,run,signal:controller.signal})];
          if(merged.hasAudio!==audioMetadata.hasAudio||Math.abs(merged.duration-video.duration)>2/(video.fps||30)+0.1)throw new Error('The audio of the previous version does not fit the adjusted video (duration differs). Nothing was replaced.');
          await unlink(part).catch(()=>{});await rename(remux,part);job.audioCopied={assetId:job.audioFrom.assetId,versionId:job.audioFrom.versionId,sha256:job.audioFrom.sha256};put(job);
        }
        await source(job);await rename(part,job.outputPath);job.phase='exported';put(job);await finish(job);
      }catch(error){if(!closed){const current=read(job.profileId,job.id);if(current?.status!=='canceled'){job.status='failed';job.error=error.message;job.updatedAt=stamp();put(job);}}}
    })().finally(()=>active.delete(job.id));active.set(job.id,{controller,promise});
  };
  const subtitleAsset=(job,file,videoAssetId)=>{const at=stamp(),version={id:randomUUID(),path:file.path,name:file.name,size:file.size,sha256:file.sha256,modifiedAt:file.modifiedAt,createdAt:at};return {id:`asset-${randomUUID()}`,contentId:job.contentId,workspaceId:job.workspaceId,role:'output',kind:'document',name:file.name,sourceAssetId:videoAssetId,subtitlesForJobId:job.id,versions:[version],currentVersionId:version.id,status:'available',checkedAt:file.checkedAt,createdAt:at,updatedAt:at};};
  /** Writes subtitles on the EDITED timeline from the cached local transcript of the source version. Never transcribes here. */
  const writeSubtitles=async(job,path)=>{
    const transcript=voiceTranscript(job.profileId,{...job,cameraDuration:job.inputMetadata?.duration});if(!transcript||transcript.noSpeech||!transcript.segments?.length)return null;
    const lines=remapTranscript(transcript.segments,job.plan.segments);if(!lines.length)return null;
    await writeFile(path,'\ufeff'+toSrt(lines),{encoding:'utf8',flag:'wx'});const file=await inspect(path);
    if(file.status!=='available')throw new Error(file.error||'Subtitle file could not be verified.');return file;
  };
  const succeededAdvanced=(profile,id)=>{const job=read(profile,id);if(!job||job.mode!=='advanced'||job.status!=='succeeded'||!job.result?.assetId)throw new Error('Choose a verified automatic edit.');return job;};
  const reviewed=(profile,input)=>{
    const current=state(profile),content=current?.state.contents.find(item=>item.id===input.contentId),asset=current?.state.assets?.find(item=>item.id===input.assetId&&item.contentId===input.contentId&&item.workspaceId===content?.workspaceId),version=asset?.versions.find(item=>item.id===asset.currentVersionId);
    if(!content||asset?.kind!=='video'||!version)throw new Error('Choose a linked video from this content.');
    if(version.id!==input.versionId||version.sha256!==input.sha256)throw new Error('The reviewed source version changed. Inspect it again.');
    const job={profileId:profile,workspaceId:content.workspaceId,contentId:content.id,assetId:asset.id,versionId:version.id,sha256:version.sha256,inputPath:version.path};
    if(input.pair!==undefined){
      // Camera + screen: the screen is a CURRENT video of this content and the pair hash binds both sources, offset, voice, layout.
      const pair=input.pair,screen=current.state.assets?.find(item=>item.id===pair?.screen?.assetId&&item.contentId===content.id&&item.workspaceId===content.workspaceId&&item.kind==='video'&&item.status==='available'),sv=screen?.versions.find(item=>item.id===screen.currentVersionId);
      if(!sv||sv.id!==pair.screen.versionId||sv.sha256!==pair.screen.sha256)throw new Error('The screen recording version changed. Review the current camera + screen pair.');
      if(!pairVoices.includes(pair.voice)||!pairLayouts.includes(pair.layout)||!Number.isFinite(pair.offsetSeconds))throw new Error('Invalid camera + screen pair.');
      if(screen.id===asset.id||pairHash({camera:{assetId:asset.id,versionId:version.id,sha256:version.sha256},screen:{assetId:screen.id,versionId:sv.id,sha256:sv.sha256},offsetSeconds:pair.offsetSeconds,voice:pair.voice,layout:pair.layout})!==pair.hash)throw new Error('The camera + screen pair changed (sources, offset, voice or layout). Review the current pair.');
      job.screen={assetId:screen.id,versionId:sv.id,sha256:sv.sha256,inputPath:sv.path};job.pair={offsetSeconds:pair.offsetSeconds,voice:pair.voice,layout:pair.layout,hash:pair.hash};
    }
    return {current,job};
  };
  const enqueueAdvanced=(profile,input)=>{
    if(input.authorize!==true)throw new Error('Advanced export requires explicit authorization of the reviewed plan.');
    if(typeof input.requestKey!=='string'||!input.requestKey||input.requestKey.length>120||typeof input.planHash!=='string')throw new Error('Advanced export requires a request key and the reviewed plan hash.');
    // Source duration is rechecked at launch; here the plan must already match the hash the user reviewed.
    const {plan,outputDuration}=validatePlan(input.plan,Infinity);
    const {job:base,current}=reviewed(profile,input);
    if(animated(base,plan)&&!animate)throw new Error('The animation engine is unavailable.');
    if(planHash(base,plan)!==input.planHash)throw new Error('The edit plan differs from the reviewed plan. Preview it again.');
    checkPlan(profile,base,plan);
    let audioFrom;
    if(input.audioFrom!==undefined){
      const ref=input.audioFrom,asset=current.state.assets?.find(item=>item.id===ref?.assetId&&item.contentId===base.contentId&&item.workspaceId===base.workspaceId&&item.kind==='video'&&item.role==='output'),version=asset?.versions.find(item=>item.id===asset.currentVersionId);
      if(!version||version.id!==ref.versionId||version.sha256!==ref.sha256)throw new Error('The previous edited version used as audio source changed. Review the current version.');
      audioFrom={assetId:asset.id,versionId:version.id,sha256:version.sha256,path:version.path};
    }
    const hash=artifactHash({mode:'advanced',contentId:base.contentId,assetId:base.assetId,versionId:base.versionId,sha256:base.sha256,planHash:input.planHash,...(audioFrom?{audioFrom:audioFrom.sha256}:{})});
    const prior=db.prepare('SELECT data_json FROM editorial_media_jobs WHERE profile_id=?').all(profile).map(row=>JSON.parse(row.data_json)).find(job=>job.requestKey===input.requestKey);
    if(prior){if(prior.requestHash!==hash)throw new Error('This request was already used for a different export.');return {...state(profile),job:prior};}
    if(db.prepare("SELECT id FROM editorial_media_jobs WHERE status IN ('queued','running')").get())throw new Error('Wait for the current video export or cancel it first.');
    if(current.revision!==input.revision)throw new Error('The reviewed source version changed. Inspect it again.');
    const id=`media-${randomUUID()}`,at=stamp(),job={id,...base,mode:'advanced',plan,planHash:input.planHash,...(audioFrom?{audioFrom}:{}),authorizedAt:at,start:plan.segments[0].start,duration:outputDuration,requestKey:input.requestKey,requestHash:hash,status:'queued',phase:'queued',progress:0,attempt:1,outputDirectory:join(directory,profile,id),createdAt:at,updatedAt:at,ownerPid:process.pid};
    authorize(job);db.prepare('INSERT INTO editorial_media_jobs VALUES (?,?,?,?,?)').run(id,profile,job.status,JSON.stringify(job),at);launch(job);return {...current,job};
  };
  return {
    async capabilities(){const result={available:false,ffmpeg:false,ffprobe:false,animate:false,transcribe:false,error:''};if(transcriber){try{const engine=await transcriber.capabilities();result.transcribe=engine?.available===true;if(!result.transcribe)result.transcribeReasons=(engine?.reasons??[]).map(String).slice(0,5);}catch(error){result.transcribeReasons=[error.message];}}if(typeof animate==='function'){try{const engine=animationCapabilities?await animationCapabilities():{available:true};result.animate=engine?.available===true;if(!result.animate)result.animateReasons=(engine?.reasons??[]).map(String).slice(0,5);}catch(error){result.animateReasons=[error.message];}}try{await run(ffmpeg,['-version']);result.ffmpeg=true;await run(ffprobe,['-version']);result.ffprobe=true;result.available=true;}catch(error){result.error=error.message;}return result;},
    async inspect(profile,{contentId,assetId}){
      const current=state(profile),asset=current?.state.assets?.find(item=>item.id===assetId&&item.contentId===contentId),version=asset?.versions.find(item=>item.id===asset.currentVersionId),content=current?.state.contents.find(item=>item.id===contentId);
      if(!asset||!version||asset.kind!=='video'||!content)throw new Error('Choose a linked video from this content.');
      const job={profileId:profile,workspaceId:content.workspaceId,contentId,assetId,versionId:version.id,sha256:version.sha256,inputPath:version.path};await source(job);const metadata=await probeVideo(version.path,{ffprobe,run});authorize(job);return {metadata,versionId:version.id,sha256:version.sha256};
    },
    /** MD5 of the audio PACKETS (stream copy, no decode) plus the probed timeline of a content video. Read-only. */
    async audioDigest(profile,{contentId,assetId,versionId,sha256}={}){
      const current=state(profile),asset=current?.state.assets?.find(item=>item.id===assetId&&item.contentId===contentId&&item.kind==='video'),version=asset?.versions.find(item=>item.id===asset.currentVersionId);
      if(!version||versionId&&version.id!==versionId||sha256&&version.sha256!==sha256)throw new Error('Choose a current video version of this content.');
      const file=await inspect(version.path);if(file.status!=='available'||file.sha256!==version.sha256)throw new Error('The video changed on disk.');
      const metadata=await probeVideo(version.path,{ffprobe,run});
      const out=metadata.hasAudio?String(await run(ffmpeg,['-nostdin','-hide_banner','-v','error','-i',version.path,'-map','0:a:0','-c','copy','-f','md5','-'],{timeoutMs:600000})):'';
      const md5=out.match(/MD5=([a-f0-9]{32})/)?.[1]??null;
      return {sha256:version.sha256,...metadata,audioMd5:md5};
    },
    /** Read-only suggestions: silence candidates and optional imported transcript retakes. Never renders. */
    async analyze(profile,input={}){
      if(closed)throw new Error('Media executor is stopping.');if(analyses.size)throw new Error('Wait for the current analysis to finish.');
      const options=silenceOptions(input.options),controller=new AbortController();analyses.add(controller);
      try{
        const {job,current}=reviewed(profile,input);await source(job);
        const metadata=await probeVideo(job.inputPath,{ffprobe,run,signal:controller.signal});assertAnalyzable(metadata);
        // The voice source (camera, or the screen of a pair) is what silences/transcript are measured on; times go to the camera timeline.
        const vj=voiceJob(job),voiceMeta=vj===job?metadata:await screenMetadata(job,controller.signal),shift=voiceShift(job);
        const toCamera=list=>shift?list.map(item=>({...item,start:Math.max(0,item.start+shift),end:Math.min(metadata.duration,item.end+shift)})).filter(item=>item.end>item.start):list;
        const limitations=[];let silences=[],measured=[],candidates=[],transcript=null;
        if(input.transcript==='local'){if(voiceMeta.hasAudio){try{const local=await runTranscription(profile,vj,voiceMeta,input.language??'pt',controller.signal);transcript=local.noSpeech?null:shift?shiftTranscript(local,{shift,duration:metadata.duration}):local;if(local.noSpeech)limitations.push('noSpeech');}catch(error){if(closed||controller.signal.aborted)throw error;limitations.push('transcriptionFailed');}}}
        else transcript=validateTranscript(input.transcript,metadata.duration);
        if(!voiceMeta.hasAudio)limitations.push('noAudio');
        else{measured=parseSilences(await run(ffmpeg,silenceDetectArgs(vj.inputPath,options),{signal:controller.signal,timeoutMs:900000}),voiceMeta.duration);db.prepare('INSERT OR REPLACE INTO editorial_silences VALUES (?,?,?,?,?)').run(profile,vj.versionId,vj.sha256,JSON.stringify({options,silences:measured}),stamp());silences=toCamera(measured);
          // Screen voice: camera time before/after the screen recording has no voice at all (treated as removable, never as speech).
          if(shift){const lo=Math.max(0,shift),hi=Math.min(metadata.duration,shift+voiceMeta.duration);if(lo>0)silences.unshift({start:0,end:lo});if(hi<metadata.duration)silences.push({start:hi,end:metadata.duration});silences.sort((a,b)=>a.start-b.start);limitations.push('voiceFromScreen');}
          const found=silenceCandidates(silences,{duration:metadata.duration,padding:options.padding});candidates=found.candidates;limitations.push(...found.limitations);}
        if(!transcript)limitations.push('transcriptUnavailable');
        let audio=null;if(voiceMeta.hasAudio){try{audio=await measureAudio(profile,vj,voiceMeta,vj===job?silences:measured,controller.signal);}catch(error){if(closed||controller.signal.aborted)throw error;}}
        if(transcript){
          // Pauses after a question/exclamation or before a number keep a short beat (labelled as inferred); speech suggestions are never pre-selected.
          if(input.naturalPauses!==false)candidates=refineSilenceCandidates(candidates,{transcript,silences,duration:metadata.duration});
          // Word-cut edges snap to measured low-energy points when the voice track is available; otherwise they are transcript-only (lower confidence).
          let track=null;if(vj===job&&metadata.hasAudio&&Array.isArray(transcript.words)&&transcript.words.length){try{track=await voiceOf(job,controller.signal);}catch(error){if(closed||controller.signal.aborted)throw error;}}
          const speech=speechEditCandidates({transcript,duration:metadata.duration,track});candidates=[...candidates,...speech.candidates];for(const item of speech.limitations)if(!limitations.includes(item))limitations.push(item);
        }
        if(candidates.length>smartEditLimits.maxCandidates){candidates=candidates.slice(0,smartEditLimits.maxCandidates);if(!limitations.includes('candidatesTruncated'))limitations.push('candidatesTruncated');}
        if(closed||controller.signal.aborted)throw new Error('Analysis canceled.');authorize(job);
        let suggested=keptSegments(candidates.filter(item=>item.selected),metadata.duration);
        // Screen voice: suggestions never keep camera time outside the screen recording (the voice would be missing there).
        if(shift){const lo=Math.max(0,shift),hi=Math.min(metadata.duration,shift+voiceMeta.duration);suggested=suggested.map(item=>({start:Math.max(item.start,lo),end:Math.min(item.end,hi)})).filter(item=>item.end-item.start>0.05);}
        return {revision:current.revision,analysis:{source:{contentId:job.contentId,assetId:job.assetId,versionId:job.versionId,sha256:job.sha256},metadata,options,limitations,silences,candidates,transcript,audio,suggestedSegments:suggested}};
      }finally{analyses.delete(controller);}
    },
    /** Local whisper.cpp transcription of the verified source version (cached). */
    /** `signal` only from in-process callers (production captions); HTTP bodies cannot carry one. */
    async transcribe(profile,input={},{signal}={}){
      if(closed)throw new Error('Media executor is stopping.');if(input.language!==undefined&&typeof input.language!=='string')throw new Error('Unsupported transcription language.');
      const {job,current}=reviewed(profile,input);await source(job);const metadata=await probeVideo(job.inputPath,{ffprobe,run,signal});assertAnalyzable(metadata);
      // Camera + screen with the screen as voice: the screen is transcribed (cached by ITS version) and moved to the camera timeline.
      const vj=voiceJob(job),voiceMeta=vj===job?metadata:await screenMetadata(job,signal);
      const heard=await runTranscription(profile,vj,voiceMeta,input.language??'pt',signal),transcript=vj===job?heard:shiftTranscript(heard,{shift:voiceShift(job),duration:metadata.duration});
      authorize(job);return {revision:current.revision,source:{contentId:job.contentId,assetId:job.assetId,versionId:job.versionId,sha256:job.sha256},...(vj!==job?{voice:{assetId:vj.assetId,versionId:vj.versionId,sha256:vj.sha256,shift:voiceShift(job)}}:{}),transcript};
    },
    /** Read-only comparison data for an automatic edit: raw vs edited, every cut and any recognized speech inside it. */
    async review(profile,{jobId}={}){
      const job=succeededAdvanced(profile,jobId),current=state(profile),assets=current?.state.assets??[];
      const output=assets.find(item=>item.id===job.result.assetId),subtitles=assets.find(item=>item.subtitlesForJobId===job.id);
      const sourceAsset=assets.find(item=>item.id===job.assetId),sourceCurrent=sourceAsset?.currentVersionId===job.versionId&&sourceAsset.versions.find(item=>item.id===job.versionId)?.sha256===job.sha256;
      const transcript=storedTranscript(profile,job),speech=transcript&&!transcript.noSpeech?transcript.segments:[];
      const silenceRow=db.prepare('SELECT data_json FROM editorial_silences WHERE profile_id=? AND version_id=? AND sha256=?').get(profile,job.versionId,job.sha256),silenceAnalysis=silenceRow?JSON.parse(silenceRow.data_json):null;
      return {revision:current.revision,job:{id:job.id,planHash:job.planHash,createdAt:job.createdAt},sourceCurrent,
        source:{contentId:job.contentId,assetId:job.assetId,versionId:job.versionId,sha256:job.sha256,duration:job.inputMetadata?.duration},
        output:output?{assetId:output.id,versionId:output.currentVersionId,duration:job.result.metadata.duration}:null,
        subtitles:subtitles?{assetId:subtitles.id,name:subtitles.name}:null,
        plan:job.plan,kept:outputTimelineOf(job.plan.segments),cuts:cutReview(job.plan.segments,job.inputMetadata?.duration??job.duration,speech,silenceAnalysis?.silences,Array.isArray(transcript?.words)&&transcript.words.length?{words:transcript.words}:undefined),
        audio:storedAudio(profile,job),speechCandidates:speech.length?speechEditCandidates({transcript,duration:job.inputMetadata?.duration??job.duration}).candidates.filter(item=>item.kind!=='possibleRetake').map(({id,kind,start,end,label,reason,confidence,evidence})=>({id,kind,start,end,label,reason,confidence,evidence})):[],silenceOptions:silenceAnalysis?.options??null,silences:silenceAnalysis?.silences??null,
        transcript:transcript&&!transcript.noSpeech?{origin:transcript.origin,language:transcript.language,timing:transcript.timing??'sentences',segments:speech,...(Array.isArray(transcript.words)&&transcript.words.length?{words:transcript.words}:{})}:null,
        possibleRetakes:retakeCandidates(speech.length?{segments:speech}:null).map(({id,start,end,label,reason})=>({id,start,end,label,reason}))};
    },
    /**
     * Natural edges for a removal chosen in the transcript: snaps to measured low-energy points between words (voice
     * track) or to stored pauses, else to transcript word edges; refuses edges that would fall inside speech. Read-only.
     */
    async snap(profile,input={}){
      if(closed)throw new Error('Media executor is stopping.');if(!Number.isFinite(input.start)||!Number.isFinite(input.end)||input.end<=input.start)throw new Error('Choose a valid interval.');
      const {job,current}=reviewed(profile,input);await source(job);const metadata=await probeVideo(job.inputPath,{ffprobe,run});assertAnalyzable(metadata);
      const words=speechWords(storedTranscript(profile,job),metadata.duration);if(!words.length)return {revision:current.revision,result:{rejected:'noWordsOrSilence'}};
      let track=null;if(metadata.hasAudio){try{track=await voiceOf(job);}catch{/* transcript-only edges, reported by boundary */}}
      const row=db.prepare('SELECT data_json FROM editorial_silences WHERE profile_id=? AND version_id=? AND sha256=?').get(profile,job.versionId,job.sha256);
      const result=snapRemoval({start:input.start,end:input.end},words,{duration:metadata.duration,track,silences:row?JSON.parse(row.data_json).silences:[]});
      authorize(job);return {revision:current.revision,result};
    },
    /** Measures the source audio (pause noise floor, levels) for the opt-in voice treatment. Cached per version; read-only. */
    async audio(profile,input={}){
      if(closed)throw new Error('Media executor is stopping.');if(analyses.size)throw new Error('Wait for the current analysis to finish.');
      const controller=new AbortController();analyses.add(controller);
      try{
        const {job,current}=reviewed(profile,input);await source(job);const metadata=await probeVideo(job.inputPath,{ffprobe,run,signal:controller.signal});assertAnalyzable(metadata);
        let audio=storedAudio(profile,job);
        if(!audio){const row=db.prepare('SELECT data_json FROM editorial_silences WHERE profile_id=? AND version_id=? AND sha256=?').get(profile,job.versionId,job.sha256);
          const silences=row?JSON.parse(row.data_json).silences:metadata.hasAudio?parseSilences(await run(ffmpeg,silenceDetectArgs(job.inputPath,silenceOptions()),{signal:controller.signal,timeoutMs:900000}),metadata.duration):[];
          audio=await measureAudio(profile,job,metadata,silences,controller.signal);}
        authorize(job);return {revision:current.revision,audio};
      }finally{analyses.delete(controller);}
    },
    /** Creates the CapCut subtitle file for an automatic edit, transcribing the source locally first if needed. */
    async subtitles(profile,{jobId,language='pt'}={}){
      const job=succeededAdvanced(profile,jobId);if(job.imported)throw new Error('Imported history does not authorize local work. Export a new edit first.');if(state(profile)?.state.assets?.some(item=>item.subtitlesForJobId===job.id))throw new Error('Subtitles already exist for this edit.');
      const {job:base}=reviewed(profile,job);await source(base);const metadata=await probeVideo(job.inputPath,{ffprobe,run});
      const transcript=await runTranscription(profile,job,metadata,language);if(transcript.noSpeech)throw new Error('No speech was recognized in this video.');
      const file=await writeSubtitles(job,join(job.outputDirectory,`subtitles-${Date.now()}.srt`));if(!file)throw new Error('No speech remains in the edited video.');
      db.exec('BEGIN IMMEDIATE');try{const current=authorize(job);current.state.assets.push(subtitleAsset(job,file,job.result.assetId));const content=current.state.contents.find(item=>item.id===job.contentId);content.assetIds=current.state.assets.filter(item=>item.contentId===job.contentId).map(item=>item.id);db.prepare('UPDATE editorial_state SET revision=?,state_json=?,updated_at=? WHERE profile_id=?').run(current.revision+1,JSON.stringify(current.state),stamp(),profile);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
      return state(profile);
    },
    /** Streams a linked video version to the app's own player (Range supported). The path never comes from the request. */
    async streamVideo(profile,url,request,response){
      const current=state(profile),asset=current?.state.assets?.find(item=>item.id===url.searchParams.get('assetId')&&item.contentId===url.searchParams.get('contentId')),version=asset?.versions.find(item=>item.id===url.searchParams.get('versionId'));
      if(asset?.kind!=='video'||!version)throw new Error('Choose a linked video version.');
      const info=await stat(version.path),changed=()=>Object.assign(new Error('The video changed on disk. Verify it again.'),{status:409});if(!info.isFile()||info.size!==version.size)throw changed();
      // The player shows exactly the reviewed version: hashed once per file state (path,size,mtime,ctime — any write changes ctime), then Range reads reuse it.
      const key=`${version.path}|${info.size}|${info.mtimeMs}|${info.ctimeMs}`;if(!streamDigests.has(key)){if(streamDigests.size>=32)streamDigests.delete(streamDigests.keys().next().value);streamDigests.set(key,hashFile(version.path).catch(error=>{streamDigests.delete(key);throw error;}));}
      if(await streamDigests.get(key)!==version.sha256)throw changed();
      const type={'.mp4':'video/mp4','.m4v':'video/mp4','.mov':'video/quicktime','.webm':'video/webm','.mkv':'video/x-matroska'}[version.path.slice(version.path.lastIndexOf('.')).toLowerCase()]??'application/octet-stream';
      await sendFile(version.path,info,type,request,response);
    },
    /**
     * Preview of a reviewed plan BEFORE export, for the Remotion Player. The proxy is cut by the same `cutFilter` as the
     * export (same segments, format and audio processing) at a reduced size, and the SFX of the motion plan are mixed by
     * the same `sfxMixFilter` (ducked by the voice), so its sound is the processed sound of the final file. The returned
     * `props` are exactly the composition props the renderer would receive (`resolveAnimations`). Read-only: the
     * original is never touched and nothing is delivered. One preview at a time; a new one or `cancelPreview` aborts it.
     */
    async preview(profile,input={}){
      if(closed)throw new Error('Media executor is stopping.');
      previewing?.abort();const controller=new AbortController();previewing=controller;const signal=controller.signal;
      const temp=[];
      try{
        const {job,current}=reviewed(profile,input);await source(job);
        const metadata=await probeVideo(job.inputPath,{ffprobe,run,signal});assertAnalyzable(metadata);
        const {plan,outputDuration}=validatePlan(input.plan,metadata.duration),hash=planHash(job,plan);checkPlan(profile,job,plan);
        const folder=join(directory,profile,'previews');await mkdir(folder,{recursive:true});
        const {cutKey}=previewKeys(job.sha256,plan),cutPath=join(folder,`${cutKey}.cut.mp4`);
        if(!await stat(cutPath).then(info=>info.isFile()&&info.size>0,()=>false)){
          const part=join(folder,`${cutKey}.${randomUUID()}.partial.mp4`);temp.push(part);
          const filter=`${cutFilter(plan.segments,{hasAudio:metadata.hasAudio,format:plan.format,normalizeAudio:plan.normalizeAudio,audio:plan.audio,motion:plan.motion,source:metadata.display})};[vout]${PREVIEW_SCALE}[vprev]`;
          await run(ffmpeg,['-nostdin','-hide_banner','-v','error','-n','-protocol_whitelist','file,pipe','-i',job.inputPath,'-filter_complex',filter,'-map','[vprev]',...(metadata.hasAudio?['-map','[aout]','-c:a','aac','-ar','48000']:[]),'-c:v','libx264','-preset','ultrafast','-crf','26','-g','12','-pix_fmt','yuv420p','-movflags','+faststart',part],{signal,timeoutMs:1800000});
          if(signal.aborted)throw new Error('Preview canceled.');await rename(part,cutPath);
        }
        const proxy=await probeVideo(cutPath,{ffprobe,run,signal});if(!Number.isFinite(proxy.fps))throw new Error('The edited video frame rate is unreadable.');
        const size=editedSize(plan,metadata,proxy),videoMeta={...size,fps:proxy.fps,durationSeconds:proxy.duration,hasAudio:proxy.hasAudio};
        // Without overlays the export is the plain cut (no Remotion pass): the composition then only shows the video.
        const props=needsAnimation(plan)?resolveAnimations(remotionAnimations(plan,{source:metadata.display}),videoMeta,{assetIds:Object.keys(assetFilesFor(profile,job,plan)??{})}):{theme:plan.theme??'dark',accent:'#2f6bff'},sfx=props.motion?.sfx??[];
        const canMix=proxy.hasAudio&&[1,2].includes(proxy.audioChannels)&&proxy.audioSampleRate>=8000,{key}=previewKeys(job.sha256,plan,canMix?sfx:[]);
        const finalPath=key===cutKey?cutPath:join(folder,`${key}.mp4`);
        if(key!==cutKey&&!await stat(finalPath).then(info=>info.isFile()&&info.size>0,()=>false)){
          const bed=join(folder,`${key}.${randomUUID()}.sfx.wav`),part=join(folder,`${key}.${randomUUID()}.partial.mp4`);temp.push(bed,part);
          await writeFile(bed,sfxBedWav(sfx,proxy.duration,proxy.audioSampleRate),{flag:'wx'});
          await run(ffmpeg,['-nostdin','-hide_banner','-v','error','-n','-i',cutPath,'-i',cutPath,'-i',bed,'-filter_complex',sfxMixFilter({sampleRate:proxy.audioSampleRate,channels:proxy.audioChannels}),'-map','0:v:0','-map','[aout]','-c:v','copy','-c:a','aac','-ar',String(proxy.audioSampleRate),'-ac',String(proxy.audioChannels),'-movflags','+faststart',part],{signal,timeoutMs:900000});
          if(signal.aborted)throw new Error('Preview canceled.');await rename(part,finalPath);
        }
        const file=await stat(finalPath),digest=await hashFile(finalPath);
        await writeFile(join(folder,`${key}.json`),JSON.stringify({file:key===cutKey?'cut':'mixed',contentId:job.contentId,assetId:job.assetId,versionId:job.versionId,sourceSha256:job.sha256,size:file.size,sha256:digest,planHash:hash,createdAt:stamp()}));
        // Bounded cache: keep the 6 most recent previews of this profile.
        const names=await readdir(folder).catch(()=>[]),entries=await Promise.all(names.filter(name=>/^[a-f0-9]{64}\.json$/.test(name)).map(async name=>({key:name.slice(0,64),at:(await stat(join(folder,name)).catch(()=>({mtimeMs:0}))).mtimeMs})));
        for(const old of entries.sort((a,b)=>b.at-a.at).slice(6))if(old.key!==key)for(const suffix of ['.json','.mp4','.cut.mp4'])await unlink(join(folder,old.key+suffix)).catch(()=>{});
        if(signal.aborted)throw new Error('Preview canceled.');authorize(job);
        const {motion:_motion,...overlays}=props;void _motion;
        return {revision:current.revision,planHash:hash,outputDuration,
          preview:{id:key,size:file.size,width:proxy.width,height:proxy.height,audio:!proxy.hasAudio?'none':key!==cutKey?'processed-sfx':'processed',sfxSkipped:sfx.length>0&&!canMix},
          composition:{...size,fps:proxy.fps,durationSeconds:proxy.duration,durationInFrames:Math.max(1,Math.round(proxy.duration*proxy.fps))},
          props:{...props,width:size.width,height:size.height,fps:proxy.fps,durationSeconds:proxy.duration},overlays:Object.keys(overlays).filter(name=>!['theme','accent'].includes(name))};
      }catch(error){if(signal.aborted&&!closed)throw Object.assign(new Error('Preview canceled.'),{status:409});throw error;}
      finally{for(const path of temp)await unlink(path).catch(()=>{});if(previewing===controller)previewing=null;}
    },
    cancelPreview(){const running=Boolean(previewing);previewing?.abort();return {canceled:running};},
    /**
     * Authoring (editor tools): the edited composition of a plan revision at preview scale, rendered by the REAL motion
     * engine (same props/assets as the export). Read-only, nothing is delivered; files stay in this profile's authoring folder.
     */
    async authoring(profile,input={},{signal}={}){
      if(closed)throw new Error('Media executor is stopping.');
      const {job}=reviewed(profile,input);await source(job);
      const metadata=await probeVideo(job.inputPath,{ffprobe,run,signal});assertAnalyzable(metadata);job.cameraDuration=metadata.duration;
      const screenMeta=job.pair?await screenMetadata(job,signal):null;
      const {plan,outputDuration}=validatePlan(input.plan,metadata.duration);checkPlan(profile,job,plan);
      const folder=join(directory,profile,'authoring',String(input.folder??'session').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80)||'session');
      const animations=plan.storyboard||needsAnimation(plan)?remotionAnimations(plan,{source:metadata.display}):{},assetFiles=assetFilesFor(profile,job,plan);
      const composition=async()=>{const proxy=await cutProxy(profile,job,metadata,plan,signal);return {...proxy,animations:withScreen(animations,job,proxy.screen),...(proxy.screen?{screenPath:proxy.screen.path}:{}),...(assetFiles?{assetFiles}:{}),cutsAt:cutsOf(plan)};};
      const tags={revision:Number.isInteger(input.revision)?input.revision:0,planHash:planHash(job,plan).slice(0,16)};
      if(input.kind==='stills'){
        if(typeof stills!=='function')throw new Error('The motion engine cannot render stills on this computer.');
        const c=await composition(),fps=c.metadata.fps,total=Math.max(1,Math.round(c.metadata.durationSeconds*fps));
        const frames=Array.isArray(input.times)?[...new Set(input.times.map(t=>Math.min(total-1,Math.max(0,Math.round(t*fps)))))].slice(0,16):undefined;
        const result=await stills({inputPath:c.cutPath,outDir:join(folder,`stills-${randomUUID()}`),metadata:c.metadata,animations:c.animations,...(c.screenPath?{screenPath:c.screenPath}:{}),...(c.assetFiles?{assetFiles:c.assetFiles}:{}),...(frames?{frames}:{perScene:3}),...(!frames&&Array.isArray(input.sceneIds)&&input.sceneIds.length?{sceneIds:input.sceneIds.filter(id=>typeof id==='string').slice(0,16)}:{}),...(Number.isInteger(input.maxImages)?{maxImages:Math.min(60,Math.max(1,input.maxImages))}:{}),tags,cutsAt:c.cutsAt,signal});
        authorize(job);return {outputDuration,metadata:c.metadata,stills:result.stills,contactSheets:result.contactSheets??[],storyboard:result.storyboard};
      }
      if(input.kind==='preview'){
        if(typeof animate!=='function')throw new Error('The animation engine is unavailable.');
        const c=await composition(),fps=c.metadata.fps,total=Math.max(1,Math.round(c.metadata.durationSeconds*fps));
        const start=Math.min(total-1,Math.max(0,Math.round(Number(input.start)*fps))),end=Math.min(total-1,start+Math.max(1,Math.round(Math.min(15,Number(input.duration))*fps))-1);
        if(!Number.isFinite(start)||!Number.isFinite(end))throw new Error('Choose a preview window on the edited timeline.');
        await mkdir(folder,{recursive:true});const out=join(folder,`preview-${randomUUID()}.mp4`);
        await animate({inputPath:c.cutPath,outputPath:out,metadata:c.metadata,animations:c.animations,...(c.screenPath?{screenPath:c.screenPath}:{}),...(c.assetFiles?{assetFiles:c.assetFiles}:{}),frameRange:[start,end],qaPolicy:'report',cutsAt:c.cutsAt,signal});
        const info=await stat(out),digest=await hashFile(out),probe=await probeVideo(out,{ffprobe,run,signal});authorize(job);
        return {path:out,sha256:digest,size:info.size,duration:probe.duration,start:start/fps,width:probe.width,height:probe.height};
      }
      if(input.kind==='source-sheet'){const sheet=await grabSheet(job.inputPath,{start:Number(input.start)||0,end:Number.isFinite(Number(input.end))?Math.min(metadata.duration,Number(input.end)):metadata.duration,count:input.count,folder,signal});authorize(job);return sheet;}
      if(input.kind==='source-frames'){const times=(input.times??[]).filter(Number.isFinite).slice(0,8);const frames=await grabFrames(job.inputPath,times,{maxWidth:input.maxWidth,folder,signal});authorize(job);return {frames};}
      // Screen frames for the director: times on the CAMERA timeline, mapped to the screen recording (screenTime = cameraTime − offset).
      if(input.kind==='screen-frames'||input.kind==='screen-sheet'){
        if(!job.pair)throw new Error('This edit has no screen recording.');
        const o=job.pair.offsetSeconds,inside=t=>t-o>=0&&t-o<=screenMeta.duration;
        if(input.kind==='screen-frames'){const times=(input.times??[]).filter(Number.isFinite).slice(0,8),valid=times.filter(inside);const frames=await grabFrames(job.screen.inputPath,valid.map(t=>t-o),{maxWidth:input.maxWidth,folder,signal});authorize(job);return {frames:frames.map(item=>({...item,time:Math.round((item.time+o)*1000)/1000})),outside:times.filter(t=>!inside(t))};}
        const lo=Math.max(Number(input.start)||0,o),hi=Math.min(Number.isFinite(Number(input.end))?Number(input.end):metadata.duration,o+screenMeta.duration);if(hi-lo<0.2)throw new Error('No screen recording in this camera interval.');
        const sheet=await grabSheet(job.screen.inputPath,{start:lo-o,end:hi-o,count:input.count,folder,signal});authorize(job);return {...sheet,times:sheet.times.map(t=>Math.round((t+o)*1000)/1000)};
      }
      if(input.kind==='context'){authorize(job);
        const pair=job.pair?(()=>{const map=mapScreenSegments(plan.segments,{offsetSeconds:job.pair.offsetSeconds,screenDuration:screenMeta.duration});return {roles:{camera:'the primary timeline (cuts are camera times)',screen:'the real screen recording, follows the camera through the offset'},voice:job.pair.voice,layout:job.pair.layout,defaultSceneScreen:defaultScreenMode(job.pair.layout),offsetSeconds:job.pair.offsetSeconds,convention:'screenTime = cameraTime − offsetSeconds',screen:{duration:screenMeta.duration,width:screenMeta.display?.width??screenMeta.width,height:screenMeta.display?.height??screenMeta.height,hasAudio:screenMeta.hasAudio},overlap:overlapOf({cameraDuration:metadata.duration,screenDuration:screenMeta.duration,offsetSeconds:job.pair.offsetSeconds}),editedScreenWindows:map.windows.slice(0,60),screenSeconds:map.screenSeconds,gapSeconds:map.gapSeconds};})():undefined;
        return {metadata:{duration:metadata.duration,width:metadata.display?.width??metadata.width,height:metadata.display?.height??metadata.height,fps:metadata.fps,hasAudio:metadata.hasAudio},outputDuration,assets:libraryAssets(profile,job),...(pair?{pair}:{})};}
      throw new Error('Unknown authoring request.');
    },
    /** Frames of a file this host produced for authoring (preview window). Only paths under this profile's authoring folder. */
    async authoringFrames(profile,{path,times,maxWidth,sheet}={},{signal}={}){
      const root=join(directory,profile,'authoring');if(typeof path!=='string'||!path.startsWith(root))throw new Error('Unknown authoring file.');
      if(sheet)return grabSheet(path,{...sheet,folder:join(root,'frames'),signal});
      return {frames:await grabFrames(path,(times??[]).filter(Number.isFinite).slice(0,8),{maxWidth,folder:join(root,'frames'),signal})};
    },
    /** Library aliases the editor sees (asset1..assetN) for storyboard image/video layers. */
    libraryAssets(profile,input={}){const {job}=reviewed(profile,input);return libraryAssets(profile,job);},
    /** Streams a preview proxy of THIS profile. Only an id (hash) comes from the request; content/asset must match the preview's own metadata. */
    async streamPreview(profile,url,request,response){
      const id=String(url.searchParams.get('id')??''),missing=()=>Object.assign(new Error('Preview not found. Prepare it again.'),{status:404});
      if(!/^[a-f0-9]{64}$/.test(id))throw missing();
      const folder=join(directory,profile,'previews'),meta=await readFile(join(folder,`${id}.json`),'utf8').then(JSON.parse,()=>null);
      if(!meta||meta.contentId!==url.searchParams.get('contentId')||meta.assetId!==url.searchParams.get('assetId'))throw missing();
      const path=join(folder,meta.file==='cut'?`${id}.cut.mp4`:`${id}.mp4`),info=await stat(path).catch(()=>null);if(!info?.isFile()||info.size!==meta.size)throw missing();
      const key=`${path}|${info.size}|${info.mtimeMs}|${info.ctimeMs}`;if(!streamDigests.has(key)){if(streamDigests.size>=32)streamDigests.delete(streamDigests.keys().next().value);streamDigests.set(key,hashFile(path).catch(error=>{streamDigests.delete(key);throw error;}));}
      if(await streamDigests.get(key)!==meta.sha256)throw Object.assign(new Error('The preview changed on disk. Prepare it again.'),{status:409});
      await sendFile(path,info,'video/mp4',request,response);
    },
    /** Read-only plan preview. The returned planHash is what an advanced export must present with authorize:true. */
    async plan(profile,input={}){
      const {job,current}=reviewed(profile,input);await source(job);
      const metadata=await probeVideo(job.inputPath,{ffprobe,run});assertAnalyzable(metadata);job.cameraDuration=metadata.duration;if(job.pair)await screenMetadata(job);
      const {plan,outputDuration}=validatePlan(input.plan,metadata.duration);checkPlan(profile,job,plan);authorize(job);
      return {revision:current.revision,versionId:job.versionId,sha256:job.sha256,plan,planHash:planHash(job,plan),outputDuration,sourceDuration:metadata.duration,removed:removedSegments(plan.segments,metadata.duration)};
    },
    /**
     * Read-only motion plan for an automatic edit: word timings of the cached local transcript plus voice emphasis MEASURED
     * on this source version's audio, selected on the edited timeline of `segments`. Missing audio or word timings are
     * reported as limitations, never simulated. The result goes into the edit plan as `motion` (then hashed and reviewed).
     */
    async motion(profile,input={}){
      if(closed)throw new Error('Media executor is stopping.');if(analyses.size)throw new Error('Wait for the current analysis to finish.');
      const intensity=input.intensity??'balanced';if(!motionIntensities.includes(intensity))throw new Error('Choose subtle, balanced, intense or no motion.');
      const highlights=input.highlights??[];if(!Array.isArray(highlights)||highlights.length>6||highlights.some(item=>!safeMotionText(item,60)))throw new Error('Highlights must be up to 6 short phrases.');
      const reserved=input.reserved??[];if(!Array.isArray(reserved)||reserved.length>3||reserved.some(item=>!Number.isFinite(item?.start)||!Number.isFinite(item?.end)||item.end<item.start))throw new Error('Invalid reserved windows.');
      const controller=new AbortController();analyses.add(controller);
      try{
        const {job,current}=reviewed(profile,input);await source(job);
        const metadata=await probeVideo(job.inputPath,{ffprobe,run,signal:controller.signal});assertAnalyzable(metadata);
        const {plan}=validatePlan({segments:input.segments},metadata.duration),limitations=[];
        let transcript=storedTranscript(profile,job);
        if(!transcript&&transcriber&&metadata.hasAudio&&input.transcribe!==false){try{transcript=await runTranscription(profile,job,metadata,input.language??'pt',controller.signal);}catch(error){if(closed||controller.signal.aborted)throw error;}}
        const {timing,words:heard}=transcriptWords(transcript);let prosody=null,words=heard;
        if(metadata.hasAudio&&words.length&&intensity!=='off'){
          try{const track=await voiceOf(job,controller.signal);words=alignWordsToVoice(heard,track);prosody=wordProsody(track,words);}
          catch(error){if(closed||controller.signal.aborted)throw error;limitations.push('voiceUnavailable');}
        }
        const motion=normalizeMotion(buildMotionPlan({words,wordTiming:timing,prosody,segments:plan.segments,intensity,highlights,reserved,limitations}),plan.segments);
        if(closed||controller.signal.aborted)throw new Error('Analysis canceled.');authorize(job);
        return {revision:current.revision,motion,summary:describeMotion(motion,String(input.language??'pt')!=='en')};
      }finally{analyses.delete(controller);}
    },
    enqueue(profile,input){
      if(closed)throw new Error('Media executor is stopping.');
      if(input?.mode==='advanced')return enqueueAdvanced(profile,input);
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
    /** Probe of a local file the caller already verified (camera/screen of a chat request). Read-only. */
    async probeLocal(path,{signal}={}){if(closed)throw new Error('Media executor is stopping.');const metadata=await probeVideo(path,{ffprobe,run,signal});return {duration:metadata.duration,width:metadata.display?.width??metadata.width,height:metadata.display?.height??metadata.height,fps:metadata.fps,hasAudio:metadata.hasAudio};},
    /** Local offset measurement of a camera+screen pair from their common audio (bounded decode, cooperative correlation). */
    async measurePair({camera,screen},{signal}={}){if(closed)throw new Error('Media executor is stopping.');return measureOffset({ffmpeg,camera,screen,signal});},
    /**
     * Short CHECK preview of a pair at an offset (never the edit): camera | screen side by side for `duration` s starting at a
     * camera time inside the overlap, with BOTH audios mixed so a wrong offset is heard as an echo. Cached by both hashes+offset.
     */
    async pairPreview(profile,{camera,screen,offsetSeconds,start,duration=6},{signal}={}){
      if(closed)throw new Error('Media executor is stopping.');
      const folder=join(directory,profile,'pair-previews');await mkdir(folder,{recursive:true});
      const length=Math.min(8,Math.max(2,duration)),key=sha(JSON.stringify({v:1,camera:camera.sha256,screen:screen.sha256,offsetSeconds:Math.round(offsetSeconds*1000)/1000,start:Math.round(start*1000)/1000,length})),out=join(folder,`${key}.mp4`);
      if(!await stat(out).then(info=>info.isFile()&&info.size>0,()=>false)){
        const part=join(folder,`${key}.${randomUUID()}.partial.mp4`),both=camera.hasAudio&&screen.hasAudio,audio=both?'[0:a:0][1:a:0]amix=inputs=2:duration=shortest:normalize=1[a]':camera.hasAudio?'[0:a:0]anull[a]':screen.hasAudio?'[1:a:0]anull[a]':'';
        const filter=`[0:v:0]scale=-2:360,setsar=1,fps=30,format=yuv420p[c];[1:v:0]scale=-2:360,setsar=1,fps=30,format=yuv420p[s];[c][s]hstack=inputs=2[v]${audio?`;${audio}`:''}`;
        try{await run(ffmpeg,['-nostdin','-hide_banner','-v','error','-n','-ss',String(Math.max(0,start)),'-t',String(length),'-i',camera.path,'-ss',String(Math.max(0,start-offsetSeconds)),'-t',String(length),'-i',screen.path,'-filter_complex',filter,'-map','[v]',...(audio?['-map','[a]','-c:a','aac','-ar','48000']:[]),'-c:v','libx264','-preset','veryfast','-crf','26','-pix_fmt','yuv420p','-movflags','+faststart','-shortest',part],{signal,timeoutMs:180000});
          if(signal?.aborted)throw new Error('Preview canceled.');await rename(part,out);}finally{await unlink(part).catch(()=>{});}
      }
      const info=await stat(out);return {path:out,sha256:await hashFile(out),size:info.size,start,duration:length};
    },
    async cancel(profile,id){const job=read(profile,id);if(!job||!['queued','running'].includes(job.status))throw new Error('This export is not active.');const running=active.get(id);if(!running)throw new Error('This export belongs to another executor.');job.status='canceled';job.error='Canceled by the user. Partial output is not a delivery.';job.updatedAt=stamp();put(job);running.controller.abort();await running.promise;return state(profile);},
    async retry(profile,id){const job=read(profile,id);if(!job||!['failed','interrupted'].includes(job.status)||active.size)throw new Error('This export cannot resume now.');if(job.imported)throw new Error('Imported history does not authorize execution. Review a new local export.');if(job.mode==='advanced'&&planHash(job,validatePlan(job.plan,Infinity).plan)!==job.planHash)throw new Error('The stored edit plan was altered. Review a new export.');if(job.mode==='advanced')checkAudio(profile,voiceJob(job),job.plan);if(db.prepare("SELECT id FROM editorial_media_jobs WHERE status IN ('queued','running')").get())throw new Error('Another export is active.');await source(job);if(job.attempt>=3)throw new Error('Three attempts reached. Review a new export.');
      if(['exported','verified'].includes(job.phase)){await stat(job.outputPath);await finish(job);return state(profile);}
      job.attempt++;job.progress=0;job.phase='queued';job.status='queued';job.error=undefined;job.ownerPid=process.pid;put(job);launch(job);return state(profile);
    },
    async close(){if(closed)return;for(const id of active.keys()){const job=db.prepare('SELECT data_json FROM editorial_media_jobs WHERE id=?').get(id);if(job){const value=JSON.parse(job.data_json);if(value.status==='running'){value.status='interrupted';value.error='App closed during export. Resume explicitly.';put(value);}}}closed=true;previewing?.abort();for(const controller of [...analyses,...transcriptions])controller.abort();for(const running of active.values())running.controller.abort();await Promise.allSettled([...active.values()].map(item=>item.promise));},
  };
}
