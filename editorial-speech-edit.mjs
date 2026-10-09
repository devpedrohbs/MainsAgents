import {keptSegments,outputTimeline,removedSegments,retakeCandidates,smartEditLimits} from './editorial-smart-edit.mjs';

/**
 * Speech-aware cut suggestions (fillers, repeated words, restarted phrases, self-corrections) built from the local
 * transcript word timings. Pure and deterministic: nothing here renders or preselects a removal. Whisper word times
 * drift (~0.2-0.5 s near pauses), so with a measured voice track every cut edge must land on a frame below the
 * speech threshold; a candidate without such an edge is discarded, never offered as safe.
 */
export const speechEditKinds=Object.freeze(['filler','repetition','retake','selfCorrection']);
export const speechEditDefaults=Object.freeze({beforeKeptSeconds:0.08,afterKeptSeconds:0.06,snapSeconds:0.25,maxRetakeSeconds:4,maxRetakeWords:12,emphasisPauseSeconds:0.6,maxWords:30000});

const HOP=0.01;
const round=value=>Math.round(value*1000)/1000;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const norm=text=>String(text).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const FILLER_HIGH=[/^a+h+n+$/,/^h?u+m+$/,/^h?m{2,}$/,/^hm$/,/^u+h+m*$/,/^e+h+$/,/^e{2,}$/,/^e+r+m*$/];
const FILLER_MEDIUM=new Set(['ah','ahh','ham']);
const FILLER_LEXICAL=new Set(['tipo','ne','entao','assim','sabe','enfim','basicamente','like','basically','actually','literally']);
const LEXICAL_PAIRS=[['you','know'],['tipo','assim'],['sabe','como']];
const CORRECTIONS=[['quer','dizer'],['ou','melhor'],['digo'],['desculpa'],['desculpe'],['perdao'],['vou','repetir'],['deixa','eu','repetir'],['i','mean'],['sorry'],['let','me','rephrase'],['let','me','start','again']];
const STOP=new Set(['a','o','e','de','da','do','que','em','um','uma','eu','the','a','an','and','of','to','i','is','it','in']);
const KEYWORDS=new Set(['nunca','sempre','importante','segredo','erro','atencao','cuidado','principal','essencial','nao','jamais','zero','never','always','important','secret','mistake','key','only','first']);
const boundaryNote='Tempos do Whisper são aproximados (desvio típico de 0,2–0,5 s perto de pausas); as margens reduzem, mas não garantem, a preservação de fonemas.';

