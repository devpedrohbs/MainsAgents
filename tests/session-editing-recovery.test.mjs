import test from 'node:test';
import assert from 'node:assert/strict';
import {isMissingThreadError,isThreadNotLoadedError,recoveryBriefing,recoveryNotice,recoveredSession} from '../src/features/chat/sessionRecovery.ts';
import {chatSessionSnapshot,contentBinding,contentSessionSummary,sessionListLabel} from '../src/features/chat/contentSessions.ts';
import {mergeProductionSessions} from '../src/features/production/model.ts';

const at='2026-10-10T18:00:00.000Z';
const session=(id,extra={})=>({id,agentId:'source',providerId:'codex',title:id,messages:[],createdAt:at,updatedAt:at,...extra});
const content=(id,workspaceId='space')=>({id,workspaceId,topicId:`topic-${id}`,title:`Título ${id}`,format:'short-video',platforms:[],status:'planning',taskId:`task-${id}`,createdAt:at,updatedAt:at});
const entry=(name,sessionId)=>({kind:'recorded',origin:'text',context:{kind:'text',text:`contexto de ${name}`,hash:'h'},video:{assetId:`v-${name}`,versionId:'1',sha256:'s',name},sessionId,authorizedAt:at});
const run=(id,contentId,sourceId,extra={})=>({id,revision:1,workspaceId:'space',contentId,topicId:`topic-${contentId}`,flowId:'flow',name:'Fluxo',stage:'video-review',sourceAgent:{id:'source',name:'Fonte'},editorAgent:{id:'editor',name:'Editor'},sourceSession:{...session(sourceId),contentId,messages:[{id:`production:${id}:1:editing:video`,type:'message',role:'agent',content:`Vídeo de ${contentId}`,createdAt:at}]},editorSession:{...session(`${id}-editor`,{agentId:'editor'}),contentId},topic:{id:`topic-${contentId}`,title:`Vídeo ${contentId}`},events:[],timeZone:'America/Sao_Paulo',updatedAt:at,...extra});
const agents=[{id:'source',workspaceId:'space'},{id:'editor',workspaceId:'space'}];

test('only a missing provider thread is recovered; busy, auth, policy and network failures are not, and age never decides',()=>{
 for(const message of ['no rollout found for thread id 01a11dda-4f86-7b22-9ac3-7c6a38bbba11','thread/resume failed: no rollout found for thread id 01a1','no persisted rollout for thread 01a1','thread not found: 01a1','No conversation found with session ID: 7f0c'])assert.equal(isMissingThreadError(new Error(message)),true,message);
 assert.equal(isMissingThreadError(Object.assign(new Error('Gone'),{code:'thread-missing'})),true,'bridge contract code');
 for(const message of ['This session already has an active writer','another Codex window is still finishing','Sign in to Codex','Resume this session in MainsAgents before sending a message so its tool policy can be verified.','fetch failed','Codex bridge returned 500','The session is too old'])assert.equal(isMissingThreadError(new Error(message)),false,message);
 assert.equal(isMissingThreadError(undefined),false);
 // Coordinator contract: an unloaded thread is resumed by the bridge, never declared missing; malformed ids, executor setup,
 // sign-in and transport failures keep the thread and surface the real error (no silent new conversation).
 for(const message of ['thread/read failed: thread not loaded: 01a11dda','invalid session id: abc','Invalid thread id','helper_unknown_error: setup refresh had errors','trusted Node process exited unexpectedly; kernel reset','HTTP 401 Unauthorized','connect ECONNREFUSED 127.0.0.1:8787','Request timed out','rate limit reached','thread not found: invalid session id'])assert.equal(isMissingThreadError(new Error(message)),false,message);
 assert.equal(isMissingThreadError(Object.assign(new Error('Codex bridge returned 500'),{status:500})),false,'status alone never means missing');
 // Broad texts dropped from the fallback: only the CLI messages proven for an absent thread count.
 for(const message of ['Thread 01a1 not materialized yet','unknown thread 01a1','the thread 01a1 was not found in the list'])assert.equal(isMissingThreadError(new Error(message)),false,message);
 // Structured codes from the bridge win over any text.
 assert.equal(isMissingThreadError(Object.assign(new Error('no rollout found for thread id x'),{status:400,code:'invalid-thread-id'})),false);
 assert.equal(isMissingThreadError(Object.assign(new Error('Resume this session'),{status:409,code:'thread-not-loaded'})),false,'unloaded is resumed, not replaced');
 assert.equal(isThreadNotLoadedError(Object.assign(new Error('x'),{status:409,code:'thread-not-loaded'})),true);
 assert.equal(isThreadNotLoadedError(new Error('thread not loaded')),false,'only the structured contract triggers the same-thread resume');
});

