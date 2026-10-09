import type {ContentSessionSummary} from '../../features/chat/contentSessions';

/** Resume card of a content session: saved state only (opening or switching never runs a script, edit or Notion read). */
export function ContentSessionCard({summary,pt,onProduction,onRecorded,onScript}:{summary:ContentSessionSummary;pt:boolean;onProduction:()=>void;onRecorded:()=>void;onScript:()=>void}){
 return <section className="content-session-card" aria-label={pt?`Conteúdo: ${summary.title}`:`Content: ${summary.title}`} data-next={summary.next}>
  <header><b>{summary.title}</b><span>{summary.stage}</span></header>
  {summary.materials.length>0&&<ul aria-label={pt?'Materiais deste conteúdo':'This content’s materials'}>{summary.materials.map(item=><li key={item}>{item}</li>)}</ul>}
  {summary.lastDecision&&<p><small>{pt?'Última decisão':'Last decision'}</small>{summary.lastDecision}</p>}
  <p className="content-session-next"><small>{pt?'Próxima ação':'Next action'}</small>{summary.nextAction}</p>
  <div className="content-session-actions">
   {summary.next==='production'&&<button className="soft-button" onClick={onProduction}>{pt?'Abrir etapa atual':'Open current step'}</button>}
   {summary.next==='start'&&<><button className="soft-button" onClick={onRecorded}>{pt?'Começar com vídeo já gravado':'Start with a recorded video'}</button><button className="text-link" onClick={onScript}>{pt?'Gerar roteiro a partir da ideia':'Generate script from the idea'}</button></>}
  </div>
 </section>;
}
