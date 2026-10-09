// B05 — speech caption editor model. Pure helpers, no I/O. The server (production-captions.mjs + editorial-captions.mjs)
// is the authority: these checks only give inline feedback before a save; the same rules are enforced again there.
import type {CaptionVersion} from '../../../production-captions.mjs';

export const CAPTION_MAX_TEXT=160,CAPTION_MAX_LINES=2,CAPTION_MIN_SECONDS=0.2,CAPTION_MAX_SECONDS=12;
export interface CaptionRow {key:string;start:string;end:string;text:string}
export type CaptionRowError='start'|'end'|'order'|'overlap'|'outside'|'short'|'long'|'text'|'chars'|'lines'|'length';

const pad=(value:number,size=2)=>String(value).padStart(size,'0');
/** 75.25 → "1:15.25" (minutes:seconds.centiseconds), the format the editor shows and accepts back. */
export function formatClock(seconds:number):string{
 if(!Number.isFinite(seconds)||seconds<0)return '';
 const cs=Math.round(seconds*100),m=Math.floor(cs/6000),s=Math.floor(cs/100)%60;
 return `${m}:${pad(s)}.${pad(cs%100)}`;
}
/** Accepts "75.2", "1:15.25", "1:15,25" and SRT style "00:01:15,250". NaN when unreadable. */
export function parseClock(text:string):number{
 const value=text.trim().replace(',','.');
 if(!value)return NaN;
 if(/^\d+(\.\d+)?$/.test(value))return Math.round(Number(value)*1000)/1000;
 const match=/^(?:(\d+):)?(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)$/.exec(value);
 if(!match)return NaN;
 const seconds=Number(match[1]??0)*3600+Number(match[2])*60+Number(match[3]);
 return Number(match[3])>=60?NaN:Math.round(seconds*1000)/1000;
}
let serial=0;
export const newRowKey=()=>`row-${Date.now().toString(36)}-${(serial++).toString(36)}`;
export const rowsFromSegments=(segments:CaptionVersion['segments'])=>segments.map(item=>({key:newRowKey(),start:formatClock(item.start),end:formatClock(item.end),text:item.text}));
export function rowsToSegments(rows:CaptionRow[]){return rows.map(row=>({start:parseClock(row.start),end:parseClock(row.end),text:row.text.replace(/\r\n?/g,'\n').split('\n').map(line=>line.replace(/\s+/g,' ').trim()).filter(Boolean).join('\n')}));}

/** Same rules as validateCaptionSegments on the server, per row, so the user sees where to fix. */
export function captionRowErrors(rows:CaptionRow[],durationSeconds:number):Record<string,CaptionRowError[]>{
 const result:Record<string,CaptionRowError[]>={},segments=rowsToSegments(rows);let previousEnd=0;
 segments.forEach((item,index)=>{
  const errors:CaptionRowError[]=[];
  if(!Number.isFinite(item.start)||item.start<0)errors.push('start');
  if(!Number.isFinite(item.end))errors.push('end');
  if(!errors.length){
   if(item.end<=item.start)errors.push('order');
   else{if(item.end-item.start<CAPTION_MIN_SECONDS)errors.push('short');if(item.end-item.start>CAPTION_MAX_SECONDS)errors.push('long');}
   if(item.start<previousEnd-0.001)errors.push('overlap');
   if(durationSeconds>0&&item.end>durationSeconds+0.05)errors.push('outside');
   previousEnd=item.end;
  }
  if(!item.text)errors.push('text');
  else{if(/[{}\\]/.test(item.text))errors.push('chars');if(item.text.split('\n').length>CAPTION_MAX_LINES)errors.push('lines');if([...item.text].length>CAPTION_MAX_TEXT)errors.push('length');}
  if(errors.length)result[rows[index].key]=errors;
 });
 return result;
}
export const sameRows=(rows:CaptionRow[],segments:CaptionVersion['segments'])=>{const mine=rowsToSegments(rows);return mine.length===segments.length&&mine.every((item,index)=>Math.abs(item.start-segments[index].start)<0.0015&&Math.abs(item.end-segments[index].end)<0.0015&&item.text===segments[index].text);};
/** Row whose interval contains `time` (for the live overlay on the player). */
export function activeRow(rows:CaptionRow[],time:number){const segments=rowsToSegments(rows);const index=segments.findIndex(item=>time>=item.start&&time<item.end);return index<0?null:rows[index];}

