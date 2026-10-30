import type { Task, TaskStatus } from '../../app/types';
import { StatusIcon, type RunState } from '../common/StatusIcon';
import { TaskCard } from './TaskCard';
import { useLanguage } from '../../app/LanguageProvider';

const states:Record<TaskStatus,RunState>={research:'queued',running:'running',review:'waiting',done:'done'};
interface TaskColumnProps { status:TaskStatus; label:string; tasks:Task[]; draggingTaskId:string|null; isDropTarget:boolean; onOpen:(task:Task)=>void; onInspect:(task:Task)=>void; selectedId?:string; onAdd:(status:TaskStatus)=>void; onRemove:(taskId:string)=>void; onDragStart:(taskId:string)=>void; onDragEnd:()=>void; onDragOver:(status:TaskStatus)=>void; onDrop:(taskId:string,status:TaskStatus)=>void; onDragLeave:(status:TaskStatus)=>void }
export function TaskColumn({status,label,tasks,draggingTaskId,isDropTarget,onOpen,onInspect,selectedId,onAdd,onRemove,onDragStart,onDragEnd,onDragOver,onDrop,onDragLeave}:TaskColumnProps) {
  const {t,locale}=useLanguage();
  return <section className={`board-column ${isDropTarget?'drop-target':''}`} aria-label={`${label} ${locale==='pt-BR'?'tarefas':'tasks'}`} data-task-status={status} data-od-id={'task-column-'+status} onPointerMove={()=>{if(draggingTaskId)onDragOver(status)}} onPointerLeave={()=>{if(draggingTaskId)onDragLeave(status)}} onPointerUp={()=>{if(draggingTaskId)onDrop(draggingTaskId,status)}}><div className="column-head"><StatusIcon state={states[status]}/><b>{label}</b><span className="count v2-mono">{tasks.length}</span><button className="column-add" onClick={()=>onAdd(status)} aria-label={`${t('Add task')} · ${label}`}>+</button></div><div className="task-stack">{tasks.map((task)=><TaskCard key={task.id} task={task} onOpen={onOpen} onInspect={onInspect} selected={selectedId===task.id} onRemove={onRemove} onDragStart={onDragStart} onDragEnd={onDragEnd} isDragging={draggingTaskId===task.id}/>)}{!tasks.length&&<div className="column-empty">{locale==='pt-BR'?'Nada aqui':'Nothing here'}</div>}</div></section>;
}
