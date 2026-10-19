/**
 * Semantic-cut EVIDENCE for the editor (never a decision): on the REAL word timings of the local transcription (source
 * timeline, approximate), this finds places where the speaker probably restarted, repeated or corrected themself:
 *  - cue: an explicit restart marker ("errei", "vou falar de novo", "let me say that again"...), with the aborted take before it;
 *  - repeat: a phrase started again shortly after (the later take is usually the complete one, but the editor decides by sense);
 *  - false-start: a 1-3 word fragment, a pause and the same beginning again;
 *  - correction: a number said and corrected ("são 30... não, 13"); a correction that is withdrawn ("não, são 30 mesmo") is
 *    reported as such; a contrastive denial ("não são 30, são 13") is NOT an error and is only flagged as a negated number,
 *    so the motion never shows it as a fact without context.
 * Contiguous repetition without a pause ("muito, muito importante") is reported as probable emphasis with a keep suggestion.
 * Nothing here cuts, estimates missing words or decides which take stays; the editor (Claude) decides and justifies, and the
 * host only checks that its declared decisions match the cuts it really wrote.
 */
export const RETAKE_DETECTOR_VERSION=1;
export const RETAKE_LIMITS=Object.freeze({maxCandidates:60,maxDecisions:80,maxReason:300,windowSeconds:12});
const norm=value=>String(value??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9%]+/g,'');
const round=value=>Math.round(value*100)/100;
const NUMBER_WORDS={zero:0,um:1,uma:1,dois:2,duas:2,tres:3,quatro:4,cinco:5,seis:6,sete:7,oito:8,nove:9,dez:10,onze:11,doze:12,treze:13,quatorze:14,catorze:14,quinze:15,dezesseis:16,dezessete:17,dezoito:18,dezenove:19,vinte:20,trinta:30,quarenta:40,cinquenta:50,sessenta:60,setenta:70,oitenta:80,noventa:90,cem:100,mil:1000,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,twenty:20,thirty:30,forty:40,fifty:50,hundred:100,thousand:1000};
const numberOf=token=>/^\d+(?:[.,]\d+)?%?$/.test(token)?Number(token.replace('%','').replace(',','.')):Object.hasOwn(NUMBER_WORDS,token)?NUMBER_WORDS[token]:null;
const STOP=new Set(['e','a','o','de','da','do','que','um','uma','eu','é','the','a','an','and','to','of','i','so','tipo','ne','entao','assim','ai','na','no','em','pra','para','com','is','it','uh','um','eh','ah','hum','hmm']);
const FILLERS=new Set(['eh','ah','hum','hmm','uh','um','er','erm','tipo','ne']);
// Cue phrases, as normalized token sequences. Kept narrow: "de novo" alone is ordinary speech.
const CUES=[['errei'],['errei','de','novo'],['vou','falar','de','novo'],['vou','falar','denovo'],['vou','repetir'],['deixa','eu','repetir'],['deixa','eu','falar','de','novo'],['deixa','eu','comecar','de','novo'],['vou','comecar','de','novo'],['comecando','de','novo'],['vou','recomecar'],['recomecando'],['corta','isso'],['corta','essa'],['pera','vou','de','novo'],['desculpa','vou','de','novo'],['let','me','say','that','again'],['let','me','start','over'],['let','me','try','again'],['start','over'],['take','two'],['sorry','let','me','redo']];
const CORRECTION=[['nao'],['quer','dizer'],['ou','melhor'],['digo'],['perdao'],['corrigindo'],['i','mean'],['no'],['sorry']];
const matchAt=(tokens,index,sequence)=>sequence.every((item,offset)=>tokens[index+offset]===item);

/** Normalized, ordered, finite words: {i,t,raw,start,end}. Empty tokens (pure punctuation) are dropped. */
export function retakeWords(words){
 return (Array.isArray(words)?words:[]).filter(item=>Number.isFinite(item?.start)&&Number.isFinite(item?.end)&&item.end>=item.start&&typeof item.text==='string').map(item=>({t:norm(item.text),raw:item.text.trim(),start:item.start,end:Math.max(item.end,item.start)})).filter(item=>item.t).sort((a,b)=>a.start-b.start).map((item,i)=>({...item,i}));
}
const textOf=(list,from,to)=>list.slice(Math.max(0,from),Math.max(0,to)).map(item=>item.raw).join(' ').slice(0,240);
const gapBefore=(list,j)=>j>0?list[j].start-list[j-1].end:Infinity;
/** Removal range that never enters a kept word: from just before the first removed word to just before the first kept word. */
const removal=(list,from,keepIndex,margin=0.06)=>{
 const first=list[from],keep=list[keepIndex],previous=list[from-1],lastRemoved=list[keepIndex-1];
 if(previous&&previous.end>first.start||lastRemoved&&lastRemoved.end>keep.start)return null;
 const start=Math.max(previous?previous.end+0.02:0,first.start-margin),end=Math.min(keep.start,Math.max(lastRemoved?lastRemoved.end+0.02:start,keep.start-margin));
 return end>start+0.05?{start:round(start),end:round(end)}:null;
};
/** End of the take that starts at j: the next long pause (>=0.6s) or 14 words, whatever comes first. */
const takeEnd=(list,j)=>{let k=j;while(k+1<list.length&&k-j<14&&gapBefore(list,k+1)<0.6)k++;return k+1;};

