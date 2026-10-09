import {artifactHash} from './editorial-jobs.mjs';
import {normalizeMotion} from './editorial-motion-plan.mjs';
import {reframeCropFilter} from './editorial-reframe.mjs';

/** Pure helpers for semi-automatic editing. Analyses and plans are suggestions; nothing here renders. */
export const smartEditLimits=Object.freeze({maxInputSeconds:3600,maxSegments:200,maxCandidates:500,maxAnimations:3,maxAnimatedSeconds:1800,minSegmentSeconds:0.1,maxTranscriptSegments:5000,maxTextLength:80,maxTranscriptText:500});
export const animationKinds=Object.freeze(['title','lowerThird','cta']);
export const animationThemes=Object.freeze(['dark','light']);
export const defaultSilenceOptions=Object.freeze({thresholdDb:-35,minDuration:0.5,padding:0.15});
/** Opt-in voice treatment. Noise reduction needs a noise floor MEASURED on the source (server-verified provenance). */
export const audioTreatment=Object.freeze({minNoiseFloorDb:-62,maxNoiseFloorDb:-20,reductionDb:10,highpassHz:70,cutFadeSeconds:0.012});

const round=value=>Math.round(value*1000)/1000;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const fmt=value=>value.toFixed(6);

export function silenceOptions(input={}){
  const value={...defaultSilenceOptions,...(input??{})};
  if(!finite(value.thresholdDb)||value.thresholdDb<-80||value.thresholdDb>-10||!finite(value.minDuration)||value.minDuration<0.1||value.minDuration>10||!finite(value.padding)||value.padding<0||value.padding>1)throw new Error('Invalid silence options: thresholdDb -80..-10, minDuration 0.1..10, padding 0..1.');
  return {thresholdDb:value.thresholdDb,minDuration:value.minDuration,padding:value.padding};
}

export function assertAnalyzable(metadata){
  if(!metadata||!finite(metadata.duration)||metadata.duration<=0)throw new Error('This file has no readable duration.');
  if(metadata.duration>smartEditLimits.maxInputSeconds)throw new Error('Advanced editing accepts videos up to one hour.');
}

/** Fixed arguments; only validated numbers enter the filter. ametadata prints to stdout so the bounded runner captures it. */
export function silenceDetectArgs(path,options){
  const {thresholdDb,minDuration}=silenceOptions(options);
  return ['-nostdin','-hide_banner','-v','error','-protocol_whitelist','file,pipe','-i',path,'-map','0:a:0','-vn','-sn','-dn','-af',`silencedetect=noise=${thresholdDb}dB:duration=${minDuration},ametadata=mode=print:file=-`,'-f','null','-'];
}

export function parseSilences(text,duration){
  const result=[];let open=null;
  for(const match of String(text).matchAll(/lavfi\.silence_(start|end)=(-?[0-9.]+(?:e[-+]?\d+)?)/g)){
    const at=Number(match[2]);if(!Number.isFinite(at))continue;
    if(match[1]==='start')open=Math.max(0,at);
    else if(open!==null){result.push({start:open,end:Math.min(duration,at)});open=null;}
  }
  if(open!==null&&open<duration)result.push({start:open,end:duration});
  return result.filter(item=>item.end>item.start);
}

/** Silence candidates shrink by padding so speech edges are protected; leading/trailing silence is cut to the file edge. */
export function silenceCandidates(silences,{duration,padding=defaultSilenceOptions.padding}){
  const limitations=[],candidates=[];
  const silent=silences.reduce((sum,item)=>sum+item.end-item.start,0);
  if(duration-silent<smartEditLimits.minSegmentSeconds*2||silent/duration>=0.98)return {candidates,limitations:['allSilent']};
  for(const item of silences){
    const start=item.start<=0.01?0:item.start+padding,end=item.end>=duration-0.01?duration:item.end-padding;
    if(end-start<smartEditLimits.minSegmentSeconds)continue;
    if(candidates.length>=smartEditLimits.maxCandidates){limitations.push('candidatesTruncated');break;}
    candidates.push(Object.freeze({id:`silence-${candidates.length+1}`,kind:'silence',start:round(start),end:round(end),label:`Silêncio ${round(end-start)}s`,reason:'Pausa sem fala detectada; padding preservado nas bordas.',selected:true}));
  }
  return {candidates,limitations};
}

