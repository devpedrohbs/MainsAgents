import { useEffect, useRef, useState } from 'react';
import { type Agent, agentToolDetails } from '../../features/agents/model/Agent';
import { useLanguage } from '../../app/LanguageProvider';
import { AgentAvatar } from './AgentAvatar';
import { AgentStatus } from './AgentStatus';
import { Icon } from '../common/Icon';
import { useProduction } from '../../features/production/ProductionProvider';
import { useChat } from '../../features/chat/ChatProvider';
import { executionOverview } from '../production/ExecutionOverviewProjection';
import { executionRunState, runLabel, shortAgo } from '../../features/inbox/inbox';
import { selectRun } from '../../features/inbox/runSelection';
import { StatusIcon } from '../common/StatusIcon';

/** V2 "Últimas execuções": production runs this agent takes part in, and its latest chats. Read-only. */
function AgentRecentWork({agent,pt}:{agent:Agent;pt:boolean}) {
  const {runs}=useProduction();
  const {sessions,openSession}=useChat();
  const locale=pt?'pt-BR':'en-US';
  const mine=runs.filter(run=>run.workspaceId===agent.workspaceId&&[run.sourceAgent?.id,run.editorAgent?.id,run.publisherAgent?.id].includes(agent.id));
  const items=executionOverview(mine,agent.workspaceId,pt).slice(0,6);
  const chats=sessions.filter(session=>session.agentId===agent.id).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,5);
  const openRun=(id:string)=>{selectRun(agent.workspaceId,id);window.location.hash='runs';};
  return <div className="agent-recent-work">
    <h3>{pt?'Últimas execuções':'Latest runs'}</h3>
    {items.length?<ul>{items.map(item=><li key={item.id}><button type="button" onClick={()=>openRun(item.id)}><StatusIcon size={12} state={executionRunState[item.state]}/><span className="v2-mono">{runLabel(item.id)}</span><span className="v2-ellipsis">{item.name}</span><span className="v2-sub">{shortAgo(item.updatedAt,locale)}</span></button></li>)}</ul>:<p>{pt?'Nenhuma execução de produção com este agente.':'No production run with this agent.'}</p>}
    <h3>{pt?'Conversas recentes':'Recent chats'}</h3>
    {chats.length?<ul>{chats.map(session=><li key={session.id}><button type="button" onClick={()=>openSession(agent.id,session.id)}><Icon name="message"/><span className="v2-ellipsis">{session.title}</span><span className="v2-sub">{shortAgo(session.updatedAt,locale)}</span></button></li>)}</ul>:<p>{pt?'Nenhuma conversa ainda.':'No chats yet.'}</p>}
  </div>;
}

export function AgentDetails({agent,workspaceName,onClose,onChat,onConfigure}:{agent:Agent;workspaceName:string;onClose:()=>void;onChat:()=>void;onConfigure:()=>void}) {
  const {locale,t}=useLanguage();
  const pt=locale==='pt-BR';
  const [tab,setTab]=useState<'summary'|'tools'|'skills'|'runs'>('summary');
  const closeRef=useRef<HTMLButtonElement>(null);
  const closeAction=useRef(onClose);
  closeAction.current=onClose;
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    closeRef.current?.focus({preventScroll:true});
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeAction.current();}};
    document.addEventListener('keydown',key,true);
    return()=>{document.removeEventListener('keydown',key,true);if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[]);
  return <aside className="studio-detail-panel v2-inspector" aria-label={pt?'Detalhes do agente':'Agent details'}>
    <header><span>{pt?'Agente':'Agent'}</span><button ref={closeRef} className="icon-button" onClick={onClose} aria-label={pt?'Fechar detalhes':'Close details'}><Icon name="close"/></button></header>
    <div className="studio-detail-scroll"><AgentAvatar name={agent.name} image={agent.avatarImage} mascot={agent.avatarMascot} role={agent.role}/><h2>{agent.name}</h2><p className="detail-role">{agent.role}</p><AgentStatus status={agent.status}/>
      <nav className="studio-detail-tabs" aria-label={pt?'Informações do agente':'Agent information'}>{(['summary','tools','skills','runs'] as const).map(item=><button key={item} className={tab===item?'active':''} aria-pressed={tab===item} onClick={()=>setTab(item)}>{item==='summary'?(pt?'Resumo':'Summary'):item==='tools'?t('Tools'):item==='runs'?(pt?'Execuções':'Runs'):'Skills'}</button>)}</nav>
      {tab==='summary'?<><p className="detail-description">{agent.description || (pt?'Configure uma descrição para definir o propósito do agente.':'Configure a description to define the agent’s purpose.')}</p><dl><div><dt>{t('Workspace')}</dt><dd>{workspaceName}</dd></div><div><dt>{pt?'Provedor':'Provider'}</dt><dd>{agent.providerId==='claude'?'Claude Code CLI':agent.providerId==='gemini'?'Gemini API':'Codex CLI'}</dd></div><div><dt>{pt?'Atualização':'Updated'}</dt><dd>{new Date(agent.updatedAt).toLocaleDateString(locale)}</dd></div></dl><h3>{t('Instructions')}</h3><p className="detail-instructions">{agent.instructions || (pt?'Nenhuma instrução definida.':'No instructions defined.')}</p></>:tab==='tools'?<div className="detail-capabilities">{agent.tools.map(tool=><div key={tool}><Icon name={tool==='web-search'?'globe':tool==='files'?'folder':tool==='canvas-context'?'canvas':'users'}/><div><strong>{t(agentToolDetails[tool].label)}</strong><p>{t(agentToolDetails[tool].description)}</p></div></div>)}{!agent.tools.length&&<p>{pt?'Nenhuma ferramenta selecionada.':'No tools selected.'}</p>}</div>:tab==='runs'?<AgentRecentWork agent={agent} pt={pt}/>:<div className="detail-capabilities">{agent.skills?.map(skill=><div key={skill}><Icon name="spark"/><div><strong>{skill}</strong><p>{agent.disabledSkills?.includes(skill)?(pt?'Desativada':'Disabled'):(pt?'Disponível com / no chat':'Available with / in chat')}</p></div></div>)}{!agent.skills?.length&&<p>{pt?'Adicione skills na configuração do agente.':'Add skills in agent configuration.'}</p>}<button className="soft-button" onClick={onConfigure}>{pt?'Gerenciar skills':'Manage skills'}</button></div>}
    </div><footer><button className="primary-button" onClick={onChat}><Icon name="message"/>{pt?'Conversar com agente':'Chat with agent'}</button><button className="soft-button" onClick={onConfigure}><Icon name="settings"/>{pt?'Configurar agente':'Configure agent'}</button></footer>
  </aside>;
}
