import { useState } from 'react';
import { useLanguage } from '../../app/LanguageProvider';
import { Icon } from '../common/Icon';
import type { EditorialInboxItem } from '../../features/content/editorialInbox';

const labels: Record<EditorialInboxItem['kind'], [string, string]> = {
  'research-needed': ['Pesquisar pauta', 'Research topic'], 'research-review': ['Revisar pesquisa', 'Review research'],
  'research-error': ['Retomar pesquisa', 'Resume research'], 'script-needed': ['Preparar roteiro', 'Prepare script'],
  'script-review': ['Revisar roteiro', 'Review script'], 'script-error': ['Retomar roteiro', 'Resume script'],
  'notion-error': ['Verificar envio ao Notion', 'Check Notion delivery'], 'video-review': ['Revisar produção', 'Review production'],
  'publication-review':['Revisar entrega por rede','Review network delivery'],
};
export function EditorialInbox({ items, ready, error, onOpen, onOpenStudio }: { items: EditorialInboxItem[]; ready: boolean; error: string; onOpen: (item: EditorialInboxItem) => void; onOpenStudio: () => void }) {
  const { locale } = useLanguage(), pt = locale === 'pt-BR';
  const [expanded, setExpanded] = useState(false);
  return <section className="work-panel editorial-inbox" aria-labelledby="inbox-heading">
    <div className="panel-heading"><h2 id="inbox-heading">{pt ? 'Próximos passos' : 'Next steps'} <span className="inbox-count">{ready ? items.length : '…'}</span></h2><button className="text-link" onClick={onOpenStudio}>{pt ? 'Abrir Estúdio' : 'Open Studio'}<Icon name="chevron" /></button></div>
    {error && <div className="inbox-notice" role="alert"><b>{pt ? 'Não foi possível atualizar todas as pendências' : 'Could not refresh all next steps'}</b><p>{error}</p><button className="text-link" onClick={onOpenStudio}>{pt ? 'Verificar no Estúdio' : 'Check in Studio'}</button></div>}
    {!ready ? <p className="inbox-notice" role="status">{pt ? 'Carregando suas pendências…' : 'Loading your next steps…'}</p> : items.length ? <>
      <ul className="inbox-list">{(expanded ? items : items.slice(0, 2)).map(item => <li key={item.id}><button className="inbox-row" onClick={() => onOpen(item)} data-inbox-id={item.id}>
        <Icon name={item.urgency === 'blocked' ? 'history' : item.kind.includes('script') ? 'script' : 'note'} />
        <span className="inbox-copy"><b>{item.title}</b><span>{labels[item.kind][pt ? 0 : 1]}{item.artifactVersion ? ` · v${item.artifactVersion}` : ''}</span>{item.detail && <small>{item.detail}</small>}</span>
        <span className={`inbox-state ${item.urgency}`}>{item.urgency === 'blocked' ? pt ? 'Bloqueado' : 'Blocked' : item.urgency === 'review' ? pt ? 'Sua revisão' : 'Your review' : pt ? 'Continuar' : 'Continue'}</span><Icon name="chevron" />
      </button></li>)}</ul>
      {items.length > 2 && <button className="panel-footer-action" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? pt ? 'Mostrar menos' : 'Show less' : pt ? `Ver todas (${items.length})` : `View all (${items.length})`}</button>}
    </> : !error && <div className="inbox-notice"><b>{pt ? 'Nenhuma decisão pendente' : 'No decisions pending'}</b><p>{pt ? 'Pesquisas, roteiros para revisão e envios com falha aparecerão aqui.' : 'Research, scripts to review and failed deliveries will appear here.'}</p></div>}
  </section>;
}
