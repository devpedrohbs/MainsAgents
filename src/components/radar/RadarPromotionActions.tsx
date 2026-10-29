import type { RadarItem } from '../../features/radar/model';
import type { PromotionTarget } from '../../features/radar/promotion';

export function RadarPromotionActions({ item, disabled, pt, onPromote }: { item?: RadarItem; disabled: boolean; pt: boolean; onPromote: (target: PromotionTarget) => void }) {
  return <div className="radar-row radar-promotion-actions" aria-busy={disabled}>
    {(['topic', 'reference'] as const).map(target => {
      const link = item?.promoted.find(link => link.target === target);
      return link ? <span key={target} className="radar-status ok" title={link.id}>{target === 'topic' ? (pt ? 'Pauta criada' : 'Topic created') : pt ? 'Salvo na biblioteca' : 'Saved to library'}</span>
        : <button key={target} type="button" className="soft-button" disabled={disabled} onClick={() => onPromote(target)}>{target === 'topic' ? (pt ? 'Virar pauta' : 'Create topic') : pt ? 'Salvar na biblioteca' : 'Save to library'}</button>;
    })}
  </div>;
}
