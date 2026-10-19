import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {chatEditFixture,finalizeAndWait,sceneDefs,sha,until} from './chat-edit-fixture.mjs';
import {createProviderWaits} from '../provider-limits.mjs';

/**
 * Wait for a provider usage limit, not a restart. Real host path (saved chat, ledger, coordinator, editor-authoring tools,
 * editor host, media executor with FFmpeg, SQLite). Declared simulations: the "model" is a script on the real tools and the
 * usage limit is the STRUCTURED execution.failed the Claude bridge publishes (its own classification is tested with a fake
 * CLI process in provider-limits.test.mjs). No real provider is contacted.
 */
const limitFail={code:'provider_limit',message:'Claude Code recusou por limite de uso temporário.',retryable:false,limit:{kind:'rate-limit',resetsAt:null,evidence:{source:'rate_limit_event',value:'rejected',at:'2026-10-16T12:00:00.000Z'}}};
const words=[['Hoje',0.2,0.5],['vou',0.5,0.7],['mostrar',0.7,1.1],['como',1.1,1.3],['editar',1.3,1.8],['rápido',1.8,2.3],['no',3.0,3.1],['celular',3.1,3.7]].map(([text,start,end])=>({text,start,end}));
const counting=()=>{const t={calls:0,paths:[],capabilities:async()=>({available:true}),transcribe:async({inputPath})=>{t.calls++;t.paths.push(inputPath);return {engine:'whisper.cpp',model:'ggml-base',language:'pt',segments:[{start:0.2,end:3.7,text:'Hoje vou mostrar como editar rápido no celular'}],speech:[{start:0.2,end:3.7}],words};}};return t;};
const storyboard=out=>({version:1,title:'Edição',timeline:{basis:'output'},style:{treatment:'creator'},scenes:sceneDefs(out)});
const resume=(f,p,extra={})=>f.bridge.production.command('owner',{id:p.id,revision:p.revision,action:'resume',authorize:true,requestId:randomUUID(),...extra});
const blocked=(f,id,reason='provider-limit')=>until(()=>{const p=f.bridge.production.get('owner',id);return p?.stage==='blocked'&&p.blockReason===reason?p:null;});

