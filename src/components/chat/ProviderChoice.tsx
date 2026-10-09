import {useEffect, useState} from 'react';
import {useChat} from '../../features/chat/ChatProvider';
import {useLanguage} from '../../app/LanguageProvider';
import {FlowDialog} from '../common/FlowDialog';
import {SelectMenu} from '../common/SelectMenu';
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
export function ProviderChoice({agentName,currentProvider,currentModel,busy,onClose,onCreate,onBoth}:{agentName:string;currentProvider:string;currentModel?:string;busy:boolean;onClose:()=>void;onCreate:(provider:ChoiceProvider,model?:string)=>void;onBoth:(models:{codexModelId?:string;claudeModelId?:string})=>void}) {
  const {locale}=useLanguage(),pt=locale==='pt-BR',catalogs=useChoiceCatalogs();
  const [choice,setChoice]=useState<ChoiceProvider|'both'>(currentProvider==='claude'?'claude':'codex');
  const [models,setModels]=useState({codex:currentProvider==='codex'?currentModel??'':'',claude:currentProvider==='claude'?currentModel??'':''});
  return <FlowDialog title={pt?'Gerar com':'Generate with'} description={pt?`${agentName}: escolha o provedor para uma nova conversa.`:`${agentName}: choose the provider for a new chat.`} onClose={onClose}>
    <div className="provider-choice-fields" data-od-id="provider-choice">
      <div className="provider-choice-options" role="group" aria-label={pt?'Provedor de geração':'Generation provider'}>{(['codex','claude','both'] as const).map(provider=><button className="soft-button" key={provider} data-od-id={`provider-choice-${provider}`} aria-pressed={choice===provider} disabled={busy} onClick={()=>setChoice(provider)}>{provider==='both'?(pt?'Ambos':'Both'):provider==='codex'?'Codex':'Claude'}</button>)}</div>
      {(['codex','claude'] as const).filter(provider=>choice==='both'||provider===choice).map(provider=><ChoiceModel key={provider} provider={provider} value={models[provider]} onChange={value=>setModels(old=>({...old,[provider]:value}))} catalog={catalogs[provider]} disabled={busy}/>)}
      <p>{pt?'O histórico atual e seu rascunho são preservados. Uma nova conversa recebe uma cópia do rascunho e do contexto; nada é enviado ao abrir.':'Current history and draft are preserved. A new chat receives a copy of the draft and context; opening sends nothing.'}</p>
      <p className="editorial-hint">{pt?'Este recorte é para chat e ideias. Produção semiautomática continua usando Codex. Modelos e capacidades variam por provedor.':'This choice applies to chat and ideas. Semi-automatic production still uses Codex. Models and capabilities vary by provider.'}</p>
      {choice==='both'?<button className="primary-button" data-od-id="provider-choice-review-both" disabled={busy||catalogs.codex.state!=='connected'||catalogs.claude.state!=='connected'||(['codex','claude'] as const).some(provider=>!!models[provider]&&!catalogs[provider].models.some(model=>model.id===models[provider]))} onClick={()=>onBoth({codexModelId:models.codex,claudeModelId:models.claude})}>{pt?'Revisar duas consultas':'Review two consultations'}</button>:<button className="primary-button" data-od-id="provider-choice-open-single" disabled={busy||catalogs[choice].state==='checking'||!!models[choice]&&!catalogs[choice].models.some(model=>model.id===models[choice])} onClick={()=>onCreate(choice,models[choice]||undefined)}>{pt?'Abrir nova conversa sem enviar':'Open new chat without sending'}</button>}
      {choice!=='both'&&catalogs[choice].state!=='connected'&&catalogs[choice].state!=='checking'&&<p role="status">{pt?'Você pode preparar a conversa, mas precisa conectar este provedor antes de enviar.':'You can prepare the chat, but must connect this provider before sending.'}</p>}
    </div>
  </FlowDialog>;
}
