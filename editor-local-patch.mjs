/**
 * Localized VISUAL adjustment of a delivered edit: a window [start,end) of the EDITED video (the timeline the person sees)
 * changes; everything else must render exactly as before. The proof is structural and pre-encode: the plan outside the
 * storyboard (cuts, audio flags, format, theme, overlays) is identical, the storyboard globals (style, assets, SFX, timeline)
 * are identical, and every scene the renderer would show on any frame outside the window resolves to the SAME props as in
 * the base (the props the Remotion composition receives, including camera inheritance from the neighbour scene). Pixels of a
 * re-encoded MP4 are not promised; audio identity is proven separately on the exported file.
 *
 * A scene that crosses a window edge is never clipped (its animation phase outside could change): the adjustment is refused
 * up front with the exact intervals that ARE possible (expand to the whole scene, or shrink to the part without it), and
 * the person chooses explicitly.
 */
import {resolveStoryboardProps,segmentsHash,applyScreenModes} from './editorial-storyboard.mjs';

export const LOCAL_PATCH_LIMITS=Object.freeze({minSeconds:0.5,maxSeconds:60,previewMargin:1});
const round=value=>Math.round(value*100)/100;
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const precise=value=>String(value).includes('.')?String(value).replace('.',','):`${value},0`;
const seconds=value=>`${precise(value)}s`;
export const windowLabel=window=>`${precise(window.start)}–${precise(window.end)} s`;

/** The requested window on the edited timeline, or an Error with the reason (nothing is clamped silently). */
export function validateWindow(window,outputDuration){
 const start=Number(window?.start),end=Number(window?.end);
 if(!Number.isFinite(start)||!Number.isFinite(end))throw Error('Informe o trecho com início e fim em segundos do vídeo editado.');
 if(start<0||end<=start)throw Error('O fim do trecho precisa ser depois do início.');
 if(Number.isFinite(outputDuration)&&start>=outputDuration)throw Error(`O vídeo editado tem ${seconds(outputDuration)}: o trecho ${windowLabel({start,end})} começa depois do fim.`);
 if(Number.isFinite(outputDuration)&&end>outputDuration+1e-6)throw Error(`O vídeo editado tem ${seconds(outputDuration)}: o trecho ${windowLabel({start,end})} passa do fim. Use um fim até ${seconds(outputDuration)}.`);
 if(end-start<LOCAL_PATCH_LIMITS.minSeconds)throw Error(`O trecho precisa ter ao menos ${LOCAL_PATCH_LIMITS.minSeconds}s.`);
 if(end-start>LOCAL_PATCH_LIMITS.maxSeconds)throw Error(`Ajuste localizado cobre até ${LOCAL_PATCH_LIMITS.maxSeconds}s. Para mudar mais que isso, peça um ajuste geral da edição.`);
 return {start,end};
}
const frameWindow=(window,fps)=>({from:Math.floor(window.start*fps+1e-6),to:Math.ceil(window.end*fps-1e-6)});

/**
 * Scenes of the base plan relative to the window: inside (editable), crossing an edge (locked: the request is refused with
 * options), outside. options = explicit alternatives for the person (never applied automatically).
 */
export function patchWindowInfo(plan,window,{fps,outputDuration}){
 const scenes=plan?.storyboard?.scenes??[],{from,to}=frameWindow(window,fps);
 const inside=[],crossing=[];
 for(const scene of scenes){const a=scene.start,b=scene.end;if(b<=window.start||a>=window.end)continue;if(a>=window.start&&b<=window.end)inside.push({id:scene.id,...(scene.name?{name:scene.name}:{}),start:scene.start,end:scene.end});else crossing.push({id:scene.id,...(scene.name?{name:scene.name}:{}),start:scene.start,end:scene.end,edge:a<window.start&&b>window.end?'both':a<window.start?'start':'end'});}
 const options=[];
 if(crossing.length){
  const start=Math.min(window.start,...crossing.map(item=>item.start)),end=Math.max(window.end,...crossing.map(item=>item.end));
  if(end-start<=LOCAL_PATCH_LIMITS.maxSeconds)options.push({kind:'expand',start,end:Math.min(end,outputDuration??end),label:`Ajustar ${windowLabel({start,end})} (inclui a cena inteira)`});
  const left=crossing.filter(item=>item.edge==='start'||item.edge==='both'),right=crossing.filter(item=>item.edge==='end'||item.edge==='both');
  const s=Math.max(window.start,...left.map(item=>item.end)),e=Math.min(window.end,...right.map(item=>item.start));
  if(e-s>=LOCAL_PATCH_LIMITS.minSeconds)options.push({kind:'shrink',start:s,end:e,label:`Ajustar só ${windowLabel({start:s,end:e})} (sem tocar na cena que atravessa a borda)`});
 }
 return {window,frames:{from,to},inside,crossing,options};
}
/** PT message for a window that crosses scenes: what is locked and the exact supported alternatives. */
export function crossingMessage(info){
 const names=info.crossing.map(item=>`“${item.name??item.id}” (${windowLabel(item)})`).join(', ');
 return `O trecho ${windowLabel(info.window)} corta ao meio a cena ${names}. Para não mudar nada fora do trecho, essa cena não é recortada. ${info.options.length?`Escolha: ${info.options.map(item=>item.label).join(' ou ')}.`:'Escolha outro trecho que comece e termine fora dela.'} Nada foi alterado.`;
}
// screenMode: default composition of a camera+screen content, so the proof compares exactly what the renderer shows.
const resolved=(plan,fps,duration,screenMode)=>{const props=resolveStoryboardProps(plan.storyboard,{fps,durationSeconds:duration});return screenMode?applyScreenModes(props,screenMode):props;};
const globals=props=>({version:props.version,treatment:props.treatment,palette:props.palette,fonts:props.fonts,defaults:props.defaults,assets:props.assets,sfx:props.sfx,protect:props.protect});