test('usage limit during planning, after checkpoint + preview -> restart -> explicit Resume continues without redoing work', async () => {
 const transcriber=counting(),f=await chatEditFixture({transcriber});
 try{
  f.chat('chat','editor-de-video-1');
  let previewId,revision;
  // Turn 1: real work (context, frames, a validated plan, a rendered + inspected preview), then the provider rejects.
  f.scripts.push(async call=>{
   const context=(await call('get_context')).structuredContent;await call('get_frames',{target:'source',times:[0.5,3]});
   const out=context.metadata.duration;const saved=await call('write_plan',{baseRevision:0,plan:{segments:[{start:0,end:out}],storyboard:storyboard(out)}});assert.notEqual(saved.isError,true,saved.content[0].text);
   revision=saved.structuredContent.revision;const preview=await call('render_preview',{revision,start:0,duration:3});assert.notEqual(preview.isError,true,preview.content[0].text);
   previewId=preview.structuredContent.previewId;await call('get_frames',{target:{previewId},times:[0.5]});
   return {__fail:limitFail};
  });
  const view=await f.admit('chat',f.say('chat','Edite este vídeo com motion',[f.input]));
  let p=await blocked(f,view.runId);
  assert.equal(p.providerWait.providerId,'claude');assert.equal(p.providerWait.kind,'rate-limit');
  assert.equal(p.providerWait.resetsAt,null,'unknown reset stays unknown (no timer)');
  assert.match(p.error,/horário de liberação desconhecido/);
  assert.ok(p.providerWait.done.some(item=>/Transcrição local guardada/.test(item)),JSON.stringify(p.providerWait.done));
  assert.ok(p.providerWait.done.some(item=>/1 revisão/.test(item)));assert.ok(p.providerWait.done.some(item=>/1 prévia/.test(item)));
  assert.ok(p.providerWait.remaining.includes('Exportação final'));
  assert.equal(p.step.phase,'failed');assert.equal(p.step.failure.code,'provider_limit');
  assert.equal(p.budget.calls.length,1);assert.equal(p.budget.calls[0].status,'failed');
  assert.equal(f.bridge.production.providerWaits('owner').length,1);
  const sendsAtLimit=f.claude.sends.length;

  // While Claude waits, a NEW edit of another content (same provider) is kept, stopped before any send (zero tokens).
  f.chat('chat2','editor-de-video-1');f.scripts.push(async()=>{throw Error('must not run while the provider waits');});
  const other=await f.admit('chat2',f.say('chat2','Edite este vídeo',[f.other]));
  const waiting=await until(()=>{const r=f.bridge.production.get('owner',other.runId);return r?.stage==='blocked'&&r.blockReason==='provider-limit'?r:null;});
  assert.equal(waiting.providerWait.sent,false);assert.equal(waiting.budget.calls.length,0,'nothing reserved for the waiting provider');
  f.scripts.length=0;
  await new Promise(resolve=>setTimeout(resolve,1500));
  assert.equal(f.claude.sends.length,sendsAtLimit,'no retry, timer or probe while waiting');

  // Restart: the waits survive, nothing resumes by itself.
  await f.reopen();
  await new Promise(resolve=>setTimeout(resolve,1200));
  p=f.bridge.production.get('owner',view.runId);assert.equal(p.stage,'blocked');assert.equal(p.blockReason,'provider-limit');
  assert.equal(f.claude.sends.length,sendsAtLimit);assert.equal(f.bridge.production.providerWaits('owner').length,1);

  // A newer limit (generation 2) appears: a Resume of what the person saw (generation 1) never clears it.
  const side=new DatabaseSync(`${f.directory}/state.sqlite`);createProviderWaits(side).open('owner','claude',{kind:'quota',resetsAt:'2026-10-16T18:00:00.000Z',evidence:{source:'rate_limit_event',value:'rejected',at:'t'}});side.close();
  await assert.rejects(resume(f,p,{waitGeneration:1}),/limite mais novo/);
  assert.equal(f.bridge.production.providerWaits('owner')[0].generation,2);

  // Explicit Resume (generation 2): continuation from the checkpoint; the restored preview is inspected, never re-rendered.
  f.scripts.push(async call=>{
   const context=(await call('get_context')).structuredContent;assert.equal(context.currentPlan?.revision,revision,'the saved plan revision comes back');assert.ok(context.currentPlan.plan.storyboard.scenes.length);
   const frames=await call('get_frames',{target:{previewId},times:[1]});assert.notEqual(frames.isError,true,frames.content[0].text);
   const stills=await call('storyboard_stills',{revision});assert.notEqual(stills.isError,true,stills.content[0].text);
   return finalizeAndWait(call,revision,f.log);
  });
  p=f.bridge.production.get('owner',view.runId);
  await resume(f,p,{waitGeneration:2});
  const done=await f.delivered(view.runId).catch(error=>{const r=f.bridge.production.get('owner',view.runId);console.log('DEBUG',r.stage,r.blockReason,r.error,JSON.stringify(r.events.slice(-8)),JSON.stringify(r.step));throw error;});
  assert.equal(transcriber.paths.filter(path=>path===f.input).length,1,'the transcription of this recording is reused from its cache (not redone)');
  const prompt=f.claude.sends.at(-1).content;assert.match(prompt,/Retomada 1\/3 da MESMA edição/);assert.match(prompt,/NÃO refaça/);
  assert.equal(done.authoring.waitResumes,1);assert.equal(done.authoring.continuations??0,0,'the turn-limit continuation budget is untouched');
  assert.deepEqual(done.authoring.executions.map(item=>[item.kind,item.outcome]),[['initial','provider_limit'],['provider-resume','completed']]);
  assert.equal(done.budget.calls.length,2,'one rejected call + one resumed call: the budget is not reset');
  assert.equal(done.authoring.checkpoint.previewsUsed??done.authoring.previews.length,1,'still one preview rendered in total');
  assert.equal(f.bridge.production.providerWaits('owner').length,0,'the explicit Resume released the gate');
  const exportReceipts=f.db.prepare("SELECT COUNT(*) AS n FROM delivery_receipts WHERE profile_id=? AND json_extract(data_json,'$.source.kind')='media-export'").get('owner').n;
  assert.equal(exportReceipts,1,'one receipt for the one export (no duplicate after the resume)');
  assert.equal(f.bridge.media.list('owner').filter(job=>job.mode==='advanced'&&job.status==='succeeded').length,1,'exactly one final export');

  // The other content was NOT resumed by that release; its own Resume stays an explicit choice. Cancel => no resume.
  const second=f.bridge.production.get('owner',other.runId);assert.equal(second.stage,'blocked');
  const canceled=await f.bridge.production.command('owner',{id:second.id,revision:second.revision,action:'cancel',requestId:randomUUID()});
  assert.equal(canceled.stage,'canceled');
  await assert.rejects(resume(f,canceled),/Confira a etapa antes de retomar/);
 }finally{await f.close();}
});

