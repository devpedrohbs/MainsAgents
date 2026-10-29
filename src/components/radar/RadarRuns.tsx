import { dateText, dayText, statusText, type RadarRun } from '../../features/radar/model';

export function GapDays({ days, pt }: { days: string[]; pt: boolean }) {
  return <p className={days.length ? 'radar-gap' : 'radar-muted'}>{days.length
    ? `${pt ? 'Dias sem coleta' : 'Days without collection'}: ${days.map(day => dayText(day, pt)).join(', ')}. ${pt ? 'Sem preenchimento retroativo.' : 'No backfilling.'}`
    : pt ? 'Nenhuma lacuna registrada nesta execução.' : 'No gaps recorded for this run.'}</p>;
}
export function RadarRuns({ runs, pt }: { runs: RadarRun[]; pt: boolean }) {
  return <details className="radar-section radar-runs"><summary>{pt ? 'Histórico de execuções' : 'Collection runs'} ({runs.length})</summary>
    {!runs.length && <p className="radar-muted">{pt ? 'Nenhuma execução registrada.' : 'No runs recorded.'}</p>}
    <ol>{runs.map(run => <li key={run.id}>
      <div className="radar-row"><strong>{dateText(run.startedAt, pt)}</strong><span className={`radar-status ${run.status}`}>{statusText(run.status, pt)}</span><span>{run.reason === 'manual' ? (pt ? 'Manual' : 'Manual') : run.reason === 'schedule' ? (pt ? 'Agendada' : 'Scheduled') : (pt ? 'Retomada' : 'Catch-up')}</span></div>
      <p className="radar-muted">{pt ? 'Fim' : 'Finished'}: {dateText(run.finishedAt, pt)}</p>
      <GapDays days={run.gapDays} pt={pt} />
      <ul className="radar-run-sources">{run.sources.map(source => <li key={source.sourceId}>{source.sourceId}: {statusText(source.status, pt)}; {source.items} {pt ? 'itens' : 'items'}{source.errorCode ? ` (${source.errorCode})` : ''}</li>)}</ul>
    </li>)}</ol>
  </details>;
}
