import {useEffect, useState} from 'react';
import {useChat} from '../../features/chat/ChatProvider';
import {useLanguage} from '../../app/LanguageProvider';
import {FlowDialog} from '../common/FlowDialog';
import {SelectMenu} from '../common/SelectMenu';
import {providerShortName,type EditingLabel,type ProviderSwitchPlan} from '../../features/chat/providerChoice';
import './provider-choice.css';

export type ChoiceProvider = 'codex' | 'claude';
type Catalog = {state: string; models: readonly {id:string; name:string}[]; error?:string};
export function useChoiceCatalogs() {
  const {getProviderStatus,listModels} = useChat();
  const [catalogs,setCatalogs] = useState<Record<ChoiceProvider,Catalog>>({codex:{state:'checking',models:[]},claude:{state:'checking',models:[]}});
  useEffect(()=>{
    let live=true;
    for(const provider of ['codex','claude'] as const) void Promise.allSettled([getProviderStatus(provider),listModels(provider)]).then(([status,models])=>{
      if(!live)return;
      setCatalogs(old=>({...old,[provider]:{state:status.status==='fulfilled'?status.value.state:'error',models:models.status==='fulfilled'?models.value:[],error:status.status==='rejected'?String(status.reason):models.status==='rejected'?String(models.reason):status.value.message}}));
    });
    return()=>{live=false;};
  },[getProviderStatus,listModels]);
  return catalogs;
}
export function choiceStatus(state:string,pt:boolean) {
  return ({checking:pt?'Verificando conexão':'Checking connection',connected:pt?'Conectado':'Connected','not-installed':pt?'Não instalado':'Not installed','login-required':pt?'Login necessário':'Login required','limit-reached':pt?'Limite atingido':'Limit reached',error:pt?'Conexão indisponível':'Connection unavailable'} as Record<string,string>)[state] ?? (pt?'Estado desconhecido':'Unknown status');
}
export function ChoiceModel({provider,value,onChange,catalog,disabled=false}:{provider:ChoiceProvider;value:string;onChange:(value:string)=>void;catalog:Catalog;disabled?:boolean}) {
  const {locale}=useLanguage(),pt=locale==='pt-BR';
  const name=provider==='codex'?'Codex':'Claude';
  return <div className="provider-choice-model"><label>{name}<SelectMenu ariaLabel={`${name} ${pt?'modelo para nova conversa':'model for new chat'}`} value={value} onChange={onChange} disabled={disabled||catalog.state==='checking'} options={[{value:'',label:pt?'Configuração padrão':'Default configuration'},...catalog.models.map(model=>({value:model.id,label:model.name}))]}/></label><p role="status">{name}: {choiceStatus(catalog.state,pt)}{catalog.error?` — ${catalog.error}`:''}</p>{!!value&&catalog.state!=='checking'&&!catalog.models.some(model=>model.id===value)&&<p role="status">{pt?'Modelo salvo não confirmado. Escolha padrão ou um modelo listado.':'Saved model is unconfirmed. Choose default or a listed model.'}</p>}</div>;
}
const lockText=(reason:ProviderSwitchPlan['reason'],pt:boolean)=>({history:pt?'já tem mensagens':'already has messages',thread:pt?'já tem uma conversa no provedor':'already has a provider thread',comparison:pt?'faz parte de uma comparação':'is part of a comparison',handoff:pt?'tem trabalho de especialista ligado':'has linked specialist work',production:pt?'está ligada a uma produção':'is bound to a production',busy:pt?'está respondendo ou com trabalho em andamento':'is responding or has work in progress'} as Record<string,string>)[reason??'']??'';
/** Full text for dialogs and tooltips; `short` is the header chip (provider only, so it fits narrow panels). */
export function editingText(label:EditingLabel,pt:boolean,short=false){
 if(label.source==='basic')return short?(pt?'Edição: básica':'Editing: basic'):(pt?'Edição: básica (FFmpeg, sem IA)':'Editing: basic (FFmpeg, no AI)');
 const who=label.agent&&!short?`${pt?'agente editor':'editor agent'} · ${providerShortName(label.provider)}`:providerShortName(label.provider);
 const workspace=label.source==='workspace'?(short?(pt?' (padrão)':' (default)'):(pt?' (padrão do espaço)':' (workspace default)')):'';
 return `${pt?'Edição':'Editing'}: ${who}${label.model&&!short?` · ${label.model}`:''}${workspace}`;
}
/**
 * The provider of THIS chat and, when the chat follows a production, who really directs its edit (two distinct choices).
 * Read-only inside embedded views; choosing never sends anything.
 */
