import {useEffect,useRef,useState} from 'react';
import type {ReasoningEffort} from '../../features/chat/model/Chat';
import {providerShortName} from '../../features/chat/providerChoice';
import {useLanguage} from '../../app/LanguageProvider';
import {Icon} from '../common/Icon';
import {choiceStatus} from './ProviderChoice';

const efforts:readonly {value:ReasoningEffort;pt:string;en:string;hintPt:string;hintEn:string}[]=[
  {value:'low',pt:'Leve',en:'Light',hintPt:'Respostas rápidas',hintEn:'Quick replies'},
  {value:'medium',pt:'Médio',en:'Medium',hintPt:'Equilíbrio',hintEn:'Balanced'},
  {value:'high',pt:'Alto',en:'High',hintPt:'Pensa mais',hintEn:'Thinks more'},
  {value:'xhigh',pt:'Extra',en:'Extra',hintPt:'O mais cuidadoso',hintEn:'Most careful'},
];
export const effortLabel=(effort:ReasoningEffort,pt:boolean)=>{const item=efforts.find(entry=>entry.value===effort)??efforts[1];return pt?item.pt:item.en;};

/** Rising bars: how hard the model thinks, readable without words. */
function EffortBars({level}:{level:number}){
  return <span className="effort-bars" aria-hidden="true">{[0,1,2,3].map(index=><i key={index} className={index<=level?'on':''}/>)}</span>;
}

/**
 * The model of this chat, chosen in the composer: one pill (provider, model, effort) that opens a panel with the
 * models as a list and the effort as four steps. Changing the provider still goes through the provider dialog.
 */
