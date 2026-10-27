import { useEffect, useState } from 'react';
import type { PageId } from '../../app/types';
import type { Agent } from '../../features/agents/model/Agent';
import { Icon, type IconName } from '../common/Icon';
import { AgentList } from '../agents/AgentList';
import { routes } from '../../app/routes';
import { useLanguage } from '../../app/LanguageProvider';
import { usePersistentState } from '../../data/localPersistence';
import { useProviderUsage, usageProviderKey } from '../../features/usage/useProviderUsage';
import type { UsageProvider } from '../../features/usage/usageLedger';
import { BrandMark } from '../common/BrandMark';
import '../../styles/ux-flow.css';

interface SidebarProps { currentPage:PageId; agents:readonly Agent[]; onNavigate:(page:PageId)=>void; onSelectAgent:(agentId:string)=>void; onClose:()=>void; onOpenCommand:()=>void }
// Grouped by intent and ordered as the work flows: start, produce, schedule, then the supporting tools.
const primary:[PageId,IconName,string][]=[['home','home','Home'],['content','script','Content Studio']];
const tools:[PageId,IconName,string][]=[['board','board','Board'],['flow','link','Flow'],['canvas','canvas','Canvas']];
const workspace:[PageId,IconName,string][]=[['agents','users','Agents'],['scopes','folder','Scopes'],['sessions','history','History']];
/** One line on what each area is for, shown in the item's tooltip. */
const navHints:Record<string,[string,string]>={
  home:['o que precisa de você e o que está em produção','what needs you and what is in production'],
  content:['da pauta ao roteiro e às entregas','from idea to script and deliveries'],
  calendar:['datas e redes de cada publicação','dates and channels for each post'],
  board:['tarefas avulsas por status','standalone tasks by status'],
  flow:['a ordem das etapas e quem faz cada uma','the order of stages and who does each one'],
  canvas:['blocos livres para organizar ideias','free-form blocks to organize ideas'],
  agents:['os especialistas da equipe','your team of specialists'],
  scopes:['agentes reunidos por trabalho','agents grouped by piece of work'],
  sessions:['todas as conversas, por escopo','every conversation, by scope'],
};
const navTitle=(key:string,label:string,pt:boolean)=>navHints[key]?`${label}: ${navHints[key][pt?0:1]}`:label;

function NavButton({page,icon,label,currentPage,onNavigate,badge,isActive}:{page:PageId;icon:IconName;label:string;currentPage:PageId;onNavigate:(page:PageId)=>void;badge?:string;isActive?:boolean}) {
  const {locale}=useLanguage();
  const active = isActive ?? routes[currentPage].sidebarPage === page;
  return <a href={`#${page}`} data-od-id={`nav-${page}`} className={`nav-item ${active?'active':''}`} aria-label={label} title={navTitle(page,label,locale==='pt-BR')} aria-current={active?'page':undefined} onClick={(event)=>{event.preventDefault();window.dispatchEvent(new CustomEvent('mainsagents:nav',{detail:page}));onNavigate(page)}}><Icon name={icon}/><span>{label}</span>{badge&&<span className="badge">{badge}</span>}</a>;
}

/** Provider mark drawn here (not a brand logo): Claude a warm burst, Codex a terminal prompt. */
export function ProviderGlyph({provider}:{provider:UsageProvider}) {
  return provider==='claude'
    ?<path d="M12 6.5v11M6.5 12h11M8.1 8.1l7.8 7.8M15.9 8.1l-7.8 7.8"/>
    :<path d="M7.5 9l3 3-3 3M12.5 15h4"/>;
}

