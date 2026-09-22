import { useState } from 'react';
import type { Task, TaskStatus } from '../app/types';
import { useWorkspaces } from '../app/WorkspaceProvider';
import { TaskColumn } from '../components/tasks/TaskColumn';

const columns:{status:TaskStatus;label:string}[]=[{status:'research',label:'Research'},{status:'running',label:'Running'},{status:'review',label:'Review'},{status:'done',label:'Done'}];
export function Board({tasks,onOpenTask,onMoveTask,onToast}:{tasks:Task[];onOpenTask:(task:Task)=>void;onMoveTask:(taskId:string,status:TaskStatus)=>void;onToast:(message:string)=>void}) {
  const {currentWorkspace}=useWorkspaces();
  const [draggingTaskId,setDraggingTaskId]=useState<string|null>(null);
  const [dropTarget,setDropTarget]=useState<TaskStatus|null>(null);
  const finishDrag=()=>{setDraggingTaskId(null);setDropTarget(null)};
  const drop=(taskId:string,status:TaskStatus)=>{const task=tasks.find((item)=>item.id===taskId);if(task&&task.status!==status)onMoveTask(taskId,status);finishDrag()};
  return <div className="page"><div className="page-head"><div><p className="eyebrow">{currentWorkspace.name} workspace</p><h1>Board</h1><p>Track work without losing the agent, sources, or output behind it.</p></div><button className="soft-button">Filter</button></div><div className={`board ${draggingTaskId?'is-dragging':''}`}>{columns.map(({status,label})=><TaskColumn key={status} status={status} label={label} tasks={tasks.filter((task)=>task.status===status)} draggingTaskId={draggingTaskId} isDropTarget={dropTarget===status} onOpen={onOpenTask} onAdd={()=>onToast(`New ${status} task`)} onDragStart={(taskId)=>{setDraggingTaskId(taskId);setDropTarget(null)}} onDragEnd={finishDrag} onDragOver={setDropTarget} onDragLeave={(leftStatus)=>setDropTarget((current)=>current===leftStatus?null:current)} onDrop={drop}/>)}</div></div>;
}