test('recovery briefing carries the saved chat once, bounded, without the current request and forbids replaying past effects',()=>{
 const messages=[{id:'u1',type:'message',role:'user',content:'Edite o vídeo LinkedinSkills.MOV',createdAt:at},{id:'a1',type:'message',role:'agent',sourceAgentName:'Editor de Vídeo',content:'Não consegui gravar arquivos.',deliveryState:'completed',createdAt:at},{id:'run',type:'activity',kind:'run',label:'x',status:'done'},{id:'s',type:'message',role:'agent',content:'parcial',deliveryState:'streaming',createdAt:at},{id:'now',type:'message',role:'user',content:'PEDIDO ATUAL',createdAt:at}];
 const text=recoveryBriefing(messages,'now');
 assert.match(text,/do NOT repeat them/);assert.match(text,/user: Edite o vídeo LinkedinSkills\.MOV/);assert.match(text,/agent \(Editor de Vídeo\): Não consegui/);
 assert(!text.includes('PEDIDO ATUAL'),'the current request is sent once, after the briefing');assert(!text.includes('parcial'),'streaming fragments are not history');
 assert(text.endsWith('Current request:\n'));
 const long=Array.from({length:40},(_,index)=>({id:`m${index}`,type:'message',role:'user',content:`${index} `+'x'.repeat(3000),createdAt:at}));
 const bounded=recoveryBriefing(long);assert(bounded.length<26000,String(bounded.length));assert.match(bounded,/older message\(s\) were not included/);assert(bounded.includes('39 x'),'the latest messages win the budget');
});

test('a recovered session keeps history, content link and production snapshot, records the old thread and tells the user',()=>{
 const before=session('chat',{contentId:'a',topicId:'topic-a',remoteSessionId:'old-thread',codexThreadId:'old-thread',productionContext:{id:'run-a',stage:'video-review',recentResults:[]},messages:[{id:'u',type:'message',role:'user',content:'oi',createdAt:at}]});
 const after=recoveredSession(before,'codex','new-thread','old-thread',at);
 assert.equal(after.remoteSessionId,'new-thread');assert.equal(after.codexThreadId,'new-thread');assert.equal(after.previousCodexThreadId,'old-thread');
 assert.deepEqual(after.messages,before.messages);assert.equal(after.contentId,'a');assert.deepEqual(after.productionContext,before.productionContext);
 assert.deepEqual(after.threadRecoveries,[{previousRemoteSessionId:'old-thread',remoteSessionId:'new-thread',at}]);
 let many=before;for(let index=0;index<8;index++)many=recoveredSession(many,'codex',`t${index}`,`p${index}`,at);assert.equal(many.threadRecoveries.length,5,'bounded audit');
 const claude=recoveredSession(session('c',{providerId:'claude',remoteSessionId:'old'}),'claude','new','old',at);assert.equal(claude.codexThreadId,undefined);
 const notice=recoveryNotice('n',true);assert.equal(notice.status,'done','not an error: the chat continues');assert.match(notice.label,/nova conversa no provedor/);assert.match(notice.label,/nada foi repetido/);
});

test('a new chat of a content with a running production recognizes it read-only and points to the main conversation; never restarts it',()=>{
 const contents=[content('a'),content('b')],runs=[run('run-a','a','session-a',{entry:entry('LinkedinSkills.MOV','session-a')}),run('run-b','b','session-b',{entry:entry('outro.mp4','session-b')})];
 const fresh=session('new-chat',{contentId:'a'});
 const binding=contentBinding(fresh,{workspaceId:'space',contents,runs});
 assert.equal(binding.kind,'content');assert.equal(binding.run,undefined,'not a role session: it cannot command the run');assert.equal(binding.mainRun.id,'run-a');
 const summary=contentSessionSummary(binding,[]);
 assert.equal(summary.next,'main-session');assert.deepEqual(summary.mainSession,{agentId:'source',sessionId:'session-a'});
 assert(summary.materials.includes('Vídeo gravado: LinkedinSkills.MOV'));assert(!summary.materials.some(item=>item.includes('outro.mp4')),'never another content');
 assert.match(summary.nextAction,/conversa principal/);assert.equal(sessionListLabel(binding),'Conteúdo · Aguardando aprovação do vídeo');
 // The main conversation keeps commanding its own run.
 assert.equal(contentBinding(session('session-a',{contentId:'a'}),{workspaceId:'space',contents,runs}).run.id,'run-a');
 // Generic chats and other workspaces never adopt a production.
 assert.deepEqual(contentBinding(session('generic'),{workspaceId:'space',contents,runs}),{kind:'generic'});
 assert.equal(contentBinding(fresh,{workspaceId:'space',contents,runs:runs.map(item=>({...item,workspaceId:'other'}))}).mainRun,undefined);
 // An active run wins over an older finished one; with no run the chat offers to start (button only, nothing automatic).
 const old=run('run-old','a','session-old',{stage:'complete',updatedAt:'2026-10-11T00:00:00.000Z'});
 assert.equal(contentBinding(fresh,{workspaceId:'space',contents,runs:[old,...runs]}).mainRun.id,'run-a');
 assert.equal(contentSessionSummary(contentBinding(fresh,{workspaceId:'space',contents,runs:[]}),[]).next,'start');
});

