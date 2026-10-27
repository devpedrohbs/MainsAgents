import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyEditRequest} from '../chat-edit-intent.mjs';
import {editStageProblems} from '../edit-stages.mjs';
import {chatEditFixture,fullEditScript,finalizeAndWait,until} from './chat-edit-fixture.mjs';

const segments=[{start:0,end:2},{start:3,end:6}];
const cutScript=log=>async call=>{
 const context=(await call('get_context')).structuredContent;
 assert.equal(context.editStage.phase,'cuts');assert.equal(context.capabilities.storyboard,false);
 await call('get_frames',{target:'source',times:[0.5]});
 const invalid=await call('write_plan',{baseRevision:0,plan:{segments,animations:[{kind:'title',text:'Motion precoce',start:0,duration:1}]}});
 assert.equal(invalid.isError,true);assert.match(invalid.content[0].text,/Etapa 1/);
 const saved=await call('write_plan',{baseRevision:0,plan:{segments}});
 assert.notEqual(saved.isError,true,saved.content[0].text);
 const {revision}=saved.structuredContent;
 const preview=await call('render_preview',{revision,start:0,duration:3});assert.notEqual(preview.isError,true,preview.content[0].text);
 await call('get_frames',{target:{previewId:preview.structuredContent.previewId},times:[0.5]});
 return finalizeAndWait(call,revision,log);
};
async function base(f){f.chat('chat-stages','editor-de-video-1');f.scripts.push(cutScript(f.log));const request=await f.admit('chat-stages',f.say('chat-stages','Edite este vídeo com motion depois dos cortes',[f.input]));return until(()=>{const p=f.bridge.production.get('owner',request.runId);if(p?.stage==='blocked')throw Error(p.error);return p?.stage==='video-review'?p:null;});}

test('stage requests are explicit; analysis and negated visual instructions never authorize motion',()=>{
 for(const text of ['Agora adicione motion para mostrar os passos','Pode adicionar animações ao vídeo?','Comece o acabamento visual'])assert.equal(classifyEditRequest(text).kind,'visual',text);
 for(const text of ['Como adicionar motion ao vídeo?','Analise as animações','Não adicione motion ainda','Sem motion, faça os cortes','Estou pensando em adicionar motion','Quero entender como adicionar animações','Adicione motion, mas ainda não comece','Pode me explicar como adicionar motion?','Ele disse "adicione motion"'])assert.notEqual(classifyEditRequest(text).kind,'visual',text);
 assert.equal(classifyEditRequest('Edite este vídeo').kind,'edit');
 const plan={segments,format:'original',normalizeAudio:true,animations:[]};
 assert.ok(editStageProblems('visual',{...plan,segments:[{start:0,end:6}]},plan).length);
 assert.ok(editStageProblems('visual',{...plan,normalizeAudio:false},plan).length);
 assert.deepEqual(editStageProblems('visual',{...plan,storyboard:{scenes:[]}},plan),[]);
});

