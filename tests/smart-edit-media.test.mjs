import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,statSync,utimesSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createServer} from 'node:http';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {runMediaProcess,probeVideo} from '../editorial-media.mjs';
import {inspectLocalAsset} from '../editorial-local-files.mjs';
import {parseSilences} from '../editorial-smart-edit.mjs';
import {executionSnapshot,restoreExecution} from '../editorial-execution-backup.mjs';
import {createRemotionAnimator} from '../editorial-animate.mjs';
import {getRemotionCapabilities} from '../editorial-remotion.mjs';

const inspect=path=>inspectLocalAsset(path,{stabilityMs:0});
// Tone in [0,1], [2.5,3.5], [5,6]; silence in [1,2.5] and [3.5,5]. Video is white while the tone plays and black in silence.
const silent='between(t,1,2.5)+between(t,3.5,5)';
const sources={
  tone:['-f','lavfi','-i','nullsrc=s=64x36:r=24,format=gray,geq=lum=\'if(between(T,1,2.5)+between(T,3.5,5),0,255)\'','-f','lavfi','-i',`aevalsrc='if(${silent},0,0.5*sin(2*PI*440*t))':s=48000`],
  toneHd:['-f','lavfi','-i','nullsrc=s=320x180:r=24,format=gray,geq=lum=\'if(between(T,1,2.5)+between(T,3.5,5),0,255)\'','-f','lavfi','-i',`aevalsrc='if(${silent},0,0.5*sin(2*PI*440*t))':s=48000`],
  mute:['-f','lavfi','-i','testsrc2=size=64x36:rate=24'],
  quiet:['-f','lavfi','-i','testsrc2=size=64x36:rate=24','-f','lavfi','-i','anullsrc=r=48000:cl=mono'],
};
async function fixture(kind='tone',{animate,animationCapabilities}={}){
  const root=mkdtempSync(join(tmpdir(),'smart-edit-')),path=join(root,'state.sqlite'),input=join(root,'original.mp4');
  await runMediaProcess('ffmpeg',['-nostdin','-v','error','-n',...sources[kind],'-t','6','-c:v','libx264','-pix_fmt','yuv420p',...(kind==='mute'?[]:['-c:a','aac']),input]);
  const file=await inspect(input),original=readFileSync(input),at=new Date().toISOString();
  let hold=false,encodes=0;const options={dbPath:path,getCurrentProfile:()=>'owner',mediaOptions:{inspect,animate,animationCapabilities,run:async(binary,args,opts)=>{
    if(binary==='ffmpeg'&&args.includes('-progress')){encodes++;if(hold)return new Promise((resolve,reject)=>{if(opts.signal.aborted)reject(new Error('Canceled'));else opts.signal.addEventListener('abort',()=>reject(new Error('Canceled')),{once:true})});}
    return runMediaProcess(binary,args,opts);
  }}};
  let bridge=createContentWorkflowBridge(options);const db=new DatabaseSync(path);
  db.prepare('INSERT INTO editorial_state VALUES (?,?,?,?)').run('owner',1,JSON.stringify({schemaVersion:1,topics:[{id:'topic',workspaceId:'space'}],contents:[{id:'content',workspaceId:'space',topicId:'topic',title:'Synthetic'}],runs:[],artifacts:[],approvals:[],assets:[{id:'source',workspaceId:'space',contentId:'content',name:file.name,kind:'video',role:'source',status:'available',currentVersionId:'v1',versions:[{id:'v1',...file,createdAt:at}],createdAt:at,updatedAt:at}]}),at);
  const ref={contentId:'content',assetId:'source',versionId:'v1',sha256:file.sha256};
  const state=()=>JSON.parse(db.prepare('SELECT state_json FROM editorial_state WHERE profile_id=?').get('owner').state_json);
  const revision=()=>db.prepare('SELECT revision FROM editorial_state').get().revision;
  const exportPlan=(preview,extra={})=>bridge.media.enqueue('owner',{mode:'advanced',authorize:true,revision:revision(),requestKey:'smart-one',...ref,plan:preview.plan,planHash:preview.planHash,...extra});
  return {root,input,file,original,db,ref,state,exportPlan,get bridge(){return bridge},encodes:()=>encodes,hold:value=>{hold=value},reopen:async()=>{await bridge.close();bridge=createContentWorkflowBridge(options)},close:async()=>{await bridge.close();db.close()}};
}
async function until(predicate){const deadline=Date.now()+20000;while(Date.now()<deadline){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,20))}throw new Error('Media work timed out');}
const job=(f,id)=>f.bridge.media.list('owner').find(item=>item.id===id);
async function streams(path){
  const data=JSON.parse(await runMediaProcess('ffprobe',['-v','error','-show_streams','-of','json',path]));
  return Object.fromEntries(data.streams.map(item=>[item.codec_type,Number(item.duration)]));
}
async function darkFrames(path){
  const out=await runMediaProcess('ffmpeg',['-nostdin','-v','error','-i',path,'-map','0:v:0','-vf','signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG:file=-','-f','null','-']);
  const times=[...out.matchAll(/pts_time:([0-9.]+)\s*\r?\nlavfi\.signalstats\.YAVG=([0-9.]+)/g)].filter(match=>Number(match[2])<60).map(match=>Number(match[1]));
  return times;
}