export function rowErrorText(error:CaptionRowError,pt:boolean,duration:number):string{
 const say=(a:string,b:string)=>pt?a:b;
 return {start:say('Início ilegível (use 1:15.25).','Unreadable start (use 1:15.25).'),end:say('Fim ilegível.','Unreadable end.'),order:say('O fim precisa vir depois do início.','End must come after start.'),overlap:say('Começa antes do fim da legenda anterior.','Starts before the previous caption ends.'),outside:say(`Termina depois do fim do vídeo (${formatClock(duration)}).`,`Ends after the video (${formatClock(duration)}).`),short:say(`Fica menos de ${CAPTION_MIN_SECONDS} s na tela.`,`On screen for less than ${CAPTION_MIN_SECONDS} s.`),long:say(`Fica mais de ${CAPTION_MAX_SECONDS} s na tela; divida.`,`On screen for more than ${CAPTION_MAX_SECONDS} s; split it.`),text:say('Texto vazio: escreva o que foi falado ou remova a linha.','Empty text: write what was said or remove the row.'),chars:say('Os caracteres { } \\ não são aceitos.','Characters { } \\ are not accepted.'),lines:say(`No máximo ${CAPTION_MAX_LINES} linhas.`,`At most ${CAPTION_MAX_LINES} lines.`),length:say(`No máximo ${CAPTION_MAX_TEXT} caracteres.`,`At most ${CAPTION_MAX_TEXT} characters.`)}[error];
}
/** Honest labels for how the times were obtained. */
export function captionWarningText(warning:string,pt:boolean):string{
 const say=(a:string,b:string)=>pt?a:b;
 return ({'whisper-approximate':say('Tempos do Whisper são aproximados (podem variar ~0,5 s nas pausas). Assista e ajuste; não há sincronia perfeita automática.','Whisper times are approximate (can drift ~0.5 s around pauses). Watch and adjust; there is no automatic perfect sync.'),'sentence-timing':say('Sem tempo por palavra: cada frase usa o início e o fim da frase inteira.','No per-word timing: each sentence uses the whole sentence start and end.'),'split-proportional':say('Frases longas foram divididas; o tempo de cada parte é proporcional ao texto, não ao áudio. Confira essas partes.','Long sentences were split; each part’s time is proportional to its text, not the audio. Check those parts.'),'imported-srt':say('Tempos importados do SRT, sem conferência automática com o áudio.','Times imported from the SRT, not checked against the audio.'),'no-speech':say('Nenhuma fala reconhecida.','No speech recognized.'),'word-timing':say('Palavra a palavra: cada legenda usa o tempo reconhecido das próprias palavras (aproximado, ±0,3 s). O texto é exatamente o reconhecido; corrija o que estiver errado.','Word by word: each caption uses the recognized timing of its own words (approximate, ±0.3 s). Text is exactly what was recognized; fix anything wrong.'),'no-word-timing':say('Esta transcrição não tem tempo por palavra; as legendas saíram por frase. Transcreva de novo para tentar por palavra.','This transcript has no per-word timing; captions came out by sentence. Transcribe again to try word by word.'),'text-sanitized':say('Os caracteres { } \ foram retirados de algumas palavras porque o gravador de legendas não os aceita. Nenhuma outra letra foi trocada.','The characters { } \ were removed from some words because the caption burner does not accept them. No other letter was changed.')} as Record<string,string>)[warning]??warning;
}
