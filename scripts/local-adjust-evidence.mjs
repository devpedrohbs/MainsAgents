/**
 * Evidence run of the chat edit + localized adjustment with the REAL renderer: Remotion (system Chrome, versioned bundle) and
 * FFmpeg, on a synthetic 6 s recording (testsrc2 + 440 Hz tone; no personal media, no transcription, no AI call). The model is
 * a script calling the real editor tools. Output: docs/analysis/chat-editing-semantic-local-adjustments-2026-10-16/evidence/
 * (frames of both versions, the window preview frame and evidence.json with the measured proofs).
 *   node --experimental-strip-types scripts/local-adjust-evidence.mjs
 */
import assert from 'node:assert/strict';
import {mkdir,rm,writeFile,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chatEditFixture,fullEditScript,finalizeAndWait,sha,until,ffmpeg} from '../tests/chat-edit-fixture.mjs';
import {createRemotionAnimator} from '../editorial-animate.mjs';
import {runMediaProcess} from '../editorial-media.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'docs','analysis','chat-editing-semantic-local-adjustments-2026-10-16','evidence');
const audioMd5=async file=>String(await runMediaProcess('ffmpeg',['-nostdin','-v','error','-i',file,'-map','0:a:0','-c','copy','-f','md5','-'])).match(/MD5=([a-f0-9]{32})/)[1];
const frame=async(file,t,name)=>{const target=path.join(out,name);await ffmpeg(['-ss',String(t),'-i',file,'-frames:v','1',target]);return target;};
async function psnr(a,b){const value=String(await runMediaProcess('ffmpeg',['-nostdin','-v','error','-i',a,'-i',b,'-lavfi','psnr=stats_file=-','-f','null','-'])).match(/psnr_avg:(inf|[\d.]+)/)[1];return value==='inf'?'inf':Number(value);}

await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
const started=Date.now(),f=await chatEditFixture({media:createRemotionAnimator()});
try{
 const caps=await f.bridge.media.capabilities();assert.equal(caps.animate,true,'real Remotion must be available');
 f.chat('chat','editor-de-video-1');f.scripts.push(fullEditScript(f.log));
 const edit=await f.admit('chat',f.say('chat','Edite este vídeo com motion explicativo',[f.input]));
 const base=await f.delivered(edit.runId),baseFile=base.editorSession.messages.find(item=>item.receipts?.length).receipts[0].path;
 const editSeconds=(Date.now()-started)/1000;
 f.scripts.push(async call=>{
  const context=(await call('get_context')).structuredContent;await call('get_frames',{target:'source',times:[3]});
  const plan=structuredClone(context.currentPlan),scene=plan.storyboard.scenes.find(item=>item.id==='metodo');
  scene.layers=[{id:'cmp',type:'compare',slot:'center',start:0.1,end:1.8,before:{label:'Antes',text:'cortes à mão'},after:{label:'Depois',text:'cortes pelo app'},source:'design'}];
  const saved=await call('write_plan',{baseRevision:0,plan});assert.notEqual(saved.isError,true,saved.content[0].text);const {revision}=saved.structuredContent;
  const preview=await call('render_preview',{revision,start:1.5,duration:3});assert.notEqual(preview.isError,true,preview.content[0].text);
  await call('get_frames',{target:{previewId:preview.structuredContent.previewId},times:[1.5]});await call('storyboard_stills',{revision});
  return finalizeAndWait(call,revision,f.log);
 });
 const adjustStarted=Date.now(),adjust=await f.admit('chat',f.say('chat','Entre 2 e 4 segundos troque a animação por uma comparação'));
 const p=await until(()=>{const run=f.bridge.production.get('owner',base.id);return run.localAdjust?.status==='done'?run:null;},15*60_000);
 const entry=p.localAdjustments.at(-1),newFile=p.editorSession.messages.filter(item=>item.receipts?.length).at(-1).receipts[0].path,previewMessage=p.editorSession.messages.find(item=>item.adjustPreview);
 const previewFile=await f.bridge.production.adjustPreviewFile('owner',p.id,previewMessage.adjustPreview.sha256);const previewPath=path.join(out,'preview-window.mp4');await writeFile(previewPath,previewFile.bytes);
 const frames={};
 for(const t of [1,3,5]){const a=await frame(baseFile,t,`base-${t}s.png`),b=await frame(newFile,t,`ajustado-${t}s.png`);frames[`${t}s`]={psnrDb:await psnr(a,b),outsideWindow:t<2||t>=4};}
 await frame(previewPath,1.5,'previa-trecho.png');
 await copyFile(baseFile,path.join(out,'base-editado.mp4'));await copyFile(newFile,path.join(out,'ajuste-versao-2.mp4'));
 const evidence={kind:'real-render',renderer:{remotion:caps.animate,ffmpeg:caps.ffmpeg},fixture:'synthetic testsrc2 + sine 440 Hz, 6 s, 320x180@24',simulated:['editor decisions (script calling the real tools)','no transcription'],
  editSeconds:Math.round(editSeconds),adjustSeconds:Math.round((Date.now()-adjustStarted)/1000),request:{status:adjust.status,window:adjust.window},
  structural:entry.structural,changedScenes:entry.changedScenes,proof:entry.proof,
  audio:{base:await audioMd5(baseFile),adjusted:await audioMd5(newFile)},files:{base:{path:'base-editado.mp4',sha256:await sha(baseFile)},adjusted:{path:'ajuste-versao-2.mp4',sha256:await sha(newFile)},bothExist:true},
  preview:{sha256:previewMessage.adjustPreview.sha256,start:previewMessage.adjustPreview.start,duration:previewMessage.adjustPreview.duration,bytes:previewFile.bytes.length},frames};
 assert.equal(evidence.audio.base,evidence.audio.adjusted);assert.equal(entry.proof.timelineCompatible,true);
 await writeFile(path.join(out,'evidence.json'),JSON.stringify(evidence,null,1));
 console.log(JSON.stringify(evidence,null,1));
}finally{await f.close();}
