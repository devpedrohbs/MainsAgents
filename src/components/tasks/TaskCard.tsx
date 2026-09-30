import type { KeyboardEvent, PointerEvent } from 'react';
import type { Task } from '../../app/types';
import { useLanguage } from '../../app/LanguageProvider';
import { useAgents } from '../../features/agents/AgentsProvider';
import { getAgentInitials } from '../../features/agents/model/Agent';
import { AgentStatus } from '../agents/AgentStatus';

export function TaskCard({task,onOpen,onDragStart,onDragEnd,isDragging}:{task:Task;onOpen:(task:Task)=>void;onDragStart:(taskId:string)=>void;onDragEnd:()=>void;isDragging:boolean}) {
  const {getAgentById}=useAgents();
  const {locale,t}=useLanguage();
  const agent=getAgentById(task.agentId);
  const agentName=agent?.name??(task.contentId?(locale==='pt-BR'?'Fluxo editorial':'Editorial workflow'):t('Deleted agent'));
  const startDrag=(event:PointerEvent<HTMLElement>)=>{if(event.button===0&&!task.contentId)onDragStart(task.id)};
  const openFromKeyboard=(event:KeyboardEvent<HTMLElement>)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onOpen(task)}};
  return <article className={`task-card ${isDragging?'dragging':''}`} tabIndex={0} role="button" aria-label={`${locale==='pt-BR'?'Abrir':'Open'} ${task.title}`} aria-grabbed={task.contentId?undefined:isDragging} title={task.contentId?(locale==='pt-BR'?'O status acompanha as aprovações no Estúdio de conteúdo.':'Editorial status follows approval in Content Studio.'):undefined} onClick={()=>onOpen(task)} onKeyDown={openFromKeyboard} onPointerDown={startDrag} onPointerCancel={onDragEnd}><div className="task-agent"><span className="agent-monogram">{agent?getAgentInitials(agent):'E'}</span><span>{agentName}</span></div><h3>{task.title}</h3><div className="task-meta"><AgentStatus status={task.status}/><span className="task-metadata">{task.metadata}</span></div></article>;
}
