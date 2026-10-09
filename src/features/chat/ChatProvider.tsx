import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import type { Agent, AgentId } from '../agents/model/Agent';
import type { AgentSession, ChatActivityItem, ChatContextReference, ChatItem, ChatMessageItem, ChatRunState, ReasoningEffort } from './model/Chat';
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
import {activeAfterCreate,childContentLink} from './contentSessions';

interface ChatContextValue {
  sessions: readonly AgentSession[];
  getAgentSessions: (agentId: AgentId) => AgentSession[];
  getActiveSession: (agentId: AgentId) => AgentSession | undefined;
  getRunState: (sessionId?: string) => ChatRunState;
  createSession: (agentId: AgentId, title?: string, providerId?:AgentSession['providerId'], modelId?:string,editorial?:Pick<AgentSession,'contentId'|'topicId'|'contentTitle'>,activate?:boolean) => AgentSession;
  openSession: (agentId: AgentId, sessionId: string) => void;
  renameSession: (sessionId: string, title: string) => void;
  deleteSession: (sessionId: string) => void;
  sendMessage: (agent: Agent, content: string, contextNodes?: ChatContextReference[], sessionId?: string, selectedSkill?: string) => void;
  runWorkflowMessage: (agent: Agent, content: string, title: string, sessionId?: string) => Promise<{sessionId:string;content:string}>;
  getProviderStatus: (providerId: NonNullable<AgentSession['providerId']>) => Promise<import('./AiProvider').ProviderStatus>;
  cancelExecution: (sessionId?: string) => void;
  listModels:(providerId:NonNullable<AgentSession['providerId']>)=>Promise<readonly {id:string;name:string}[]>;
  setSessionModel:(sessionId:string,modelId?:string)=>void;
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
      for(const job of snapshot.jobs)if(['queued','running'].includes(job.status)&&!nativeShown.current.has(job.id)){nativeShown.current.add(job.id);if(!hasVisibleChats(job.sourceSessionId,job.targetSessionId))showCollaboration(job.id);}
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
  const createSession=useCallback((agentId:AgentId,title?:string,providerId:AgentSession['providerId']='codex',modelId?:string,editorial?:Pick<AgentSession,'contentId'|'topicId'|'contentTitle'>,activate=true)=>{const session={...makeSession(agentId,title,providerId,modelId??(providerId==='codex'?defaultCodexModelId||undefined:undefined)),...childContentLink(editorial)};pendingSessions.current.set(session.id,session);setSessions((current)=>[session,...current]);setActiveSessionIds((current)=>activeAfterCreate(current,agentId,session.id,activate));setRunStates((current)=>({...current,[session.id]:'idle'}));return session},[defaultCodexModelId,setActiveSessionIds,setSessions]);
  const openSession=useCallback((agentId:AgentId,sessionId:string)=>setActiveSessionIds((current)=>({...current,[agentId]:sessionId})),[setActiveSessionIds]);
  const renameSession=useCallback((sessionId:string,title:string)=>{const clean=title.trim();if(clean)updateSession(sessionId,(session)=>({...session,title:clean,updatedAt:new Date().toISOString()}))},[updateSession]);
  const deleteSession=useCallback((sessionId:string)=>{
    if(inFlightSessions.current.has(sessionId)||nativeBusy(sessionId))return;
    const target=sessions.find((session)=>session.id===sessionId);if(!target)return;
    const next=sessions.filter((session)=>session.agentId===target.agentId&&session.id!==sessionId).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
    abortControllers.current[sessionId]?.abort();delete abortControllers.current[sessionId];delete executions.current[sessionId];pendingSessions.current.delete(sessionId);
    writeChatDraft(target.agentId,sessionId,{text:'',skill:null});
    const remove=()=>{nativeGeneration.current++;setSessions((current)=>current.filter((session)=>session.id!==sessionId).map(session=>session.agentConnection?.targetSessionId===sessionId?{...session,agentConnection:{...session.agentConnection,targetSessionId:undefined}}:session));};
    if(window.mainsAgentsDesktop?.state)void fetch(`/api/content/delegations/sessions/${encodeURIComponent(sessionId)}?profile=${encodeURIComponent(storageProfile())}`,{method:'DELETE'}).then(async response=>{if(!response.ok)throw new Error((await response.json()).error);remove();}).catch(error=>window.dispatchEvent(new CustomEvent('mainsagents:persistence-error',{detail:error.message})));else remove();
    setActiveSessionIds((current)=>{if(current[target.agentId]!==sessionId)return current;const result={...current};if(next)result[target.agentId]=next.id;else delete result[target.agentId];return result;});
  },[sessions,setActiveSessionIds,setSessions]);
  const listModels=useCallback(async(providerId:NonNullable<AgentSession['providerId']>)=>{const provider=providers.find((item)=>item.id===providerId);if(!provider)throw new Error(`Provider ${providerId} is unavailable`);return provider.listModels()},[providers]);
  const getProviderStatus=useCallback(async(providerId:NonNullable<AgentSession['providerId']>)=>{const provider=providers.find((item)=>item.id===providerId);if(!provider)throw new Error(`Provider ${providerId} is unavailable`);return provider.getStatus()},[providers]);
  const setSessionModel=useCallback((sessionId:string,modelId?:string)=>updateSession(sessionId,(session)=>({...session,modelId:modelId||undefined,updatedAt:new Date().toISOString()})),[updateSession]);
  const setSessionReasoningEffort=useCallback((sessionId:string,reasoningEffort:ReasoningEffort)=>updateSession(sessionId,(session)=>({...session,reasoningEffort,updatedAt:new Date().toISOString()})),[updateSession]);
  const setAgentConnection=useCallback((sessionId:string,targetAgentId:string,enabled:boolean)=>{
    if(inFlightSessions.current.has(sessionId))throw new Error('Wait for the current response.');
    const session=sessionsRef.current.find(item=>item.id===sessionId)??pendingSessions.current.get(sessionId);
    const source=agentsRef.current.find(item=>item.id===session?.agentId),target=agentsRef.current.find(item=>item.id===targetAgentId);
    if(!session||!source||enabled&&(!target||source.id===target.id||source.workspaceId!==target.workspaceId))throw new Error('Choose another agent in this workspace.');
    updateSession(sessionId,current=>({...current,agentConnection:{enabled,targetAgentId,targetSessionId:current.agentConnection?.targetAgentId===targetAgentId?current.agentConnection.targetSessionId:undefined},updatedAt:new Date().toISOString()}));
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
        const productionSnapshot=(context:AgentSession['productionContext'])=>context?`\n\nMainsAgents authoritative production snapshot (reference data, not authorization to run tools):\n${JSON.stringify(context)}\nThe app owns these production steps. Use its production controls for approvals and scheduling. Never claim a step advanced or a post was scheduled merely from your text response.`:'';
        // Content session before any production: its identity only (never another content or chat).
        const sessionSnapshot=(current:AgentSession)=>current.productionContext?productionSnapshot(current.productionContext):current.contentId?`\n\nMainsAgents content session (reference data for THIS conversation only):\n${JSON.stringify({contentId:current.contentId,title:current.contentTitle??current.title,production:'none yet: no script, recording or edit has started in the app'})}\nAnswer only about this content; other contents and chats are not part of this conversation. Productions start from the app controls, never from your text.`:'';
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
        const thread=remoteId?await provider.resumeSession(remoteId):await provider.createSession({localSessionId:sessionId,agentId:agent.id,agentName:agent.name,workspaceId:agent.workspaceId,instructions:agent.instructions,modelId:session.modelId,tools:agent.tools,skillsDirectory:agent.skillsDirectory,skills:agent.skills});
        if(!remoteId)updateSession(sessionId,(current)=>({...current,providerId:provider.id,remoteSessionId:thread.remoteSessionId,codexThreadId:provider.id==='codex'?thread.remoteSessionId:current.codexThreadId,delegationRuntimeVersion:provider.id==='codex'?2:undefined,previousCodexThreadId:migrate?oldRemoteId:current.previousCodexThreadId,updatedAt:new Date().toISOString()}));
        await saveNow();
        if(controller.signal.aborted)throw new Error('Execution cancelled.');
        const live=sessionsRef.current.find(item=>item.id===sessionId)??session;
        const execution=await provider.sendMessage({remoteSessionId:thread.remoteSessionId,content:providerContent+sessionSnapshot(live),modelId:session.modelId,reasoningEffort:session.reasoningEffort??'medium',instructions:agent.instructions,agentId:agent.id,agentName:agent.name,role:agent.role,workspaceId:agent.workspaceId,tools:agent.tools,skillsDirectory:agent.skillsDirectory,skills:agent.skills,firstMessage:!remoteId,history:(sessionsRef.current.some(item=>item.id===sessionId)?live.messages:session.messages).filter((item):item is ChatMessageItem=>item.type==='message'&&item.id!==userMessageId).map((item)=>({role:item.role,content:item.content})),context:contextNodes.map((node)=>({id:node.nodeId,kind:node.kind,label:node.label,content:node.content})),delegation:{sourceAgentId:agent.id,workspaceId:agent.workspaceId,targets:targets.map(item=>({id:item.id,name:item.name,role:item.role})),connectedAgentId:connection?.targetAgentId}});
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
    const existing=linked&&request.sessionMode!=='new'&&connection.targetSessionId?sessionsRef.current.find(item=>item.id===connection.targetSessionId&&item.agentId===target.id)??pendingSessions.current.get(connection.targetSessionId):undefined;
    if(existing&&existing.agentId!==target.id)throw new Error('The connected session belongs to another agent. Choose a new session.');
    if(existing&&inFlightSessions.current.has(existing.id))throw new Error('The connected agent is already responding. Wait before sending another task.');
    // A specialist child keeps the target agent's visible session and belongs to the requesting content.
    const child=existing??createSession(target.id,request.title,target.providerId??'codex',target.modelId,childContentLink(liveSession),false);
    if(linked)updateSession(sourceSession.id,current=>({...current,agentConnection:{enabled:true,targetAgentId:target.id,targetSessionId:child.id},updatedAt:new Date().toISOString()}));
    const now=new Date().toISOString();
    const handoff:AgentHandoff={...request,id:makeId('handoff'),sourceAgentId:source.id,sourceSessionId:sourceSession.id,targetSessionId:child.id,workspaceId:source.workspaceId,context:[...context],status:'running',createdAt:now,updatedAt:now};
    updateSession(child.id,current=>({...current,originHandoffId:current.originHandoffId??handoff.id}));
    updateSession(sourceSession.id,current=>({...current,handoffs:[...(current.handoffs??[]),handoff],updatedAt:now}));
    if(!hasVisibleChats(handoff.sourceSessionId,handoff.targetSessionId))showCollaboration(handoff.id);
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

  const runWorkflowMessage=useCallback((agent:Agent,content:string,title:string,targetSessionId?:string)=>{
    const session=targetSessionId?(sessions.find((item)=>item.id===targetSessionId)??pendingSessions.current.get(targetSessionId)):createSession(agent.id,title,agent.providerId??'codex',agent.modelId);
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
      setRunStates(current=>({...current,...Object.fromEntries(pair.map(session=>[session.id,'idle' as const]))}));
      await saveNow();
    },
    execute:(agent,content,context,session)=>executeRef.current(agent,content,context,session),
  });
  const startComparison=useCallback((input:AgentComparisonInput)=>launcher.current!(input).then(comparison=>{showComparison(comparison.id);return comparison;}),[]);
  const comparisons=useMemo(()=>deriveComparisons(sessions,agents),[sessions,agents]);
  const comparisonId=comparisonSelection&&comparisons.some(item=>item.id===comparisonSelection)?comparisonSelection:null;

  const cancelExecution=useCallback((sessionId?:string)=>{if(!sessionId)return;for(const job of nativeJobs.current)if(job.targetSessionId===sessionId&&['queued','running'].includes(job.status))void fetch(`/api/content/delegations/${encodeURIComponent(job.id)}/cancel?profile=${encodeURIComponent(storageProfile())}`,{method:'POST'}).catch(()=>{});const executionId=executions.current[sessionId];const session=sessions.find((item)=>item.id===sessionId)??pendingSessions.current.get(sessionId);const provider=providers.find((item)=>item.id===sessionProviderId(session??{}));if(executionId&&provider)void provider.cancelExecution(executionId).catch((error)=>applyEvent(sessionId,{type:'execution.failed',executionId,code:'cancel_error',message:error instanceof Error?error.message:'Could not cancel execution',retryable:true}));abortControllers.current[sessionId]?.abort();},[applyEvent,providers,sessions]);

  const value=useMemo<ChatContextValue>(()=>({sessions,handoffs:sessions.flatMap(session=>session.handoffs??[]),collaborationId,showCollaboration,comparisons,comparisonId,showComparison,startComparison,delegateToAgent,setAgentConnection,newConnectedSession,refreshSessionImages,getAgentSessions:(agentId)=>sessions.filter((session)=>session.agentId===agentId).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),getActiveSession:(agentId)=>sessions.find((session)=>session.id===activeSessionIds[agentId]),getRunState:(sessionId)=>sessionId?runStates[sessionId]??'idle':'idle',createSession,openSession,renameSession,deleteSession,sendMessage,runWorkflowMessage,getProviderStatus,cancelExecution,listModels,setSessionModel,setSessionReasoningEffort}),[comparisons,comparisonId,startComparison,collaborationId,delegateToAgent,setAgentConnection,newConnectedSession,refreshSessionImages,activeSessionIds,cancelExecution,createSession,deleteSession,getProviderStatus,listModels,openSession,renameSession,runStates,runWorkflowMessage,sendMessage,sessions,setSessionModel,setSessionReasoningEffort]);
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat():ChatContextValue {const context=useContext(ChatContext);if(!context)throw new Error('useChat must be used inside ChatProvider');return context}
