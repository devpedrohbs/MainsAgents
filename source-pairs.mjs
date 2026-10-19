/**
 * Camera + screen recording of ONE content (pure, browser-safe except artifactHash import).
 *
 * Convention (shown to the person as a sentence): `offsetSeconds` is the instant of the CAMERA timeline at which the screen
 * recording starts, so screenTime = cameraTime − offsetSeconds. Positive: the screen started after the camera; negative: before.
 * The CAMERA is the primary timeline: the plan's segments (cuts) are camera times; the screen follows through the exact
 * transform below BEFORE the cut mapper (never an offset applied to the already cut video). Parts of a kept segment without
 * screen are explicit gaps: the composition shows the camera full there (no frozen frame, nothing invented).
 */
import {artifactHash} from './editorial-jobs.mjs';

export const PAIR_VERSION=1;
export const pairLayouts=Object.freeze(['camera-corner','screen-full','alternate']);
export const pairVoices=Object.freeze(['camera','screen']);
/** Scene composition vocabulary (storyboard `scene.screen`): off = camera only, full = screen only, with-camera = screen + camera corner. */
export const screenModes=Object.freeze(['off','full','with-camera']);
export const PAIR_LIMITS=Object.freeze({maxOffsetSeconds:3600,minOverlapSeconds:1,screenMaxSide:1920});
const round3=value=>Math.round(value*1000)/1000;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const ref=value=>value&&typeof value.assetId==='string'&&typeof value.versionId==='string'&&/^[a-f0-9]{64}$/.test(value.sha256??'');
const pick=value=>({assetId:value.assetId,versionId:value.versionId,sha256:value.sha256});

/** Default composition of a scene for the pair layout ('alternate' = the director decides per scene; with-camera otherwise). */
export const defaultScreenMode=layout=>layout==='screen-full'?'full':'with-camera';
/** Default voice: the camera when it has audio, else the screen when it has audio, else none (silent edit). */
export function defaultVoice({cameraHasAudio,screenHasAudio}){return cameraHasAudio?'camera':screenHasAudio?'screen':'camera';}

/** Hash of everything that shapes the output: both exact sources, offset, voice and layout. Sync origin is evidence, not output. */
export function pairHash(pair){
 return artifactHash({kind:'camera-screen-pair',v:PAIR_VERSION,camera:pick(pair.camera),screen:pick(pair.screen),offsetSeconds:round3(pair.offsetSeconds),voice:pair.voice,layout:pair.layout});
}

/** Normalizes a pair; throws an actionable PT error. */
export function validatePair(raw){
 if(!raw||typeof raw!=='object')throw Error('Par câmera + tela inválido.');
 if(!ref(raw.camera)||!ref(raw.screen))throw Error('O par precisa das duas fontes verificadas (câmera e tela).');
 if(raw.camera.assetId===raw.screen.assetId||raw.camera.sha256===raw.screen.sha256)throw Error('Câmera e tela precisam ser dois arquivos diferentes.');
 if(!finite(raw.offsetSeconds)||Math.abs(raw.offsetSeconds)>PAIR_LIMITS.maxOffsetSeconds)throw Error(`Atraso inválido: use segundos entre −${PAIR_LIMITS.maxOffsetSeconds} e ${PAIR_LIMITS.maxOffsetSeconds}.`);
 if(!pairVoices.includes(raw.voice))throw Error('Escolha a fonte de voz: câmera ou tela.');
 if(!pairLayouts.includes(raw.layout))throw Error('Escolha o layout: câmera no canto, tela inteira ou alternar.');
 const sync=raw.sync&&typeof raw.sync==='object'?raw.sync:{};
 if(!['measured','manual'].includes(sync.origin))throw Error('Informe se o atraso foi medido ou definido manualmente.');
 const value={version:PAIR_VERSION,camera:pick(raw.camera),screen:pick(raw.screen),offsetSeconds:round3(raw.offsetSeconds),voice:raw.voice,layout:raw.layout,
  sync:{origin:sync.origin,verified:sync.origin==='measured'&&sync.verified===true,...(finite(sync.driftSeconds)?{driftSeconds:round3(sync.driftSeconds)}:{}),...(finite(sync.score)?{score:round3(sync.score)}:{}),...(typeof sync.reason==='string'?{reason:sync.reason.slice(0,60)}:{}),...(typeof sync.measuredAt==='string'?{measuredAt:sync.measuredAt.slice(0,40)}:{})}};
 return {...value,hash:pairHash(value)};
}

/** Overlap of the two recordings on the camera timeline. */
export function overlapOf({cameraDuration,screenDuration,offsetSeconds}){
 const start=Math.max(0,offsetSeconds),end=Math.min(cameraDuration,offsetSeconds+screenDuration);
 return {start:round3(start),end:round3(Math.max(start,end)),seconds:round3(Math.max(0,end-start)),coverage:cameraDuration>0?round3(Math.max(0,end-start)/cameraDuration):0};
}

