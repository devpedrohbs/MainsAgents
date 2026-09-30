import { createContext, useCallback, useContext, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import type { Agent, AgentId } from '../agents/model/Agent';
import type { AgentSession, ChatActivityItem, ChatContextReference, ChatItem, ChatRunState, ReasoningEffort } from './model/Chat';
import type { CodexEvent } from './CodexService';
import type { AiProvider } from './AiProvider';
import { sessionProviderId, sessionRemoteId } from './AiProvider';
import { usePersistentState } from '../../data/localPersistence';
import { writeChatDraft } from './chatDrafts';
import { providerSkillPrompt } from './skillCommands';

interface ChatContextValue {
  sessions: readonly AgentSession[];
  getAgentSessions: (agentId: AgentId) => AgentSession[];
  getActiveSession: (agentId: AgentId) => AgentSession | undefined;
  getRunState: (sessionId?: string) => ChatRunState;
  createSession: (agentId: AgentId, title?: string, providerId?:AgentSession['providerId'], modelId?:string) => AgentSession;
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
}

const ChatContext = createContext<ChatContextValue | null>(null);
const makeId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const makeSession = (agentId: AgentId, title?: string, providerId:AgentSession['providerId']='codex', modelId?:string): AgentSession => { const now=new Date().toISOString();return {id:makeId('session'),agentId,providerId,modelId,authMode:'unknown',title:title??(document.documentElement.lang==='pt-BR'?'Nova sessão':'New session'),messages:[],createdAt:now,updatedAt:now} };
const titleFromMessage = (message: string) => message.length > 42 ? `${message.slice(0, 42).trim()}…` : message;

export function ChatProvider({ children, providers }: PropsWithChildren<{providers:readonly AiProvider[]}>) {
  const [sessions,setSessions]=usePersistentState<AgentSession[]>('sessions',[]);
  const [activeSessionIds,setActiveSessionIds]=usePersistentState<Record<AgentId,string>>('active-sessions',{});
  const [defaultCodexModelId]=usePersistentState<string>('default-codex-model','');
  const [runStates,setRunStates]=useState<Record<string,ChatRunState>>({});
  const executions=useRef<Record<string,string>>({});
  const abortControllers=useRef<Record<string,AbortController>>({});
  const inFlightSessions=useRef(new Set<string>());
  const pendingSessions=useRef(new Map<string,AgentSession>());

  const updateSession=useCallback((sessionId:string,change:(session:AgentSession)=>AgentSession)=>setSessions((current)=>current.map((session)=>session.id===sessionId?change(session):session)),[setSessions]);
  const createSession=useCallback((agentId:AgentId,title?:string,providerId:AgentSession['providerId']='codex',modelId?:string)=>{const session=makeSession(agentId,title,providerId,modelId??(providerId==='codex'?defaultCodexModelId||undefined:undefined));pendingSessions.current.set(session.id,session);setSessions((current)=>[session,...current]);setActiveSessionIds((current)=>({...current,[agentId]:session.id}));setRunStates((current)=>({...current,[session.id]:'idle'}));return session},[defaultCodexModelId,setActiveSessionIds,setSessions]);
  const openSession=useCallback((agentId:AgentId,sessionId:string)=>setActiveSessionIds((current)=>({...current,[agentId]:sessionId})),[setActiveSessionIds]);
  const renameSession=useCallback((sessionId:string,title:string)=>{const clean=title.trim();if(clean)updateSession(sessionId,(session)=>({...session,title:clean,updatedAt:new Date().toISOString()}))},[updateSession]);
  const deleteSession=useCallback((sessionId:string)=>{
    const target=sessions.find((session)=>session.id===sessionId);if(!target)return;
    const next=sessions.filter((session)=>session.agentId===target.agentId&&session.id!==sessionId).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
    abortControllers.current[sessionId]?.abort();delete abortControllers.current[sessionId];delete executions.current[sessionId];pendingSessions.current.delete(sessionId);
    writeChatDraft(target.agentId,sessionId,{text:'',skill:null});
    setSessions((current)=>current.filter((session)=>session.id!==sessionId));
    setActiveSessionIds((current)=>{if(current[target.agentId]!==sessionId)return current;const result={...current};if(next)result[target.agentId]=next.id;else delete result[target.agentId];return result;});
  },[sessions,setActiveSessionIds,setSessions]);
  const listModels=useCallback(async(providerId:NonNullable<AgentSession['providerId']>)=>{const provider=providers.find((item)=>item.id===providerId);if(!provider)throw new Error(`Provider ${providerId} is unavailable`);return provider.listModels()},[providers]);
  const getProviderStatus=useCallback(async(providerId:NonNullable<AgentSession['providerId']>)=>{const provider=providers.find((item)=>item.id===providerId);if(!provider)throw new Error(`Provider ${providerId} is unavailable`);return provider.getStatus()},[providers]);
  const setSessionModel=useCallback((sessionId:string,modelId?:string)=>updateSession(sessionId,(session)=>({...session,modelId:modelId||undefined,updatedAt:new Date().toISOString()})),[updateSession]);
  const setSessionReasoningEffort=useCallback((sessionId:string,reasoningEffort:ReasoningEffort)=>updateSession(sessionId,(session)=>({...session,reasoningEffort,updatedAt:new Date().toISOString()})),[updateSession]);

  const applyEvent=useCallback((sessionId:string,event:CodexEvent)=>{
    if(event.type==='execution.started'){setRunStates((current)=>({...current,[sessionId]:'thinking'}));return}
    if(event.type==='message.delta'||event.type==='message.completed'){
      const messageId=`codex-${event.executionId}`;
      updateSession(sessionId,(session)=>{const exists=session.messages.some((item)=>item.id===messageId);const content=event.type==='message.delta'?event.delta:event.content;return {...session,updatedAt:new Date().toISOString(),messages:exists?session.messages.map((item)=>item.id===messageId&&item.type==='message'?{...item,content:event.type==='message.delta'?item.content+content:content}:item):[...session.messages,{id:messageId,type:'message',role:'agent',content,createdAt:new Date().toISOString()}]}});
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
    if(event.type==='execution.completed'){setRunStates((current)=>({...current,[sessionId]:'finished'}));updateSession(sessionId,(session)=>({...session,updatedAt:new Date().toISOString(),messages:session.messages.map((item):ChatItem=>item.type==='activity'&&item.status==='running'?{...item,status:'done'}:item)}));return}
    if(event.type==='execution.cancelled'){setRunStates((current)=>({...current,[sessionId]:'idle'}));return}
    if(event.type==='execution.failed'){setRunStates((current)=>({...current,[sessionId]:'error'}));updateSession(sessionId,(session)=>({...session,updatedAt:new Date().toISOString(),messages:[...session.messages,{id:makeId('activity'),type:'activity',label:event.message,status:'error'}]}))}
  },[updateSession]);

  const executeMessage=useCallback(async(agent:Agent,content:string,contextNodes:ChatContextReference[],session:AgentSession,selectedSkill?:string):Promise<{sessionId:string;content:string}>=>{
    const clean=content.trim();if(!clean)throw new Error('Enter a message.');
    const sessionId=session.id;
    if(inFlightSessions.current.has(sessionId))throw new Error('This session is already responding.');
    inFlightSessions.current.add(sessionId);
    setRunStates((current)=>({...current,[sessionId]:'thinking'}));
    updateSession(sessionId,(current)=>({...current,title:['New session','Nova sessão'].includes(current.title)?titleFromMessage(clean):current.title,updatedAt:new Date().toISOString(),messages:[...current.messages,{id:makeId('message'),type:'message',role:'user',content:clean,createdAt:new Date().toISOString(),contextNodes:contextNodes.length?[...contextNodes]:undefined,selectedSkill}]}));
    const controller=new AbortController();abortControllers.current[sessionId]=controller;
    let failureReported=false;
      try{
        const provider=providers.find((item)=>item.id===sessionProviderId(session));
        if(!provider)throw new Error(`Provider ${sessionProviderId(session)} is not available. The history is still saved locally.`);
        const providerContent=providerSkillPrompt(agent,clean,selectedSkill);
        const remoteId=sessionRemoteId(session);
        const thread=remoteId?await provider.resumeSession(remoteId):await provider.createSession({agentId:agent.id,agentName:agent.name,workspaceId:agent.workspaceId,instructions:agent.instructions,modelId:session.modelId,tools:agent.tools,skillsDirectory:agent.skillsDirectory,skills:agent.skills});
        if(!remoteId)updateSession(sessionId,(current)=>({...current,providerId:provider.id,remoteSessionId:thread.remoteSessionId,codexThreadId:provider.id==='codex'?thread.remoteSessionId:current.codexThreadId,updatedAt:new Date().toISOString()}));
        const execution=await provider.sendMessage({remoteSessionId:thread.remoteSessionId,content:providerContent,modelId:session.modelId,reasoningEffort:session.reasoningEffort??'medium',instructions:agent.instructions,agentId:agent.id,agentName:agent.name,role:agent.role,workspaceId:agent.workspaceId,tools:agent.tools,skillsDirectory:agent.skillsDirectory,skills:agent.skills,firstMessage:!remoteId,history:session.messages.filter((item)=>item.type==='message').map((item)=>({role:item.role,content:item.content})),context:contextNodes.map((node)=>({id:node.nodeId,kind:node.kind,label:node.label,content:node.content}))});
        executions.current[sessionId]=execution.executionId;
        let output='';
        for await(const event of provider.streamEvents({executionId:execution.executionId,signal:controller.signal})){
          applyEvent(sessionId,event);
          if(event.type==='message.delta')output+=event.delta;
          if(event.type==='message.completed')output=event.content;
          if(event.type==='execution.failed'){failureReported=true;throw new Error(event.message)}
          if(event.type==='execution.cancelled')throw new Error('Execution cancelled.');
        }
        if(!output.trim())throw new Error('The provider returned no response.');
        return {sessionId,content:output};
      }catch(error){if(!failureReported&&!controller.signal.aborted)applyEvent(sessionId,{type:'execution.failed',executionId:executions.current[sessionId]??'unknown',code:'connection_error',message:error instanceof Error?error.message:'Could not connect to the provider',retryable:true});throw error}
      finally{delete abortControllers.current[sessionId];delete executions.current[sessionId];inFlightSessions.current.delete(sessionId);pendingSessions.current.delete(sessionId)}
  },[applyEvent,providers,updateSession]);

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

  const cancelExecution=useCallback((sessionId?:string)=>{if(!sessionId)return;const executionId=executions.current[sessionId];if(!executionId)return;const session=sessions.find((item)=>item.id===sessionId);const provider=providers.find((item)=>item.id===sessionProviderId(session??{}));if(!provider)return;void provider.cancelExecution(executionId).catch((error)=>applyEvent(sessionId,{type:'execution.failed',executionId,code:'cancel_error',message:error instanceof Error?error.message:'Could not cancel execution',retryable:true}))},[applyEvent,providers,sessions]);

  const value=useMemo<ChatContextValue>(()=>({sessions,getAgentSessions:(agentId)=>sessions.filter((session)=>session.agentId===agentId).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),getActiveSession:(agentId)=>sessions.find((session)=>session.id===activeSessionIds[agentId]),getRunState:(sessionId)=>sessionId?runStates[sessionId]??'idle':'idle',createSession,openSession,renameSession,deleteSession,sendMessage,runWorkflowMessage,getProviderStatus,cancelExecution,listModels,setSessionModel,setSessionReasoningEffort}),[activeSessionIds,cancelExecution,createSession,deleteSession,getProviderStatus,listModels,openSession,renameSession,runStates,runWorkflowMessage,sendMessage,sessions,setSessionModel,setSessionReasoningEffort]);
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat():ChatContextValue {const context=useContext(ChatContext);if(!context)throw new Error('useChat must be used inside ChatProvider');return context}