const words=text=>String(text).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(Boolean);

/** `origin` comes from the caller (engine), never from the payload, so imported text cannot pose as a local transcription. */
export function validateTranscript(input,duration,{origin='imported',...info}={}){
  if(input==null)return null;
  const segments=input.segments;
  if(!Array.isArray(segments)||!segments.length||segments.length>smartEditLimits.maxTranscriptSegments)throw new Error('Transcript must contain timed segments.');
  let previous=0;
  const normalized=segments.map(item=>{
    if(!finite(item?.start)||!finite(item?.end)||item.start<0||item.end<=item.start||item.end>duration+0.5||item.start<previous-0.001||typeof item.text!=='string'||item.text.length>smartEditLimits.maxTranscriptText||/[\u0000-\u001f\u007f]/.test(item.text.replace(/[\n\t]/g,' ')))throw new Error('Transcript segments must be ordered, finite, inside the video and contain bounded text.');
    previous=item.start;return Object.freeze({start:round(item.start),end:round(Math.min(item.end,duration)),text:item.text.trim()});
  });
  return Object.freeze({origin,...info,segments:Object.freeze(normalized)});
}

/** Possible retakes only: adjacent, similar phrases. Never claims a mistake and never preselects removal. */
export function retakeCandidates(transcript){
  if(!transcript)return [];
  const result=[],list=transcript.segments;
  for(let index=0;index<list.length-1&&result.length<smartEditLimits.maxCandidates;index++){
    const a=words(list[index].text),b=words(list[index+1].text);
    if(a.length<2||b.length<2||list[index+1].start-list[index].end>3)continue;
    const head=Math.min(3,a.length),sameStart=a.slice(0,head).join(' ')===b.slice(0,head).join(' ');
    const setA=new Set(a),setB=new Set(b),shared=[...setA].filter(word=>setB.has(word)).length,similarity=shared/new Set([...a,...b]).size;
    if(!sameStart&&similarity<0.6)continue;
    result.push(Object.freeze({id:`retake-${result.length+1}`,kind:'possibleRetake',start:list[index].start,end:round(Math.min(list[index+1].start,Math.max(list[index].end,list[index].start+smartEditLimits.minSegmentSeconds))),label:'Possível retomada',reason:'Trecho parecido com o seguinte. Revise o texto e o áudio antes de remover.',selected:false}));
  }
  return result;
}

/** Kept intervals = complement of the selected removals on the original timeline. */
export function keptSegments(removed,duration){
  const sorted=removed.filter(item=>item.end>item.start).map(item=>({start:Math.max(0,item.start),end:Math.min(duration,item.end)})).sort((a,b)=>a.start-b.start);
  const kept=[];let cursor=0;
  for(const item of sorted){if(item.start-cursor>=smartEditLimits.minSegmentSeconds)kept.push({start:round(cursor),end:round(item.start)});cursor=Math.max(cursor,item.end);}
  if(duration-cursor>=smartEditLimits.minSegmentSeconds)kept.push({start:round(cursor),end:round(duration)});
  return kept;
}

