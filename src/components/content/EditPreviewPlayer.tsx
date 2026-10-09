import {forwardRef,useEffect,useImperativeHandle,useMemo,useRef,useState} from 'react';
import {Player,type PlayerRef} from '@remotion/player';
import {playerProps,type OverlayVideoProps} from '../../../remotion-video/player';
import type {EditPreviewData,EditRange} from '../../features/content/model';
import {timestamp} from './SmartEditReview';
import './edit-preview.css';

export interface EditPreviewHandle {seek:(seconds:number)=>void;pause:()=>void}
interface Props {
  preview:EditPreviewData|null;src:string;stale:boolean;busy:boolean;error?:string;pt:boolean;
  /** Kept segments of the draft on the raw timeline; drawn as joins on the edited timeline. */
  segments:readonly EditRange[];
  /** Approximate captions on the edited timeline (browser overlay, not the burned libass render). */
  captions?:Array<EditRange&{text:string}>;
  onPrepare:()=>void;onCancel:()=>void;onTime?:(seconds:number)=>void;
}

/**
 * Embedded Remotion Player with the SAME composition (`OverlayVideo`) and the same props the renderer receives, over a
 * reduced proxy cut by the export's own filter. Audio of the proxy is the processed audio of the final file (cuts,
 * voice processing and ducked SFX). Burned captions are a separate engine (libass) and only approximated here.
 */