export function ModelPicker({providerId,models,modelsLoading,modelId,effort,connection,locked,busy,providerReadOnly,providerBusy,onModel,onEffort,onProvider,onSkill,onCanvas}:{
  providerId:string;models:readonly {id:string;name:string}[];modelsLoading:boolean;modelId:string;effort:ReasoningEffort;connection:string;
  locked:boolean;busy:boolean;providerReadOnly:boolean;providerBusy:boolean;
  onModel:(modelId:string)=>void;onEffort:(effort:ReasoningEffort)=>void;onProvider:()=>void;onSkill:()=>void;onCanvas:()=>void;
}){
  const {locale}=useLanguage(),pt=locale==='pt-BR';
  const [open,setOpen]=useState(false);
  const root=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!open)return;
    const close=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};
    document.addEventListener('pointerdown',close);
    return()=>document.removeEventListener('pointerdown',close);
  },[open]);
  const provider=providerShortName(providerId);
  const current=models.find(model=>model.id===modelId);
  const modelName=current?.name||modelId||(pt?'Padrão':'Default');
  const level=Math.max(0,efforts.findIndex(item=>item.value===effort));
  const offline=connection!=='connected'&&connection!=='checking';
  const options=[
    {id:'',name:pt?'Padrão do provedor':'Provider default',note:pt?'O que estiver configurado no '+provider:'Whatever '+provider+' is set to'},
    ...(modelId&&!models.some(model=>model.id===modelId)?[{id:modelId,name:modelId,note:pt?'Salvo nesta conversa':'Saved in this chat'}]:[]),
    ...models.map(model=>({id:model.id,name:model.name,note:''})),
  ];
  const chatLabel=`${pt?'Conversa':'Chat'}: ${provider}`;
  return <div className={`composer-options-root model-picker${open?' is-open':''}`} ref={root} data-od-id="conversation-provider" data-provider={providerId}
    onKeyDown={event=>{if(event.key==='Escape'&&open){event.preventDefault();setOpen(false);root.current?.querySelector<HTMLButtonElement>('.composer-options-trigger')?.focus();}}}>
    <button type="button" className="composer-options-trigger model-picker-trigger" aria-haspopup="dialog" aria-expanded={open}
      aria-label={pt?`Modelo: ${provider} · ${modelName} · esforço ${effortLabel(effort,pt)}`:`Model: ${provider} · ${modelName} · ${effortLabel(effort,pt)} effort`}
      title={pt?'Modelo, esforço e skills':'Model, effort and skills'} onClick={()=>setOpen(value=>!value)}>
      <span className="model-picker-dot" aria-hidden="true"/>
      <span className="model-picker-name">{current||modelId?modelName:provider}</span>
      <EffortBars level={level}/>
      <Icon name="chevron" className="model-picker-chevron"/>
    </button>
    {offline&&<span className="model-picker-status" role="status">{choiceStatus(connection,pt)}</span>}
    {/* Kept mounted (hidden when closed): the provider switch and its status stay in the document for assistive tech and UI tests. */}
    <div className="composer-options-popover model-picker-pop" role="dialog" hidden={!open} aria-label={pt?'Como o agente responde':'How the agent responds'}>
      <div className="model-picker-provider">
        <span className="model-picker-dot" aria-hidden="true"/>
        <span className="model-picker-provider-text"><b>{provider}</b><small>{connection==='checking'?(pt?'Verificando conexão…':'Checking connection…'):choiceStatus(connection,pt)}</small></span>
        {providerReadOnly?<span className="provider-choice-chip" data-od-id="conversation-provider-label">{chatLabel}</span>
          :<button type="button" className="provider-choice-chip model-picker-switch" data-od-id="generate-with" data-action={pt?'Trocar':'Switch'} disabled={providerBusy}
            title={providerBusy?(pt?'Aguarde a resposta atual para trocar o provedor.':'Wait for the current response to change the provider.'):`${chatLabel}${current?` · ${current.name}`:modelId?` · ${modelId}`:''} — ${pt?'trocar o provedor desta conversa':'change this chat’s provider'}`}
            onClick={()=>{setOpen(false);onProvider();}}>{chatLabel}</button>}
      </div>
      {locked&&<p className="model-picker-note" role="note">{pt?'Modelo definido nesta comparação. Inicie outra consulta para mudar.':'Model fixed for this comparison. Start another consultation to change it.'}</p>}
      <div className="model-picker-section">
        <span className="model-picker-heading">{pt?'Modelo':'Model'}</span>
        <div className="model-select" role="radiogroup" aria-label={pt?'Modelo':'Model'}>
          {modelsLoading?<p className="model-picker-empty">{pt?'Carregando modelos…':'Loading models…'}</p>:options.map(option=>{const selected=option.id===modelId;
            return <button type="button" role="radio" aria-checked={selected} key={option.id||'default'} className={`model-option${selected?' is-selected':''}`} disabled={locked||busy}
              onClick={()=>onModel(option.id)}>
              <span className="model-option-text"><b>{option.name}</b>{option.note&&<small>{option.note}</small>}</span>
              {selected&&<svg className="model-option-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>}
            </button>;})}
          {!modelsLoading&&!models.length&&<p className="model-picker-empty">{pt?'A lista de modelos não está disponível agora; o padrão do provedor continua valendo.':'The model list is unavailable right now; the provider default still applies.'}</p>}
        </div>
      </div>
      <div className="model-picker-section">
        <span className="model-picker-heading">{pt?'Esforço':'Effort'}<small>{pt?efforts[level].hintPt:efforts[level].hintEn}</small></span>
        <div className="effort-select" role="radiogroup" aria-label={pt?'Esforço do modelo':'Model effort'}>
          {efforts.map((item,index)=><button type="button" role="radio" key={item.value} aria-checked={item.value===effort} disabled={busy}
            className={`effort-option${item.value===effort?' is-selected':''}`} title={pt?item.hintPt:item.hintEn} onClick={()=>onEffort(item.value)}>
            <EffortBars level={index}/><span>{pt?item.pt:item.en}</span>
          </button>)}
        </div>
      </div>
      <div className="model-picker-actions">
        <button className="composer-skill-action" type="button" disabled={busy} onClick={()=>{setOpen(false);onSkill();}}><Icon name="spark"/>{pt?'Selecionar uma skill':'Select a skill'}<span>/</span></button>
        <button className="composer-skill-action" type="button" onClick={()=>{setOpen(false);onCanvas();}}><Icon name="canvas"/>{pt?'Escolher contexto no Canvas':'Choose Canvas context'}</button>
      </div>
    </div>
  </div>;
}