/**
 * Candidates on the source timeline. Each: {id,kind,confidence:'high'|'medium'|'low',suggestion:'cut'|'keep'|'review',
 * remove:{start,end}|null, evidence:{removed,kept,cue?,numbers?}, reason}. Times are approximate (whisper tokens).
 */
export function retakeCandidates(words,{windowSeconds=RETAKE_LIMITS.windowSeconds,max=RETAKE_LIMITS.maxCandidates}={}){
 const list=retakeWords(words),tokens=list.map(item=>item.t),found=[];
 const add=item=>found.push(item);
 // 1) explicit cues: the aborted take is the phrase that is started again right after the cue (else the sentence before it).
 for(let c=0;c<list.length;c++){
  const cueAt=index=>CUES.filter(sequence=>matchAt(tokens,index,sequence)).sort((a,b)=>b.length-a.length)[0];
  const cue=cueAt(c);if(!cue)continue;
  // Chained markers ("errei, vou falar de novo") and hesitations between them belong to the same restart.
  let after=c+cue.length;for(;;){if(FILLERS.has(tokens[after])){after++;continue;}const next=after<list.length?cueAt(after):null;if(!next)break;after+=next.length;}
  if(after>=list.length)continue;
  let from=-1;
  for(let n=Math.min(4,list.length-after);n>=1&&from<0;n--){const head=tokens.slice(after,after+n);if(n===1&&(head[0].length<4||STOP.has(head[0])))continue;
   for(let p=c-n;p>=0&&list[c].start-list[p].start<=windowSeconds;p--)if(head.every((item,offset)=>tokens[p+offset]===item)){from=p;break;}}
  let confidence='high';
  if(from<0){confidence='medium';from=c;for(let p=c-1;p>=0&&list[c].start-list[p].start<=windowSeconds;p--){from=p;if(gapBefore(list,p)>=0.6)break;}}
  const range=removal(list,from,after);if(!range)continue;
  add({kind:'cue',confidence,suggestion:'cut',remove:range,from,keep:after,evidence:{removed:textOf(list,from,after),kept:textOf(list,after,takeEnd(list,after)),cue:textOf(list,c,after)},reason:`marcador de recomeço “${textOf(list,c,after)}”${confidence==='high'?' e a frase recomeça logo depois':''}`});
  c=after-1;
 }
 // 2) numbers corrected in the same breath; a denial before the number is contrast, not an error.
 for(let x=0;x<list.length;x++){
  const first=numberOf(tokens[x]);if(first===null)continue;
  const denied=['nao','not','isnt','arent'].includes(tokens[x-1])||['nao','not'].includes(tokens[x-2])&&['sao','e','foi','eram','tem','is','are','was'].includes(tokens[x-1]);
  for(let m=x+1;m<=x+3&&m<list.length;m++){
   const marker=CORRECTION.find(sequence=>matchAt(tokens,m,sequence));if(!marker)continue;
   let y=-1;for(let k=m+marker.length;k<=m+marker.length+3&&k<list.length;k++)if(numberOf(tokens[k])!==null){y=k;break;}
   if(y<0)break;
   const second=numberOf(tokens[y]);
   if(denied){add({kind:'negated-number',confidence:'high',suggestion:'keep',remove:null,from:x,keep:y,evidence:{removed:'',kept:textOf(list,Math.max(0,x-2),y+1),numbers:[first,second]},reason:`contraste intencional: ${first} é negado e ${second} afirmado; não é erro de fala. Não mostre ${first} como fato.`});break;}
   if(second===first){add({kind:'correction-withdrawn',confidence:'medium',suggestion:'keep',remove:null,from:x,keep:y,evidence:{removed:'',kept:textOf(list,Math.max(0,x-3),y+1),numbers:[first]},reason:`correção retirada: ${first} é confirmado depois de “${marker.join(' ')}”; mantenha a fala ou corte só a hesitação, pelo sentido.`});break;}
   let from=x;
   // Keep the corrected phrase from its own restart when the speaker repeats the lead-in ("são 30, não, são 13").
   let keep=y;for(let k=y-1;k>m+marker.length-1;k--)if(tokens[k]===tokens[x-1])keep=k;
   // Only the wrong number (and its repeated lead-in) goes: "isso custa 30, não, 13" keeps "isso custa 13".
   from=keep!==y?x-1:x;
   const range=removal(list,from,keep);if(!range)break;
   add({kind:'correction',confidence:'medium',suggestion:'cut',remove:range,from,keep,evidence:{removed:textOf(list,from,keep),kept:textOf(list,keep,takeEnd(list,keep)),numbers:[first,second]},reason:`número corrigido: ${first} → ${second} depois de “${marker.join(' ')}”`});
   break;
  }
  if(denied&&!found.some(item=>item.from===x)){const second=list.slice(x+1,x+5).map(item=>numberOf(item.t)).find(value=>value!==null);if(second!==undefined)add({kind:'negated-number',confidence:'high',suggestion:'keep',remove:null,from:x,keep:x,evidence:{removed:'',kept:textOf(list,Math.max(0,x-2),Math.min(list.length,x+5)),numbers:[first,second]},reason:`${first} aparece negado (contraste com ${second}); não é erro de fala. Não mostre ${first} como fato.`});}
 }
 // 3) repeated starts (restart/false start) and contiguous emphasis.
 const covered=index=>found.some(item=>item.remove&&index>=item.from&&index<item.keep);
 for(let i=0;i<list.length;i++){
  if(covered(i)||FILLERS.has(tokens[i]))continue;
  let hit=null;
  for(let n=Math.min(5,list.length-i);n>=1&&!hit;n--){
   const head=tokens.slice(i,i+n);if(n===1&&(head[0].length<3||STOP.has(head[0])||numberOf(head[0])!==null))continue;if(n>1&&head.every(item=>STOP.has(item)))continue;
   for(let j=i+n;j<=i+n+6&&j+n<=list.length;j++){
    if(list[j].start-list[i].start>windowSeconds)break;
    if(!head.every((item,offset)=>tokens[j+offset]===item))continue;
    const between=tokens.slice(i+n,j),onlyFillers=between.every(item=>FILLERS.has(item)),pause=gapBefore(list,j);
    if(n===1&&!(j===i+1&&pause<0.35)&&!(pause>=0.3&&j-i<=3))continue;
    hit={n,j,between,onlyFillers,pause};break;
   }
  }
  if(!hit)continue;
  const {n,j,onlyFillers,pause}=hit,contiguous=j===i+n;
  if(contiguous&&pause<0.35&&n<=2){add({kind:'emphasis',confidence:'low',suggestion:'keep',remove:null,from:i,keep:j,evidence:{removed:'',kept:textOf(list,i,j+n)},reason:'repetição colada, sem pausa: provável ênfase intencional'});i=j+n-1;continue;}
  const firstLength=j-i,secondEnd=takeEnd(list,j),completes=secondEnd-j>firstLength;
  const range=removal(list,i,j);if(!range)continue;
  const kind=n<=3&&firstLength<=3&&pause>=0.3?'false-start':'repeat';
  // One repeated word after a pause can be emphasis ("nunca... nunca desista") as much as a false start: the editor decides.
  const single=n===1&&contiguous,confidence=single?'low':pause>=0.3&&completes?'high':!completes||pause<0.2?'low':'medium';
  add({kind,confidence,suggestion:confidence==='low'?'review':'cut',remove:range,from:i,keep:j,evidence:{removed:textOf(list,i,j),kept:textOf(list,j,secondEnd)},reason:`${kind==='false-start'?'falso começo':'frase recomeçada'}${onlyFillers&&!contiguous?' (só hesitação entre as tomadas)':''}; ${completes?'a segunda tomada vai mais longe':'a segunda tomada não é mais completa: decida pelo sentido'}${single?'; uma palavra repetida após pausa pode ser ênfase intencional':''}`});
  i=j-1;
 }
 return found.sort((a,b)=>(a.remove?.start??list[a.from].start)-(b.remove?.start??list[b.from].start)).slice(0,max).map((item,index)=>({id:`rt-${index+1}`,kind:item.kind,confidence:item.confidence,suggestion:item.suggestion,remove:item.remove,evidence:item.evidence,reason:item.reason,at:round(list[item.from].start)}));
}

