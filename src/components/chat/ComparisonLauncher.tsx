import {useState} from 'react';
import {useAgents} from '../../features/agents/AgentsProvider';
import {useChat} from '../../features/chat/ChatProvider';
import {useLanguage} from '../../app/LanguageProvider';
import type {ChatContextReference} from '../../features/chat/model/Chat';
import {FlowDialog} from '../common/FlowDialog';
import {SelectMenu} from '../common/SelectMenu';

export function ComparisonLauncher({workspaceId,agentId,briefing,context,onClose}:{workspaceId:string;agentId:string;briefing:string;context:ChatContextReference[];onClose:()=>void}){
 const {agents}=useAgents(),{startComparison}=useChat(),{locale}=useLanguage(),pt=locale==='pt-BR';
 const available=agents.filter(a=>a.workspaceId===workspaceId),codex=available.filter(a=>(a.providerId??'codex')==='codex'),claude=available.filter(a=>a.providerId==='claude');
 const [codexId,setCodex]=useState(codex.find(a=>a.id===agentId)?.id??codex[0]?.id??''),[claudeId,setClaude]=useState(claude.find(a=>a.id===agentId)?.id??claude[0]?.id??''),[text,setText]=useState(briefing),[includeContext,setIncludeContext]=useState(context.length>0),[starting,setStarting]=useState(false),[error,setError]=useState('');
 const valid=codex.some(a=>a.id===codexId)&&claude.some(a=>a.id===claudeId)&&!!text.trim()&&text.length<=20000;
 // Remove the launcher before the comparison opens, so there is one dialog at a time.
 if(starting)return null;
 return <FlowDialog title={pt?'Consultar dois agentes':'Consult two agents'} description={pt?'O mesmo briefing será enviado separadamente. Cada agente mantém seu modelo, skills e contexto de execução.':'The same brief will be sent independently. Each agent keeps its model, skills and execution context.'} onClose={onClose}>
  <div className="comparison-launch-fields">
   <label>Codex<SelectMenu ariaLabel="Comparison Codex agent" value={codexId} onChange={setCodex} options={codex.map(a=>({value:a.id,label:a.name}))}/></label>
   <label>Claude<SelectMenu ariaLabel="Comparison Claude agent" value={claudeId} onChange={setClaude} options={claude.map(a=>({value:a.id,label:a.name}))}/></label>
   {(!codex.length||!claude.length)&&<p role="status">{pt?'Crie ou configure um agente Codex e um Claude neste workspace antes de comparar.':'Create or configure one Codex and one Claude agent in this workspace before comparing.'}</p>}
   <label>{pt?'Briefing compartilhado':'Shared brief'}<textarea data-autofocus aria-label={pt?'Briefing compartilhado':'Shared brief'} rows={7} maxLength={20000} value={text} onChange={event=>setText(event.target.value)}/></label>
   {context.length>0&&<label><input type="checkbox" checked={includeContext} onChange={event=>setIncludeContext(event.target.checked)}/>{pt?'Incluir o mesmo contexto selecionado nos dois chats':'Include the same selected context in both chats'} ({context.length})</label>}
   <p className="editorial-hint">{pt?'Esta ação inicia duas execuções e consome uso nos dois provedores. Abrir ou reabrir a comparação não envia mensagens. Revise o briefing antes de iniciar.':'This action starts two executions and consumes usage on both providers. Opening or reopening a comparison sends no messages. Review the brief before starting.'}</p>
   {error&&<p className="delivery-error" role="alert">{error}</p>}
   <button className="primary-button" disabled={!valid} onClick={async()=>{setError('');setStarting(true);try{await startComparison({codexAgentId:codexId,claudeAgentId:claudeId,briefing:text,context:includeContext?context:[]});onClose()}catch(failure){setError((failure as Error).message);setStarting(false)}}}>{pt?'Iniciar duas consultas':'Start two consultations'}</button>
  </div>
 </FlowDialog>;
}
