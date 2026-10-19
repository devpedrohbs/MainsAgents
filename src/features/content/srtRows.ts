// Linhas do editor de SRT (puro, sem I/O, testável no Node). O servidor (editorial-srt.mjs) revalida tudo.
import {newRowKey,parseClock} from '../production/captionReview.ts';

export type SrtTiming='words'|'aligned'|'estimated'|'imported'|'manual';
/** `unit` = frase de origem; redividir junta os blocos da mesma unidade (preservando correções e limites). */
export interface SrtBlock {start:number;end:number;text:string;timing:SrtTiming;unit?:number}
export interface SrtRow {key:string;start:string;end:string;text:string;timing:SrtTiming;unit?:number}
export type SrtRowError='start'|'end'|'order'|'overlap'|'text';

/** 75.25 → "1:15.250" (milissegundos, a precisão do SRT). */
export function formatClock(seconds:number):string{
 if(!Number.isFinite(seconds)||seconds<0)return '';
 const total=Math.round(seconds*1000),m=Math.floor(total/60000),s=Math.floor(total/1000)%60;
 return `${m}:${String(s).padStart(2,'0')}.${String(total%1000).padStart(3,'0')}`;
}
const unitOf=(value:{unit?:number})=>Number.isSafeInteger(value.unit)?{unit:value.unit}:{};
export const rowsFromBlocks=(blocks:SrtBlock[]):SrtRow[]=>blocks.map(block=>({key:newRowKey(),start:formatClock(block.start),end:formatClock(block.end),text:block.text,timing:block.timing,...unitOf(block)}));
export const blocksFromRows=(rows:SrtRow[]):SrtBlock[]=>rows.map(row=>({start:parseClock(row.start),end:parseClock(row.end),text:row.text.replace(/\r\n?/g,'\n').split('\n').map(line=>line.replace(/[ \t]+/g,' ').trim()).filter(Boolean).join('\n'),timing:row.timing,...unitOf(row)}));
/** Mesmas regras do servidor: tempos legíveis, fim > início, sem sobreposição, texto não vazio. Sem limite de caracteres. */
export function srtRowErrors(rows:SrtRow[]):Record<string,SrtRowError[]>{
 const result:Record<string,SrtRowError[]>={};let previous=0;
 blocksFromRows(rows).forEach((block,index)=>{
  const errors:SrtRowError[]=[];
  if(!Number.isFinite(block.start)||block.start<0)errors.push('start');
  if(!Number.isFinite(block.end))errors.push('end');
  if(!errors.length){if(Math.round(block.end*1000)<=Math.round(block.start*1000))errors.push('order');if(Math.round(block.start*1000)<Math.round(previous*1000))errors.push('overlap');previous=block.end;}
  if(!block.text)errors.push('text');
  if(errors.length)result[rows[index].key]=errors;
 });
 return result;
}
export const sameBlocks=(rows:SrtRow[],blocks:SrtBlock[])=>{const mine=blocksFromRows(rows);return mine.length===blocks.length&&mine.every((block,index)=>Math.round(block.start*1000)===Math.round(blocks[index].start*1000)&&Math.round(block.end*1000)===Math.round(blocks[index].end*1000)&&block.text===blocks[index].text);};
/** Linha cujo tempo mudou deixa de ser "estimada/alinhada": passa a ser do usuário. */
export const touchTiming=(row:SrtRow,change:Partial<SrtRow>):SrtRow=>({...row,...change,...(change.start!==undefined||change.end!==undefined?{timing:'manual' as const}:{})});
/**
 * Divide uma linha em duas pelo meio das palavras (as duas metades sempre têm texto) e do tempo: o corte fica em ms
 * inteiros dentro de [início+1 ms, fim−1 ms]. Uma palavra só, ou menos de 2 ms, não se divide.
 */
export function splitRow(row:SrtRow):[SrtRow,SrtRow]|null{
 const words=row.text.split(/\s+/).filter(Boolean),start=parseClock(row.start),end=parseClock(row.end);
 if(words.length<2||!Number.isFinite(start)||!Number.isFinite(end))return null;
 const startMs=Math.round(start*1000),endMs=Math.round(end*1000);
 if(endMs-startMs<2)return null;
 const half=Math.ceil(words.length/2),left=words.slice(0,half).join(' '),right=words.slice(half).join(' ');
 const share=[...left].length/Math.max(1,[...left].length+[...right].length);
 const middle=Math.min(endMs-1,Math.max(startMs+1,Math.round(startMs+(endMs-startMs)*share)));
 return [{...row,end:formatClock(middle/1000),text:left,timing:'estimated'},{...row,key:newRowKey(),start:formatClock(middle/1000),end:row.end,text:right,timing:'estimated'}];
}
export function joinRows(a:SrtRow,b:SrtRow):SrtRow{return {...a,end:b.end,text:`${a.text} ${b.text}`.trim(),timing:a.timing===b.timing?a.timing:'manual'};}

