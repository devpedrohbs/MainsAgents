import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { PageId, Task } from '../../app/types';
import type { Workspace } from '../../app/WorkspaceProvider';
import type { Agent } from '../../features/agents/model/Agent';
import type { AgentSession } from '../../features/chat/model/Chat';
import type { CanvasNodeKind } from '../canvas/canvasTypes';
import { Icon, type IconName } from '../common/Icon';

type ItemGroup = 'Actions' | 'Agents' | 'Tasks' | 'Sessions' | 'Workspaces';
interface PaletteItem { id:string; label:string; detail?:string; icon:IconName; shortcut?:string; group:ItemGroup; keywords?:string; run:()=>void }
interface CommandPaletteProps {
  agents:readonly Agent[];
  tasks:readonly Task[];
  sessions:readonly AgentSession[];
  workspaces:readonly Workspace[];
  currentWorkspaceId:string;
  open:boolean;
  onClose:()=>void;
  onNavigate:(page:PageId)=>void;
  onNewAgent:()=>void;
  onNewTask:()=>void;
  onNewSession:()=>void;
  onAddNode:(kind:CanvasNodeKind)=>void;
  onOpenAgent:(agentId:string)=>void;
  onOpenTask:(task:Task)=>void;
  onOpenSession:(agentId:string,sessionId:string)=>void;
  onSwitchWorkspace:(workspaceId:string)=>void;
}

const groupOrder:ItemGroup[]=['Actions','Agents','Tasks','Sessions','Workspaces'];
const normalize=(value:string)=>value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');