/** PT sentence of the convention, e.g. "A tela começa 2,40 s depois da câmera." */
export function offsetSentence(offsetSeconds){
 const value=Math.abs(round3(offsetSeconds)).toFixed(2).replace('.',',');
 return Math.abs(offsetSeconds)<0.0005?'Câmera e tela começam no mesmo instante.':offsetSeconds>0?`A tela começa ${value} s depois da câmera.`:`A tela começa ${value} s antes da câmera.`;
}

/**
 * Exact transform camera segments -> screen pieces. Each kept camera segment [s,e) maps to screen times [s−o,e−o) clipped to
 * the screen recording; what falls outside is a gap. Output (edited) times accumulate exactly like the camera cut.
 * Returns {pieces:[{kind:'screen'|'gap',outStart,outEnd,cameraStart,cameraEnd,screenStart?,screenEnd?}], windows:[{start,end}] (edited timeline, screen available), screenSeconds, gapSeconds}.
 */
export function mapScreenSegments(segments,{offsetSeconds,screenDuration}){
 const pieces=[];let cursor=0;
 for(const seg of segments){
  const a=Math.min(seg.end,Math.max(seg.start,offsetSeconds)),b=Math.max(a,Math.min(seg.end,offsetSeconds+screenDuration));
  const push=(kind,from,to)=>{if(to-from<=0.0005)return;const outStart=cursor+(from-seg.start),outEnd=cursor+(to-seg.start);pieces.push({kind,outStart:round3(outStart),outEnd:round3(outEnd),cameraStart:round3(from),cameraEnd:round3(to),...(kind==='screen'?{screenStart:round3(from-offsetSeconds),screenEnd:round3(to-offsetSeconds)}:{})});};
  push('gap',seg.start,a);push('screen',a,b);push('gap',b,seg.end);
  cursor+=seg.end-seg.start;
 }
 const windows=[];for(const piece of pieces.filter(item=>item.kind==='screen')){const last=windows.at(-1);if(last&&piece.outStart-last.end<0.002)last.end=piece.outEnd;else windows.push({start:piece.outStart,end:piece.outEnd});}
 const sum=kind=>round3(pieces.filter(item=>item.kind===kind).reduce((total,item)=>total+item.outEnd-item.outStart,0));
 return {pieces,windows,screenSeconds:sum('screen'),gapSeconds:sum('gap'),outputDuration:round3(cursor)};
}

/** Voice from the screen needs EVERY kept segment inside the screen recording (no silent holes in the voice). */
export function voiceCoverageProblem(segments,{offsetSeconds,screenDuration}){
 for(const [index,seg] of segments.entries()){if(seg.start-offsetSeconds<-0.0005||seg.end-offsetSeconds>screenDuration+0.0005)return `O trecho mantido ${index+1} (${seg.start.toFixed(2)}–${seg.end.toFixed(2)} s da câmera) não está inteiro dentro da gravação da tela; com voz da tela ele ficaria sem fala. Ajuste os cortes ou use a voz da câmera.`;}
 return null;
}

/** Even output size of the screen track: the screen's own aspect, longest side ≤ 1920 (never upscaled, never distorted). */
export function screenTrackSize({width,height},maxSide=PAIR_LIMITS.screenMaxSide){
 const scale=Math.min(1,maxSide/Math.max(width,height));
 return {width:Math.max(2,Math.floor(width*scale/2)*2),height:Math.max(2,Math.floor(height*scale/2)*2)};
}
const fmt=value=>round3(value).toFixed(3);

/**
 * FFmpeg filter of the screen track (input index `input`, video only): one piece per mapped interval, gaps as black frames of
 * the same size/fps (marked by `windows`, so the composition never shows them). Same total duration as the camera cut.
 */
export function screenCutFilter(pieces,{input=1,fps,size,label='sout',scaleTail=''}){
 if(!pieces.length)throw Error('Nenhum trecho para a trilha da tela.');
 const parts=[],labels=[],rate=fmt(fps);
 pieces.forEach((piece,index)=>{
  const name=`s${index}`,duration=piece.outEnd-piece.outStart;
  if(piece.kind==='screen')parts.push(`[${input}:v:0]trim=start=${fmt(piece.screenStart)}:end=${fmt(piece.screenEnd)},setpts=PTS-STARTPTS,scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease,pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${rate},format=yuv420p[${name}]`);
  else parts.push(`color=c=black:s=${size.width}x${size.height}:r=${rate}:d=${fmt(duration)},setsar=1,format=yuv420p[${name}]`);
  labels.push(`[${name}]`);
 });
 parts.push(`${labels.join('')}concat=n=${pieces.length}:v=1:a=0${scaleTail?`[sraw];[sraw]${scaleTail}`:''}[${label}]`);
 return parts.join(';');
}

/** Words/segments of the voice source on the camera timeline (voice = screen: +offset), clipped to the camera recording. */
export function shiftTranscript(transcript,{shift,duration}){
 if(!transcript||!shift)return transcript;
 const move=item=>({...item,start:round3(item.start+shift),end:round3(item.end+shift)});
 const keep=item=>item.end>0&&item.start<duration;
 return {...transcript,segments:(transcript.segments??[]).map(move).filter(keep),...(Array.isArray(transcript.words)?{words:transcript.words.map(move).filter(keep)}:{}),shiftedBy:round3(shift)};
}