test('real FFmpeg analysis suggests padded silences and the advanced export cuts video and audio in sync',async()=>{
  const f=await fixture();try{
    const {analysis,revision}=await f.bridge.media.analyze('owner',{...f.ref,options:{thresholdDb:-40,minDuration:0.4,padding:0.15}});
    assert.equal(revision,1);assert.deepEqual(analysis.limitations,['transcriptUnavailable']);
    const near=(actual,expected)=>actual.length===expected.length&&actual.every((item,index)=>Math.abs(item.start-expected[index][0])<0.03&&Math.abs(item.end-expected[index][1])<0.03);
    assert(near(analysis.candidates,[[1.15,2.35],[3.65,4.85]])&&analysis.candidates.every(item=>item.kind==='silence'&&item.selected),JSON.stringify(analysis.candidates));
    assert(near(analysis.suggestedSegments,[[0,1.15],[2.35,3.65],[4.85,6]]),JSON.stringify(analysis.suggestedSegments));
    assert.equal(f.state().assets.length,1);assert.equal(f.encodes(),0);
    const preview=await f.bridge.media.plan('owner',{...f.ref,plan:{segments:analysis.suggestedSegments}});
    assert(Math.abs(preview.outputDuration-3.6)<0.05);assert(near(preview.removed,[[1.15,2.35],[3.65,4.85]]));
    // Nothing renders without explicit authorization, the reviewed hash and the current revision.
    assert.throws(()=>f.exportPlan(preview,{authorize:undefined}),/explicit authorization/);
    assert.throws(()=>f.exportPlan(preview,{authorize:'true'}),/explicit authorization/);
    assert.throws(()=>f.exportPlan(preview,{plan:{...preview.plan,segments:[{start:0,end:6}]}}),/differs from the reviewed plan/);
    assert.throws(()=>f.exportPlan(preview,{planHash:'0'.repeat(64)}),/differs from the reviewed plan/);
    assert.throws(()=>f.exportPlan(preview,{revision:0}),/changed/);
    assert.throws(()=>f.exportPlan(preview,{sha256:'0'.repeat(64)}),/source version changed/);
    assert.equal(f.encodes(),0);
    const queued=f.exportPlan(preview).job;assert.equal(queued.mode,'advanced');assert.equal(f.exportPlan(preview).job.id,queued.id);
    await until(()=>job(f,queued.id).status==='succeeded');
    const done=job(f,queued.id),output=done.result.file.path;assert.notEqual(output,f.input);
    const video=await probeVideo(output);assert(Math.abs(video.duration-3.6)<0.1,`duration ${video.duration}`);assert.equal(video.hasAudio,true);
    const lengths=await streams(output);assert(Math.abs(lengths.video-3.6)<0.1&&Math.abs(lengths.audio-3.6)<0.1,JSON.stringify(lengths));
    // Only the padding remains silent: around 1.0-1.3 s and 2.3-2.6 s of the output, in audio and video alike.
    const gaps=parseSilences(await runMediaProcess('ffmpeg',['-nostdin','-v','error','-i',output,'-map','0:a:0','-af','silencedetect=noise=-40dB:duration=0.2,ametadata=mode=print:file=-','-f','null','-']),3.6);
    assert.equal(gaps.length,2,JSON.stringify(gaps));for(const [gap,[start,end]] of gaps.map((gap,index)=>[gap,[[1,1.3],[2.3,2.6]][index]])){assert(Math.abs(gap.start-start)<0.06&&Math.abs(gap.end-end)<0.06,JSON.stringify(gaps));}
    const dark=await darkFrames(output);assert(dark.length>=10&&dark.length<=18,`dark frames ${dark.length}`);
    assert(dark.every(time=>time>=0.95&&time<=1.33||time>=2.25&&time<=2.63),JSON.stringify(dark));
    assert.deepEqual(readFileSync(f.input),f.original);assert.equal((await inspect(f.input)).sha256,f.file.sha256);
    const assets=f.state().assets;assert.equal(assets.length,2);assert.equal(assets[1].sourceAssetId,'source');assert.equal(assets[1].versions[0].sha256,done.result.file.sha256);
    assert.match(f.state().artifacts[0].data.summary,/3 kept segments/);
    assert.throws(()=>f.exportPlan({...preview,plan:{...preview.plan,segments:preview.plan.segments.slice(1)}},{planHash:undefined}),/request key and the reviewed plan hash/);
    const other=await f.bridge.media.plan('owner',{...f.ref,plan:{segments:preview.plan.segments.slice(1)}});
    assert.throws(()=>f.exportPlan(other),/already used for a different export/);
    // Legacy continuous cut keeps working beside the advanced mode.
    const legacy=f.bridge.media.enqueue('owner',{revision:f.db.prepare('SELECT revision FROM editorial_state').get().revision,requestKey:'legacy',...f.ref,start:0,duration:1}).job;
    await until(()=>job(f,legacy.id).status==='succeeded');assert(Math.abs((await probeVideo(job(f,legacy.id).result.file.path)).duration-1)<0.2);
  }finally{await f.close()}
});