export function srtRowErrorText(error:SrtRowError,pt:boolean){
 const say=(a:string,b:string)=>pt?a:b;
 return {start:say('Início ilegível (use 1:15.250).','Unreadable start (use 1:15.250).'),end:say('Fim ilegível.','Unreadable end.'),order:say('O fim precisa vir depois do início.','End must come after start.'),overlap:say('Começa antes do fim do bloco anterior.','Starts before the previous block ends.'),text:say('Texto vazio: escreva ou remova o bloco.','Empty text: write it or remove the block.')}[error];
}
export function srtTimingLabel(timing:SrtTiming,pt:boolean){
 const say=(a:string,b:string)=>pt?a:b;
 return {words:say('tempo do Whisper','Whisper timing'),aligned:say('alinhado ao áudio','aligned to audio'),estimated:say('tempo estimado','estimated time'),imported:say('tempo do SRT','SRT timing'),manual:say('ajustado por você','set by you')}[timing];
}
/** Avisos honestos sobre de onde vieram os tempos. O Whisper (DTW) é aproximado e sem erro máximo garantido. */
export function srtWarningText(warning:string,pt:boolean){
 const say=(a:string,b:string)=>pt?a:b;
 return ({
  'estimated-timing':say('Tempos ESTIMADOS: o SRT só tinha o tempo de cada frase, então cada bloco curto recebeu uma parte proporcional ao tamanho do texto, não ao áudio. Confira ouvindo e ajuste, ou sincronize com o áudio de um vídeo.','ESTIMATED times: the SRT only had per-sentence times, so each short block got a share proportional to its text length, not the audio. Check by listening and adjust, or sync with a video’s audio.'),
  'aligned-whisper':say('Tempos alinhados às palavras reconhecidas pelo Whisper local no vídeo escolhido. São aproximados, sem erro máximo garantido: confira ouvindo. O texto continua o seu.','Times aligned to the words local Whisper recognized in the chosen video. They are approximate, with no guaranteed maximum error: check by listening. The text is still yours.'),
  'alignment-low':say('O áudio do vídeo escolhido não bateu com o texto do SRT (vídeo diferente ou fala muito editada). Mantive os tempos estimados.','The chosen video’s audio did not match the SRT text (different video or heavily edited speech). Estimated times were kept.'),
  'alignment-removed':say('A sincronização com o vídeo foi desfeita: os tempos que vinham do áudio agora contam como estimados.','The video sync was removed: times that came from the audio now count as estimated.'),
  'whisper-approximate':say('Texto e tempos reconhecidos pelo Whisper local: aproximados. Corrija palavras erradas antes de usar.','Text and times recognized by local Whisper: approximate. Fix wrong words before using.'),
  'word-timing':say('Cada bloco usa o tempo aproximado das próprias palavras reconhecidas (sem erro máximo garantido). Palavras que você corrigiu e não batem com o áudio ficam com tempo estimado.','Each block uses the approximate timing of its own recognized words (no guaranteed maximum error). Words you corrected that do not match the audio get estimated times.'),
  'no-word-timing':say('Sem tempo por palavra nesta transcrição: os blocos dentro de cada frase têm tempos estimados.','No per-word timing in this transcript: blocks within each sentence have estimated times.'),
  'cue-too-short':say('Alguma frase era curta demais para dividir; ela ficou num bloco só (com mais palavras que o limite).','Some sentence was too short to split; it stayed in one block (with more words than the limit).'),
  'formatting-removed':say('Marcações de formatação do SRT (<i>, <b>, <font>) foram retiradas; as palavras não mudaram.','SRT formatting tags (<i>, <b>, <font>) were removed; words did not change.'),
  'empty-cue-skipped':say('Blocos sem texto no SRT foram ignorados.','Empty SRT blocks were skipped.'),
  'no-speech':say('Nenhuma fala reconhecida.','No speech recognized.'),
 } as Record<string,string>)[warning]??warning;
}
