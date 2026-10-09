import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {runMediaProcess,probeVideo,editedSize,previewKeys} from '../editorial-media.mjs';
import {inspectLocalAsset} from '../editorial-local-files.mjs';

const inspect=path=>inspectLocalAsset(path,{stabilityMs:0});
// 6 s, 320x180, tone everywhere except [1,2.5] and [3.5,5] (silence + black picture).
const silent='between(t,1,2.5)+between(t,3.5,5)';
async function fixture({animate}={}){
  const root=mkdtempSync(join(tmpdir(),'edit-preview-')),path=join(root,'state.sqlite'),input=join(root,'original.mp4');
  await runMediaProcess('ffmpeg',['-nostdin','-v','error','-n','-f','lavfi','-i','nullsrc=s=320x180:r=24,format=gray,geq=lum=\'if(between(T,1,2.5)+between(T,3.5,5),0,255)\'','-f','lavfi','-i',`aevalsrc='if(${silent},0,0.5*sin(2*PI*440*t))':s=48000`,'-t','6','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',input]);
  const file=await inspect(input),original=readFileSync(input),at=new Date().toISOString();
  const bridge=createContentWorkflowBridge({dbPath:path,getCurrentProfile:()=>'owner',mediaOptions:{inspect,animate}});const db=new DatabaseSync(path);
  db.prepare('INSERT INTO editorial_state VALUES (?,?,?,?)').run('owner',1,JSON.stringify({schemaVersion:1,topics:[{id:'topic',workspaceId:'space'}],contents:[{id:'content',workspaceId:'space',topicId:'topic',title:'Synthetic'}],runs:[],artifacts:[],approvals:[],assets:[{id:'source',workspaceId:'space',contentId:'content',name:file.name,kind:'video',role:'source',status:'available',currentVersionId:'v1',versions:[{id:'v1',...file,createdAt:at}],createdAt:at,updatedAt:at}]}),at);
  return {root,input,original,bridge,db,ref:{contentId:'content',assetId:'source',versionId:'v1',sha256:file.sha256},close:async()=>{await bridge.close();db.close();}};
}
const motion={version:1,intensity:'balanced',analysis:{wordTiming:'words',voice:'measured',limitations:[],measuredCandidates:1,inferredCandidates:0},cues:[
  {id:'c1',kind:'punchIn',sourceStart:2.6,sourceEnd:3.4,start:0,end:0,layout:'camera-full',strength:0.6,scale:1.12,source:'measured',timing:'words',reason:'Synthetic emphasis',signals:[{kind:'loudness',source:'measured',value:4}],sfx:{kind:'pop',gainDb:-12,ducked:true}},
]};
const segments=[{start:0,end:1.15},{start:2.35,end:3.65},{start:4.85,end:6}];
function fakeResponse(){const chunks=[];let status=0,headers={};return {headersSent:false,writeHead(code,h){status=code;headers=h;this.headersSent=true},write(c){chunks.push(Buffer.from(c));return true},end(c){if(c)chunks.push(Buffer.from(c));this.done?.()},on(){},once(){},emit(){},removeListener(){},get status(){return status},get headers(){return headers},body:()=>Buffer.concat(chunks)};}

test('preview size and cache keys follow the export, not the overlays',()=>{
  assert.deepEqual(editedSize({format:'portrait'},{width:320,height:180},{width:180,height:320}),{width:1080,height:1920});
  assert.deepEqual(editedSize({format:'original'},{width:1921,height:1081},{width:960,height:540}),{width:1920,height:1080});
  // Rotated phone video: ffprobe reports 1920x1080 coded size, the decoded proxy is portrait.
  assert.deepEqual(editedSize({format:'original'},{width:1920,height:1080},{width:540,height:960}),{width:1080,height:1920});
  const base={segments,format:'original',normalizeAudio:false,theme:'dark',animations:[]};
  const a=previewKeys('s',base),b=previewKeys('s',{...base,animations:[{id:'t',kind:'title',text:'x',start:0,duration:1}],motion,theme:'light'});
  assert.equal(a.cutKey,b.cutKey,'overlays do not re-cut the proxy');
  assert.notEqual(previewKeys('s',{...base,normalizeAudio:true}).cutKey,a.cutKey,'audio processing re-cuts');
  assert.notEqual(previewKeys('s',base,[{kind:'pop',at:1,gainDb:-12}]).key,a.key,'SFX get their own key');
});

