import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useContentWorkflow} from '../../features/content/ContentWorkflowProvider';
import {useLanguage} from '../../app/LanguageProvider';
import {storageProfile} from '../../data/IndexedDbStateStore';
import type {AudioTreatment,EditPreviewData,EditRange,EditReviewData,MotionPlan} from '../../features/content/model';
import {emptyMotion,focusFromRawClick,outputTimeOf,pushHistory,rawTimeOf,reviewWords,snapRemovalToWords,userCue,withUserCue} from '../../features/content/editReviewModel';
import {FlowDialog} from '../common/FlowDialog';
import {timestamp} from './SmartEditReview';
import {MotionReview} from './MotionReview';
import {EditPreviewPlayer,type EditPreviewHandle} from './EditPreviewPlayer';
import {VoiceTreatment} from './VoiceTreatment';
import {TranscriptEditor,type TranscriptAction,type TranscriptSelection} from './TranscriptEditor';
import './edit-review.css';

type CutEdit={start:number;end:number;keep:boolean};
type FocusPoint={t:number;x:number;y:number};
type ManualCut=EditRange&{id:string;text:string;boundary?:'voice'|'transcript'|'silence'};
type Draft={edits:Record<string,CutEdit>;retakes:string[];manualCuts:ManualCut[];motion:MotionPlan|undefined;audio:AudioTreatment|undefined};
/** User-chosen motion moments (punch-in/highlight from the transcript) need the motion engine to accept user cues. */
export const USER_MOTION_CUES=true;
const round=(value:number)=>Math.round(value*1000)/1000;
const overlap=(a:EditRange,b:EditRange)=>Math.max(0,Math.min(a.end,b.end)-Math.max(a.start,b.start));
/** Parts of a range that FFmpeg did not detect as silence: audio evidence that the cut removes sound, not just a pause. */
export function soundingParts(range:EditRange,silences:readonly EditRange[]):EditRange[]{
  const parts:EditRange[]=[];let cursor=range.start;
  for(const quiet of silences.filter(item=>overlap(item,range)>0).sort((a,b)=>a.start-b.start)){if(quiet.start>cursor)parts.push({start:cursor,end:Math.min(quiet.start,range.end)});cursor=Math.max(cursor,quiet.end);}
  if(cursor<range.end)parts.push({start:cursor,end:range.end});
  return parts.filter(item=>item.end-item.start>0.05);
}

/** Kept intervals = complement of the removals; slivers under 0.1 s are folded into the cut. */
export function keptFromCuts(duration:number,cuts:readonly EditRange[]):EditRange[]{
  const sorted=cuts.filter(item=>item.end-item.start>0.0005).map(item=>({start:Math.max(0,item.start),end:Math.min(duration,item.end)})).sort((a,b)=>a.start-b.start);
  const kept:EditRange[]=[];let cursor=0;
  for(const item of sorted){if(item.start-cursor>=0.1)kept.push({start:round(cursor),end:round(item.start)});cursor=Math.max(cursor,item.end);}
  if(duration-cursor>=0.1)kept.push({start:round(cursor),end:round(duration)});
  return kept;
}

/**
 * Compare the raw recording with the automatic edit. Read-only by default: the user can keep a cut, nudge its edges
 * or cut a possible retake, preview that on the raw video instantly, and only then export a new verified version.
 */
