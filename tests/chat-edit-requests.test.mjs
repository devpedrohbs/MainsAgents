import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {chatEditFixture,fullEditScript,sha,until,inspect} from './chat-edit-fixture.mjs';
import {createChatEditRequests} from '../chat-edit-requests.mjs';
import {mergeProductionSessions} from '../src/features/production/model.ts';
import {chatEditStatus} from '../src/features/chat/chatEdits.ts';
import {isVideoEditorAgent} from '../content-workflow-bridge.mjs';

/** Simulated: the model (script calling the real tools) and the motion renderer (FFmpeg boxes). Real: host, ledger, coordinator, media, FFmpeg. */
const receiptsIn=session=>(session?.messages??[]).flatMap(message=>message.receipts??[]);

test('the Editor Claude chat itself: an explicit request + attached video starts the real engine, progress and file in the SAME chat',{timeout:240000},async()=>{
 const f=await chatEditFixture();try{
  const original=await sha(f.input);f.chat('chat-editor','editor-de-video-1');f.scripts.push(fullEditScript(f.log));
  const message=f.say('chat-editor','Edite este vídeo com motion explicativo',[f.input]);
  const view=await f.admit('chat-editor',message);
  assert.equal(view.status,'started');assert.equal(view.editor.id,'editor-de-video-1');assert.equal(view.video.name,'gravacao.mp4');
  const p=await f.delivered(view.runId);
  assert.equal(p.sourceSession.id,'chat-editor','the request chat is the run main chat (no self-handoff)');
  assert.match(p.editorSession.id,/^chat-editor-/);assert.equal(p.editDirector.providerId,'claude');assert.equal(p.entry.origin,'delegation');
  assert.equal(f.claude.sends.length,1);assert.ok(f.claude.sends[0].editorSessionId);assert.equal(f.claude.sends[0].providerId,'claude');
  const listed=f.runs().find(run=>run.id===p.id);assert.equal(listed.editDirector.provider,'claude');assert.equal(listed.editDirector.name,'Editor de Vídeo');
  // What the person sees in that chat: the editor's plan and the verified file with its receipt, relayed by the real merge.
  const shown=mergeProductionSessions(f.sessions.map(item=>({...item})),f.runs(),f.agents).find(item=>item.id==='chat-editor');
  const receipts=receiptsIn(shown);assert.equal(receipts.length,1);assert.equal(receipts[0].sha256,p.outputVideo.sha256);assert.ok(existsSync(receipts[0].path));
  assert.ok(shown.messages.some(item=>item.id===message),'the request stays in the chat');
  assert.equal(chatEditStatus({...view,kind:'edit'},listed,[],true).title,'Vídeo editado entregue');
  // Replay (reload, double click, retry): same ledger row and run, no second Claude turn or render.
  const again=await f.admit('chat-editor',message);assert.equal(again.runId,view.runId);assert.equal(again.status,'started');
  assert.equal(f.claude.sends.length,1);assert.equal(f.runs().length,1);
  assert.equal(await sha(f.input),original,'original untouched');
 }finally{await f.close();}
});

test('a Codex content chat: the workspace video editor runs, directed by Claude by default; an explicit director choice is honoured',{timeout:240000},async()=>{
 const f=await chatEditFixture({editorProvider:'codex'});try{
  f.chat('chat-codex','conteudo');f.scripts.push(fullEditScript(f.log));
  const view=await f.admit('chat-codex',f.say('chat-codex','Por favor, edite o vídeo',[f.input]));
  assert.equal(view.editor.id,'editor-de-video-1');const p=await f.delivered(view.runId);
  assert.equal(p.sourceSession.id,'chat-codex');assert.equal(p.sourceAgent.id,'conteudo');assert.equal(p.editorAgent.providerId,'codex','the editor agent is never switched');
  assert.equal(f.claude.sends.length,1,'Claude Code directs (workspace default) through the editor tools');
  const receipt=p.editorSession.messages.find(item=>item.receipts?.length).receipts[0];assert.equal(receipt.producedBy.providerId,'claude','the receipt names who really directed');
  // Explicit workspace choice: Codex directs the next edits; nothing else is changed and Claude is not asked.
  f.bridge.production.setEditDirector('owner',{workspaceId:'space',director:{providerId:'codex'}});
  f.chat('chat-codex-2','conteudo');const second=await f.admit('chat-codex-2',f.say('chat-codex-2','Edite este vídeo',[f.other]));
  const run=f.runs().find(item=>item.id===second.runId);assert.equal(run.editDirector.choice,'codex');assert.equal(run.editDirector.provider,'codex');
  assert.equal(f.claude.sends.length,1);assert.notEqual(run.contentId,p.contentId,'another video in another General chat is another content');
 }finally{await f.close();}
});