export function CommandPalette(props:CommandPaletteProps) {
  const {agents,tasks,sessions,workspaces,currentWorkspaceId,open,onClose,onNavigate,onNewAgent,onNewTask,onNewSession,onAddNode,onOpenAgent,onOpenTask,onOpenSession,onSwitchWorkspace}=props;
  const [query,setQuery]=useState('');
  const [scope,setScope]=useState<'all'|'workspaces'>('all');
  const [selected,setSelected]=useState(0);
  const inputRef=useRef<HTMLInputElement>(null);
  const itemRefs=useRef<Array<HTMLButtonElement|null>>([]);

  useEffect(()=>{if(open){setQuery('');setScope('all');setSelected(0);requestAnimationFrame(()=>inputRef.current?.focus())}},[open]);

  const items=useMemo<PaletteItem[]>(()=>{
    const finish=(action:()=>void)=>()=>{action();onClose()};
    const actions:PaletteItem[]=[
      {id:'new-agent',label:'New Agent',detail:'Create a specialist in this workspace',icon:'users',shortcut:'A',group:'Actions',keywords:'create agent',run:finish(onNewAgent)},
      {id:'new-task',label:'New Task',detail:'Add a task to the Board',icon:'plus',shortcut:'T',group:'Actions',keywords:'create board',run:finish(onNewTask)},
      {id:'new-session',label:'New Session',detail:'Start a clean agent conversation',icon:'message',shortcut:'N',group:'Actions',run:finish(onNewSession)},
      {id:'add-note',label:'Add Note',detail:'Create a note on the Canvas',icon:'note',group:'Actions',run:finish(()=>onAddNode('note'))},
      {id:'add-image',label:'Add Image',detail:'Create an image reference on the Canvas',icon:'image',group:'Actions',run:finish(()=>onAddNode('image'))},
      {id:'open-canvas',label:'Open Canvas',icon:'canvas',group:'Actions',run:finish(()=>onNavigate('canvas'))},
      {id:'open-board',label:'Open Board',icon:'board',group:'Actions',run:finish(()=>onNavigate('board'))},
      {id:'open-agent',label:'Open Agent',detail:'Search agents by name or role',icon:'spark',group:'Actions',keywords:'find agent',run:()=>{setQuery('');setScope('all');setSelected(10)}},
      {id:'switch-workspace',label:'Switch Workspace',detail:'Move to another workspace',icon:'folder',shortcut:'W',group:'Actions',run:()=>{setQuery('');setScope('workspaces');setSelected(0);requestAnimationFrame(()=>inputRef.current?.focus())}},
      {id:'settings',label:'Settings',icon:'settings',group:'Actions',run:finish(()=>onNavigate('settings'))},
    ];
    const agentItems=agents.map((agent):PaletteItem=>({id:`agent-${agent.id}`,label:agent.name,detail:agent.role,icon:'users',group:'Agents',keywords:agent.description,run:finish(()=>onOpenAgent(agent.id))}));
    const taskItems=tasks.map((task):PaletteItem=>({id:`task-${task.id}`,label:task.title,detail:agents.find((agent)=>agent.id===task.agentId)?.name ?? task.status,icon:'board',group:'Tasks',keywords:`${task.description} ${task.metadata} ${task.status}`,run:finish(()=>onOpenTask(task))}));
    const sessionItems=sessions.map((session):PaletteItem=>({id:`session-${session.id}`,label:session.title,detail:agents.find((agent)=>agent.id===session.agentId)?.name ?? 'Agent session',icon:'history',group:'Sessions',keywords:'conversation chat',run:finish(()=>onOpenSession(session.agentId,session.id))}));
    const workspaceItems=workspaces.map((workspace):PaletteItem=>({id:`workspace-${workspace.id}`,label:workspace.name,detail:workspace.id===currentWorkspaceId?'Current workspace':'Switch workspace',icon:'folder',group:'Workspaces',keywords:'workspace',run:finish(()=>onSwitchWorkspace(workspace.id))}));
    return scope==='workspaces'?workspaceItems:[...actions,...agentItems,...taskItems,...sessionItems,...workspaceItems];
  },[agents,currentWorkspaceId,onAddNode,onClose,onNavigate,onNewAgent,onNewSession,onNewTask,onOpenAgent,onOpenSession,onOpenTask,onSwitchWorkspace,scope,sessions,tasks,workspaces]);

  const filtered=useMemo(()=>{const needle=normalize(query.trim());return needle?items.filter((item)=>normalize(`${item.label} ${item.detail??''} ${item.keywords??''}`).includes(needle)):items},[items,query]);
  useEffect(()=>{setSelected(0)},[query,scope]);
  useEffect(()=>{itemRefs.current[selected]?.scrollIntoView({block:'nearest'})},[selected]);

  if(!open)return null;
  const choose=(item:PaletteItem)=>item.run();
  const onKeyDown=(event:KeyboardEvent<HTMLInputElement>)=>{
    if(event.key==='ArrowDown'){event.preventDefault();setSelected((current)=>filtered.length?(current+1)%filtered.length:0)}
    if(event.key==='ArrowUp'){event.preventDefault();setSelected((current)=>filtered.length?(current-1+filtered.length)%filtered.length:0)}
    if(event.key==='Enter'&&filtered[selected]){event.preventDefault();choose(filtered[selected])}
    if(event.key==='Escape'){event.preventDefault();scope==='workspaces'?(setScope('all'),setQuery('')):onClose()}
    if(event.key==='Backspace'&&!query&&scope==='workspaces'){event.preventDefault();setScope('all')}
  };
  let renderedIndex=0;

  return <div className="command-backdrop" onMouseDown={(event)=>event.target===event.currentTarget&&onClose()}><section className="command" role="dialog" aria-modal="true" aria-label="Command palette">
    <div className="command-search"><Icon name="search"/>{scope==='workspaces'&&<button className="command-scope" onClick={()=>setScope('all')}>Workspaces ×</button>}<input ref={inputRef} value={query} onChange={(event)=>setQuery(event.target.value)} onKeyDown={onKeyDown} placeholder={scope==='workspaces'?'Choose a workspace…':'Search commands, agents, tasks and sessions…'}/><span className="kbd">ESC</span></div>
    <div className="command-list">{filtered.length===0?<div className="command-empty"><Icon name="search"/><b>No results</b><span>Try another name or command.</span></div>:groupOrder.map((group)=>{const groupItems=filtered.filter((item)=>item.group===group);if(!groupItems.length)return null;return <div className="command-group" key={group}><p className="command-group-label">{group}</p>{groupItems.map((item)=>{const index=renderedIndex++;return <button ref={(node)=>{itemRefs.current[index]=node}} key={item.id} className={`command-item ${index===selected?'active':''}`} onMouseEnter={()=>setSelected(index)} onClick={()=>choose(item)}><span className="command-icon"><Icon name={item.icon}/></span><span className="command-copy"><b>{item.label}</b>{item.detail&&<small>{item.detail}</small>}</span>{item.shortcut&&<span className="kbd">{item.shortcut}</span>}</button>})}</div>})}</div>
    <footer className="command-footer"><span><i>↑↓</i> Navigate</span><span><i>↵</i> Open</span><span><i>esc</i> Close</span></footer>
  </section></div>;
}
