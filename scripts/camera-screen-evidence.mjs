/**
 * Evidence run of a camera + screen edit with the REAL renderer: Remotion (system Chrome, the versioned bundle that contains
 * the screen compositor) and FFmpeg, on synthetic recordings (no personal media, no transcription, no AI call). The model is a
 * script calling the real editor tools. The offset is MEASURED by the app from the common audio (known: +2.4 s).
 * Output: docs/analysis/camera-screen-provider-wait-2026-10-16/evidence/ (frames, MP4, evidence.json).
 *   node --experimental-strip-types scripts/camera-screen-evidence.mjs
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,rm,writeFile,copyFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chatEditFixture,finalizeAndWait,sha,until,ffmpeg} from '../tests/chat-edit-fixture.mjs';
import {pairFixture} from '../tests/pair-fixture.mjs';
import {createRemotionAnimator} from '../editorial-animate.mjs';
import {runMediaProcess} from '../editorial-media.mjs';
import {screenBox,containRect,cameraRect} from '../editorial-storyboard.mjs';
import {mapScreenSegments} from '../source-pairs.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'docs','analysis','camera-screen-provider-wait-2026-10-16','evidence');
const pixels=(file,t,{w,h})=>new Promise((resolve,reject)=>{const child=spawn('ffmpeg',['-nostdin','-v','error','-ss',String(t),'-i',file,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{windowsHide:true});const chunks=[];child.stdout.on('data',c=>chunks.push(c));child.on('error',reject);child.on('close',code=>code?reject(Error(`ffmpeg ${code}`)):resolve({data:Buffer.concat(chunks),w,h}));});
const at=(img,x,y)=>{const i=3*(Math.round(y)*img.w+Math.round(x));return [img.data[i],img.data[i+1],img.data[i+2]];};
const bbox=(img,test)=>{let x0=Infinity,y0=Infinity,x1=-1,y1=-1;for(let y=0;y<img.h;y++)for(let x=0;x<img.w;x++){const [r,g,b]=at(img,x,y);if(test(r,g,b)){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}}return x1<0?null:{x:x0,y:y0,w:x1-x0+1,h:y1-y0+1};};
const yellow=(r,g,b)=>r>200&&g>200&&b<70,red=(r,g,b)=>r>200&&g<60&&b<60;
const frame=async(file,t,name)=>{const target=path.join(out,name);await ffmpeg(['-ss',String(t),'-i',file,'-frames:v','1',target]);return name;};
const audioStreams=async file=>JSON.parse(await runMediaProcess('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file]));

await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
const started=Date.now(),f=await chatEditFixture({media:createRemotionAnimator()});
try{
 const caps=await f.bridge.media.capabilities();assert.equal(caps.animate,true,'real Remotion must be available');
 const bundle=JSON.parse(await readFile(path.join(root,'dist','remotion','current.json'),'utf8'));
 const pair=await pairFixture(f.directory,{offsetSeconds:2.4,cameraSeconds:26,screenSeconds:22,size:'640x360',screenSize:'1280x720',name:'evidence'});
 const before={camera:await sha(pair.camera),screen:await sha(pair.screen)};
 // Kept camera segments: [3,8) and [12,22.5); the screen ends at camera 24.4 s, so [22.5,..] is not used; a gap is forced by [24.5,26).
 const segments=[{start:3,end:8},{start:12,end:22.5},{start:24.5,end:26}],outDur=5+10.5+1.5;
 const scenes=[{id:'tela-camera',name:'Tela e câmera',start:0,end:5,screen:'with-camera',layers:[{id:'t1',type:'text',text:'Olhe a tela',role:'title',slot:'top',start:0.2,end:4.5,source:'design'}]},
  {id:'so-tela',name:'Só a tela',start:5,end:10,screen:'full',layers:[]},
  {id:'camera',name:'Câmera',start:10,end:13,screen:'off',camera:{layout:'full'},layers:[{id:'t2',type:'text',text:'Agora eu',role:'title',slot:'bottom',start:0.2,end:2.5,source:'design'}]},
  {id:'fim',name:'Fim',start:13,end:outDur,screen:'with-camera',layers:[]}];
 const log=[];
 f.chat('chat','editor-de-video-1');
 f.scripts.push(async call=>{
  const context=(await call('get_context')).structuredContent;log.push({screenRecording:context.screenRecording});
  await call('get_frames',{target:'source',times:[4,14]});const screen=await call('get_frames',{target:'screen',times:[4,14]});log.push({screenFrames:screen.content.filter(item=>item.type==='image').length});
  const saved=await call('write_plan',{baseRevision:0,plan:{segments,storyboard:{version:1,title:'Tech',timeline:{basis:'output'},style:{treatment:'technical'},scenes}}});assert.notEqual(saved.isError,true,saved.content[0].text);const {revision}=saved.structuredContent;
  const preview=await call('render_preview',{revision,start:3,duration:4});assert.notEqual(preview.isError,true,preview.content[0].text);
  await call('get_frames',{target:{previewId:preview.structuredContent.previewId},times:[1,3]});await call('storyboard_stills',{revision});
  return finalizeAndWait(call,revision,f.log);
 });
 const view=await f.admit('chat',f.sayPair('chat','Edite este vídeo tech com a gravação da tela',{camera:pair.camera,screen:pair.screen}));
 assert.equal(view.status,'started',JSON.stringify(view));
 const p=await f.delivered(view.runId),job=f.bridge.media.list('owner').find(item=>item.id===p.videoJobId),file=job.result.file.path;
 const info=await audioStreams(file),video=info.streams.find(item=>item.codec_type==='video'),W=video.width,H=video.height;
 const o=p.sourcePair.offsetSeconds,map=mapScreenSegments(segments,{offsetSeconds:o,screenDuration:22});
 const checks=[];
 // Positional checks on the real frame: the screen's yellow box (12..132 × 12..48 of 1280×720) where the screen rect puts it,
 // the camera's white "CAM" box (8..68 × 8..32 of 640×360) in the corner or full frame, the red marker only in its own band.
 const toRect=(rect,sx,sy,sw,sh)=>({x:rect.x+sx/sw*rect.w,y:rect.y+sy/sh*rect.h});
 const region=(img,box,test)=>{const found=[];for(let y=Math.max(0,Math.floor(box.y));y<Math.min(img.h,Math.ceil(box.y+box.h));y++)for(let x=Math.max(0,Math.floor(box.x));x<Math.min(img.w,Math.ceil(box.x+box.w));x++){const [r,g,b]=at(img,x,y);if(test(r,g,b))found.push([x,y]);}if(!found.length)return null;const xs=found.map(item=>item[0]),ys=found.map(item=>item[1]);return {x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs)+1,h:Math.max(...ys)-Math.min(...ys)+1};};
 const white=(r,g,b)=>r>200&&g>200&&b>200;
 const check=async(t,mode,name)=>{
  const img=await pixels(file,t,{w:W,h:H}),piece=map.pieces.find(item=>t>=item.outStart&&t<item.outEnd),result={t,mode,frame:await frame(file,t,name),piece:piece.kind};
  const shown=mode==='off'||piece.kind==='gap'?'full':mode,rect=containRect(screenBox(shown,W,H),1280,720);
  const yellowSpot=toRect(rect,72,30,1280,720);result.screenVisible=yellow(...at(img,yellowSpot.x,yellowSpot.y));
  if(result.screenVisible){const box=region(img,{x:rect.x,y:rect.y,w:rect.w*0.15,h:rect.h*0.12},yellow);result.yellowBox=box;result.yellowAspect=Math.round(box.w/box.h*100)/100;result.screenRect={x:Math.round(rect.x),y:Math.round(rect.y),w:Math.round(rect.w),h:Math.round(rect.h)};
   const band={x:rect.x,y:rect.y+rect.h*0.5,w:rect.w,h:rect.h*(40/720)},marker=region(img,band,red),screenTime=piece.screenStart+(t-piece.outStart);
   if(marker){const xScreen=(marker.x+marker.w/2-rect.x)/rect.w*1280,expected=(screenTime*80)%1240+20;result.marker={xScreen:Math.round(xScreen),expected:Math.round(expected),screenTime:Math.round(screenTime*1000)/1000};}}
  const cam=mode==='with-camera'&&piece.kind==='screen'?cameraRect('pip',W,H):{x:0,y:0,w:W,h:H},camSpot=toRect(cam,38,20,640,360);
  result.cameraSpot={x:Math.round(camSpot.x),y:Math.round(camSpot.y),rgb:at(img,camSpot.x,camSpot.y)};result.cameraVisible=white(...at(img,camSpot.x,camSpot.y));
  result.cameraPlacement=mode==='with-camera'&&piece.kind==='screen'?'corner':mode==='full'&&piece.kind==='screen'?'hidden':'full';
  checks.push(result);return result;
 };
 const a=await check(2,'with-camera','01-tela-com-camera.png');
 const b=await check(7,'full','02-so-tela.png');
 const c=await check(11.5,'off','03-so-camera.png');
 const d=await check(16.2,'with-camera','04-sem-tela-camera-cheia.png');
 assert.ok(a.screenVisible&&b.screenVisible,'screen visible in with-camera and full scenes');assert.equal(c.screenVisible,false,'camera-only scene shows no screen');
 assert.equal(a.cameraVisible,true,'camera in the corner next to the screen');assert.equal(c.cameraVisible,true,'camera full in the camera scene');
 assert.equal(d.piece,'gap');assert.equal(d.screenVisible,false,'no screen recording there');assert.equal(d.cameraVisible,true,'camera full in the gap, nothing frozen');
 for(const item of [a,b])assert.ok(Math.abs(item.yellowAspect-120/36)<0.35,`screen aspect preserved (${item.yellowAspect})`);
 for(const item of [a,b])assert.ok(item.marker&&Math.abs(item.marker.xScreen-item.marker.expected)<=30,`aligned: ${JSON.stringify(item.marker)}`);
 const audio=info.streams.filter(item=>item.codec_type==='audio');assert.equal(audio.length,1,'one voice stream');
 assert.deepEqual({camera:await sha(pair.camera),screen:await sha(pair.screen)},before,'originals untouched');
 await copyFile(file,path.join(out,'camera-tela-editado.mp4'));
 const receipt=p.editorSession.messages.find(item=>item.receipts?.length)?.receipts?.[0];
 const evidence={kind:'real-render',renderer:{remotion:caps.animate,ffmpeg:caps.ffmpeg,bundle:{version:bundle.version,sha256:bundle.sha256}},
  fixture:'synthetic: camera testsrc2 640x360@24 + common non-periodic audio; screen smptehdbars 1280x720@30 + moving red marker + yellow box, gain/noise/Opus',
  simulated:['editor decisions (script calling the real tools)','no transcription'],seconds:Math.round((Date.now()-started)/1000),
  sync:{measured:p.sourcePair.sync,offsetSeconds:o,known:2.4,errorMs:Math.round((o-2.4)*1000)},voice:p.sourcePair.voice,layout:p.sourcePair.layout,pairHash:p.sourcePair.hash,
  director:log,output:{width:W,height:H,duration:Number(info.format.duration),audioStreams:audio.length,sha256:job.result.file.sha256,receipt:receipt?{sha256:receipt.sha256,name:receipt.name}:null},
  screenTrack:job.screenTrack,checks,sources:{camera:before.camera,screen:before.screen,unchanged:true}};
 await writeFile(path.join(out,'evidence.json'),JSON.stringify(evidence,null,1));
 console.log(JSON.stringify(evidence,null,1));
}finally{await f.close();}
