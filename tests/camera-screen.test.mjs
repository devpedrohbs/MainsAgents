import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {existsSync,writeFileSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {chatEditFixture,finalizeAndWait,sha,until} from './chat-edit-fixture.mjs';
import {pairFixture} from './pair-fixture.mjs';
import {runMediaProcess} from '../editorial-media.mjs';
import {productionBindingHash} from '../production-coordinator.mjs';
import {mapScreenSegments,pairHash,offsetSentence,voiceCoverageProblem} from '../source-pairs.mjs';
import {planHash} from '../editorial-smart-edit.mjs';

/**
 * Camera + screen of ONE content through the real host path (saved chat message with explicit roles, ledger, local sync
 * measurement, coordinator, editor-authoring tools, editor host, media executor with FFmpeg, SQLite). Declared simulations:
 * the model is a script on the real tools and the motion renderer is the fixture's FFmpeg stub, which composites the REAL cut
 * screen track (Remotion itself renders both sources in scripts/camera-screen-evidence.mjs). The screen fixture paints a red
 * square at x = (screenTime·80) mod 600, so its position in the cut screen track proves the exact camera->screen transform.
 */
const rawRow=(path,time,{y=200,width=640}={})=>new Promise((resolve,reject)=>{const child=spawn('ffmpeg',['-nostdin','-v','error','-ss',String(time),'-i',path,'-frames:v','1','-vf',`format=rgb24,crop=${width}:1:0:${y}`,'-f','rawvideo','-pix_fmt','rgb24','-'],{windowsHide:true});const chunks=[];child.stdout.on('data',c=>chunks.push(c));child.on('error',reject);child.on('close',code=>code?reject(Error(`ffmpeg ${code}`)):resolve(Buffer.concat(chunks)));});
/** Center x of the red marker in one row of the screen picture (null if absent). */
async function markerX(path,time){const row=await rawRow(path,time),xs=[];for(let x=0;x<row.length/3;x++){const [r,g,b]=[row[3*x],row[3*x+1],row[3*x+2]];if(r>220&&g<50&&b<50)xs.push(x);}return xs.length?(xs[0]+xs.at(-1))/2:null;}
const expectedX=screenTime=>((screenTime*80)%600)+20;
const audioStreams=async path=>JSON.parse(await runMediaProcess('ffprobe',['-v','error','-show_streams','-of','json',path])).streams.filter(item=>item.codec_type==='audio').length;
const scenes=[{id:'tela-camera',name:'Tela com câmera',start:0,end:2,screen:'with-camera',layers:[{id:'t1',type:'text',text:'Abertura',role:'title',slot:'top',start:0.1,end:1.8,source:'design'}]},
 {id:'so-tela',name:'Só a tela',start:2,end:4,screen:'full',layers:[{id:'t2',type:'text',text:'Veja a tela',role:'title',slot:'top',start:0.1,end:1.8,source:'design'}]},
 {id:'final',name:'Final',start:4,end:11,screen:'with-camera',layers:[{id:'t3',type:'text',text:'Encerramento',role:'title',slot:'top',start:0.1,end:1.8,source:'design'}]}];
const segments=[{start:3,end:8},{start:12,end:18}];
/** The director: reads both sources, looks at the screen, writes cuts on the camera timeline and a composition per scene. */
const pairScript=(log,{plan={segments,storyboard:{version:1,title:'Tech',timeline:{basis:'output'},style:{treatment:'technical'},scenes}},expect}={})=>async call=>{
 const context=(await call('get_context')).structuredContent;log.push({tool:'get_context',context});expect?.(context);
 await call('get_frames',{target:'source',times:[4,13]});
 const saved=await call('write_plan',{baseRevision:0,plan});assert.notEqual(saved.isError,true,saved.content[0].text);const {revision}=saved.structuredContent;
 const preview=await call('render_preview',{revision,start:0,duration:4});assert.notEqual(preview.isError,true,preview.content[0].text);
 await call('get_frames',{target:{previewId:preview.structuredContent.previewId},times:[1,3]});
 await call('storyboard_stills',{revision});
 // Finalizing before looking at the screen recording is refused: both sources must be OBSERVED, not only listed.
 const early=await call('finalize',{revision,summary:'x'});log.push({tool:'finalize-early',isError:early.isError===true,error:early.content[0].text});
 const screen=await call('get_frames',{target:'screen',times:[4,13]});assert.notEqual(screen.isError,true,screen.content[0].text);log.push({tool:'get_frames-screen',images:screen.content.filter(item=>item.type==='image').length});
 return finalizeAndWait(call,revision,log);
};
const chatText=p=>[...p.sourceSession.messages,...(p.editorSession?.messages??[])].map(item=>item.content).join(' | ');
const jobOf=(f,p)=>f.bridge.media.list('owner').find(job=>job.id===p.videoJobId);
const delivered=(f,id)=>f.delivered(id).catch(error=>{const r=f.bridge.production.get('owner',id),job=r&&f.bridge.media.list('owner').find(item=>item.id===r.videoJobId);console.log('DEBUG',r?.stage,r?.error,JSON.stringify(r?.events?.slice(-6)),job?.status,job?.error,JSON.stringify(f.log.slice(-4)).slice(0,1500));throw error;});

test('measured +2.4 s pair from the chat: one content, two assets, cuts applied to BOTH through the exact transform, one voice', async () => {
 const f=await chatEditFixture();
 try{
  const pair=await pairFixture(f.directory,{offsetSeconds:2.4,cameraSeconds:26,screenSeconds:26,name:'pos'});
  const before={camera:await sha(pair.camera),screen:await sha(pair.screen)};
  f.chat('chat','editor-de-video-1');
  f.scripts.push(pairScript(f.log,{expect:context=>{
   const screen=context.screenRecording;assert.ok(screen,'the director receives the screen recording facts');
   assert.equal(screen.voice,'camera');assert.equal(screen.layout,'camera-corner');assert.ok(Math.abs(screen.offsetSeconds-2.4)<0.025,String(screen.offsetSeconds));
   assert.equal(screen.convention,'screenTime = cameraTime − offsetSeconds');assert.ok(screen.sceneScreen['with-camera']);
  }}));
  const view=await f.admit('chat',f.sayPair('chat','Edite este vídeo tech com a tela',{camera:pair.camera,screen:pair.screen}));
  assert.equal(view.status,'started',JSON.stringify(view));assert.equal(view.sync.status,'measured');assert.match(view.sync.text,/A tela começa 2,[34]\d s depois da câmera/);
  const p=await delivered(f,view.runId);
  const early=f.log.find(item=>item.tool==='finalize-early');assert.equal(early.isError,true);assert.match(early.error,/target "screen"/);
  assert.equal(f.log.find(item=>item.tool==='get_frames-screen').images,2,'real screen frames reached the director');
  // Binding: the pair (both sources, offset, voice, layout) is part of the authority and of the plan hash.
  assert.equal(p.sourcePair.sync.origin,'measured');assert.equal(p.sourcePair.sync.verified,true);assert.ok(Math.abs(p.sourcePair.offsetSeconds-2.4)<0.025);
  assert.equal(p.sourcePair.hash,pairHash(p.sourcePair));assert.notEqual(productionBindingHash(p),productionBindingHash({...p,sourcePair:undefined}));
  const job=jobOf(f,p);assert.equal(job.pair.hash,p.sourcePair.hash);assert.equal(job.screen.sha256,before.screen);
  assert.notEqual(job.planHash,planHash({contentId:p.contentId,...p.inputVideo},job.plan),'a pair plan hash differs from the single-video hash of the same plan');
  // Exact transform before the cut mapper: the red marker of the cut screen track sits where screenTime = cameraTime − offset.
  const track=join(job.outputDirectory,'attempt-1.screen.mp4');assert.ok(existsSync(track));
  const o=p.sourcePair.offsetSeconds,map=mapScreenSegments(job.plan.segments,{offsetSeconds:o,screenDuration:26});
  assert.deepEqual(job.screenTrack.windows,map.windows);assert.equal(map.gapSeconds,0);
  for(const out of [1,4.5,6.2,9.8]){const piece=map.pieces.find(item=>out>=item.outStart&&out<item.outEnd),screenTime=piece.screenStart+(out-piece.outStart),x=await markerX(track,out);
   assert.ok(x!==null&&Math.abs(x-expectedX(screenTime))<=8,`output ${out}s -> screen ${screenTime.toFixed(3)}s: marker at ${x}, expected ${expectedX(screenTime)}`);}
  // One audio stream (the camera voice), duration of the edited timeline, originals untouched, both assets in the content.
  const output=p.outputVideo;const file=f.bridge.media.list('owner').find(item=>item.id===p.videoJobId).result.file.path;
  assert.equal(await audioStreams(file),1);
  const probe=JSON.parse(await runMediaProcess('ffprobe',['-v','error','-show_format','-of','json',file]));assert.ok(Math.abs(Number(probe.format.duration)-11)<0.3,probe.format.duration);
  assert.deepEqual({camera:await sha(pair.camera),screen:await sha(pair.screen)},before,'originals never overwritten');
  const state=JSON.parse(f.db.prepare('SELECT state_json FROM editorial_state WHERE profile_id=?').get('owner').state_json);
  const sources=state.assets.filter(item=>item.contentId===p.contentId&&item.role==='source');assert.equal(sources.length,2);
  assert.ok(output.sha256);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM content_source_pairs WHERE profile_id=? AND content_id=?').get('owner',p.contentId).n,1);
  const said=chatText(p);assert.match(said,/Câmera \+ tela/);assert.match(said,/Atraso medido no áudio comum/);
 }finally{await f.close();}
});

test('no common audio (camera silent): inconclusive with the reason, manual negative offset accepted as NOT verified, voice from the screen', async () => {
 const f=await chatEditFixture();
 try{
  const pair=await pairFixture(f.directory,{offsetSeconds:-1.7,cameraSeconds:20,screenSeconds:26,noAudio:'camera',name:'neg'});
  f.chat('chat','editor-de-video-1');
  const message=f.sayPair('chat','Edite este vídeo tech',{camera:pair.camera,screen:pair.screen});
  const waiting=await f.admit('chat',message);
  assert.equal(waiting.status,'needs-sync');assert.equal(waiting.sync.reason,'camera-no-audio');assert.match(waiting.sync.text,/câmera não tem áudio/);
  assert.equal(f.runs().length,0,'nothing starts without a proven or explicit offset');
  // Short check preview at the person's offset: side by side, real files re-verified by hash.
  const check=await f.bridge.chatEdits.syncPreview('owner',{sessionId:'chat',messageId:message,offsetSeconds:-1.7});assert.ok(existsSync(check.path));assert.ok(check.duration<=6);
  f.scripts.push(pairScript(f.log,{plan:{segments:[{start:3,end:8},{start:12,end:18}],storyboard:{version:1,title:'Tech',timeline:{basis:'output'},style:{treatment:'technical'},scenes}},expect:context=>{assert.equal(context.screenRecording.voice,'screen');}}));
  const started=await f.admit('chat',message,{sync:{offsetSeconds:-1.7}});
  assert.equal(started.status,'started',JSON.stringify(started));assert.equal(started.sync.status,'manual');assert.equal(started.sync.verified,false);
  const p=await delivered(f,started.runId);
  assert.equal(p.sourcePair.sync.origin,'manual');assert.equal(p.sourcePair.sync.verified,false);assert.equal(p.sourcePair.voice,'screen');
  assert.match(chatText(p),/NÃO verificado pelo app/);
  const job=jobOf(f,p),file=job.result.file.path;assert.equal(await audioStreams(file),1,'the voice comes from the screen (camera has none), one stream');
  const track=join(job.outputDirectory,'attempt-1.screen.mp4'),map=mapScreenSegments(job.plan.segments,{offsetSeconds:-1.7,screenDuration:26});
  for(const out of [1,7]){const piece=map.pieces.find(item=>out>=item.outStart&&out<item.outEnd),x=await markerX(track,out);assert.ok(Math.abs(x-expectedX(piece.screenStart+out-piece.outStart))<=8,`marker ${x}`);}
  assert.match(voiceCoverageProblem([{start:0,end:30}],{offsetSeconds:-1.7,screenDuration:26}),/não está inteiro dentro da gravação da tela/);
 }finally{await f.close();}
});

test('drift between the windows is refused as "synchronized"; a manual offset carries the measured drift and the warning', async () => {
 const f=await chatEditFixture();
 try{
  const pair=await pairFixture(f.directory,{offsetSeconds:1.2,cameraSeconds:40,screenSeconds:40,drift:1.002,name:'drift'});
  f.chat('chat','editor-de-video-1');
  const message=f.sayPair('chat','Edite este vídeo',{camera:pair.camera,screen:pair.screen,layout:'alternate'});
  const waiting=await f.admit('chat',message);
  assert.equal(waiting.status,'needs-sync');assert.equal(waiting.sync.status,'drift');assert.ok(Math.abs(waiting.sync.driftSeconds)>0.02,JSON.stringify(waiting.sync));
  assert.match(waiting.sync.text,/deriva/);
  f.scripts.push(pairScript(f.log));
  const started=await f.admit('chat',message,{sync:{offsetSeconds:waiting.sync.candidateOffset}});
  assert.equal(started.sync.verified,false);
  const p=await delivered(f,started.runId);
  assert.equal(p.sourcePair.layout,'alternate');assert.match(chatText(p),/deriva medida de \d+ ms: um atraso fixo não a corrige/);
 }finally{await f.close();}
});

test('roles are explicit: missing, repeated or partial roles never start a pair; one video keeps the single-video path', async () => {
 const f=await chatEditFixture();
 try{
  const pair=await pairFixture(f.directory,{offsetSeconds:0,cameraSeconds:6,screenSeconds:6,name:'roles'});
  f.chat('chat','editor-de-video-1');
  await assert.rejects(f.admit('chat',f.sayPair('chat','Edite este vídeo',{camera:pair.camera,screen:pair.screen,roles:['camera','camera']})),/marque um como Câmera e o outro como Tela/);
  await assert.rejects(f.admit('chat',f.sayPair('chat','Edite este vídeo',{camera:pair.camera,screen:pair.screen,roles:['camera',undefined]})),/marque um como Câmera e o outro como Tela/);
  const none=await f.admit('chat',f.sayPair('chat','Edite este vídeo',{camera:pair.camera,screen:pair.screen,roles:[undefined,undefined]}));
  assert.equal(none.status,'needs-choice','two videos without roles: the person chooses ONE video, nothing is guessed');
  assert.equal(f.runs().length,0);
 }finally{await f.close();}
});

test('screen file changed on disk after delivery: an adjustment refuses to reuse it; deleting one content purges only its pair link', async () => {
 const f=await chatEditFixture();
 try{
  const pair=await pairFixture(f.directory,{offsetSeconds:2.4,cameraSeconds:26,screenSeconds:26,name:'chg'});
  f.chat('chat','editor-de-video-1');f.scripts.push(pairScript(f.log));
  const view=await f.admit('chat',f.sayPair('chat','Edite este vídeo tech',{camera:pair.camera,screen:pair.screen}));
  const p=await delivered(f,view.runId);
  // A second content with its own pair stays untouched by the deletion of the first.
  const pair2=await pairFixture(f.directory,{offsetSeconds:2.4,cameraSeconds:26,screenSeconds:26,name:'other'});
  f.chat('chat2','editor-de-video-1');f.scripts.push(pairScript(f.log));
  const view2=await f.admit('chat2',f.sayPair('chat2','Edite este vídeo tech',{camera:pair2.camera,screen:pair2.screen}));
  const p2=await delivered(f,view2.runId);
  appendFileSync(pair.screen,Buffer.from('changed'));
  const sends=f.claude.sends.length;
  await f.admit('chat',f.say('chat','Entre 2 e 4 segundos troque o texto por um destaque'));
  const after=await until(()=>{const r=f.bridge.production.get('owner',p.id);return r.stage==='blocked'?r:null;});
  assert.match(after.error,/O arquivo mudou no disco/);assert.equal(f.claude.sends.length,sends,'a changed source never costs an editor turn');
  const preview=f.bridge.deletion.preview('owner',{contentId:p.contentId,workspaceId:'space'});
  await f.bridge.deletion.delete('owner',{contentId:p.contentId,workspaceId:'space',fingerprint:preview.fingerprint,requestId:randomUUID()});
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM content_source_pairs WHERE profile_id=? AND content_id=?').get('owner',p.contentId).n,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM content_source_pairs WHERE profile_id=? AND content_id=?').get('owner',p2.contentId).n,1);
  assert.ok(existsSync(pair.camera)&&existsSync(pair.screen),'raw recordings are never deleted');
 }finally{await f.close();}
});

