import test from 'node:test';
import assert from 'node:assert/strict';
import {activeScopeKey,chatFamily,delegationBusy,linkOf,normalizeContentScopes,organizeSessions,OrganizeRefused,withVisible,connectedFamily,contentScopeKey,contentSpaces,continueTargetProblem,effectiveScope,emptyContentScopes,mergeContentScopes,organizeCheck,resolveScopeSession,scopeOfSession,scopeSessions,validateContentScopes,withActive,withOpened,withoutSession,withSelected} from '../src/features/chat/contentScopes.ts';
import {generalChatJoinsRun,mergeProductionSessions} from '../src/features/production/model.ts';
import {composeImport,parseBackup,safeData} from '../src/data/backupFormat.ts';

const at=(minute=0)=>`2026-10-13T12:${String(minute).padStart(2,'0')}:00.000Z`;
const session=(id,agentId,extra={})=>({id,agentId,providerId:'codex',title:id,messages:[],createdAt:at(),updatedAt:at(),...extra});
const content=(id,title=`Vídeo ${id}`,workspaceId='space')=>({id,workspaceId,topicId:`topic-${id}`,title,format:'short-video',platforms:[],status:'planning',taskId:`task-${id}`,createdAt:at(),updatedAt:at()});
const run=(id,contentId,sourceId,editorId,extra={})=>({id,revision:1,workspaceId:'space',contentId,topicId:`topic-${contentId}`,flowId:'flow',name:'Fluxo',stage:'video-review',sourceAgent:{id:'writer',name:'Conteúdo'},editorAgent:{id:'editor',name:'Editor'},sourceSession:session(sourceId,'writer',{contentId,topicId:`topic-${contentId}`}),editorSession:session(editorId,'editor',{contentId,topicId:`topic-${contentId}`}),topic:{},events:[],createdAt:at(),updatedAt:at(),...extra});
const agents=[{id:'writer',workspaceId:'space'},{id:'editor',workspaceId:'space'},{id:'foreign',workspaceId:'other'}];
const msg=(id,role='user',extra={})=>({id,type:'message',role,content:id,createdAt:at(),...extra});

test('two contents with the same agent and the same editor stay in separate scopes; identity is the id, never the title',()=>{
 const contents=[content('a','Mesmo título'),content('b','Mesmo título')],ctx={workspaceId:'space',contents,runs:[]};
 const sessions=[session('wa','writer',{contentId:'a',topicId:'topic-a',updatedAt:at(5)}),session('wb','writer',{contentId:'b',topicId:'topic-b',updatedAt:at(9)}),session('ea','editor',{contentId:'a',topicId:'topic-a'}),session('g','writer',{updatedAt:at(20)})];
 assert.deepEqual(scopeSessions(sessions,'writer',contentScopeKey('a'),ctx).map(s=>s.id),['wa']);
 assert.deepEqual(scopeSessions(sessions,'writer',contentScopeKey('b'),ctx).map(s=>s.id),['wb']);
 assert.deepEqual(scopeSessions(sessions,'writer','general',ctx).map(s=>s.id),['g']);
 let state=withSelected(emptyContentScopes(),'space',contentScopeKey('a'));
 assert.equal(resolveScopeSession(sessions,state,'writer',contentScopeKey('a'),ctx).id,'wa');
 assert.equal(resolveScopeSession(sessions,state,'editor',contentScopeKey('a'),ctx).id,'ea','switching agent keeps the content');
 assert.equal(resolveScopeSession(sessions,state,'editor',contentScopeKey('b'),ctx),undefined,'no same-content chat → empty, never the editor chat of A');
 // Concurrent update: B's chat becomes the most recent overall; A's scope still shows A.
 const updated=sessions.map(s=>s.id==='wb'?{...s,updatedAt:at(59),messages:[msg('late-b','agent')]}:s);
 assert.equal(resolveScopeSession(updated,state,'writer',contentScopeKey('a'),ctx).id,'wa');
 const spaces=contentSpaces(updated,['writer','editor'],ctx);
 assert.equal(spaces.filter(s=>s.kind==='content').length,2,'two boxes with the same title');
 assert.deepEqual(spaces.find(s=>s.scope===contentScopeKey('a')).agents,[{agentId:'writer',chats:1},{agentId:'editor',chats:1}]);
});

