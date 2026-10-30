import { useEffect, useState, type JSX, type ReactNode } from 'react';
import type { PageId } from '../../app/types';
import type { Agent } from '../../features/agents/model/Agent';
import { Icon } from '../common/Icon';
import { AgentAvatar } from '../agents/AgentAvatar';
import { routes } from '../../app/routes';
import { useLanguage } from '../../app/LanguageProvider';
import { usePersistentState } from '../../data/localPersistence';
import { useProviderUsage, usageProviderKey } from '../../features/usage/useProviderUsage';
import type { UsageProvider } from '../../features/usage/usageLedger';
import { useChat } from '../../features/chat/ChatProvider';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { SaveIndicator } from './SaveIndicator';
import '../../styles/ux-flow.css';

interface SidebarProps {
  currentPage:PageId; agents:readonly Agent[]; inboxCount:number; activeRuns:number; waitingAgentIds:ReadonlySet<string>;
  panelOpen:boolean; hasAgent:boolean;
  onNavigate:(page:PageId)=>void; onSelectAgent:(agentId:string)=>void; onClose:()=>void; onOpenCommand:()=>void; onCreate:()=>void; onTogglePanel:()=>void;
}
type NavGlyph='inbox'|'gauge'|'run'|'studio'|'radar'|'bookmark'|'calendar'|'board'|'canvas'|'pipeline'|'layers'|'clock'|'sliders';
/** V2 line glyphs, drawn at 16px with the sidebar's stroke weight. */
function Glyph({name}:{name:NavGlyph}) {
  const paths:Record<NavGlyph,JSX.Element>={
    inbox:<><path d="M4 13l2.5-7h11L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M4 13h4.5l1 2h5l1-2H20"/></>,
    gauge:<><path d="M4 16a8 8 0 1 1 16 0"/><path d="M12 16l4-4.5"/><circle cx="12" cy="16" r="1.2"/></>,
    run:<><circle cx="12" cy="12" r="8.5"/><path d="M10.5 9l4.5 3-4.5 3z"/></>,
    studio:<><rect x="3.5" y="8" width="17" height="11.5" rx="2"/><path d="M3.5 8l2-3.5h13l2 3.5M9.5 4.5L8 8M15.5 4.5L14 8"/></>,
    radar:<><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12l5.5-5.5"/></>,
    bookmark:<path d="M7 4h10v16l-5-3.5L7 20z"/>,
    calendar:<><rect x="4" y="5.5" width="16" height="14" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/></>,
    board:<><rect x="4" y="4.5" width="16" height="15" rx="2"/><path d="M9.5 4.5v15M14.5 4.5v15"/></>,
    canvas:<><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/><path d="M10 7h4a3 3 0 0 1 3 3v4"/></>,
    pipeline:<><circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="12" r="2"/><path d="M8 6c5 0 4 6 8 6M8 18c5 0 4-6 8-6"/></>,
    layers:<><path d="M12 4l8 4-8 4-8-4z"/><path d="M4 12l8 4 8-4M4 16l8 4 8-4"/></>,
    clock:<><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></>,
    sliders:<><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></>,
  };
  return <svg className="v2-nav-glyph" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}
