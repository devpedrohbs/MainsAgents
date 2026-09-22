import type { KeyboardEvent, PointerEvent } from 'react';
import type { Task } from '../../app/types';
import { useAgents } from '../../features/agents/AgentsProvider';
import { getAgentInitials } from '../../features/agents/model/Agent';
import { AgentStatus } from '../agents/AgentStatus';

export function TaskCard({task,onOpen,onDragStart,onDragEnd,isDragging}:{task:Task;onOpen:(task:Task)=>void;onDragStart:(taskId:string)=>void;onDragEnd:()=>void;isDragging:boolean}) {
  const {agents,getAgentById}=useAgents();
  const agent=getAgentById(task.agentId) ?? agents[0];
  if(!agent)return null;
  const startDrag=(event:PointerEvent<HTMLElement>)=>{if(event.button===0)onDragStart(task.id)};
  const openFromKeyboard=(event:KeyboardEvent<HTMLElement>)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onOpen(task)}};
  return <article className={`task-card ${isDragging?'dragging':''}`} tabIndex={0} role="button" aria-label={`Open ${task.title}`} aria-grabbed={isDragging} onClick={()=>onOpen(task)} onKeyDown={openFromKeyboard} onPointerDown={startDrag} onPointerCancel={onDragEnd}><div className="task-agent"><span className="agent-monogram">{getAgentInitials(agent)}</span><span>{agent.name}</span></div><h3>{task.title}</h3><div className="task-meta"><AgentStatus status={task.status}/><span className="task-metadata">{task.metadata}</span></div></article>;
}