test('no-audio and all-silent sources report limitations without inventing cuts; video-only plans still export',async()=>{
  const mute=await fixture('mute');try{
    const {analysis}=await mute.bridge.media.analyze('owner',mute.ref);
    assert.deepEqual(analysis.limitations,['noAudio','transcriptUnavailable']);assert.deepEqual(analysis.candidates,[]);assert.deepEqual(analysis.suggestedSegments,[{start:0,end:6}]);
    const preview=await mute.bridge.media.plan('owner',{...mute.ref,plan:{segments:[{start:0,end:1},{start:3,end:4.5}]}});
    const queued=mute.exportPlan(preview).job;await until(()=>job(mute,queued.id).status==='succeeded');
    const video=await probeVideo(job(mute,queued.id).result.file.path);assert(Math.abs(video.duration-2.5)<0.1);assert.equal(video.hasAudio,false);
  }finally{await mute.close()}
  const quiet=await fixture('quiet');try{
    const {analysis}=await quiet.bridge.media.analyze('owner',quiet.ref);
    assert.deepEqual(analysis.limitations,['allSilent','transcriptUnavailable']);assert.deepEqual(analysis.candidates,[]);
  }finally{await quiet.close()}
});

test('imported transcript adds unselected possible retakes; invalid options and plans are rejected before FFmpeg',async()=>{
  const f=await fixture();try{
    const {analysis}=await f.bridge.media.analyze('owner',{...f.ref,options:{thresholdDb:-40,minDuration:0.4},transcript:{segments:[{start:0,end:0.9,text:'Olá pessoal hoje'},{start:2.5,end:3.4,text:'Olá pessoal hoje vamos começar'},{start:5,end:6,text:'Até a próxima.'}]}});
    assert.equal(analysis.transcript.origin,'imported');assert(!analysis.limitations.includes('transcriptUnavailable'));
    const retake=analysis.candidates.find(item=>item.kind==='possibleRetake');assert.equal(retake.selected,false);assert.deepEqual([retake.start,retake.end],[0,0.9]);
    assert(analysis.suggestedSegments.some(item=>item.start===0),'possible retakes are never removed by default');
    await assert.rejects(()=>f.bridge.media.analyze('owner',{...f.ref,options:{thresholdDb:'-30dB,volume=9'}}),/Invalid silence/);
    await assert.rejects(()=>f.bridge.media.analyze('owner',{...f.ref,transcript:{segments:[{start:0,end:99,text:'x'}]}}),/Transcript/);
    await assert.rejects(()=>f.bridge.media.analyze('owner',{...f.ref,versionId:'v0'}),/source version changed/);
    await assert.rejects(()=>f.bridge.media.plan('owner',{...f.ref,plan:{segments:[{start:0,end:2},{start:1,end:3}]}}),/overlap/);
    await assert.rejects(()=>f.bridge.media.plan('owner',{...f.ref,plan:{segments:[{start:0,end:7}]}}),/fit the source/);
    await assert.rejects(()=>f.bridge.media.plan('owner',{...f.ref,plan:{segments:[{start:0,end:2}],animations:[{id:'t',kind:'title',text:'Oi',start:0,duration:1}]}}).then(preview=>f.exportPlan(preview)),/animation engine is unavailable/);
    assert.equal(f.encodes(),0);assert.equal((await f.bridge.media.capabilities()).animate,false);
  }finally{await f.close()}
});