/** Kept-segment overlap of [start,end] in seconds. */
const keptOverlap=(segments,start,end)=>segments.reduce((sum,item)=>sum+Math.max(0,Math.min(end,item.end)-Math.max(start,item.start)),0);
/**
 * Checks the editor's declared cut decisions against the cuts it really wrote, plus boundaries that fall in the middle of a
 * word. Errors only for false statements (a "cut" that the segments keep, an unknown candidate, malformed data); word
 * boundaries are approximate, so a boundary inside a word is a WARNING to check on a preview, never a veto.
 */
export function cutDecisionReport(decisions,{segments=[],words=[],candidates=[]}={}){
 const errors=[],warnings=[],accepted=[];
 if(decisions!==undefined&&!Array.isArray(decisions))return {errors:['cutDecisions must be an array.'],warnings,decisions:[]};
 const ids=new Set(candidates.map(item=>item.id));
 for(const [index,raw] of (decisions??[]).slice(0,RETAKE_LIMITS.maxDecisions).entries()){
  const at=`cutDecisions[${index}]`;
  if(!raw||typeof raw!=='object'||Array.isArray(raw)){errors.push(`${at}: object expected.`);continue;}
  const extra=Object.keys(raw).filter(key=>!['candidateId','start','end','decision','reason'].includes(key));if(extra.length){errors.push(`${at}: unknown field(s) ${extra.join(', ')}.`);continue;}
  const {candidateId,start,end,decision,reason}=raw;
  if(candidateId!==undefined&&(typeof candidateId!=='string'||!ids.has(candidateId))){errors.push(`${at}: candidateId ${String(candidateId).slice(0,20)} is not a candidate of this source.`);continue;}
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start){errors.push(`${at}: use 0 <= start < end (source seconds).`);continue;}
  const candidate=candidates.find(item=>item.id===candidateId),evidenceRange=candidate?.remove;
  if(candidate&&(evidenceRange?end<=evidenceRange.start||start>=evidenceRange.end:candidate.at<start-0.1||candidate.at>end+0.1)){errors.push(`${at}: the decision range does not overlap this candidate's real evidence.`);continue;}
  if(!['cut','keep','review'].includes(decision)){errors.push(`${at}: decision must be cut, keep or review.`);continue;}
  if(typeof reason!=='string'||!reason.trim()||reason.length>RETAKE_LIMITS.maxReason){errors.push(`${at}: reason (1-${RETAKE_LIMITS.maxReason} chars) explains the decision by meaning.`);continue;}
  const kept=keptOverlap(segments,start,end),length=end-start;
  if(decision==='cut'&&kept>Math.min(0.08,length*0.2)){errors.push(`${at}: declared as cut, but the segments keep ${kept.toFixed(2)}s of ${start.toFixed(2)}-${end.toFixed(2)}s. Remove that range from segments or change the decision.`);continue;}
  if(decision==='keep'&&length-kept>Math.min(0.08,length*0.2)){errors.push(`${at}: declared as keep, but the segments cut ${(length-kept).toFixed(2)}s of ${start.toFixed(2)}-${end.toFixed(2)}s. Preserve this range or change the decision and explain why.`);continue;}
  accepted.push({...(candidateId?{candidateId,confidence:candidate.confidence}:{}),start:round(start),end:round(end),decision,reason:reason.trim().replace(/\s+/g,' ').slice(0,RETAKE_LIMITS.maxReason)});
 }
 if((decisions?.length??0)>RETAKE_LIMITS.maxDecisions)warnings.push(`Only the first ${RETAKE_LIMITS.maxDecisions} cut decisions are kept.`);
 const list=retakeWords(words),total=segments.at(-1)?.end;
 for(const segment of segments)for(const boundary of [segment.start,segment.end]){
  if(boundary<=0.01||total!==undefined&&boundary>=total-0.01)continue;
  const word=list.find(item=>item.start<boundary&&boundary<item.end&&item.end-item.start>=0.12);
  if(word){const position=(boundary-word.start)/(word.end-word.start);if(position>0.25&&position<0.75)warnings.push(`Cut at ${boundary.toFixed(2)}s falls inside the word “${word.raw}” (${word.start.toFixed(2)}-${word.end.toFixed(2)}s; word times are approximate): check it on a preview or give it margin.`);}
 }
 return {errors,warnings:warnings.slice(0,12),decisions:accepted};
}
/** Source-timeline speech that SURVIVES the cuts (words whose middle is kept; else sentences mostly kept). */
export function retainedSpeech({segments=[],words=[],sentences=[]}={}){
 const kept=time=>segments.some(item=>time>=item.start&&time<item.end);
 const list=(Array.isArray(words)?words:[]).filter(item=>Number.isFinite(item?.start)&&Number.isFinite(item?.end)&&typeof item.text==='string');
 if(list.length)return list.filter(item=>kept((item.start+item.end)/2)).map(item=>item.text.trim()).join(' ');
 return (Array.isArray(sentences)?sentences:[]).filter(item=>keptOverlap(segments,item.start,item.end)>=(item.end-item.start)*0.5).map(item=>item.text).join(' ');
}
