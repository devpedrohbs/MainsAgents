import type {AudioAssessment,AudioTreatment} from '../../features/content/model';

/**
 * Opt-in voice treatment (all off by default). Noise reduction is only offered when a noise floor was MEASURED in the
 * pauses of this recording; the preview above plays the exact processed audio once it is updated.
 */
export function VoiceTreatment({assessment,value,legacyNormalize,pt,busy,onChange,onMeasure}:{assessment:AudioAssessment|null|undefined;value:AudioTreatment|undefined;legacyNormalize:boolean;pt:boolean;busy:boolean;onChange:(value:AudioTreatment|undefined)=>void;onMeasure:()=>void}){
  const current:AudioTreatment=value??{leveling:false,noiseReduction:false,smoothCuts:false};
  const set=(change:Partial<AudioTreatment>)=>{const next={...current,...change};onChange(next.leveling||next.noiseReduction||next.smoothCuts?next:undefined);};
  const floor=assessment?.measurement?.noiseFloorDb;
  return <section className="edit-review-voice" aria-label={pt?'Tratamento de voz':'Voice treatment'} data-od-id="voice-treatment">
    <h3>{pt?'Tratamento de voz (opcional)':'Voice treatment (optional)'}</h3>
    <p className="edit-review-note">{pt?'Tudo começa desligado. Ligue só o que quiser e atualize a prévia para ouvir. O original nunca é alterado.':'Everything starts off. Turn on only what you want and update the preview to listen. The original is never changed.'}</p>
    <label><input type="checkbox" disabled={busy||legacyNormalize} checked={legacyNormalize||current.leveling} onChange={event=>set({leveling:event.target.checked})}/>{pt?'Nivelar volume da fala (−16 LUFS)':'Level speech volume (−16 LUFS)'}{legacyNormalize&&<small> {pt?'— já ligado nesta edição':'— already on in this edit'}</small>}</label>
    <label><input type="checkbox" disabled={busy||!assessment?.noiseReductionAvailable||floor===undefined} checked={Boolean(current.noiseReduction)} onChange={event=>set({noiseReduction:event.target.checked&&floor!==undefined?{noiseFloorDb:floor}:false})}/>{pt?'Reduzir ruído de fundo (suave)':'Reduce background noise (gentle)'}</label>
    {assessment?<p className="edit-review-note">{assessment.reason}{assessment.limitations.includes('multichannel')?(pt?' Áudio com mais de 2 canais.':' Audio has more than 2 channels.'):''}</p>
      :<p className="edit-review-note">{pt?'O ruído de fundo ainda não foi medido nesta gravação.':'Background noise has not been measured for this recording yet.'} <button className="text-link" disabled={busy} onClick={onMeasure}>{pt?'Medir agora (local)':'Measure now (local)'}</button></p>}
    <label><input type="checkbox" disabled={busy} checked={current.smoothCuts} onChange={event=>set({smoothCuts:event.target.checked})}/>{pt?'Suavizar emendas dos cortes (12 ms, sem mudar a duração)':'Smooth cut joins (12 ms, duration unchanged)'}</label>
  </section>;
}