test('injected animation engine receives only the cut video and must keep duration and audio',async()=>{
  const calls=[];let mode='copy';
  const animate=async({inputPath,outputPath,animations,metadata,signal,onProgress})=>{
    calls.push({inputPath,outputPath,animations,metadata});onProgress({phase:'render',progress:0.5});
    await runMediaProcess('ffmpeg',['-nostdin','-v','error','-n','-i',inputPath,...(mode==='trim'?['-t','1']:[]),'-c','copy',outputPath],{signal});
  };
  const f=await fixture('tone',{animate});try{
    assert.equal((await f.bridge.media.capabilities()).animate,true);
    const plan={segments:[{start:0,end:1.2},{start:2.4,end:3.6}],animations:[{id:'title',kind:'title',text:'Abertura',start:0,duration:1},{id:'cta',kind:'cta',text:'Siga o canal',start:1.4,duration:1}]};
    const preview=await f.bridge.media.plan('owner',{...f.ref,plan});assert.equal(preview.outputDuration,2.4);
    const queued=f.exportPlan(preview).job;await until(()=>['succeeded','failed'].includes(job(f,queued.id).status));
    assert.equal(job(f,queued.id).status,'succeeded',job(f,queued.id).error);
    assert.equal(calls.length,1);assert.match(calls[0].inputPath,/cut\.partial\.mp4$/);assert.deepEqual(calls[0].animations,{theme:'dark',title:{text:'Abertura',startSeconds:0,durationSeconds:1},cta:{text:'Siga o canal',durationSeconds:1}});assert(Math.abs(calls[0].metadata.durationSeconds-2.4)<0.1);assert.equal(calls[0].metadata.fps,24);assert.deepEqual(Object.keys(calls[0].metadata).sort(),['durationSeconds','fps','hasAudio','height','width']);
    const video=await probeVideo(job(f,queued.id).result.file.path);assert(Math.abs(video.duration-2.4)<0.1);assert.equal(video.hasAudio,true);
    mode='trim';const bad=f.exportPlan(await f.bridge.media.plan('owner',{...f.ref,plan:{...plan,segments:[{start:0,end:1.2},{start:2.5,end:3.7}]}}),{requestKey:'smart-two'}).job;
    await until(()=>['succeeded','failed'].includes(job(f,bad.id).status));
    assert.equal(job(f,bad.id).status,'failed');assert.match(job(f,bad.id).error,/changed duration or lost audio/);assert.equal(f.state().assets.length,2);
  }finally{await f.close()}
});

