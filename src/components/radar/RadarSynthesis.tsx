import { useState } from 'react';
import { RadarApiError } from '../../features/radar/api';
import { dateText, dayText, evidenceNumberText, numberText, safeItemUrl, synthesisConflictText, synthesisStatusText, type RadarItem, type RadarRecommendation, type RadarSynthesis as Synthesis } from '../../features/radar/model';
import type { PromotionTarget } from '../../features/radar/promotion';
import { RadarPromotionActions } from './RadarPromotionActions';

export function RadarSynthesis({ synthesis, running, busy, promotionDisabled, pt, onGenerate, getItem, onPromote }: {
  synthesis: Synthesis; running: boolean; busy: boolean; promotionDisabled: boolean; pt: boolean;
  onGenerate: () => Promise<void>; getItem: (id: string) => RadarItem | undefined;
  onPromote: (id: string, target: PromotionTarget, recommendation: RadarRecommendation) => void;
}) {
  const [notice, setNotice] = useState('');
  const [failed, setFailed] = useState(false);
  const generate = async () => {
    setNotice(''); setFailed(false);
    try { await onGenerate(); }
    catch (error) {
      const conflict = error instanceof RadarApiError && error.status === 409 ? synthesisConflictText(error.code, pt) : undefined;
      setFailed(!conflict);
      setNotice(conflict || (error instanceof Error ? error.message : String(error)));
    }
  };
  const status = running ? 'running' : synthesis.status;
  return <section className="radar-section radar-synthesis" aria-label={pt ? 'Síntese' : 'Synthesis'}>
    <div className="radar-section-head"><div className="radar-row"><h2>{pt ? 'Síntese' : 'Synthesis'}</h2><span className={`radar-status ${status}`} role="status">{synthesisStatusText(status, pt)}</span>{synthesis.dayKey && <small className="radar-muted">{dayText(synthesis.dayKey, pt)}</small>}</div>
      <button type="button" className="soft-button" disabled={busy || running} onClick={() => void generate()}>{pt ? 'Gerar síntese agora' : 'Generate synthesis now'}</button></div>
    <p className="radar-muted">{pt ? 'A IA não assistiu aos vídeos. Ela usa apenas títulos e números coletados. Hipóteses não comprovam o motivo do desempenho.' : 'AI did not watch the videos. It only uses collected titles and numbers. Hypotheses do not prove what caused performance.'}</p>
    {notice && <p className={failed ? 'radar-error' : 'radar-notice'} role={failed ? 'alert' : 'status'}>{notice}</p>}
    {synthesis.message && <p className="radar-notice" lang="pt-BR">{synthesis.message}</p>}
    {synthesis.waitingUntil && <p className="radar-muted">{pt ? 'Aguardando até' : 'Waiting until'}: {dateText(synthesis.waitingUntil, pt)}</p>}
    {status === 'waiting_limit' && !synthesis.waitingUntil && <p className="radar-muted">{pt ? 'Sem horário de liberação informado. Aguarda a retomada do provedor no app.' : 'No reset time available. Waiting for the provider to resume in the app.'}</p>}
    {status === 'none' && <p className="radar-muted">{pt ? 'Colete itens e escolha um agente na configuração para gerar sua primeira síntese.' : 'Collect items and choose an agent in settings to generate your first synthesis.'}</p>}
    {status === 'ready' && !synthesis.recommendations.length && <p className="radar-muted">{pt ? 'A síntese terminou sem recomendações com evidência suficiente.' : 'Synthesis finished with no recommendations supported by sufficient evidence.'}</p>}
    <ul className="radar-recommendations">{synthesis.recommendations.map((recommendation, index) => {
      const item = getItem(recommendation.itemId);
      return <li key={`${recommendation.itemId}:${index}`}><article>
        <h3>{item?.title ?? (pt ? 'Item recomendado' : 'Recommended item')}</h3>
        <div className="radar-recommendation-content"><section className="radar-recommendation-evidence" aria-label={pt ? 'Evidência' : 'Evidence'}><h4>{pt ? 'Evidência' : 'Evidence'}</h4>
          {!recommendation.evidence.length && <p className="radar-muted">{pt ? 'Evidência indisponível.' : 'Evidence unavailable.'}</p>}
          {recommendation.evidence.map((evidence, i) => <div key={i} className="radar-evidence-entry"><p><a href={safeItemUrl(evidence.url)} target="_blank" rel="noreferrer">{evidence.url}</a></p><p className="radar-muted">{pt ? 'Coletado em' : 'Collected at'}: <time dateTime={evidence.observedAt}>{dateText(evidence.observedAt, pt)}</time></p>
            <dl className="radar-facts">{Object.entries(evidence.numbers).map(([key, value]) => <div key={key}><dt>{evidenceNumberText(key, pt)}</dt><dd>{numberText(value, pt, 4)}</dd></div>)}</dl></div>)}
        </section><div className="radar-recommendation-reading"><section><h4>{pt ? 'Observação' : 'Observation'}</h4><p>{recommendation.observation}</p></section>
          <section><h4>{pt ? 'Hipótese' : 'Hypothesis'}</h4><p>{recommendation.hypothesis.text}</p><h5>{pt ? 'Explicações alternativas' : 'Alternative explanations'}</h5>{recommendation.hypothesis.alternatives.length ? <ul>{recommendation.hypothesis.alternatives.map((alternative, i) => <li key={i}>{alternative}</li>)}</ul> : <p className="radar-muted">{pt ? 'Não informadas.' : 'Not provided.'}</p>}</section>
          <section className="radar-topic-idea"><h4>{pt ? 'Ideia de pauta' : 'Topic idea'}</h4><p>{recommendation.idea}</p></section>
          <section className="radar-limitations"><h4>{pt ? 'Limitações' : 'Limitations'}</h4>{recommendation.limitations.length ? <ul>{recommendation.limitations.map((line, i) => <li key={i}>{line}</li>)}</ul> : <p>{pt ? 'Não informadas. A análise considera apenas títulos e números.' : 'Not provided. Analysis only considers titles and numbers.'}</p>}</section>
        </div></div>
        <RadarPromotionActions item={item} disabled={promotionDisabled} pt={pt} onPromote={target => onPromote(recommendation.itemId, target, recommendation)} />
        <p className="radar-muted">{pt ? 'Virar pauta usa o link original. A ideia fica nesta síntese e nas notas ao salvar na biblioteca.' : 'Create topic uses the original link. The idea stays in this synthesis and in the notes when saved to the library.'}</p>
      </article></li>;
    })}</ul>
  </section>;
}
