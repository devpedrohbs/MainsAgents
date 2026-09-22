import type { PageId } from '../../app/types';
import type { Agent } from '../../features/agents/model/Agent';
import { Icon, type IconName } from '../common/Icon';
import { AgentList } from '../agents/AgentList';
import { routes } from '../../app/routes';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

interface SidebarProps { currentPage:PageId; agents:readonly Agent[]; onNavigate:(page:PageId)=>void; onSelectAgent:(agentId:string)=>void }
const primary:[PageId,IconName,string][]=[['home','home','Home'],['board','board','Board'],['canvas','canvas','Canvas']];
const workspace:[PageId,IconName,string][]=[['agents','users','Agents'],['sessions','history','Sessions']];

function NavButton({page,icon,label,currentPage,onNavigate,badge}:{page:PageId;icon:IconName;label:string;currentPage:PageId;onNavigate:(page:PageId)=>void;badge?:string}) {
  const active = routes[currentPage].sidebarPage === page;
  return <a href={`#${page}`} className={`nav-item ${active?'active':''}`} aria-current={active?'page':undefined} onClick={(event)=>{event.preventDefault();onNavigate(page)}}><Icon name={icon}/><span>{label}</span>{badge&&<span className="badge">{badge}</span>}</a>;
}

export function Sidebar({currentPage,agents,onNavigate,onSelectAgent}:SidebarProps) {
  return <aside className="sidebar">
    <div className="brand"><span className="brand-mark"/><span>MainsAgents</span></div>
    <WorkspaceSwitcher/>
    <div className="sidebar-scroll">
      <nav className="nav-group">{primary.map(([page,icon,label])=><NavButton key={page} {...{page,icon,label,currentPage,onNavigate}}/>)}</nav>
      <div className="nav-group"><p className="nav-label">Workspace</p>{workspace.map(([page,icon,label])=><NavButton key={page} {...{page,icon,label,currentPage,onNavigate}} badge={page==='agents'?String(agents.length):undefined}/>)}</div>
      <div className="nav-group"><p className="nav-label">Agents</p><AgentList agents={agents} compact onSelect={onSelectAgent}/></div>
    </div>
    <div className="sidebar-footer"><NavButton page="settings" icon="settings" label="Settings" currentPage={currentPage} onNavigate={onNavigate}/><div className="connection"><i/><span>Codex connected</span></div></div>
  </aside>;
}
