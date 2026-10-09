import type {EditRange,MotionCuePlan,MotionPlan} from './model';

/** One spoken word on the RAW recording timeline. `estimated` when the transcript only had sentence timing. */
export interface ReviewWord extends EditRange {index:number;text:string;estimated:boolean}

const round=(value:number)=>Math.round(value*1000)/1000;

/** Words of the review transcript: real word timings when whisper produced them, else each sentence split evenly (labelled estimated). */
export function reviewWords(transcript:{segments:Array<EditRange&{text:string}>;words?:Array<EditRange&{text:string}>}|null|undefined):ReviewWord[]{
  if(!transcript)return [];
  if(transcript.words?.length)return transcript.words.filter(word=>word.text.trim()).map((word,index)=>({start:word.start,end:word.end,text:word.text.trim(),estimated:false,index}));
  const words:ReviewWord[]=[];
  for(const line of transcript.segments){
    const parts=line.text.trim().split(/\s+/).filter(Boolean),total=parts.reduce((sum,part)=>sum+part.length,0)||1;let cursor=line.start;
    for(const part of parts){const size=(line.end-line.start)*part.length/total;words.push({start:round(cursor),end:round(cursor+size),text:part,estimated:true,index:words.length});cursor+=size;}
  }
  return words;
}

/** Raw time -> edited time, or null when that instant is cut out. */
export function outputTimeOf(raw:number,segments:readonly EditRange[]):number|null{
  let cursor=0;for(const item of segments){if(raw>=item.start&&raw<item.end)return round(cursor+raw-item.start);cursor+=item.end-item.start;}return null;
}
/** Edited time -> raw time (end of the edit maps to the end of the last kept segment). */
export function rawTimeOf(output:number,segments:readonly EditRange[]):number{
  let cursor=0;for(const item of segments){const size=item.end-item.start;if(output<cursor+size)return round(item.start+Math.max(0,output-cursor));cursor+=size;}return segments.at(-1)?.end??0;
}
/** Share of a word kept by the current cut (0 = removed, 1 = fully kept). */
export function keptShare(word:EditRange,segments:readonly EditRange[]):number{
  const size=word.end-word.start;if(size<=0)return 1;
  return segments.reduce((sum,item)=>sum+Math.max(0,Math.min(item.end,word.end)-Math.max(item.start,word.start)),0)/size;
}

/** Selected words as a raw interval plus their literal text (never rewritten). */
export function selectionOf(words:readonly ReviewWord[],from:number,to:number){
  const [a,b]=from<=to?[from,to]:[to,from],picked=words.slice(a,b+1);
  if(!picked.length)return null;
  return {start:picked[0].start,end:picked.at(-1)!.end,text:picked.map(word=>word.text).join(' '),first:a,last:b,estimated:picked.some(word=>word.estimated)};
}

/**
 * A removal for the selected words that cuts between words, never inside one: it extends into the pause before the
 * first word and after the last one (half the gap, at most 0.15 s), so the remaining speech joins on natural silence.
 */
export function snapRemovalToWords(words:readonly ReviewWord[],first:number,last:number,duration:number):EditRange{
  const before=words[first-1],after=words[last+1],a=words[first],b=words[last];
  const start=before?Math.max(before.end,a.start-Math.min(0.15,(a.start-before.end)/2)):Math.max(0,a.start-0.15);
  const end=after?Math.min(after.start,b.end+Math.min(0.15,(after.start-b.end)/2)):Math.min(duration,b.end+0.15);
  return {start:round(Math.max(0,start)),end:round(Math.min(duration,Math.max(end,start+0.05)))};
}

/** User-chosen motion moment anchored on the recording. Its origin is the user's choice, shown as such in the review. */
export function userCue(kind:'punchIn'|'kineticText',range:EditRange,text:string|undefined,id:string):MotionCuePlan{
  const start=round(range.start),end=round(Math.min(range.start+8,Math.max(range.end,range.start+0.6)));
  return {id,kind,sourceStart:start,sourceEnd:end,start:0,end:0,...(kind==='kineticText'?{text:[...(text??'')].slice(0,60).join('').trim()}:{}),layout:'camera-full',strength:0.7,...(kind==='punchIn'?{scale:1.15}:{}),
    source:'user',timing:'words',reason:kind==='punchIn'?'Aproximação escolhida por você na transcrição':'Destaque escolhido por você na transcrição',signals:[{kind:'user',source:'user'}]} as unknown as MotionCuePlan;
}
/** Empty motion plan (automatic motion off) that can still carry user cues or a framing focus. */
export const emptyMotion=():MotionPlan=>({version:1,intensity:'off',analysis:{wordTiming:'words',voice:'unavailable',limitations:[],measuredCandidates:0,inferredCandidates:0},cues:[]});
/** Motion plan that can carry user cues even when the automatic motion is off or missing. */
export function withUserCue(motion:MotionPlan|undefined,cue:MotionCuePlan):MotionPlan{
  const base=motion??emptyMotion();
  return {...base,cues:[...base.cues,cue]};
}

/**
 * Focus point from a click on the RAW video element, in SOURCE frame coordinates (0..1): undoes the letterboxing of
 * the <video> element. The plan keeps source coordinates; the engine converts them for the 9:16 crop and composition.
 * Returns null for a click outside the picture.
 */
export function focusFromRawClick(box:{left:number;top:number;width:number;height:number},video:{width:number;height:number},click:{x:number;y:number}):{x:number;y:number}|null{
  if(!video.width||!video.height||!box.width||!box.height)return null;
  const scale=Math.min(box.width/video.width,box.height/video.height),shownW=video.width*scale,shownH=video.height*scale;
  const x=(click.x-box.left-(box.width-shownW)/2)/shownW,y=(click.y-box.top-(box.height-shownH)/2)/shownH;
  if(x<0||x>1||y<0||y>1)return null;
  return {x:Math.round(x*10000)/10000,y:Math.round(y*10000)/10000};
}

/** Bounded undo history of review drafts (plain JSON snapshots). */
export function pushHistory<T>(history:readonly T[],snapshot:T,limit=50):T[]{return [...history,structuredClone(snapshot)].slice(-limit);}
