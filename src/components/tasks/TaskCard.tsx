import type { KeyboardEvent, PointerEvent } from 'react';
import type { Task } from '../../app/types';
import { useLanguage } from '../../app/LanguageProvider';
import { useAgents } from '../../features/agents/AgentsProvider';
import { useChat } from '../../features/chat/ChatProvider';
import { useContentWorkflow } from '../../features/content/ContentWorkflowProvider';
import { AgentAvatar } from '../agents/AgentAvatar';

const busyStates=['thinking','searching','using-tool'];

export function TaskCard({task,onOpen,onDragStart,onDragEnd,isDragging}:{task:Task;onOpen:(task:Task)=>void;onDragStart:(taskId:string)=>void;onDragEnd:()=>void;isDragging:boolean}) {
  const {getAgentById}=useAgents();
  const {getRunState}=useChat();
  const {state}=useContentWorkflow();
  const {locale,t}=useLanguage(),pt=locale==='pt-BR';
  const agent=getAgentById(task.agentId);
  const agentName=agent?.name??(task.contentId?(pt?'Fluxo editorial':'Editorial workflow'):t('Deleted agent'));
  const contentTitle=task.contentId?state.contents.find(content=>content.id===task.contentId)?.title:undefined;
  const scope=contentTitle&&contentTitle!==task.title?contentTitle:undefined;
  const busy=!!task.sessionId&&busyStates.includes(getRunState(task.sessionId));
  const line=busy?(pt?'Pensando…':'Thinking…'):[agentName,task.metadata.replace(/[\s·]+$/,'')].filter(Boolean).join(' · ');
  const startDrag=(event:PointerEvent<HTMLElement>)=>{if(event.button===0&&!task.contentId)onDragStart(task.id)};
  const openFromKeyboard=(event:KeyboardEvent<HTMLElement>)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onOpen(task)}};
  return <article className={`task-card ${task.status==='review'?'needs-review':''} ${isDragging?'dragging':''}`} tabIndex={0} role="button" aria-label={`${pt?'Abrir':'Open'} ${task.title}`} aria-grabbed={task.contentId?undefined:isDragging} title={task.contentId?(pt?'O status acompanha as aprovações no Estúdio de conteúdo.':'Editorial status follows approval in Content Studio.'):undefined} onClick={()=>onOpen(task)} onKeyDown={openFromKeyboard} onPointerDown={startDrag} onPointerCancel={onDragEnd}>
    {scope&&<span className="task-scope">{scope}</span>}
    <h3>{task.title}</h3>
    <div className="task-agent">
      {agent?<AgentAvatar name={agent.name} image={agent.avatarImage} mascot={agent.avatarMascot} role={agent.role} thinking={busy}/>:<span className="agent-monogram">E</span>}
      <span className={busy?'ov-shimmer':''}>{line}</span>
    </div>
    {task.status==='review'&&<span className="task-review-action">{pt?'Revisar':'Review'}</span>}
  </article>;
}
