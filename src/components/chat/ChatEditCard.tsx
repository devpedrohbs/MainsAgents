import type {ChatMessageItem} from '../../features/chat/model/Chat';
import type {ProductionRun} from '../../features/production/model';
import type {MediaJob} from '../../features/content/model';
import {useEffect,useState} from 'react';
import {chatEditStatus,offsetText,pairLine,windowText,type ChatEditAction,type ChatEditRequestView} from '../../features/chat/chatEdits';
import {storageProfile} from '../../data/IndexedDbStateStore';
import './chat-edit.css';

interface Props {
 request?: ChatEditRequestView;
 run?: ProductionRun;
 mediaJobs: readonly MediaJob[];
 pt: boolean;
 working?: boolean;
 onAdmit: (extra?: {choice?: string; editorAgentId?: string; sync?: {offsetSeconds: number}}) => void;
 onOption: (window: {start: number; end: number}) => void;
 onAction: (action: ChatEditAction) => void;
}

/** Status of an edit request made in THIS chat: real host/run state, the explicit choices it needs and its actions. */
export function ChatEditCard({request,run,mediaJobs,pt,working=false,onAdmit,onOption,onAction}:Props){
 const status=chatEditStatus(request,run,mediaJobs,pt);
 const label:Record<ChatEditAction,string>={'cancel-edit':pt?'Cancelar edição':'Cancel edit','cancel-adjust':pt?'Cancelar ajuste':'Cancel adjustment','revert':pt?'Voltar à versão anterior':'Back to the previous version','open-production':pt?'Abrir produção':'Open production','retry':pt?'Tentar de novo':'Try again','resume':pt?'Retomar':'Resume','cancel-measure':pt?'Cancelar pedido':'Cancel request'};
 const pair=pairLine(request,run,pt),wait=run?.stage==='blocked'&&run.blockReason==='provider-limit'?run.providerWait:undefined;
 return <section className={`chat-edit-card tone-${status.tone}`} aria-label={pt?'Edição pedida nesta conversa':'Edit requested in this chat'}>
  <div className="chat-edit-head" role="status" aria-live="polite">
   <span className="chat-edit-dot" aria-hidden="true"/>
   <b>{status.title}</b>
   {request?.kind==='adjust'&&request.window?<span className="chat-edit-window">{windowText(request.window)}</span>:null}
  </div>
  {status.progress!==undefined&&<div className="chat-edit-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={status.progress} aria-label={pt?'Progresso da exportação':'Export progress'}><span style={{width:`${status.progress}%`}}/></div>}
  {status.detail&&<p className="chat-edit-detail">{status.detail}</p>}
  {pair&&<p className="chat-edit-pair" data-od-id="chat-edit-pair">{pair}</p>}
  {wait&&<div className="chat-edit-wait" data-od-id="chat-edit-wait">
   <div><b>{pt?'Concluído e guardado':'Done and kept'}</b><ul>{wait.done.length?wait.done.map(item=><li key={item}>{item}</li>):<li>{pt?'Nada além do pedido salvo.':'Nothing beyond the saved request.'}</li>}</ul></div>
   <div><b>{pt?'Falta':'Left'}</b><ul>{wait.remaining.map(item=><li key={item}>{item}</li>)}</ul></div>
  </div>}
  {request?.status==='needs-sync'&&request.messageId&&<SyncPanel request={request} pt={pt} working={working} onConfirm={offset=>onAdmit({sync:{offsetSeconds:offset}})}/>}
  {request?.status==='needs-choice'&&<div className="chat-edit-choices" role="group" aria-label={pt?'Vídeos desta mensagem':'Videos of this message'}>{request.choices?.map(item=><button key={item.id} type="button" className="soft-button" disabled={working} onClick={()=>onAdmit({choice:item.id})}>{item.name}</button>)}</div>}
  {request?.status==='needs-editor'&&<div className="chat-edit-choices" role="group" aria-label={pt?'Editores de vídeo':'Video editors'}>{request.editors?.map(item=><button key={item.id} type="button" className="soft-button" disabled={working} onClick={()=>onAdmit({editorAgentId:item.id})}>{item.name}</button>)}</div>}
  {request?.status==='needs-window'&&request.options?.length?<div className="chat-edit-choices" role="group" aria-label={pt?'Trechos possíveis':'Possible intervals'}>{request.options.map(item=><button key={`${item.kind}-${item.start}-${item.end}`} type="button" className="soft-button" disabled={working} onClick={()=>onOption({start:item.start,end:item.end})}>{item.label}</button>)}</div>:null}
  {status.actions.length>0&&<div className="chat-edit-actions">{status.actions.map(action=><button key={action} type="button" className={action==='revert'||action==='retry'?'soft-button':'text-link'} disabled={working} onClick={()=>action==='retry'?onAdmit():onAction(action)}>{label[action]}</button>)}</div>}
 </section>;
}

/**
 * Manual offset of a camera + screen pair (no proof from the audio): clear convention, a short CHECK preview (camera | screen
 * side by side with both audios) and an explicit confirmation. The result is shown as NOT verified.
 */
function SyncPanel({request,pt,working,onConfirm}:{request:ChatEditRequestView;pt:boolean;working:boolean;onConfirm:(offset:number)=>void}){
 const suggestion=request.sync?.candidateOffset,[value,setValue]=useState(suggestion!==undefined?String(suggestion):'0'),[preview,setPreview]=useState<string|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const offset=Number(value.replace(',','.')),valid=value.trim()!==''&&Number.isFinite(offset)&&Math.abs(offset)<=3600;
 useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview);},[preview]);
 const load=async()=>{if(!valid)return;setLoading(true);setError('');try{const response=await fetch(`/api/content/chat-edits/sync-preview?profile=${encodeURIComponent(storageProfile())}&session=${encodeURIComponent(request.sessionId)}&message=${encodeURIComponent(request.messageId)}&offset=${encodeURIComponent(String(offset))}`,{cache:'no-store'});if(!response.ok){const body=await response.json().catch(()=>({})) as {error?:string};throw new Error(body.error??(pt?'Prévia indisponível.':'Preview unavailable.'));}const url=URL.createObjectURL(await response.blob());setPreview(current=>{if(current)URL.revokeObjectURL(current);return url;});}catch(problem){setError(problem instanceof Error?problem.message:String(problem));}finally{setLoading(false);}};
 const id=`sync-${request.messageId}`;
 return <div className="chat-edit-sync" data-od-id="chat-edit-sync">
  {request.facts&&<p className="chat-edit-facts">{pt?'Câmera':'Camera'}: {request.facts.camera.name} ({request.facts.camera.hasAudio?(pt?'com áudio':'with audio'):(pt?'sem áudio':'no audio')}) · {pt?'Tela':'Screen'}: {request.facts.screen.name} ({request.facts.screen.hasAudio?(pt?'com áudio':'with audio'):(pt?'sem áudio':'no audio')})</p>}
  {request.sync?.status==='drift'&&request.sync.driftSeconds!==undefined&&<p className="chat-edit-warn" role="note">{pt?`Deriva medida: ${Math.round(Math.abs(request.sync.driftSeconds)*1000)} ms em ${String(request.sync.spanSeconds??'').replace('.',',')} s. Um atraso fixo não corrige deriva; confira a prévia em pontos diferentes.`:`Measured drift: ${Math.round(Math.abs(request.sync.driftSeconds)*1000)} ms over ${request.sync.spanSeconds} s. A fixed offset cannot fix drift; check the preview.`}</p>}
  <label htmlFor={id}>{pt?'Atraso da tela (segundos): positivo = a tela começou depois da câmera; negativo = antes.':'Screen offset (seconds): positive = the screen started after the camera; negative = before.'}</label>
  <div className="chat-edit-sync-row">
   <input id={id} type="text" inputMode="decimal" value={value} onChange={event=>{setValue(event.target.value);setPreview(null);}} aria-describedby={`${id}-hint`} disabled={working}/>
   <button type="button" className="soft-button" disabled={!valid||loading||working} onClick={()=>void load()}>{loading?(pt?'Gerando prévia…':'Rendering preview…'):(pt?'Prévia de 6 s':'6 s preview')}</button>
   <button type="button" className="primary-button" disabled={!valid||working} onClick={()=>onConfirm(offset)}>{pt?'Usar este atraso':'Use this offset'}</button>
  </div>
  <p id={`${id}-hint`} className="chat-edit-detail">{valid?offsetText(offset,pt):(pt?'Informe um número, ex.: 2,4 ou -1,7.':'Enter a number, e.g. 2.4 or -1.7.')}{suggestion!==undefined?` ${pt?`Sugestão do app (não comprovada): ${String(suggestion).replace('.',',')} s.`:`App suggestion (not proven): ${suggestion} s.`}`:''}</p>
  {preview&&<figure className="chat-adjust-preview"><video controls preload="metadata" src={preview} aria-label={pt?'Prévia de conferência: câmera à esquerda, tela à direita, os dois áudios juntos':'Check preview: camera left, screen right, both audios mixed'}/><figcaption>{pt?'Conferência (não é o vídeo final): câmera | tela, com os dois áudios. Eco = atraso errado.':'Check (not the final video): camera | screen with both audios. An echo means a wrong offset.'}</figcaption></figure>}
  {error&&<p className="chat-edit-warn" role="alert">{error}</p>}
 </div>;
}

