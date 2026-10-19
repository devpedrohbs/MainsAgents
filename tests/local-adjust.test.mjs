import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {chatEditFixture,fullEditScript,finalizeAndWait,sha,until,ffmpeg} from './chat-edit-fixture.mjs';
import {runMediaProcess} from '../editorial-media.mjs';
import {withTimeWindow} from '../chat-edit-intent.mjs';
import {mergeProductionSessions} from '../src/features/production/model.ts';

/**
 * Localized visual adjustment through the real host/coordinator/media path. Simulated: the model (script on the real tools)
 * and the motion renderer (FFmpeg boxes per scene). Proven on real files: audio packets identical (stream copy), timeline
 * identical, outside-window frames visually equal (PSNR on a lossy re-encode: evidence, not byte identity), files kept.
 */
const audioMd5=async path=>String(await runMediaProcess('ffmpeg',['-nostdin','-v','error','-i',path,'-map','0:a:0','-c','copy','-f','md5','-'])).match(/MD5=([a-f0-9]{32})/)[1];
async function psnr(a,b,t,dir){const [x,y]=[join(dir,`a-${t}.png`),join(dir,`b-${t}.png`)];await ffmpeg(['-ss',String(t),'-i',a,'-frames:v','1',x]);await ffmpeg(['-ss',String(t),'-i',b,'-frames:v','1',y]);
 const out=String(await runMediaProcess('ffmpeg',['-nostdin','-v','error','-i',x,'-i',y,'-lavfi','psnr=stats_file=-','-f','null','-']));const value=out.match(/psnr_avg:(inf|[\d.]+)/)[1];return value==='inf'?Infinity:Number(value);}
const toCompare=plan=>{const scene=plan.storyboard.scenes.find(item=>item.id==='metodo');scene.layers=[{id:'cmp',type:'compare',slot:'center',start:0.1,end:1.8,before:{label:'Antes',text:'manual'},after:{label:'Depois',text:'com app'},source:'design'}];};
/** The editor in local-adjust mode: tries an outside change (refused), writes the window change, previews only inside it. */
const adjustScript=(log,mutate=toCompare)=>async call=>{
 const context=(await call('get_context')).structuredContent;log.push({tool:'get_context',context});
 await call('get_frames',{target:'source',times:[3]});
 const outside=structuredClone(context.currentPlan);outside.storyboard.scenes[2].layers[0].text='Mudou fora do trecho';
 const refused=await call('write_plan',{baseRevision:0,plan:outside});log.push({tool:'write_plan-outside',isError:refused.isError===true,message:refused.content[0].text});
 const cuts=structuredClone(context.currentPlan);cuts.segments=[{start:0.5,end:6}];mutate(cuts);
 const cut=await call('write_plan',{baseRevision:0,plan:cuts});log.push({tool:'write_plan-cuts',isError:cut.isError===true,message:cut.content[0].text});
 const plan=structuredClone(context.currentPlan);mutate(plan);
 const saved=await call('write_plan',{baseRevision:0,plan});assert.notEqual(saved.isError,true,saved.content[0].text);const {revision}=saved.structuredContent;log.push({tool:'write_plan',result:saved.structuredContent});
 const far=await call('render_preview',{revision,start:4.5,duration:1});log.push({tool:'render_preview-outside',isError:far.isError===true,message:far.content[0].text});
 const preview=await call('render_preview',{revision,start:1.5,duration:3});assert.notEqual(preview.isError,true,preview.content[0].text);
 await call('get_frames',{target:{previewId:preview.structuredContent.previewId},times:[1]});
 await call('storyboard_stills',{revision});
 return finalizeAndWait(call,revision,log);
};

async function delivered(f){
 f.chat('chat','editor-de-video-1');f.scripts.push(fullEditScript(f.log));
 const view=await f.admit('chat',f.say('chat','Edite este vídeo com motion',[f.input]));
 return f.delivered(view.runId);
}

