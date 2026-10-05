import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useChat } from '../../features/chat/ChatProvider';
import { useAgents } from '../../features/agents/AgentsProvider';
import { useLanguage } from '../../app/LanguageProvider';
import { ChatPanel } from './ChatPanel';
import type { PageId } from '../../app/types';
import { useCanvas } from '../canvas/CanvasProvider';
import { useWorkspaces } from '../../app/WorkspaceProvider';
import { Icon } from '../common/Icon';

export function AgentCollaboration({onNavigate,onCreateCanvas,onEditAgent,onProviderSettings,onToast}:{onNavigate:(page:PageId)=>void;onCreateCanvas:()=>void;onEditAgent:(id:string)=>void;onProviderSettings:()=>void;onToast:(message:string)=>void}) {
  const {handoffs,collaborationId,showCollaboration,cancelExecution,sessions}=useChat();
  const {agents}=useAgents(), {locale}=useLanguage();
  const {addCollaboration}=useCanvas();
  const {setCurrentWorkspaceId}=useWorkspaces();
  const item=handoffs.find(handoff=>handoff.id===collaborationId);
  const source=agents.find(agent=>agent.id===item?.sourceAgentId),target=agents.find(agent=>agent.id===item?.targetAgentId);
  const [mobileChat,setMobileChat]=useState<'source'|'target'>('target');
  const dialogRef=useRef<HTMLElement>(null);
  const close=()=>showCollaboration(null);
  const closeRef=useRef(close);closeRef.current=close;
  useEffect(()=>{
    if(!collaborationId)return;
    const origin=document.activeElement as HTMLElement|null;
    dialogRef.current?.querySelector<HTMLElement>('[data-close]')?.focus();
    const key=(event:KeyboardEvent)=>{
      if(event.defaultPrevented)return;
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeRef.current();}
      if(event.key==='Tab'){
        const elements=Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,textarea,[tabindex="0"],summary,a[href]')??[]).filter(element=>element.getClientRects().length);
        const first=elements[0],last=elements.at(-1);
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
    };
    document.addEventListener('keydown',key);
    return()=>{document.removeEventListener('keydown',key);if(origin?.isConnected)origin.focus();};
  },[collaborationId]);
  useEffect(()=>setMobileChat('target'),[collaborationId]);
  if(!item||!source||!target)return null;
  const pt=locale==='pt-BR';
  const sourceSession=sessions.find(session=>session.id===item.sourceSessionId&&session.agentId===source.id);
  const targetSession=sessions.find(session=>session.id===item.targetSessionId&&session.agentId===target.id);
  const createCanvas=()=>{
    if(!sourceSession||!targetSession)return;
    addCollaboration({workspaceId:item.workspaceId,handoffId:item.id,source:{agent:source,session:sourceSession},target:{agent:target,session:targetSession}});
    setCurrentWorkspaceId(item.workspaceId);
    close();onCreateCanvas();
    onToast(pt?'Os dois chats estão conectados no Canvas.':'Both chats are connected on the Canvas.');
  };
  const status=pt?({running:'Trabalhando',completed:'Resultado entregue',error:'Precisa de atenção',cancelled:'Interrompido',interrupted:'Interrompido ao fechar o app'}[item.status]):item.status;
  const panel=(agent:typeof source,sessionId:string)=>sessions.some(session=>session.id===sessionId)?<ChatPanel key={sessionId} sessionId={sessionId} agent={agent} presentation="floating" onSelectAgent={()=>{}} onTogglePresentation={close} onClose={close} onNavigateHistory={()=>{close();onNavigate('sessions');}} onNavigateSettings={()=>{close();onEditAgent(agent.id);}} onProviderSettings={()=>{close();onProviderSettings();}} onOpenCanvas={()=>{close();onNavigate('canvas');}} onToast={onToast}/>:<p className="collaboration-missing">{pt?'Esta sessão foi excluída. O briefing permanece no histórico do agente de origem.':'This session was deleted. The briefing remains in the requesting agent history.'}</p>;
  return createPortal(<div className="studio-shell collaboration-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)close();}}>
    <section ref={dialogRef} className="collaboration-window" role="dialog" aria-modal="true" aria-labelledby="collaboration-heading">
      <header className="collaboration-heading"><div><h2 id="collaboration-heading">{source.name} <span>→</span> {target.name}</h2><p>{item.title} <span className={`collaboration-status ${item.status}`}>{status}</span></p></div><div><button className="soft-button collaboration-create-canvas" disabled={!sourceSession||!targetSession} onClick={createCanvas} title={pt?'Abrir as mesmas sessões no Canvas, conectadas por uma seta':'Open these same sessions on the Canvas, linked by an arrow'}><Icon name="canvas"/>{pt?'Criar Canvas':'Create Canvas'}</button>{item.status==='running'&&<button className="soft-button" onClick={()=>{cancelExecution(item.sourceSessionId);cancelExecution(item.targetSessionId);}}>{pt?'Interromper trabalho':'Stop work'}</button>}<button data-close className="soft-button" onClick={close}>{pt?'Voltar ao workspace':'Back to workspace'}</button></div></header>
      {item.files.length>0&&<details className="collaboration-files"><summary>{item.files.length} {pt?'arquivo(s) no briefing':'file reference(s) in briefing'}</summary>{item.files.map(file=><p key={file}>{file}</p>)}</details>}
      <nav className="collaboration-mobile-tabs" aria-label={pt?'Conversa visível':'Visible conversation'}><button aria-pressed={mobileChat==='source'} onClick={()=>setMobileChat('source')}>{source.name}</button><button aria-pressed={mobileChat==='target'} onClick={()=>setMobileChat('target')}>{target.name}</button></nav>
      <div className={`collaboration-chats show-${mobileChat}`}><div className="collaboration-source">{panel(source,item.sourceSessionId)}</div><div className="collaboration-target">{panel(target,item.targetSessionId)}</div></div>
    </section>
  </div>,document.body);
}
