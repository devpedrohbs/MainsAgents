import type {EditRange,MotionCuePlan,MotionPlan} from '../../features/content/model';
import {SelectMenu} from '../common/SelectMenu';
import {motionIntensity,motionOptions} from '../production/MotionIntensity';
import {timestamp} from './SmartEditReview';

/** Edited-video time of a recording interval: the kept part with the largest overlap (same rule as the local engine). */
export function motionOutputTime(cue:Pick<MotionCuePlan,'sourceStart'|'sourceEnd'>,segments:readonly EditRange[]):number|null{
  let cursor=0,best:{at:number;size:number}|null=null;
  for(const kept of segments){const a=Math.max(cue.sourceStart,kept.start),b=Math.min(cue.sourceEnd,kept.end);if(b-a>0.3&&(!best||b-a>best.size))best={at:cursor+a-kept.start,size:b-a};cursor+=kept.end-kept.start;}
  return best?Math.round(best.at*1000)/1000:null;
}

const kindLabel=(kind:MotionCuePlan['kind'],pt:boolean)=>({punchIn:pt?'Aproximação':'Punch-in',kineticText:pt?'Texto animado':'Animated text',keyPoint:pt?'Cartão':'Card',explainer:pt?'Explicação visual':'Visual explainer'})[kind];
const visualLabel=(type:string,pt:boolean)=>({compare:pt?'antes × depois':'before × after',steps:pt?'etapas':'steps',stat:pt?'número':'number',process:pt?'processo':'process',image:pt?'sua imagem':'your image'} as Record<string,string>)[type]??type;
const evidence=(cue:MotionCuePlan,pt:boolean)=>cue.source==='user'?(pt?'escolhido por você':'chosen by you'):cue.explainer?.origin==='speech'?(pt?'dito na fala':'said in the speech'):cue.source==='measured'?(pt?'voz medida':'measured voice'):cue.source==='mixed'?(pt?'voz medida + texto':'measured voice + text'):(pt?'só texto':'text only');
const limitationText=(item:string,pt:boolean)=>({
  voiceUnavailable:pt?'A ênfase da voz não foi medida (sem áudio utilizável): os destaques vêm só do texto.':'Voice emphasis was not measured (no usable audio): highlights come from text only.',
  wordTimingEstimated:pt?'Tempos por palavra estimados dentro de cada frase: confira o encaixe ouvindo.':'Word timings estimated within each sentence: listen to check the timing.',
  transcriptUnavailable:pt?'Sem transcrição: não há destaques de fala.':'No transcript: no speech highlights.',
  tooShort:pt?'Vídeo curto demais para motion.':'Video too short for motion.',
  sfxSkipped:pt?'Efeitos sonoros omitidos.':'Sound effects skipped.',
} as Record<string,string>)[item]??item;

/**
 * Review of the motion moments of an automatic edit. The user can drop any moment or ask for another intensity; times
 * follow the current cut adjustments. Nothing renders here: the export after review applies it.
 */
export function MotionReview({motion,segments,pt,busy,onChange,onIntensity,onPlayRaw}:{motion:MotionPlan;segments:readonly EditRange[];pt:boolean;busy:boolean;onChange:(motion:MotionPlan)=>void;onIntensity:(intensity:MotionPlan['intensity'])=>void;onPlayRaw:(start:number,end:number)=>void}){
  return <section className="edit-review-motion" aria-label={pt?'Movimento':'Motion'}>
    <div className="edit-review-motion-head"><h3>{pt?'Movimento':'Motion'}</h3>
      <SelectMenu ariaLabel={pt?'Intensidade do movimento':'Motion intensity'} value={motion.intensity} disabled={busy} onChange={value=>onIntensity(motionIntensity(value))} options={motionOptions(pt)}/></div>
    <p>{pt?'Cada momento mostra o porquê: o que foi medido na voz e o que veio do texto. Desmarque o que não quiser.':'Each moment shows why: what was measured in the voice and what came from the text. Untick what you do not want.'}</p>
    {motion.analysis.limitations.map(item=><p key={item} className="edit-review-note">{limitationText(item,pt)}</p>)}
    {motion.cues.length===0?<p>{motion.intensity==='off'?(pt?'Sem motion nesta versão.':'No motion in this version.'):(pt?'Nenhum momento forte o bastante foi encontrado.':'No moment was strong enough.')}</p>
    :<ol className="edit-review-motion-list">{motion.cues.map(cue=>{const at=motionOutputTime(cue,segments);return <li key={cue.id} className={at===null?'is-kept':''}>
      <div><b>{kindLabel(cue.kind,pt)}{cue.explainer?` (${visualLabel(cue.explainer.visual.type,pt)})`:''}{cue.text?` · “${cue.text}”`:''}</b> <small>{at===null?(pt?'trecho cortado: não entra':'cut out: not applied'):`${pt?'no editado em':'in edit at'} ${timestamp(at)}`} · {evidence(cue,pt)}{cue.sfx?(pt?' · efeito sonoro suave':' · soft sound effect'):''}{cue.layout!=='camera-full'?(pt?' · tela dividida':' · split screen'):''}</small>
        <p>{cue.reason}</p>{cue.explainer?.quote&&<p className="edit-review-note">{pt?'Trecho dito':'Spoken passage'}: “{cue.explainer.quote}”</p>}</div>
      <div className="edit-review-actions">
        <button className="soft-button" onClick={()=>onPlayRaw(cue.sourceStart-0.6,cue.sourceEnd+0.6)}>{pt?'Ouvir no bruto':'Hear in raw'}</button>
        <label><input type="checkbox" checked disabled={busy} onChange={()=>onChange({...motion,cues:motion.cues.filter(item=>item.id!==cue.id)})}/>{pt?'Manter este momento':'Keep this moment'}</label>
      </div></li>;})}</ol>}
  </section>;
}
