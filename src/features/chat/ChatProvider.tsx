import { createContext, useCallback, useContext, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import type { Agent, AgentId } from '../agents/model/Agent';
import type { AgentSession, ChatActivityItem, ChatContextReference, ChatItem, ChatRunState } from './model/Chat';
import type { CodexEvent, CodexService } from './CodexService';
import { usePersistentState } from '../../data/localPersistence';

interface ChatContextValue {
  sessions: readonly AgentSession[];
  getAgentSessions: (agentId: AgentId) => AgentSession[];
  getActiveSession: (agentId: AgentId) => AgentSession | undefined;
  getRunState: (sessionId?: string) => ChatRunState;
  createSession: (agentId: AgentId, title?: string) => AgentSession;
  openSession: (agentId: AgentId, sessionId: string) => void;
  renameSession: (sessionId: string, title: string) => void;
  deleteSession: (sessionId: string) => void;
  sendMessage: (agent: Agent, content: string, contextNodes?: ChatContextReference[]) => void;
  cancelExecution: (sessionId?: string) => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);
const makeId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const makeSession = (agentId: AgentId, title?: string): AgentSession => { const now=new Date().toISOString();return {id:makeId('session'),agentId,title:title??(document.documentElement.lang==='pt-BR'?'Nova sessão':'New session'),messages:[],createdAt:now,updatedAt:now} };
const titleFromMessage = (message: string) => message.length > 42 ? `${message.slice(0, 42).trim()}…` : message;

export function ChatProvider({ children, codexService }: PropsWithChildren<{codexService:CodexService}>) {
  const [sessions,setSessions]=usePersistentState<AgentSession[]>('sessions',[]);
  const [activeSessionIds,setActiveSessionIds]=usePersistentState<Record<AgentId,string>>('active-sessions',{});
  const [runStates,setRunStates]=useState<Record<string,ChatRunState>>({});
  const executions=useRef<Record<string,string>>({});
  const abortControllers=useRef<Record<string,AbortController>>({});

  const updateSession=useCallback((sessionId:string,change:(session:AgentSession)=>AgentSession)=>setSessions((current)=>current.map((session)=>session.id===sessionId?change(session):session)),[setSessions]);
  const createSession=useCallback((agentId:AgentId,title?:string)=>{const session=makeSession(agentId,title);setSessions((current)=>[session,...current]);setActiveSessionIds((current)=>({...current,[agentId]:session.id}));setRunStates((current)=>({...current,[session.id]:'idle'}));return session},[setActiveSessionIds,setSessions]);
  const openSession=useCallback((agentId:AgentId,sessionId:string)=>setActiveSessionIds((current)=>({...current,[agentId]:sessionId})),[setActiveSessionIds]);
  const renameSession=useCallback((sessionId:string,title:string)=>{const clean=title.trim();if(clean)updateSession(sessionId,(session)=>({...session,title:clean,updatedAt:new Date().toISOString()}))},[updateSession]);
  const deleteSession=useCallback((sessionId:string)=>{setSessions((current)=>{const target=current.find((session)=>session.id===sessionId);if(!target)return current;const remaining=current.filter((session)=>session.id!==sessionId);const next=remaining.filter((session)=>session.agentId===target.agentId).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0]??makeSession(target.agentId);if(!remaining.includes(next))remaining.unshift(next);setActiveSessionIds((active)=>active[target.agentId]===sessionId?{...active,[target.agentId]:next.id}:active);return remaining});abortControllers.current[sessionId]?.abort();delete abortControllers.current[sessionId];delete executions.current[sessionId]},[setActiveSessionIds,setSessions]);

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

  const sendMessage=useCallback((agent:Agent,content:string,contextNodes:ChatContextReference[]=[] )=>{
    const clean=content.trim();if(!clean)return;
    let session=sessions.find((item)=>item.id===activeSessionIds[agent.id]);
    if(!session){session=makeSession(agent.id);setSessions((current)=>[session!,...current]);setActiveSessionIds((current)=>({...current,[agent.id]:session!.id}))}
    const sessionId=session.id;
    setRunStates((current)=>({...current,[sessionId]:'thinking'}));
    updateSession(sessionId,(current)=>({...current,title:['New session','Nova sessão'].includes(current.title)?titleFromMessage(clean):current.title,updatedAt:new Date().toISOString(),messages:[...current.messages,{id:makeId('message'),type:'message',role:'user',content:clean,createdAt:new Date().toISOString(),contextNodes:contextNodes.length?[...contextNodes]:undefined}]}));
    const controller=new AbortController();abortControllers.current[sessionId]=controller;
    void (async()=>{
      try{
        const thread=session!.codexThreadId?await codexService.resumeSession({threadId:session!.codexThreadId}):await codexService.createSession({agentId:agent.id,agentName:agent.name,workspaceId:agent.workspaceId,instructions:agent.instructions,tools:agent.tools,skillsDirectory:agent.skillsDirectory,skills:agent.skills});
        if(!session!.codexThreadId)updateSession(sessionId,(current)=>({...current,codexThreadId:thread.threadId,updatedAt:new Date().toISOString()}));
        const execution=await codexService.sendMessage({threadId:thread.threadId,content:clean,context:contextNodes.map((node)=>({id:node.nodeId,kind:node.kind,label:node.label}))});
        executions.current[sessionId]=execution.executionId;
        for await(const event of codexService.streamEvents({executionId:execution.executionId,signal:controller.signal}))applyEvent(sessionId,event);
      }catch(error){if(controller.signal.aborted)return;applyEvent(sessionId,{type:'execution.failed',executionId:executions.current[sessionId]??'unknown',code:'connection_error',message:error instanceof Error?error.message:'Could not connect to Codex',retryable:true})}
      finally{delete abortControllers.current[sessionId];delete executions.current[sessionId]}
    })();
  },[activeSessionIds,applyEvent,codexService,sessions,setActiveSessionIds,setSessions,updateSession]);

  const cancelExecution=useCallback((sessionId?:string)=>{if(!sessionId)return;const executionId=executions.current[sessionId];if(!executionId)return;void codexService.cancelExecution(executionId).catch((error)=>applyEvent(sessionId,{type:'execution.failed',executionId,code:'cancel_error',message:error instanceof Error?error.message:'Could not cancel execution',retryable:true}))},[applyEvent,codexService]);

  const value=useMemo<ChatContextValue>(()=>({sessions,getAgentSessions:(agentId)=>sessions.filter((session)=>session.agentId===agentId).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),getActiveSession:(agentId)=>sessions.find((session)=>session.id===activeSessionIds[agentId]),getRunState:(sessionId)=>sessionId?runStates[sessionId]??'idle':'idle',createSession,openSession,renameSession,deleteSession,sendMessage,cancelExecution}),[activeSessionIds,cancelExecution,createSession,deleteSession,openSession,renameSession,runStates,sendMessage,sessions]);
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat():ChatContextValue {const context=useContext(ChatContext);if(!context)throw new Error('useChat must be used inside ChatProvider');return context}