export function ConversationProviderBar({providerId,modelLabel,connection,editing,editingRun,busy,readOnly,onChoose,onOpenProduction}:{providerId:string;modelLabel?:string;connection:string;editing?:EditingLabel;editingRun?:string;busy:boolean;readOnly?:boolean;onChoose:()=>void;onOpenProduction?:()=>void}){
 const {locale}=useLanguage(),pt=locale==='pt-BR';
 const chat=`${pt?'Conversa':'Chat'}: ${providerShortName(providerId)}`,chatFull=`${chat}${modelLabel?` · ${modelLabel}`:''}`;
 return <div className="provider-choice-trigger" data-od-id="conversation-provider">
  <div className="provider-choice-chips">
   {readOnly?<span className="provider-choice-chip" data-od-id="conversation-provider-label" title={chatFull}>{chat}</span>:<button type="button" className="provider-choice-chip" data-od-id="generate-with" disabled={busy} title={busy?(pt?'Aguarde a resposta atual para trocar o provedor.':'Wait for the current response to change the provider.'):`${chatFull} — ${pt?'trocar o provedor desta conversa':'change this chat’s provider'}`} onClick={onChoose}>{chat}</button>}
   {editing&&(onOpenProduction?<button type="button" className="provider-choice-chip provider-choice-editing" data-od-id="production-editing-provider" onClick={onOpenProduction} title={`${editingText(editing,pt)} — ${pt?'escolha separada, feita na produção':'separate choice, made in the production'}${editingRun?`
${pt?'Última execução':'Last run'}: ${editingRun}`:''}`}>{editingText(editing,pt,true)}</button>:<span className="provider-choice-chip provider-choice-editing" data-od-id="production-editing-provider" title={`${editingText(editing,pt)}${editingRun?`
${pt?'Última execução':'Last run'}: ${editingRun}`:''}`}>{editingText(editing,pt,true)}</span>)}
  </div>
  {connection!=='connected'&&<span role="status">{choiceStatus(connection,pt)}</span>}
 </div>;
}
export function ProviderChoice({agentName,currentProvider,currentModel,busy,plan,editing,onClose,onCreate,onBoth}:{agentName:string;currentProvider:string;currentModel?:string;busy:boolean;plan:ProviderSwitchPlan;editing?:EditingLabel;onClose:()=>void;onCreate:(provider:ChoiceProvider,model?:string)=>void;onBoth:(models:{codexModelId?:string;claudeModelId?:string})=>void}) {
  const {locale}=useLanguage(),pt=locale==='pt-BR',catalogs=useChoiceCatalogs();
  const [choice,setChoice]=useState<ChoiceProvider|'both'>(currentProvider==='claude'?'claude':'codex');
  const [models,setModels]=useState({codex:currentProvider==='codex'?currentModel??'':'',claude:currentProvider==='claude'?currentModel??'':''});
  const blocked=busy||plan.kind==='blocked',inPlace=plan.kind==='in-place';
  return <FlowDialog title={pt?'Provedor desta conversa':'This chat’s provider'} description={pt?`${agentName}: escolha Codex ou Claude para esta conversa. O agente, suas instruções e skills não mudam.`:`${agentName}: choose Codex or Claude for this chat. The agent, its instructions and skills do not change.`} onClose={onClose}>
    <div className="provider-choice-fields" data-od-id="provider-choice" data-plan={plan.kind}>
      <div className="provider-choice-options" role="group" aria-label={pt?'Provedor de geração':'Generation provider'}>{(['codex','claude','both'] as const).map(provider=><button className="soft-button" key={provider} data-od-id={`provider-choice-${provider}`} aria-pressed={choice===provider} disabled={blocked} onClick={()=>setChoice(provider)}>{provider==='both'?(pt?'Ambos':'Both'):provider==='codex'?'Codex':'Claude'}</button>)}</div>
      {(['codex','claude'] as const).filter(provider=>choice==='both'||provider===choice).map(provider=><ChoiceModel key={provider} provider={provider} value={models[provider]} onChange={value=>setModels(old=>({...old,[provider]:value}))} catalog={catalogs[provider]} disabled={blocked}/>)}
      <p data-od-id="provider-choice-effect">{plan.kind==='blocked'?(pt?`Esta conversa ${lockText(plan.reason,pt)}. Aguarde terminar para trocar; nada foi alterado.`:`This chat ${lockText(plan.reason,pt)}. Wait for it to finish to switch; nothing changed.`):inPlace?(pt?'Esta conversa ainda não falou com nenhum provedor: a escolha vale para ela mesma. Seu rascunho continua aqui; nada é enviado.':'This chat has not talked to any provider yet: the choice applies to it. Your draft stays here; nothing is sent.'):(pt?`Esta conversa ${lockText(plan.reason,pt)} e continua com ${providerShortName(currentProvider)}, com todo o histórico. Uma nova conversa no mesmo conteúdo recebe uma cópia do rascunho; nada é enviado ao abrir.`:`This chat ${lockText(plan.reason,pt)} and stays with ${providerShortName(currentProvider)}, with all its history. A new chat in the same content gets a copy of the draft; opening sends nothing.`)}</p>
      <p className="editorial-hint">{editing?(pt?`Vale só para a conversa. ${editingText(editing,pt)} é uma escolha separada, feita na produção em “Quem dirige os cortes e o motion”.`:`Applies to the chat only. ${editingText(editing,pt)} is a separate choice, made in the production under “Who directs cuts and motion”.`):(pt?'Vale só para a conversa. Numa produção, quem dirige a edição é escolhido separadamente. Modelos e capacidades variam por provedor.':'Applies to the chat only. In a production, the edit director is chosen separately. Models and capabilities vary by provider.')}</p>
      {choice==='both'?<button className="primary-button" data-od-id="provider-choice-review-both" disabled={blocked||catalogs.codex.state!=='connected'||catalogs.claude.state!=='connected'||(['codex','claude'] as const).some(provider=>!!models[provider]&&!catalogs[provider].models.some(model=>model.id===models[provider]))} onClick={()=>onBoth({codexModelId:models.codex,claudeModelId:models.claude})}>{pt?'Revisar duas consultas':'Review two consultations'}</button>:<button className="primary-button" data-od-id="provider-choice-open-single" disabled={blocked||catalogs[choice].state==='checking'||!!models[choice]&&!catalogs[choice].models.some(model=>model.id===models[choice])} onClick={()=>onCreate(choice,models[choice]||undefined)}>{inPlace?(pt?`Usar ${providerShortName(choice)} nesta conversa`:`Use ${providerShortName(choice)} in this chat`):(pt?`Abrir nova conversa com ${providerShortName(choice)} sem enviar`:`Open new chat with ${providerShortName(choice)} without sending`)}</button>}
      {choice!=='both'&&catalogs[choice].state!=='connected'&&catalogs[choice].state!=='checking'&&<p role="status">{pt?'Você pode preparar a conversa, mas precisa conectar este provedor antes de enviar.':'You can prepare the chat, but must connect this provider before sending.'}</p>}
    </div>
  </FlowDialog>;
}