test('saved pointer wins inside its scope; a pointer to another scope, agent or deleted chat is ignored',()=>{
 const ctx={workspaceId:'space',contents:[content('a')],runs:[]};
 const sessions=[session('a1','writer',{contentId:'a',updatedAt:at(1)}),session('a2','writer',{contentId:'a',updatedAt:at(2)}),session('g','writer')];
 let state=withActive(emptyContentScopes(),'space','writer',contentScopeKey('a'),'a1');
 assert.equal(resolveScopeSession(sessions,state,'writer',contentScopeKey('a'),ctx).id,'a1');
 state=withActive(state,'space','writer',contentScopeKey('a'),'g');
 assert.equal(resolveScopeSession(sessions,state,'writer',contentScopeKey('a'),ctx).id,'a2','foreign pointer falls back to most recent of the same scope');
 state=withoutSession(withActive(state,'space','writer',contentScopeKey('a'),'a1'),'a1');
 assert.equal(state.active[activeScopeKey('space','writer',contentScopeKey('a'))],undefined);
});

test('opening selects the chat scope; the shown chat is pinned so a newer background sibling never takes over',()=>{
 const ctx={workspaceId:'space',contents:[content('a'),content('b')],runs:[]};
 // Imported editor chat of A, shown without any saved pointer (legacy/imported state).
 let sessions=[session('ea-old','editor',{contentId:'a',topicId:'topic-a',updatedAt:at(1)}),session('eb','editor',{contentId:'b',topicId:'topic-b',updatedAt:at(2)})];
 let state=withSelected(emptyContentScopes(),'space',contentScopeKey('a'));
 const shown=resolveScopeSession(sessions,state,'editor',contentScopeKey('a'),ctx);assert.equal(shown.id,'ea-old');
 state=withVisible(state,'space','editor',contentScopeKey('a'),shown.id); // what the panel does when it shows a chat
 // Native/production output adds a NEWER same-scope sibling and newer chats elsewhere: the shown chat stays.
 sessions=[...sessions,session('ea-native','editor',{contentId:'a',topicId:'topic-a',originHandoffId:'job',updatedAt:at(50)}),session('eb-new','editor',{contentId:'b',topicId:'topic-b',updatedAt:at(55)})];
 assert.equal(resolveScopeSession(sessions,state,'editor',contentScopeKey('a'),ctx).id,'ea-old');
 assert.equal(state.selected.space,contentScopeKey('a'),'background never changes the selection');
 const quiet=withOpened(state,'space',{id:'canvas',agentId:'writer'},false);
 assert.equal(quiet.selected.space,contentScopeKey('a'),'open without select (Canvas) keeps the selection');
 const opened=withOpened(state,'space',{id:'x',agentId:'writer',contentId:'b'});
 assert.equal(opened.selected.space,contentScopeKey('b'));assert.equal(opened.selected.other,undefined,'per workspace');
 // Explicit navigation still works while a reply is running: opening another chat of the scope moves the pointer.
 assert.equal(resolveScopeSession(sessions,withOpened(state,'space',sessions[2]),'editor',contentScopeKey('a'),ctx).id,'ea-native');
});

test('invalid links are visible in a recovery bucket; a deleted selected content falls back to it; legacy pointer seeds the first scope',()=>{
 const ctx={workspaceId:'space',contents:[content('a'),content('x','Outro','other')],runs:[run('run-b','b','stolen','eb')]};
 const sessions=[session('gone','writer',{contentId:'deleted'}),session('foreign','writer',{contentId:'x'}),session('stolen','writer',{contentId:'a'}),session('ok','writer',{contentId:'a'})];
 assert.deepEqual(sessions.map(s=>scopeOfSession(s,ctx)),['recovery','recovery','recovery',contentScopeKey('a')]);
 assert.equal(effectiveScope(withSelected(emptyContentScopes(),'space',contentScopeKey('deleted')),ctx),'recovery');
 assert.equal(effectiveScope(emptyContentScopes(),ctx,contentScopeKey('a')),contentScopeKey('a'));
 assert.equal(effectiveScope(emptyContentScopes(),ctx),'general');
 const state=withOpened(emptyContentScopes(),'space',sessions[0]);
 assert.equal(resolveScopeSession(sessions,state,'writer','recovery',ctx).id,'gone','opened invalid chat stays shown in recovery');
 assert.equal(contentSpaces(sessions,['writer'],ctx).at(-1).chats,3);
});