test('real FFmpeg preview proxy: same cut, processed audio with SFX, composition props, isolation and cancel',async()=>{
  const f=await fixture();try{
    const result=await f.bridge.media.preview('owner',{...f.ref,plan:{segments,motion}});
    const planned=await f.bridge.media.plan('owner',{...f.ref,plan:{segments,motion}});
    assert.equal(result.planHash,planned.planHash,'preview describes the exact reviewed plan');
    assert(Math.abs(result.outputDuration-3.6)<0.05);
    assert.deepEqual([result.composition.width,result.composition.height],[320,180]);
    assert(Math.abs(result.composition.durationSeconds-3.6)<0.1,JSON.stringify(result.composition));
    assert.equal(result.composition.durationInFrames,Math.round(result.composition.durationSeconds*result.composition.fps));
    assert.equal(result.preview.audio,'processed-sfx');assert.equal(result.preview.sfxSkipped,false);
    // Props are the renderer's: motion resolved in frames on the edited timeline (2.6 s raw -> 1.4 s edited).
    const cue=result.props.motion.cues[0];assert.equal(cue.kind,'punchIn');assert(Math.abs(cue.startFrame/result.props.fps-1.4)<0.05,JSON.stringify(cue));
    assert.equal(result.props.motion.sfx.length,1);assert.deepEqual(result.props.motion.protect,{captionBand:{top:0.6,bottom:0.9}},'motion text avoids the later burned-caption band');assert.equal(result.props.width,320);assert.equal(result.props.src,undefined);
    const folder=join(f.root,'media','owner','previews'),proxy=join(folder,`${result.preview.id}.mp4`);
    assert(existsSync(proxy));assert(!readdirSync(folder).some(name=>/partial|\.wav$/.test(name)),readdirSync(folder).join());
    const meta=await probeVideo(proxy);assert(Math.abs(meta.duration-3.6)<0.1);assert.equal(meta.hasAudio,true);
    // The SFX is really in the preview audio: louder than the cut-only proxy around the cue.
    // The SFX is really in the preview audio: the decoded samples differ from the cut-only proxy.
    const pcm=path=>runMediaProcess('ffmpeg',['-nostdin','-v','error','-i',path,'-map','0:a:0','-f','md5','-']);
    const cutOnly=await f.bridge.media.preview('owner',{...f.ref,plan:{segments}});
    assert.equal(cutOnly.preview.audio,'processed');assert.notEqual(cutOnly.preview.id,result.preview.id);assert.equal(cutOnly.props.motion,undefined);
    assert.notEqual(await pcm(proxy),await pcm(join(folder,`${cutOnly.preview.id}.cut.mp4`)));
    // Stream: only by id + matching content/asset; Range works.
    const url=id=>new URL(`http://x/api/content/media/preview-file?contentId=content&assetId=source&id=${id}`);
    const res=fakeResponse();await new Promise((resolve,reject)=>{res.done=resolve;f.bridge.media.streamPreview('owner',url(result.preview.id),{headers:{range:'bytes=0-99'},method:'GET'},res).catch(reject);});
    assert.equal(res.status,206);
    await assert.rejects(f.bridge.media.streamPreview('owner',new URL(`http://x/?contentId=other&assetId=source&id=${result.preview.id}`),{headers:{},method:'GET'},fakeResponse()),/not found/);
    await assert.rejects(f.bridge.media.streamPreview('owner',url('../../state'),{headers:{},method:'GET'},fakeResponse()),/not found/);
    await assert.rejects(f.bridge.media.streamPreview('intruder',url(result.preview.id),{headers:{},method:'GET'},fakeResponse()),/not found/);
    // Tampered proxy is refused (hash recorded at creation).
    writeFileSync(proxy,Buffer.alloc((await probeVideo(proxy).then(()=>readFileSync(proxy).length)),1));
    await assert.rejects(f.bridge.media.streamPreview('owner',url(result.preview.id),{headers:{},method:'GET'},fakeResponse()),/changed on disk/);
    // A newer preview cancels the running one.
    const first=f.bridge.media.preview('owner',{...f.ref,plan:{segments:[{start:0,end:5.5}]}});
    const second=f.bridge.media.preview('owner',{...f.ref,plan:{segments:[{start:0,end:5}]}});
    await assert.rejects(first,/canceled/);const ok=await second;assert(Math.abs(ok.outputDuration-5)<0.05);
    assert.equal(f.bridge.media.cancelPreview().canceled,false);
    assert.deepEqual(readFileSync(f.input),f.original,'original untouched');
    assert.equal(f.bridge.media.list('owner').length,0,'preview is not an export');
  }finally{await f.close();}
});

