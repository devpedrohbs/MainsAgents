import {createPortal} from 'react-dom';
import {useCallback,useEffect,useRef,useState} from 'react';
import {
 advanceScroll,canAutoScroll,defaultSettings,fontSize,initialReadingState,pageStep,sceneNavigation,spaceShouldToggle,speed,stepFont,stepSpeed,togglePlaying,
 type ReadingScene,type ReadingState,type TeleprompterSettings,
} from '../../features/production/teleprompter';
import './teleprompter.css';

export interface TeleprompterProps {
 /** Approved script exactly as stored; shown verbatim and never edited here. */
 script:string;
 version:number;
 scenes:readonly ReadingScene[];
 /** Title of the approved path whose outline provides the scenes (source label only). */
 pathTitle?:string;
 pt:boolean;
 onClose:()=>void;
}

const reducedQuery='(prefers-reduced-motion: reduce)';
const usePrefersReducedMotion=()=>{
 const [reduced,setReduced]=useState(()=>typeof matchMedia==='function'&&matchMedia(reducedQuery).matches);
 useEffect(()=>{
  if(typeof matchMedia!=='function')return;
  const query=matchMedia(reducedQuery),sync=()=>setReduced(query.matches);
  sync();query.addEventListener?.('change',sync);return()=>query.removeEventListener?.('change',sync);
 },[]);
 return reduced;
};

