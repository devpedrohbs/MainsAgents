import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { PageId } from '../../app/types';
import type { Agent } from '../../features/agents/model/Agent';
import { ChatPanel } from '../chat/ChatPanel';

interface RightPanelProps { agent:Agent; onNavigate:(page:PageId)=>void; onEditAgent:(agentId:string)=>void; onToast:(message:string)=>void }
export function RightPanel({agent,onNavigate,onEditAgent,onToast}:RightPanelProps) {
  const panelRef=useRef<HTMLElement>(null);
  const startResize=(event:ReactPointerEvent<HTMLDivElement>)=>{const handle=event.currentTarget;handle.setPointerCapture(event.pointerId);const move=(next:PointerEvent)=>{const width=Math.max(280,Math.min(480,window.innerWidth-next.clientX));document.documentElement.style.setProperty('--inspector-w',`${width}px`)};const stop=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',stop)};window.addEventListener('pointermove',move);window.addEventListener('pointerup',stop)};
  return <aside className="inspector" ref={panelRef}><div className="resize-handle" onPointerDown={startResize}/><ChatPanel agent={agent} onNavigateHistory={()=>onNavigate('sessions')} onNavigateSettings={()=>onEditAgent(agent.id)} onOpenCanvas={()=>onNavigate('canvas')} onToast={onToast}/></aside>;
}