test('continue targets: same workspace, agent and content only; General never continues in a bound chat',()=>{
 const src={agentId:'writer',contentId:'a',topicId:'topic-a'};
 assert.equal(continueTargetProblem(src,{agentId:'editor',contentId:'a',topicId:'topic-a'},'editor',agents),undefined);
 assert.equal(continueTargetProblem(src,{agentId:'editor',contentId:'b'},'editor',agents),'other-content');
 assert.equal(continueTargetProblem(src,{agentId:'editor'},'editor',agents),'other-content');
 assert.equal(continueTargetProblem({agentId:'writer'},{agentId:'editor',contentId:'a'},'editor',agents),'other-content');
 assert.equal(continueTargetProblem({agentId:'writer'},{agentId:'editor'},'editor',agents),undefined);
 assert.equal(continueTargetProblem(src,{agentId:'writer',contentId:'a'},'editor',agents),'other-agent');
 assert.equal(continueTargetProblem(src,{agentId:'foreign',contentId:'a'},'foreign',agents),'other-workspace');
 assert.equal(continueTargetProblem(src,undefined,'editor',agents),'missing');
});

test('organize into content is explicit and refused when it would mix contexts; family grouping validates every member',()=>{
 const target=content('a'),runs=[run('run-b','b','b-source','b-editor')];
 const sessions=[
  session('idea','writer',{remoteSessionId:'thread-1',agentConnection:{enabled:true,targetAgentId:'editor',targetSessionId:'child'}}),
  session('child','editor',{originHandoffId:'h1'}),
  session('b-source','writer'),
  session('bound','writer',{contentId:'b'}),
  session('files','writer',{messages:[msg('m','agent',{receipts:[{id:'r',contentId:'b',name:'v.mp4',path:'x',size:1,sha256:'s',fileKind:'video',version:1,createdAt:at(),source:{kind:'media-export',id:'j'}}]})]}),
  session('twin','writer',{remoteSessionId:'thread-shared'}),session('twin2','writer',{remoteSessionId:'thread-shared'}),
 ];
 const base={sessions,agents,runs,artifacts:[{id:'art',workspaceId:'space',topicId:'t',contentId:'c',type:'file-delivery',version:1,data:{},createdAt:at(),source:{sessionId:'idea2',messageId:'m',messageHash:'h',agentId:'writer'}}],busy:id=>id==='busy'};
 assert.equal(organizeCheck(['idea'],target,base).ok,true);
 const problems=id=>organizeCheck([id],target,base).members[0].problems;
 assert.deepEqual(problems('b-source'),['production-other']);
 assert.deepEqual(problems('bound'),['bound-other']);
 assert.deepEqual(problems('files'),['files-other']);
 assert.deepEqual(problems('twin'),['shared-thread']);
 assert.equal(organizeCheck(['twin','twin2'],target,base).ok,true,'moving both sides of a shared thread together is safe');
 assert.deepEqual(organizeCheck(['idea'],content('z','Z','other'),base).members[0].problems,['other-workspace']);
 assert.deepEqual(organizeCheck(['busy'],target,{...base,sessions:[...sessions,session('busy','writer')]}).members[0].problems,['busy']);
 const family=connectedFamily(sessions[0],sessions).map(s=>s.id).sort();
 assert.deepEqual(family,['child','idea']);
 const stale=sessions.map(s=>s.id==='child'?{...s,contentId:'b'}:s);
 assert.deepEqual(connectedFamily(stale[0],stale).map(s=>s.id),['idea'],'a link to another content’s chat is not family');
 const poisoned=sessions.map(s=>s.id==='child'?{...s,messages:[msg('f','agent',{receipts:[{id:'r2',contentId:'b',name:'b.mp4',path:'x',size:1,sha256:'s',fileKind:'video',version:1,createdAt:at(),source:{kind:'media-export',id:'j'}}]})]}:s);
 const familyCheck=organizeCheck(connectedFamily(poisoned[0],poisoned).map(s=>s.id),target,{...base,sessions:poisoned});
 assert.equal(familyCheck.ok,false,'one family member holding another content’s file blocks the whole group');
});