test('a limit after the single final export was requested follows that export (no new turn, no wait)', async () => {
 const f=await chatEditFixture();
 try{
  f.chat('chat','editor-de-video-1');
  f.scripts.push(async call=>{
   const context=(await call('get_context')).structuredContent;await call('get_frames',{target:'source',times:[0.5]});
   const out=context.metadata.duration;const saved=await call('write_plan',{baseRevision:0,plan:{segments:[{start:0,end:out}],storyboard:storyboard(out)}});
   const revision=saved.structuredContent.revision,preview=await call('render_preview',{revision,start:0,duration:2});
   await call('get_frames',{target:{previewId:preview.structuredContent.previewId},times:[0.5]});await call('storyboard_stills',{revision});
   const final=await call('finalize',{revision,summary:'ok'});assert.notEqual(final.isError,true,final.content[0].text);
   return {__fail:limitFail};
  });
  const view=await f.admit('chat',f.say('chat','Edite este vídeo com motion',[f.input]));
  const done=await f.delivered(view.runId);
  assert.equal(done.blockReason,undefined);assert.ok(done.events.some(event=>event.action==='editor-provider-limit-after-finalize'));
  assert.equal(f.claude.sends.length,1);
 }finally{await f.close();}
});

test('deleting the waiting content removes its wait links but not the shared provider gate of another content', async () => {
 const f=await chatEditFixture();
 try{
  f.chat('a','editor-de-video-1');f.scripts.push(async call=>{await call('get_context');return {__fail:limitFail};});
  const first=await f.admit('a',f.say('a','Edite este vídeo',[f.input]));const p=await blocked(f,first.runId);
  f.chat('b','editor-de-video-1');const second=await f.admit('b',f.say('b','Edite este vídeo',[f.other]));await blocked(f,second.runId);
  const sourceBefore=await sha(f.input);
  const preview=f.bridge.deletion.preview('owner',{contentId:p.contentId,workspaceId:'space'});
  const result=await f.bridge.deletion.delete('owner',{contentId:p.contentId,workspaceId:'space',fingerprint:preview.fingerprint,requestId:randomUUID()});assert.equal(result.deleted,true,JSON.stringify(result));
  await until(()=>!f.bridge.production.get('owner',first.runId));
  assert.equal(f.bridge.production.providerWaits('owner').length,1,'the gate of the other waiting content stays');
  assert.equal(f.bridge.production.get('owner',second.runId).blockReason,'provider-limit');
  assert.equal(await sha(f.input),sourceBefore,'the raw recording is never deleted');
 }finally{await f.close();}
});