test('analysis, how-to questions, negations, quotes and a bare attachment never start an edit',{timeout:60000},async()=>{
 const f=await chatEditFixture();try{
  f.chat('chat-a','editor-de-video-1');
  for(const text of ['Analise o vídeo e me diga o que melhorar','Como editar esse vídeo?','Não edite ainda','Ele pediu "edite este vídeo" ontem','']){
   const id=f.say('chat-a',text||' ',[f.input]);await assert.rejects(f.admit('chat-a',id),error=>error.status===422,text);
  }
  assert.equal(f.runs().length,0);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM chat_edit_requests').get().n,0);assert.equal(f.claude.sends.length,0);
  // The POST cannot invent a message or borrow one from another chat.
  f.chat('chat-b','conteudo');const foreign=f.say('chat-b','Edite este vídeo',[f.input]);
  await assert.rejects(f.admit('chat-a',foreign),/não está salva nesta conversa/);
  await assert.rejects(f.admit('chat-a','message-invented'),/não está salva/);
  await assert.rejects(f.bridge.chatEdits.admit('owner',{sessionId:'chat-a',messageId:'x',requestId:'not-a-uuid'}),/inválido/);
 }finally{await f.close();}
});

test('several videos or editors: the person chooses; no video: the chat says how to attach; a wrong choice is refused',{timeout:240000},async()=>{
 const f=await chatEditFixture({secondEditor:true,withFlow:false});try{
  f.chat('chat-c','conteudo');
  const none=await f.admit('chat-c',f.say('chat-c','Edite este vídeo'));assert.equal(none.status,'needs-video');
  const id=f.say('chat-c','Edite este vídeo',[f.input,f.other]);
  const choice=await f.admit('chat-c',id);assert.equal(choice.status,'needs-choice');assert.deepEqual(choice.choices.map(item=>item.name),['gravacao.mp4','outra-gravacao.mp4']);
  await assert.rejects(f.admit('chat-c',id,{choice:'path:nao-existe'}),/não é uma das opções/);
  const editors=await f.admit('chat-c',id,{choice:choice.choices[1].id});assert.equal(editors.status,'needs-editor');assert.deepEqual(editors.editors.map(item=>item.id),['editor-de-video-1','editor-de-video-2']);
  assert.equal(f.runs().length,0,'nothing starts while a choice is pending');
  f.scripts.push(fullEditScript(f.log));
  const started=await f.admit('chat-c',id,{editorAgentId:'editor-de-video-2'});
  assert.equal(started.status,'started');assert.equal(started.video.name,'outra-gravacao.mp4');assert.equal(started.editor.id,'editor-de-video-2');
  const p=await f.delivered(started.runId);assert.equal(p.inputVideo.sha256,await sha(f.other));assert.equal(p.editorAgent.id,'editor-de-video-2');
  assert.ok(isVideoEditorAgent([],f.agents[2]));
 }finally{await f.close();}
});

test('crash between admission and link, concurrent double send and restart reconcile to ONE run',{timeout:240000},async()=>{
 const f=await chatEditFixture();try{
  f.chat('chat-d','editor-de-video-1');f.scripts.push(fullEditScript(f.log));
  const id=f.say('chat-d','Edite este vídeo',[f.input]);
  // Double send (two windows / double click) of the same saved message.
  const [a,b]=await Promise.all([f.admit('chat-d',id),f.admit('chat-d',id)]);
  assert.equal(a.runId,b.runId);assert.equal(f.runs().length,1);
  await f.delivered(a.runId);assert.equal(f.claude.sends.length,1);
  // Crash after the run was linked but before the ledger said so: the next admission reconciles by the job link.
  f.db.prepare("UPDATE chat_edit_requests SET status='admitted',data_json=json_set(data_json,'$.runId',NULL) WHERE message_id=?").run(id);
  const again=await f.admit('chat-d',id);assert.equal(again.status,'started');assert.equal(again.runId,a.runId);assert.equal(f.runs().length,1);
  // Crash after admission and BEFORE any run: the next admission starts it exactly once.
  const lost=f.say('chat-d','Edite este vídeo',[f.other]),key=createHash('sha256').update(`chat-edit|owner|chat-d|${lost}`).digest('hex').slice(0,40);
  f.db.prepare('INSERT INTO chat_edit_requests VALUES(?,?,?,?,?,?,?,?)').run('owner',key,'chat-d',lost,null,'admitted',JSON.stringify({key,sessionId:'chat-d',messageId:lost,kind:'edit',jobId:`chat-edit-${key}`}),new Date().toISOString());
  assert.equal(f.bridge.production.linkedRun('owner',`chat-edit-${key}`),null,'the crash happened before any run');
  f.scripts.push(fullEditScript(f.log));const resumed=await f.admit('chat-d',lost);assert.equal(resumed.status,'started');
  assert.equal(f.runs().length,2);await f.delivered(resumed.runId);
  // A restarted host (new bridge on the same database) answers the same message with the same run.
  const runId=resumed.runId;await f.bridge.close();
  const {createContentWorkflowBridge}=await import('../content-workflow-bridge.mjs');
  const reopened=createContentWorkflowBridge({dbPath:f.db.location?.()??`${f.directory}/state.sqlite`,getCurrentProfile:()=>'owner',getAgents:()=>f.agents,getFlows:()=>({flows:[]}),getSessions:()=>f.sessions,inspect,mediaOptions:{inspect}});
  try{const view=await reopened.chatEdits.admit('owner',{sessionId:'chat-d',messageId:lost});assert.equal(view.runId,runId);assert.equal(reopened.production.list('owner').length,2);}finally{await reopened.close();f.bridge.close=async()=>{};}
 }finally{await f.close();}
});

