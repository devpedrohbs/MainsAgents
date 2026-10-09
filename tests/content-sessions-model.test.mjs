import test from 'node:test';
import assert from 'node:assert/strict';
import {contentBinding,contentSessionSummary,linkedRun,sessionListLabel} from '../src/features/chat/contentSessions.ts';
import {mergeProductionSessions} from '../src/features/production/model.ts';
import {productionProgress} from '../src/features/production/productionProgress.ts';
import {createSessionContent,createRecordingContent} from '../src/features/content/recordingContent.ts';
import {emptyEditorialState} from '../src/features/content/model.ts';
import {chatDraftKey} from '../src/features/chat/chatDraftModel.ts';

const at='2026-10-08T12:00:00.000Z';
const session=(id,extra={})=>({id,agentId:'source',providerId:'codex',title:id,messages:[],createdAt:at,updatedAt:at,...extra});
const content=(id,workspaceId='space')=>({id,workspaceId,topicId:`topic-${id}`,title:`Título ${id}`,format:'short-video',platforms:[],status:'planning',taskId:`task-${id}`,createdAt:at,updatedAt:at});
const run=(id,contentId,sourceId,extra={})=>({id,revision:1,workspaceId:'space',contentId,topicId:`topic-${contentId}`,flowId:'flow',name:'Fluxo',stage:'video-review',sourceAgent:{id:'source',name:'Fonte'},editorAgent:{id:'editor',name:'Editor'},sourceSession:{...session(sourceId),contentId,messages:[{id:`production:${id}:1:video-review:video`,type:'message',role:'agent',content:`Vídeo de ${contentId}`,createdAt:at}]},editorSession:{...session(`${id}-editor`,{agentId:'editor'}),contentId,messages:[]},topic:{id:`topic-${contentId}`,title:contentId},timeZone:'UTC',events:[{action:'recorded-import',detail:'',at},{action:'video-review',detail:'',at}],updatedAt:at,...extra});

test('session content is its own content + idea in review, never an approval, script or Notion link',()=>{
 const {state,content:created,topic}=createSessionContent(emptyEditorialState(),'space','  Vídeo A  ','Contexto breve');
 assert.equal(created.title,'Vídeo A');assert.equal(topic.status,'review');assert.equal(topic.contentId,created.id);assert.equal(created.topicId,topic.id);assert.equal(topic.summary,'Contexto breve');
 assert.equal(state.approvals.length,0);assert.equal(state.artifacts.length,0);assert.equal(created.approvedScriptArtifactId,undefined);
 const second=createSessionContent(state,'space','Vídeo A');assert.notEqual(second.content.id,created.id,'same title is a different content: identity is the id');
 assert.equal(createRecordingContent(emptyEditorialState(),'space','Gravação').state.topics[0].status,'draft','recording containers keep their old behavior');
});

test('content binding is validated by workspace, contentId and sessionId; generic chats stay plain',()=>{
 const contents=[content('a'),content('b'),content('x','other')],runs=[run('run-a','a','session-a'),run('run-b','b','session-b')];
 assert.deepEqual(contentBinding(session('chat'),{workspaceId:'space',contents,runs}),{kind:'generic'});
 const a=contentBinding(session('session-a',{contentId:'a'}),{workspaceId:'space',contents,runs});assert.equal(a.kind,'content');assert.equal(a.run.id,'run-a');
 assert.equal(contentBinding(session('session-b',{contentId:'b'}),{workspaceId:'space',contents,runs}).run.id,'run-b');
 assert.deepEqual(contentBinding(session('gone',{contentId:'deleted'}),{workspaceId:'space',contents,runs}),{kind:'invalid',reason:'missing-content'});
 assert.deepEqual(contentBinding(session('foreign',{contentId:'x'}),{workspaceId:'space',contents,runs}),{kind:'invalid',reason:'other-workspace'});
 // A session saved for content A that a run of B lists is never shown B's production.
 assert.deepEqual(contentBinding(session('session-b',{contentId:'a'}),{workspaceId:'space',contents,runs}),{kind:'invalid',reason:'run-mismatch'});
 assert.equal(linkedRun(runs,session('session-b',{contentId:'a'}),'space'),undefined);
 assert.equal(linkedRun(runs,session('session-a'),'other'),undefined);
 assert.equal(sessionListLabel(a),'Conteúdo · Aguardando aprovação do vídeo');assert.equal(sessionListLabel({kind:'generic'}),null);
});

