import { useEffect, useState } from 'react';
import type { Task, TaskStatus } from './types';
import { useHashRouter } from './useHashRouter';
import { useAgents } from '../features/agents/AgentsProvider';
import type { AgentEditorValues, AgentId } from '../features/agents/model/Agent';
import { AppShell } from '../components/layout/AppShell';
import { CommandPalette } from '../components/command/CommandPalette';
import { AgentEditorDrawer } from '../components/agents/AgentEditorDrawer';
import { Home } from '../pages/Home';
import { Board } from '../pages/Board';
import { Canvas } from '../pages/Canvas';
import { Agents } from '../pages/Agents';
import { AgentSettings } from '../pages/AgentSettings';
import { Sessions } from '../pages/Sessions';
import { Settings } from '../pages/Settings';
import { useCanvas } from '../components/canvas/CanvasProvider';
import { useWorkspaces } from './WorkspaceProvider';
import { useChat } from '../features/chat/ChatProvider';
import { usePersistentState } from '../data/localPersistence';
import { useLanguage } from './LanguageProvider';

export function App() {
  const { page, navigate } = useHashRouter();
  const {locale}=useLanguage();
  const {agents:allAgents,getAgentById,createAgent,updateAgent,deleteAgent}=useAgents();
  const {currentWorkspaceId,workspaces,setCurrentWorkspaceId}=useWorkspaces();
  const {sessions,createSession,openSession}=useChat();
  const {attachNodesToAgent,addNode}=useCanvas();
  const agents=allAgents.filter((agent)=>agent.workspaceId===currentWorkspaceId);
  const [activeAgentId,setActiveAgentId]=useState<AgentId>(agents[0]?.id ?? '');
  const [editorAgentId,setEditorAgentId]=useState<AgentId|'new'|null>(null);
  const [panelOpen,setPanelOpen]=useState(true);
  const [commandOpen,setCommandOpen]=useState(false);
  const [toast,setToast]=useState('');
  const [allTasks,setAllTasks]=usePersistentState<Task[]>('tasks',[]);
  const workspaceTasks=allTasks.filter((task)=>task.workspaceId===currentWorkspaceId);
  const activeAgent=getAgentById(activeAgentId) ?? agents[0];
  const editorAgent=editorAgentId&&editorAgentId!=='new'?getAgentById(editorAgentId):undefined;
  const notify=(message:string)=>{setToast(message);window.clearTimeout(window.__mainsToast);window.__mainsToast=window.setTimeout(()=>setToast(''),1800)};
  const selectAgent=(agentId:string,settings=false)=>{setActiveAgentId(agentId);setPanelOpen(true);if(settings)navigate('agent-settings')};
  const editAgent=(agentId:AgentId)=>{setActiveAgentId(agentId);setPanelOpen(true);setEditorAgentId(agentId)};
  const saveAgent=(values:AgentEditorValues)=>{if(editorAgentId==='new'){const created=createAgent(values);setActiveAgentId(created.id);notify(`${created.name} created`)}else if(editorAgentId){updateAgent(editorAgentId,values);notify(`${values.name} updated`)}setEditorAgentId(null)};
  const removeAgent=()=>{if(!editorAgentId||editorAgentId==='new')return;const remaining=agents.filter((agent)=>agent.id!==editorAgentId);const removed=getAgentById(editorAgentId);deleteAgent(editorAgentId);if(activeAgentId===editorAgentId)setActiveAgentId(remaining[0]?.id??'');setEditorAgentId(null);notify(`${removed?.name??'Agent'} deleted`)};
  const openTask=(task:Task)=>{selectAgent(task.agentId);notify(`${task.title} opened`)};
  const moveTask=(taskId:string,status:TaskStatus)=>{const task=allTasks.find((item)=>item.id===taskId);setAllTasks((current)=>current.map((item)=>item.id===taskId?{...item,status}:item));if(task)notify(`${task.title} moved to ${status}`)};
  const newTask=()=>{if(!activeAgent){setEditorAgentId('new');notify(locale==='pt-BR'?'Crie um agente antes de adicionar uma tarefa':'Create an agent before adding a task');return}const task:Task={id:`task-${Date.now().toString(36)}`,title:locale==='pt-BR'?'Tarefa sem título':'Untitled task',description:locale==='pt-BR'?'Nova tarefa do workspace.':'New workspace task.',agentId:activeAgent.id,workspaceId:currentWorkspaceId,status:'research',metadata:locale==='pt-BR'?'Nova':'New',createdAt:new Date().toISOString()};setAllTasks((current)=>[task,...current]);navigate('board');notify(locale==='pt-BR'?'Nova tarefa adicionada':'New task added')};
  const newSession=()=>{if(!activeAgent){setEditorAgentId('new');notify(locale==='pt-BR'?'Crie um agente antes de iniciar uma sessão':'Create an agent before starting a session');return}const session=createSession(activeAgent.id);setPanelOpen(true);notify(locale==='pt-BR'?`${session.title} criada`:`${session.title} created`)};
  const addCanvasNode=(kind:Parameters<typeof addNode>[0])=>{addNode(kind);navigate('canvas');notify(`${kind==='note'?'Note':'Image'} added to Canvas`)};
  const workspaceSessions=sessions.filter((session)=>agents.some((agent)=>agent.id===session.agentId));
  useEffect(()=>{if(!agents.some((agent)=>agent.id===activeAgentId))setActiveAgentId(agents[0]?.id??'');setEditorAgentId(null)},[currentWorkspaceId,allAgents]);
  useEffect(()=>{const key=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();setCommandOpen(true)}};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key)},[]);
  const content=page==='board'?<Board tasks={workspaceTasks} onOpenTask={openTask} onMoveTask={moveTask} onToast={notify}/>:page==='canvas'?<Canvas onToast={notify} onAskAgent={(nodeIds)=>{if(!activeAgent)return;attachNodesToAgent(activeAgent.id,nodeIds);setPanelOpen(true);notify(`${nodeIds.length} canvas object${nodeIds.length===1?'':'s'} added to ${activeAgent.name} context`)}} onSendToAgent={(nodeIds)=>{if(!activeAgent)return;attachNodesToAgent(activeAgent.id,nodeIds);setPanelOpen(true);notify(`${nodeIds.length} canvas object${nodeIds.length===1?'':'s'} sent to ${activeAgent.name}`)}}/>:page==='agents'?<Agents agents={agents} onSelect={editAgent} onCreate={()=>setEditorAgentId('new')}/>:page==='agent-settings'&&activeAgent?<AgentSettings agent={activeAgent} onBack={()=>navigate('agents')} onEdit={()=>editAgent(activeAgent.id)}/>:page==='sessions'?<Sessions activeAgentId={activeAgent?.id} onActivateAgent={(id)=>selectAgent(id)} onToast={notify}/>:page==='settings'?<Settings/>:<Home tasks={workspaceTasks} onOpenTask={openTask}/>;
  return <><AppShell page={page} agents={agents} activeAgent={activeAgent} panelOpen={panelOpen} onNavigate={navigate} onSelectAgent={(id)=>selectAgent(id)} onEditAgent={editAgent} onTogglePanel={()=>setPanelOpen((open)=>!open)} onOpenCommand={()=>setCommandOpen(true)} onToast={notify}>{content}</AppShell><CommandPalette agents={agents} tasks={workspaceTasks} sessions={workspaceSessions} workspaces={workspaces} currentWorkspaceId={currentWorkspaceId} open={commandOpen} onClose={()=>setCommandOpen(false)} onNavigate={navigate} onNewAgent={()=>setEditorAgentId('new')} onNewTask={newTask} onNewSession={newSession} onAddNode={addCanvasNode} onOpenAgent={(id)=>selectAgent(id)} onOpenTask={(task)=>{navigate('board');openTask(task)}} onOpenSession={(agentId,sessionId)=>{openSession(agentId,sessionId);selectAgent(agentId);navigate('sessions')}} onSwitchWorkspace={(workspaceId)=>{setCurrentWorkspaceId(workspaceId);notify(`${workspaces.find((workspace)=>workspace.id===workspaceId)?.name??'Workspace'} opened`)}}/>{editorAgentId&&<AgentEditorDrawer agent={editorAgent} onClose={()=>setEditorAgentId(null)} onSave={saveAgent} onDelete={editorAgentId==='new'?undefined:removeAgent}/>} {toast&&<div className="toast">{toast}</div>}</>;
}

declare global { interface Window { __mainsToast:number } }