test('real FFmpeg: cuts → explicit visual request → identical approved audio/cuts → separate CapCut stage; replay/restart never starts the next step',{timeout:180000},async()=>{
 const f=await chatEditFixture({staged:true});try{
  let p=await base(f);assert.equal(p.editWorkflow.phase,'cuts');assert.deepEqual(p.editPlan.plan.segments,segments);assert.equal(p.editPlan.plan.storyboard,undefined);assert.equal(p.editPlan.plan.animations.length,0);assert.equal(f.claude.sends.length,1);
  const baseRef={...p.outputVideo},baseHash=p.editPlan.planHash;
  await f.reopen();p=f.bridge.production.get('owner',p.id);
  assert.equal(p.stage,'video-review');assert.equal(f.claude.sends.length,1);
  await assert.rejects(f.bridge.production.command('owner',{id:p.id,revision:p.revision,requestId:'stale-visual',action:'start-visual-edit',authorize:true,expectedVideo:{...baseRef,sha256:'0'.repeat(64)},notes:'Mostrar os passos'}),/versão atual/);
  f.scripts.push(fullEditScript(f.log,{segments,storyboard:out=>({version:1,title:'Visual',timeline:{basis:'output'},style:{treatment:'creator'},scenes:[{id:'explicar',start:0,end:out,camera:{layout:'full'},layers:[{id:'passos',type:'text',text:'Passos',role:'title',slot:'top',start:0.1,end:1.8,source:'design'}]}]}),before:async(call,context)=>{
   assert.equal(context.editStage.phase,'visual');assert.deepEqual(context.currentPlan.segments,segments);
   const wrong=await call('write_plan',{baseRevision:0,plan:{segments:[{start:0,end:6}]}});assert.equal(wrong.isError,true);assert.match(wrong.content[0].text,/congelado/);
  }}));
  const message=f.say('chat-stages','Agora adicione motion para mostrar os passos');
  const request=await f.admit('chat-stages',message);assert.equal(request.kind,'visual');p=await until(()=>{const next=f.bridge.production.get('owner',p.id);if(next?.stage==='blocked')throw Error(next.error);return next?.stage==='video-review'?next:null;});
  assert.equal(p.editWorkflow.phase,'visual');assert.equal(p.editWorkflow.base.editPlan.planHash,baseHash);assert.deepEqual(p.editPlan.plan.segments,segments);
  const [before,after]=await Promise.all([f.bridge.media.audioDigest('owner',{contentId:p.contentId,...baseRef}),f.bridge.media.audioDigest('owner',{contentId:p.contentId,...p.outputVideo})]);
  assert.equal(after.audioMd5,before.audioMd5);assert.ok(Math.abs(after.duration-before.duration)<1/after.fps);
  const replay=await f.admit('chat-stages',message);assert.equal(replay.runId,p.id);assert.equal(f.claude.sends.length,2);
  p=await f.bridge.production.command('owner',{id:p.id,revision:p.revision,requestId:'finish-visual',action:'finish-visual-edit',authorize:true,expectedVideo:p.outputVideo});
  assert.equal(p.editWorkflow.phase,'captions');assert.deepEqual(p.editWorkflow.finalVideo,p.outputVideo);assert.equal(p.captions,undefined);assert.equal(f.claude.sends.length,2);
  await f.reopen();p=f.bridge.production.get('owner',p.id);assert.equal(p.editWorkflow.phase,'captions');assert.equal(f.claude.sends.length,2);
 }finally{await f.close();}
});

test('failed visual work can be canceled back to the reviewed cut base; no original or prior version is lost',{timeout:120000},async()=>{
 const f=await chatEditFixture({staged:true});try{
  let p=await base(f);const expected=structuredClone(p.outputVideo),plan=structuredClone(p.editPlan);
  f.scripts.push(async()=>{throw Error('Fixture: provider unavailable');});
  await f.admit('chat-stages',f.say('chat-stages','Comece o acabamento visual com animações'));
  await until(()=>f.bridge.production.get('owner',p.id)?.stage==='blocked');p=f.bridge.production.get('owner',p.id);
  p=await f.bridge.production.command('owner',{id:p.id,revision:p.revision,requestId:'cancel-visual',action:'cancel-visual-edit'});
  assert.equal(p.stage,'video-review');assert.equal(p.editWorkflow.phase,'cuts');assert.deepEqual(p.outputVideo,expected);assert.deepEqual(p.editPlan,plan);
 }finally{await f.close();}
});

test('a director without authoring tools still produces only the cut base and receives no combined-edit instruction',{timeout:60000},async()=>{
 const f=await chatEditFixture({staged:true});try{
  f.bridge.production.setEditDirector('owner',{workspaceId:'space',director:{providerId:'codex'}});
  let prompt='';const send=f.codex.send.bind(f.codex);
  f.codex.send=async(...args)=>{prompt=args[1];return send(...args);};
  f.codex.events=async function*(){yield {type:'message.completed',content:JSON.stringify({removeSilences:true,silence:{thresholdDb:-35,minDuration:0.6,padding:0.2},normalizeAudio:true,animations:{},summary:'Cortes para revisão'})};yield {type:'execution.completed'};};
  f.chat('chat-stages','editor-de-video-1');
  const request=await f.admit('chat-stages',f.say('chat-stages','Edite este vídeo',[f.input]));
  const p=await until(()=>{const next=f.bridge.production.get('owner',request.runId);if(next?.stage==='blocked')throw Error(next.error);return next?.stage==='video-review'?next:null;});
  assert.equal(p.editWorkflow.phase,'cuts');assert.equal(p.editPlan.plan.animations.length,0);assert.equal(p.editPlan.plan.storyboard,undefined);
  assert.match(prompt,/ETAPA 1/);assert.doesNotMatch(prompt,/aplica animações fixas/);assert.equal(f.claude.sends.length,0);
 }finally{await f.close();}
});