test('resume summary comes from saved state only: agent text never advances it',()=>{
 const contents=[content('a')],recorded=run('run-a','a','session-a',{entry:{kind:'recorded',origin:'text',context:{kind:'text',text:'x'.repeat(42),hash:'h'},video:{assetId:'v',versionId:'1',sha256:'s',name:'gravado.mp4'},sessionId:'session-a',authorizedAt:at},outputVideo:{assetId:'o',versionId:'1',sha256:'o'}});
 const chatty=session('session-a',{contentId:'a',messages:[{id:'m',type:'message',role:'agent',content:'Pronto! Vídeo aprovado e agendado.',createdAt:at}]});
 const summary=contentSessionSummary(contentBinding(chatty,{workspaceId:'space',contents,runs:[recorded]}),[]);
 assert.equal(summary.stage,'Aguardando aprovação do vídeo');assert.equal(summary.next,'production');assert.match(summary.nextAction,/Revise o vídeo editado/);
 assert(summary.materials.includes('Vídeo gravado: gravado.mp4'));assert(summary.materials.includes('Contexto colado (42 caracteres)'));assert(summary.materials.includes('Vídeo editado aguardando revisão'));
 assert.match(summary.lastDecision,/^Vídeo já gravado importado/);
 const fresh=contentSessionSummary(contentBinding(session('session-a',{contentId:'a'}),{workspaceId:'space',contents,runs:[]}),[{id:'v',workspaceId:'space',contentId:'a',kind:'video',role:'source',status:'available',name:'cru.mp4',currentVersionId:'1',versions:[],createdAt:at,updatedAt:at},{id:'other',workspaceId:'space',contentId:'b',kind:'video',role:'source',status:'available',name:'de-B.mp4',currentVersionId:'1',versions:[],createdAt:at,updatedAt:at}]);
 assert.equal(fresh.next,'start');assert.deepEqual(fresh.materials,['1 vídeo(s) gravado(s): cru.mp4'],'B files never appear in A');
 assert.equal(contentSessionSummary(contentBinding(session('gone',{contentId:'zz'}),{workspaceId:'space',contents,runs:[]}),[]).next,'repair');
 assert.equal(contentSessionSummary({kind:'generic'},[]),null);
});

test('recorded entry progress omits script and recording phases instead of showing them pending',()=>{
 const view=productionProgress(run('run-a','a','session-a',{entry:{kind:'recorded'}}));
 assert.deepEqual(view.phases.map(p=>p.id),['editing','package','schedule','complete']);assert.equal(view.phases[0].status,'current');
 const paused=productionProgress(run('run-a','a','session-a',{entry:{kind:'recorded'},stage:'paused',events:[{action:'recorded-import',detail:'',at}]}));
 assert.equal(paused.stoppedAt,'Editor preparando o plano');
 assert.equal(productionProgress(run('run-legacy','a','session-a')).phases.length,6,'other productions keep all phases');
});

