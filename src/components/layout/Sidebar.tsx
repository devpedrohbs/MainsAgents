import { useEffect, useState } from 'react';
import type { PageId } from '../../app/types';
import type { Agent } from '../../features/agents/model/Agent';
import { Icon, type IconName } from '../common/Icon';
import { AgentList } from '../agents/AgentList';
import { routes } from '../../app/routes';
import { useLanguage } from '../../app/LanguageProvider';
import { usePersistentState } from '../../data/localPersistence';

interface SidebarProps { currentPage:PageId; agents:readonly Agent[]; onNavigate:(page:PageId)=>void; onSelectAgent:(agentId:string)=>void; onClose:()=>void; onOpenCommand:()=>void }
const primary:[PageId,IconName,string][]=[['home','home','Home'],['content','script','Content Studio'],['board','board','Board'],['canvas','canvas','Canvas']];
const workspace:[PageId,IconName,string][]=[['agents','users','Agents'],['sessions','history','Sessions']];

function NavButton({page,icon,label,currentPage,onNavigate,badge}:{page:PageId;icon:IconName;label:string;currentPage:PageId;onNavigate:(page:PageId)=>void;badge?:string}) {
  const active = routes[currentPage].sidebarPage === page;
  return <a href={`#${page}`} className={`nav-item ${active?'active':''}`} aria-label={label} title={label} aria-current={active?'page':undefined} onClick={(event)=>{event.preventDefault();onNavigate(page)}}><Icon name={icon}/><span>{label}</span>{badge&&<span className="badge">{badge}</span>}</a>;
}

export function Sidebar({currentPage,agents,onNavigate,onSelectAgent,onClose,onOpenCommand}:SidebarProps) {
  const {t,locale}=useLanguage();
  const [width,setWidth]=usePersistentState<number>('sidebar-width',224);
  const [connected,setConnected]=useState(false);
  useEffect(()=>{document.documentElement.style.setProperty('--sidebar-w',`${width}px`)},[width]);
  useEffect(()=>{let mounted=true;const check=async()=>{try{const response=await fetch('/api/codex/health',{cache:'no-store'});const data=await response.json();if(mounted)setConnected(response.ok&&data.ready===true)}catch{if(mounted)setConnected(false)}};void check();const timer=window.setInterval(()=>void check(),30_000);return()=>{mounted=false;window.clearInterval(timer)}},[]);
  return <aside className="sidebar" id="workspace-navigation" data-od-id="workspace-navigation" aria-label={locale==='pt-BR'?'Navegação principal':'Main navigation'}>
    <div className="brand"><span className="brand-mark"><img src="/images/brand/mainsagents-appicon-black.png" alt=""/></span><span>Mains<span className="brand-light">Agents</span></span><button className="icon-button mobile-nav-close" aria-label={locale==='pt-BR'?'Fechar navegação':'Close navigation'} onClick={onClose}><Icon name="close"/></button></div>
    <button className="sidebar-search" aria-label={t('Search')} title={t('Search')} onClick={onOpenCommand}><Icon name="search"/><span>{t('Search')}</span><kbd>Ctrl K</kbd></button>
    <div className="sidebar-scroll">
      <nav className="nav-group">{primary.map(([page,icon,label])=><NavButton key={page} {...{page,icon,label:page==='home'?(locale==='pt-BR'?'Visão geral':'Overview'):page==='content'?(locale==='pt-BR'?'Conteúdo':'Content'):t(label),currentPage,onNavigate}}/>)}</nav>
      <div className="nav-group"><p className="nav-label">{t('Workspace')}</p>{workspace.map(([page,icon,label])=><NavButton key={page} {...{page,icon,label:page==='home'?(locale==='pt-BR'?'Visão geral':'Overview'):t(label),currentPage,onNavigate}} badge={page==='agents'?String(agents.length):undefined}/>)}</div>
      <div className="nav-group"><p className="nav-label">{t('Agents')}</p>{agents.length?<AgentList agents={agents} compact onSelect={onSelectAgent}/>:<p className="sidebar-empty">{locale==='pt-BR'?'Sua equipe começa aqui.':'Your team starts here.'}</p>}</div>
    </div>
    <div className="sidebar-footer"><NavButton page="settings" icon="settings" label={t('Settings')} currentPage={currentPage} onNavigate={onNavigate}/><button className={`connection ${connected?'':'disconnected'}`} type="button" aria-label={t(connected?'Codex connected':'Codex disconnected')} title={t(connected?'Codex connected':'Codex disconnected')} onClick={()=>onNavigate('settings')}><i/><span>{t(connected?'Codex connected':'Codex disconnected')}</span></button></div>
    <div className="sidebar-resize-handle" role="separator" aria-orientation="vertical" aria-label={t('Resize sidebar')} tabIndex={0} onPointerDown={(event)=>{event.currentTarget.setPointerCapture(event.pointerId);const move=(next:PointerEvent)=>setWidth(Math.max(180,Math.min(340,next.clientX/Number(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')||1))));const stop=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',stop)};window.addEventListener('pointermove',move);window.addEventListener('pointerup',stop)}} onKeyDown={(event)=>{if(event.key==='ArrowLeft')setWidth(Math.max(180,width-20));if(event.key==='ArrowRight')setWidth(Math.min(340,width+20))}}/>
  </aside>;
}