export function EditReview({contentId,jobId,onClose,onUseVersion}:{contentId:string;jobId:string;onClose:()=>void;onUseVersion?:(jobId:string)=>Promise<unknown>}){
  const {mediaReview,planVideoEdit,planMotion,previewEdit,cancelPreview,measureAudio,snapCut,previewFileUrl,exportVideo,createSubtitles,mediaFileUrl,mediaJobs}=useContentWorkflow(),{locale}=useLanguage(),pt=locale==='pt-BR';
  const [currentJob,setCurrentJob]=useState(jobId),[review,setReview]=useState<EditReviewData|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [edits,setEdits]=useState<Record<string,CutEdit>>({}),[retakes,setRetakes]=useState<string[]>([]),[previewEdits,setPreviewEdits]=useState(false),[motion,setMotion]=useState<MotionPlan|undefined>(),[exportedJob,setExportedJob]=useState(''),[time,setTime]=useState(0);
  const [picking,setPicking]=useState(false),[manualCuts,setManualCuts]=useState<ManualCut[]>([]),[audio,setAudio]=useState<AudioTreatment|undefined>(),[history,setHistory]=useState<Draft[]>([]);
  const [preview,setPreview]=useState<EditPreviewData|null>(null),[previewKey,setPreviewKey]=useState(''),[previewBusy,setPreviewBusy]=useState(false),[previewError,setPreviewError]=useState('');
  const previewSeq=useRef(0),player=useRef<EditPreviewHandle>(null);
  const raw=useRef<HTMLVideoElement>(null),edited=useRef<HTMLVideoElement>(null),stopAt=useRef<{video:HTMLVideoElement;at:number}|null>(null);
  const run=async(work:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await work()}catch(failure){setError(String((failure as Error).message))}finally{setBusy(false)}};
  const load=(id:string)=>run(async()=>{const data=await mediaReview(id);setReview(data);setEdits(Object.fromEntries(data.cuts.map(cut=>[cut.id,{start:cut.start,end:cut.end,keep:false}])));setRetakes([]);setManualCuts([]);setHistory([]);setMotion(data.plan.motion);setAudio(data.plan.audio);setPreview(null);setPreviewKey('');setCurrentJob(id)});
  useEffect(()=>{void load(jobId)},[jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  const duration=review?.source.duration??0;
  const removals=useMemo(()=>review?[...review.cuts.map(cut=>edits[cut.id]).filter((item):item is CutEdit=>Boolean(item)&&!item.keep),...review.possibleRetakes.filter(item=>retakes.includes(item.id)),...(review.speechCandidates??[]).filter(item=>retakes.includes(item.id)),...manualCuts]:[],[review,edits,retakes,manualCuts]);
  const adjusted=useMemo(()=>review?keptFromCuts(duration,removals):[],[review,duration,removals]);
  const adjustedDuration=adjusted.reduce((sum,item)=>sum+item.end-item.start,0);
  // The exact plan an export of the current draft would submit (motion anchors stay on the recording).
  const draftPlan=useMemo(()=>{if(!review)return null;const {motion:_previous,audio:_audio,...base}=review.plan;void _previous;void _audio;return {...base,segments:adjusted,...(motion?.cues.length||motion?.reframe?{motion}:{}),...(audio?{audio}:{})};},[review,adjusted,motion,audio]);
  const draftKey=JSON.stringify(draftPlan),stale=Boolean(preview)&&previewKey!==draftKey;
  const words=useMemo(()=>reviewWords(review?.transcript),[review]);
  // Approximate captions on the edited timeline (up to 4 kept words each) for the preview overlay only.
  const previewCaptions=useMemo(()=>{const lines:Array<EditRange&{text:string}>=[];let group:Array<{at:number;end:number;text:string}>=[];
    const flush=()=>{if(group.length)lines.push({start:group[0].at,end:group.at(-1)!.end,text:group.map(item=>item.text).join(' ')});group=[];};
    for(const word of words){const at=outputTimeOf(word.start+0.01,adjusted),end=outputTimeOf(Math.max(word.start+0.01,word.end-0.01),adjusted);if(at===null||end===null){flush();continue;}group.push({at,end:Math.max(end,at+0.2),text:word.text});if(group.length>=4||/[.!?]$/.test(word.text))flush();}
    flush();return lines;},[words,adjusted]);
  const sourceRef=review?{contentId:review.source.contentId,assetId:review.source.assetId,versionId:review.source.versionId,sha256:review.source.sha256}:null;
  const preparePreview=useCallback(async()=>{if(!sourceRef||!draftPlan)return;const seq=++previewSeq.current,key=JSON.stringify(draftPlan);setPreviewBusy(true);setPreviewError('');
    try{const data=await previewEdit({...sourceRef,plan:draftPlan});if(seq===previewSeq.current){setPreview(data);setPreviewKey(key);}}
    catch(failure){if(seq===previewSeq.current&&!/canceled/i.test(String((failure as Error).message)))setPreviewError(String((failure as Error).message));}
    finally{if(seq===previewSeq.current)setPreviewBusy(false);}},[sourceRef?.sha256,sourceRef?.versionId,draftKey,previewEdit]); // eslint-disable-line react-hooks/exhaustive-deps
  const stopPreview=()=>{previewSeq.current++;setPreviewBusy(false);void cancelPreview().catch(()=>undefined);};
  const previewLoaded=useRef('');
  useEffect(()=>{if(review?.sourceCurrent&&previewLoaded.current!==review.job.id){previewLoaded.current=review.job.id;void preparePreview();}},[review,preparePreview]);
  useEffect(()=>()=>{previewSeq.current++;},[]);
  /** Every adjustment is undoable: the draft before it goes on the history stack. */
  const commit=(change:()=>void)=>{setHistory(current=>pushHistory(current,{edits,retakes,manualCuts,motion,audio}));change();};
  const undo=()=>{const last=history.at(-1);if(!last)return;setHistory(history.slice(0,-1));setEdits(last.edits);setRetakes(last.retakes);setManualCuts(last.manualCuts);setMotion(last.motion);setAudio(last.audio);};
  const onTranscript=(action:TranscriptAction,selection:TranscriptSelection)=>{if(!review)return;
    const hits=(item:EditRange)=>Math.min(item.end,selection.end)-Math.max(item.start,selection.start)>0.02;
    if(action==='cut'){const local=snapRemovalToWords(words,selection.first,selection.last,duration);
      // Edges between words: the server snaps them to measured pauses (voice track) when it can; else the transcript edges are kept and labelled.
      void run(async()=>{const snapped=await snapCut({...sourceRef,start:local.start,end:local.end}).catch(()=>null),result=snapped?.result;
        const range=result&&'start' in result?{start:result.start,end:result.end,boundary:result.boundary}:{...local,boundary:'transcript' as const};
        if(result&&'rejected' in result&&result.rejected==='unsafeBoundary')setError(pt?'Não há uma pausa segura nessas bordas: o corte usa os tempos da transcrição. Ouça antes de exportar.':'No safe pause at these edges: the cut uses transcript timings. Listen before exporting.');
        commit(()=>setManualCuts(current=>[...current,{id:crypto.randomUUID(),text:selection.text,...range}]));});}
    else if(action==='keep')commit(()=>{setEdits(current=>Object.fromEntries(Object.entries(current).map(([id,item])=>[id,hits(item)?{...item,keep:true}:item])));setRetakes(current=>current.filter(id=>![...review.possibleRetakes,...(review.speechCandidates??[])].some(item=>item.id===id&&hits(item))));setManualCuts(current=>current.filter(item=>!hits(item)));});
    else commit(()=>setMotion(current=>withUserCue(current,userCue(action==='punchIn'?'punchIn':'kineticText',selection,action==='highlight'?selection.text:undefined,`user-${crypto.randomUUID().slice(0,8)}`))));
  };
  const changed=Boolean(review)&&(JSON.stringify(adjusted)!==JSON.stringify(review!.plan.segments.map(({start,end})=>({start,end})))||JSON.stringify(motion??null)!==JSON.stringify(review!.plan.motion??null)||JSON.stringify(audio??null)!==JSON.stringify(review!.plan.audio??null));
  // The export is tracked by the reviewed plan hash, so it survives refreshes of the job list.
  const exported=exportedJob?mediaJobs.filter(item=>item.mode==='advanced'&&item.planHash===exportedJob).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]:undefined;

  // Instant preview of the adjustments on the raw file: playback jumps over every removed range. Nothing is rendered.
  const onRawTime=()=>{const video=raw.current;if(!video)return;setTime(video.currentTime);
    if(stopAt.current?.video===video&&video.currentTime>=stopAt.current.at){video.pause();stopAt.current=null;return;}
    if(previewEdits){const cut=removals.find(item=>video.currentTime>=item.start&&video.currentTime<item.end-0.02);if(cut)video.currentTime=Math.min(duration,cut.end);}
  };
  const onEditedTime=()=>{const video=edited.current;if(video&&stopAt.current?.video===video&&video.currentTime>=stopAt.current.at){video.pause();stopAt.current=null;}};
  const playAround=(video:HTMLVideoElement|null,start:number,end:number)=>{if(!video)return;video.currentTime=Math.max(0,start);stopAt.current={video,at:end};void video.play().catch(()=>undefined);};
  // Framing focus: points marked on the RAW frame (source coordinates mapped into the cut frame), anchored on the recording time.
  const focusPoints:FocusPoint[]=(motion?.reframe?.source==='user'?motion.reframe.points:[]).map(({t,x,y})=>({t,x,y}));
  const setFocusPoints=(points:FocusPoint[])=>commit(()=>setMotion(current=>{
    const base=current??emptyMotion();const {reframe:_old,...rest}=base;void _old;
    if(!points.length)return rest.cues.length||rest.intensity!=='off'?rest:undefined;
    const sorted=[...points].sort((a,b)=>a.t-b.t);
    return {...rest,reframe:sorted.length===1?{mode:'fixed',source:'user',points:[{t:0,x:sorted[0].x,y:sorted[0].y}]}:{mode:'manual',source:'user',points:sorted}};
  }));
  const pickFocus=(event:React.MouseEvent<HTMLButtonElement>)=>{const video=raw.current;if(!video||!review)return;
    const point=focusFromRawClick(video.getBoundingClientRect(),{width:video.videoWidth,height:video.videoHeight},{x:event.clientX,y:event.clientY});
    if(!point){setError(pt?'Clique dentro da imagem do vídeo.':'Click inside the video picture.');return;}
    const t=Math.round(video.currentTime*1000)/1000;setFocusPoints([...focusPoints.filter(item=>Math.abs(item.t-t)>0.05),{t,...point}]);setPicking(false);};
  const nudge=(id:string,edge:'start'|'end',delta:number)=>commit(()=>setEdits(current=>{const item=current[id];const value=round(Math.min(duration,Math.max(0,item[edge]+delta)));if(edge==='start'?value>=item.end-0.05:value<=item.start+0.05)return current;return {...current,[id]:{...item,[edge]:value}};}));

  const exportAdjusted=()=>run(async()=>{
    if(!review)return;const ref={contentId:review.source.contentId,assetId:review.source.assetId,versionId:review.source.versionId,sha256:review.source.sha256};
    // Motion anchors live on the recording: the engine re-derives their edited times from these adjusted segments.
    const preview=await planVideoEdit({...ref,plan:draftPlan});
    const requestKey=`review-${review.job.id}-${crypto.randomUUID()}`;
    await exportVideo({mode:'advanced',authorize:true,revision:preview.revision,requestKey,...ref,plan:preview.plan,planHash:preview.planHash});setExportedJob(preview.planHash);
  });
  const files=window.mainsAgentsDesktop?.files;

  if(!review)return <FlowDialog title={pt?'Conferir edição':'Review edit'} onClose={onClose}><p role="status">{error||(pt?'Carregando comparação…':'Loading comparison…')}</p></FlowDialog>;
  const sourceUrl=mediaFileUrl(contentId,review.source.assetId,review.source.versionId),outputUrl=review.output&&mediaFileUrl(contentId,review.output.assetId,review.output.versionId);
  const pct=(value:number)=>`${duration?value/duration*100:0}%`;
  return <FlowDialog title={pt?'Conferir edição':'Review edit'} description={pt?'Compare o bruto com o editado. O original nunca é alterado; ajustes geram uma nova versão verificada.':'Compare raw and edited. The original is never changed; adjustments create a new verified version.'} onClose={()=>{if(!busy)onClose()}}>
    <div className="edit-review" data-od-id="edit-review">
      {review.sourceCurrent&&<EditPreviewPlayer ref={player} preview={preview} src={preview?previewFileUrl(contentId,review.source.assetId,preview.preview.id):''} stale={stale} busy={previewBusy} error={previewError} pt={pt}
        segments={adjusted} captions={previewCaptions} onPrepare={()=>void preparePreview()} onCancel={stopPreview} onTime={seconds=>setTime(rawTimeOf(seconds,adjusted))}/>}
      {review.sourceCurrent&&<TranscriptEditor words={words} segments={adjusted} time={time} pt={pt} busy={busy} canMotion={USER_MOTION_CUES} canUndo={history.length>0}
        onPlay={range=>playAround(raw.current,range.start-0.15,range.end+0.15)} onAction={onTranscript} onUndo={undo}/>}
      {manualCuts.length>0&&<ul className="smart-manual-list" aria-label={pt?'Cortes escolhidos na transcrição':'Cuts chosen in the transcript'}>{manualCuts.map(item=><li key={item.id}><span>{timestamp(item.start)} → {timestamp(item.end)} · “{item.text.length>60?`${item.text.slice(0,60)}…`:item.text}” <small>{item.boundary==='voice'?(pt?'bordas na pausa medida da voz':'edges at measured voice pause'):item.boundary==='silence'?(pt?'bordas no silêncio detectado':'edges at detected silence'):(pt?'bordas pela transcrição (aproximadas)':'edges from transcript (approximate)')}</small></span><button className="text-link" disabled={busy} onClick={()=>commit(()=>setManualCuts(current=>current.filter(value=>value.id!==item.id)))}>{pt?'Manter este trecho':'Keep this passage'}</button></li>)}</ul>}
      <details className="edit-review-compare" open><summary>{pt?'Comparar bruto × editado atual':'Compare raw × current edit'}</summary>
      <div className="edit-review-players">
        <figure className={`edit-review-raw${picking?' is-picking':''}`}><figcaption>{pt?'Bruto':'Raw'} · {timestamp(duration)}</figcaption><video ref={raw} src={sourceUrl} controls preload="metadata" onTimeUpdate={onRawTime} aria-label={pt?'Vídeo bruto':'Raw video'}/>
          {picking&&<button className="edit-focus-pick" aria-label={pt?'Clique no ponto da imagem que deve ficar em foco':'Click the point of the picture that should stay in focus'} onClick={pickFocus}/>}</figure>
        <figure><figcaption>{pt?'Editado':'Edited'} · {timestamp(review.output?.duration??0)}</figcaption>{outputUrl?<video ref={edited} src={outputUrl} controls preload="metadata" onTimeUpdate={onEditedTime} aria-label={pt?'Vídeo editado':'Edited video'}/>:<p>{pt?'Arquivo editado não encontrado.':'Edited file not found.'}</p>}</figure>
      </div>
      <div className="edit-review-timeline" role="group" aria-label={pt?'Linha do tempo do bruto':'Raw timeline'}>
        {adjusted.map((item,index)=><button key={`k${index}`} className="edit-review-kept" style={{left:pct(item.start),width:pct(item.end-item.start)}} aria-label={`${pt?'Mantido':'Kept'} ${timestamp(item.start)}`} onClick={()=>{if(raw.current)raw.current.currentTime=item.start}}/>)}
        {review.cuts.map(cut=>{const item=edits[cut.id];return <button key={cut.id} className={`edit-review-cut${item?.keep?' is-kept':''}${cut.speechSeconds>0?' has-speech':''}`} style={{left:pct(item?.start??cut.start),width:pct((item?.end??cut.end)-(item?.start??cut.start))}} aria-label={`${pt?'Corte':'Cut'} ${timestamp(cut.start)}`} onClick={()=>playAround(raw.current,cut.start-1.5,cut.end+1.5)}/>;})}
        {review.possibleRetakes.map(item=><button key={item.id} className={`edit-review-retake${retakes.includes(item.id)?' is-cut':''}`} style={{left:pct(item.start),width:pct(item.end-item.start)}} aria-label={`${pt?'Possível retomada':'Possible retake'} ${timestamp(item.start)}`} onClick={()=>playAround(raw.current,item.start-0.5,item.end+1)}/>)}
        <span className="edit-review-playhead" style={{left:pct(time)}} aria-hidden/>
      </div>
      <div className="edit-review-summary">
        <span>{pt?'Original':'Original'} <b>{timestamp(duration)}</b></span><span>{pt?'Editado':'Edited'} <b>{timestamp(review.output?.duration??0)}</b></span>
        <span>{review.cuts.length} {pt?'cortes':'cuts'}</span>{changed&&<span>{pt?'Com seus ajustes':'With your adjustments'} <b>{timestamp(adjustedDuration)}</b></span>}
        <label className="edit-review-toggle"><input type="checkbox" checked={previewEdits} onChange={event=>setPreviewEdits(event.target.checked)}/>{pt?'Tocar o bruto pulando os cortes (prévia dos ajustes)':'Play raw skipping the cuts (preview adjustments)'}</label>
      </div>
      {review.sourceCurrent&&<section className="edit-review-focus" aria-label={pt?'Enquadramento':'Framing'} data-od-id="edit-focus"><h3>{pt?'Enquadramento da câmera':'Camera framing'}</h3>
        <p className="edit-review-note">{pt?'Nas aproximações, telas divididas e no formato vertical, a câmera é recortada em volta de um ponto (padrão: centro, um pouco acima). Pause o bruto no momento desejado e clique no rosto ou objeto. Um ponto vale para o vídeo todo; vários pontos fazem a câmera acompanhar suavemente entre eles. Detecção automática de rosto não está disponível neste app.':'In punch-ins, split screens and vertical format the camera is cropped around a point (default: centre, slightly above). Pause the raw video at the moment you want and click the face or object. One point applies to the whole video; several points make the camera follow smoothly between them. Automatic face detection is not available in this app.'}</p>
        <p className="edit-review-note">{review.plan.format==='portrait'?(pt?'Formato vertical: o recorte 9:16 do vídeo inteiro acompanha o foco escolhido (sem foco, fica centralizado).':'Vertical format: the 9:16 crop of the whole video follows the chosen focus (without one it stays centred).'):(pt?'Sem aproximação ou tela dividida o quadro inteiro já aparece, então o foco não muda a imagem nesses trechos.':'Without punch-ins or split screens the whole frame is already shown, so the focus does not change the picture there.')}</p>
        <div className="edit-review-actions"><button className="soft-button" disabled={busy} data-od-id="edit-focus-pick" onClick={()=>{raw.current?.pause();setPicking(!picking);}}>{picking?(pt?'Cancelar escolha':'Cancel picking'):(pt?'Escolher foco no bruto':'Pick focus on raw video')}</button>
          {focusPoints.length>0&&<button className="text-link" disabled={busy} onClick={()=>setFocusPoints([])}>{pt?'Voltar ao foco padrão':'Back to default focus'}</button>}</div>
        {focusPoints.length>0&&<ol>{focusPoints.map(item=><li key={item.t}><span>{focusPoints.length===1?(pt?'Vídeo todo':'Whole video'):timestamp(item.t)} · x {Math.round(item.x*100)}% · y {Math.round(item.y*100)}%</span> <button className="text-link" disabled={busy} onClick={()=>setFocusPoints(focusPoints.filter(value=>value.t!==item.t))}>{pt?'Remover':'Remove'}</button></li>)}</ol>}
      </section>}
      </details>
      {review.transcript&&<p className="edit-review-note">{pt?`Transcrição local (Whisper): tempos aproximados${review.transcript.timing==='words'?' por palavra':' por frase'}. ${review.silences?'O aviso de som vem da análise de áudio; a transcrição só indica qual fala está no trecho.':'Sem análise de áudio guardada: avisos vêm só da transcrição e podem errar em pausas.'}`:`Local transcript (Whisper): approximate ${review.transcript.timing==='words'?'word':'sentence'} timing. ${review.silences?'Sound warnings come from audio analysis; the transcript only names the speech.':'No stored audio analysis: warnings come from the transcript alone and may be wrong around pauses.'}`}</p>}
      {!review.transcript&&<p className="edit-review-note">{pt?'Sem transcrição local: não dá para avisar se algum corte pegou fala. Ouça os cortes mais longos.':'No local transcript: speech inside cuts cannot be flagged. Listen to the longer cuts.'}</p>}
      <ol className="edit-review-cuts">{review.cuts.map(cut=>{const item=edits[cut.id];return <li key={cut.id} className={item?.keep?'is-kept':''}>
        {(()=>{const parts=review.silences?soundingParts(item,review.silences):null,sound=parts?round(parts.reduce((sum,part)=>sum+part.end-part.start,0)):null,speech=parts?(review.transcript?.segments??[]).filter(line=>parts.some(part=>overlap(line,part)>0.15)).map(line=>line.text).slice(0,3):cut.speech;return <div><b>{timestamp(item.start)} → {timestamp(item.end)}</b> <small>{round(item.end-item.start).toLocaleString(locale)} s · {pt?'no editado em':'in edit at'} {timestamp(cut.outputAt)}</small>
          {!item.keep&&sound!==null&&sound>0.15&&<p className="edit-review-warning">{pt?`Este corte remove ${sound.toLocaleString(locale)} s com som (não é só pausa)`:`This cut removes ${sound.toLocaleString(locale)} s of sound (not just a pause)`}{speech.length?`: “${speech.join(' … ')}”`:''}</p>}
          {sound===null&&cut.speechSeconds>0&&<p className="edit-review-warning">{pt?'Possível fala neste corte (pela transcrição; ouça para confirmar)':'Possible speech in this cut (from transcript; listen to confirm)'}: “{cut.speech.join(' … ')}”</p>}</div>;})()}
        <div className="edit-review-actions">
          <button className="soft-button" onClick={()=>playAround(raw.current,item.start-1.5,item.end+1.5)}>{pt?'Ouvir no bruto':'Hear in raw'}</button>
          <button className="soft-button" disabled={!outputUrl} onClick={()=>playAround(edited.current,cut.outputAt-1.5,cut.outputAt+1.5)}>{pt?'Ver no editado':'See in edit'}</button>
          <label><input type="checkbox" checked={item.keep} onChange={event=>{const keep=event.target.checked;commit(()=>setEdits(current=>({...current,[cut.id]:{...item,keep}})));}}/>{pt?'Manter este trecho':'Keep this part'}</label>
          {!item.keep&&<span className="edit-review-nudge" aria-label={pt?'Ajustar bordas do corte':'Adjust cut edges'}>
            <button className="text-link" aria-label={pt?'Início mais cedo':'Start earlier'} onClick={()=>nudge(cut.id,'start',-0.1)}>−</button>{pt?'início':'start'}<button className="text-link" aria-label={pt?'Início mais tarde':'Start later'} onClick={()=>nudge(cut.id,'start',0.1)}>+</button>
            <button className="text-link" aria-label={pt?'Fim mais cedo':'End earlier'} onClick={()=>nudge(cut.id,'end',-0.1)}>−</button>{pt?'fim':'end'}<button className="text-link" aria-label={pt?'Fim mais tarde':'End later'} onClick={()=>nudge(cut.id,'end',0.1)}>+</button>
          </span>}
        </div></li>;})}</ol>
      {!motion&&review.sourceCurrent&&<section className="edit-review-motion"><h3>{pt?'Movimento':'Motion'}</h3><p>{pt?'Esta versão não tem motion. Você pode sugerir aproximações, textos e cartões a partir da ênfase da sua voz e revisar antes de exportar.':'This version has no motion. You can suggest punch-ins, text and cards from your voice emphasis and review them before exporting.'}</p>
        <div className="edit-review-actions"><button className="soft-button" disabled={busy} onClick={()=>void run(async()=>{const result=await planMotion({contentId:review.source.contentId,assetId:review.source.assetId,versionId:review.source.versionId,sha256:review.source.sha256,segments:adjusted,intensity:'balanced',language:pt?'pt':'en'});commit(()=>setMotion(current=>({...result.motion,...(current?.reframe?{reframe:current.reframe}:{})})));})}>{pt?'Sugerir movimento':'Suggest motion'}</button></div></section>}
      {motion&&<MotionReview motion={motion} segments={adjusted} pt={pt} busy={busy} onChange={value=>commit(()=>setMotion(value))} onPlayRaw={(start,end)=>playAround(raw.current,start,end)}
        onIntensity={intensity=>void run(async()=>{const result=await planMotion({contentId:review.source.contentId,assetId:review.source.assetId,versionId:review.source.versionId,sha256:review.source.sha256,segments:adjusted,intensity,language:pt?'pt':'en'});
          // A new intensity replaces only the automatic moments: your own moments and framing focus stay.
          commit(()=>setMotion(current=>({...result.motion,cues:[...result.motion.cues,...(current?.cues.filter(cue=>cue.source==='user')??[])],...(current?.reframe?{reframe:current.reframe}:{})})));})}/>}
      {(review.speechCandidates?.length??0)>0&&<section className="edit-review-retakes" data-od-id="speech-suggestions"><h3>{pt?'Sugestões na fala (não cortadas)':'Speech suggestions (not cut)'}</h3><p>{pt?'Muletas, repetições e frases recomeçadas encontradas na transcrição. Nada é cortado sem você marcar; ouça antes. As bordas evitam cortar no meio de palavras, mas são aproximadas.':'Fillers, repetitions and restarted sentences found in the transcript. Nothing is cut until you tick it; listen first. Edges avoid cutting mid-word but are approximate.'}</p>
        <ol>{review.speechCandidates!.map(item=><li key={item.id}><span><b>{({filler:pt?'Muleta':'Filler',repetition:pt?'Repetição':'Repetition',retake:pt?'Frase recomeçada':'Restarted sentence',selfCorrection:pt?'Autocorreção':'Self-correction'} as Record<string,string>)[item.kind]??item.label}</b> · {timestamp(item.start)} → {timestamp(item.end)}{item.evidence?.text?` · “${item.evidence.text}”`:''} <small>{item.reason} · {pt?'confiança':'confidence'} {({high:pt?'alta':'high',medium:pt?'média':'medium',low:pt?'baixa':'low'})[item.confidence]}</small></span>
          <button className="soft-button" onClick={()=>playAround(raw.current,item.start-1,item.end+1)}>{pt?'Ouvir':'Listen'}</button>
          <label><input type="checkbox" checked={retakes.includes(item.id)} onChange={event=>{const checked=event.target.checked;commit(()=>setRetakes(current=>checked?[...current,item.id]:current.filter(id=>id!==item.id)));}}/>{pt?'Cortar':'Cut'}</label></li>)}</ol></section>}
      {review.sourceCurrent&&<VoiceTreatment assessment={review.audio} value={audio} legacyNormalize={review.plan.normalizeAudio} pt={pt} busy={busy} onChange={value=>commit(()=>setAudio(value))}
        onMeasure={()=>void run(async()=>{const result=await measureAudio({contentId:review.source.contentId,assetId:review.source.assetId,versionId:review.source.versionId,sha256:review.source.sha256});setReview(current=>current&&{...current,audio:result.audio});})}/>}
      {review.possibleRetakes.length>0&&<section className="edit-review-retakes"><h3>{pt?'Possíveis retomadas (não cortadas)':'Possible retakes (not cut)'}</h3><p>{pt?'Frases parecidas com a seguinte. Ouça e decida; isso não indica erro.':'Phrases similar to the next one. Listen and decide; this does not mean a mistake.'}</p>
        <ol>{review.possibleRetakes.map(item=><li key={item.id}><span>{timestamp(item.start)} → {timestamp(item.end)} · {review.transcript?.segments.find(line=>line.start<=item.start+0.01&&line.end>=item.start)?.text??item.label}</span>
          <button className="soft-button" onClick={()=>playAround(raw.current,item.start-0.5,item.end+2)}>{pt?'Ouvir':'Listen'}</button>
          <label><input type="checkbox" checked={retakes.includes(item.id)} onChange={event=>{const checked=event.target.checked;commit(()=>setRetakes(current=>checked?[...current,item.id]:current.filter(id=>id!==item.id)));}}/>{pt?'Cortar esta retomada':'Cut this retake'}</label></li>)}</ol></section>}
      <section className="edit-review-capcut"><h3>{pt?'Levar para o CapCut':'Take it to CapCut'}</h3>
        <p>{pt?'Importe o MP4 editado e, em Texto → Legendas → Importar, o arquivo .srt. As legendas já seguem o tempo do vídeo editado.':'Import the edited MP4 and, in Text → Captions → Import, the .srt file. Captions already follow the edited timing.'}</p>
        <div className="edit-review-actions">
          {review.output&&files&&<button className="soft-button" onClick={()=>void files.reveal(storageProfile(),contentId,review.output!.assetId).catch(failure=>setError(String(failure.message)))}>{pt?'Mostrar MP4 na pasta':'Show MP4 in folder'}</button>}
          {review.subtitles?files&&<button className="soft-button" onClick={()=>void files.reveal(storageProfile(),contentId,review.subtitles!.assetId).catch(failure=>setError(String(failure.message)))}>{pt?'Mostrar legendas (.srt)':'Show captions (.srt)'}</button>
            :<button className="soft-button" disabled={busy} onClick={()=>void run(async()=>{await createSubtitles(currentJob);await load(currentJob)})}>{pt?'Gerar legendas .srt (Whisper local)':'Create .srt captions (local Whisper)'}</button>}
        </div></section>
      {error&&<p role="alert" className="delivery-error">{error}</p>}
      {!review.sourceCurrent&&<p role="alert">{pt?'A gravação original mudou depois desta edição. Ajustes exigem uma nova edição automática.':'The original recording changed after this edit. Adjustments need a new automatic edit.'}</p>}
      <footer className="edit-review-footer">
        {exported?<p role="status">{exported.status==='succeeded'?(pt?'Versão ajustada exportada e verificada.':'Adjusted version exported and verified.'):exported.status==='failed'||exported.status==='canceled'||exported.status==='interrupted'?`${pt?'Falha na exportação':'Export failed'}: ${exported.error??''}`:`${pt?'Exportando versão ajustada':'Exporting adjusted version'} ${Math.round(exported.progress)}%`}</p>:null}
        {exported?.status==='succeeded'?<>
          <button className="soft-button" disabled={busy} onClick={()=>{setExportedJob('');void load(exported.id)}}>{pt?'Conferir a versão ajustada':'Review the adjusted version'}</button>
          {onUseVersion&&<button className="primary-button" disabled={busy} onClick={()=>void run(async()=>{await onUseVersion(exported.id);onClose()})}>{pt?'Usar esta versão na produção':'Use this version in the production'}</button>}
        </>:<button className="primary-button" disabled={busy||!changed||!review.sourceCurrent||!adjusted.length||Boolean(exported&&['queued','running'].includes(exported.status))} onClick={()=>void exportAdjusted()}>{pt?'Exportar versão com meus ajustes':'Export version with my adjustments'}</button>}
      </footer>
    </div>
  </FlowDialog>;
}