test('two runs in the same agent mirror into their own sessions only, keeping user history and remote threads',()=>{
 const agents=[{id:'source',workspaceId:'space'},{id:'editor',workspaceId:'space'}];
 const current=[session('session-a',{contentId:'a',remoteSessionId:'thread-a',messages:[{id:'u',type:'message',role:'user',content:'pedido A',createdAt:at}]}),session('session-b',{contentId:'b',remoteSessionId:'thread-b'}),session('generic',{messages:[{id:'g',type:'message',role:'user',content:'livre',createdAt:at}]})];
 const merged=mergeProductionSessions(current,[run('run-a','a','session-a'),run('run-b','b','session-b')],agents);
 const a=merged.find(s=>s.id==='session-a'),b=merged.find(s=>s.id==='session-b'),g=merged.find(s=>s.id==='generic');
 assert.deepEqual(a.messages.map(m=>m.content),['pedido A','Vídeo de a']);assert.deepEqual(b.messages.map(m=>m.content),['Vídeo de b']);
 assert.equal(a.productionContext.id,'run-a');assert.equal(b.productionContext.id,'run-b');assert.equal(a.remoteSessionId,'thread-a');assert.equal(b.remoteSessionId,'thread-b');
 assert.equal(g.contentId,undefined);assert.equal(g.productionContext,undefined);
 // A run that claims B's session for content A is ignored: no cross-content adoption.
 const hijack=mergeProductionSessions(merged,[run('run-x','a','session-b')],agents);assert.equal(hijack.find(s=>s.id==='session-b').productionContext.id,'run-b');
 assert.notEqual(chatDraftKey('source','session-a'),chatDraftKey('source','session-b'));assert.notEqual(chatDraftKey('source','session-a'),chatDraftKey('source',undefined));
});

test('a recorded content already in editing is not listed as needing a script',async()=>{
 const {editorialInbox}=await import('../src/features/content/editorialInbox.ts');
 const state={...emptyEditorialState(),contents:[{...content('rec'),productionStage:'editing'},{...content('idea'),productionStage:'planning'}]};
 const kinds=editorialInbox(state,[],'space').map(item=>`${item.contentId}:${item.kind}`);
 assert(!kinds.includes('rec:script-needed'));assert(kinds.includes('idea:script-needed'),'the idea path keeps its hint');
});

test('specialist/connected children inherit the content link and a background child never switches the visible session',async()=>{
 const {childContentLink,activeAfterCreate}=await import('../src/features/chat/contentSessions.ts');
 assert.deepEqual(childContentLink({contentId:'a',topicId:'topic-a'}),{contentId:'a',topicId:'topic-a'});assert.equal(childContentLink({}),undefined);assert.equal(childContentLink(undefined),undefined);
 const viewing={editor:'editor-session-of-B'};
 assert.deepEqual(activeAfterCreate(viewing,'editor','child-of-A',false),viewing,'handoff child of A does not replace B in the target agent');
 assert.deepEqual(activeAfterCreate({},'editor','child-of-A',false),{editor:'child-of-A'},'an agent with no open session shows the child');
 assert.deepEqual(activeAfterCreate(viewing,'editor','explicit',true),{editor:'explicit'});
});

