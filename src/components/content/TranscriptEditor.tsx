import {useState} from 'react';
import type {EditRange} from '../../features/content/model';
import {keptShare,selectionOf,type ReviewWord} from '../../features/content/editReviewModel';
import {timestamp} from './SmartEditReview';

export type TranscriptAction='cut'|'keep'|'punchIn'|'highlight';
export interface TranscriptSelection extends EditRange {text:string;first:number;last:number;estimated:boolean}

/**
 * Clickable transcript on the RAW timeline. Click a word to hear it; click a second word (or Shift+click) to select
 * the phrase between them and act on it. Text is shown exactly as recognized; nothing here edits what was said.
 */
export function TranscriptEditor({words,segments,time,pt,busy,canMotion,canUndo,onPlay,onAction,onUndo}:{words:readonly ReviewWord[];segments:readonly EditRange[];time:number;pt:boolean;busy:boolean;canMotion:boolean;canUndo:boolean;onPlay:(range:EditRange)=>void;onAction:(action:TranscriptAction,selection:TranscriptSelection)=>void;onUndo:()=>void}){
  const [anchor,setAnchor]=useState<number|null>(null),[focus,setFocus]=useState<number|null>(null);
  const selection=anchor===null?null:selectionOf(words,anchor,focus??anchor);
  const pick=(index:number,extend:boolean)=>{
    if(extend&&anchor!==null){setFocus(index);return;}
    if(anchor!==null&&focus===null&&index!==anchor){setFocus(index);return;}
    setAnchor(index);setFocus(null);onPlay({start:words[index].start,end:words[index].end});
  };
  const act=(action:TranscriptAction)=>{if(!selection)return;onAction(action,selection);setAnchor(null);setFocus(null);};
  const estimated=words.some(word=>word.estimated);
  // Only one word is “now”: the last one that started (recognized word ends can overlap the next words).
  const nowIndex=words.reduce((found,word)=>word.start<=time&&time<word.end+0.6?word.index:found,-1);
  if(!words.length)return <section className="edit-transcript" aria-label={pt?'Transcrição':'Transcript'}><h3>{pt?'Editar pela transcrição':'Edit by transcript'}</h3><p className="edit-review-note">{pt?'Sem transcrição local desta gravação: use os cortes abaixo.':'No local transcript for this recording: use the cuts below.'}</p></section>;
  return <section className="edit-transcript" aria-label={pt?'Transcrição':'Transcript'} data-od-id="edit-transcript">
    <h3>{pt?'Editar pela transcrição':'Edit by transcript'}</h3>
    <p className="edit-review-note">{pt?'Clique numa palavra para ouvir. Clique em outra para selecionar o trecho entre elas e escolher o que fazer. Palavras riscadas estão cortadas.':'Click a word to hear it. Click another to select the passage between them and choose what to do. Struck-through words are cut.'}{estimated?(pt?' Tempos por palavra estimados dentro de cada frase: ouça antes de cortar.':' Word timings are estimated within each sentence: listen before cutting.'):(pt?' Tempos do reconhecimento local (aproximados, ±0,3 s).':' Local recognition timings (approximate, ±0.3 s).')}</p>
    <div className="edit-transcript-words" role="group" aria-label={pt?'Palavras da gravação':'Recording words'}>
      {words.map(word=>{const cut=keptShare(word,segments)<0.5,selected=!!selection&&word.index>=selection.first&&word.index<=selection.last,now=word.index===nowIndex;
        return <button key={word.index} type="button" className={`edit-transcript-word${cut?' is-cut':''}${selected?' is-selected':''}${now?' is-now':''}`} data-word={word.index} title={`${timestamp(word.start)}${cut?(pt?' · cortada':' · cut'):''}`} disabled={busy} onClick={event=>pick(word.index,event.shiftKey)}>{word.text}</button>;})}
    </div>
    <div className="edit-transcript-actions" data-od-id="edit-transcript-actions">
      {selection?<span><b>“{selection.text.length>80?`${selection.text.slice(0,80)}…`:selection.text}”</b> <small>{timestamp(selection.start)} → {timestamp(selection.end)}</small></span>:<span className="edit-review-note">{pt?'Nenhum trecho selecionado.':'No passage selected.'}</span>}
      <button className="soft-button" disabled={busy||!selection} onClick={()=>selection&&onPlay(selection)}>{pt?'Ouvir trecho':'Hear passage'}</button>
      <button className="soft-button" disabled={busy||!selection} onClick={()=>act('cut')}>{pt?'Cortar trecho':'Cut passage'}</button>
      <button className="soft-button" disabled={busy||!selection} onClick={()=>act('keep')}>{pt?'Manter (desfazer corte/pausa)':'Keep (undo cut/pause)'}</button>
      <button className="soft-button" disabled={busy||!selection||!canMotion} onClick={()=>act('punchIn')}>{pt?'Aproximar câmera':'Push camera in'}</button>
      <button className="soft-button" disabled={busy||!selection||!canMotion||(selection?.text.length??0)>60} onClick={()=>act('highlight')}>{pt?'Destacar texto':'Highlight text'}</button>
      <button className="text-link" disabled={busy||!canUndo} onClick={onUndo}>{pt?'Desfazer último ajuste':'Undo last adjustment'}</button>
      {selection&&selection.text.length>60&&<small>{pt?'Destaque aceita até 60 caracteres.':'Highlight accepts up to 60 characters.'}</small>}
    </div>
  </section>;
}
