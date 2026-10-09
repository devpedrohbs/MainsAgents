import {SelectMenu} from '../common/SelectMenu';

export type MotionIntensity='off'|'subtle'|'balanced'|'intense';
export const motionIntensity=(value:string):MotionIntensity=>(['off','subtle','balanced','intense'] as const).find(item=>item===value)??'balanced';

export const motionOptions=(pt:boolean)=>[
 {value:'balanced',label:pt?'Equilibrado':'Balanced',description:pt?'Aproximações, textos e cartões nos pontos-chave':'Punch-ins, text and cards on key points'},
 {value:'subtle',label:pt?'Sutil':'Subtle',description:pt?'Poucas aproximações nas falas mais fortes':'A few punch-ins on the strongest lines'},
 {value:'intense',label:pt?'Intenso':'Intense',description:pt?'Mais destaques e efeitos sonoros suaves':'More highlights and soft sound effects'},
 {value:'off',label:pt?'Sem motion':'No motion',description:pt?'Só cortes e os textos fixos':'Only cuts and the fixed texts'},
];

/** Movement level for the automatic edit. Highlights follow the measured voice emphasis and the spoken key words. */
export function MotionIntensityField({value,onChange,pt,disabled=false,ariaLabel}:{value:string;onChange:(value:MotionIntensity)=>void;pt:boolean;disabled?:boolean;ariaLabel?:string}){
 return <label>{pt?'Movimento na edição':'Motion in the edit'}<SelectMenu ariaLabel={ariaLabel??(pt?'Movimento na edição':'Motion in the edit')} value={motionIntensity(value)} disabled={disabled} onChange={next=>onChange(motionIntensity(next))} options={motionOptions(pt)}/>
  <small className="editorial-hint">{pt?'Os destaques acompanham a ênfase da sua voz (volume, pausas e entonação) e as palavras-chave ditas. Você revisa tudo antes de aprovar.':'Highlights follow your voice emphasis (loudness, pauses and intonation) and the key words you say. You review everything before approving.'}</small></label>;
}
