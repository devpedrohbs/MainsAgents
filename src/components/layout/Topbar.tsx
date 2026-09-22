import type { PageId } from '../../app/types';
import { Icon } from '../common/Icon';
import { Breadcrumbs } from './Breadcrumbs';

interface TopbarProps { page:PageId; onNavigate:(page:PageId)=>void; onOpenCommand:()=>void; onTogglePanel:()=>void }

export function Topbar({page,onNavigate,onOpenCommand,onTogglePanel}:TopbarProps) {
  return <header className="topbar"><Breadcrumbs page={page} onNavigate={onNavigate}/><div className="top-actions"><button className="soft-button" onClick={onOpenCommand}><Icon name="search"/>Search <span className="kbd">Ctrl K</span></button><button className="icon-button" onClick={onTogglePanel} aria-label="Alternar painel lateral"><Icon name="panel"/></button><button className="primary-button" onClick={onOpenCommand}><Icon name="plus"/>New</button><button className="icon-button" aria-label="Perfil"><span style={{font:'9px var(--mono)'}}>PA</span></button></div></header>;
}
