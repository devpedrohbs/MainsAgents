import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '../app/LanguageProvider';
import { useWorkspaces } from '../app/WorkspaceProvider';
import { AgentAvatar } from '../components/agents/AgentAvatar';
import { Icon } from '../components/common/Icon';
import { StatusIcon } from '../components/common/StatusIcon';
import { usePersistentState } from '../data/localPersistence';
import { useProduction } from '../features/production/ProductionProvider';
import { productionStageLabel } from '../features/production/model';
import { dayGroup, inboxToneLabel, inboxToneState, runLabel, shortAgo, type InboxItem } from '../features/inbox/inbox';

type Filter = 'all' | 'unread' | 'action';
interface InboxProps {
  items: InboxItem[];
  onArchive: (item: InboxItem) => void;
  onSnooze: (item: InboxItem) => void;
  onOpenRun: (runId: string) => void;
}

const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/** V2 inbox: everything waiting on the user in one list, with the selected item's context and its own action. */
export function Inbox({ items, onArchive, onSnooze, onOpenRun }: InboxProps) {
  const { locale } = useLanguage(), pt = locale === 'pt-BR';
  const { currentWorkspaceId } = useWorkspaces();
  const { runs } = useProduction();
  const [filter, setFilter] = useState<Filter>('all');
  const [seen, setSeen] = usePersistentState<Record<string, string>>(`inbox-seen:${currentWorkspaceId}`, {});
  const [selectedId, setSelectedId] = useState<string>('');
  const unread = (item: InboxItem) => seen[item.id] !== item.at;
  const shown = items.filter((item) => filter === 'all' || (filter === 'unread' ? unread(item) : item.tone !== 'reply' && item.tone !== 'next'));
  const selected = shown.find((item) => item.id === selectedId) ?? shown[0];
  const groups = useMemo(() => {
    const map = new Map<string, InboxItem[]>();
    for (const item of [...shown].sort((a, b) => b.at.localeCompare(a.at))) { const key = dayGroup(item.at, pt); map.set(key, [...(map.get(key) ?? []), item]); }
    return [...map.entries()];
  }, [shown, pt]);
  const ordered = groups.flatMap(([, list]) => list);
  const runFor = (item?: InboxItem) => item?.contentId ? runs.filter((run) => run.workspaceId === currentWorkspaceId && run.contentId === item.contentId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] : undefined;
  const run = runFor(selected);

  // Opening an item marks this version of it as read; a newer event on the same item shows as unread again.
  useEffect(() => { if (selected && unread(selected)) setSeen((current) => ({ ...current, [selected.id]: selected.at })); }, [selected?.id, selected?.at]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || typing(event.target) || !ordered.length) return;
      const index = Math.max(0, ordered.findIndex((item) => item.id === selected?.id));
      const key = event.key.toLowerCase();
      if (key === 'j' || key === 'arrowdown') { event.preventDefault(); setSelectedId(ordered[Math.min(ordered.length - 1, index + 1)].id); }
      else if (key === 'k' || key === 'arrowup') { event.preventDefault(); setSelectedId(ordered[Math.max(0, index - 1)].id); }
      else if (selected && key === 'a') { event.preventDefault(); selected.open(); }
      else if (selected && key === 'e') { event.preventDefault(); onArchive(selected); }
      else if (selected && key === 'h') { event.preventDefault(); onSnooze(selected); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ordered, selected, onArchive, onSnooze]);

  const kindColor = (item: InboxItem) => item.tone === 'blocked' ? 'var(--danger-text)' : item.tone === 'reply' || item.tone === 'next' ? 'var(--meta)' : 'var(--warn)';
  const filters: [Filter, string][] = [['all', pt ? 'Tudo' : 'All'], ['unread', pt ? 'Não lidas' : 'Unread'], ['action', pt ? 'Pedem ação' : 'Need action']];
  const trail = run ? [...(run.events ?? [])].filter((event) => event.at).slice(-5).reverse() : [];
  const clock = (at: string) => new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(at));

  return <div className="page v2-page v2-inbox" data-od-id="inbox-page">
    <section className="v2-inbox-list" aria-labelledby="inbox-title">
      <header className="v2-header">
        <h1 id="inbox-title">{pt ? 'Caixa de entrada' : 'Inbox'}</h1>
        {items.length > 0 && <span className="v2-count waiting">{items.length}</span>}
        <span className="v2-spacer" />
        <div className="v2-segmented" role="group" aria-label={pt ? 'Filtro' : 'Filter'}>
          {filters.map(([id, label]) => <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
        </div>
      </header>
      <div className="v2-inbox-scroll">
        {groups.length ? groups.map(([label, list]) => <div key={label} role="group" aria-label={label}>
          <p className="v2-label v2-inbox-group">{label}</p>
          {list.map((item) => <button key={item.id} type="button" className="v2-inbox-item" aria-pressed={item.id === selected?.id} onClick={() => setSelectedId(item.id)} data-inbox-item={item.id}>
            <i className={`v2-unread ${unread(item) ? 'on' : ''}`} aria-label={unread(item) ? (pt ? 'Não lida' : 'Unread') : undefined} />
            {item.agent ? <AgentAvatar name={item.agent.name} image={item.agent.avatarImage} mascot={item.agent.avatarMascot} role={item.agent.role} /> : <span className="v2-face-icon" aria-hidden="true"><Icon name={item.icon} /></span>}
            <span className="v2-inbox-copy">
              <span className="v2-inbox-line"><b className={`v2-ellipsis ${unread(item) ? 'strong' : ''}`}>{item.title}</b><span className="v2-sub">{shortAgo(item.at, locale)}</span></span>
              <span className="v2-ellipsis v2-inbox-sub">{[item.agent?.name, item.context].filter(Boolean).join(' · ')}</span>
              <span className="v2-inbox-kind" style={{ color: kindColor(item) }}><StatusIcon size={11} state={inboxToneState[item.tone]} />{inboxToneLabel(item.tone, pt)}{runFor(item) && <span className="v2-mono"> · {runLabel(runFor(item)!.id)}</span>}</span>
            </span>
          </button>)}
        </div>) : <div className="v2-empty v2-inbox-empty"><b>{filter === 'all' ? (pt ? 'Tudo em dia' : 'All caught up') : (pt ? 'Nada neste filtro' : 'Nothing in this filter')}</b><span>{pt ? 'Aprovações, escolhas, perguntas dos agentes e falhas aparecem aqui.' : 'Approvals, choices, agent questions and failures appear here.'}</span></div>}
      </div>
      <footer className="v2-inbox-keys" aria-label={pt ? 'Atalhos' : 'Shortcuts'}>
        <span><kbd>J K</kbd> {pt ? 'navegar' : 'move'}</span><span><kbd>A</kbd> {pt ? 'agir' : 'act'}</span><span><kbd>E</kbd> {pt ? 'arquivar' : 'archive'}</span><span><kbd>H</kbd> {pt ? 'adiar' : 'snooze'}</span>
      </footer>
    </section>

    <section className="v2-inbox-detail" aria-label={pt ? 'Detalhe' : 'Detail'}>
      {selected ? <>
        <header className="v2-header">
          {run && <span className="v2-mono v2-sub">{runLabel(run.id)}</span>}
          <span className="v2-sub v2-ellipsis">{selected.context}</span>
          <span className="v2-spacer" />
          <button type="button" className="v2-ghost" onClick={() => onSnooze(selected)}>{pt ? 'Adiar' : 'Snooze'} <kbd>H</kbd></button>
          <button type="button" className="v2-ghost" onClick={() => onArchive(selected)}>{pt ? 'Arquivar' : 'Archive'} <kbd>E</kbd></button>
          {run && <button type="button" className="soft-button" onClick={() => onOpenRun(run.id)}>{pt ? 'Abrir execução' : 'Open run'}</button>}
        </header>
        <div className="v2-inbox-body">
          <div className="v2-inbox-hero">
            {selected.agent ? <AgentAvatar name={selected.agent.name} image={selected.agent.avatarImage} mascot={selected.agent.avatarMascot} role={selected.agent.role} /> : <span className="v2-face-icon" aria-hidden="true"><Icon name={selected.icon} /></span>}
            <div><h2>{selected.title}</h2><span className="v2-sub">{[selected.agent?.name, inboxToneLabel(selected.tone, pt), shortAgo(selected.at, locale)].filter(Boolean).join(' · ')}</span></div>
          </div>
          {selected.tone === 'blocked' && selected.body ? <pre className="v2-error-block">{selected.body.slice(0, 1200)}</pre> : selected.body && selected.body !== selected.title && <p className="v2-inbox-text">{selected.body.slice(0, 1200)}</p>}
          {run && <dl className="v2-facts">
            <div><dt>{pt ? 'Execução' : 'Run'}</dt><dd className="v2-mono">{runLabel(run.id)}</dd></div>
            <div><dt>{pt ? 'Etapa' : 'Stage'}</dt><dd>{productionStageLabel(run.stage, pt)}</dd></div>
            <div><dt>{pt ? 'Atualizada' : 'Updated'}</dt><dd>{shortAgo(run.updatedAt, locale)}</dd></div>
          </dl>}
          <div className="v2-actions">
            <button type="button" className="primary-button" onClick={selected.open}>{selected.action} <kbd>A</kbd></button>
            {run && <button type="button" className="soft-button" onClick={() => onOpenRun(run.id)}>{pt ? 'Ver na execução' : 'See in the run'}</button>}
          </div>
          {trail.length > 0 && <section className="v2-trail" aria-label={pt ? 'Linha do tempo' : 'Timeline'}>
            <span className="v2-sub">{pt ? 'Linha do tempo' : 'Timeline'}</span>
            {trail.map((event, index) => <div key={`${event.at}-${index}`}><span className="v2-mono">{clock(event.at)}</span><span>{productionStageLabel(event.action, pt) === event.action ? event.detail || event.action : productionStageLabel(event.action, pt)}</span></div>)}
          </section>}
        </div>
      </> : <div className="v2-empty v2-inbox-empty"><b>{pt ? 'Nada selecionado' : 'Nothing selected'}</b><span>{pt ? 'Quando um agente precisar de você, o pedido aparece aqui com o contexto.' : 'When an agent needs you, the request shows here with its context.'}</span></div>}
    </section>
  </div>;
}