test('“Entre 2 e 4 segundos troque a animação por uma comparação”: only that window changes; audio, cuts, SRT and files are kept; undo restores',{timeout:300000},async()=>{
 const f=await chatEditFixture();try{
  const base=await delivered(f),baseFile=f.runs()[0].editorSession.messages.find(item=>item.receipts?.length).receipts[0].path,baseSha=await sha(baseFile);
  const srtDoc=await f.bridge.srt.command('owner',{action:'import',contentId:base.contentId,name:'legendas.srt',srt:'1\r\n00:00:00,500 --> 00:00:02,000\r\nComo editar rápido\r\n\r\n2\r\n00:00:02,100 --> 00:00:04,000\r\nCorte as pausas\r\n'});assert.ok(srtDoc);
  const srtVersion=srtDoc.versions.at(-1);
  const editedSrt=await f.bridge.srt.command('owner',{action:'save',contentId:base.contentId,docId:srtDoc.id,baseVersion:srtVersion.version,baseHash:srtVersion.hash,blocks:srtVersion.blocks.map((block,i)=>i===0?{...block,text:'Texto corrigido pelo usuário'}:block)});
  assert.equal(editedSrt.versions.at(-1).blocks[0].text,'Texto corrigido pelo usuário');
  const srtBefore=JSON.stringify(f.db.prepare('SELECT * FROM content_srt_documents ORDER BY id').all());
  f.scripts.push(adjustScript(f.log));
  const message=f.say('chat','Entre 2 e 4 segundos troque a animação por uma comparação');
  const view=await f.admit('chat',message);assert.equal(view.status,'started');assert.equal(view.kind,'adjust');assert.deepEqual(view.window,{start:2,end:4});
  const p=await until(()=>{const run=f.bridge.production.get('owner',base.id);return run.localAdjust?.status==='done'?run:null;});
  // The editor saw the window, the frozen parts and the delivered plan; an outside change and a cut change were refused.
  const context=f.log.filter(item=>item.tool==='get_context').at(-1).context;
  assert.deepEqual(context.localAdjust.window,{start:2,end:4});assert.deepEqual(context.localAdjust.editableScenes.map(item=>item.id),['metodo']);assert.equal(context.retakes,undefined);
  assert.match(f.log.find(item=>item.tool==='write_plan-outside').message,/A cena “Final” .* aparece fora do trecho e mudou/);
  assert.match(f.log.find(item=>item.tool==='write_plan-cuts').message,/cortes não podem mudar/);
  assert.match(f.log.find(item=>item.tool==='render_preview-outside').message,/preview only inside 1\.00-5\.00s/);
  // Same timeline and plan outside the window; the window scene changed.
  assert.deepEqual(p.editPlan.plan.segments,base.editPlan.plan.segments);
  for(const id of ['abertura','final'])assert.deepEqual(p.editPlan.plan.storyboard.scenes.find(item=>item.id===id),base.editPlan.plan.storyboard.scenes.find(item=>item.id===id));
  assert.equal(p.editPlan.plan.storyboard.scenes.find(item=>item.id==='metodo').layers[0].type,'compare');
  const entry=p.localAdjustments.at(-1);assert.equal(entry.status,'applied');assert.deepEqual(entry.changedScenes,['metodo']);assert.equal(entry.structural.kind,'resolved-props');assert.equal(entry.structural.outsideScenesCompared,2);
  assert.equal(entry.proof.audioCopied,true);assert.equal(entry.proof.sameAudio,true);assert.equal(entry.proof.sameSegments,true);assert.equal(entry.proof.timelineCompatible,true);
  assert.equal(entry.proof.sameSourceOutputMap,true);assert.equal(entry.proof.sameSrtDocuments,true);assert.equal(entry.proof.sameTimebase,true);assert.equal(entry.proof.sameAudioTiming,true);
  assert.equal(entry.base.srtDocuments[0].document.title,'legendas.srt');
  assert.equal(entry.base.srtDocuments[0].document.versions.at(-1).blocks[0].text,'Texto corrigido pelo usuário');
  // Real files: both versions exist, the base is unchanged, the audio packets are identical (checked independently here).
  const newFile=p.editorSession.messages.filter(item=>item.receipts?.length).at(-1).receipts[0].path;
  assert.notEqual(newFile,baseFile);assert.ok(existsSync(newFile)&&existsSync(baseFile));assert.equal(await sha(baseFile),baseSha);
  assert.equal(await audioMd5(newFile),await audioMd5(baseFile));
  // Visual evidence on the lossy re-encode: frames outside the window match the base closely; inside they differ.
  // Measured on this fixture: ~37-58 dB (or identical) outside, ~11 dB inside. Outside frames are not byte-identical after a
  // lossy re-encode (GOP references cross the window), which is why the guarantee is the structural proof, not pixels.
  for(const t of [0.5,1,1.9,4.1,5,5.5])assert.ok(await psnr(baseFile,newFile,t,f.directory)>=30,`frame at ${t}s outside the window`);
  for(const t of [2.5,3,3.5])assert.ok(await psnr(baseFile,newFile,t,f.directory)<=20,`frame at ${t}s inside the window changed`);
  // The window preview reached the chat before the export, and the host serves it only with matching bytes.
  const previewMessage=p.editorSession.messages.find(item=>item.adjustPreview);assert.ok(previewMessage,'preview message');
  assert.deepEqual(previewMessage.adjustPreview.window,{start:2,end:4});assert.equal(previewMessage.adjustPreview.start,2);assert.equal(previewMessage.adjustPreview.duration,2);
  const file=await f.bridge.production.adjustPreviewFile('owner',p.id,previewMessage.adjustPreview.sha256);assert.ok(file.bytes.length>1000);
  await assert.rejects(f.bridge.production.adjustPreviewFile('owner',p.id,'0'.repeat(64)),/não encontrada/);
  const shown=mergeProductionSessions(f.sessions.map(item=>({...item})),f.runs(),f.agents).find(item=>item.id==='chat');
  assert.ok(shown.messages.some(item=>item.adjustPreview)&&shown.messages.some(item=>item.localAdjust?.sameAudio===true),'preview and result in the same chat');
  assert.match(shown.messages.find(item=>item.localAdjust).content,/Ajuste aplicado em 2,0–4,0 s.*áudio idêntico.*SRT separado do conteúdo: continua valendo/s);
  assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM content_srt_documents ORDER BY id').all()),srtBefore,'SRT documents untouched');
  // Replaying the same chat request never starts another adjustment.
  const sends=f.claude.sends.length;assert.equal((await f.admit('chat',message)).status,'started');assert.equal(f.claude.sends.length,sends);
  // Crash after the command committed but before its ledger settled: the exact command is replayed, no new epoch/export.
  f.db.prepare("UPDATE chat_edit_requests SET status='admitted' WHERE message_id=?").run(message);
  assert.equal((await f.admit('chat',message)).status,'started');assert.equal(f.claude.sends.length,sends);assert.equal(f.bridge.production.get('owner',p.id).epoch,p.epoch);
  // Undo: back to the base version (no render), both files kept; the same request replays; a stale undo is refused.
  const latest=f.bridge.production.get('owner',p.id);
  const undone=await f.bridge.production.command('owner',{id:p.id,revision:latest.revision,action:'revert-local-adjust',requestId:'undo-1',authorize:true,expectedOutputSha256:latest.outputVideo.sha256});
  assert.equal(undone.outputVideo.sha256,base.outputVideo.sha256);assert.equal(undone.editPlan.planHash,base.editPlan.planHash);assert.equal(undone.localAdjustments.at(-1).status,'reverted');
  assert.ok(existsSync(newFile)&&existsSync(baseFile));
  assert.equal((await f.bridge.production.command('owner',{id:p.id,revision:latest.revision,action:'revert-local-adjust',requestId:'undo-1',authorize:true,expectedOutputSha256:latest.outputVideo.sha256})).revision,undone.revision);
  await assert.rejects(f.bridge.production.command('owner',{id:p.id,revision:undone.revision,action:'revert-local-adjust',requestId:'undo-2',authorize:true,expectedOutputSha256:latest.outputVideo.sha256}),/versão em revisão mudou/);
 }finally{await f.close();}
});

