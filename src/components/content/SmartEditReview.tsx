import {useState} from 'react';
import {useLanguage} from '../../app/LanguageProvider';
import './smart-edit-review.css';

export interface ReviewInterval {start:number;end:number}
export interface ReviewCandidate extends ReviewInterval {id:string;kind:string;reason:string;label:string}
export interface ManualRemoval extends ReviewInterval {id:string;reason:string}
export function reviewTimeline(duration:number,intervals:readonly ReviewInterval[]) {
  if(!Number.isFinite(duration)||duration<=0||intervals.length>500)throw Error('Invalid source duration or too many cuts.');
  const sorted=intervals.map(item=>({...item})).sort((a,b)=>a.start-b.start);
  const removed:ReviewInterval[]=[];
  for(const item of sorted){
    if(!Number.isFinite(item.start)||!Number.isFinite(item.end)||item.start<0||item.end<=item.start||item.end>duration)throw Error('Choose a finite interval within the original video.');
    const last=removed.at(-1);if(last&&item.start<=last.end)last.end=Math.max(last.end,item.end);else removed.push(item);
  }
  const kept:ReviewInterval[]=[];let cursor=0;
  for(const item of removed){if(item.start>cursor)kept.push({start:cursor,end:item.start});cursor=item.end;}
  if(cursor<duration)kept.push({start:cursor,end:duration});
  return {removed,kept,duration:kept.reduce((sum,item)=>sum+item.end-item.start,0)};
}
export const timestamp=(seconds:number)=>`${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toFixed(2).padStart(5,'0')}`;
export interface ReviewAnimation {id:string;kind:'title'|'lowerThird'|'cta';text:string;subtitle?:string;start:number;duration:number}

export function SmartAnimationReview({animations,duration,onChange,available,disabled=false}:{animations:ReviewAnimation[];duration:number;onChange:(value:ReviewAnimation[])=>void;available:boolean;disabled?:boolean}) {
  const {locale}=useLanguage(),pt=locale==='pt-BR';
  const labels={title:pt?'Título de entrada':'Opening title',lowerThird:pt?'Identificação / tarja':'Identification / lower third',cta:pt?'CTA final':'Closing CTA'};
  return <fieldset className="smart-manual" data-od-id="smart-animations"><legend>{pt?'Animações sobre o vídeo editado':'Animations over the edited video'}</legend><p>{pt?'Tempos abaixo referem-se à saída já cortada. Texto simples, até 80 caracteres (nome até 60). O CTA sempre fecha o vídeo.':'Times below refer to the trimmed output. Plain text, up to 80 characters (name up to 60). The CTA always closes the video.'}</p>{!available&&<p role="status">{pt?'Renderer Remotion indisponível. Exportação sem animações continua possível se FFmpeg estiver disponível.':'Remotion renderer unavailable. Export without animations is still possible if FFmpeg is available.'}</p>}{(['title','lowerThird','cta'] as const).map(kind=>{
    const item=animations.find(animation=>animation.kind===kind);
    const patch=(change:Partial<ReviewAnimation>)=>onChange(animations.map(animation=>animation.kind===kind?{...animation,...change}:animation));
    return <div className="smart-animation" key={kind}><label><input type="checkbox" aria-label={`Smart overlay ${kind}`} checked={!!item} disabled={disabled||!item&&!available||duration<0.5} onChange={()=>onChange(item?animations.filter(animation=>animation.kind!==kind):[...animations,{id:`overlay-${kind}`,kind,text:'',start:kind==='cta'?Math.max(0,duration-Math.min(3,duration)):0,duration:Math.min(3,duration)}])}/>{labels[kind]}</label>{item&&<><label>{pt?'Texto':'Text'}<input aria-label={`Smart overlay text ${kind}`} maxLength={kind==="lowerThird"?60:80} value={item.text} disabled={disabled} onChange={event=>patch({text:event.target.value})}/></label>{kind==='lowerThird'&&<label>{pt?'Função (opcional)':'Role (optional)'}<input aria-label="Smart overlay subtitle" maxLength={80} value={item.subtitle??''} disabled={disabled} onChange={event=>patch({subtitle:event.target.value||undefined})}/></label>}<div className="smart-range-fields">{kind!=='cta'&&<label>{pt?'Início na saída (s)':'Start in output (s)'}<input aria-label={`Smart overlay start ${kind}`} type="number" min={0} step="0.1" value={item.start} disabled={disabled} onChange={event=>patch({start:Number(event.target.value)})}/></label>}<label>{pt?'Duração (s)':'Duration (s)'}<input aria-label={`Smart overlay duration ${kind}`} type="number" min="0.5" max={duration} step="0.1" value={item.duration} disabled={disabled} onChange={event=>patch({duration:Number(event.target.value)})}/></label></div></>}</div>;
  })}</fieldset>;
}

