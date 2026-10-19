import {useEffect,useMemo,useRef,useState} from 'react';
import {SelectMenu} from '../common/SelectMenu';
import {useStudioDraftField,clearStudioDraft} from '../../features/content/studioDrafts';
import {runDraftScope} from '../../features/production/productionDrafts';
import {storageProfile} from '../../data/IndexedDbStateStore';
import {activeRow,captionRowErrors,captionWarningText,formatClock,newRowKey,rowErrorText,rowsFromSegments,rowsToSegments,sameRows,type CaptionRow} from '../../features/production/captionReview';
import type {ProductionRun} from '../../features/production/model';
import {SrtWorkbench,type SrtVideoOption} from '../content/SrtWorkbench';
import './caption-review.css';

type Act=(action:string,data?:Record<string,unknown>)=>Promise<ProductionRun|undefined>;
interface Capabilities {available:boolean;transcribe:boolean;reasons?:string[];transcribeReasons?:string[]}
const parseRows=(value:string):CaptionRow[]|null=>{try{const rows=JSON.parse(value);return Array.isArray(rows)&&rows.every(r=>r&&typeof r.key==='string'&&typeof r.start==='string'&&typeof r.end==='string'&&typeof r.text==='string')?rows:null}catch{return null}};

/**
 * Speech captions of the video under review — not the post caption. Default (and main path): a separate, editable SRT
 * for CapCut (SrtWorkbench), with nothing burned into the image. The old B05 burn (versions approved with a style and
 * rendered into a NEW MP4) stays available only as an explicit, collapsed secondary choice; typing never renders.
 */
