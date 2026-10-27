import type { Task, TaskStatus } from '../../app/types';
import { TaskCard } from './TaskCard';
import { useLanguage } from '../../app/LanguageProvider';

const statusClass:Record<TaskStatus,string>={research:'',running:'running',review:'review',done:'done'};
interface TaskColumnProps { status:TaskStatus; label:string; tasks:Task[]; draggingTaskId:string|null; isDropTarget:boolean; onOpen:(task:Task)=>void; onAdd:(status:TaskStatus)=>void; onDragStart:(taskId:string)=>void; onDragEnd:()=>void; onDragOver:(status:TaskStatus)=>void; onDrop:(taskId:string,status:TaskStatus)=>void; onDragLeave:(status:TaskStatus)=>void }
export function TaskColumn({status,label,tasks,draggingTaskId,isDropTarget,onOpen,onAdd,onDragStart,onDragEnd,onDragOver,onDrop,onDragLeave}:TaskColumnProps) {
  const {t,locale}=useLanguage();
  return <section className={`board-column ${isDropTarget?'drop-target':''}`} aria-label={`${label} ${locale==='pt-BR'?'tarefas':'tasks'}`} data-task-status={status} data-od-id={'task-column-'+status} onPointerMove={()=>{if(draggingTaskId)onDragOver(status)}} onPointerLeave={()=>{if(draggingTaskId)onDragLeave(status)}} onPointerUp={()=>{if(draggingTaskId)onDrop(draggingTaskId,status)}}><div className="column-head"><i className={`column-status ${statusClass[status]}`}/><b>{label}</b><span className="count">{tasks.length}</span><button className="column-add" onClick={()=>onAdd(status)} aria-label={`${t('Add task')} · ${label}`}>+</button></div><div className="task-stack">{tasks.map((task)=><TaskCard key={task.id} task={task} onOpen={onOpen} onDragStart={onDragStart} onDragEnd={onDragEnd} isDragging={draggingTaskId===task.id}/>)}{!tasks.length&&<div className="column-empty">{locale==='pt-BR'?'Nada aqui':'Nothing here'}</div>}</div></section>;
}
