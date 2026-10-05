import { useEffect, useState } from 'react';
import type { Agent } from '../../features/agents/model/Agent';
import type { ChatContextReference } from '../../features/chat/model/Chat';
import { handoffTargets } from '../../features/chat/agentHandoff';
import { useAgents } from '../../features/agents/AgentsProvider';
import { useChat } from '../../features/chat/ChatProvider';
import { useLanguage } from '../../app/LanguageProvider';
import { FlowDialog } from '../common/FlowDialog';
import { SelectMenu } from '../common/SelectMenu';

export function AgentHandoffDialog({agent,sessionId,initialBriefing,context,onClose}:{agent:Agent;sessionId:string;initialBriefing:string;context:ChatContextReference[];onClose:()=>void}) {
  const {agents}=useAgents(), {delegateToAgent,collaborationId,sessions}=useChat(), {locale}=useLanguage();
  const connection=sessions.find(session=>session.id===sessionId)?.agentConnection;
  const pt=locale==='pt-BR', targets=handoffTargets(agent,agents).filter(target=>!connection?.enabled||target.id===connection.targetAgentId);
  const [target,setTarget]=useState(targets[0]?.id??'');
  const [sessionMode,setSessionMode]=useState<'continue'|'new'>('continue');
  const [title,setTitle]=useState(pt?'Passagem de trabalho':'Agent handoff');
  const [instructions,setInstructions]=useState(initialBriefing);
  const [files,setFiles]=useState('');
  const [error,setError]=useState('');
  const [sending,setSending]=useState(false);
  useEffect(()=>{if(sending&&collaborationId)onClose();},[sending,collaborationId,onClose]);
  return <FlowDialog title={pt?'Enviar a outro agente':'Send to another agent'} description={pt?'O especialista receberá o briefing e manterá suas próprias instruções e skills.':'The specialist receives this briefing and keeps its own instructions and skills.'} onClose={onClose}>
    <form className="handoff-form" onSubmit={event=>{event.preventDefault();if(sending)return;setSending(true);setError('');void delegateToAgent(agent,sessionId,{targetAgentId:target,title,instructions,sessionMode,files:files.split(/\r?\n/).map(item=>item.trim()).filter(Boolean)},context).then(onClose).catch(reason=>{setError(reason instanceof Error?reason.message:String(reason));setSending(false);});}}>
      <label>{pt?'Agente de destino':'Target agent'}<SelectMenu value={target} onChange={setTarget} options={targets.map(item=>({value:item.id,label:item.name}))} ariaLabel={pt?'Agente de destino':'Target agent'}/></label>
      <label>{pt?'Conversa do especialista':'Specialist conversation'}<SelectMenu value={sessionMode} onChange={value=>setSessionMode(value as 'continue'|'new')} ariaLabel={pt?'Conversa do especialista':'Specialist conversation'} options={[{value:'continue',label:pt?'Continuar a mesma sessão':'Continue the same session'},{value:'new',label:pt?'Abrir uma nova sessão':'Start a new session'}]}/></label>
      <label>{pt?'Título':'Title'}<input value={title} maxLength={120} onChange={event=>setTitle(event.target.value)} required/></label>
      <label>{pt?'Instruções e contexto':'Instructions and context'}<textarea data-autofocus value={instructions} maxLength={32000} rows={7} onChange={event=>setInstructions(event.target.value)} required/></label>
      <label>{pt?'Arquivos locais — um caminho completo por linha':'Local files — one absolute path per line'}<textarea value={files} rows={3} placeholder={'C:\\Users\\pacas\\Videos\\gravacao.mp4'} onChange={event=>setFiles(event.target.value)}/></label>
      {!!context.length&&<small>{pt?'Contexto do Canvas incluído: ':'Canvas context included: '}{context.map(item=>item.label).join(', ')}</small>}
      <p>{pt?'Os arquivos ficam neste computador. A passagem não aprova nem publica conteúdo.':'Files stay on this computer. A handoff does not approve or publish content.'}</p>
      {error&&<p role="alert">{error}</p>}
      <footer><button type="button" className="soft-button" onClick={onClose}>{pt?'Cancelar':'Cancel'}</button><button className="primary-button" disabled={sending||!target||!instructions.trim()}>{sending?(pt?'Enviando…':'Sending…'):(pt?'Enviar e iniciar':'Send and start')}</button></footer>
    </form>
  </FlowDialog>;
}