test('advanced export interruption, explicit retry, cancellation and tampered stored plans',async()=>{
  const f=await fixture();try{
    const preview=await f.bridge.media.plan('owner',{...f.ref,plan:{segments:[{start:0,end:1.15},{start:2.35,end:3.65}]}});
    f.hold(true);const queued=f.exportPlan(preview).job;await until(()=>f.encodes()===1);
    await f.reopen();assert.equal(job(f,queued.id).status,'interrupted');assert.equal(f.state().assets.length,1);
    const row=f.db.prepare('SELECT data_json FROM editorial_media_jobs WHERE id=?').get(queued.id).data_json,stored=JSON.parse(row);
    stored.plan.segments[0].end=1;f.db.prepare('UPDATE editorial_media_jobs SET data_json=? WHERE id=?').run(JSON.stringify(stored),queued.id);
    await assert.rejects(()=>f.bridge.media.retry('owner',queued.id),/stored edit plan was altered/);
    f.db.prepare('UPDATE editorial_media_jobs SET data_json=? WHERE id=?').run(row,queued.id);
    f.hold(false);await f.bridge.media.retry('owner',queued.id);await until(()=>job(f,queued.id).status==='succeeded');
    assert.equal(job(f,queued.id).attempt,2);assert(Math.abs(job(f,queued.id).result.metadata.duration-2.45)<0.1);assert.equal(f.state().assets.length,2);
    f.hold(true);const second=f.exportPlan(await f.bridge.media.plan('owner',{...f.ref,plan:{segments:[{start:0,end:2}]}}),{requestKey:'smart-cancel'}).job;
    await until(()=>f.encodes()===3);await f.bridge.media.cancel('owner',second.id);
    assert.equal(job(f,second.id).status,'canceled');assert.equal(f.state().assets.length,2);assert.deepEqual(readFileSync(f.input),f.original);
  }finally{await f.close()}
});

async function luma(path){
  const out=await runMediaProcess('ffmpeg',['-nostdin','-v','error','-i',path,'-map','0:v:0','-vf','signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG:file=-','-f','null','-']);
  return [...out.matchAll(/pts_time:([0-9.]+)\s*\r?\nlavfi\.signalstats\.YAVG=([0-9.]+)/g)].map(match=>({t:Number(match[1]),y:Number(match[2])}));
}
const remotion=await getRemotionCapabilities().catch(()=>({available:false,reasons:['unavailable']}));
test('real Remotion overlays run after the FFmpeg multi-cut and keep duration, audio and the original',{skip:remotion.available?false:remotion.reasons.join(' ')},async()=>{
  const f=await fixture('toneHd',createRemotionAnimator());try{
    assert.equal((await f.bridge.media.capabilities()).animate,true);
    const {analysis}=await f.bridge.media.analyze('owner',{...f.ref,options:{thresholdDb:-40,minDuration:0.4,padding:0.15}});
    const preview=await f.bridge.media.plan('owner',{...f.ref,plan:{segments:analysis.suggestedSegments,animations:[{id:'title',kind:'title',text:'Edição automática',start:0,duration:0.9},{id:'cta',kind:'cta',text:'Siga o canal',duration:0.8}]}});
    const queued=f.exportPlan(preview).job;await until(()=>['succeeded','failed'].includes(job(f,queued.id).status));
    const done=job(f,queued.id);assert.equal(done.status,'succeeded',done.error);
    const video=await probeVideo(done.result.file.path);assert(Math.abs(video.duration-preview.outputDuration)<2/24+0.1,`duration ${video.duration}`);assert.equal(video.hasAudio,true);assert.equal(video.width,320);
    // White tone frames: overlays darken the title (start) and CTA (end) windows; the clean middle stays white.
    const frames=await luma(done.result.file.path),at=time=>frames.reduce((best,item)=>Math.abs(item.t-time)<Math.abs(best.t-time)?item:best).y;
    assert(at(1.8)>200,`clean frame ${at(1.8)}`);assert(at(0.5)<at(1.8)-5,`title frame ${at(0.5)}`);assert(at(3.1)<at(1.8)-1,`cta frame ${at(3.1)}`);
    const gaps=parseSilences(await runMediaProcess('ffmpeg',['-nostdin','-v','error','-i',done.result.file.path,'-map','0:a:0','-af','silencedetect=noise=-40dB:duration=0.2,ametadata=mode=print:file=-','-f','null','-']),video.duration);
    assert.equal(gaps.length,2,JSON.stringify(gaps));
    assert.deepEqual(readFileSync(f.input),f.original);assert.equal(f.state().assets.length,2);
  }finally{await f.close()}
});

