import { useState } from 'react';
import { useLanguage } from '../app/LanguageProvider';
import { useWorkspaces } from '../app/WorkspaceProvider';
import { RadarHistory } from '../components/radar/RadarHistory';
import { RadarRuns } from '../components/radar/RadarRuns';
import { RadarSettings } from '../components/radar/RadarSettings';
import { RadarSynthesis } from '../components/radar/RadarSynthesis';
import { RadarPromotionActions } from '../components/radar/RadarPromotionActions';
import { StatusIcon, type RunState } from '../components/common/StatusIcon';
import { dateText, numberText, safeItemUrl, statusText, visibleItems, type RadarItem, type RadarKind } from '../features/radar/model';
import { shortAgo } from '../features/inbox/inbox';
import { useRadar } from '../features/radar/useRadar';
import { useRadarPromotion } from '../features/radar/useRadarPromotion';
import '../styles/radar.css';

export function Radar() {
  const { currentWorkspaceId } = useWorkspaces();
  return <RadarWorkspace key={currentWorkspaceId} workspaceId={currentWorkspaceId} />;
}

const runState = (status?: string): RunState => status === 'running' ? 'running' : status === 'failed' ? 'failed' : status === 'partial' ? 'waiting' : status ? 'done' : 'queued';
const time = (iso: string, locale: string) => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/** Ratio to the channel median: the only comparison the Radar measures (nothing is estimated). */
function ratioText(item: RadarItem, pt: boolean) {
  const m = item.metrics;
  return m?.baselineStatus === 'ok' && m.ratio != null ? `${numberText(m.ratio, pt, 1)}×` : '—';
}

