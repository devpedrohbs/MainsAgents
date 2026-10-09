import type {PreflightReport,PreflightStage,PreflightLevel} from '../../../production-preflight.mjs';
import './production-preflight.css';

const stageLabel=(stage:PreflightStage,pt:boolean)=>({script:pt?'Roteiro':'Script',notion:'Notion',recording:pt?'Gravação':'Recording',edit:pt?'Edição':'Editing',package:pt?'Capas e legendas':'Covers and captions',schedule:pt?'Agendamento':'Scheduling'}[stage]);
const levelLabel=(level:PreflightLevel,pt:boolean)=>({ok:'OK',blocker:pt?'Bloqueia':'Blocks',warning:pt?'Aviso':'Warning',unverified:pt?'Não verificado':'Not checked'}[level]);

/** Renders a precomputed, side-effect-free preflight. The only action is an explicit local FFmpeg check. */
export function ProductionPreflight({report,pt,busy,onCheckMedia}:{report:PreflightReport;pt:boolean;busy:boolean;onCheckMedia?:()=>void}){
 const stages=[...new Set(report.checks.map(c=>c.stage))];
 const summary=report.blockers.length?(pt?`${report.blockers.length} bloqueio(s) verificado(s) impedem o início.`:`${report.blockers.length} verified blocker(s) prevent starting.`):(pt?'Nenhum bloqueio verificado. Itens não verificados são conferidos quando a etapa rodar.':'No verified blockers. Unchecked items are verified when their stage runs.');
 return <section className="production-preflight" aria-label={pt?'Verificação antes de iniciar':'Pre-start check'}>
  <h3>{pt?'Verificação antes de iniciar':'Pre-start check'}</h3><p role="status">{summary}</p>
  {stages.map(stage=><div key={stage} className="production-preflight-stage"><strong>{stageLabel(stage,pt)}</strong><ul>{report.checks.filter(c=>c.stage===stage).map(c=><li key={c.id} data-level={c.level}><span className="production-preflight-level">{levelLabel(c.level,pt)}</span><span>{c.message}</span></li>)}</ul></div>)}
  {onCheckMedia&&report.checks.some(c=>c.id==='ffmpeg'&&c.level==='unverified')&&<button className="soft-button" disabled={busy} onClick={onCheckMedia}>{pt?'Verificar FFmpeg neste PC':'Check FFmpeg on this PC'}</button>}
 </section>;
}