test('the wait is per provider: Codex keeps working while Claude waits; auth and turn budget never open a wait', async () => {
 const f=await chatEditFixture();
 try{
  f.chat('a','editor-de-video-1');f.scripts.push(async call=>{await call('get_context');return {__fail:limitFail};});
  const first=await f.admit('a',f.say('a','Edite este vídeo',[f.input]));await blocked(f,first.runId);
  // Explicit configuration honored: this workspace now directs edits with Codex (no silent Claude->Codex fallback anywhere).
  f.bridge.production.setEditDirector('owner',{workspaceId:'space',director:{providerId:'codex'}});
  const before=f.codex.sends.length;
  f.chat('b','editor-de-video-1');const second=await f.admit('b',f.say('b','Edite este vídeo',[f.other]));
  await until(()=>f.codex.sends.length>before);
  const run=await until(()=>{const r=f.bridge.production.get('owner',second.runId);return r&&!['planning-edit'].includes(r.stage)?r:null;});
  assert.notEqual(run.blockReason,'provider-limit','Codex is not blocked by the Claude wait');
  assert.equal(f.bridge.production.get('owner',first.runId).blockReason,'provider-limit','the Claude run keeps waiting (never moved to Codex)');
  assert.equal(f.bridge.production.get('owner',first.runId).editDirector.providerId,'claude');
 }finally{await f.close();}
 for(const failure of [{code:'login_required',message:'Claude Code recusou a autenticação.',retryable:false},{code:'editor_turn_limit',message:'The editor reached its turn limit.',retryable:false,diagnostics:{numTurns:20,maxTurns:20}}]){
  const g=await chatEditFixture();
  try{
   g.chat('c','editor-de-video-1');g.scripts.push(async call=>{await call('get_context');return {__fail:failure};});
   const view=await g.admit('c',g.say('c','Edite este vídeo',[g.input]));
   const p=await until(()=>{const r=g.bridge.production.get('owner',view.runId);return r?.stage==='blocked'?r:null;});
   assert.notEqual(p.blockReason,'provider-limit',failure.code);assert.equal(p.providerWait,undefined);
   assert.equal(g.bridge.production.providerWaits('owner').length,0,`${failure.code} never opens a provider wait`);
  }finally{await g.close();}
 }
});

test('a limit before any tool call: the explicit Resume re-sends the SAME first turn (same step key, budget counted, nothing reset)', async () => {
 const f=await chatEditFixture();
 try{
  f.chat('chat','editor-de-video-1');f.scripts.push(async()=>({__fail:limitFail}));
  const view=await f.admit('chat',f.say('chat','Edite este vídeo com motion',[f.input]));
  let p=await blocked(f,view.runId);assert.equal(p.authoring.waitResumes??0,0);
  f.scripts.push(async call=>{const context=(await call('get_context')).structuredContent;await call('get_frames',{target:'source',times:[0.5,3]});const out=context.metadata.duration;
   const saved=await call('write_plan',{baseRevision:0,plan:{segments:[{start:0,end:out}],storyboard:storyboard(out)}});const revision=saved.structuredContent.revision;
   const preview=await call('render_preview',{revision,start:0,duration:3});await call('get_frames',{target:{previewId:preview.structuredContent.previewId},times:[0.5]});await call('storyboard_stills',{revision});return finalizeAndWait(call,revision,f.log);});
  await resume(f,p);const done=await f.delivered(view.runId);
  assert.equal(done.authoring.waitResumes??0,0,'no continuation prompt: nothing was done before the limit');
  assert.equal(f.claude.sends.length,2);assert.equal(f.claude.sends[0].content.replace(/attempt \d+/,''),f.claude.sends[1].content.replace(/attempt \d+/,''),'the same first prompt');
  assert.equal(done.budget.calls.length,2);assert.equal(new Set(done.budget.calls.map(call=>call.key)).size,1,'same step key: attempts are counted, never reset');
  assert.ok(done.events.some(event=>event.action==='editor-provider-resume'));
 }finally{await f.close();}
});