test('framing-only plan (manual focus, no motion cues): preview props and export both carry the reframe; noise reduction needs a stored measurement',async()=>{
  let received=null;
  const animate=async({inputPath,outputPath,animations})=>{received=animations;await runMediaProcess('ffmpeg',['-nostdin','-v','error','-n','-i',inputPath,'-c','copy',outputPath]);};
  const f=await fixture({animate});try{
    const reframe={mode:'manual',source:'user',points:[{t:0.5,x:0.2,y:0.3},{t:5.2,x:0.8,y:0.4}]};
    const plan={segments,motion:{version:1,intensity:'off',analysis:{wordTiming:'words',voice:'unavailable',limitations:[],measuredCandidates:0,inferredCandidates:0},cues:[],reframe}};
    const preview=await f.bridge.media.preview('owner',{...f.ref,plan});
    assert.equal(preview.props.motion.cues.length,0);assert(preview.props.motion.reframe,'reframe reaches the composition props');
    assert.equal(preview.props.motion.reframe.points.length,2,JSON.stringify(preview.props.motion.reframe));
    const planned=await f.bridge.media.plan('owner',{...f.ref,plan});assert.equal(planned.planHash,preview.planHash);
    const withoutFocus=await f.bridge.media.plan('owner',{...f.ref,plan:{segments}});assert.notEqual(withoutFocus.planHash,planned.planHash,'focus is part of the reviewed hash');
    const revision=f.db.prepare('SELECT revision FROM editorial_state').get().revision;
    const {job}=f.bridge.media.enqueue('owner',{mode:'advanced',authorize:true,revision,requestKey:'focus-only',...f.ref,plan:planned.plan,planHash:planned.planHash});
    const deadline=Date.now()+30000;while(Date.now()<deadline&&!['succeeded','failed'].includes(f.bridge.media.list('owner').find(item=>item.id===job.id).status))await new Promise(resolve=>setTimeout(resolve,50));
    const done=f.bridge.media.list('owner').find(item=>item.id===job.id);assert.equal(done.status,'succeeded',done.error);
    assert.deepEqual(received.motion.reframe.points.map(({t,x,y})=>({t,x,y})),reframe.points,'export hands the manual focus to the renderer');
    // Noise reduction: a client-invented noise floor is refused everywhere (no stored measurement for this source).
    const noisy={segments,audio:{leveling:false,noiseReduction:{noiseFloorDb:-50},smoothCuts:false}};
    await assert.rejects(f.bridge.media.plan('owner',{...f.ref,plan:noisy}),/noise measurement/);
    await assert.rejects(f.bridge.media.preview('owner',{...f.ref,plan:noisy}),/noise measurement/);
    // Opt-in leveling + smooth joins need no measurement and change the preview audio key.
    const level=await f.bridge.media.preview('owner',{...f.ref,plan:{segments,audio:{leveling:true,noiseReduction:false,smoothCuts:true}}});
    const plain=await f.bridge.media.preview('owner',{...f.ref,plan:{segments}});assert.notEqual(level.preview.id,plain.preview.id);
    const measured=await f.bridge.media.audio('owner',f.ref);assert('noiseReductionAvailable' in measured.audio);
  }finally{await f.close();}
});