/** Read-only source review: callbacks change a draft, never the original media. */
export function SmartEditReview({duration,candidates,selectedIds,manual,onSelect,onManual,onPreview,disabled=false}:{duration:number;candidates:ReviewCandidate[];selectedIds:string[];manual:ManualRemoval[];onSelect:(ids:string[])=>void;onManual:(items:ManualRemoval[])=>void;onPreview:(interval:ReviewInterval)=>void;disabled?:boolean}) {
  const {locale}=useLanguage(),pt=locale==='pt-BR';
  const [start,setStart]=useState(''),[end,setEnd]=useState(''),[reason,setReason]=useState(''),[error,setError]=useState('');
  let timeline:ReturnType<typeof reviewTimeline>|undefined;
  try{timeline=reviewTimeline(duration,[...candidates.filter(item=>selectedIds.includes(item.id)),...manual]);}catch{/* Parent displays plan validation failure and prevents export. */}
  const range=(item:ReviewInterval)=>`${timestamp(item.start)} — ${timestamp(item.end)}`;
  return <section className="smart-cut-review" data-od-id="smart-cut-review">
    <h3>{pt?'Revise os trechos antes de remover':'Review segments before removal'}</h3>
    <p>{pt?'Silêncios sugeridos podem ser desmarcados. Possíveis repetições e retomadas ficam mantidas até você escolher; não são confirmação de fala errada.':'Suggested silences can be unchecked. Possible repetitions and retakes remain kept until you choose; they do not confirm incorrect speech.'}</p>
    <ul className="smart-candidates">{candidates.map(item=><li key={item.id} data-candidate-id={item.id}><label><input type="checkbox" disabled={disabled} checked={selectedIds.includes(item.id)} onChange={()=>onSelect(selectedIds.includes(item.id)?selectedIds.filter(id=>id!==item.id):[...selectedIds,item.id])}/><span><b>{item.label}</b><small>{range(item)} · {selectedIds.includes(item.id)?(pt?'Remover':'Remove'):(pt?'Manter':'Keep')}</small><small>{item.reason}</small>{item.kind!=='silence'&&<small>{pt?'Sugestão incerta: ouça o trecho antes de marcar.':'Uncertain suggestion: listen before selecting.'}</small>}</span></label><button className="soft-button" disabled={disabled} onClick={()=>onPreview(item)}>{pt?'Ouvir/ver trecho':'Listen/view segment'}</button></li>)}</ul>
    {!candidates.length&&<p>{pt?'Nenhum candidato nesta análise. Você ainda pode selecionar um intervalo manualmente.':'No candidates in this analysis. You can still select an interval manually.'}</p>}
    <fieldset className="smart-manual"><legend>{pt?'Selecionar fala para remover':'Select speech to remove'}</legend><p>{pt?'Indique no vídeo original o intervalo que você revisou e deseja retirar.':'Specify the interval in the original video that you reviewed and wish to remove.'}</p><div className="smart-range-fields"><label>{pt?'Início (s)':'Start (s)'}<input aria-label="Smart cut start" type="number" step="0.01" min="0" value={start} disabled={disabled} onChange={event=>setStart(event.target.value)}/></label><label>{pt?'Fim (s)':'End (s)'}<input aria-label="Smart cut end" type="number" step="0.01" min="0" max={duration} value={end} disabled={disabled} onChange={event=>setEnd(event.target.value)}/></label></div><label>{pt?'Motivo da sua seleção':'Reason for your selection'}<input aria-label="Smart cut reason" value={reason} maxLength={200} disabled={disabled} onChange={event=>setReason(event.target.value)}/></label><div className="editorial-actions"><button className="soft-button" disabled={disabled||!start||!end} onClick={()=>{try{const item={start:Number(start),end:Number(end)};reviewTimeline(duration,[item]);onPreview(item);setError('');}catch{setError(pt?'Informe um intervalo válido dentro do vídeo original.':'Enter a valid interval within the original video.');}}}>{pt?'Ouvir seleção':'Listen to selection'}</button><button className="soft-button" data-od-id="smart-add-manual" disabled={disabled||!start||!end||manual.length>=100} onClick={()=>{try{const item={id:crypto.randomUUID(),start:Number(start),end:Number(end),reason:reason.trim()||(pt?'Seleção manual revisada':'Reviewed manual selection')};reviewTimeline(duration,[...manual,item]);onManual([...manual,item]);setStart('');setEnd('');setReason('');setError('');}catch{setError(pt?'Informe um intervalo válido dentro do vídeo original.':'Enter a valid interval within the original video.');}}}>{pt?'Adicionar remoção revisada':'Add reviewed removal'}</button></div>{error&&<p role="alert">{error}</p>}</fieldset>
    {manual.length>0&&<ul className="smart-manual-list">{manual.map(item=><li key={item.id}><span>{range(item)} · {item.reason}</span><button className="text-link" disabled={disabled} onClick={()=>onManual(manual.filter(value=>value.id!==item.id))}>{pt?'Manter este trecho':'Keep this segment'}</button></li>)}</ul>}
    {timeline&&<div className="smart-timeline-summary" data-od-id="smart-timeline"><p><strong>{pt?'Original':'Original'}: {timestamp(duration)}</strong><strong>{pt?'Saída prevista':'Expected output'}: {timestamp(timeline.duration)}</strong></p><details open><summary>{pt?'Intervalos mantidos':'Kept intervals'} ({timeline.kept.length})</summary><ol>{timeline.kept.map((item,index)=><li key={index}>{range(item)}</li>)}</ol></details><details><summary>{pt?'Intervalos removidos':'Removed intervals'} ({timeline.removed.length})</summary><ol>{timeline.removed.map((item,index)=><li key={index}>{range(item)}</li>)}</ol></details></div>}
  </section>;
}