/** Read-only reading mode. Opening or closing it writes nothing, calls no network and never records. */
export function Teleprompter({script,version,scenes,pathTitle,pt,onClose}:TeleprompterProps){
 const say=(a:string,b:string)=>pt?a:b;
 const reduced=usePrefersReducedMotion();
 const [settings,setSettings]=useState<TeleprompterSettings>(defaultSettings);
 const [reading,setReading]=useState<ReadingState>(initialReadingState);
 const [scene,setScene]=useState(0);
 const root=useRef<HTMLDivElement>(null),body=useRef<HTMLDivElement>(null);
 const position=useRef(0),lastSet=useRef(0);
 const returnFocus=useRef<Element|null>(null);

 // Fullscreen is a progressive enhancement; the overlay already fills the window if the API is unavailable or refused.
 useEffect(()=>{
  returnFocus.current=document.activeElement;
  body.current?.focus();
  const node=root.current;
  const onFullscreen=()=>{if(!document.fullscreenElement&&node?.dataset.requestedFullscreen==='true'){node.dataset.requestedFullscreen='false';onClose();}};
  document.addEventListener('fullscreenchange',onFullscreen);
  if(node?.requestFullscreen){node.dataset.requestedFullscreen='true';node.requestFullscreen().catch(()=>{node.dataset.requestedFullscreen='false';});}
  return()=>{
   document.removeEventListener('fullscreenchange',onFullscreen);
   if(node)node.dataset.requestedFullscreen='false';
   if(document.fullscreenElement)void document.exitFullscreen().catch(()=>undefined);
   if(returnFocus.current instanceof HTMLElement)returnFocus.current.focus();
  };
 },[]); // eslint-disable-line react-hooks/exhaustive-deps

 const togglePlay=useCallback(()=>setReading(state=>togglePlaying(state,reduced)),[reduced]);
 useEffect(()=>{if(reduced)setReading(state=>state.playing?{...state,playing:false}:state);},[reduced]);

 // Automatic scroll: only while playing and only if motion is allowed. A manual scroll wins and re-syncs the position.
 useEffect(()=>{
  if(!reading.playing||!canAutoScroll(reduced))return;
  const element=body.current;if(!element)return;
  let frame=0,previous=performance.now();
  const tick=(now:number)=>{
   if(Math.abs(element.scrollTop-lastSet.current)>2)position.current=element.scrollTop;
   const max=element.scrollHeight-element.clientHeight;
   const next=advanceScroll(position.current,now-previous,speed(settings),max);
   previous=now;position.current=next.position;lastSet.current=next.position;element.scrollTop=next.position;
   if(next.reachedEnd){setReading({playing:false,atEnd:true});return;}
   frame=requestAnimationFrame(tick);
  };
  position.current=element.scrollTop;lastSet.current=element.scrollTop;
  frame=requestAnimationFrame(tick);
  return()=>cancelAnimationFrame(frame);
 },[reading.playing,reduced,settings.speedIndex]); // eslint-disable-line react-hooks/exhaustive-deps

 const jump=(top:number)=>{const element=body.current;if(!element)return;element.scrollTop=top;position.current=element.scrollTop;lastSet.current=element.scrollTop;};
 const restart=()=>{jump(0);setReading(initialReadingState());};
 const page=(direction:1|-1)=>{const element=body.current;if(!element)return;jump(pageStep(element.scrollTop,element.clientHeight,direction,element.scrollHeight-element.clientHeight));};

 const onKeyDown=(event:React.KeyboardEvent)=>{
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();return;}
  if(event.key===' '&&spaceShouldToggle(event.target as HTMLElement)){event.preventDefault();togglePlay();return;}
  if(event.key==='Tab'){ // keep focus inside the dialog
   const focusable=Array.from(root.current?.querySelectorAll<HTMLElement>('button:not([disabled]),[tabindex="0"]')??[]);
   if(!focusable.length)return;
   const first=focusable[0],last=focusable[focusable.length-1];
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
 };

 const size=fontSize(settings),pxPerSecond=speed(settings);
 const status=reading.playing?say('Rolando','Scrolling'):reading.atEnd?say('Fim do roteiro','End of script'):say('Pausado','Paused');
 const current=scenes[scene];
 return createPortal(<div ref={root} className="teleprompter" role="dialog" aria-modal="true" aria-label={say(`Modo de leitura · roteiro v${version}`,`Reading mode · script v${version}`)} onKeyDown={onKeyDown}>
  <div className="teleprompter-bar" role="toolbar" aria-label={say('Controles de leitura','Reading controls')}>
   <button type="button" className="teleprompter-primary" onClick={togglePlay} disabled={reduced} aria-describedby="tp-status">{reading.playing?say('Pausar','Pause'):reading.atEnd?say('Reiniciar','Restart'):say('Iniciar rolagem','Start scrolling')}</button>
   {reduced&&<>
    <button type="button" onClick={()=>page(-1)}>{say('Página anterior','Previous page')}</button>
    <button type="button" onClick={()=>page(1)}>{say('Próxima página','Next page')}</button>
   </>}
   <span className="teleprompter-group" role="group" aria-label={say('Tamanho da letra','Text size')}>
    <button type="button" aria-label={say('Diminuir letra','Smaller text')} onClick={()=>setSettings(value=>stepFont(value,-1))}>A−</button>
    <output aria-live="polite">{size}px</output>
    <button type="button" aria-label={say('Aumentar letra','Larger text')} onClick={()=>setSettings(value=>stepFont(value,1))}>A+</button>
   </span>
   <span className="teleprompter-group" role="group" aria-label={say('Velocidade','Speed')}>
    <button type="button" aria-label={say('Mais devagar','Slower')} disabled={reduced} onClick={()=>setSettings(value=>stepSpeed(value,-1))}>−</button>
    <output aria-live="polite">{pxPerSecond} px/s</output>
    <button type="button" aria-label={say('Mais rápido','Faster')} disabled={reduced} onClick={()=>setSettings(value=>stepSpeed(value,1))}>+</button>
   </span>
   <label className="teleprompter-mirror"><input type="checkbox" checked={settings.mirror} onChange={event=>setSettings(value=>({...value,mirror:event.target.checked}))}/>{say('Espelhar texto','Mirror text')}</label>
   <button type="button" onClick={restart}>{say('Voltar ao início','Back to start')}</button>
   <button type="button" className="teleprompter-close" onClick={onClose}>{say('Sair (Esc)','Exit (Esc)')}</button>
  </div>
  <p id="tp-status" className="teleprompter-status" role="status">{status}{reduced&&` · ${say('Movimento reduzido: use as páginas; a rolagem automática está desligada.','Reduced motion: use the pages; automatic scrolling is off.')}`}</p>
  <section className="teleprompter-scene" aria-label={say('Orientação por cena','Scene guide')}>
   {scenes.length>0?<>
    <div className="teleprompter-scene-current">
     <button type="button" aria-label={say('Cena anterior','Previous scene')} disabled={scene===0} onClick={()=>setScene(value=>sceneNavigation(scenes,value,-1))}>‹</button>
     <p aria-live="polite"><span>{say('Cena','Scene')} {scene+1} {say('de','of')} {scenes.length}</span> {current?.title}</p>
     <button type="button" aria-label={say('Próxima cena','Next scene')} disabled={scene>=scenes.length-1} onClick={()=>setScene(value=>sceneNavigation(scenes,value,1))}>›</button>
    </div>
    <ol className="teleprompter-scene-list">{scenes.map((item,index)=><li key={item.index}><button type="button" aria-pressed={index===scene} aria-label={`${say('Cena','Scene')} ${item.index}: ${item.title}`} onClick={()=>setScene(index)}>{item.index}. {item.title}</button></li>)}</ol>
    <p className="teleprompter-scene-source">{say(`Fonte: tópicos${pathTitle?` do caminho “${pathTitle}”`:' do caminho'} aprovado no roteiro v${version}. Marcação manual: o app não sabe onde cada cena começa no texto e não estima durações.`,`Source: topics${pathTitle?` of the “${pathTitle}” path`:' of the path'} approved in script v${version}. Manual marker: the app does not know where each scene starts in the text and does not estimate durations.`)}</p>
   </>:<p className="teleprompter-scene-source">{say('O caminho aprovado não define cenas; nenhuma foi inventada.','The approved path defines no scenes; none were invented.')}</p>}
  </section>
  <div ref={body} className="teleprompter-body" tabIndex={0} role="document" aria-label={say('Roteiro aprovado','Approved script')} data-mirror={settings.mirror}>
   <div className="teleprompter-text" style={{fontSize:size}}>{script}</div>
   <div className="teleprompter-end" aria-hidden="true"/>
  </div>
  <p className="teleprompter-note">{say('Somente leitura. O app não grava vídeo nem altera o roteiro; grave fora do app e importe depois.','Read-only. The app does not record video or change the script; record outside the app, then import.')}</p>
 </div>,document.body);
}