/** One line on what each area is for, shown in the item's tooltip. */
const navHints:Record<string,[string,string]>={
  inbox:['tudo que espera você: aprovações, escolhas, perguntas e falhas','everything waiting on you: approvals, choices, questions and failures'],
  home:['o que está rodando, o que espera você e o que vem a seguir','what is running, what waits on you and what comes next'],
  runs:['produções em andamento, passo a passo','productions in progress, step by step'],
  content:['da pauta ao roteiro e às entregas','from idea to script and deliveries'],
  references:['vídeos que ensinam seu estilo, Meu estilo e Kit de motion','videos that teach your style, My style and Motion kit'],
  radar:['canais, notícias e métricas observadas nas coletas','channels, news, and metrics observed during collection'],
  calendar:['datas e redes de cada publicação','dates and channels for each post'],
  board:['tarefas avulsas por status','standalone tasks by status'],
  canvas:['espaços com blocos livres para organizar ideias','spaces with free-form blocks to organize ideas'],
  pipelines:['quem faz cada etapa da produção e onde ela para para você','who does each production stage and where it stops for you'],
  agents:['os especialistas da equipe','your team of specialists'],
  scopes:['agentes reunidos por trabalho','agents grouped by piece of work'],
  sessions:['todas as conversas, por escopo','every conversation, by scope'],
};
const navTitle=(key:string,label:string,pt:boolean)=>navHints[key]?`${label}: ${navHints[key][pt?0:1]}`:label;