test('production mirror never silently turns a General chat with its own conversation into a content',()=>{
 const generic=session('brain','writer',{messages:[msg('ideia solta')]}),empty=session('empty','writer'),child=session('child','editor',{originHandoffId:'job-1',messages:[msg('native-briefing')]});
 const delegated=run('run-a','a','brain','child',{entry:{kind:'recorded',origin:'delegation',delegationJobIds:['job-1'],sessionId:'brain',context:{kind:'text',text:'x',hash:'h'},video:{assetId:'v',versionId:'1',sha256:'s',name:'a.mp4'},authorizedAt:at()}});
 assert.equal(generalChatJoinsRun(generic,delegated),false);
 assert.equal(generalChatJoinsRun(child,delegated),true,'specialist chat born for this delegation joins');
 const merged=mergeProductionSessions([generic,child],[delegated],agents);
 assert.equal(merged.find(s=>s.id==='brain').contentId,undefined,'General brainstorming stays General');
 assert.equal(merged.find(s=>s.id==='child').contentId,'a');
 // Second video from the same General chat: another content; the chat still stays General and nothing is mixed into A.
 const second=run('run-b','b','brain','child-b',{updatedAt:at(30)});
 const twice=mergeProductionSessions(merged,[delegated,second],agents);
 assert.equal(twice.find(s=>s.id==='brain').contentId,undefined);
 assert.equal(twice.find(s=>s.id==='brain').productionContext.id,'run-b','latest run is the snapshot of the General chat');
 assert.equal(twice.find(s=>s.id==='child').contentId,'a');
 const fromEmpty=mergeProductionSessions([empty],[run('run-c','c','empty','ed')],agents);
 assert.equal(fromEmpty.find(s=>s.id==='empty').contentId,'c','an empty chat explicitly used to start a production joins it');
});

test('content scopes persist in backups: validated, profile data merged without overriding local choices',()=>{
 const state=withActive(withSelected(emptyContentScopes(),'space',contentScopeKey('a')),'space','writer',contentScopeKey('a'),'wa');
 assert.equal(validateContentScopes(state),true);
 assert.equal(validateContentScopes({schemaVersion:1,selected:{space:'content:'},active:{}}),false);
 assert.equal(validateContentScopes({schemaVersion:1,selected:{},active:{'bad-key':'x'}}),false);
 const file=data=>parseBackup(JSON.stringify({format:'mainsagents-backup',version:1,exportedAt:at(),data}));
 assert.throws(()=>file({'content-scopes':{schemaVersion:2}}),/content spaces/);
 const backup=file(safeData({'content-scopes':state}));
 assert.deepEqual(composeImport({},backup,'replace')['content-scopes'],state);
 const local=withSelected(emptyContentScopes(),'space','general');
 const merged=composeImport({'content-scopes':local},backup,'merge')['content-scopes'];
 assert.equal(merged.selected.space,'general','local selection wins');
 assert.equal(merged.active[activeScopeKey('space','writer',contentScopeKey('a'))],'wa');
 assert.deepEqual(mergeContentScopes(undefined,undefined),emptyContentScopes());
});

