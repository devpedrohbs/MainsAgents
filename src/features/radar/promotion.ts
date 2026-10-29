import { createReference, emptyInspirationState, updateReference, validateReferenceUrl, MAX_AUTHOR, MAX_NOTES, MAX_TITLE, type InspirationLibraryState } from '../content/inspiration.ts';
import { dateText, evidenceNumberText, numberText, videoFacts, type RadarItem, type RadarRecommendation, type RadarSnapshotRow } from './model.ts';

export type PromotionTarget = 'topic' | 'reference';

export function referenceNotes(item: RadarItem, recommendation: RadarRecommendation | undefined, pt: boolean, latest?: RadarSnapshotRow) {
  const lines = [pt ? 'Evidência do Radar (a IA não assistiu aos vídeos)' : 'Radar evidence (AI did not watch the videos)', item.url];
  if (recommendation) {
    for (const evidence of recommendation.evidence) {
      lines.push(`${pt ? 'Coletado em' : 'Collected at'} ${dateText(evidence.observedAt, pt)} (${evidence.observedAt})`, evidence.url,
        ...Object.entries(evidence.numbers).map(([key, value]) => `${evidenceNumberText(key, pt)}: ${numberText(value, pt, 4)}`));
    }
  }
  if (item.kind === 'youtube') {
    const facts = videoFacts(item, pt);
    lines.push(`${pt ? 'Coletado em' : 'Collected at'} ${dateText(item.metrics?.latest?.collectedAt, pt)}${item.metrics?.latest ? ` (${item.metrics.latest.collectedAt})` : ''}`,
      `${pt ? 'Visualizações' : 'Views'}: ${facts.views}`, `${pt ? 'Base' : 'Baseline'}: ${facts.baseline}`, `${pt ? 'Razão' : 'Ratio'}: ${facts.ratio}`);
    if (item.metrics?.latest) for (const key of ['likes', 'comments', 'score'] as const) lines.push(`${evidenceNumberText(key, pt)}: ${numberText(item.metrics.latest[key], pt)}`);
  } else if (!recommendation) {
    const collectedAt = latest?.collectedAt ?? item.lastSeenAt;
    lines.push(`${pt ? 'Coletado em' : 'Collected at'} ${dateText(collectedAt, pt)} (${collectedAt})`,
      `${evidenceNumberText('score', pt)}: ${numberText(latest?.score, pt)}`, `${evidenceNumberText('comments', pt)}: ${numberText(latest?.comments, pt)}`,
      pt ? 'Baseline/razão: não se aplica a notícias.' : 'Baseline/ratio: not applicable to news.');
  }
  lines.push('', pt ? 'Limitações' : 'Limitations', ...new Set([...(item.metrics?.limitations ?? []), ...(recommendation?.limitations ?? []),
    ...(item.kind === 'news' ? [pt ? 'Notícia: título, fonte e contadores disponíveis; sem dados de alcance. A IA não leu a matéria.' : 'News: title, source and available counters; no reach data. AI did not read the article.'] : [])]));
  if (recommendation) {
    const heading = `\n\n${pt ? 'Ideia de pauta' : 'Topic idea'}\n`;
    const marker = pt ? '… (ideia completa na síntese)' : '… (full idea in synthesis)';
    const room = MAX_NOTES - lines.join('\n').length - heading.length;
    if (room >= marker.length) lines.push(heading.trim(), recommendation.idea.length <= room ? recommendation.idea : recommendation.idea.slice(0, room - marker.length) + marker);
  }
  if (lines.join('\n').length > MAX_NOTES) throw Error(pt ? 'A evidência e as limitações ultrapassam o limite de 4.000 caracteres das notas da biblioteca.' : 'Evidence and limitations exceed the library notes limit of 4,000 characters.');
  return lines.join('\n');
}

/** Reuses a matching link without discarding its existing notes/tags or creating a duplicate. */
export function prepareRadarReference(state: InspirationLibraryState | undefined, workspaceId: string, item: RadarItem, recommendation: RadarRecommendation | undefined, pt: boolean, latest?: RadarSnapshotRow) {
  const library = state ?? emptyInspirationState();
  const key = validateReferenceUrl(item.url).dedupeKey;
  const existing = library.references.find(ref => ref.workspaceId === workspaceId && !ref.removedAt && ref.sourceUrl && validateReferenceUrl(ref.sourceUrl).dedupeKey === key);
  const notes = referenceNotes(item, recommendation, pt, latest);
  if (existing) return updateReference(library, workspaceId, existing.id, {
    notes: existing.notes.includes(notes) ? existing.notes : [existing.notes, notes].filter(Boolean).join('\n\n'),
    tags: [...new Set([...existing.tags, 'radar', item.platform])],
  });
  return createReference(library, workspaceId, { sourceUrl: item.url, title: item.title.slice(0, MAX_TITLE), author: item.author?.slice(0, MAX_AUTHOR), notes, tags: ['radar', item.platform] });
}

/** Serializes editorial writes; a failed link registration retries with the already-created ID. */
export class RadarPromotionQueue {
  private active = new Map<string, Promise<RadarItem>>();
  private receipts = new Map<string, string>();
  private tail: Promise<unknown> = Promise.resolve();
  private journal: { read: (key: string) => string | null; write: (key: string, id: string) => void };
  constructor(journal: { read: (key: string) => string | null; write: (key: string, id: string) => void }) { this.journal = journal; }
  promote(itemId: string, target: PromotionTarget, actions: {
    load: () => Promise<RadarItem>;
    create: (item: RadarItem) => Promise<string>;
    register: (id: string) => Promise<RadarItem>;
  }): Promise<RadarItem> {
    const key = `${itemId}:${target}`;
    const active = this.active.get(key);
    if (active) return active;
    const work = this.tail.catch(() => {}).then(async () => {
      const item = await actions.load();
      if (item.promoted.some(link => link.target === target)) return item;
      let id = this.receipts.get(key) ?? this.journal.read(key);
      if (!id) {
        id = await actions.create(item);
        this.receipts.set(key, id);
        this.journal.write(key, id);
      }
      return actions.register(id);
    });
    this.active.set(key, work);
    this.tail = work;
    void work.finally(() => { this.active.delete(key); }).catch(() => {});
    return work;
  }
}