test('review compares raw and edited, streams linked versions with Range and never exposes other files',async()=>{
  const f=await fixture();try{
    const preview=await f.bridge.media.plan('owner',{...f.ref,plan:{segments:[{start:0,end:1.15},{start:2.35,end:3.65},{start:4.85,end:6}]}});
    const queued=f.exportPlan(preview).job;await until(()=>job(f,queued.id).status==='succeeded');
    const review=await f.bridge.media.review('owner',{jobId:queued.id});
    assert.equal(review.sourceCurrent,true);assert.equal(review.transcript,null);assert.equal(review.subtitles,null);
    assert.deepEqual(review.cuts.map(item=>[item.start,item.end,item.outputAt]),[[1.15,2.35,1.15],[3.65,4.85,2.45]]);
    assert(Math.abs(review.output.duration-3.6)<0.1);assert(review.source.duration>5.9);
    await assert.rejects(()=>f.bridge.media.review('owner',{jobId:'media-unknown'}),/verified automatic edit/);
    await assert.rejects(()=>f.bridge.media.subtitles('owner',{jobId:queued.id}),/not configured/);
    const server=createServer((request,response)=>void f.bridge.handle(request,response,new URL(request.url,'http://127.0.0.1')));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{
      const base=`http://127.0.0.1:${server.address().port}/api/content/media/file?profile=owner&contentId=content`;
      const whole=await fetch(`${base}&assetId=source&versionId=v1`);assert.equal(whole.status,200);assert.equal(whole.headers.get('accept-ranges'),'bytes');assert.deepEqual(Buffer.from(await whole.arrayBuffer()),f.original);
      const part=await fetch(`${base}&assetId=source&versionId=v1`,{headers:{range:'bytes=10-109'}});assert.equal(part.status,206);assert.equal(part.headers.get('content-range'),`bytes 10-109/${f.original.length}`);assert.deepEqual(Buffer.from(await part.arrayBuffer()),f.original.subarray(10,110));
      const output=f.state().assets.find(item=>item.id===review.output.assetId);assert.equal((await fetch(`${base}&assetId=${output.id}&versionId=${output.currentVersionId}`)).status,200);
      assert.equal((await fetch(`${base}&assetId=source&versionId=other`)).status,404);assert.equal((await fetch(`${base.replace('contentId=content','contentId=other')}&assetId=source&versionId=v1`)).status,404);
      assert.equal((await fetch(`${base}&assetId=source&versionId=v1&path=C:/Windows/win.ini`)).headers.get('content-length'),String(f.original.length));
      // Same-size change with the original timestamp restored: the player still refuses a file that is not the reviewed version.
      const {mtime,atime}=statSync(f.input),forged=Buffer.from(f.original);forged[forged.length-10]^=0xff;writeFileSync(f.input,forged);utimesSync(f.input,atime,mtime);
      assert.equal((await fetch(`${base}&assetId=source&versionId=v1`,{headers:{range:'bytes=0-99'}})).status,409);
      writeFileSync(f.input,f.original);utimesSync(f.input,atime,mtime);assert.equal((await fetch(`${base}&assetId=source&versionId=v1`,{headers:{range:'bytes=0-99'}})).status,206);
    }finally{await new Promise(resolve=>server.close(resolve))}
    // Restored history stays read-only: no transcription/subtitle work and no retry from an imported advanced job.
    const snapshot=executionSnapshot(f.db,'owner');assert.equal(JSON.stringify(snapshot).includes('editorial_transcripts'),false);restoreExecution(f.db,'owner',snapshot,'replace');
    assert.equal(job(f,queued.id).imported,true);await assert.rejects(()=>f.bridge.media.subtitles('owner',{jobId:queued.id}),/Imported history/);
  }finally{await f.close()}
});