function RadarWorkspace({ workspaceId }: { workspaceId: string }) {
  const { locale } = useLanguage();
  const pt = locale === 'pt-BR';
  const [kind, setKind] = useState<RadarKind>('youtube');
  const [highlights, setHighlights] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [panel, setPanel] = useState<'none' | 'sources' | 'synthesis'>('none');
  const [error, setError] = useState('');
  const api = useRadar(workspaceId, kind, highlights);
  const snapshot = api.snapshot;
  const promotion = useRadarPromotion(api.scope, snapshot, pt);
  const items = visibleItems(snapshot?.items ?? [], kind, highlights);
  const lastRun = snapshot?.running ?? snapshot?.runs[0];
  const sourceCount = snapshot?.config?.sources?.length ?? 0;
  const togglePanel = (next: 'sources' | 'synthesis') => setPanel(panel === next ? 'none' : next);
  const collect = () => { setError(''); void api.collect().catch(failure => setError(failure instanceof Error ? failure.message : String(failure))); };
  return <div className="page v2-page radar-page v2-radar" data-od-id="radar">
    <header className="radar-head v2-header">
      <h1>Radar</h1>
      {lastRun ? <span className="v2-sub v2-radar-run"><StatusIcon size={12} state={runState(lastRun.status)} />{api.running ? (pt ? 'Coleta em andamento' : 'Collecting') : `${pt ? 'Coleta das' : 'Collected at'} ${time(lastRun.startedAt, locale)}`}{snapshot?.nextRunAt && ` · ${pt ? 'próxima' : 'next'} ${dateText(snapshot.nextRunAt, pt)}`}</span>
        : <span className="v2-sub">{pt ? 'Acompanhe canais e notícias. Compare o que foi observado em cada coleta.' : 'Follow channels and news. Compare what was observed in each collection.'}</span>}
      <span className="v2-spacer" />
      {snapshot && api.state === 'ready' && <>
        {/* First in DOM (keyboard order and `.radar-head button`), shown last. */}
        <button type="button" className="primary-button v2-radar-collect" disabled={api.busy || api.running} onClick={collect}>{api.running ? (pt ? 'Coletando…' : 'Collecting…') : (pt ? 'Coletar agora' : 'Collect now')}</button>
        <button type="button" className="soft-button" aria-pressed={panel === 'synthesis'} onClick={() => togglePanel('synthesis')}>{pt ? 'Síntese' : 'Synthesis'}</button>
        <button type="button" className="soft-button" aria-pressed={panel === 'sources'} onClick={() => togglePanel('sources')}>{pt ? 'Fontes' : 'Sources'} <span className="v2-mono">{sourceCount}</span></button>
      </>}
    </header>
    {error && <p className="radar-error" role="alert">{error}</p>}
    {promotion.error && <p className="radar-error" role="alert">{promotion.error}</p>}
    {api.state === 'unavailable' ? <div className="radar-empty"><h2>{pt ? 'Radar indisponível nesta versão' : 'Radar unavailable in this version'}</h2><p>{pt ? 'O serviço local do Radar não respondeu. Atualize ou reinicie o app para acessar a coleta.' : 'The local Radar service did not respond. Update or restart the app to access collection.'}</p><button type="button" className="soft-button" onClick={() => void api.refresh()}>{pt ? 'Tentar de novo' : 'Try again'}</button></div>
      : !snapshot ? <p className="radar-muted" role="status">{pt ? 'Carregando Radar…' : 'Loading Radar…'}</p> : <>
        {api.running && <p className="radar-notice" role="status">{pt ? 'Coleta em andamento. Os resultados são atualizados automaticamente.' : 'Collection in progress. Results update automatically.'}</p>}
        {/* Sources and synthesis stay mounted (saved drafts survive toggling); the header buttons only show or hide them. */}
        <div className="v2-radar-panel" hidden={panel !== 'sources'}>
          <RadarSettings snapshot={snapshot} profile={api.scope.profile} busy={api.busy} pt={pt} onSave={api.configure} onRefresh={api.refresh} />
          <RadarRuns runs={snapshot.runs} pt={pt} />
        </div>
        <div className="v2-radar-panel" hidden={panel !== 'synthesis'}>
          <RadarSynthesis synthesis={snapshot.synthesis} running={api.synthesizing} busy={api.busy} promotionDisabled={promotion.busy || !promotion.ready} pt={pt} onGenerate={api.synthesize} getItem={promotion.getItem} onPromote={(id, target, recommendation) => void promotion.promote(id, target, recommendation)} />
        </div>
        <div className="radar-section-head v2-radar-filters">
          <nav className="radar-tabs v2-segment" aria-label={pt ? 'Tipo de item' : 'Item type'}>{(['youtube', 'news'] as const).map(tab => <button type="button" key={tab} aria-current={kind === tab ? 'page' : undefined} aria-pressed={kind === tab} onClick={() => { setKind(tab); setOpenId(null); }}>{tab === 'youtube' ? 'YouTube' : pt ? 'Notícias' : 'News'}</button>)}</nav>
          <label className="radar-check"><input type="checkbox" checked={highlights} onChange={e => setHighlights(e.target.checked)} />{pt ? 'Só destaques' : 'Highlights only'}</label>
          <span className="v2-sub">{pt ? 'Destaque: vídeo ≥ 3× a mediana do canal (com base suficiente) ou notícia acima da pontuação da fonte.' : 'Highlight: video ≥ 3× the channel median (with enough baseline) or a story above the source score.'}</span>
        </div>
        <div className="v2-radar-body">
          <section className="radar-section v2-radar-list" aria-label={pt ? 'Sinais' : 'Signals'}>
            <div className="v2-radar-cols" aria-hidden="true"><span>{kind === 'youtube' ? (pt ? 'vs canal' : 'vs channel') : ''}</span><span>{pt ? 'Sinal' : 'Signal'}</span><span>{pt ? 'Visto' : 'Seen'}</span></div>
            {!api.queryReady ? <p role="status" className="v2-empty">{pt ? 'Carregando itens…' : 'Loading items…'}</p> : !items.length ? <div className="radar-empty"><h2>{pt ? 'Nenhum item nesta seleção' : 'No items in this selection'}</h2><p>{pt ? 'Adicione e salve suas fontes, depois use Coletar agora. Desmarque “Só destaques” para ver todos os resultados.' : 'Add and save sources, then use Collect now. Uncheck “Highlights only” to see all results.'}</p></div> : <ul className="radar-items">{items.map(item => <li key={item.id} aria-current={openId === item.id || undefined}>
              <span className={`v2-radar-ratio ${item.highlight ? 'hot' : ''}`}>{item.kind === 'youtube' ? ratioText(item, pt) : ''}</span>
              <span className="v2-radar-copy">
                <span className="radar-item-title">{item.highlight && <span className="radar-status ok">{pt ? 'Destaque' : 'Highlight'}</span>}{item.promoted.map(link => <span key={link.target} className="v2-chip" title={link.id}>{link.target === 'topic' ? (pt ? 'Pauta criada' : 'Topic created') : pt ? 'Salvo na biblioteca' : 'Saved to library'}</span>)}<button type="button" className="radar-item-open" onClick={() => setOpenId(item.id)}>{item.title}</button></span>
                <span className="v2-sub v2-ellipsis">{item.author || (pt ? 'Autor indisponível' : 'Author unavailable')}{item.kind === 'youtube' && item.metrics?.latest?.views != null && ` · ${numberText(item.metrics.latest.views, pt)} views`}{item.metrics?.baselineStatus === 'insufficient' && ` · ${pt ? 'base insuficiente' : 'insufficient baseline'}`}{item.publishedAt && ` · ${dateText(item.publishedAt, pt)}`}</span>
              </span>
              <span className="v2-sub v2-mono">{shortAgo(item.lastSeenAt, locale)}</span>
            </li>)}</ul>}
            {api.queryReady && snapshot.nextCursor && <button type="button" className="soft-button v2-radar-more" disabled={api.loadingMore} onClick={() => void api.more()}>{api.loadingMore ? (pt ? 'Carregando…' : 'Loading…') : pt ? 'Carregar mais' : 'Load more'}</button>}
          </section>
          <aside className="v2-radar-detail" aria-label={pt ? 'Detalhe do sinal' : 'Signal detail'}>
            {openId ? <>
              <div className="v2-radar-detail-actions">
                <RadarPromotionActions item={promotion.getItem(openId)} disabled={promotion.busy || !promotion.ready} pt={pt} onPromote={target => void promotion.promote(openId, target)} />
                {(() => { const item = items.find(entry => entry.id === openId); return item ? <a className="v2-link" href={safeItemUrl(item.url)} target="_blank" rel="noreferrer">{pt ? 'Abrir original' : 'Open original'}</a> : null; })()}
              </div>
              <RadarHistory key={openId} id={openId} scope={api.scope} runs={snapshot.runs} pt={pt} onClose={() => setOpenId(null)} version={snapshot.runs.map(run => `${run.id}:${run.status}`).join('|')} />
            </> : <div className="v2-empty"><b>{pt ? 'Escolha um sinal' : 'Pick a signal'}</b><span>{pt ? 'Veja números observados, histórico de coletas e transforme em pauta ou referência.' : 'See observed numbers and collection history, and turn it into a topic or reference.'}</span>
              {lastRun && <span className="v2-sub">{pt ? 'Última coleta' : 'Last collection'}: {statusText(lastRun.status, pt)}</span>}</div>}
          </aside>
        </div>
      </>}
  </div>;
}