test('the new chat receives a read-only snapshot of its own content production only; no messages are copied and nothing leaks',()=>{
 const runs=[run('run-a','a','session-a',{entry:entry('LinkedinSkills.MOV','session-a')}),run('run-b','b','session-b',{entry:entry('segredo-b.mp4','session-b')})];
 const current=[session('session-a',{contentId:'a'}),session('new-chat',{contentId:'a',remoteSessionId:'thread-new',messages:[{id:'u',type:'message',role:'user',content:'mande o vídeo ao editor',createdAt:at}]}),session('generic'),session('session-b',{contentId:'b'})];
 const merged=mergeProductionSessions(current,runs,agents),chat=merged.find(item=>item.id==='new-chat');
 assert.equal(chat.productionContext.id,'run-a');assert.equal(chat.productionContext.conductedIn,'main-session');assert.equal(chat.productionContext.entry.video,'LinkedinSkills.MOV');
 assert.deepEqual(chat.messages.map(item=>item.id),['u'],'production messages stay in the main conversation');assert.equal(chat.remoteSessionId,'thread-new','never inherits another chat thread');
 assert(!JSON.stringify(chat.productionContext).includes('segredo-b'));assert.equal(merged.find(item=>item.id==='generic').productionContext,undefined);
 assert.equal(merged.find(item=>item.id==='session-a').productionContext.conductedIn,undefined,'the main conversation is not marked read-only');
 assert.equal(mergeProductionSessions(merged,runs,agents),merged,'stable on repeated snapshots');
 // Content remapped (production gone from this profile): the read-only snapshot is dropped, the chat stays.
 const gone=mergeProductionSessions(merged,[runs[1]],agents).find(item=>item.id==='new-chat');assert.equal(gone.productionContext,undefined);assert.deepEqual(gone.messages.map(item=>item.id),['u']);
 // A chat of an agent outside the run workspace never gets it.
 assert.equal(mergeProductionSessions([session('x',{contentId:'a',agentId:'foreign'})],runs,agents)[0].productionContext,undefined);
});

test('the turn snapshot is read from the live session: own production, else own content identity; remapped or generic chats carry nothing stale',()=>{
 const own={id:'run-a',stage:'video-review',entry:{origin:'text',video:'LinkedinSkills.MOV'},recentResults:[]};
 const main=chatSessionSnapshot({contentId:'a',title:'A',productionContext:own});
 assert.match(main,/authoritative production snapshot/);assert(main.includes('LinkedinSkills.MOV'));assert(!main.includes('Abrir etapa atual'),'the main conversation keeps its normal instructions');
 const second=chatSessionSnapshot({contentId:'a',title:'A',productionContext:{...own,conductedIn:'main-session'}});
 assert.match(second,/Abrir etapa atual/);assert.match(second,/never say the video was sent/);assert.match(second,/do not delegate the edit/);
 assert.equal(JSON.parse(second.split('tools):\n')[1].split('\nThe app owns')[0]).id,'run-a','snapshot format kept for the main payload parser');
 // Content remapped/production gone: only this content identity, never the old snapshot.
 const remapped=chatSessionSnapshot({contentId:'b',contentTitle:'Conteúdo B',title:'x'});
 assert.match(remapped,/"contentId":"b"/);assert(!remapped.includes('LinkedinSkills'));assert.match(remapped,/none yet/);
 assert.equal(chatSessionSnapshot({title:'genérico'}),'','generic chats get no content data');
});