test('pure contract: offset sentence, mapping with gaps, pair hash binds every output-shaping field', () => {
 assert.equal(offsetSentence(2.4),'A tela começa 2,40 s depois da câmera.');assert.equal(offsetSentence(-1.7),'A tela começa 1,70 s antes da câmera.');
 const map=mapScreenSegments([{start:0,end:4},{start:10,end:14}],{offsetSeconds:2,screenDuration:10});
 assert.deepEqual(map.pieces.map(item=>[item.kind,item.outStart,item.outEnd,item.screenStart??null]),[['gap',0,2,null],['screen',2,4,0],['screen',4,6,8],['gap',6,8,null]]);
 assert.deepEqual(map.windows,[{start:2,end:6}]);assert.equal(map.gapSeconds,4);
 const base={camera:{assetId:'a',versionId:'v',sha256:'a'.repeat(64)},screen:{assetId:'b',versionId:'w',sha256:'b'.repeat(64)},offsetSeconds:1,voice:'camera',layout:'camera-corner'};
 const h=pairHash(base);for(const change of [{offsetSeconds:1.001},{voice:'screen'},{layout:'screen-full'},{screen:{...base.screen,sha256:'c'.repeat(64)}}])assert.notEqual(pairHash({...base,...change}),h,JSON.stringify(change));
});

