import { useEffect, useState } from 'react';
import { useLanguage } from '../../app/LanguageProvider';
import { agentTemplates, localizeTemplate } from '../../features/agents/agentTemplates';
import { Icon } from '../common/Icon';

export function WelcomeGuide({hasAgent,onTemplate,onBlank,onSession,onCanvas,onCodexSettings,onDismiss}:{hasAgent:boolean;onTemplate:(id:string)=>void;onBlank:()=>void;onSession:()=>void;onCanvas:()=>void;onCodexSettings:()=>void;onDismiss:()=>void}) {
  const {locale}=useLanguage();
  const [connected,setConnected]=useState<boolean|null>(null);
  const [expanded,setExpanded]=useState(false);
  useEffect(()=>{let active=true;fetch('/api/codex/health').then(async(response)=>{const data=await response.json();if(active)setConnected(response.ok&&data.ready===true);}).catch(()=>{if(active)setConnected(false);});return()=>{active=false};},[]);
  const pt=locale==='pt-BR';
  return <section className="welcome-guide" data-od-id="getting-started" aria-label={pt?'Primeiros passos':'Getting started'}>
    <div className="welcome-head"><span className="welcome-progress">{Number(hasAgent)+Number(connected===true)}/2</span><div><h2>{pt?'Prepare seu espaço de trabalho':'Set up your workspace'}</h2><p>{pt?'Conecte sua IA e crie o primeiro agente.':'Connect your AI and create your first agent.'}</p></div><button className="soft-button" aria-expanded={expanded} aria-controls="setup-steps" onClick={()=>setExpanded((value)=>!value)}>{expanded?(pt?'Recolher':'Collapse'):(pt?'Configurar':'Set up')}<Icon name="chevron"/></button><button className="icon-button" onClick={onDismiss} aria-label={pt?'Dispensar primeiros passos':'Dismiss getting started'}><Icon name="close"/></button></div>
    {expanded&&<div className="welcome-steps" id="setup-steps">
      <div className="welcome-step"><b>01 · {pt?'Conecte sua IA':'Connect your AI'}</b><span>{connected===null?(pt?'Verificando conexão…':'Checking connection…'):connected?(pt?'Codex conectado e pronto para conversar.':'Codex connected and ready to chat.'):(pt?'Conecte o Codex ou configure outro provedor em Configurações.':'Connect Codex or configure another provider in Settings.')}</span><button className="soft-button" onClick={onCodexSettings}>{pt?'Configurar conexão':'Connection settings'}</button></div>
      <div className="welcome-step"><b>02 · {pt?'Crie seu agente':'Create your agent'}</b>{hasAgent?<><span>{pt?'Sua equipe está pronta. Comece uma conversa ou organize o contexto no canvas.':'Your team is ready. Start a conversation or organize context on the canvas.'}</span><div className="welcome-actions"><button className="soft-button" onClick={onSession}>{pt?'Nova conversa':'New conversation'}</button><button className="soft-button" onClick={onCanvas}>Canvas</button></div></>:<><span>{pt?'Escolha uma função como ponto de partida.':'Choose a role as your starting point.'}</span><div className="welcome-templates">{agentTemplates.map((source)=>{const template=localizeTemplate(source,locale);return <button key={template.id} onClick={()=>onTemplate(template.id)} title={template.outcome}>{template.name}<Icon name="plus"/></button>;})}</div><button className="welcome-text-action" onClick={onBlank}>{pt?'Criar do zero':'Start from scratch'}</button></>}</div>
      <div className="welcome-step"><b>03 · {pt?'Pronto para produzir?':'Ready to produce?'}</b><span>{pt?'Confira provedor e login, FFmpeg, Whisper, navegador das animações e integrações de publicação. A verificação é manual e não usa IA.':'Check provider and sign-in, FFmpeg, Whisper, the animation browser and publishing integrations. The check is manual and uses no AI.'}</span><button className="soft-button" onClick={onCodexSettings}>{pt?'Abrir verificação':'Open check'}</button></div>
    </div>}
  </section>;
}