/** Words with finite times on the source timeline; punctuation-only tokens attach to the previous word. */
export function speechWords(transcript,duration){
  const raw=Array.isArray(transcript?.words)?transcript.words:[],result=[];
  for(const item of raw.slice(0,speechEditDefaults.maxWords)){
    if(!finite(item?.start)||!finite(item?.end)||item.end<=item.start||item.start<0||item.start>=duration||typeof item.text!=='string')continue;
    const text=item.text.trim(),key=norm(text);
    if(!key){if(result.length)result.at(-1).punct+=text;continue;}
    if(result.length&&item.start<result.at(-1).start-0.001)continue;
    result.push({index:result.length,start:round(item.start),end:round(Math.min(item.end,duration)),text,key,punct:text.replace(/^[\p{L}\p{N}'’-]+/u,'')});
  }
  return result;
}

const quiet=(track,at)=>{const frame=Math.min(track.db.length-1,Math.max(0,Math.floor(at/HOP)));return track.db[frame]<track.speechThresholdDb;};
/**
 * Closest frame to `target` inside [lo,hi] (first on the `prefer` side) whose measured energy stays below the speech
 * threshold for `guardBefore` seconds before it and `guardAfter` after it (the kept neighbour's margin, measured rather
 * than trusted from Whisper); null when the voice never drops there.
 */
function snapEdge(track,target,lo,hi,prefer,guardBefore=0,guardAfter=0){
  if(hi<lo)return null;
  const from=Math.max(0,Math.ceil(lo/HOP)),to=Math.min(track.db.length-1,Math.floor(hi/HOP)),back=Math.round(guardBefore/HOP),ahead=Math.round(guardAfter/HOP);let before=null,after=null;
  const calm=frame=>{for(let at=Math.max(0,frame-back);at<=Math.min(track.db.length-1,frame+ahead);at++)if(track.db[at]>=track.speechThresholdDb)return false;return true;};
  for(let frame=from;frame<=to;frame++)if(calm(frame)){const at=Math.min(hi,Math.max(lo,frame*HOP+HOP/2));if(at<=target)before=at;else if(after===null)after=at;}
  return prefer==='before'?before??after:after??before;
}
const voicedSeconds=(track,start,end)=>{let count=0;for(let frame=Math.floor(start/HOP);frame<Math.min(track.db.length,Math.ceil(end/HOP));frame++)if(track.db[frame]>=track.speechThresholdDb)count++;return round(count*HOP);};

/**
 * Removal for words[first..last]: starts at the first removed word, ends just before the next kept word, keeps the
 * margins after the previous kept word and before the next one. With a track both edges snap to measured quiet frames.
 */
export function wordCut(words,first,last,{duration,track=null,options={}}={}){
  const o={...speechEditDefaults,...options},a=words[first],b=words[last],prev=words[first-1],next=words[last+1];
  const startLo=prev?prev.end+o.afterKeptSeconds:0,startHi=Math.min(a.start+0.15,a.end),endLo=Math.max(b.start,b.end-0.15),endHi=next?next.start-o.beforeKeptSeconds:duration;
  const startTarget=Math.max(startLo,a.start),endTarget=next?Math.max(endLo,endHi):Math.min(duration,b.end+o.beforeKeptSeconds);
  let start,end,boundary;
  if(track){
    start=snapEdge(track,startTarget,Math.max(startLo,startTarget-o.snapSeconds),Math.min(startHi,startTarget+o.snapSeconds),'before',prev?o.afterKeptSeconds:0,0);
    end=snapEdge(track,endTarget,Math.max(endLo,endTarget-o.snapSeconds),Math.min(endHi,endTarget+o.snapSeconds),'after',0,next?o.beforeKeptSeconds:0);
    if(start===null||end===null)return {rejected:'unsafeBoundary'};
    if(voicedSeconds(track,start,end)<0.03)return {rejected:'noVoiceEvidence'};
    boundary='voice';
  }else{start=Math.min(startHi,startTarget);end=Math.max(endLo,Math.min(endHi,endTarget));boundary='transcript';}
  if(end-start<smartEditLimits.minSegmentSeconds)return {rejected:'tooShort'};
  return {start:round(start),end:round(end),boundary,...(track?{voicedSeconds:voicedSeconds(track,start,end)}:{})};
}

const gapBefore=(words,index)=>index>0?words[index].start-words[index-1].end:Infinity;
const gapAfter=(words,index)=>index<words.length-1?words[index+1].start-words[index].end:Infinity;
const matches=(words,at,pattern)=>pattern.every((key,offset)=>words[at+offset]?.key===key);
const lower=level=>level==='high'?'medium':'low';

/** Raw word-range findings before boundaries: [{kind,first,last,confidence,reason,repeatedText?}]. */
export function speechFindings(words,options={}){
  const o={...speechEditDefaults,...options},found=[];
  for(let index=0;index<words.length;index++){
    const word=words[index];
    if(FILLER_HIGH.some(pattern=>pattern.test(word.key)))found.push({kind:'filler',first:index,last:index,confidence:'high',reason:`Hesitação “${word.text}” sem conteúdo verbal.`});
    else if(FILLER_MEDIUM.has(word.key))found.push({kind:'filler',first:index,last:index,confidence:'medium',reason:`Interjeição “${word.text}”; pode ser intencional.`});
    else{
      const pair=LEXICAL_PAIRS.find(pattern=>matches(words,index,pattern)),size=pair?pair.length:1,end=index+size-1;
      const isolated=/,/.test(words[index-1]?.punct??'')||/,/.test(words[end].punct)||gapBefore(words,index)>=0.2||gapAfter(words,end)>=0.2;
      if((pair||FILLER_LEXICAL.has(word.key))&&isolated){found.push({kind:'filler',first:index,last:end,confidence:'low',reason:`“${words.slice(index,end+1).map(item=>item.text).join(' ')}” isolada por pausa/vírgula; possível muleta, depende do sentido.`});index=end;continue;}
    }
  }
  for(let index=0;index<words.length-1;index++){
    for(const size of [2,1]){
      if(index+size*2>words.length)continue;
      const first=words.slice(index,index+size).map(item=>item.key),second=words.slice(index+size,index+size*2).map(item=>item.key);
      if(first.join(' ')!==second.join(' ')||words[index+size].start-words[index+size-1].end>1.5)continue;
      const text=words.slice(index,index+size).map(item=>item.text).join(' ');
      found.push({kind:'repetition',first:index,last:index+size-1,confidence:size===1&&KEYWORDS.has(first[0])?'low':'medium',reason:`“${text}” repetido em seguida; mantida a última ocorrência (pode ser ênfase intencional).`,repeatedText:text});index+=size*2-1;break;
    }
  }
  for(let index=0;index<words.length;index++){
    let best=null;
    for(let restart=index+2;restart<=Math.min(words.length-2,index+o.maxRetakeWords);restart++){
      if(words[restart].start-words[index].start>o.maxRetakeSeconds)break;
      let size=0;while(restart+size<words.length&&index+size<restart&&words[index+size].key===words[restart+size].key)size++;
      const content=words.slice(restart,restart+size).filter(item=>!STOP.has(item.key)).length;
      if(size>=3||size===2&&content>=1&&(gapBefore(words,restart)>=0.25||found.some(item=>item.kind==='filler'&&item.last===restart-1))){if((restart>index+size||size>=3)&&(!best||size>best.size))best={restart,size};}
    }
    if(best){const text=words.slice(best.restart,best.restart+best.size).map(item=>item.text).join(' ');found.push({kind:'retake',first:index,last:best.restart-1,confidence:best.size>=3?'medium':'low',reason:`Frase recomeçada: “${text}…” aparece de novo logo depois; sugerido manter a última tomada.`,repeatedText:text});index=best.restart-1;}
  }
  for(let index=1;index<words.length;index++){
    const marker=CORRECTIONS.find(pattern=>matches(words,index,pattern));if(!marker)continue;
    const end=index+marker.length-1;if(end>=words.length-1)continue;
    const pause=gapBefore(words,index)>=0.15||/[,.;]/.test(words[index-1].punct);if(marker.length===1&&!pause)continue;
    let first=index-1;while(first>0&&index-first<6&&gapBefore(words,first)<0.25&&!/[.!?]/.test(words[first-1].punct))first--;
    found.push({kind:'selfCorrection',first,last:end,confidence:'low',reason:`Autocorreção “${words.slice(index,end+1).map(item=>item.text).join(' ')}”: trecho anterior provavelmente substituído pelo seguinte.`});index=end;
  }
  return found;
}

/**
 * Speech candidates on the source timeline, never selected. Without word timings only the legacy sentence-level
 * possible retakes remain (limitation `wordTimingUnavailable`). Ids are derived from kind and start, so the same input
 * always yields the same ids and a review can be replayed or undone deterministically.
 */
export function speechEditCandidates({transcript,duration,track=null,options={}}){
  const limitations=[],legacy=retakeCandidates(transcript?.segments?.length?transcript:null);
  if(!transcript)return {candidates:legacy,limitations:['transcriptUnavailable']};
  const words=speechWords(transcript,duration);
  if(!words.length)return {candidates:legacy,limitations:['wordTimingUnavailable']};
  if(!track)limitations.push('voiceUnavailable');
  const timing=transcript.timing==='words'||!transcript.timing?'words':'estimated',candidates=[],ids=new Set(),rejected={};
  const findings=speechFindings(words,options).sort((x,y)=>words[x.first].start-words[y.first].start||y.last-x.last);
  for(const finding of findings){
    if(candidates.length+legacy.length>=smartEditLimits.maxCandidates){limitations.push('candidatesTruncated');break;}
    const cut=wordCut(words,finding.first,finding.last,{duration,track,options});
    if(cut.rejected){rejected[cut.rejected]=(rejected[cut.rejected]??0)+1;continue;}
    if(candidates.some(item=>item.start<cut.end&&cut.start<item.end&&item.kind===finding.kind))continue;
    let id=`${finding.kind}-${Math.round(cut.start*1000)}`;for(let n=2;ids.has(id);n++)id=`${finding.kind}-${Math.round(cut.start*1000)}-${n}`;ids.add(id);
    const removed=words.slice(finding.first,finding.last+1),confidence=cut.boundary!=='voice'?'low':timing==='words'?finding.confidence:lower(finding.confidence);
    candidates.push(Object.freeze({id,kind:finding.kind,start:cut.start,end:cut.end,label:{filler:'Muleta/hesitação',repetition:'Repetição',retake:'Tomada refeita',selfCorrection:'Autocorreção'}[finding.kind],reason:finding.reason,selected:false,confidence,
      evidence:Object.freeze({text:removed.map(item=>item.text).join(' '),words:Object.freeze(removed.map(({start,end,text})=>Object.freeze({start,end,text}))),...(finding.repeatedText?{repeatedText:finding.repeatedText}:{}),timing,boundary:cut.boundary,...(cut.voicedSeconds!==undefined?{voicedSeconds:cut.voicedSeconds}:{}),source:'transcript',boundaryNote})}));
  }
  if(rejected.unsafeBoundary)limitations.push('unsafeBoundary');
  if(rejected.noVoiceEvidence)limitations.push('noVoiceEvidence');
  return {candidates:[...legacy,...candidates.sort((x,y)=>x.start-y.start)],limitations,rejected};
}

/**
 * Emphasis pauses (editorial INFERENCE from punctuation/numbers/keywords, not measured intonation): a silence cut after
 * “?”, “!”, “…”, “:” or before a number/keyword shrinks so `emphasisPauseSeconds` of the pause stays; if the pause is
 * already that short the cut is dropped. Other candidates pass through untouched.
 */
export function refineSilenceCandidates(candidates,{transcript,silences,duration,options={}}){
  const o={...speechEditDefaults,...options},words=speechWords(transcript,duration),lines=transcript?.segments??[];
  return candidates.flatMap(item=>{
    if(item.kind!=='silence'||item.start<=0.001||item.end>=duration-0.001)return [item];
    const pause=silences.find(range=>range.start<=item.start+0.001&&range.end>=item.end-0.001)??item;
    const before=words.filter(word=>word.end<=pause.start+0.3).at(-1),after=words.find(word=>word.start>=pause.end-0.3);
    const lineBefore=lines.filter(line=>line.end<=pause.start+0.5).at(-1),lineAfter=lines.find(line=>line.start>=pause.end-0.5);
    const tail=(before?before.text+before.punct:lineBefore?.text??'').trim(),head=after?.key??norm(String(lineAfter?.text??'').split(/\s+/)[0]??'');
    const cue=/\?$/.test(tail)?'question':/!$/.test(tail)?'exclamation':/(\.\.\.|…)$/.test(tail)?'ellipsis':/:$/.test(tail)?'colon':/^\d/.test(head)?'number':KEYWORDS.has(head)?'keyword':null;
    if(!cue)return [item];
    const keep=o.emphasisPauseSeconds,length=pause.end-pause.start;
    if(length-keep<smartEditLimits.minSegmentSeconds)return [];
    const start=round(pause.start+keep/2),end=round(pause.end-keep/2);
    return [Object.freeze({...item,start,end,label:`Silêncio ${round(end-start)}s`,reason:`Pausa encurtada mantendo ${keep}s antes do trecho seguinte (inferência editorial: ${cue}).`,emphasis:Object.freeze({cue,source:'inferred',keptSeconds:keep})})];
  });
}

/** Kept segments after removing `selectedIds` from the base plan; same inputs, same output (undo = deselect). */
export function applyCandidateSelection(candidates,selectedIds,duration,{baseSegments}={}){
  const wanted=new Set(selectedIds),removals=candidates.filter(item=>wanted.has(item.id)).map(({start,end})=>({start,end}));
  if(baseSegments)removals.push(...removedSegments(baseSegments,duration));
  return keptSegments(removals,duration);
}

/** Transcript-driven editing: removing word indexes produces kept segments with the same boundary rules as candidates. */
export function segmentsFromWordRemovals(words,removeIndexes,duration,{track=null,baseSegments,options={}}={}){
  const sorted=[...new Set(removeIndexes)].filter(index=>Number.isInteger(index)&&index>=0&&index<words.length).sort((x,y)=>x-y),removals=[],rejected=[];
  for(let at=0;at<sorted.length;){
    let end=at;while(end+1<sorted.length&&sorted[end+1]===sorted[end]+1)end++;
    const cut=wordCut(words,sorted[at],sorted[end],{duration,track,options});
    if(cut.rejected)rejected.push({first:sorted[at],last:sorted[end],reason:cut.rejected});else removals.push({start:cut.start,end:cut.end});
    at=end+1;
  }
  if(baseSegments)removals.push(...removedSegments(baseSegments,duration));
  return {segments:keptSegments(removals,duration),rejected};
}

/**
 * Aligns a range the user picked on the transcript/timeline to word edges: every word at least half inside the range is
 * removed with the same boundary rules as the suggestions. A range with no word inside is accepted only inside a
 * detected silence (or measured quiet frames); otherwise it is rejected instead of guessed.
 */
export function snapRemoval(range,words,{duration,track=null,silences=[],options={}}={}){
  if(!finite(range?.start)||!finite(range?.end)||range.end<=range.start||range.start<0||range.end>duration+0.001)return {rejected:'invalidRange'};
  const inside=words.map((word,index)=>({word,index})).filter(({word})=>Math.min(word.end,range.end)-Math.max(word.start,range.start)>=(word.end-word.start)/2);
  if(!inside.length){
    const inSilence=silences.some(item=>item.start<=range.start+0.001&&item.end>=range.end-0.001);
    const quietTrack=track&&Array.from({length:Math.max(1,Math.round((range.end-range.start)/HOP))},(_,step)=>range.start+step*HOP).every(at=>quiet(track,at));
    if(!inSilence&&!quietTrack)return {rejected:'noWordsOrSilence'};
    return range.end-range.start<smartEditLimits.minSegmentSeconds?{rejected:'tooShort'}:{start:round(range.start),end:round(Math.min(duration,range.end)),boundary:inSilence?'silence':'voice',words:[]};
  }
  const cut=wordCut(words,inside[0].index,inside.at(-1).index,{duration,track,options});
  return cut.rejected?cut:{...cut,words:inside.map(({word})=>word.text)};
}

/** Source -> edited time; null when the instant was cut. */
export function sourceToOutput(seconds,segments){
  for(const item of outputTimeline(segments))if(seconds>=item.start-0.0005&&seconds<=item.end+0.0005)return round(item.outputStart+Math.min(item.end,Math.max(item.start,seconds))-item.start);
  return null;
}
/** Edited -> source time (inverse of sourceToOutput on kept instants). */
export function outputToSource(seconds,segments){
  const map=outputTimeline(segments);
  for(const item of map)if(seconds>=item.outputStart-0.0005&&seconds<=item.outputStart+item.end-item.start+0.0005)return round(item.start+Math.max(0,seconds-item.outputStart));
  return null;
}
/** Words on the edited timeline; a word with less than half of it kept is dropped (it was cut). */
export function remapSpeechWords(words,segments){
  const result=[];
  for(const word of words)for(const item of outputTimeline(segments)){
    const start=Math.max(word.start,item.start),end=Math.min(word.end,item.end);
    if(end-start>=(word.end-word.start)/2){result.push({start:round(item.outputStart+start-item.start),end:round(item.outputStart+end-item.start),text:word.text,sourceStart:word.start,sourceEnd:word.end});break;}
  }
  return result;
}