/** Preview of ONLY the adjusted window (host route; it refuses when the file no longer matches its sha256). */
export function AdjustPreview({message,pt}:{message:ChatMessageItem;pt:boolean}){
 const preview=message.adjustPreview;if(!preview)return null;
 const src=`/api/content/productions/${encodeURIComponent(preview.runId)}/adjust-preview?profile=${encodeURIComponent(storageProfile())}&sha256=${encodeURIComponent(preview.sha256)}`;
 return <figure className="chat-adjust-preview">
  <video controls preload="metadata" src={src} aria-label={pt?`Prévia do trecho ${windowText(preview.window)}`:`Preview of ${windowText(preview.window)}`}/>
  <figcaption>{pt?`Prévia do trecho ${windowText(preview.window)} (só o trecho ajustado)`:`Preview of ${windowText(preview.window)} (adjusted window only)`}</figcaption>
 </figure>;
}

/** Videos attached to a user message, shown as names (paths stay in the title). */
export function MessageAttachments({message,pt}:{message:ChatMessageItem;pt:boolean}){
 if(!message.attachments?.length)return null;
 return <div className="chat-message-attachments" aria-label={pt?'Vídeos anexados':'Attached videos'}>{message.attachments.map(item=><span key={item.path} title={item.path}>🎞 {item.name}{item.role?<em className="chat-attachment-role"> · {item.role==='camera'?(pt?'Câmera':'Camera'):(pt?'Tela':'Screen')}</em>:null}</span>)}</div>;
}