const textLimits=Object.freeze({title:80,lowerThird:60,cta:80,subtitle:80});
const safeText=(value,max)=>typeof value==='string'&&value.trim().length>0&&[...value.trim()].length<=max&&!/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩<>{}`\\]|:\/\/|javascript:/i.test(value);

/** Animations match the local Remotion template: at most one title, lower third and CTA; the CTA is anchored to the end. */
export function validatePlan(plan,sourceDuration){
  if(!plan||typeof plan!=='object'||Array.isArray(plan))throw new Error('Invalid edit plan.');
  const allowed=new Set(['segments','animations','format','normalizeAudio','theme','motion','audio']);if(Object.keys(plan).some(key=>!allowed.has(key)))throw new Error('Unsupported edit plan field.');
  const segments=plan.segments;
  if(!Array.isArray(segments)||!segments.length||segments.length>smartEditLimits.maxSegments)throw new Error(`Keep between 1 and ${smartEditLimits.maxSegments} segments.`);
  let previous=0;
  const kept=segments.map((item,index)=>{
    if(!item||Object.keys(item).some(key=>key!=='start'&&key!=='end')||!finite(item.start)||!finite(item.end))throw new Error('Segments must contain only finite start and end seconds.');
    if(item.start<0||item.end>sourceDuration+0.001||item.end-item.start<smartEditLimits.minSegmentSeconds)throw new Error('Each segment must fit the source and last at least 0.1 seconds.');
    if(index&&item.start<previous)throw new Error('Segments must be ordered and must not overlap.');
    previous=item.end;return {start:round(item.start),end:round(Math.min(item.end,sourceDuration))};
  });
  const outputDuration=round(kept.reduce((sum,item)=>sum+item.end-item.start,0));
  const format=plan.format??'original';if(!['original','portrait'].includes(format))throw new Error('Unsupported output format.');
  const normalizeAudio=plan.normalizeAudio??false;if(typeof normalizeAudio!=='boolean')throw new Error('normalizeAudio must be boolean.');
  const theme=plan.theme??'dark';if(!animationThemes.includes(theme))throw new Error('Animation theme must be dark or light.');
  const animations=(plan.animations??[]);
  if(!Array.isArray(animations)||animations.length>smartEditLimits.maxAnimations)throw new Error(`Use at most ${smartEditLimits.maxAnimations} animations.`);
  if(animations.length&&outputDuration>smartEditLimits.maxAnimatedSeconds)throw new Error('Animated exports accept up to 30 minutes of edited video.');
  const kinds=new Set();
  const overlays=animations.map(item=>{
    const keys=['id','kind','text','subtitle','start','duration'];
    if(!item||Object.keys(item).some(key=>!keys.includes(key))||typeof item.id!=='string'||!/^[a-zA-Z0-9_-]{1,40}$/.test(item.id)||kinds.has(item.kind)||!animationKinds.includes(item.kind)||!safeText(item.text,textLimits[item.kind])||item.subtitle!==undefined&&(item.kind!=='lowerThird'||!safeText(item.subtitle,textLimits.subtitle)))throw new Error('Animations accept one title, lower third and CTA with short plain text.');
    if(!finite(item.duration)||item.duration<0.5||item.duration>outputDuration+0.001||item.kind!=='cta'&&(!finite(item.start)||item.start<0||item.start+item.duration>outputDuration+0.001))throw new Error('Animation timing must fit the edited output.');
    kinds.add(item.kind);const duration=round(Math.min(item.duration,outputDuration));
    return {id:item.id,kind:item.kind,text:item.text.trim(),...(item.subtitle!==undefined?{subtitle:item.subtitle.trim()}:{}),start:item.kind==='cta'?round(outputDuration-duration):round(item.start),duration};
  });
  // Motion cues are anchored on the recording; their edited-video times are always re-derived from the kept segments.
  const motion=normalizeMotion(plan.motion,kept);
  if(motion?.cues.length&&outputDuration>smartEditLimits.maxAnimatedSeconds)throw new Error('Animated exports accept up to 30 minutes of edited video.');
  const audio=plan.audio===undefined?undefined:validateAudioTreatment(plan.audio);
  return {plan:{segments:kept,animations:overlays,format,normalizeAudio,theme,...(motion?{motion}:{}),...(audio?{audio}:{})},outputDuration};
}

/** Shape/range only. Whether noiseFloorDb was really measured on this source is checked server-side (assertMeasuredNoiseFloor). */
export function validateAudioTreatment(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['leveling','noiseReduction','smoothCuts'].includes(key)))throw new Error('Unsupported audio treatment field.');
  const leveling=input.leveling??false,smoothCuts=input.smoothCuts??false,reduction=input.noiseReduction??false;
  if(typeof leveling!=='boolean'||typeof smoothCuts!=='boolean')throw new Error('Audio leveling and smooth cuts must be boolean.');
  let noiseReduction=false;
  if(reduction!==false){
    if(!reduction||typeof reduction!=='object'||Array.isArray(reduction)||Object.keys(reduction).some(key=>key!=='noiseFloorDb')||!finite(reduction.noiseFloorDb))throw new Error('Noise reduction needs the measured noise floor of this source.');
    if(reduction.noiseFloorDb<audioTreatment.minNoiseFloorDb)throw new Error('No measurable noise in this source; noise reduction would not improve it.');
    if(reduction.noiseFloorDb>audioTreatment.maxNoiseFloorDb)throw new Error('Measured noise floor is outside the conservative reduction range.');
    noiseReduction={noiseFloorDb:Math.round(reduction.noiseFloorDb*10)/10};
  }
  return {leveling,noiseReduction,smoothCuts};
}

/** True when the export needs the Remotion pass (fixed overlays or motion cues). */
/** Motion counts when it has cues or a framing focus (manual reframe without cues still needs the Remotion pass). */
const hasMotion=motion=>Boolean(motion?.cues?.length||motion?.reframe);
export const needsAnimation=plan=>Boolean(plan?.animations?.length||hasMotion(plan?.motion));

/**
 * Vertical (9:16) crop that follows a user/detected framing focus, keyframed on the EDITED timeline (it runs after the
 * concat). `source` is the decoded source size. Null keeps the legacy centred crop (no focus, or the default focus).
 */
export function portraitCrop(plan,source){
  const reframe=plan?.motion?.reframe;
  if(plan?.format!=='portrait'||!reframe||reframe.source==='default'||!Number.isInteger(source?.width)||!Number.isInteger(source?.height))return null;
  return reframeCropFilter(reframe,{sourceWidth:source.width,sourceHeight:source.height,width:1080,height:1920});
}
const clamp01=value=>Math.min(1,Math.max(0,value)),round4=value=>Math.round(value*10000)/10000;
/** Focus points in SOURCE coordinates -> coordinates of the cropped 9:16 frame the composition receives (no double shift). */
function croppedReframe(reframe,crop){
  const {scaledWidth:sw,scaledHeight:sh}=crop;
  return {...reframe,points:reframe.points.map(point=>{const cx=Math.min(Math.max(0,point.x*sw-540),sw-1080),cy=Math.min(Math.max(0,point.y*sh-960),sh-1920);
    return {...point,x:round4(clamp01((point.x*sw-cx)/1080)),y:round4(clamp01((point.y*sh-cy)/1920)),...(point.w!==undefined?{w:round4(clamp01(point.w*sw/1080)),h:round4(clamp01(point.h*sh/1920))}:{})};})};
}

/**
 * Conservative union of the burned-caption presets (2 lines, editorial-captions geometry): vertical output keeps
 * 66–90 % of the height free of motion text, landscape/square 60–90 %.
 */
export function captionBand(plan,source){
  const portrait=plan?.format==='portrait'||Number.isFinite(source?.width)&&Number.isFinite(source?.height)&&source.height>source.width*1.2;
  return portrait?{top:0.66,bottom:0.9}:{top:0.6,bottom:0.9};
}
/** Exact input of the local Remotion adapter (editorial-remotion.mjs renderAnimatedVideo). `source` = decoded source size (vertical crop by focus). */
export function remotionAnimations(plan,{source}={}){
  const spec={theme:plan.theme??'dark'};
  for(const item of plan.animations){
    if(item.kind==='title')spec.title={text:item.text,startSeconds:item.start,durationSeconds:item.duration};
    if(item.kind==='lowerThird')spec.lowerThird={name:item.text,...(item.subtitle?{role:item.subtitle}:{}),startSeconds:item.start,durationSeconds:item.duration};
    if(item.kind==='cta')spec.cta={text:item.text,durationSeconds:item.duration};
  }
  if(hasMotion(plan.motion)){const crop=portraitCrop(plan,source);spec.motion=crop?{...plan.motion,reframe:croppedReframe(plan.motion.reframe,crop)}:plan.motion;}
  // Motion text stays out of the band where burned captions (later, libass presets classic/boxed/highlight) can appear.
  if(plan.motion?.cues?.length)spec.protect={captionBand:captionBand(plan,source)};
  return spec;
}

export function removedSegments(segments,duration){
  const removed=[];let cursor=0;
  for(const item of segments){if(item.start-cursor>0.0005)removed.push({start:cursor,end:item.start});cursor=item.end;}
  if(duration-cursor>0.0005)removed.push({start:cursor,end:round(duration)});
  return removed;
}

export const planHash=({contentId,assetId,versionId,sha256},plan)=>artifactHash({kind:'smart-edit-plan',contentId,assetId,versionId,sha256,plan});

/**
 * Same kept intervals for video and audio: trim/atrim + setpts/asetpts per segment, then one concat. Without `audio`
 * the filter is exactly the legacy one. `audio` adds short fades at cut edges (duration unchanged), conservative
 * high-pass + FFT denoise at the measured floor, and loudnorm ONCE (normalizeAudio || leveling).
 */
export function cutFilter(segments,{hasAudio,format='original',normalizeAudio=false,audio,video=true,motion,source}){
  const parts=[],labels=[],treatment=audio?validateAudioTreatment(audio):null,fade=audioTreatment.cutFadeSeconds;
  segments.forEach((item,index)=>{
    if(video)parts.push(`[0:v:0]trim=start=${fmt(item.start)}:end=${fmt(item.end)},setpts=PTS-STARTPTS[v${index}]`);
    const fades=treatment?.smoothCuts&&item.end-item.start>fade*4?[...(index>0||item.start>0.0005?[`afade=t=in:st=0:d=${fade}`]:[]),...(index<segments.length-1?[`afade=t=out:st=${fmt(item.end-item.start-fade)}:d=${fade}`]:[])]:[];
    if(hasAudio)parts.push(`[0:a:0]atrim=start=${fmt(item.start)}:end=${fmt(item.end)},asetpts=PTS-STARTPTS${fades.map(value=>`,${value}`).join('')}[a${index}]`);
    labels.push(!video?`[a${index}]`:hasAudio?`[v${index}][a${index}]`:`[v${index}]`);
  });
  const crop=video?portraitCrop({format,motion},source):null;
  const scale=format==='portrait'?crop?.filter??'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920':'scale=trunc(iw/2)*2:trunc(ih/2)*2';
  if(!video)parts.push(`${labels.join('')}concat=n=${segments.length}:v=0:a=1[ac]`);
  else parts.push(`${labels.join('')}concat=n=${segments.length}:v=1:a=${hasAudio?1:0}${hasAudio?'[vc][ac]':'[vc]'}`,`[vc]${scale},setsar=1[vout]`);
  if(hasAudio&&!treatment)parts.push(`[ac]${normalizeAudio?'loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000':'anull'}[aout]`);
  if(hasAudio&&treatment){
    const chain=[...(treatment.noiseReduction?[`highpass=f=${audioTreatment.highpassHz}`,`afftdn=nr=${audioTreatment.reductionDb}:nf=${treatment.noiseReduction.noiseFloorDb}`]:[]),...(normalizeAudio||treatment.leveling?['loudnorm=I=-16:TP=-1.5:LRA=11','aresample=48000']:[])];
    parts.push(`[ac]${chain.length?chain.join(','):'anull'}[aout]`);
  }
  return parts.join(';');
}

/** Kept segments with their position on the edited (output) timeline. */
export function outputTimeline(segments){
  let cursor=0;return segments.map(item=>{const value={start:item.start,end:item.end,outputStart:round(cursor)};cursor+=item.end-item.start;return value;});
}

/** Moves source-timeline speech onto the edited timeline; text split by a cut is merged when its pieces become contiguous. */
export function remapTranscript(transcriptSegments,segments){
  const map=outputTimeline(segments),result=[];
  for(const line of transcriptSegments){
    for(const kept of map){
      const start=Math.max(line.start,kept.start),end=Math.min(line.end,kept.end);if(end-start<0.05)continue;
      const piece={start:round(kept.outputStart+start-kept.start),end:round(kept.outputStart+end-kept.start),text:line.text},last=result.at(-1);
      if(last&&last.text===piece.text&&piece.start-last.end<0.05)last.end=piece.end;else result.push(piece);
    }
  }
  return result.filter(item=>item.end-item.start>=0.2);
}

const srtTime=seconds=>{const ms=Math.max(0,Math.round(seconds*1000)),h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000),s=Math.floor(ms%60000/1000);return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;};
/** SubRip text accepted by CapCut desktop/web subtitle import. */
export function toSrt(segments){
  return segments.map((item,index)=>`${index+1}\r\n${srtTime(item.start)} --> ${srtTime(item.end)}\r\n${item.text.replace(/\r?\n+/g,' ').trim()}\r\n`).join('\r\n');
}

/** What each cut removed, where it sits in the edited video and whether recognized speech falls inside it. */
/**
 * What each cut removed and where it lands in the edited video. With the FFmpeg silence analysis of the same version,
 * `soundSeconds` is the part of the cut that was NOT detected as silence (audio evidence). Whisper timings drift by up
 * to ~1 s around pauses, so the transcript only names the speech overlapping that sounding part; without silences it
 * falls back to transcript overlap (`basis:'transcript'`).
 */
export function cutReview(segments,sourceDuration,transcriptSegments=[],silences,evidence){
  const map=outputTimeline(segments),overlap=(item,range)=>Math.max(0,Math.min(item.end,range.end)-Math.max(item.start,range.start));
  return removedSegments(segments,sourceDuration).map((cut,index)=>{
    let sounding=[cut];
    if(silences){sounding=[];let cursor=cut.start;for(const quiet of silences.filter(item=>overlap(item,cut)>0).sort((x,y)=>x.start-y.start)){if(quiet.start>cursor)sounding.push({start:cursor,end:Math.min(quiet.start,cut.end)});cursor=Math.max(cursor,quiet.end);}if(cursor<cut.end)sounding.push({start:cursor,end:cut.end});sounding=sounding.filter(item=>item.end-item.start>0.05);}
    const soundSeconds=round(sounding.reduce((sum,item)=>sum+item.end-item.start,0));
    const words=transcriptSegments.filter(line=>sounding.some(part=>overlap(line,part)>0.15));
    const speechSeconds=silences?(words.length?soundSeconds:0):round(words.reduce((sum,line)=>sum+overlap(line,cut),0));
    const next=map.find(item=>item.start>=cut.end-0.0005),outputAt=next?next.outputStart:round(map.reduce((sum,item)=>sum+item.end-item.start,0));
    const base={id:`cut-${index+1}`,start:round(cut.start),end:round(cut.end),duration:round(cut.end-cut.start),outputAt,basis:silences?'audio':transcriptSegments.length?'transcript':'none',soundSeconds:silences?soundSeconds:null,speechSeconds,speech:words.map(line=>line.text).slice(0,5)};
    if(!evidence)return base;
    // Additive evidence: words mostly inside the cut, and the suggestions (by id) that the cut covers.
    const removedWords=(evidence.words??[]).filter(word=>finite(word?.start)&&finite(word?.end)&&word.end>word.start&&overlap(word,cut)>=(word.end-word.start)/2).map(word=>String(word.text).trim()).filter(Boolean);
    const causes=(evidence.candidates??[]).filter(item=>item.end>item.start&&overlap(item,cut)>=(item.end-item.start)/2);
    return {...base,removedWords:removedWords.slice(0,40),candidateIds:causes.map(item=>item.id),kinds:[...new Set(causes.map(item=>item.kind))],reasons:[...new Set(causes.map(item=>item.reason))].slice(0,5)};
  });
}