function NavButton({page,glyph,label,currentPage,onNavigate,badge,isActive,odId}:{page:PageId;glyph:NavGlyph;label:string;currentPage:PageId;onNavigate:(page:PageId)=>void;badge?:ReactNode;isActive?:boolean;odId?:string}) {
  const {locale}=useLanguage();
  const active = isActive ?? routes[currentPage].sidebarPage === page;
  return <a href={`#${page}`} data-od-id={odId??`nav-${page}`} className={`nav-item ${active?'active':''}`} aria-label={label} title={navTitle(odId?.replace('nav-','')??page,label,locale==='pt-BR')} aria-current={active?'page':undefined} onClick={(event)=>{event.preventDefault();window.dispatchEvent(new CustomEvent('mainsagents:nav',{detail:page}));onNavigate(page)}}><Glyph name={glyph}/><span>{label}</span>{badge}</a>;
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

/** Team rows: avatar with a state dot, name, and a short status only when it matters (working or waiting on you). */
function SidebarTeam({agents,waitingAgentIds,onSelectAgent,pt}:{agents:readonly Agent[];waitingAgentIds:ReadonlySet<string>;onSelectAgent:(id:string)=>void;pt:boolean}) {
  const {sessions,getRunState}=useChat();
  const busy=(agent:Agent)=>agent.status==='working'||sessions.some(session=>session.agentId===agent.id&&['thinking','searching','using-tool'].includes(getRunState(session.id)));
  return <div className="v2-team-list">{agents.map(agent=>{
    const state=busy(agent)?'running':waitingAgentIds.has(agent.id)?'waiting':'idle';
    const note=state==='running'?(pt?'trabalhando':'working'):state==='waiting'?(pt?'espera você':'waits on you'):'';
    return <button key={agent.id} type="button" className="nav-item agent-nav" data-state={state} title={agent.name} aria-label={note?`${agent.name}, ${note}`:agent.name} onClick={()=>onSelectAgent(agent.id)}>
      <span className="v2-team-avatar"><AgentAvatar name={agent.name} image={agent.avatarImage} mascot={agent.avatarMascot} role={agent.role} thinking={state==='running'}/><i aria-hidden="true"/></span>
      <span className="v2-ellipsis">{agent.name}</span>{note&&<small>{note}</small>}
    </button>;
  })}</div>;
}

export function Sidebar({currentPage,agents,inboxCount,activeRuns,waitingAgentIds,panelOpen,hasAgent,onNavigate,onSelectAgent,onClose,onOpenCommand,onCreate,onTogglePanel}:SidebarProps) {
  const {t,locale,appearance,setAppearance}=useLanguage(),pt=locale==='pt-BR';
  const [width,setWidth]=usePersistentState<number>('sidebar-width',220);
  const [studioView,setStudioView]=usePersistentState<'studio'|'calendar'>('studio-view','studio');
  const [connected,setConnected]=useState(false),[executorReady,setExecutorReady]=useState<boolean|null>(null);
  useEffect(()=>{document.documentElement.style.setProperty('--sidebar-w',`${width}px`)},[width]);
  useEffect(()=>{let mounted=true;const check=async()=>{try{const response=await fetch('/api/codex/health',{cache:'no-store'});const data=await response.json();if(mounted)setConnected(response.ok&&data.ready===true)}catch{if(mounted)setConnected(false)}};void check();const timer=window.setInterval(()=>void check(),30_000);return()=>{mounted=false;window.clearInterval(timer)}},[]);
  // Signed in is not the same as able to run commands; the bridge reuses a recent successful sandbox probe.
  useEffect(()=>{if(!connected){setExecutorReady(null);return}let mounted=true;const check=async()=>{try{const response=await fetch('/api/codex/executor',{cache:'no-store'});const data=await response.json();if(mounted)setExecutorReady(response.ok?data.ready===true:null)}catch{if(mounted)setExecutorReady(null)}};void check();const timer=window.setInterval(()=>void check(),300_000);return()=>{mounted=false;window.clearInterval(timer)}},[connected]);
  const executorBlocked=connected&&executorReady===false,connectionLabel=executorBlocked?(pt?'Codex conectado · executor local indisponível':'Codex connected · local executor unavailable'):t(connected?'Codex connected':'Codex disconnected');
  const openStudio=(view:'studio'|'calendar')=>{setStudioView(view);onNavigate('content')};
  const studioActive=currentPage==='content'&&studioView==='studio',calendarActive=currentPage==='content'&&studioView==='calendar';
  return <aside className="sidebar v2-sidebar" id="workspace-navigation" data-od-id="workspace-navigation" aria-label={pt?'Navegação principal':'Main navigation'}>
    <div className="v2-sidebar-head">
      <WorkspaceSwitcher/>
      <button type="button" className="icon-button global-create" aria-label={pt?'Criar':'Create'} title={pt?'Criar · C':'Create · C'} onClick={onCreate}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h8"/><path d="M16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1 1-4z"/></svg></button>
      <button className="icon-button mobile-nav-close" aria-label={pt?'Fechar navegação':'Close navigation'} onClick={onClose}><Icon name="close"/></button>
    </div>
    <div className="v2-sidebar-tools">
      <button className="sidebar-search" data-od-id="global-search" aria-label={pt?'Buscar ou executar':'Search or run'} title={pt?'Buscar ou executar':'Search or run'} onClick={onOpenCommand}><Icon name="search"/><span>{pt?'Buscar ou executar':'Search or run'}</span><kbd>Ctrl K</kbd></button>
      <button type="button" className="icon-button chat-toggle" data-od-id="toggle-chat" aria-pressed={panelOpen} disabled={!hasAgent} aria-label={t('Toggle chat panel')} title={hasAgent?t('Toggle chat panel'):(pt?'Crie um agente para conversar':'Create an agent to start chatting')} onClick={onTogglePanel}><Icon name="message"/></button>
    </div>
    <div className="sidebar-scroll">
      <nav className="nav-group" aria-label={pt?'Atenção':'Attention'} data-group="attention">
        <NavButton page="inbox" glyph="inbox" label={pt?'Caixa de entrada':'Inbox'} currentPage={currentPage} onNavigate={onNavigate} badge={inboxCount>0&&<span className="badge v2-badge-waiting">{inboxCount}</span>}/>
        <NavButton page="home" glyph="gauge" label="Mission Control" currentPage={currentPage} onNavigate={onNavigate}/>
        <NavButton page="runs" glyph="run" label={pt?'Execuções':'Runs'} currentPage={currentPage} onNavigate={onNavigate} badge={activeRuns>0&&<span className="badge v2-badge-running"><i aria-hidden="true"/>{activeRuns}</span>}/>
      </nav>
      <nav className="nav-group" aria-labelledby="nav-group-work"><p className="nav-label" id="nav-group-work">{pt?'Conteúdo':'Content'}</p>
        <NavButton page="content" glyph="studio" label={pt?'Estúdio':'Studio'} currentPage={currentPage} isActive={studioActive} onNavigate={()=>openStudio('studio')}/>
        <NavButton page="radar" glyph="radar" label="Radar" currentPage={currentPage} onNavigate={onNavigate}/>
        <NavButton page="references" glyph="bookmark" label={pt?'Referências':'References'} currentPage={currentPage} onNavigate={onNavigate}/>
        <NavButton page="content" odId="nav-calendar" glyph="calendar" label={pt?'Calendário':'Calendar'} currentPage={currentPage} isActive={calendarActive} onNavigate={()=>openStudio('calendar')}/>
      </nav>
      <nav className="nav-group" aria-labelledby="nav-group-workspace"><p className="nav-label" id="nav-group-workspace">Workspace</p>
        <NavButton page="board" glyph="board" label={t('Board')} currentPage={currentPage} onNavigate={onNavigate}/>
        <NavButton page="canvas" glyph="canvas" label="Canvas" currentPage={currentPage} onNavigate={onNavigate}/>
        <NavButton page="pipelines" glyph="pipeline" label="Pipelines" currentPage={currentPage} onNavigate={onNavigate}/>
        <NavButton page="scopes" glyph="layers" label={t('Scopes')} currentPage={currentPage} onNavigate={onNavigate}/>
        <NavButton page="sessions" glyph="clock" label={t('History')} currentPage={currentPage} onNavigate={onNavigate}/>
      </nav>
      <div className="nav-group" aria-labelledby="nav-group-team">
        <div className="v2-team-head"><p className="nav-label" id="nav-group-team">{pt?'Equipe':'Team'}</p><a href="#agents" data-od-id="nav-agents" className={routes[currentPage].sidebarPage==='agents'?'active':''} aria-current={routes[currentPage].sidebarPage==='agents'?'page':undefined} onClick={event=>{event.preventDefault();onNavigate('agents')}}>{pt?'Ver todos':'View all'}</a></div>
        {agents.length?<SidebarTeam agents={agents} waitingAgentIds={waitingAgentIds} onSelectAgent={onSelectAgent} pt={pt}/>:<p className="sidebar-empty">{pt?'Sua equipe começa aqui.':'Your team starts here.'}</p>}
      </div>
    </div>
    <div className="sidebar-footer">
      <SidebarUsage connected={connected} currentPage={currentPage} onNavigate={onNavigate}/>
      <NavButton page="settings" glyph="sliders" label={t('Settings')} currentPage={currentPage} onNavigate={onNavigate}/>
      <div className="v2-sidebar-status">
        <button className={`connection ${connected&&!executorBlocked?'':'disconnected'}`} type="button" aria-label={connectionLabel} title={connectionLabel} onClick={()=>onNavigate('settings')}><i/><span>{connectionLabel}</span></button>
        <SaveIndicator/>
        <div className="precision-theme-picker" role="group" aria-label={pt?'Aparência':'Appearance'}><button type="button" aria-pressed={appearance==='light'} onClick={()=>setAppearance('light')}>{pt?'Claro':'Light'}</button><button type="button" aria-pressed={appearance==='dark'} onClick={()=>setAppearance('dark')}>{pt?'Escuro':'Dark'}</button></div>
      </div>
    </div>
    <div className="sidebar-resize-handle" role="separator" aria-orientation="vertical" aria-label={t('Resize sidebar')} tabIndex={0} onPointerDown={(event)=>{event.currentTarget.setPointerCapture(event.pointerId);const move=(next:PointerEvent)=>setWidth(Math.max(180,Math.min(340,next.clientX/Number(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')||1))));const stop=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',stop)};window.addEventListener('pointermove',move);window.addEventListener('pointerup',stop)}} onKeyDown={(event)=>{if(event.key==='ArrowLeft')setWidth(Math.max(180,width-20));if(event.key==='ArrowRight')setWidth(Math.min(340,width+20))}}/>
  </aside>;
}
