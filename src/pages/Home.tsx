import type { Task } from '../app/types';
import { useAgents } from '../features/agents/AgentsProvider';
import { getAgentInitials } from '../features/agents/model/Agent';
import { AgentStatus } from '../components/agents/AgentStatus';
import { Icon } from '../components/common/Icon';
import { useWorkspaces } from '../app/WorkspaceProvider';

export function Home({tasks,onOpenTask}:{tasks:Task[];onOpenTask:(task:Task)=>void}) {
  const {agents:allAgents,getAgentById}=useAgents();
  const {currentWorkspaceId}=useWorkspaces();
  const agents=allAgents.filter((agent)=>agent.workspaceId===currentWorkspaceId);
  const fallback=agents[0];
  const workingTasks=tasks.filter((task)=>task.status==='research'||task.status==='running').sort(byNewest);
  const attentionTasks=tasks.filter((task)=>task.status==='review').sort(byNewest);
  const completedTasks=tasks.filter((task)=>task.status==='done').sort(byNewest);
  const activityRow=(task:Task)=>{const agent=getAgentById(task.agentId) ?? fallback;if(!agent)return null;return <button key={task.id} className="activity-row" onClick={()=>onOpenTask(task)}><span className="agent-monogram">{getAgentInitials(agent)}</span><span className="activity-agent"><b>{agent.name}</b><span>{agent.role}</span></span><span className="activity-title"><b>{task.title}</b><span>{task.metadata}</span></span><AgentStatus status={task.status}/><span className="time">{formatRelative(task.createdAt)}</span></button>};
  return <div className="page mission-control"><div className="page-head"><div><p className="eyebrow">{formatToday()}</p><h1>Mission Control</h1><p>See what is moving, where attention is needed, and what your agents delivered.</p></div></div><div className="mission-strip" aria-label="Workspace status"><div className="mission-stat"><i/><span><strong>{agents.filter((agent)=>agent.status==='working').length}</strong> agents working</span></div><div className="mission-stat attention"><i/><span><strong>{agents.filter((agent)=>agent.status==='review').length}</strong> needs your attention</span></div><div className="mission-stat done"><i/><span><strong>{completedTasks.length}</strong> tasks completed today</span></div></div><section className="section"><div className="section-title"><h2>Working now</h2><span>{workingTasks.length} active tasks</span></div><div className="activity-list">{workingTasks.map(activityRow)}</div></section>{attentionTasks.length>0&&<section className="section attention-section"><div className="section-title"><h2>Needs your attention</h2><span>{attentionTasks.length} {attentionTasks.length===1?'item':'items'}</span></div><div className="attention-list">{attentionTasks.map((task)=>{const agent=getAgentById(task.agentId)??fallback;return <div className="attention-row" key={task.id}><div className="attention-icon"><Icon name="spark"/></div><div className="attention-copy"><b>{task.title}</b><span>{agent?.name??'Agent'} · {task.metadata}</span></div><button className="soft-button" onClick={()=>onOpenTask(task)}>Review <Icon name="chevron"/></button></div>})}</div></section>}<section className="section"><div className="section-title"><h2>Recently completed</h2><span>{completedTasks.length} delivered today</span></div><div className="activity-list">{completedTasks.map(activityRow)}</div></section></div>;
}

function byNewest(a:Task,b:Task):number { return b.createdAt.localeCompare(a.createdAt); }
function formatRelative(value:string):string { const minutes=Math.max(1,Math.round((Date.now()-new Date(value).getTime())/60000));return minutes<60?`${minutes}m`:`${Math.round(minutes/60)}h`; }
function formatToday():string { return new Intl.DateTimeFormat('en',{weekday:'long',month:'short',day:'numeric'}).format(new Date()).toUpperCase(); }
