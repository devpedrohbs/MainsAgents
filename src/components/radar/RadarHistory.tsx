import { useEffect, useRef, useState } from 'react';
import { loadRadarHistory } from '../../features/radar/api';
import { dateText, historyRows, numberText, safeItemUrl, type RadarItem, type RadarRun, type RadarScope, type RadarSnapshotRow } from '../../features/radar/model';
import { RadarMetrics } from './RadarMetrics';
import { GapDays } from './RadarRuns';

export function RadarHistory({ id, scope, runs, pt, onClose, version }: { id: string; scope: RadarScope; runs: RadarRun[]; pt: boolean; onClose: () => void; version: string }) {
  const [data, setData] = useState<{ item: RadarItem; snapshots: RadarSnapshotRow[] } | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); heading.current?.scrollIntoView({ block: 'start' }); }, [id]);
  useEffect(() => {
    const controller = new AbortController(); setError(false);
    void loadRadarHistory(scope, id, controller.signal).then(value => {
      if (!controller.signal.aborted) {
        if (!value?.item || !Array.isArray(value.snapshots)) throw Error('Invalid history');
        setData(value);
      }
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [scope, id, attempt, version]);
  return <section className="radar-section radar-history" aria-labelledby="radar-history-title">
    <div className="radar-section-head"><h2 id="radar-history-title" tabIndex={-1} ref={heading}>{pt ? 'Histórico do item' : 'Item history'}</h2><button type="button" className="soft-button" onClick={onClose}>{pt ? 'Voltar à lista' : 'Back to list'}</button></div>
    {error ? <div role="alert"><p>{pt ? 'Histórico indisponível. O serviço local não respondeu.' : 'History unavailable. The local service did not respond.'}</p><button type="button" className="soft-button" onClick={() => setAttempt(n => n + 1)}>{pt ? 'Tentar de novo' : 'Try again'}</button></div> : !data ? <p role="status">{pt ? 'Carregando histórico…' : 'Loading history…'}</p> : <>
      <h3><a href={safeItemUrl(data.item.url)} target="_blank" rel="noreferrer">{data.item.title}</a></h3>
      <p className="radar-muted">{data.item.author || (pt ? 'Autor indisponível' : 'Author unavailable')} · {pt ? 'Publicado' : 'Published'}: {dateText(data.item.publishedAt, pt)}</p>
      {data.item.kind === 'youtube' && <RadarMetrics item={data.item} pt={pt} />}
      <p className="radar-muted">{pt ? 'Cada linha é uma medição real. Um dia ausente não significa zero.' : 'Each row is an actual measurement. A missing day does not mean zero.'}</p>
      <div className="radar-table-scroll"><table><caption>{pt ? 'Snapshots coletados (mais recentes primeiro)' : 'Collected snapshots (newest first)'}</caption><thead><tr><th>{pt ? 'Data e hora' : 'Date and time'}</th><th>{pt ? 'Fonte' : 'Source'}</th><th>Views</th><th>Likes</th><th>{pt ? 'Comentários' : 'Comments'}</th><th>{pt ? 'Pontos' : 'Score'}</th></tr></thead>
        <tbody>{historyRows(data.snapshots, runs).map(({ snapshot: row, gapDays }) => <tr key={row.id}><td>{dateText(row.collectedAt, pt)}{gapDays.length > 0 && <GapDays days={gapDays} pt={pt} />}</td><td>{row.source}</td><td>{numberText(row.views, pt)}</td><td>{numberText(row.likes, pt)}</td><td>{numberText(row.comments, pt)}</td><td>{numberText(row.score, pt)}</td></tr>)}</tbody></table></div>
      {!data.snapshots.length && <p>{pt ? 'Nenhum snapshot registrado para este item.' : 'No snapshots recorded for this item.'}</p>}
      <details><summary>{pt ? 'Lacunas nas execuções recentes deste workspace' : 'Gaps in recent runs in this workspace'}</summary><p className="radar-muted">{pt ? 'As lacunas abaixo vêm das últimas 20 execuções; o histórico do item pode ser mais antigo.' : 'The gaps below come from the latest 20 runs; item history may be older.'}</p>{runs.filter(run => run.gapDays.length).map(run => <div key={run.id}><small>{dateText(run.startedAt, pt)}</small><GapDays days={run.gapDays} pt={pt} /></div>)}{!runs.some(run => run.gapDays.length) && <p>{pt ? 'Nenhuma lacuna informada nas execuções recentes.' : 'No gaps reported in recent runs.'}</p>}</details>
      <div className="radar-row radar-future"><button disabled className="soft-button">{pt ? 'Criar pauta — em breve' : 'Create topic — coming soon'}</button><button disabled className="soft-button">{pt ? 'Salvar referência — em breve' : 'Save reference — coming soon'}</button></div>
    </>}
  </section>;
}