export const EditPreviewPlayer=forwardRef<EditPreviewHandle,Props>(function EditPreviewPlayer({preview,src,stale,busy,error,pt,segments,captions,onPrepare,onCancel,onTime},ref){
  const player=useRef<PlayerRef>(null),[frame,setFrame]=useState(0),[showCaptions,setShowCaptions]=useState(false);
  const fps=preview?.composition.fps??30,duration=preview?.composition.durationSeconds??0;
  useImperativeHandle(ref,()=>({seek:seconds=>player.current?.seekTo(Math.max(0,Math.round(seconds*fps))),pause:()=>player.current?.pause()}),[fps]);
  const timeListener=useRef(onTime);timeListener.current=onTime;
  // The parent only hears about the playhead every ~0.1 s, so the whole review does not re-render on every frame.
  useEffect(()=>{const current=player.current;if(!current)return;let told=-1;const update=({detail}:{detail:{frame:number}})=>{setFrame(detail.frame);const at=detail.frame/fps;if(Math.abs(at-told)>=0.1){told=at;timeListener.current?.(at);}};current.addEventListener('frameupdate',update);return()=>current.removeEventListener('frameupdate',update);},[preview,fps]);
  // Same component and metadata calculation as the registered render composition (remotion-video/player.ts).
  const config=useMemo(()=>preview?playerProps({...preview.props,src} as unknown as OverlayVideoProps):null,[preview,src]);
  const seconds=frame/fps,caption=showCaptions?captions?.find(item=>seconds>=item.start&&seconds<item.end):undefined;
  const joins=useMemo(()=>{let cursor=0;return segments.slice(0,-1).map(item=>(cursor+=item.end-item.start));},[segments]);
  const pct=(value:number)=>`${duration?Math.min(100,Math.max(0,value/duration*100)):0}%`;
  const motion=preview?.props.motion,windows=preview?(['title','lowerThird','cta'] as const).map(kind=>({kind,window:preview.props[kind] as {from:number;to:number}|undefined})).filter(item=>item.window):[];
  const audioNote=!preview?'':preview.preview.audio==='none'?(pt?'Vídeo sem áudio.':'Video without audio.'):(pt?'Áudio com seus ajustes.':'Audio with your adjustments.');
  const label=(kind:string)=>({punchIn:pt?'Aproximação':'Punch-in',kineticText:pt?'Texto animado':'Animated text',keyPoint:pt?'Cartão':'Card',explainer:pt?'Explicação':'Explainer',title:pt?'Título':'Title',lowerThird:pt?'Tarja':'Lower third',cta:'CTA'} as Record<string,string>)[kind]??kind;
  return <section className="edit-preview" aria-label={pt?'Prévia do resultado':'Result preview'} data-od-id="edit-preview">
    <div className="edit-preview-head"><h3>{pt?'Prévia do resultado':'Result preview'}</h3>
      <div className="edit-review-actions">
        {busy?<><span role="status">{pt?'Preparando prévia…':'Preparing preview…'}</span><button className="text-link" onClick={onCancel}>{pt?'Cancelar':'Cancel'}</button></>
          :<button className="soft-button" onClick={onPrepare} data-od-id="edit-preview-prepare">{preview?(stale?(pt?'Atualizar prévia com meus ajustes':'Update preview with my adjustments'):(pt?'Preparar de novo':'Prepare again')):(pt?'Preparar prévia':'Prepare preview')}</button>}
      </div></div>
    {error&&<p role="alert" className="delivery-error">{error}</p>}
    {preview&&config?<>
      {stale&&<p className="edit-review-warning" role="status" data-od-id="edit-preview-stale">{pt?'Prévia desatualizada: você mudou a edição depois dela. Atualize para ver seus ajustes.':'Preview out of date: you changed the edit after it. Update to see your adjustments.'}</p>}
      <div className="edit-preview-stage" style={{aspectRatio:`${preview.composition.width} / ${preview.composition.height}`,width:`min(100%, ${Math.round(420*preview.composition.width/preview.composition.height)}px)`}}>
        <Player ref={player} {...config} controls acknowledgeRemotionLicense numberOfSharedAudioTags={0} style={{width:'100%',height:'100%'}}/>
        {caption&&<span className="edit-preview-caption" aria-hidden="true">{caption.text}</span>}
      </div>
      <div className="edit-preview-timeline" role="group" aria-label={pt?'Linha do tempo do editado':'Edited timeline'} data-od-id="edit-preview-timeline">
        <div className="edit-preview-track" onClick={event=>{const box=event.currentTarget.getBoundingClientRect();player.current?.seekTo(Math.round((event.clientX-box.left)/box.width*duration*fps));}}>
          {joins.map((at,index)=><span key={index} className="edit-preview-join" style={{left:pct(at)}} title={pt?`Corte em ${timestamp(at)}`:`Cut at ${timestamp(at)}`}/>)}
          <span className="edit-preview-playhead" style={{left:pct(seconds)}} aria-hidden/>
        </div>
        <div className="edit-preview-track is-effects">
          {windows.map(({kind,window})=><button key={kind} className="edit-preview-item is-overlay" style={{left:pct(window!.from),width:pct(window!.to-window!.from)}} onClick={()=>player.current?.seekTo(Math.round(window!.from*fps))}>{label(kind)}</button>)}
          {motion?.cues.map(cue=><button key={cue.id} className={`edit-preview-item is-${cue.kind}`} style={{left:pct(cue.startFrame/fps),width:pct((cue.endFrame-cue.startFrame)/fps)}} title={cue.text??label(cue.kind)} onClick={()=>player.current?.seekTo(cue.startFrame)}>{label(cue.kind)}</button>)}
          {motion?.sfx.map((item,index)=><span key={index} className="edit-preview-sfx" style={{left:pct(item.at)}} title={pt?`Efeito sonoro (${item.kind})`:`Sound effect (${item.kind})`} aria-label={pt?'Efeito sonoro':'Sound effect'}/>)}
        </div>
        <small>{timestamp(seconds)} / {timestamp(duration)} · {joins.length} {pt?'cortes':'cuts'} · {motion?.cues.length??0} {pt?'momentos de movimento':'motion moments'}</small>
      </div>
      <p className="edit-preview-note">{pt?'Prévia reduzida: o arquivo final pode ter pequenas diferenças visuais.':'Reduced preview: the final file may differ slightly in picture.'} {audioNote}{preview.preview.sfxSkipped?(pt?' Sem efeitos sonoros (áudio com mais de 2 canais).':' No sound effects (audio has more than 2 channels).'):''}</p>
      {captions?.length?<p className="edit-preview-note"><label><input type="checkbox" checked={showCaptions} onChange={event=>setShowCaptions(event.target.checked)}/>{pt?'Mostrar legendas aproximadas':'Show approximate captions'}</label> {pt?'— as legendas finais são aplicadas na etapa Legendas.':'— final captions are applied in the Captions step.'}</p>:null}
      <details className="edit-preview-details"><summary>{pt?'Sobre a prévia':'About the preview'}</summary>
        <p>{pt?'A imagem usa a mesma animação do arquivo final sobre uma cópia menor do vídeo cortado; pode haver 1 quadro de diferença, menos nitidez e quebra de texto um pouco diferente. O som passa pelo mesmo processamento do arquivo final (cortes, ajustes de voz e efeitos), mas não é uma cópia idêntica bit a bit. As legendas gravadas na imagem não aparecem aqui.':'The picture uses the same animation as the final file over a smaller copy of the cut video; expect up to 1 frame of difference, less sharpness and slightly different text wrapping. The sound goes through the same processing as the final file (cuts, voice adjustments and effects) but is not a bit-identical copy. Burned captions do not appear here.'}</p></details>
    </>:!busy&&<p className="edit-review-note">{pt?'A prévia mostra o vídeo como ficará depois de exportar, com cortes, movimento e áudio processado, antes de gerar o arquivo final.':'The preview shows the video as it will be after export, with cuts, motion and processed audio, before creating the final file.'}</p>}
  </section>;
});