test('a window that cuts a scene, an invalid range and a stale base never pretend a local change',{timeout:240000},async()=>{
 const f=await chatEditFixture();try{
  const base=await delivered(f),revision=f.bridge.production.get('owner',base.id).revision;
  const crossing=await f.admit('chat',f.say('chat','Entre 1 e 3 segundos troque a animação por uma comparação'));
  assert.equal(crossing.status,'needs-window');assert.deepEqual(crossing.options.map(item=>[item.kind,item.start,item.end]),[['expand',0,4]]);
  assert.match(crossing.error,/corta ao meio a cena “Abertura” \(0,0–2,0 s\), “Método” \(2,0–4,0 s\).*Ajustar 0,0–4,0 s.*Nada foi alterado/);
  // The explicit option becomes a NEW user message with that window (never applied silently).
  assert.equal(withTimeWindow('Entre 1 e 3 segundos troque a animação por uma comparação',{start:0,end:4}),'Entre 0 e 4 segundos: troque a animação por uma comparação');
  await assert.rejects(f.admit('chat',f.say('chat','Entre 5 e 9 segundos troque a animação por uma comparação')),/passa do fim/);
  assert.equal(f.bridge.chatEdits.list('owner','chat').at(-1).status,'failed');
  const p=f.bridge.production.get('owner',base.id);
  await assert.rejects(f.bridge.production.command('owner',{id:p.id,revision:p.revision,action:'local-adjust',requestId:'stale-base',authorize:true,window:{start:2,end:4},request:'troque',base:{outputSha256:'0'.repeat(64),planHash:p.editPlan.planHash}}),/versão mudou desde o pedido/);
  const after=f.bridge.production.get('owner',base.id);
  assert.equal(after.revision,revision,'nothing was written');assert.equal(after.outputVideo.sha256,base.outputVideo.sha256);assert.equal(after.localAdjust,undefined);
 }finally{await f.close();}
});

