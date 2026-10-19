import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import type { Agent, AgentId } from '../agents/model/Agent';
import type { AgentSession, ChatActivityItem, ChatAttachment, ChatContextReference, ChatItem, ChatMessageItem, ChatRunState, ReasoningEffort } from './model/Chat';
import type {ChatEditRequestView} from './chatEdits';
import type { CodexEvent } from './CodexService';
import type { AiProvider } from './AiProvider';
import { sessionProviderId, sessionRemoteId } from './AiProvider';
import { saveNow, usePersistentState } from '../../data/localPersistence';
import { writeChatDraft } from './chatDrafts';
import { providerSkillPrompt } from './skillCommands';
import { attachChatImage } from './chatImages';
import {chatDeliveryInstructions} from '../../../chat-delivery-protocol.mjs';
import { useAgents } from '../agents/AgentsProvider';
import { handoffBriefing, handoffTargets, validateHandoff, type AgentHandoff, type AgentHandoffRequest } from './agentHandoff';
import { useCanvas } from '../../components/canvas/CanvasProvider';
import {storageProfile} from '../../data/IndexedDbStateStore';
import {mergeNativeDelegations,type NativeDelegationSnapshot} from './nativeDelegations';
import {finishResponseTiming,recoverResponseTiming,startRunItem} from './responseTiming';
import {createComparisonLauncher,deriveComparisons,type AgentComparison,type AgentComparisonInput} from './agentComparison';
import {activeAfterCreate,chatSessionSnapshot,childContentLink} from './contentSessions';
import {activeScopeKey,contentScopesKey,continueTargetProblem,delegationBusy,emptyContentScopes,normalizeContentScopes,organizeSessions,rawScope,withOpened,withSelected,withVisible,withoutSession,type ContentScopeState,type OrganizeContext,type OrganizeRequest,type ScopeKey} from './contentScopes';
import type {EditorialContent} from '../content/model';
import {providerSwitchPlan} from './providerChoice';
import {isMissingThreadError,isThreadNotLoadedError,recoveredSession,recoveryBriefing,recoveryNotice} from './sessionRecovery';
import {contentDeletedEvent,deleteChatLocally,type ContentDeletedDetail} from '../content/contentDeletion';

interface ChatContextValue {
  sessions: readonly AgentSession[];
  getAgentSessions: (agentId: AgentId) => AgentSession[];
  getActiveSession: (agentId: AgentId) => AgentSession | undefined;
  getRunState: (sessionId?: string) => ChatRunState;
  /** activate: true = active chat of its own scope; 'select' = also selects that scope; false = background child (never changes what is shown). */
  createSession: (agentId: AgentId, title?: string, providerId?:AgentSession['providerId'], modelId?:string,editorial?:Pick<AgentSession,'contentId'|'topicId'|'contentTitle'>,activate?:boolean|'select') => AgentSession;
  /** Opens a chat and, unless select is false, moves the workspace's content selection to that chat's scope. */
  openSession: (agentId: AgentId, sessionId: string, options?:{select?:boolean}) => void;
  /** Saved content scopes (per profile via the profile-isolated store): selection per workspace, active chat per workspace+agent+scope. */
  contentScopes: ContentScopeState;
  selectScope: (workspaceId:string, scope:ScopeKey) => void;
  /** Legacy single active chat per agent: only a fallback before the user ever chose a scope. */
  legacyActiveSessionId: (agentId:AgentId) => string|undefined;
  /** The chat currently on screen in the side panel; automatic specialist views only open for it. */
  reportFocusedSession: (sessionId?:string) => void;
  isSessionBusy: (sessionId:string) => boolean;
  /** Saves the chat the panel resolved and shows as its slot's pointer (never changes the selected scope). */
  pinVisibleSession: (workspaceId:string, agentId:AgentId, scope:ScopeKey, sessionId:string) => void;
  /**
   * Explicit organize of General chats into one content. `current` reads the authoritative editorial/production state at apply time;
   * the complete guard runs again on the live chats and the change is all-or-nothing (throws OrganizeRefused).
   */
  assignSessionsToContent: (request:OrganizeRequest, current:()=>Omit<OrganizeContext,'sessions'|'busy'>&{contents:readonly EditorialContent[]}, focusSessionId?:string) => void;
  renameSession: (sessionId: string, title: string) => void;
  /** Resolves only after the removal is committed (desktop: durable host fence); rejects with the reason otherwise. */
  deleteSession: (sessionId: string) => Promise<void>;
  /** Chats of `ids` still responding in this window (a content deletion must stop them first). */
  respondingSessions: (ids: readonly string[]) => string[];
  /** Stops the responses of `ids` and waits (bounded) until they really ended; returns the ids still responding. */
  stopSessions: (ids: readonly string[]) => Promise<string[]>;
  sendMessage: (agent: Agent, content: string, contextNodes?: ChatContextReference[], sessionId?: string, selectedSkill?: string) => void;
  runWorkflowMessage: (agent: Agent, content: string, title: string, sessionId?: string) => Promise<{sessionId:string;content:string}>;
  /**
   * An unequivocal edit request: the user message (with its attached videos) is saved, then the HOST decides on that saved
   * message and starts the local edit engine. No provider turn is sent for it (no "I can't edit" reply).
   */
  sendEditRequest: (agent: Agent, content: string, attachments: readonly ChatAttachment[], sessionId?: string, kind?: 'edit' | 'adjust', sourcePair?: ChatMessageItem['sourcePair']) => Promise<void>;
  /** Cancels the camera/screen offset measurement (or the pending manual choice) of one saved request; nothing was started. */
  cancelChatEditMeasure: (sessionId: string, messageId: string) => Promise<void>;
  /** Host state of the edit requests of the loaded chats, by user message id. */
  chatEditRequests: Readonly<Record<string, ChatEditRequestView>>;
  /** Admits (or reconciles) the request of a saved message; `choice`/`editorAgentId` answer a needs-choice/needs-editor state. */
  admitChatEdit: (sessionId: string, messageId: string, extra?: {choice?: string; editorAgentId?: string; sync?: {offsetSeconds: number}}) => Promise<void>;
  refreshChatEdits: (sessionId: string) => Promise<void>;
  getProviderStatus: (providerId: NonNullable<AgentSession['providerId']>) => Promise<import('./AiProvider').ProviderStatus>;
  cancelExecution: (sessionId?: string) => void;
  listModels:(providerId:NonNullable<AgentSession['providerId']>)=>Promise<readonly {id:string;name:string}[]>;
  setSessionModel:(sessionId:string,modelId?:string)=>void;
  /**
   * Changes the provider of a chat that never talked to a provider (no messages, thread, pair, handoff or production; not busy
   * or with specialist work queued/running). Anything else throws: the caller opens a new chat instead. Never sends.
   */
  setSessionProvider:(sessionId:string,providerId:'codex'|'claude',modelId?:string,guard?:{productionSessionIds?:ReadonlySet<string>})=>void;
  setSessionReasoningEffort:(sessionId:string,effort:ReasoningEffort)=>void;
  handoffs: readonly AgentHandoff[];
  collaborationId: string | null;
  showCollaboration: (id: string | null) => void;
  delegateToAgent: (agent: Agent, sessionId: string, request: AgentHandoffRequest, context?: ChatContextReference[]) => Promise<AgentHandoff>;
  setAgentConnection: (sessionId: string, targetAgentId: string, enabled: boolean) => void;
  newConnectedSession: (sessionId: string) => void;
  refreshSessionImages: (sessionId:string) => Promise<void>;
  comparisons: readonly AgentComparison[];
  comparisonId: string | null;
  showComparison: (id: string | null) => void;
  /** Resolves after both sessions are saved and both executions have started; replies stream into each session. */
  startComparison: (input: AgentComparisonInput) => Promise<AgentComparison>;
}