test('two contents at once keep their own run, video and chat; a deleted chat starts nothing, even mid-admission',{timeout:300000},async()=>{
 const f=await chatEditFixture();try{
  f.chat('chat-x','editor-de-video-1');f.chat('chat-y','editor-de-video-1');f.scripts.push(fullEditScript(f.log),fullEditScript(f.log));
  const [x,y]=await Promise.all([f.admit('chat-x',f.say('chat-x','Edite este vídeo',[f.input])),f.admit('chat-y',f.say('chat-y','Edite este vídeo',[f.other]))]);
  assert.notEqual(x.runId,y.runId);assert.notEqual(x.contentId,y.contentId);
  const [px,py]=[await f.delivered(x.runId),await f.delivered(y.runId)];
  assert.equal(px.sourceSession.id,'chat-x');assert.equal(py.sourceSession.id,'chat-y');
  assert.equal(px.inputVideo.sha256,await sha(f.input));assert.equal(py.inputVideo.sha256,await sha(f.other));
  const merged=mergeProductionSessions(f.sessions.map(item=>({...item})),f.runs(),f.agents);
  assert.deepEqual(receiptsIn(merged.find(item=>item.id==='chat-x')).map(item=>item.sha256),[px.outputVideo.sha256]);
  assert.deepEqual(receiptsIn(merged.find(item=>item.id==='chat-y')).map(item=>item.sha256),[py.outputVideo.sha256]);
  // A deleted chat (tombstone) is refused before anything, and the database refuses a late ledger row for it.
  f.chat('chat-z','editor-de-video-1');const z=f.say('chat-z','Edite este vídeo',[f.input]);
  f.db.prepare('INSERT INTO content_tombstone_ids VALUES(?,?,?,?)').run('owner','session','chat-z','');
  await assert.rejects(f.admit('chat-z',z),error=>error.status===410);
  assert.throws(()=>f.db.prepare('INSERT INTO chat_edit_requests VALUES(?,?,?,?,?,?,?,?)').run('owner','late','chat-z','m',null,'admitted','{}','now'),/deleted locally/);
  // Deleted while the video was being verified (after the durable admission, before the run): nothing starts.
  f.chat('chat-w','editor-de-video-1');const w=f.say('chat-w','Edite este vídeo',[f.input]);
  const slow=createChatEditRequests(f.db,{getCurrentProfile:()=>'owner',getAgents:()=>f.agents,getSessions:()=>f.sessions,production:f.bridge.production,isVideoEditor:(_p,agent)=>agent.id.startsWith('editor-de-video'),inspect:async path=>{f.db.prepare('INSERT INTO content_tombstone_ids VALUES(?,?,?,?)').run('owner','session','chat-w','');return inspect(path);}});
  const before=f.runs().length;await assert.rejects(slow.admit('owner',{sessionId:'chat-w',messageId:w}),error=>error.status===410);
  assert.equal(f.runs().length,before,'no run for a chat deleted mid-admission');
 }finally{await f.close();}
});

test('saved text, attachments, agent, editor and director are rebound after awaits; POST text and window cannot authorize work',{timeout:60000},async()=>{
 const f=await chatEditFixture();try{
  f.chat('binding','conteudo');
  const service=mutate=>createChatEditRequests(f.db,{getCurrentProfile:()=>'owner',getAgents:()=>f.agents,getSessions:()=>f.sessions,production:f.bridge.production,isVideoEditor:(_p,a)=>a.id.startsWith('editor-de-video'),inspect:async path=>{const file=await inspect(path);mutate();return file;}});
  for(const change of ['text','attachment','provider','editor','director']){
   const id=f.say('binding','Pode editar este vídeo?',[f.input]),message=f.sessions[0].messages.at(-1),backup=structuredClone(f.agents);
   await assert.rejects(service(()=>{
    if(change==='text')message.content='Não edite este vídeo';
    if(change==='attachment')message.attachments[0].path=f.other;
    if(change==='provider')f.sessions[0].providerId='claude';
    if(change==='editor')f.agents[1].instructions='changed';
    if(change==='director')f.bridge.production.setEditDirector('owner',{workspaceId:'space',director:{providerId:'codex'}});
   }).admit('owner',{sessionId:'binding',messageId:id}),/mudou durante/);
   f.agents.splice(0,f.agents.length,...backup);f.sessions[0].providerId='codex';
  }
  assert.equal(f.runs().length,0);
  const no=f.say('binding','Analise este vídeo',[f.input]);
  await assert.rejects(f.admit('binding',no,{text:'Edite este vídeo',authorize:true}),e=>e.status===422);
  const adjust=f.say('binding','Entre 2 e 4 segundos troque a animação');
  await assert.rejects(f.admit('binding',adjust,{window:{start:0,end:6}}),/intervalo precisa ser o da mensagem salva/);
 }finally{await f.close();}
});