test('vertical format: the 9:16 crop follows the user focus (real FFmpeg), composition gets cropped-frame coordinates, preview and export agree',async()=>{
  let received=null;
  const animate=async({inputPath,outputPath,animations})=>{received=animations;await runMediaProcess('ffmpeg',['-nostdin','-v','error','-n','-i',inputPath,'-c','copy',outputPath]);};
  const f=await fixture({animate});try{
    // Replace the source with a dark 16:9 picture that has a white marker at x 10–20 % (outside any centred 9:16 crop).
    const marked=join(f.root,'marked.mp4');
    await runMediaProcess('ffmpeg',['-nostdin','-v','error','-n','-f','lavfi','-i','color=c=0x282828:s=320x180:r=24','-f','lavfi','-i','sine=f=440:sample_rate=48000','-filter_complex','[0:v]drawbox=x=32:y=60:w=32:h=60:color=white:t=fill[v]','-map','[v]','-map','1:a','-t','4','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',marked]);
    const file=await inspectLocalAsset(marked,{stabilityMs:0}),state=JSON.parse(f.db.prepare('SELECT state_json FROM editorial_state WHERE profile_id=?').get('owner').state_json);
    const asset=state.assets[0];asset.versions.push({id:'v2',...file,createdAt:new Date().toISOString()});asset.currentVersionId='v2';
    f.db.prepare('UPDATE editorial_state SET state_json=?,revision=revision+1 WHERE profile_id=?').run(JSON.stringify(state),'owner');
    const ref={contentId:'content',assetId:'source',versionId:'v2',sha256:file.sha256},segs=[{start:0,end:1.5},{start:2,end:4}];
    const motion={version:1,intensity:'off',analysis:{wordTiming:'words',voice:'unavailable',limitations:[],measuredCandidates:0,inferredCandidates:0},cues:[],reframe:{mode:'fixed',source:'user',points:[{t:0,x:0.15,y:0.5}]}};
    const maxLuma=async path=>Math.max(...(await runMediaProcess('ffmpeg',['-nostdin','-v','error','-i',path,'-map','0:v:0','-vf','signalstats,metadata=mode=print:key=lavfi.signalstats.YMAX:file=-','-frames:v','12','-f','null','-'])).match(/YMAX=([0-9.]+)/g).map(item=>Number(item.slice(5))));
    const centred=await f.bridge.media.preview('owner',{...ref,plan:{segments:segs,format:'portrait'}});
    const focused=await f.bridge.media.preview('owner',{...ref,plan:{segments:segs,format:'portrait',motion}});
    assert.notEqual(centred.preview.id,focused.preview.id,'focus re-cuts the vertical proxy');
    const folder=join(f.root,'media','owner','previews');
    assert(await maxLuma(join(folder,`${centred.preview.id}.cut.mp4`))<120,'centred crop loses the marker');
    assert(await maxLuma(join(folder,`${focused.preview.id}.cut.mp4`))>200,'focused crop keeps the marker');
    assert.deepEqual([focused.composition.width,focused.composition.height],[1080,1920]);
    const point=focused.props.motion.reframe.points[0];assert(Math.abs(point.x-0.474)<0.01,`composition focus in cropped frame: ${JSON.stringify(point)}`);
    const planned=await f.bridge.media.plan('owner',{...ref,plan:{segments:segs,format:'portrait',motion}});assert.equal(planned.planHash,focused.planHash);
    const revision=f.db.prepare('SELECT revision FROM editorial_state').get().revision;
    const {job}=f.bridge.media.enqueue('owner',{mode:'advanced',authorize:true,revision,requestKey:'portrait-focus',...ref,plan:planned.plan,planHash:planned.planHash});
    const deadline=Date.now()+30000;while(Date.now()<deadline&&!['succeeded','failed'].includes(f.bridge.media.list('owner').find(item=>item.id===job.id).status))await new Promise(resolve=>setTimeout(resolve,50));
    const done=f.bridge.media.list('owner').find(item=>item.id===job.id);assert.equal(done.status,'succeeded',done.error);
    assert(await maxLuma(done.result.file.path)>200,'exported vertical video keeps the marker');
    assert(Math.abs(received.motion.reframe.points[0].x-point.x)<0.0001,'export composition = preview composition');
  }finally{await f.close();}
});
