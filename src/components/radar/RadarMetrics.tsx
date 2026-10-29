import { dateText, videoFacts, type RadarItem } from '../../features/radar/model';

export function RadarMetrics({ item, pt }: { item: RadarItem; pt: boolean }) {
  const facts = videoFacts(item, pt);
  return <div className="radar-evidence">
    <dl className="radar-facts">
      <div><dt>Views</dt><dd>{facts.views}</dd></div>
      <div><dt>{pt ? 'Comparação com o canal' : 'Channel comparison'}</dt><dd>{facts.ratio}</dd></div>
      <div><dt>{pt ? 'Base do canal' : 'Channel baseline'}</dt><dd>{facts.baseline}</dd></div>
      <div><dt>{pt ? 'Maturidade na coleta' : 'Maturity at collection'}</dt><dd>{facts.maturity}</dd></div>
      <div><dt>{pt ? 'Formato' : 'Format'}</dt><dd>{facts.format}</dd></div>
      <div><dt>{pt ? 'Crescimento observado' : 'Observed growth'}</dt><dd>{facts.growth}</dd></div>
    </dl>
    <aside className="radar-limitations" aria-label={pt ? 'Limitações dos números' : 'Limitations of these numbers'}>
      <strong>{pt ? 'Limitações dos números' : 'Limitations of these numbers'}</strong>
      {facts.limitations.length ? <ul lang="pt-BR">{facts.limitations.map((line, i) => <li key={i}>{line}</li>)}</ul> : <p>{pt ? 'Nenhuma limitação informada pela fonte.' : 'No limitations reported by the source.'}</p>}
      <p>{pt ? 'Observado em' : 'Observed at'}: {dateText(item.metrics?.latest?.collectedAt, pt)}. {pt ? 'Contadores ausentes ficam indisponíveis; os intervalos não são interpolados.' : 'Missing counters remain unavailable; intervals are not interpolated.'}</p>
    </aside>
  </div>;
}
