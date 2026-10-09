import {useState} from 'react';
import {useAgents} from '../../features/agents/AgentsProvider';
import {useChat} from '../../features/chat/ChatProvider';
import {useLanguage} from '../../app/LanguageProvider';
import type {ChatContextReference} from '../../features/chat/model/Chat';
import {FlowDialog} from '../common/FlowDialog';
import {SelectMenu} from '../common/SelectMenu';
import {ChoiceModel,useChoiceCatalogs,choiceStatus} from './ProviderChoice';

export function ComparisonLauncher({workspaceId,agentId,briefing,context,onClose,mode='agents',initialModels}:{workspaceId:string;agentId:string;briefing:string;context:ChatContextReference[];onClose:()=>void;mode?:'agents'|'same-agent';initialModels?:{codexModelId?:string;claudeModelId?:string}}){
  const {agents}=useAgents(),{startComparison}=useChat(),{locale}=useLanguage(),pt=locale==='pt-BR';
  const available=agents.filter(a=>a.workspaceId===workspaceId),codex=available.filter(a=>(a.providerId??'codex')==='codex'),claude=available.filter(a=>a.providerId==='claude');
  const source=available.find(a=>a.id===agentId),same=mode==='same-agent',catalogs=useChoiceCatalogs();
  const [models,setModels]=useState({codex:initialModels?.codexModelId??((source?.providerId??'codex')==='codex'?source?.modelId??'':''),claude:initialModels?.claudeModelId??(source?.providerId==='claude'?source.modelId??'':'')});
  const [codexId,setCodex]=useState(codex.find(a=>a.id===agentId)?.id??codex[0]?.id??''),[claudeId,setClaude]=useState(claude.find(a=>a.id===agentId)?.id??claude[0]?.id??''),[text,setText]=useState(briefing),[includeContext,setIncludeContext]=useState(context.length>0),[starting,setStarting]=useState(false),[error,setError]=useState('');
  const valid=(same?!!source&&['codex','claude'].includes(source.providerId??'codex')&&(['codex','claude'] as const).every(provider=>!models[provider]||catalogs[provider].models.some(model=>model.id===models[provider])):codex.some(a=>a.id===codexId)&&claude.some(a=>a.id===claudeId))&&!!text.trim()&&text.length<=20000&&catalogs.codex.state==='connected'&&catalogs.claude.state==='connected';
  if(starting)return null;
  return <FlowDialog title={same?(pt?'Consultar Codex e Claude':'Consult Codex and Claude'):(pt?'Consultar dois agentes':'Consult two agents')} description={same?(pt?'Um agente, duas sessões independentes. Revise antes de enviar o mesmo briefing a cada provedor.':'One agent, two independent sessions. Review before sending the same brief to each provider.'):(pt?'O mesmo briefing será enviado separadamente. Cada agente mantém seu modelo, skills e contexto de execução.':'The same brief will be sent independently. Each agent keeps its model, skills and execution context.')} onClose={onClose}>
    <div className="comparison-launch-fields">
      {same?<><p>{source?.name}</p>{(['codex','claude'] as const).map(provider=><ChoiceModel key={provider} provider={provider} value={models[provider]} onChange={value=>setModels(old=>({...old,[provider]:value}))} catalog={catalogs[provider]}/>)}<p className="editorial-hint">{pt?'Configuração padrão usa o padrão de cada provedor. Este recorte é chat e ideias; produção semiautomática continua Codex.':'Default configuration uses the provider default on each side. This applies to chat and ideas; semi-automatic production remains Codex.'}</p></>:<><label>Codex<SelectMenu ariaLabel="Comparison Codex agent" value={codexId} onChange={setCodex} options={codex.map(a=>({value:a.id,label:a.name}))}/></label><label>Claude<SelectMenu ariaLabel="Comparison Claude agent" value={claudeId} onChange={setClaude} options={claude.map(a=>({value:a.id,label:a.name}))}/></label>{(!codex.length||!claude.length)&&<p role="status">{pt?'Crie ou configure um agente Codex e um Claude neste workspace antes de comparar.':'Create or configure one Codex and one Claude agent in this workspace before comparing.'}</p>}<p role="status">Codex: {choiceStatus(catalogs.codex.state,pt)} · Claude: {choiceStatus(catalogs.claude.state,pt)}</p></>}
      <label>{pt?'Briefing compartilhado':'Shared brief'}<textarea data-autofocus aria-label={pt?'Briefing compartilhado':'Shared brief'} rows={7} maxLength={20000} value={text} onChange={event=>setText(event.target.value)}/></label>
      {context.length>0&&<label><input type="checkbox" checked={includeContext} onChange={event=>setIncludeContext(event.target.checked)}/>{pt?'Incluir o mesmo contexto selecionado nos dois chats':'Include the same selected context in both chats'} ({context.length})</label>}
      <p className="editorial-hint">{pt?'Esta ação inicia duas execuções e consome uso nos dois provedores. Abrir ou reabrir a comparação não envia mensagens. Revise o briefing antes de iniciar.':'This action starts two executions and consumes usage on both providers. Opening or reopening a comparison sends no messages. Review the brief before starting.'}</p>
      {error&&<p className="delivery-error" role="alert">{error}</p>}
      <button className="primary-button" data-od-id="start-two-consultations" disabled={!valid} onClick={async()=>{setError('');setStarting(true);try{await startComparison(same?{mode:'same-agent',agentId,codexModelId:models.codex,claudeModelId:models.claude,briefing:text,context:includeContext?context:[]}:{codexAgentId:codexId,claudeAgentId:claudeId,briefing:text,context:includeContext?context:[]});onClose()}catch(failure){setError((failure as Error).message);setStarting(false);}}}>{pt?'Iniciar duas consultas':'Start two consultations'}</button>
    </div>
  </FlowDialog>;
}