const ChatContext = createContext<ChatContextValue | null>(null);
const makeId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const makeSession = (agentId: AgentId, title?: string, providerId:AgentSession['providerId']='codex', modelId?:string): AgentSession => { const now=new Date().toISOString();return {id:makeId('session'),agentId,providerId,modelId,authMode:'unknown',title:title??(document.documentElement.lang==='pt-BR'?'Nova sessão':'New session'),messages:[],createdAt:now,updatedAt:now} };
const titleFromMessage = (message: string) => message.length > 42 ? `${message.slice(0, 42).trim()}…` : message;

export function ChatProvider({ children, providers }: PropsWithChildren<{providers:readonly AiProvider[]}>) {
  const {hasVisibleChats}=useCanvas();
  const [sessions,setSessions,sessionsReady]=usePersistentState<AgentSession[]>('sessions',[]);
  const sessionsRef=useRef(sessions); sessionsRef.current=sessions;
  const { agents } = useAgents();
  const agentsRef=useRef(agents); agentsRef.current=agents;
  const [collaborationId,showCollaboration]=useState<string|null>(null);
  const [comparisonSelection,showComparison]=useState<string|null>(null);
  const [activeSessionIds,setActiveSessionIds]=usePersistentState<Record<AgentId,string>>('active-sessions',{});
  const [savedScopes,setSavedScopes]=usePersistentState<ContentScopeState>(contentScopesKey,emptyContentScopes);
  // Always the current key contract (pre-release delimited slot keys are rewritten as JSON tuples; valid entries are kept).
  const contentScopes=useMemo(()=>normalizeContentScopes(savedScopes),[savedScopes]);
  const setContentScopes=useCallback((change:(state:ContentScopeState)=>ContentScopeState)=>setSavedScopes(current=>change(normalizeContentScopes(current))),[setSavedScopes]);
  const workspaceOf=(agentId:string)=>agentsRef.current.find(agent=>agent.id===agentId)?.workspaceId;
  const focusedSession=useRef<string|undefined>(undefined);
  const [defaultCodexModelId]=usePersistentState<string>('default-codex-model','');
  const [runStates,setRunStates]=useState<Record<string,ChatRunState>>({});
  const executions=useRef<Record<string,string>>({});
  const abortControllers=useRef<Record<string,AbortController>>({});
  const inFlightSessions=useRef(new Set<string>());
  const nativeJobs=useRef<NativeDelegationSnapshot['jobs']>([]),nativeGeneration=useRef(0),nativeShown=useRef(new Set<string>());
  const nativeBusy=(sessionId:string)=>nativeJobs.current.some(job=>job.targetSessionId===sessionId&&['queued','running'].includes(job.status));
  useEffect(()=>{if(!window.mainsAgentsDesktop?.state)return;let active=true;
    const refresh=async()=>{const generation=nativeGeneration.current;try{const response=await fetch(`/api/content/delegations?profile=${encodeURIComponent(storageProfile())}`,{cache:'no-store'});if(!response.ok)return;const snapshot=await response.json() as NativeDelegationSnapshot;if(!active||generation!==nativeGeneration.current||!Array.isArray(snapshot.sessions)||!Array.isArray(snapshot.jobs))return;
      const previousJobs=nativeJobs.current;nativeJobs.current=snapshot.jobs;
      setSessions(current=>mergeNativeDelegations(current,snapshot,agentsRef.current.map(agent=>agent.id)));
      setRunStates(current=>{const states={...current};for(const job of snapshot.jobs){if(inFlightSessions.current.has(job.targetSessionId)||previousJobs.find(item=>item.id===job.id)?.status===job.status)continue;states[job.targetSessionId]=['queued','running'].includes(job.status)?'using-tool':job.status==='completed'?'finished':job.status==='cancelled'?'idle':'error';}return JSON.stringify(current)===JSON.stringify(states)?current:states;});
      for(const job of snapshot.jobs)if(['queued','running'].includes(job.status)&&!nativeShown.current.has(job.id)){nativeShown.current.add(job.id);
        // Background work never takes over the screen: only the chat the user is looking at may open its specialist view.
        if(job.sourceSessionId===focusedSession.current&&!hasVisibleChats(job.sourceSessionId,job.targetSessionId))showCollaboration(job.id);}
    }catch{/* Native queue keeps its durable data while the UI is disconnected. */}};
    void refresh();const timer=setInterval(()=>void refresh(),800);return()=>{active=false;clearInterval(timer);};
  },[setSessions,hasVisibleChats]);
  const pendingSessions=useRef(new Map<string,AgentSession>());
  const recovered=useRef(false);
  const delegateRef=useRef<(agent:Agent,session:AgentSession,request:AgentHandoffRequest,context:ChatContextReference[],ancestors:string[],controller?:AbortController)=>Promise<AgentHandoff>>(undefined);
  useEffect(()=>{
    if(!sessionsReady||recovered.current)return;
    recovered.current=true;
    setSessions(current=>current.map(session=>recoverResponseTiming({
      ...session,
      messages:session.messages.map(item=>item.type==='activity'&&item.kind!=='run'&&item.status==='running'?{...item,status:'error' as const}:item.type==='message'&&item.deliveryState==='streaming'?{...item,deliveryState:'interrupted' as const}:item),
      handoffs:session.handoffs?.map(item=>item.status==='running'?{...item,status:'interrupted' as const,error:'The app closed before the specialist returned. Open its saved session before retrying.',updatedAt:new Date().toISOString()}:item),
    })));
  },[sessionsReady,setSessions]);

  const updateSession=useCallback((sessionId:string,change:(session:AgentSession)=>AgentSession)=>setSessions((current)=>current.map((session)=>session.id===sessionId?change(session):session)),[setSessions]);
  const createSession=useCallback((agentId:AgentId,title?:string,providerId:AgentSession['providerId']='codex',modelId?:string,editorial?:Pick<AgentSession,'contentId'|'topicId'|'contentTitle'>,activate:boolean|'select'=true)=>{const session={...makeSession(agentId,title,providerId,modelId??(providerId==='codex'?defaultCodexModelId||undefined:undefined)),...childContentLink(editorial)};pendingSessions.current.set(session.id,session);setSessions((current)=>[session,...current]);setActiveSessionIds((current)=>activeAfterCreate(current,agentId,session.id,activate!==false));
    // A background chat (specialist child, workflow, Canvas) never becomes a slot pointer: what the user sees stays put.
    const workspaceId=workspaceOf(agentId);if(workspaceId&&activate!==false)setContentScopes(current=>withOpened(current,workspaceId,session,activate==='select'));
    setRunStates((current)=>({...current,[session.id]:'idle'}));return session},[defaultCodexModelId,setActiveSessionIds,setContentScopes,setSessions]);
  const openSession=useCallback((agentId:AgentId,sessionId:string,options?:{select?:boolean})=>{
    setActiveSessionIds((current)=>({...current,[agentId]:sessionId}));
    const session=sessionsRef.current.find(item=>item.id===sessionId)??pendingSessions.current.get(sessionId),workspaceId=workspaceOf(agentId);
    if(session&&session.agentId===agentId&&workspaceId)setContentScopes(current=>withOpened(current,workspaceId,session,options?.select!==false));
  },[setActiveSessionIds,setContentScopes]);
  const selectScope=useCallback((workspaceId:string,scope:ScopeKey)=>setContentScopes(current=>withSelected(current,workspaceId,scope)),[setContentScopes]);
  const reportFocusedSession=useCallback((sessionId?:string)=>{focusedSession.current=sessionId;},[]);
  // Organize/delete guard: a responding chat or specialist work queued/running on EITHER side of a job.
  const isSessionBusy=useCallback((sessionId:string)=>inFlightSessions.current.has(sessionId)||delegationBusy(nativeJobs.current,sessionId),[]);
  const pinVisibleSession=useCallback((workspaceId:string,agentId:AgentId,scope:ScopeKey,sessionId:string)=>setContentScopes(current=>current.selected[workspaceId]&&current.active[activeScopeKey(workspaceId,agentId,scope)]===sessionId?current:withVisible(current,workspaceId,agentId,scope,sessionId)),[setContentScopes]);
  const assignSessionsToContent=useCallback((request:OrganizeRequest,current:()=>Omit<OrganizeContext,'sessions'|'busy'>&{contents:readonly EditorialContent[]},focusSessionId?:string)=>{
    // All-or-nothing on the live chats: the store applies the updater synchronously, so the guard and the change see the same state.
    let refused:unknown;
    setSessions(live=>{try{return organizeSessions(live,request,{...current(),busy:isSessionBusy});}catch(error){refused=error;return live;}});
    if(refused)throw refused;
    // The organized chat stays on screen, now inside its content.
    const focus=sessionsRef.current.find(session=>session.id===focusSessionId),workspaceId=focus&&workspaceOf(focus.agentId);
    if(focus&&workspaceId)setContentScopes(state=>withOpened(state,workspaceId,{...focus,contentId:request.contentId},true));
  },[isSessionBusy,setContentScopes,setSessions]);
  const renameSession=useCallback((sessionId:string,title:string)=>{const clean=title.trim();if(clean)updateSession(sessionId,(session)=>({...session,title:clean,updatedAt:new Date().toISOString()}))},[updateSession]);
  const deleteSession=useCallback(async(sessionId:string)=>{
    const pt=document.documentElement.lang==='pt-BR';
    if(inFlightSessions.current.has(sessionId)||delegationBusy(nativeJobs.current,sessionId))throw new Error(pt?'Esta conversa ainda está respondendo ou tem trabalho de especialista em andamento. Pare antes de excluir.':'This chat is still responding or has specialist work running. Stop it before deleting.');
    const target=sessionsRef.current.find((session)=>session.id===sessionId);if(!target)throw new Error(pt?'Esta conversa não existe mais.':'This chat no longer exists.');
    // The legacy pointer falls back inside the SAME scope (content or General), never to another content's chat.
    const next=sessionsRef.current.filter((session)=>session.agentId===target.agentId&&session.id!==sessionId&&rawScope(session)===rawScope(target)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
    // Desktop: the host removes it in one transaction (with pointers and drafts) and fences it against late writers; it
    // refuses a chat that conducts a production (the whole content must be deleted instead).
    if(window.mainsAgentsDesktop?.state&&window.mainsAgentsDesktop.content)await deleteChatLocally(sessionId);
    else if(window.mainsAgentsDesktop?.state){const response=await fetch(`/api/content/delegations/sessions/${encodeURIComponent(sessionId)}?profile=${encodeURIComponent(storageProfile())}`,{method:'DELETE'});if(!response.ok)throw new Error((await response.json().catch(()=>({}))).error??'Could not delete this chat.');}
    abortControllers.current[sessionId]?.abort();delete abortControllers.current[sessionId];delete executions.current[sessionId];pendingSessions.current.delete(sessionId);
    writeChatDraft(target.agentId,sessionId,{text:'',skill:null});
    nativeGeneration.current++;
    setSessions((current)=>current.filter((session)=>session.id!==sessionId).map(session=>session.agentConnection?.targetSessionId===sessionId?{...session,agentConnection:{...session.agentConnection,targetSessionId:undefined}}:session));
    setActiveSessionIds((current)=>{if(current[target.agentId]!==sessionId)return current;const result={...current};if(next)result[target.agentId]=next.id;else delete result[target.agentId];return result;});
    setContentScopes(current=>withoutSession(current,sessionId));
  },[setActiveSessionIds,setContentScopes,setSessions]);
  const respondingSessions=useCallback((ids:readonly string[])=>ids.filter(id=>inFlightSessions.current.has(id)),[]);
  const stopSessions=useCallback(async(ids:readonly string[])=>{
    for(const id of ids)if(inFlightSessions.current.has(id))cancelRef.current(id);
    const deadline=Date.now()+10_000;
    while(ids.some(id=>inFlightSessions.current.has(id))&&Date.now()<deadline)await new Promise(resolve=>window.setTimeout(resolve,100));
    return ids.filter(id=>inFlightSessions.current.has(id));
  },[]);
  // A local content deletion: nothing still in memory for its chats may be written back (stale native/production snapshots).
  useEffect(()=>{const handle=(event:Event)=>{const {sessionIds}=(event as CustomEvent<ContentDeletedDetail>).detail;nativeGeneration.current++;
    for(const id of sessionIds){abortControllers.current[id]?.abort();delete abortControllers.current[id];delete executions.current[id];pendingSessions.current.delete(id);}
    setRunStates(current=>{const next={...current};for(const id of sessionIds)delete next[id];return next;});};
    window.addEventListener(contentDeletedEvent,handle);return()=>window.removeEventListener(contentDeletedEvent,handle);},[]);
  const listModels=useCallback(async(providerId:NonNullable<AgentSession['providerId']>)=>{const provider=providers.find((item)=>item.id===providerId);if(!provider)throw new Error(`Provider ${providerId} is unavailable`);return provider.listModels()},[providers]);
  const getProviderStatus=useCallback(async(providerId:NonNullable<AgentSession['providerId']>)=>{const provider=providers.find((item)=>item.id===providerId);if(!provider)throw new Error(`Provider ${providerId} is unavailable`);return provider.getStatus()},[providers]);
  const setSessionModel=useCallback((sessionId:string,modelId?:string)=>updateSession(sessionId,(session)=>({...session,modelId:modelId||undefined,updatedAt:new Date().toISOString()})),[updateSession]);
  const setSessionProvider=useCallback((sessionId:string,providerId:'codex'|'claude',modelId?:string,guard?:{productionSessionIds?:ReadonlySet<string>})=>{
    // Checked against the live chat (not the rendered one) so a reply or native job that just started is never rebound.
    const live=sessionsRef.current.find(item=>item.id===sessionId)??pendingSessions.current.get(sessionId);
    if(!live)throw new Error('Chat unavailable.');
    const plan=providerSwitchPlan(live,{busy:inFlightSessions.current.has(sessionId)||delegationBusy(nativeJobs.current,sessionId),productionSessionIds:guard?.productionSessionIds});
    if(plan.kind!=='in-place')throw new Error(plan.reason==='busy'?'Wait for the current response.':'This chat is already bound to its provider; open a new chat.');
    const change=(session:AgentSession):AgentSession=>({...session,providerId,modelId:modelId||(providerId==='codex'?defaultCodexModelId||undefined:undefined),updatedAt:new Date().toISOString()});
    const pending=pendingSessions.current.get(sessionId);if(pending)pendingSessions.current.set(sessionId,change(pending));
    updateSession(sessionId,change);
  },[defaultCodexModelId,updateSession]);
  const setSessionReasoningEffort=useCallback((sessionId:string,reasoningEffort:ReasoningEffort)=>updateSession(sessionId,(session)=>({...session,reasoningEffort,updatedAt:new Date().toISOString()})),[updateSession]);
  const setAgentConnection=useCallback((sessionId:string,targetAgentId:string,enabled:boolean)=>{
    if(inFlightSessions.current.has(sessionId))throw new Error('Wait for the current response.');
    const session=sessionsRef.current.find(item=>item.id===sessionId)??pendingSessions.current.get(sessionId);
    const source=agentsRef.current.find(item=>item.id===session?.agentId),target=agentsRef.current.find(item=>item.id===targetAgentId);
    if(!session||!source||enabled&&(!target||source.id===target.id||source.workspaceId!==target.workspaceId))throw new Error('Choose another agent in this workspace.');
    // A saved continue target survives only while it is the same agent's chat of this workspace and content.
    const keep=(current:AgentSession)=>{const id=current.agentConnection?.targetAgentId===targetAgentId?current.agentConnection.targetSessionId:undefined;const target=id?sessionsRef.current.find(item=>item.id===id)??pendingSessions.current.get(id):undefined;return id&&!continueTargetProblem(current,target,targetAgentId,agentsRef.current)?id:undefined;};
    updateSession(sessionId,current=>({...current,agentConnection:{enabled,targetAgentId,targetSessionId:keep(current)},updatedAt:new Date().toISOString()}));
  },[updateSession]);
  const newConnectedSession=useCallback((sessionId:string)=>{
    const session=sessionsRef.current.find(item=>item.id===sessionId),connection=session?.agentConnection;
    const source=agentsRef.current.find(item=>item.id===session?.agentId),target=agentsRef.current.find(item=>item.id===connection?.targetAgentId);
    if(!session||!connection?.enabled||!source||!target||source.workspaceId!==target.workspaceId)throw new Error('Choose a connected agent.');
    if(inFlightSessions.current.has(sessionId)||connection.targetSessionId&&inFlightSessions.current.has(connection.targetSessionId))throw new Error('Wait for both agents to finish.');
    const child=createSession(target.id,undefined,target.providerId??'codex',target.modelId,childContentLink(session));
    updateSession(sessionId,current=>({...current,agentConnection:{...connection,targetSessionId:child.id},updatedAt:new Date().toISOString()}));
  },[createSession,updateSession]);

  const applyEvent=useCallback((sessionId:string,event:CodexEvent)=>{
    if(event.type==='image.completed'){updateSession(sessionId,session=>attachChatImage(session,event.executionId,event.image));return}
    if(event.type==='image.failed'){
      updateSession(sessionId,session=>{const id=`image-error-${event.executionId}-${event.callId}`;if(session.messages.some(item=>item.id===id))return session;return {...session,messages:[...session.messages,{id,type:'activity',label:event.message,status:'error'}]}});return;
    }
    if(event.type==='execution.started'){setRunStates((current)=>({...current,[sessionId]:'thinking'}));return}
    if(event.type==='message.delta'||event.type==='message.completed'){
      const messageId=`codex-${event.executionId}`;
      updateSession(sessionId,(session)=>{const exists=session.messages.some((item)=>item.id===messageId);const content=event.type==='message.delta'?event.delta:event.content;return {...session,updatedAt:new Date().toISOString(),messages:exists?session.messages.map((item)=>item.id===messageId&&item.type==='message'?{...item,content:event.type==='message.delta'?item.content+content:content,deliveryState:'streaming'}:item):[...session.messages,{id:messageId,type:'message',role:'agent',content,deliveryState:'streaming',createdAt:new Date().toISOString()}]}});
      return;
    }
    if(event.type==='activity'||event.type==='search'||event.type==='tool.started'||event.type==='tool.finished'){
      const isFinished=event.type==='tool.finished'||('status' in event&&event.status==='finished');
      const label=event.type==='tool.started'?(event.label??`Using ${event.tool}...`):event.type==='tool.finished'?`Used ${event.tool}`:event.label;
      const activityId=`codex-activity-${event.executionId}-${'callId' in event?event.callId:label}`;
      setRunStates((current)=>({...current,[sessionId]:event.type==='search'?'searching':event.type==='activity'?'thinking':'using-tool'}));
      updateSession(sessionId,(session)=>{const exists=session.messages.some((item)=>item.id===activityId);const activity:ChatActivityItem={id:activityId,type:'activity',label,status:isFinished?'done':'running'};return {...session,updatedAt:new Date().toISOString(),messages:exists?session.messages.map((item):ChatItem=>item.id===activityId?activity:item):[...session.messages,activity]}});
      return;
    }
    if(event.type==='execution.completed'){setRunStates((current)=>({...current,[sessionId]:'finished'}));updateSession(sessionId,(session)=>({...session,updatedAt:new Date().toISOString(),messages:session.messages.map((item):ChatItem=>item.type==='activity'&&item.kind!=='run'&&item.status==='running'?{...item,status:'done'}:item.type==='message'&&item.id===`codex-${event.executionId}`?{...item,deliveryState:'completed'}:item)}));return}
    if(event.type==='execution.cancelled'){updateSession(sessionId,session=>({...session,messages:session.messages.map((item):ChatItem=>item.type==='activity'&&item.status==='running'&&item.id.startsWith(`codex-activity-${event.executionId}-`)?{...item,status:'error',label:`${item.label} · interrupted`}:item.type==='message'&&item.id===`codex-${event.executionId}`?{...item,deliveryState:'interrupted'}:item)}));setRunStates((current)=>({...current,[sessionId]:'idle'}));return}
    if(event.type==='execution.failed'){setRunStates((current)=>({...current,[sessionId]:'error'}));updateSession(sessionId,(session)=>({...session,updatedAt:new Date().toISOString(),messages:[...session.messages.map((item):ChatItem=>item.type==='activity'&&item.status==='running'&&item.id.startsWith(`codex-activity-${event.executionId}-`)?{...item,status:'error'}:item.type==='message'&&item.id===`codex-${event.executionId}`?{...item,deliveryState:'interrupted'}:item),{id:makeId('activity'),type:'activity',label:event.message,status:'error'}]}))}
  },[updateSession]);

  const refreshSessionImages=useCallback(async(sessionId:string)=>{
    const session=sessionsRef.current.find(item=>item.id===sessionId),remoteId=session&&sessionRemoteId(session);
    if(!session||!remoteId)return;
    const provider=providers.find(item=>item.id===sessionProviderId(session));
    if(!provider?.listSessionImages)return;
    const events=await provider.listSessionImages(remoteId);
    for(const event of events)if(event.type==='image.completed'||event.type==='image.failed')applyEvent(sessionId,event);
  },[providers,applyEvent]);

  const executeMessage=useCallback(async(agent:Agent,content:string,contextNodes:ChatContextReference[],session:AgentSession,selectedSkill?:string,ancestors:string[]=[],handoffId?:string):Promise<{sessionId:string;content:string}>=>{
    const clean=content.trim();if(!clean)throw new Error('Enter a message.');
    const sessionId=session.id;
    if(inFlightSessions.current.has(sessionId)||nativeBusy(sessionId))throw new Error('This session is already responding.');
    inFlightSessions.current.add(sessionId);
    const responseTiming={id:makeId('response'),startedAt:new Date().toISOString()};
    let timingOutcome:'completed'|'interrupted'|'error'='error';
    setRunStates((current)=>({...current,[sessionId]:'thinking'}));
    const userMessageId=makeId('message');
    updateSession(sessionId,(current)=>({...current,responseTiming,title:['New session','Nova sessão'].includes(current.title)?titleFromMessage(clean):current.title,updatedAt:new Date().toISOString(),messages:[...current.messages,{id:userMessageId,type:'message',role:'user',content:clean,createdAt:new Date().toISOString(),contextNodes:contextNodes.length?[...contextNodes]:undefined,selectedSkill,sourceAgentName:ancestors.length?agentsRef.current.find(item=>item.id===ancestors[ancestors.length-1])?.name:undefined,handoffId:handoffId??session.originHandoffId},startRunItem(responseTiming.id,responseTiming.startedAt)]}));
    const controller=new AbortController();abortControllers.current[sessionId]=controller;
    let failureReported=false;
      try{
        const provider=providers.find((item)=>item.id===sessionProviderId(session));
        if(!provider)throw new Error(`Provider ${sessionProviderId(session)} is not available. The history is still saved locally.`);
        let providerContent=providerSkillPrompt(agent,clean,selectedSkill);
        if(!selectedSkill)providerContent+=`\n\nMainsAgents optional editorial delivery format:\n${chatDeliveryInstructions}`;
        // Read when sending (not at click time): an approval made just before must reach the prompt.
        const connection=session.agentConnection?.enabled?session.agentConnection:undefined;
        const available=handoffTargets(agent,agentsRef.current,ancestors);
        // Comparison sessions never fan out unless the user later enables a connection explicitly.
        const targets=session.agentConnection?(connection?available.filter(target=>target.id===connection.targetAgentId):[]):session.comparison?[]:available;
        if(connection&&!targets.length)throw new Error('The connected agent is unavailable. Select another agent or turn off the connection.');
        const oldRemoteId=sessionRemoteId(session);
        const migrate=provider.id==='codex'&&oldRemoteId&&session.delegationRuntimeVersion!==2&&targets.length>0;
        const remoteId=migrate?undefined:oldRemoteId;
        if(migrate)providerContent=`Saved conversation before enabling specialist calls:\n${session.messages.filter(item=>item.type==='message').map(item=>`${item.role}: ${item.content}`).join('\n\n')}\n\nCurrent request:\n${providerContent}`;
        await saveNow();
        const openThread=()=>provider.createSession({localSessionId:sessionId,agentId:agent.id,agentName:agent.name,workspaceId:agent.workspaceId,instructions:agent.instructions,modelId:session.modelId,tools:agent.tools,skillsDirectory:agent.skillsDirectory,skills:agent.skills,paperDesign:agent.paperDesign});
        let thread:Awaited<ReturnType<typeof openThread>>,recoveredFrom:string|undefined;
        if(!remoteId)thread=await openThread();
        else try{thread=await provider.resumeSession(remoteId);}catch(error){
          // Only a missing/expired provider thread is replaced (never by age); the saved chat goes along once as reference text.
          if(!isMissingThreadError(error)||controller.signal.aborted)throw error;
          thread=await openThread();recoveredFrom=remoteId;
          const live=sessionsRef.current.find(item=>item.id===sessionId)??session;
          providerContent=recoveryBriefing(live.messages,userMessageId)+providerContent;
        }
        if(recoveredFrom){const at=new Date().toISOString();updateSession(sessionId,current=>({...recoveredSession(current,provider.id,thread.remoteSessionId,recoveredFrom!,at),messages:[...current.messages,recoveryNotice(makeId('thread-recovery'),document.documentElement.lang==='pt-BR')]}));}
        else if(!remoteId)updateSession(sessionId,(current)=>({...current,providerId:provider.id,remoteSessionId:thread.remoteSessionId,codexThreadId:provider.id==='codex'?thread.remoteSessionId:current.codexThreadId,delegationRuntimeVersion:provider.id==='codex'?2:undefined,previousCodexThreadId:migrate?oldRemoteId:current.previousCodexThreadId,updatedAt:new Date().toISOString()}));
        await saveNow();
        if(controller.signal.aborted)throw new Error('Execution cancelled.');
        const live=sessionsRef.current.find(item=>item.id===sessionId)??session;
        const turn={remoteSessionId:thread.remoteSessionId,content:providerContent+chatSessionSnapshot(live),modelId:session.modelId,reasoningEffort:session.reasoningEffort??'medium',instructions:agent.instructions,agentId:agent.id,agentName:agent.name,role:agent.role,workspaceId:agent.workspaceId,tools:agent.tools,skillsDirectory:agent.skillsDirectory,skills:agent.skills,paperDesign:agent.paperDesign,firstMessage:!remoteId||!!recoveredFrom,history:(sessionsRef.current.some(item=>item.id===sessionId)?live.messages:session.messages).filter((item):item is ChatMessageItem=>item.type==='message'&&item.id!==userMessageId).map((item)=>({role:item.role,content:item.content})),context:contextNodes.map((node)=>({id:node.nodeId,kind:node.kind,label:node.label,content:node.content})),delegation:{sourceAgentId:agent.id,workspaceId:agent.workspaceId,targets:targets.map(item=>({id:item.id,name:item.name,role:item.role})),connectedAgentId:connection?.targetAgentId}};
        let execution;
        try{execution=await provider.sendMessage(turn);}catch(error){
          // Refused before any turn started (thread unloaded after a restart): resume the SAME thread and send once more.
          if(!isThreadNotLoadedError(error)||controller.signal.aborted)throw error;
          await provider.resumeSession(thread.remoteSessionId);
          execution=await provider.sendMessage(turn);
        }
        executions.current[sessionId]=execution.executionId;
        if(controller.signal.aborted){await provider.cancelExecution(execution.executionId);throw new Error('Execution cancelled.');}
        let output='', completed=false, delegationCount=0, imageCount=0;
        for await(const event of provider.streamEvents({executionId:execution.executionId,signal:controller.signal})){
          if(event.type==='agent.delegation-queued'){setRunStates(current=>({...current,[sessionId]:'using-tool'}));continue;}
          if(event.type==='agent.delegate'){
            if(!provider.resolveDelegation)throw new Error('The provider does not support agent calls.');
            try{
              if(++delegationCount>4)throw new Error('At most 4 specialist calls are allowed per response.');
              if(!delegateRef.current)throw new Error('Agent delegation is unavailable.');
              const handoff=await delegateRef.current(agent,session,event.request,contextNodes,ancestors,controller);
              await provider.resolveDelegation(execution.executionId,event.callId,{success:handoff.status==='completed',content:handoff.result??handoff.error??'The specialist did not finish.'});
            }catch(error){if(controller.signal.aborted)throw error;await provider.resolveDelegation(execution.executionId,event.callId,{success:false,content:error instanceof Error?error.message:String(error)});}
            continue;
          }
          applyEvent(sessionId,event);
          if(event.type==='image.completed')imageCount++;
          if(event.type==='execution.completed')completed=true;
          if(event.type==='message.delta')output+=event.delta;
          if(event.type==='message.completed')output=event.content;
          if(event.type==='execution.failed'){failureReported=true;throw new Error(event.message)}
          if(event.type==='execution.cancelled'){timingOutcome='interrupted';throw new Error('Execution cancelled.');}
        }
        if(!completed)throw new Error('The response stream ended before completion.');
        if(!output.trim()&&!imageCount)throw new Error('The provider returned no response.');
        timingOutcome='completed';
        return {sessionId,content:output||`${imageCount} image(s) generated.`};
      }catch(error){if(!failureReported&&!controller.signal.aborted)applyEvent(sessionId,{type:'execution.failed',executionId:executions.current[sessionId]??'unknown',code:'connection_error',message:error instanceof Error?error.message:'Could not connect to the provider',retryable:true});throw error}
      finally{updateSession(sessionId,current=>finishResponseTiming(current,responseTiming.id,controller.signal.aborted?'interrupted':timingOutcome,new Date().toISOString(),executions.current[sessionId]));if(controller.signal.aborted)setRunStates(current=>({...current,[sessionId]:'idle'}));delete abortControllers.current[sessionId];delete executions.current[sessionId];inFlightSessions.current.delete(sessionId);pendingSessions.current.delete(sessionId)}
  },[applyEvent,providers,updateSession]);

  const performHandoff=useCallback(async(source:Agent,sourceSession:AgentSession,input:AgentHandoffRequest,context:ChatContextReference[],ancestors:string[]=[],parent?:AbortController):Promise<AgentHandoff>=>{
    if(parent?.signal.aborted)throw new Error('Execution cancelled.');
    const liveSource=agentsRef.current.find(agent=>agent.id===source.id);
    if(!liveSource||sourceSession.agentId!==source.id)throw new Error('The requesting agent or session is no longer available.');
    const {target,request}=validateHandoff(input,liveSource,agentsRef.current,ancestors);
    const liveSession=sessionsRef.current.find(item=>item.id===sourceSession.id)??sourceSession;
    const connection=liveSession.agentConnection;
    if(connection?.enabled&&connection.targetAgentId!==target.id)throw new Error('Use the selected connected agent.');
    const linked=connection?.enabled&&connection.targetAgentId===target.id;
    const candidate=linked&&request.sessionMode!=='new'&&connection.targetSessionId?sessionsRef.current.find(item=>item.id===connection.targetSessionId)??pendingSessions.current.get(connection.targetSessionId):undefined;
    // Same rule as the native runtime: continue only in the connected agent's chat of the same workspace AND content (General↔General).
    const existing=candidate&&!continueTargetProblem(liveSession,candidate,target.id,agentsRef.current)?candidate:undefined;
    if(existing&&inFlightSessions.current.has(existing.id))throw new Error('The connected agent is already responding. Wait before sending another task.');
    // A specialist child keeps the target agent's visible session and belongs to the requesting content.
    const child=existing??createSession(target.id,request.title,target.providerId??'codex',target.modelId,childContentLink(liveSession),false);
    if(linked)updateSession(sourceSession.id,current=>({...current,agentConnection:{enabled:true,targetAgentId:target.id,targetSessionId:child.id},updatedAt:new Date().toISOString()}));
    const now=new Date().toISOString();
    const handoff:AgentHandoff={...request,id:makeId('handoff'),sourceAgentId:source.id,sourceSessionId:sourceSession.id,targetSessionId:child.id,workspaceId:source.workspaceId,context:[...context],status:'running',createdAt:now,updatedAt:now};
    updateSession(child.id,current=>({...current,originHandoffId:current.originHandoffId??handoff.id}));
    updateSession(sourceSession.id,current=>({...current,handoffs:[...(current.handoffs??[]),handoff],updatedAt:now}));
    if(handoff.sourceSessionId===focusedSession.current&&!hasVisibleChats(handoff.sourceSessionId,handoff.targetSessionId))showCollaboration(handoff.id);
    const stop=()=>{const executionId=executions.current[child.id];if(executionId)void providers.find(provider=>provider.id===sessionProviderId(child))?.cancelExecution(executionId).catch(()=>{});abortControllers.current[child.id]?.abort();};
    parent?.signal.addEventListener('abort',stop,{once:true});
    let timedOut=false;
    const timeout=window.setTimeout(()=>{timedOut=true;stop();},29*60*1000);
    try{
      const result=await executeMessage(target,handoffBriefing(source,request),[...context,...request.files.map((file,index)=>({nodeId:`${handoff.id}-file-${index}`,kind:'file',label:file.split(/[\\/]/).pop()??file,content:file}))],child,undefined,[...ancestors,source.id],handoff.id);
      handoff.status='completed';handoff.result=result.content;
    }catch(error){handoff.status=timedOut?'error':parent?.signal.aborted||/cancel|abort/i.test(error instanceof Error?error.message:String(error))?'cancelled':'error';handoff.error=timedOut?'The specialist exceeded the 29-minute limit. Its partial response is saved.':error instanceof Error?error.message:String(error);}
    finally{window.clearTimeout(timeout);parent?.signal.removeEventListener('abort',stop);handoff.updatedAt=new Date().toISOString();updateSession(sourceSession.id,current=>({...current,handoffs:current.handoffs?.map(item=>item.id===handoff.id?{...handoff}:item),updatedAt:handoff.updatedAt}));}
    return handoff;
  },[createSession,executeMessage,providers,updateSession]);
  delegateRef.current=performHandoff;
  const delegateToAgent=useCallback(async(agent:Agent,sessionId:string,request:AgentHandoffRequest,context:ChatContextReference[]=[])=>{
    const session=sessions.find(item=>item.id===sessionId)??pendingSessions.current.get(sessionId);
    if(!session||inFlightSessions.current.has(sessionId))throw new Error('Wait for the current response before sending this briefing.');
    if(window.mainsAgentsDesktop?.state){
      validateHandoff(request,agent,agentsRef.current);
      const fingerprint=JSON.stringify({request,context}),saved=session.pendingManualHandoff;
      const requestId=saved?.fingerprint===fingerprint?saved.id:crypto.randomUUID();
      updateSession(session.id,current=>({...current,pendingManualHandoff:{id:requestId,fingerprint}}));await saveNow();
      const response=await fetch('/api/content/delegations?profile='+encodeURIComponent(storageProfile()),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId,sourceAgentId:agent.id,sourceSessionId:session.id,request,context})});
      const job=await response.json();if(!response.ok)throw new Error(job.error??'Could not queue specialist work.');
      updateSession(session.id,current=>({...current,pendingManualHandoff:undefined}));showCollaboration(job.id);return {...job,status:job.status==='queued'?'running':job.status} as AgentHandoff;
    }
    const result=await performHandoff(agent,session,request,context);
    if(result.status==='completed')updateSession(sessionId,current=>({...current,messages:[...current.messages,{id:makeId('message'),type:'message',role:'agent',sourceAgentName:agentsRef.current.find(item=>item.id===request.targetAgentId)?.name,content:result.result??'',handoffId:result.id,createdAt:result.updatedAt}]}));
    return result;
  },[sessions,performHandoff,updateSession]);

  const sendMessage=useCallback((agent:Agent,content:string,contextNodes:ChatContextReference[]=[],targetSessionId?:string,selectedSkill?:string)=>{
    if(!content.trim())return;
    let session=targetSessionId?(sessions.find((item)=>item.id===targetSessionId)??pendingSessions.current.get(targetSessionId)):sessions.find((item)=>item.id===activeSessionIds[agent.id]);
    if(targetSessionId&&!session)return;
    if(!session)session=createSession(agent.id,undefined,agent.providerId??'codex',agent.modelId);
    void executeMessage(agent,content,contextNodes,session,selectedSkill).catch(()=>{});
  },[activeSessionIds,createSession,executeMessage,sessions]);

  const [chatEditRequests,setChatEditRequests]=useState<Record<string,ChatEditRequestView>>({});
  const admitChatEdit=useCallback(async(sessionId:string,messageId:string,extra:{choice?:string;editorAgentId?:string;sync?:{offsetSeconds:number}}={})=>{
    setChatEditRequests(current=>({...current,[messageId]:{...(current[messageId]??{sessionId,messageId}),status:'pending',error:undefined}}));
    try{
      await saveNow();
      const response=await fetch(`/api/content/chat-edits?profile=${encodeURIComponent(storageProfile())}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),sessionId,messageId,...extra})});
      const body=await response.json().catch(()=>({})) as {request?:ChatEditRequestView;error?:string;options?:ChatEditRequestView['options']};
      if(!response.ok||!body.request){setChatEditRequests(current=>({...current,[messageId]:{...(current[messageId]??{sessionId,messageId}),sessionId,messageId,status:body.options?'needs-window':'failed',error:body.error??'O app não confirmou o pedido de edição.',...(body.options?{options:body.options}:{})}}));return;}
      const view=body.request;setChatEditRequests(current=>({...current,[messageId]:view}));
    }catch(error){setChatEditRequests(current=>({...current,[messageId]:{...(current[messageId]??{sessionId,messageId}),status:'failed',error:error instanceof Error?error.message:String(error)}}));}
  },[]);
  const refreshChatEdits=useCallback(async(sessionId:string)=>{
    try{const response=await fetch(`/api/content/chat-edits?profile=${encodeURIComponent(storageProfile())}&session=${encodeURIComponent(sessionId)}`,{cache:'no-store'});if(!response.ok)return;
     const body=await response.json() as {requests?:ChatEditRequestView[]};if(!Array.isArray(body.requests))return;
     setChatEditRequests(current=>{const next={...current};let changed=false;for(const item of body.requests!){const old=current[item.messageId];if(old?.status==='pending')continue;if(JSON.stringify(old)!==JSON.stringify(item)){next[item.messageId]=item;changed=true;}}return changed?next:current;});
    }catch{/* The saved request stays as last known; the next refresh retries. */}
  },[]);
  const cancelChatEditMeasure=useCallback(async(sessionId:string,messageId:string)=>{
    const response=await fetch(`/api/content/chat-edits/cancel?profile=${encodeURIComponent(storageProfile())}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId,messageId})});
    const body=await response.json().catch(()=>({})) as {request?:ChatEditRequestView;error?:string};
    if(!response.ok)throw new Error(body.error??'O app não confirmou o cancelamento.');if(body.request)setChatEditRequests(current=>({...current,[messageId]:body.request!}));
  },[]);
  const sendEditRequest=useCallback(async(agent:Agent,content:string,attachments:readonly ChatAttachment[],targetSessionId?:string,kind:'edit'|'adjust'='edit',sourcePair?:ChatMessageItem['sourcePair'])=>{
    const clean=content.trim();if(!clean)return;
    let session=targetSessionId?(sessionsRef.current.find((item)=>item.id===targetSessionId)??pendingSessions.current.get(targetSessionId)):sessionsRef.current.find((item)=>item.id===activeSessionIds[agent.id]);
    if(targetSessionId&&!session)throw new Error('Conversa não encontrada.');
    if(!session)session=createSession(agent.id,undefined,agent.providerId??'codex',agent.modelId);
    const id=makeId('message'),at=new Date().toISOString(),sessionId=session.id;
    updateSession(sessionId,current=>({...current,title:['New session','Nova sessão'].includes(current.title)?titleFromMessage(clean):current.title,updatedAt:at,messages:[...current.messages,{id,type:'message',role:'user',content:clean,createdAt:at,...(attachments.length?{attachments:[...attachments]}:{}),...(sourcePair?{sourcePair}:{}),chatEdit:{kind}}]}));
    await admitChatEdit(sessionId,id);
  },[activeSessionIds,admitChatEdit,createSession,updateSession]);

  const runWorkflowMessage=useCallback((agent:Agent,content:string,title:string,targetSessionId?:string)=>{
    const session=targetSessionId?(sessions.find((item)=>item.id===targetSessionId)??pendingSessions.current.get(targetSessionId)):createSession(agent.id,title,agent.providerId??'codex',agent.modelId,undefined,false);
    if(!session)throw new Error('The linked agent session could not be found.');
    return executeMessage(agent,content,[],session);
  },[createSession,executeMessage,sessions]);

  const executeRef=useRef(executeMessage);executeRef.current=executeMessage;
  const providersRef=useRef(providers);providersRef.current=providers;
  const defaultModelRef=useRef(defaultCodexModelId);defaultModelRef.current=defaultCodexModelId;
  const launcher=useRef<ReturnType<typeof createComparisonLauncher>>(undefined);
  launcher.current??=createComparisonLauncher({
    agents:()=>agentsRef.current,registeredProviders:()=>providersRef.current.map(provider=>provider.id),now:()=>new Date().toISOString(),makeId,defaultCodexModelId:()=>defaultModelRef.current||undefined,
    persist:async pair=>{
      for(const session of pair)pendingSessions.current.set(session.id,session);
      const ids=new Set(pair.map(session=>session.id));
      setSessions(current=>[...pair,...current.filter(session=>!ids.has(session.id))]);
      // Same-agent comparisons share one agent id: keep the Codex side (first) as that agent's active session.
      setActiveSessionIds(current=>({...current,...Object.fromEntries([...pair].reverse().map(session=>[session.agentId,session.id]))}));
      // Explicit user action: each side becomes its agent's shown chat in ITS scope (the source chat's content); the selection never changes.
      setContentScopes(current=>[...pair].reverse().reduce((state,session)=>{const workspaceId=workspaceOf(session.agentId);return workspaceId?withOpened(state,workspaceId,session,false):state;},current));
      setRunStates(current=>({...current,...Object.fromEntries(pair.map(session=>[session.id,'idle' as const]))}));
      await saveNow();
    },
    execute:(agent,content,context,session)=>executeRef.current(agent,content,context,session),
  });
  const startComparison=useCallback((input:AgentComparisonInput)=>launcher.current!(input).then(comparison=>{showComparison(comparison.id);return comparison;}),[]);
  const comparisons=useMemo(()=>deriveComparisons(sessions,agents),[sessions,agents]);
  const comparisonId=comparisonSelection&&comparisons.some(item=>item.id===comparisonSelection)?comparisonSelection:null;

  const cancelRef=useRef<(sessionId?:string)=>void>(()=>{});
  const cancelExecution=useCallback((sessionId?:string)=>{if(!sessionId)return;for(const job of nativeJobs.current)if(job.targetSessionId===sessionId&&['queued','running'].includes(job.status))void fetch(`/api/content/delegations/${encodeURIComponent(job.id)}/cancel?profile=${encodeURIComponent(storageProfile())}`,{method:'POST'}).catch(()=>{});const executionId=executions.current[sessionId];const session=sessions.find((item)=>item.id===sessionId)??pendingSessions.current.get(sessionId);const provider=providers.find((item)=>item.id===sessionProviderId(session??{}));if(executionId&&provider)void provider.cancelExecution(executionId).catch((error)=>applyEvent(sessionId,{type:'execution.failed',executionId,code:'cancel_error',message:error instanceof Error?error.message:'Could not cancel execution',retryable:true}));abortControllers.current[sessionId]?.abort();},[applyEvent,providers,sessions]);
  cancelRef.current=cancelExecution;

  const value=useMemo<ChatContextValue>(()=>({sessions,handoffs:sessions.flatMap(session=>session.handoffs??[]),collaborationId,showCollaboration,comparisons,comparisonId,showComparison,startComparison,delegateToAgent,setAgentConnection,newConnectedSession,refreshSessionImages,sendEditRequest,chatEditRequests,admitChatEdit,cancelChatEditMeasure,refreshChatEdits,getAgentSessions:(agentId)=>sessions.filter((session)=>session.agentId===agentId).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),getActiveSession:(agentId)=>{const workspaceId=agents.find(agent=>agent.id===agentId)?.workspaceId,scope=workspaceId?contentScopes.selected[workspaceId]:undefined;
      if(!workspaceId||!scope)return sessions.find((session)=>session.id===activeSessionIds[agentId]);
      const own=sessions.filter(session=>session.agentId===agentId&&rawScope(session)===scope).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
      // Scoped pointer, then the legacy active chat only when it is in this same scope, then the newest of the scope.
      return own.find(session=>session.id===contentScopes.active[activeScopeKey(workspaceId,agentId,scope)])??own.find(session=>session.id===activeSessionIds[agentId])??own[0];},
    contentScopes,selectScope,legacyActiveSessionId:(agentId)=>activeSessionIds[agentId],reportFocusedSession,isSessionBusy,pinVisibleSession,assignSessionsToContent,getRunState:(sessionId)=>sessionId?runStates[sessionId]??'idle':'idle',createSession,openSession,renameSession,deleteSession,respondingSessions,stopSessions,sendMessage,runWorkflowMessage,getProviderStatus,cancelExecution,listModels,setSessionModel,setSessionProvider,setSessionReasoningEffort}),[agents,contentScopes,selectScope,reportFocusedSession,isSessionBusy,pinVisibleSession,assignSessionsToContent,comparisons,comparisonId,startComparison,collaborationId,delegateToAgent,setAgentConnection,newConnectedSession,refreshSessionImages,activeSessionIds,cancelExecution,createSession,deleteSession,respondingSessions,stopSessions,getProviderStatus,listModels,openSession,renameSession,runStates,runWorkflowMessage,sendMessage,sendEditRequest,chatEditRequests,admitChatEdit,cancelChatEditMeasure,refreshChatEdits,sessions,setSessionModel,setSessionProvider,setSessionReasoningEffort]);
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat():ChatContextValue {const context=useContext(ChatContext);if(!context)throw new Error('useChat must be used inside ChatProvider');return context}
