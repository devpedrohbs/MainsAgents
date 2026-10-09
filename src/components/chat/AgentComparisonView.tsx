import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {useChat} from '../../features/chat/ChatProvider';
import {useAgents} from '../../features/agents/AgentsProvider';
import {useLanguage} from '../../app/LanguageProvider';
import type {PageId} from '../../app/types';
import {readChatDraft,writeChatDraft} from '../../features/chat/chatDrafts';
import {comparisonSynthesisDraft} from './comparisonDraft';
import {ChatPanel} from './ChatPanel';
import './comparison.css';

export function AgentComparisonView({onNavigate,onEditAgent,onProviderSettings,onToast}:{onNavigate:(page:PageId)=>void;onEditAgent:(id:string)=>void;onProviderSettings:()=>void;onToast:(text:string)=>void}){
 const {comparisons,comparisonId,showComparison,sessions,getRunState}=useChat(),{agents}=useAgents(),{locale,t}=useLanguage(),pt=locale==='pt-BR';
 const pair=comparisons.find(c=>c.id===comparisonId),[visible,setVisible]=useState<'codex'|'claude'>('codex'),[chosen,setChosen]=useState<'codex'|'claude'>('codex');
 const root=useRef<HTMLElement>(null),close=()=>showComparison(null),closeRef=useRef(close);closeRef.current=close;
 useEffect(()=>{if(!comparisonId)return;setVisible('codex');setChosen('codex');const origin=document.activeElement as HTMLElement|null;root.current?.querySelector<HTMLElement>('[data-comparison-close]')?.focus();
  const key=(event:KeyboardEvent)=>{if(event.defaultPrevented)return;if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeRef.current()}
   if(event.key==='Tab'){const fields=Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),textarea:not(:disabled),input:not(:disabled),summary,a[href],[tabindex="0"]')??[]).filter(e=>e.getClientRects().length),first=fields[0],last=fields.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}};
  const focus=(event:FocusEvent)=>{if(root.current&&!root.current.contains(event.target as Node))root.current.querySelector<HTMLElement>('[data-comparison-close]')?.focus()};
  document.addEventListener('keydown',key,true);document.addEventListener('focusin',focus);
  return()=>{document.removeEventListener('keydown',key,true);document.removeEventListener('focusin',focus);if(origin?.isConnected&&origin.getClientRects().length&&origin.matches('button,input,textarea,summary,a'))origin.focus();else document.querySelector<HTMLTextAreaElement>('.chat-compose textarea')?.focus()};
 },[comparisonId]);
 if(!pair)return null;
 const roles=['codex','claude'] as const,entries=roles.map(role=>({role,agent:agents.find(a=>a.id===(role==='codex'?pair.codexAgentId:pair.claudeAgentId)),session:sessions.find(s=>s.id===(role==='codex'?pair.codexSessionId:pair.claudeSessionId))}));
 const replies=entries.map(e=>e.session?.messages.filter(m=>m.type==='message'&&m.role==='agent'&&(m.deliveryState==='completed'||!m.deliveryState)).at(-1)).map(m=>m?.type==='message'?m.content:'');
 const status=(sessionId?:string)=>t(({idle:'Idle',thinking:'Thinking',searching:'Searching','using-tool':'Tool usage',finished:'Finished',error:'Error'} as const)[getRunState(sessionId)]);
 const prepare=(synthesis:boolean)=>{const entry=entries.find(e=>e.role===chosen);if(!entry?.agent||!entry.session)return;const text=synthesis?comparisonSynthesisDraft(pair.briefing,replies[0]??'',replies[1]??'',pt):replies[chosen==='codex'?0:1];writeChatDraft(entry.agent.id,entry.session.id,{...readChatDraft(entry.agent.id,entry.session.id),text,skill:null,context:[]});setVisible(chosen);onToast(pt?'Rascunho preparado. Revise e envie se desejar.':'Draft prepared. Review and send if you wish.');};
 const navigate=(page:PageId)=>{close();onNavigate(page)};
 return createPortal(<div className="studio-shell comparison-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)close()}}><section ref={root} className="comparison-window" role="dialog" aria-modal="true" aria-labelledby="comparison-heading">
  <header className="comparison-heading"><div><h2 id="comparison-heading">{pair.mode==='same-agent'?(pt?'Um agente, dois provedores':'One agent, two providers'):(pt?'Comparação de agentes':'Agent comparison')} · Codex / Claude</h2><p>{pair.title}</p><small>{pt?'Duas conversas independentes. Continuar ou cancelar uma não altera a outra.':'Two independent chats. Continuing or canceling one does not change the other.'}</small></div><button className="soft-button" data-comparison-close onClick={close}>{pt?'Voltar ao workspace':'Back to workspace'}</button></header>
  <nav className="comparison-tabs" aria-label={pt?'Conversa visível':'Visible chat'}>{entries.map(e=><button key={e.role} aria-pressed={visible===e.role} onClick={()=>setVisible(e.role)}>{e.role==='codex'?'Codex':'Claude'} · {e.agent?.name??e.role} · {status(e.session?.id)}</button>)}</nav>
  <div className={`comparison-chats show-${visible}`}>{entries.map(entry=><div key={entry.role} className={`comparison-chat comparison-${entry.role}`} data-comparison-provider={entry.role}><div className="comparison-provider-label">{entry.role==='codex'?'Codex':'Claude'} · {entry.session?.modelId||(pt?'Configuração padrão':'Default configuration')}</div>{entry.agent&&entry.session?<ChatPanel comparisonMode sessionId={entry.session.id} agent={entry.agent} presentation="floating" onSelectAgent={()=>{}} onClose={close} onTogglePresentation={close} onNavigateHistory={()=>navigate('sessions')} onNavigateSettings={()=>{close();onEditAgent(entry.agent!.id)}} onProviderSettings={()=>{close();onProviderSettings()}} onOpenCanvas={()=>navigate('canvas')} onToast={onToast}/>:<p role="status">{pt?'Este agente ou esta sessão não está mais disponível. A outra conversa permanece independente.':'This agent or session is no longer available. The other chat remains independent.'}</p>}</div>)}</div>
  <footer className="comparison-results"><div>{entries.map((entry,index)=><button className="soft-button" key={entry.role} disabled={!replies[index]} aria-pressed={chosen===entry.role} onClick={()=>setChosen(entry.role)}>{pt?'Escolher resposta':'Choose reply'} {entry.role==='codex'?'Codex':'Claude'}</button>)}</div><div><button className="soft-button" disabled={!replies[chosen==='codex'?0:1]} onClick={()=>void navigator.clipboard.writeText(replies[chosen==='codex'?0:1]??'').then(()=>onToast(t('Copied to clipboard'))).catch(()=>onToast(t('Could not copy message')))}>{pt?'Copiar escolhida':'Copy chosen'}</button><button className="soft-button" disabled={!replies[chosen==='codex'?0:1]} onClick={()=>prepare(false)}>{pt?'Usar como rascunho':'Use as draft'}</button><button className="soft-button" disabled={!replies[0]||!replies[1]} onClick={()=>prepare(true)}>{pt?'Preparar síntese no chat escolhido':'Prepare synthesis in chosen chat'}</button></div></footer>
 </section></div>,document.body);
}