test('a delegated edit from a chat whose content was deleted is refused; no replacement content is created silently',async()=>{
 const {mkdtempSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{DatabaseSync}=await import('node:sqlite');
 const {createContentWorkflowBridge}=await import('../content-workflow-bridge.mjs');
 const dir=mkdtempSync(join(tmpdir(),'scopes-')),dbPath=join(dir,'state.sqlite'),stamp=at();
 const agentRows=[{id:'writer',name:'Conteúdo',workspaceId:'space',providerId:'codex',tools:[],skills:[]},{id:'editor',name:'Editor',workspaceId:'space',providerId:'codex',tools:[],skills:[]}];
 const inspect=async path=>({status:'available',kind:'video',path,name:'v.mp4',size:1,sha256:'a'.repeat(64),modifiedAt:stamp,checkedAt:stamp});
 const bridge=createContentWorkflowBridge({dbPath,getCurrentProfile:()=>'p',getAgents:()=>agentRows,getFlows:()=>({schemaVersion:1,flows:[],activeByWorkspace:{}}),getSessions:()=>[],inspect,mediaOptions:{inspect}});
 const db=new DatabaseSync(dbPath);db.prepare('INSERT INTO editorial_state VALUES(?,?,?,?)').run('p',1,JSON.stringify({schemaVersion:1,topics:[],contents:[],artifacts:[],approvals:[],runs:[],assets:[]}),stamp);
 await assert.rejects(bridge.production.startDelegatedEdit('p',{jobId:'job',sourceAgentId:'writer',targetAgentId:'editor',sourceSessionId:'s',targetSessionId:'t',contentId:'content-deleted',title:'Vídeo',instructions:'corte',videoPath:join(dir,'v.mp4')}),/não existe mais/);
 assert.equal(JSON.parse(db.prepare('SELECT state_json FROM editorial_state WHERE profile_id=?').get('p').state_json).contents.length,0);
 assert.equal(bridge.production.list('p').length,0);db.close();
});

test('B1: unsent text without a chat lives per workspace+scope; switching back restores it; General keeps the legacy draft',async()=>{
 const {chatDraftKey,draftSlot,putChatDraft}=await import('../src/features/chat/chatDraftModel.ts');
 const legacy={[JSON.stringify(['editor',null])]:{text:'RASCUNHO_GERAL_ANTIGO',skill:null,context:[]}};
 const slotA=draftSlot(undefined,'space','content:a'),slotB=draftSlot(undefined,'space','content:b');
 assert.equal(chatDraftKey('editor',draftSlot(undefined,'space','general')),JSON.stringify(['editor',null]),'General = legacy key');
 assert.notEqual(chatDraftKey('editor',slotA),chatDraftKey('editor',slotB));
 assert.notEqual(chatDraftKey('editor',draftSlot(undefined,'a|b','content:c')),chatDraftKey('editor',draftSlot(undefined,'a','content:b|c')),'tuple, no delimiter collision');
 let drafts=putChatDraft(legacy,'editor',slotA,{text:'corte ALFA',skill:null});
 drafts=putChatDraft(drafts,'editor',slotB,{text:'corte BETA',skill:null});
 assert.equal(drafts[chatDraftKey('editor',slotA)].text,'corte ALFA');assert.equal(drafts[chatDraftKey('editor',slotB)].text,'corte BETA');
 // Sending in B moves B's text into the new chat and clears only B's slot: A and the old General draft are untouched.
 drafts=putChatDraft(putChatDraft(drafts,'editor','chat-b',drafts[chatDraftKey('editor',slotB)]),'editor',slotB,{text:'',skill:null});
 assert.equal(drafts[chatDraftKey('editor',slotB)],undefined);assert.equal(drafts[chatDraftKey('editor','chat-b')].text,'corte BETA');
 assert.equal(drafts[chatDraftKey('editor',slotA)].text,'corte ALFA');assert.equal(drafts[JSON.stringify(['editor',null])].text,'RASCUNHO_GERAL_ANTIGO');
 // Scoped drafts survive a backup round trip; malformed keys are still refused.
 const file=data=>parseBackup(JSON.stringify({format:'mainsagents-backup',version:1,exportedAt:at(),data}));
 assert.deepEqual(composeImport({},file({'chat-drafts':drafts}),'replace')['chat-drafts'],drafts);
 assert.throws(()=>file({'chat-drafts':{[JSON.stringify(['editor',null,'space'])]:{text:'x',skill:null}}}),/chat drafts/);
});

test('slot keys are collision-free JSON tuples; pre-release delimited keys migrate without losing entries; strict import',()=>{
 assert.notEqual(activeScopeKey('a|b','c','general'),activeScopeKey('a','b|c','general'));
 const old={schemaVersion:1,selected:{space:'content:a'},active:{'space|writer|content:a':'wa','space|editor|general':'eg'}};
 assert.equal(validateContentScopes(old),true,'previous saved form stays readable');
 const migrated=normalizeContentScopes(old);
 assert.deepEqual(migrated.active,{[activeScopeKey('space','writer','content:a')]:'wa',[activeScopeKey('space','editor','general')]:'eg'});
 assert.equal(normalizeContentScopes(migrated),migrated,'already current: unchanged');
 const tricky=withActive(emptyContentScopes(),'w|1','agent|x','general','s1');
 assert.equal(validateContentScopes(tricky),true);assert.deepEqual(normalizeContentScopes(tricky),tricky,'ids with "|" stay intact');
 for(const bad of [{...old,extra:1},{schemaVersion:1,selected:{},active:{'["a","b"]':'x'}},{schemaVersion:1,selected:{},active:{[activeScopeKey('a','b','general')]:''}}])assert.equal(validateContentScopes(bad),false);
 const file=data=>parseBackup(JSON.stringify({format:'mainsagents-backup',version:1,exportedAt:at(),data}));
 assert.throws(()=>file({'content-scopes':{schemaVersion:1,selected:{},active:{'bad':'x'}}}),/content spaces/);
 const merged=composeImport({'content-scopes':tricky},file({'content-scopes':old}),'merge')['content-scopes'];
 assert.equal(merged.active[activeScopeKey('w|1','agent|x','general')],'s1');assert.equal(merged.active[activeScopeKey('space','writer','content:a')],'wa','imported legacy keys merged as tuples');
});

test('I1: organize re-runs the complete guard on the live state at apply time and is all-or-nothing',()=>{
 const target=content('a'),base={agents,runs:[],artifacts:[],contents:[target],busy:()=>false};
 const live=[session('idea','writer',{remoteSessionId:'thread-1',messages:[msg('idea-1')],agentConnection:{enabled:true,targetAgentId:'editor',targetSessionId:'child'}}),session('child','editor',{originHandoffId:'h1'})];
 const request={rootId:'idea',family:true,ids:['idea','child'],contentId:'a'};
 const moved=organizeSessions(live,request,base);
 assert.deepEqual(moved.filter(s=>s.contentId==='a').map(s=>s.id).sort(),['child','idea']);
 assert.equal(moved[0].remoteSessionId,'thread-1');assert.deepEqual(moved[0].messages,live[0].messages,'thread and history untouched');
 const refuse=(sessions,ctx,problem,req=request)=>{assert.throws(()=>organizeSessions(sessions,req,{...base,...ctx}),error=>error instanceof OrganizeRefused&&error.problems.includes(problem),problem);};
 // Manual handoff: the SOURCE looks idle while the job runs; delegationBusy covers both sides.
 const jobs=[{sourceSessionId:'idea',targetSessionId:'other',status:'queued'}];
 assert.equal(delegationBusy(jobs,'idea'),true);assert.equal(delegationBusy(jobs,'other'),true);assert.equal(delegationBusy([{...jobs[0],status:'completed'}],'idea'),false);
 refuse(live,{busy:id=>delegationBusy(jobs,id)},'busy');
 refuse(live.map(s=>s.id==='child'?{...s,messages:[msg('late','agent',{receipts:[{id:'r',contentId:'b',name:'b.mp4',path:'x',size:1,sha256:'s',fileKind:'video',version:1,createdAt:at(),source:{kind:'media-export',id:'j'}}]})]}:s),{},'files-other');
 refuse(live,{contents:[]},'missing');
 refuse(live,{runs:[run('run-b','b','idea','eb')]},'production-other');
 refuse([...live,session('newcomer','editor',{agentConnection:{enabled:true,targetAgentId:'writer',targetSessionId:'idea'}})],{},'family-changed');
 refuse([...live,session('twin','writer',{remoteSessionId:'thread-1'})],{},'shared-thread',{...request,family:false,ids:['idea']});
});

test('I2: a family over the limit is refused as a whole; within the limit every member moves; cross-scope links are reported, not moved',()=>{
 const chain=Array.from({length:26},(_,i)=>session(`c${i}`,i%2?'editor':'writer',{agentConnection:i<25?{enabled:true,targetAgentId:i%2?'writer':'editor',targetSessionId:`c${i+1}`}:undefined}));
 const big=chatFamily(chain[0],chain);assert.equal(big.truncated,true);assert.equal(big.members.length,24);
 assert.throws(()=>organizeSessions(chain,{rootId:'c0',family:true,ids:big.members.map(s=>s.id),contentId:'a'},{agents,runs:[],artifacts:[],contents:[content('a')],busy:()=>false}),error=>error.problems.includes('family-too-large'));
 assert.ok(chain.every(s=>s.contentId===undefined),'nothing moved');
 const small=chain.slice(0,24).map((s,i)=>i===23?{...s,agentConnection:{enabled:true,targetAgentId:'writer',targetSessionId:'bound'}}:s).concat(session('bound','writer',{contentId:'b'}));
 const fam=chatFamily(small[0],small);assert.equal(fam.truncated,false);assert.equal(fam.members.length,24);assert.deepEqual(fam.crossScope.map(s=>s.id),['bound']);
 const moved=organizeSessions(small,{rootId:'c0',family:true,ids:fam.members.map(s=>s.id),contentId:'a'},{agents,runs:[],artifacts:[],contents:[content('a')],busy:()=>false});
 assert.equal(moved.filter(s=>s.contentId==='a').length,24);assert.equal(moved.find(s=>s.id==='bound').contentId,'b');
});

test('I3: an archived content holding saved chats stays discoverable (labelled Arquivado) and its chats resolve normally',()=>{
 const archived={...content('old','Vídeo arquivado'),productionStage:'archived'},empty={...content('gone','Sem conversas'),productionStage:'archived'};
 const ctx={workspaceId:'space',contents:[archived,empty,content('a')],runs:[]};
 const sessions=[session('old-chat','writer',{contentId:'old',topicId:'topic-old',remoteSessionId:'thread-old'})];
 const spaces=contentSpaces(sessions,['writer'],ctx);
 const box=spaces.find(s=>s.scope===contentScopeKey('old'));assert.equal(box.stage,'Arquivado');assert.equal(box.archived,true);assert.equal(box.chats,1);
 assert.equal(spaces.some(s=>s.scope===contentScopeKey('gone')),false,'archived without chats stays out of the way');
 assert.equal(resolveScopeSession(sessions,emptyContentScopes(),'writer',contentScopeKey('old'),ctx).remoteSessionId,'thread-old','same thread, no forced new one');
});

test('I4: continue-target identity is the same table in the renderer and the native runtime',async()=>{
 const {sameDelegationContent}=await import('../native-agent-delegations.mjs');
 const cases=[[{},{},true],[{contentId:'a',topicId:'t'},{contentId:'a',topicId:'t'},true],[{contentId:'a'},{contentId:'a',topicId:'t'},false],[{contentId:'a',topicId:'t'},{contentId:'a'},false],
  [{contentId:'a',topicId:'t'},{contentId:'b',topicId:'t'},false],[{},{contentId:'a'},false],[{contentId:'a'},{},false],[{contentId:'a',topicId:'t1'},{contentId:'a',topicId:'t2'},false]];
 for(const [source,target,same] of cases){
  assert.equal(sameDelegationContent(source,target),same,`native ${JSON.stringify([source,target])}`);
  assert.equal(continueTargetProblem({...source,agentId:'writer'},{...target,agentId:'editor'},'editor',agents)===undefined,same,`renderer ${JSON.stringify([source,target])}`);
 }
});

test('comparison from a content chat keeps that SAME saved link on fresh, separate threads; General stays General',async()=>{
 const {createComparisonLauncher}=await import('../src/features/chat/agentComparison.ts');
 const roster=[{id:'cx',name:'Codex',role:'W',workspaceId:'space',instructions:'',skills:[],tools:[]},{id:'cl',name:'Claude',role:'W',workspaceId:'space',providerId:'claude',instructions:'',skills:[],tools:[]}];
 const launch=async link=>{const saved=[];let n=0;const start=createComparisonLauncher({agents:()=>roster,registeredProviders:()=>['codex','claude'],now:()=>at(),makeId:p=>`${p}-${++n}`,defaultCodexModelId:()=>undefined,persist:async pair=>{saved.push(...pair);},execute:()=>new Promise(()=>{})});await start({codexAgentId:'cx',claudeAgentId:'cl',briefing:'Comparar',link});return saved;};
 const source=session('chat-a','cx',{contentId:'a',topicId:'topic-a',contentTitle:'Vídeo A',remoteSessionId:'thread-a'});
 const bound=await launch(linkOf(source));
 assert.equal(bound.length,2);for(const side of bound){assert.equal(side.contentId,'a');assert.equal(side.topicId,'topic-a');assert.equal(side.contentTitle,'Vídeo A');assert.equal(side.remoteSessionId,undefined,'fresh thread, never the source thread');}
 assert.notEqual(bound[0].id,bound[1].id);
 const general=await launch(linkOf(session('g','cx')));assert.ok(general.every(side=>side.contentId===undefined));
});

test('migration: the legacy active chat comes back only inside its own scope; a scoped pointer wins; newer siblings never take over',()=>{
 const ctx={workspaceId:'space',contents:[content('a'),content('b'),content('x','X','other')],runs:[]};
 const older=session('a-old','writer',{contentId:'a',topicId:'topic-a',updatedAt:at(1)}),newer=session('a-new','writer',{contentId:'a',topicId:'topic-a',updatedAt:at(9)});
 let sessions=[older,newer,session('g-old','writer',{updatedAt:at(2)}),session('g-new','writer',{updatedAt:at(8)}),session('b1','writer',{contentId:'b',topicId:'topic-b',updatedAt:at(3)})];
 const empty=emptyContentScopes(),A=contentScopeKey('a');
 // Legacy selects the OLDER chat of A: restored exactly (not the newest), then pinned by the panel.
 const restored=resolveScopeSession(sessions,empty,'writer',A,ctx,'a-old');assert.equal(restored.id,'a-old');
 const pinned=withVisible(empty,'space','writer',A,restored.id);
 sessions=[...sessions,session('a-native','writer',{contentId:'a',topicId:'topic-a',originHandoffId:'job',updatedAt:at(59)})];
 assert.equal(resolveScopeSession(sessions,pinned,'writer',A,ctx,'a-old').id,'a-old','newer background result does not change the view');
 // A saved scoped pointer overrides the legacy one.
 assert.equal(resolveScopeSession(sessions,withActive(empty,'space','writer',A,'a-new'),'writer',A,ctx,'a-old').id,'a-new');
 // Legacy of another content, of another workspace or of a deleted content is never used here: newest of the scope instead.
 assert.equal(resolveScopeSession(sessions,empty,'writer',A,ctx,'b1').id,'a-native');
 const foreign=[...sessions,session('x1','writer',{contentId:'x',updatedAt:at(0)}),session('gone','writer',{contentId:'deleted',updatedAt:at(0)})];
 assert.equal(resolveScopeSession(foreign,empty,'writer',A,ctx,'x1').id,'a-native');
 assert.equal(resolveScopeSession(foreign,empty,'writer',A,ctx,'gone').id,'a-native');
 assert.equal(resolveScopeSession(foreign,empty,'writer','recovery',ctx,'gone').id,'gone','an invalid legacy chat is restored only in Needs attention');
 assert.equal(resolveScopeSession(foreign,empty,'editor',A,ctx,'a-old'),undefined,'never another agent’s chat');
 // General legacy restored exactly (older General chat), never a content chat.
 assert.equal(resolveScopeSession(sessions,empty,'writer','general',ctx,'g-old').id,'g-old');
 assert.equal(resolveScopeSession(sessions,empty,'writer','general',ctx,'a-old').id,'g-new');
 // While contents load, links are taken as saved: the legacy A chat is still matched to A (no Recovery misclassification).
 assert.equal(resolveScopeSession(sessions,empty,'writer',A,{...ctx,contents:[],pending:true},'a-old').id,'a-old');
});

test('migration: the first shown chat initializes the workspace selection only when absent; switching agents keeps that content',()=>{
 const ctx={workspaceId:'space',contents:[content('a'),content('b')],runs:[]};
 const sessions=[session('wa-old','writer',{contentId:'a',topicId:'topic-a',updatedAt:at(1)}),session('wa-new','writer',{contentId:'a',topicId:'topic-a',updatedAt:at(9)}),session('eb','editor',{contentId:'b',topicId:'topic-b',updatedAt:at(5)}),session('ea','editor',{contentId:'a',topicId:'topic-a',updatedAt:at(2)})];
 const legacy={writer:'wa-old',editor:'eb'},A=contentScopeKey('a'),B=contentScopeKey('b');
 // Writer panel opens first: no saved selection, legacy writer chat (older A chat) is shown and pinned → selection becomes A.
 let state=emptyContentScopes();
 const fallback=agentId=>{const legacySession=sessions.find(s=>s.id===legacy[agentId]);return legacySession?scopeOfSession(legacySession,ctx):undefined;};
 const writerScope=effectiveScope(state,ctx,fallback('writer'));assert.equal(writerScope,A);
 const shown=resolveScopeSession(sessions,state,'writer',writerScope,ctx,legacy.writer);assert.equal(shown.id,'wa-old');
 state=withVisible(state,'space','writer',writerScope,shown.id);
 assert.equal(state.selected.space,A,'selection initialized to the shown scope');
 // Switching to the editor stays in A (its A chat), never jumps to its legacy B chat.
 const editorScope=effectiveScope(state,ctx,fallback('editor'));assert.equal(editorScope,A);
 assert.equal(resolveScopeSession(sessions,state,'editor',editorScope,ctx,legacy.editor).id,'ea');
 // An existing explicit selection (B) is never changed by a pin of another scope (stale/fixed context).
 const explicit=withSelected(emptyContentScopes(),'space',B);
 assert.equal(withVisible(explicit,'space','writer',A,'wa-old').selected.space,B);
 assert.equal(withVisible(explicit,'space','writer',A,'wa-old').active[activeScopeKey('space','writer',A)],'wa-old');
 // General initializes the same way, and only for that workspace.
 const general=withVisible(emptyContentScopes(),'space','writer','general','g');assert.equal(general.selected.space,'general');assert.equal(general.selected.other,undefined);
});