export function CaptionReview({run,pt,busy,act,videos=[]}:{run:ProductionRun;pt:boolean;busy:boolean;act:Act;videos?:SrtVideoOption[]}){
 const say=(a:string,b:string)=>pt?a:b;
 const captions=run.captions,current=!!captions&&!!run.outputVideo&&(sameRef(captions.base,run.outputVideo)||sameRef(captions.output,run.outputVideo));
 const latest=current?captions!.versions.at(-1):undefined,base=current?captions!.base:run.outputVideo!;
 const duration=current?captions!.durationSeconds:0;
 const scope=runDraftScope(run.workspaceId,run.id,`captions-${base.sha256}`);
 const [saved,setSaved]=useStudioDraftField(scope,`rows-v${latest?.version??0}`,'');
 const rows=useMemo(()=>parseRows(saved)??(latest?rowsFromSegments(latest.segments):[]),[saved,latest]);
 const setRows=(next:CaptionRow[])=>{setConfirm(false);setSaved(JSON.stringify(next));};
 const [style,setStyle]=useState<string>(captions?.approved?.style??captions?.output?.style??'classic');
 const [mode,setMode]=useState<'sentences'|'words'>('sentences');
 const [confirm,setConfirm]=useState(false),[error,setError]=useState(''),[caps,setCaps]=useState<Capabilities|null>(null),[time,setTime]=useState(0);
 const video=useRef<HTMLVideoElement>(null);
 // The burn panel opens by itself only to show an existing burn/transcription state, never to start one.
 const [legacyOpen,setLegacyOpen]=useState(()=>!!current&&(!!captions!.output||captions!.render?.status==='running'||captions!.transcription?.status==='running'));
 const srtVideos=videos.length?videos:[{...base,name:pt?'Vídeo desta produção':'This production video'}];
 // Faithful short preview (FFmpeg/libass, same ASS and font as the final file) of the saved version+style.
 const [preview,setPreview]=useState<{url:string;version:number;hash:string;style:string;start:number;duration:number;font?:string;cached?:boolean}|null>(null);
 const [previewBusy,setPreviewBusy]=useState(false),[previewError,setPreviewError]=useState(''),previewAbort=useRef<AbortController|null>(null);
 useEffect(()=>()=>{previewAbort.current?.abort();},[]);
 useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview.url);},[preview]);
 useEffect(()=>{let live=true;fetch(`/api/content/productions/captions-capabilities?profile=${encodeURIComponent(storageProfile())}`,{cache:'no-store'}).then(r=>r.json()).then(value=>{if(live)setCaps(value)}).catch(()=>{if(live)setCaps({available:false,transcribe:false,reasons:[say('Não foi possível verificar o motor de legendas.','Could not check the caption engine.')]})});return()=>{live=false}},[]);// eslint-disable-line react-hooks/exhaustive-deps

 const transcription=current?captions!.transcription:undefined,render=current?captions!.render:undefined;
 const running=transcription?.status==='running'||render?.status==='running',locked=busy||running;
 const errors=captionRowErrors(rows,duration),valid=rows.length>0&&!Object.keys(errors).length;
 const dirty=latest?!sameRows(rows,latest.segments):rows.length>0;
 const approved=!!latest&&captions?.approved?.hash===latest.hash&&captions.approved.version===latest.version;
 const approvedStyle=approved?captions!.approved!.style:undefined;
 const showingBurned=current&&!!captions!.output&&sameRef(captions!.output,run.outputVideo);
 const burnedCurrent=showingBurned&&approved&&captions!.output!.hash===latest!.hash&&captions!.output!.style===approvedStyle;
 const styles=run.captionStyles??[{id:'classic',label:say('Clássico','Classic')},{id:'boxed',label:say('Caixa','Boxed')},{id:'highlight',label:say('Destaque','Highlight')}];
 const playerSrc=`/api/content/media/file?profile=${encodeURIComponent(storageProfile())}&contentId=${encodeURIComponent(run.contentId)}&assetId=${encodeURIComponent(base.assetId)}&versionId=${encodeURIComponent(base.versionId)}`;
 const live=activeRow(rows,time);
 const previewCurrent=!!preview&&!!latest&&preview.version===latest.version&&preview.hash===latest.hash&&preview.style===style;
 const makePreview=async()=>{
  if(!latest)return;previewAbort.current?.abort();const abort=new AbortController();previewAbort.current=abort;setPreviewBusy(true);setPreviewError('');
  const at=Math.max(0,Math.min(time,duration))||latest.segments[0]?.start||0;
  try{
   const response=await fetch(`/api/content/productions/${encodeURIComponent(run.id)}/caption-preview?profile=${encodeURIComponent(storageProfile())}&version=${latest.version}&hash=${latest.hash}&style=${encodeURIComponent(style)}&start=${at.toFixed(1)}`,{cache:'no-store',signal:abort.signal});
   if(!response.ok){const body=await response.json().catch(()=>({}));throw Error(body.error??say('Não foi possível gerar a prévia.','Could not create the preview.'));}
   const info=JSON.parse(response.headers.get('x-caption-preview')??'{}'),blob=await response.blob();
   if(abort.signal.aborted)return;setPreview({url:URL.createObjectURL(blob),...info});
  }catch(error){if(!abort.signal.aborted)setPreviewError(error instanceof Error?error.message:String(error));}
  finally{if(previewAbort.current===abort){previewAbort.current=null;setPreviewBusy(false);}}
 };
 const cancelPreview=()=>{previewAbort.current?.abort();previewAbort.current=null;setPreviewBusy(false);};

 const run_=async(action:string,data:Record<string,unknown>={})=>{setError('');const result=await act(action,data);if(!result)setError(say('Confira a mensagem acima e tente novamente.','Check the message above and try again.'));return result;};
 const save=async()=>{const result=await run_('captions-save',{baseVersion:latest?.version??0,segments:rowsToSegments(rows)});if(result)clearStudioDraft(scope);};
 const importSrt=async(file:File|undefined)=>{if(!file)return;if(file.size>2_000_000){setError(say('Arquivo SRT grande demais.','SRT file too large.'));return;}const text=await file.text();const result=await run_('captions-save',{baseVersion:latest?.version??0,srt:text});if(result)clearStudioDraft(scope);};
 const patch=(key:string,change:Partial<CaptionRow>)=>setRows(rows.map(row=>row.key===key?{...row,...change}:row));
 const now=()=>formatClock(Math.round((video.current?.currentTime??0)*100)/100);
 const insertAfter=(index:number)=>{const prev=rows[index],start=prev?prev.end:formatClock(0);setRows([...rows.slice(0,index+1),{key:newRowKey(),start,end:start,text:''},...rows.slice(index+1)]);};

 return <section className="production-section caption-review" aria-label={say('Legendas de fala no vídeo','Speech captions in the video')}>
  <SrtWorkbench key={`${storageProfile()}:${run.workspaceId}:${run.contentId}`} contentId={run.contentId} workspaceId={run.workspaceId} videos={srtVideos} defaultVideo={base} pt={pt} embedded/>
  <details className="caption-review-legacy" open={legacyOpen} onToggle={event=>setLegacyOpen(event.currentTarget.open)}>
  <summary>{say('Avançado (não recomendado): gravar legendas na imagem de um novo MP4','Advanced (not recommended): burn captions into the image of a new MP4')}</summary>
  <p className="editorial-hint">{say('Só use se quiser mesmo o texto gravado no vídeo. O padrão é o SRT separado acima, editável no CapCut. Estas legendas são diferentes da legenda do post. Nenhuma IA corrige o que foi dito: revise o texto e os tempos.','Use only if you really want text burned into the video. The default is the separate SRT above, editable in CapCut. These are different from the post caption. No AI corrects what was said: review text and timing.')}</p>
  {caps&&!caps.available&&<p className="delivery-error" role="alert">{say('Gravação de legendas indisponível: ','Caption burning unavailable: ')}{(caps.reasons??[]).join(' ')}</p>}
  <div className="caption-review-player">
   <video ref={video} src={playerSrc} controls preload="metadata" onTimeUpdate={event=>setTime(event.currentTarget.currentTime)} aria-label={say('Vídeo sem legendas para conferir os tempos','Uncaptioned video to check timing')}/>
   {live&&<span className={`caption-review-overlay caption-review-overlay--${style}`} aria-hidden="true">{live.text}</span>}
  </div>
  <p className="thumbnail-gallery-note">{say('A sobreposição acima é só uma prévia aproximada no navegador; use “Ver prévia final” para conferir um trecho curto exatamente como o FFmpeg grava.','The overlay above is only an approximate browser preview; use “Final preview” to check a short part exactly as FFmpeg burns it.')} {duration>0&&say(`Duração: ${formatClock(duration)}.`,`Duration: ${formatClock(duration)}.`)}</p>

  <div className="caption-review-start">
   <SelectMenu ariaLabel={say('Tipo de legenda','Caption type')} value={mode} disabled={locked} onChange={value=>setMode(value==='words'?'words':'sentences')} options={[{value:'sentences',label:say('Por frase','By sentence')},{value:'words',label:say('Palavra a palavra (1–3 por vez)','Word by word (1–3 at a time)')}]}/>
   <button type="button" className="soft-button" disabled={locked||caps?.transcribe===false} onClick={()=>void run_('captions-transcribe',mode==='words'?{mode}:{})}>{latest?say('Transcrever de novo (Whisper local)','Transcribe again (local Whisper)'):say('Transcrever fala (Whisper local)','Transcribe speech (local Whisper)')}</button>
   <label className="soft-button caption-review-file">{say('Importar SRT','Import SRT')}<input type="file" accept=".srt,text/plain" disabled={locked} onChange={event=>{void importSrt(event.target.files?.[0]);event.target.value=''}}/></label>
   {!rows.length&&<button type="button" className="soft-button" disabled={locked} onClick={()=>setRows([{key:newRowKey(),start:formatClock(0),end:formatClock(Math.min(2,duration||2)),text:''}])}>{say('Escrever manualmente','Write manually')}</button>}
   {caps?.transcribe===false&&<span className="editorial-hint">{say('Transcrição local indisponível neste PC; escreva ou importe um SRT.','Local transcription unavailable on this PC; write or import an SRT.')}</span>}
  </div>
  {transcription?.status==='running'&&<p role="status">{say('Transcrevendo localmente… isso pode levar alguns minutos.','Transcribing locally… this can take a few minutes.')} <button type="button" className="text-link" onClick={()=>void run_('captions-cancel')}>{say('Cancelar','Cancel')}</button></p>}
  {transcription?.status==='failed'&&<p className="delivery-error" role="alert">{transcription.error}</p>}
  {transcription?.status==='interrupted'&&<p className="editorial-hint" role="status">{say('A transcrição foi interrompida (o app fechou). Inicie de novo se quiser.','Transcription was interrupted (the app closed). Start again if you want.')}</p>}

  {latest&&<p className="caption-review-version">{say(`Versão v${latest.version}`,`Version v${latest.version}`)} · {latest.origin==='transcript'?say('transcrição local','local transcript'):latest.origin==='srt'?say('SRT importado','imported SRT'):say('editada por você','edited by you')} · #{latest.hash.slice(0,8)}{approved&&<> · <strong>{say(`aprovada (${approvedStyle})`,`approved (${approvedStyle})`)}</strong>{captions!.approved!.previewed?say(' · conferida na prévia final',' · checked in the final preview'):''}</>}</p>}
  {latest&&latest.warnings.length>0&&<ul className="caption-review-warnings" role="note">{latest.warnings.map(w=><li key={w}>{captionWarningText(w,pt)}</li>)}</ul>}

  {rows.length>0&&<ol className="caption-review-rows">
   {rows.map((row,index)=>{const rowErrors=errors[row.key]??[],id=`caption-${row.key}`,isLive=live?.key===row.key;return <li key={row.key} className="caption-review-row" data-live={isLive} data-invalid={rowErrors.length>0}>
    <div className="caption-review-times">
     <label htmlFor={`${id}-start`}>{say('Início','Start')}</label><input id={`${id}-start`} aria-label={say(`Início da legenda ${index+1}`,`Start of caption ${index+1}`)} value={row.start} disabled={locked} aria-invalid={rowErrors.some(e=>['start','order','overlap'].includes(e))} onChange={event=>patch(row.key,{start:event.target.value})}/>
     <button type="button" className="text-link" disabled={locked} onClick={()=>patch(row.key,{start:now()})}>{say('= agora','= now')}</button>
     <label htmlFor={`${id}-end`}>{say('Fim','End')}</label><input id={`${id}-end`} aria-label={say(`Fim da legenda ${index+1}`,`End of caption ${index+1}`)} value={row.end} disabled={locked} aria-invalid={rowErrors.some(e=>['end','order','outside','short','long'].includes(e))} onChange={event=>patch(row.key,{end:event.target.value})}/>
     <button type="button" className="text-link" disabled={locked} onClick={()=>patch(row.key,{end:now()})}>{say('= agora','= now')}</button>
     <button type="button" className="text-link" onClick={()=>{const at=rowsToSegments([row])[0].start;if(video.current&&Number.isFinite(at)){video.current.currentTime=at;void video.current.play().catch(()=>{});}}}>{say('Ouvir','Play')}</button>
    </div>
    <textarea aria-label={say(`Texto da legenda ${index+1}`,`Text of caption ${index+1}`)} rows={2} value={row.text} disabled={locked} aria-invalid={rowErrors.some(e=>['text','chars','lines','length'].includes(e))} onChange={event=>patch(row.key,{text:event.target.value})}/>
    {rowErrors.length>0&&<p className="thumbnail-gallery-error" role="alert">{rowErrors.map(e=>rowErrorText(e,pt,duration)).join(' ')}</p>}
    <div className="caption-review-row-actions"><button type="button" className="text-link" disabled={locked} onClick={()=>insertAfter(index)}>{say('+ legenda depois','+ caption after')}</button><button type="button" className="text-link" disabled={locked} onClick={()=>setRows(rows.filter(r=>r.key!==row.key))}>{say('Remover','Remove')}</button></div>
   </li>;})}
  </ol>}
  {dirty&&<div className="caption-review-actions"><button type="button" className="primary-button" disabled={locked||!valid} onClick={()=>void save()}>{say(`Salvar como v${(latest?.version??0)+1}`,`Save as v${(latest?.version??0)+1}`)}</button>{latest&&<button type="button" className="soft-button" disabled={locked} onClick={()=>clearStudioDraft(scope)}>{say('Descartar alterações','Discard changes')}</button>}{!valid&&rows.length>0&&<span className="editorial-hint">{say('Corrija as linhas marcadas antes de salvar.','Fix the marked rows before saving.')}</span>}</div>}

  {latest&&!dirty&&<div className="caption-review-preview" aria-label={say('Prévia fiel das legendas','Faithful caption preview')}>
   <div className="caption-review-preview-head">
    {previewBusy?<><span role="status">{say('Gerando prévia com o motor final (FFmpeg/libass)…','Rendering preview with the final engine (FFmpeg/libass)…')}</span><button type="button" className="text-link" onClick={cancelPreview}>{say('Cancelar','Cancel')}</button></>
     :<button type="button" className="soft-button" disabled={busy||caps?.available===false} onClick={()=>void makePreview()}>{previewCurrent?say('Gerar outro trecho a partir do ponto atual','Preview another part from the current time'):say(`Ver prévia final de até 6 s (v${latest.version}, estilo ${style})`,`Final preview up to 6 s (v${latest.version}, ${style} style)`)}</button>}
   </div>
   {previewError&&<p className="delivery-error" role="alert">{previewError}</p>}
   {preview&&previewCurrent?<>
    <video className="caption-review-preview-video" src={preview.url} controls autoPlay muted={false} aria-label={say('Prévia com as legendas gravadas como no arquivo final','Preview with captions burned as in the final file')}/>
    <p className="thumbnail-gallery-note">{say(`Trecho ${formatClock(preview.start)}–${formatClock(preview.start+preview.duration)} gerado pelo mesmo motor, fonte${preview.font?` (${preview.font})`:''} e estilo do arquivo final, para a v${preview.version} #${preview.hash.slice(0,8)}. Só a resolução pode ser menor. O vídeo original não foi alterado e esta prévia não entra na biblioteca.`,`Part ${formatClock(preview.start)}–${formatClock(preview.start+preview.duration)} rendered with the same engine, font${preview.font?` (${preview.font})`:''} and style as the final file, for v${preview.version} #${preview.hash.slice(0,8)}. Only the resolution may be lower. The original video was not changed and this preview is not added to the library.`)}</p>
   </>:preview&&!previewBusy&&<p className="editorial-hint" role="status">{say('A versão ou o estilo mudou depois da última prévia. Gere de novo para conferir.','The version or style changed after the last preview. Render again to check.')}</p>}
  </div>}
  {latest&&!dirty&&<div className="caption-review-approve">
   <label>{say('Estilo da legenda','Caption style')}<SelectMenu ariaLabel={say('Estilo da legenda no vídeo','Caption style in the video')} value={style} disabled={locked} onChange={value=>{setStyle(value);setConfirm(false)}} options={styles.map(s=>({value:s.id,label:s.label}))}/></label>
   {!(approved&&approvedStyle===style)&&<><label className="production-check"><input type="checkbox" checked={confirm} disabled={locked} onChange={event=>setConfirm(event.target.checked)}/>{say(`Revisei o texto e os tempos da v${latest.version} e aprovo gravar com este estilo.`,`I reviewed text and timing of v${latest.version} and approve burning it with this style.`)}</label>
    <button type="button" className="primary-button" disabled={locked||!confirm} onClick={()=>void run_('captions-approve',{authorize:true,version:latest.version,hash:latest.hash,style}).then(()=>setConfirm(false))}>{say('Aprovar legendas','Approve captions')}</button></>}
   {approved&&approvedStyle===style&&!burnedCurrent&&<button type="button" className="primary-button" disabled={locked||caps?.available===false} onClick={()=>void run_('captions-render',{authorize:true,version:latest.version,hash:latest.hash,style})}>{say('Gravar legendas num novo vídeo','Burn captions into a new video')}</button>}
  </div>}
  {render?.status==='running'&&<p role="status">{say(`Gravando legendas no vídeo… ${render.progress??0}%`,`Burning captions… ${render.progress??0}%`)} <button type="button" className="text-link" onClick={()=>void run_('captions-cancel')}>{say('Cancelar','Cancel')}</button></p>}
  {render?.status==='failed'&&<p className="delivery-error" role="alert">{render.error}</p>}
  {render?.status==='canceled'&&<p className="editorial-hint" role="status">{say('Gravação cancelada; nenhum vídeo parcial foi registrado.','Burn canceled; no partial video was registered.')}</p>}
  {render?.status==='interrupted'&&<p className="editorial-hint" role="status">{say('A gravação foi interrompida (o app fechou). Grave de novo; nada parcial foi usado.','The burn was interrupted (the app closed). Burn again; nothing partial was used.')}</p>}
  {showingBurned&&<div className="caption-review-output" role="status">
   <p>{say(`Em revisão agora: a versão COM legendas v${captions!.output!.version} (${captions!.output!.style}). Áudio ${captions!.output!.audio==='copied'?'copiado sem recodificar':captions!.output!.audio==='reencoded'?'recodificado em AAC':'ausente'}; fonte ${captions!.output!.font}. O vídeo sem legendas continua salvo e há um SRT da mesma versão para o CapCut.`,`Under review now: the version WITH captions v${captions!.output!.version} (${captions!.output!.style}). Audio ${captions!.output!.audio}; font ${captions!.output!.font}. The uncaptioned video stays saved and an SRT of the same version is available for CapCut.`)}</p>
   {!burnedCurrent&&<p className="editorial-hint">{say('As legendas mudaram depois desta gravação. Aprove e grave de novo, ou aprove o vídeo como está.','Captions changed after this burn. Approve and burn again, or approve the video as it is.')}</p>}
   <button type="button" className="soft-button" disabled={locked} onClick={()=>void run_('captions-remove')}>{say('Voltar ao vídeo sem legendas','Back to the uncaptioned video')}</button>
  </div>}
  {error&&<p className="delivery-error" role="alert">{error}</p>}
  </details>
 </section>;
}
function sameRef(a?:{assetId:string;versionId:string;sha256:string}|null,b?:{assetId:string;versionId:string;sha256:string}|null){return !!a&&!!b&&a.assetId===b.assetId&&a.versionId===b.versionId&&a.sha256===b.sha256;}
