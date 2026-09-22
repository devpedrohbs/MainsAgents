import type { PropsWithChildren } from 'react';
import type { PageId } from '../../app/types';
import type { Agent } from '../../features/agents/model/Agent';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { RightPanel } from './RightPanel';

interface AppShellProps extends PropsWithChildren { page:PageId; agents:readonly Agent[]; activeAgent?:Agent; panelOpen:boolean; onNavigate:(page:PageId)=>void; onSelectAgent:(agentId:string)=>void; onEditAgent:(agentId:string)=>void; onTogglePanel:()=>void; onOpenCommand:()=>void; onToast:(message:string)=>void }
export function AppShell({page,agents,activeAgent,panelOpen,onNavigate,onSelectAgent,onEditAgent,onTogglePanel,onOpenCommand,onToast,children}:AppShellProps) {
  const showPanel=panelOpen&&Boolean(activeAgent);
  return <div className={`app-shell ${showPanel?'':'inspector-collapsed'}`}><Sidebar currentPage={page} agents={agents} onNavigate={onNavigate} onSelectAgent={onSelectAgent}/><main className="main"><Topbar page={page} onNavigate={onNavigate} onOpenCommand={onOpenCommand} onTogglePanel={onTogglePanel}/><div className="view">{children}</div></main>{showPanel&&activeAgent&&<RightPanel agent={activeAgent} onNavigate={onNavigate} onEditAgent={onEditAgent} onToast={onToast}/>}</div>;
}