/**
 * Typed allowlist of a local patch. Returns {errors,changedScenes,proof}. errors explain in PT what would change outside the
 * window; proof records what was compared (for the delivery message and the report).
 */
export function localPatchProblems(base,next,window,{fps,outputDuration,screenMode}){
 const errors=[];
 if(!base?.storyboard)return {errors:['A versão entregue não tem storyboard de motion: o ajuste localizado precisa do plano autorado pelo editor.'],changedScenes:[]};
 if(!next?.storyboard)return {errors:['O plano do ajuste precisa manter o storyboard.'],changedScenes:[]};
 const {storyboard:_a,...restBase}=base,{storyboard:_b,...restNext}=next;void _a;void _b;
 // Cuts, audio flags, format, theme, fixed overlays and motion cues: the whole plan outside the storyboard is frozen.
 for(const key of new Set([...Object.keys(restBase),...Object.keys(restNext)]))if(!same(restBase[key],restNext[key]))errors.push(key==='segments'?'Os cortes não podem mudar num ajuste de trecho (a fala e a linha do tempo ficam idênticas). Para cortar ou reordenar, peça um ajuste geral.':['normalizeAudio','audio'].includes(key)?'O áudio não pode mudar num ajuste visual de trecho.':`O campo ${key} do plano não pode mudar num ajuste de trecho.`);
 const sb=base.storyboard,nb=next.storyboard;
 for(const key of ['version','timeline','style','assets'])if(!same(sb[key],nb[key]))errors.push(key==='assets'?'Os assets do storyboard não podem mudar num ajuste de trecho.':`storyboard.${key} não pode mudar num ajuste de trecho.`);
 if(!same(sb.sfx??[],nb.sfx??[]))errors.push('Os efeitos sonoros não podem mudar: o áudio da versão entregue fica idêntico.');
 if(segmentsHash(base.segments)!==segmentsHash(next.segments))errors.push('A linha do tempo (cortes) mudou.');
 if(errors.length)return {errors,changedScenes:[]};
 let a,b;try{a=resolved(base,fps,outputDuration,screenMode);b=resolved(next,fps,outputDuration,screenMode);}catch(error){return {errors:[`Storyboard inválido: ${String(error?.message??error).slice(0,300)}`],changedScenes:[]};}
 if(!same(globals(a),globals(b)))errors.push('O estilo global do motion mudou (paleta, fontes, assets ou SFX).');
 const {from,to}=frameWindow(window,fps),outside=scene=>scene.startFrame<from||scene.endFrame>to;
 const byId=list=>new Map(list.map(scene=>[scene.id,scene]));
 const before=byId(a.scenes),after=byId(b.scenes);
 let checked=0;
 for(const scene of a.scenes)if(outside(scene)){checked++;const twin=after.get(scene.id);if(!twin||!same(scene,twin))errors.push(`A cena “${scene.name??scene.id}” (${(scene.startFrame/fps).toFixed(2)}–${(scene.endFrame/fps).toFixed(2)}s) aparece fora do trecho e mudou${twin&&twin.cameraFrom!==scene.cameraFrom?' (o enquadramento de câmera herdado da cena vizinha dentro do trecho mudou: mantenha o layout de câmera da cena que encosta nela)':twin&&twin.cameraJoinedOut!==scene.cameraJoinedOut?' (a ligação de câmera com a cena seguinte mudou)':''}. Ela precisa ficar idêntica.`);}
 for(const scene of b.scenes){if(!outside(scene))continue;const twin=before.get(scene.id);if(!twin||!outside(twin))errors.push(`A cena “${scene.name??scene.id}” do ajuste sai do trecho ${windowLabel(window)}. Cenas novas ou alteradas ficam inteiras dentro dele.`);}
 for(const item of a.dropped??[])if(!(b.dropped??[]).some(other=>other.id===item.id))errors.push(`A camada ${item.id} mudou de estado fora do trecho.`);
 const changedScenes=[...new Set([...a.scenes.filter(scene=>!outside(scene)&&!same(scene,after.get(scene.id))).map(scene=>scene.id),...b.scenes.filter(scene=>!outside(scene)&&!before.has(scene.id)).map(scene=>scene.id)])];
 if(!errors.length&&!changedScenes.length)errors.push(`Nada mudou dentro do trecho ${windowLabel(window)}: o plano é igual à versão entregue.`);
 return {errors:errors.slice(0,12),changedScenes,proof:{kind:'resolved-props',fps,windowFrames:{from,to},outsideScenesCompared:checked,changedScenes}};
}