test('cancel during the adjustment restores the delivered version; the late editor turn can no longer act',{timeout:240000},async()=>{
 const f=await chatEditFixture();try{
  const base=await delivered(f);let release=()=>{};const gate=new Promise(resolve=>{release=resolve;});const late={};
  f.scripts.push(async call=>{await gate;late.context=await call('get_context');late.write=await call('write_plan',{baseRevision:0,plan:{segments:[{start:0,end:6}]}});return {status:'not-finalized',finalRevision:0,summary:'parou',limitations:[]};});
  const sends=f.claude.sends.length,view=await f.admit('chat',f.say('chat','Entre 4 e 6 segundos troque o texto final por um contador'));
  assert.equal(view.status,'started');
  await until(()=>f.claude.sends.length===sends+1&&f.bridge.production.get('owner',base.id).localAdjust?.status==='planning');
  const running=f.bridge.production.get('owner',base.id);assert.equal(running.outputVideo.sha256,base.outputVideo.sha256,'the delivered version stays available meanwhile');
  const canceled=await f.bridge.production.command('owner',{id:running.id,revision:running.revision,action:'cancel-local-adjust',requestId:'cancel-adjust-1'});
  assert.equal(canceled.stage,'video-review');assert.equal(canceled.outputVideo.sha256,base.outputVideo.sha256);assert.equal(canceled.editPlan.planHash,base.editPlan.planHash);
  assert.equal(canceled.localAdjust.status,'canceled');assert.equal(canceled.localAdjustments.at(-1).status,'canceled');assert.ok(canceled.epoch>running.epoch);
  release();await until(()=>late.write);
  assert.equal(late.context.isError,true);assert.match(late.context.content[0].text,/changed|closed|cancel/i);
  await new Promise(r=>setTimeout(r,500));
  const final=f.bridge.production.get('owner',base.id);assert.equal(final.stage,'video-review');assert.equal(final.outputVideo.sha256,base.outputVideo.sha256);assert.equal(final.revision,canceled.revision,'no late write');
 }finally{await f.close();}
});

test('a silent delivered video stays silent through the localized visual adjustment',{timeout:120000},async()=>{
 const f=await chatEditFixture();try{
  await ffmpeg(['-f','lavfi','-i','testsrc2=size=320x180:rate=24','-t','6','-c:v','libx264','-pix_fmt','yuv420p',f.input]);
  const base=await delivered(f);f.scripts.push(adjustScript(f.log));
  await f.admit('chat',f.say('chat','Entre 2 e 4 segundos troque a animação por uma comparação'));
  const next=await until(()=>{const p=f.bridge.production.get('owner',base.id);return p.localAdjust?.status==='done'?p:null;});
  assert.equal(next.localAdjustments.at(-1).proof.sameAudio,true);assert.equal(next.localAdjustments.at(-1).proof.timelineCompatible,true);
  const digest=await f.bridge.media.audioDigest('owner',{contentId:next.contentId,...next.outputVideo});assert.equal(digest.hasAudio,false);assert.equal(digest.audioMd5,null);
 }finally{await f.close();}
});