function ProviderMeter({provider,percent,active,onOpen,pt}:{provider:UsageProvider;percent:number|null;active:boolean;onOpen:()=>void;pt:boolean}) {
  const name=provider==='claude'?'Claude':'Codex',circumference=2*Math.PI*10;
  const label=percent==null?(pt?`Uso do ${name}: sem dados ainda`:`${name} usage: no data yet`):(pt?`Uso do ${name}: ${percent}% da janela de 5 horas`:`${name} usage: ${percent}% of the 5-hour window`);
  return <a href="#usage" data-od-id={`nav-usage-${provider}`} className={`nav-item provider-meter provider-${provider} ${active?'active':''}`} aria-current={active?'page':undefined} aria-label={label} title={label} onClick={event=>{event.preventDefault();onOpen()}}>
    <svg viewBox="0 0 24 24" aria-hidden="true" className="provider-meter-ring">
      <circle cx="12" cy="12" r="10" className="track"/>
      {percent!=null&&<circle cx="12" cy="12" r="10" className="value" strokeDasharray={`${(circumference*percent/100).toFixed(1)} ${circumference.toFixed(1)}`} transform="rotate(-90 12 12)"/>}
      <g className="glyph"><ProviderGlyph provider={provider}/></g>
    </svg>
    <span>{name}</span><b>{percent==null?'—':`${percent}%`}</b>
  </a>;
}

function SidebarUsage({connected,currentPage,onNavigate}:{connected:boolean;currentPage:PageId;onNavigate:(page:PageId)=>void}) {
  const {locale}=useLanguage(),pt=locale==='pt-BR';
  const [selected,setSelected]=usePersistentState<UsageProvider>(usageProviderKey,'codex');
  const claude=useProviderUsage('claude',{intervalMs:60_000}),codex=useProviderUsage('codex',{enabled:connected});
  const percent=(value?:number|null)=>value==null?null:Math.max(0,Math.min(100,Math.round(value)));
  const open=(provider:UsageProvider)=>{setSelected(provider);onNavigate('usage')};
  return <nav className="sidebar-usage" aria-label={pt?'Uso dos provedores':'Provider usage'}>
    <ProviderMeter provider="claude" pt={pt} percent={percent(claude.usage?.fiveHours?.usedPercent)} active={currentPage==='usage'&&selected==='claude'} onOpen={()=>open('claude')}/>
    <ProviderMeter provider="codex" pt={pt} percent={connected?percent(codex.usage?.fiveHours?.usedPercent):null} active={currentPage==='usage'&&selected==='codex'} onOpen={()=>open('codex')}/>
  </nav>;
}