test('.72 local adjustment of a pair keeps both sources, offset, voice, audio, SRT and undo; a neighbour-changing screen mode is refused', async () => {
 const f=await chatEditFixture();
 try{
  const pair=await pairFixture(f.directory,{offsetSeconds:2.4,cameraSeconds:26,screenSeconds:26,name:'patch'});
  f.chat('chat','editor-de-video-1');f.scripts.push(pairScript(f.log));
  const view=await f.admit('chat',f.sayPair('chat','Edite este vídeo tech',{camera:pair.camera,screen:pair.screen}));
  const base=await delivered(f,view.runId),baseJob=jobOf(f,base),baseFile=baseJob.result.file.path;
  const srtDoc=await f.bridge.srt.command('owner',{action:'import',contentId:base.contentId,name:'legendas.srt',srt:'1\r\n00:00:00,500 --> 00:00:02,000\r\nAbertura\r\n'});
  const version=srtDoc.versions.at(-1);await f.bridge.srt.command('owner',{action:'save',contentId:base.contentId,docId:srtDoc.id,baseVersion:version.version,baseHash:version.hash,blocks:version.blocks.map(block=>({...block,text:'Corrigido pela pessoa'}))});
  const srtBefore=JSON.stringify(f.db.prepare('SELECT * FROM content_srt_documents ORDER BY id').all());
  const log=[];
  f.scripts.push(async call=>{
   const context=(await call('get_context')).structuredContent;log.push(context);
   assert.deepEqual(context.localAdjust.editableScenes.map(item=>item.id),['so-tela']);assert.equal(context.screenRecording.offsetSeconds,base.sourcePair.offsetSeconds);
   await call('get_frames',{target:'source',times:[3]});await call('get_frames',{target:'screen',times:[6]});
   const current=context.currentPlan.plan??context.currentPlan;
   const mode=structuredClone(current);mode.storyboard.scenes.find(item=>item.id==='so-tela').screen='with-camera';
   const refused=await call('write_plan',{baseRevision:0,plan:mode});log.push({refused:refused.isError===true,text:refused.content[0].text});
   const text=structuredClone(current);text.storyboard.scenes.find(item=>item.id==='so-tela').layers[0].text='Olhe este botão';
   const saved=await call('write_plan',{baseRevision:0,plan:text});assert.notEqual(saved.isError,true,saved.content[0].text);const {revision}=saved.structuredContent;
   const preview=await call('render_preview',{revision,start:1.5,duration:3});assert.notEqual(preview.isError,true,preview.content[0].text);
   await call('get_frames',{target:{previewId:preview.structuredContent.previewId},times:[1]});await call('storyboard_stills',{revision});
   return finalizeAndWait(call,revision,f.log);
  });
  const adjust=await f.admit('chat',f.say('chat','Entre 2 e 4 segundos troque o texto por um destaque'));assert.equal(adjust.status,'started',JSON.stringify(adjust));
  const p=await until(()=>{const run=f.bridge.production.get('owner',base.id);return run.localAdjust?.status==='done'?run:null;});
  const refusal=log.find(item=>item.refused!==undefined);assert.equal(refusal.refused,true);assert.match(refusal.text,/enquadramento de câmera herdado/);
  assert.equal(p.sourcePair.hash,base.sourcePair.hash,'pair (sources, offset, voice, layout) unchanged');
  const job=jobOf(f,p);assert.equal(job.pair.hash,base.sourcePair.hash);assert.equal(job.screen.sha256,baseJob.screen.sha256);assert.ok(job.audioCopied,'audio copied from the delivered version');
  const entry=p.localAdjustments.at(-1);assert.deepEqual(entry.changedScenes,['so-tela']);assert.equal(entry.proof.sameAudio,true);assert.equal(entry.proof.sameSegments,true);assert.equal(entry.proof.sameSrtDocuments,true);
  assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM content_srt_documents ORDER BY id').all()),srtBefore,'the edited SRT stays as the person left it');
  assert.equal(await audioStreams(job.result.file.path),1);assert.ok(existsSync(baseFile));
  const latest=f.bridge.production.get('owner',p.id);
  const undone=await f.bridge.production.command('owner',{id:p.id,revision:latest.revision,action:'revert-local-adjust',requestId:'undo-pair',authorize:true,expectedOutputSha256:latest.outputVideo.sha256});
  assert.equal(undone.outputVideo.sha256,base.outputVideo.sha256);assert.equal(undone.sourcePair.hash,base.sourcePair.hash);
 }finally{await f.close();}
});

test('a measurement interrupted by an app restart is shown as failed (retry), never as still measuring; nothing was started', async () => {
 const f=await chatEditFixture();
 try{
  const pair=await pairFixture(f.directory,{offsetSeconds:1,cameraSeconds:6,screenSeconds:6,noAudio:'camera',name:'stale'});
  f.chat('chat','editor-de-video-1');const message=f.sayPair('chat','Edite este vídeo',{camera:pair.camera,screen:pair.screen});
  assert.equal((await f.admit('chat',message)).status,'needs-sync');
  f.db.prepare("UPDATE chat_edit_requests SET status='measuring',data_json=json_set(data_json,'$.status','measuring') WHERE message_id=?").run(message);
  await f.reopen();
  const row=f.bridge.chatEdits.list('owner','chat').find(item=>item.messageId===message);
  assert.equal(row.status,'failed');assert.match(row.error,/interrompida/);assert.equal(f.runs().length,0);
  assert.equal((await f.admit('chat',message)).status,'needs-sync','retry measures again (idempotent, nothing started)');
 }finally{await f.close();}
});
