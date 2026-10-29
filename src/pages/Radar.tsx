import { useState } from 'react';
import { useLanguage } from '../app/LanguageProvider';
import { useWorkspaces } from '../app/WorkspaceProvider';
import { RadarHistory } from '../components/radar/RadarHistory';
import { RadarMetrics } from '../components/radar/RadarMetrics';
import { RadarRuns } from '../components/radar/RadarRuns';
import { RadarSettings } from '../components/radar/RadarSettings';
import { RadarSynthesis } from '../components/radar/RadarSynthesis';
import { RadarPromotionActions } from '../components/radar/RadarPromotionActions';
import { dateText, safeItemUrl, visibleItems, type RadarKind } from '../features/radar/model';
import { useRadar } from '../features/radar/useRadar';
import { useRadarPromotion } from '../features/radar/useRadarPromotion';
import '../styles/radar.css';

export function Radar() {
  const { currentWorkspaceId } = useWorkspaces();
  return <RadarWorkspace key={currentWorkspaceId} workspaceId={currentWorkspaceId} />;
}

function RadarWorkspace({ workspaceId }: { workspaceId: string }) {
  const { locale } = useLanguage();
  const pt = locale === 'pt-BR';
  const [kind, setKind] = useState<RadarKind>('youtube');
  const [highlights, setHighlights] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const api = useRadar(workspaceId, kind, highlights);
  const snapshot = api.snapshot;
  const promotion = useRadarPromotion(api.scope, snapshot, pt);
  const items = visibleItems(snapshot?.items ?? [], kind, highlights);
  return <div className="page radar-page" data-od-id="radar">
    <header className="radar-head"><div><h1>Radar</h1><p>{pt ? 'Acompanhe canais e notícias. Compare o que foi observado em cada coleta.' : 'Follow channels and news. Compare what was observed in each collection.'}</p></div>
      {snapshot && api.state === 'ready' && <button type="button" className="primary-button" disabled={api.busy || api.running} onClick={() => { setError(''); void api.collect().catch(failure => setError(failure instanceof Error ? failure.message : String(failure))); }}>{api.running ? (pt ? 'Coletando…' : 'Collecting…') : (pt ? 'Coletar agora' : 'Collect now')}</button>}
    </header>
    {error && <p className="radar-error" role="alert">{error}</p>}
    {promotion.error && <p className="radar-error" role="alert">{promotion.error}</p>}
    {api.state === 'unavailable' ? <div className="radar-empty"><h2>{pt ? 'Radar indisponível nesta versão' : 'Radar unavailable in this version'}</h2><p>{pt ? 'O serviço local do Radar não respondeu. Atualize ou reinicie o app para acessar a coleta.' : 'The local Radar service did not respond. Update or restart the app to access collection.'}</p><button type="button" className="soft-button" onClick={() => void api.refresh()}>{pt ? 'Tentar de novo' : 'Try again'}</button></div>
      : !snapshot ? <p className="radar-muted" role="status">{pt ? 'Carregando Radar…' : 'Loading Radar…'}</p> : <>
        {api.running && <p className="radar-notice" role="status">{pt ? 'Coleta em andamento. Os resultados são atualizados automaticamente.' : 'Collection in progress. Results update automatically.'}</p>}
        <RadarSettings snapshot={snapshot} profile={api.scope.profile} busy={api.busy} pt={pt} onSave={api.configure} onRefresh={api.refresh} />
        <RadarSynthesis synthesis={snapshot.synthesis} running={api.synthesizing} busy={api.busy} promotionDisabled={promotion.busy || !promotion.ready} pt={pt} onGenerate={api.synthesize} getItem={promotion.getItem} onPromote={(id, target, recommendation) => void promotion.promote(id, target, recommendation)} />
        <main>
          {openId ? <RadarHistory key={openId} id={openId} scope={api.scope} runs={snapshot.runs} pt={pt} onClose={() => setOpenId(null)} version={snapshot.runs.map(run => `${run.id}:${run.status}`).join('|')} /> : <section className="radar-section" aria-label={pt ? 'Itens coletados' : 'Collected items'}>
            <div className="radar-section-head"><nav className="radar-tabs" aria-label={pt ? 'Tipo de item' : 'Item type'}>{(['youtube', 'news'] as const).map(tab => <button type="button" key={tab} aria-current={kind === tab ? 'page' : undefined} onClick={() => setKind(tab)}>{tab === 'youtube' ? 'YouTube' : pt ? 'Notícias' : 'News'}</button>)}</nav><label className="radar-check"><input type="checkbox" checked={highlights} onChange={e => setHighlights(e.target.checked)} />{pt ? 'Só destaques' : 'Highlights only'}</label></div>
            <p className="radar-muted">{pt ? 'Destaques: vídeos com base suficiente e ≥ 3× a mediana do canal; notícias do Hacker News que atingem a pontuação da fonte.' : 'Highlights: videos with a sufficient baseline and ≥ 3× the channel median; Hacker News stories meeting the source score threshold.'}</p>
            {!api.queryReady ? <p role="status">{pt ? 'Carregando itens…' : 'Loading items…'}</p> : !items.length ? <div className="radar-empty"><h2>{pt ? 'Nenhum item nesta seleção' : 'No items in this selection'}</h2><p>{pt ? 'Adicione e salve suas fontes, depois use Coletar agora. Desmarque “Só destaques” para ver todos os resultados.' : 'Add and save sources, then use Collect now. Uncheck “Highlights only” to see all results.'}</p></div> : <ul className="radar-items">{items.map(item => <li key={item.id}>
              <article><div className="radar-item-title"><h2><button type="button" className="radar-item-open" onClick={() => setOpenId(item.id)}>{item.title}</button></h2>{item.highlight && <span className="radar-status ok">{pt ? 'Destaque' : 'Highlight'}</span>}</div>
                <p className="radar-muted">{item.author || (pt ? 'Autor indisponível' : 'Author unavailable')} · {pt ? 'Publicado' : 'Published'}: {dateText(item.publishedAt, pt)}</p>
                {item.kind === 'youtube' ? <RadarMetrics item={item} pt={pt} /> : <p className="radar-muted">{pt ? 'Última observação' : 'Last observed'}: {dateText(item.lastSeenAt, pt)}</p>}
                <div className="radar-row radar-item-actions"><button type="button" className="soft-button" onClick={() => setOpenId(item.id)}>{pt ? 'Ver histórico' : 'View history'}</button><a href={safeItemUrl(item.url)} target="_blank" rel="noreferrer">{pt ? 'Abrir original' : 'Open original'}</a></div>
                <RadarPromotionActions item={promotion.getItem(item.id)} disabled={promotion.busy || !promotion.ready} pt={pt} onPromote={target => void promotion.promote(item.id, target)} />
              </article>
            </li>)}</ul>}
            {api.queryReady && snapshot.nextCursor && <button type="button" className="soft-button" disabled={api.loadingMore} onClick={() => void api.more()}>{api.loadingMore ? (pt ? 'Carregando…' : 'Loading…') : pt ? 'Carregar mais' : 'Load more'}</button>}
          </section>}
        </main>
        <RadarRuns runs={snapshot.runs} pt={pt} />
      </>}
  </div>;
}