test('the main conversation gets the editor results of the same run and a path-free content snapshot; same-agent roles create no visible clones',()=>{
 const agents=[{id:'source',workspaceId:'space'},{id:'editor',workspaceId:'space'}];
 const editorMsg={id:'production:run-a:1:editing:video',type:'message',role:'agent',content:'Vídeo exportado: final.mp4\nC:\\Users\\me\\production-media\\final.mp4 /Users/me/raw.mp4',createdAt:'2026-10-08T12:05:00.000Z'};
 const a=run('run-a','a','session-a',{topic:{id:'topic-a',title:'Vídeo A'},sourceAgent:{id:'source',name:'Fonte'},editorAgent:{id:'editor',name:'Editor de Vídeo'},editorSession:{...session('run-a-editor',{agentId:'editor'}),contentId:'a',messages:[editorMsg]},entry:{kind:'recorded',origin:'text',context:{kind:'text',text:'TEXT_A colado',hash:'h'},video:{assetId:'v',versionId:'1',sha256:'s',name:'gravado-a.mp4'},sessionId:'session-a',authorizedAt:at},outputVideo:{assetId:'o',versionId:'1',sha256:'o'},editPlan:{summary:'Cortar pausas'},events:[{action:'recorded-import',detail:'Vídeo já gravado',at},{action:'video-review',detail:'',at}]});
 const b=run('run-b','b','session-b',{topic:{id:'topic-b',title:'Vídeo B'},editorAgent:{id:'source',name:'Fonte'},editorSession:{...session('run-b-editor'),contentId:'b',messages:[{...editorMsg,id:'production:run-b:1:editing:video',content:'Vídeo B exportado'}]},entry:{kind:'recorded',origin:'notion',context:{kind:'notion',pageId:'p',url:'https://www.notion.so/p',fetchedAt:at,chars:9},video:{assetId:'w',versionId:'1',sha256:'t',name:'gravado-b.mp4'},sessionId:'session-b',authorizedAt:at},notionRead:{text:'CARD_B texto do card'}});
 const merged=mergeProductionSessions([session('session-a',{contentId:'a'}),session('session-b',{contentId:'b'})],[a,b],agents);
 const ma=merged.find(s=>s.id==='session-a'),mb=merged.find(s=>s.id==='session-b');
 const relayed=ma.messages.find(m=>m.id===editorMsg.id);assert.equal(relayed.sourceAgentName,'Editor de Vídeo');assert(merged.some(s=>s.id==='run-a-editor'),'a different editor agent keeps its own chat');
 assert.equal(merged.some(s=>s.id==='run-b-editor'),false,'same-agent editor role never becomes a second visible chat');assert(mb.messages.some(m=>m.content==='Vídeo B exportado'),'its result reaches the main conversation');
 const ca=ma.productionContext,cb=mb.productionContext;
 assert.equal(ca.title,'Vídeo A');assert.equal(ca.entry.context,'TEXT_A colado');assert.equal(ca.entry.video,'gravado-a.mp4');assert.equal(ca.lastDecision.action,'video-review');assert.equal(ca.materials.editedVideo,'aguardando revisão');assert.equal(ca.materials.editPlan,'Cortar pausas');
 const results=ca.recentResults.join('\n');assert(!results.includes('C:\\Users'),'no local path in the prompt snapshot');assert(results.includes('[arquivo local]'),results);assert(!JSON.stringify(ca).includes('CARD_B'));
 assert.equal(cb.entry.context,'CARD_B texto do card');assert.equal(cb.entry.cardUrl,'https://www.notion.so/p');assert(!JSON.stringify(cb).includes('TEXT_A'));
 // An old visible same-agent role chat (earlier versions) keeps being updated, not removed.
 const kept=mergeProductionSessions([session('session-b',{contentId:'b'}),session('run-b-editor',{contentId:'b'})],[b],agents);assert(kept.find(s=>s.id==='run-b-editor').messages.some(m=>m.content==='Vídeo B exportado'));
 assert.equal(mergeProductionSessions(merged,[a,b],agents),merged,'stable on repeated snapshots');
});

test('long context is cut at the limit with an explicit truncation marker',()=>{
 const long='x'.repeat(7000),r=run('run-l','l','session-l',{entry:{kind:'recorded',origin:'text',context:{kind:'text',text:long,hash:'h'},video:{assetId:'v',versionId:'1',sha256:'s',name:'v.mp4'},sessionId:'session-l',authorizedAt:at}});
 const merged=mergeProductionSessions([session('session-l',{contentId:'l'})],[r],[{id:'source',workspaceId:'space'},{id:'editor',workspaceId:'space'}]),ctx=merged[0].productionContext;
 assert.equal(ctx.entry.context.length,6000);assert.deepEqual(ctx.entry.truncated,{shownChars:6000,totalChars:7000});
 const short=mergeProductionSessions([session('session-a',{contentId:'a'})],[run('run-a','a','session-a',{entry:{...r.entry,context:{kind:'text',text:'curto',hash:'h'}}})],[{id:'source',workspaceId:'space'},{id:'editor',workspaceId:'space'}])[0].productionContext;assert.equal(short.entry.truncated,undefined);
});