test('concurrent Resume: same requestId twice or two requestIds on one revision -> one turn, one export, one receipt; a replay never releases a newer limit', async () => {
 const f=await chatEditFixture();
 try{
  f.chat('chat','editor-de-video-1');f.scripts.push(async()=>({__fail:limitFail}));
  const view=await f.admit('chat',f.say('chat','Edite este vídeo com motion',[f.input]));
  const p=await blocked(f,view.runId),sends=f.claude.sends.length;
  f.scripts.push(async call=>{const context=(await call('get_context')).structuredContent;await call('get_frames',{target:'source',times:[0.5,3]});const out=context.metadata.duration;
   const saved=await call('write_plan',{baseRevision:0,plan:{segments:[{start:0,end:out}],storyboard:storyboard(out)}});const revision=saved.structuredContent.revision;
   const preview=await call('render_preview',{revision,start:0,duration:3});await call('get_frames',{target:{previewId:preview.structuredContent.previewId},times:[0.5]});await call('storyboard_stills',{revision});return finalizeAndWait(call,revision,f.log);});
  const same={id:p.id,revision:p.revision,action:'resume',authorize:true,requestId:'resume-same',waitGeneration:p.providerWait.generation};
  const twice=await Promise.allSettled([f.bridge.production.command('owner',same),f.bridge.production.command('owner',same)]);
  assert.equal(twice.filter(item=>item.status==='fulfilled').length,1,JSON.stringify(twice.map(item=>item.reason?.message)));
  assert.match(twice.find(item=>item.status==='rejected').reason.message,/em andamento/);
  const other=await Promise.allSettled(['resume-b','resume-c'].map(requestId=>f.bridge.production.command('owner',{...same,requestId})));
  assert.ok(other.every(item=>item.status==='rejected'),'a second decision on the same (now stale) revision is refused by CAS');
  await f.delivered(view.runId);
  assert.equal(f.claude.sends.length,sends+1,'exactly one resumed turn');
  assert.equal(f.bridge.media.list('owner').filter(job=>job.mode==='advanced').length,1,'one export');
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM delivery_receipts WHERE profile_id=? AND json_extract(data_json,'$.source.kind')='media-export'").get('owner').n,1,'one export receipt');
  // A newer limit after that Resume: replaying the same request returns the recorded decision and releases nothing.
  const side=new DatabaseSync(`${f.directory}/state.sqlite`);createProviderWaits(side).open('owner','claude',{kind:'rate-limit',resetsAt:null,evidence:{source:'rate_limit_event',value:'rejected',at:'t'}});side.close();
  const replay=await f.bridge.production.command('owner',same);assert.equal(replay.id,p.id);
  assert.equal(f.bridge.production.providerWaits('owner')[0]?.generation,2,'the newer limit stays open');assert.equal(f.claude.sends.length,sends+1);
 }finally{await f.close();}
});

test('Resume of an edit stage whose video is missing is a clear error (no silent pass, nothing sent)', async () => {
 const f=await chatEditFixture();
 try{
  f.chat('chat','editor-de-video-1');f.scripts.push(async()=>({__fail:limitFail}));
  const view=await f.admit('chat',f.say('chat','Edite este vídeo',[f.input]));const p=await blocked(f,view.runId),sends=f.claude.sends.length;
  f.db.prepare("UPDATE production_runs SET data_json=json_remove(data_json,'$.inputVideo') WHERE id=?").run(p.id);
  await assert.rejects(resume(f,f.bridge.production.get('owner',p.id)),/precisa do vídeo verificado/);
  assert.equal(f.claude.sends.length,sends);assert.equal(f.bridge.production.providerWaits('owner').length,1,'the gate is not released by a refused Resume');
 }finally{await f.close();}
});

test('two different requestIds fired together on the same revision: CAS keeps one decision and one turn', async () => {
 const f=await chatEditFixture();
 try{
  f.chat('chat','editor-de-video-1');f.scripts.push(async()=>({__fail:limitFail}));
  const view=await f.admit('chat',f.say('chat','Edite este vídeo',[f.input]));const p=await blocked(f,view.runId),sends=f.claude.sends.length;
  f.scripts.push(async call=>{await call('get_context');return {__fail:limitFail};});
  const both=await Promise.allSettled(['resume-x','resume-y'].map(requestId=>f.bridge.production.command('owner',{id:p.id,revision:p.revision,action:'resume',authorize:true,requestId,waitGeneration:p.providerWait.generation})));
  assert.equal(both.filter(item=>item.status==='fulfilled').length,1,JSON.stringify(both.map(item=>item.reason?.message)));
  await until(()=>f.claude.sends.length>sends);await blocked(f,view.runId);
  assert.equal(f.claude.sends.length,sends+1,'one resumed turn');
 }finally{await f.close();}
});