export function Sidebar({currentPage,agents,onNavigate,onSelectAgent,onClose,onOpenCommand}:SidebarProps) {
  const {t,locale}=useLanguage(),pt=locale==='pt-BR';
  const [width,setWidth]=usePersistentState<number>('sidebar-width',244);
  const [studioView,setStudioView]=usePersistentState<'studio'|'calendar'>('studio-view','studio');
  const [connected,setConnected]=useState(false),[executorReady,setExecutorReady]=useState<boolean|null>(null);
  useEffect(()=>{document.documentElement.style.setProperty('--sidebar-w',`${width}px`)},[width]);
  useEffect(()=>{let mounted=true;const check=async()=>{try{const response=await fetch('/api/codex/health',{cache:'no-store'});const data=await response.json();if(mounted)setConnected(response.ok&&data.ready===true)}catch{if(mounted)setConnected(false)}};void check();const timer=window.setInterval(()=>void check(),30_000);return()=>{mounted=false;window.clearInterval(timer)}},[]);
  // Signed in is not the same as able to run commands; the bridge reuses a recent successful sandbox probe.
  useEffect(()=>{if(!connected){setExecutorReady(null);return}let mounted=true;const check=async()=>{try{const response=await fetch('/api/codex/executor',{cache:'no-store'});const data=await response.json();if(mounted)setExecutorReady(response.ok?data.ready===true:null)}catch{if(mounted)setExecutorReady(null)}};void check();const timer=window.setInterval(()=>void check(),300_000);return()=>{mounted=false;window.clearInterval(timer)}},[connected]);
  const executorBlocked=connected&&executorReady===false,connectionLabel=executorBlocked?(locale==='pt-BR'?'Codex conectado · executor local indisponível':'Codex connected · local executor unavailable'):t(connected?'Codex connected':'Codex disconnected');
  return <aside className="sidebar" id="workspace-navigation" data-od-id="workspace-navigation" aria-label={locale==='pt-BR'?'Navegação principal':'Main navigation'}>
    <div className="brand"><span className="brand-mark"><BrandMark body="#f3f4f6" eye="#121317"/></span><span>Mains<span className="brand-light">Agents</span></span><button className="icon-button mobile-nav-close" aria-label={locale==='pt-BR'?'Fechar navegação':'Close navigation'} onClick={onClose}><Icon name="close"/></button></div>
    <button className="sidebar-search" aria-label={t('Search')} title={t('Search')} onClick={onOpenCommand}><Icon name="search"/><span>{t('Search')}</span><kbd>Ctrl K</kbd></button>
    <div className="sidebar-scroll">
      <nav className="nav-group" aria-labelledby="nav-group-work"><p className="nav-label" id="nav-group-work">{pt?'Trabalho':'Work'}</p>{primary.map(([page,icon,label])=><NavButton key={page} {...{page,icon,label:page==='home'?(pt?'Visão geral':'Overview'):page==='content'?(pt?'Estúdio':'Studio'):t(label),currentPage,onNavigate:(next)=>{if(next==='content')setStudioView('studio');onNavigate(next)}}} isActive={page==='content'?currentPage==='content'&&studioView==='studio':undefined}/>)}<a data-od-id="nav-calendar" href="#content" className={`nav-item ${currentPage==='content'&&studioView==='calendar'?'active':''}`} aria-label={pt?'Calendário':'Calendar'} title={navTitle('calendar',pt?'Calendário':'Calendar',pt)} aria-current={currentPage==='content'&&studioView==='calendar'?'page':undefined} onClick={event=>{event.preventDefault();setStudioView('calendar');onNavigate('content')}}><Icon name="calendar"/><span>{pt?'Calendário':'Calendar'}</span></a>{tools.map(([page,icon,label])=><NavButton key={page} {...{page,icon,label:t(label),currentPage,onNavigate}}/>)}</nav>
      <nav className="nav-group" aria-labelledby="nav-group-team"><p className="nav-label" id="nav-group-team">{pt?'Equipe':'Team'}</p>{workspace.map(([page,icon,label])=><NavButton key={page} {...{page,icon,label:t(label),currentPage,onNavigate}} badge={page==='agents'?String(agents.length):undefined}/>)}</nav>
      <div className="nav-group"><p className="nav-label">{t('Agents')}</p>{agents.length?<AgentList agents={agents} compact onSelect={onSelectAgent}/>:<p className="sidebar-empty">{locale==='pt-BR'?'Sua equipe começa aqui.':'Your team starts here.'}</p>}</div>
    </div>
    <div className="sidebar-footer"><SidebarUsage connected={connected} currentPage={currentPage} onNavigate={onNavigate}/><NavButton page="settings" icon="settings" label={t('Settings')} currentPage={currentPage} onNavigate={onNavigate}/><button className={`connection ${connected&&!executorBlocked?'':'disconnected'}`} type="button" aria-label={connectionLabel} title={connectionLabel} onClick={()=>onNavigate('settings')}><i/><span>{connectionLabel}</span></button></div>
    <div className="sidebar-resize-handle" role="separator" aria-orientation="vertical" aria-label={t('Resize sidebar')} tabIndex={0} onPointerDown={(event)=>{event.currentTarget.setPointerCapture(event.pointerId);const move=(next:PointerEvent)=>setWidth(Math.max(180,Math.min(340,next.clientX/Number(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')||1))));const stop=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',stop)};window.addEventListener('pointermove',move);window.addEventListener('pointerup',stop)}} onKeyDown={(event)=>{if(event.key==='ArrowLeft')setWidth(Math.max(180,width-20));if(event.key==='ArrowRight')setWidth(Math.min(340,width+20))}}/>
  </aside>;
}
