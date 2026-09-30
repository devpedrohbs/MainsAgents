import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Agent } from '../../features/agents/model/Agent';
import type { Task, TaskStatus } from '../../app/types';
import { Icon } from '../common/Icon';
import { useLanguage } from '../../app/LanguageProvider';
import { SelectMenu } from '../common/SelectMenu';

export interface TaskDraft {
  title: string;
  description: string;
  agentId: string;
  status: TaskStatus;
}

export function TaskEditorDialog({
  agents,
  task,
  initialAgentId,
  initialStatus = 'research',
  onClose,
  onSave,
  onDelete,
  onOpenChat,
}: {
  agents: readonly Agent[];
  task?: Task;
  initialAgentId?: string;
  initialStatus?: TaskStatus;
  onClose: () => void;
  onSave: (draft: TaskDraft) => void;
  onDelete?: () => void;
  onOpenChat?: (draft: TaskDraft) => void;
}) {
  const { locale, t, focusMode } = useLanguage();
  const draftKey = `mainsagents:task-draft:${task?.id ?? 'new'}`;
  const saved = useRef<Partial<TaskDraft>>(
    (() => {
      try {
        return JSON.parse(sessionStorage.getItem(draftKey) ?? '{}');
      } catch {
        return {};
      }
    })(),
  );
  const [title, setTitle] = useState(saved.current.title ?? task?.title ?? '');
  const [description, setDescription] = useState(saved.current.description ?? task?.description ?? '');
  const [agentId, setAgentId] = useState(
    saved.current.agentId ?? task?.agentId ?? initialAgentId ?? agents[0]?.id ?? '',
  );
  const [status, setStatus] = useState<TaskStatus>(saved.current.status ?? task?.status ?? initialStatus);
  const [error, setError] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  const originRef = useRef<HTMLElement | null>(document.activeElement as HTMLElement);
  const dirty =
    title !== (task?.title ?? '') ||
    description !== (task?.description ?? '') ||
    agentId !== (task?.agentId ?? initialAgentId ?? agents[0]?.id ?? '') ||
    status !== (task?.status ?? initialStatus);
  const close = () => {
    if (
      dirty &&
      !window.confirm(
        locale === 'pt-BR'
          ? 'Fechar e guardar este rascunho para continuar depois?'
          : 'Close and keep this draft for later?',
      )
    )
      return;
    onClose();
    requestAnimationFrame(() => originRef.current?.focus());
  };
  useEffect(() => {
    if (dirty) sessionStorage.setItem(draftKey, JSON.stringify({ title, description, agentId, status }));
  }, [agentId, description, dirty, draftKey, status, title]);

  useEffect(() => {
    requestAnimationFrame(() => titleRef.current?.focus());
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setError(locale === 'pt-BR' ? 'Informe um título para a tarefa.' : 'Enter a task title.');
      return;
    }
    if (!agentId) {
      setError(t('Choose an agent'));
      return;
    }
    sessionStorage.removeItem(draftKey);
    onSave({ title: title.trim(), description: description.trim(), agentId, status });
  };

  return (
    <div
      className="drawer-backdrop task-dialog-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <section
        className={`task-editor-dialog ${focusMode ? 'focus-writing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-editor-title"
      >
        <header className="drawer-head">
          <div className="drawer-identity">
            <span className="agent-monogram">
              <Icon name="board" />
            </span>
            <div>
              <p>{t(task ? 'Task details' : 'New Task')}</p>
              <h2 id="task-editor-title">{t(task ? 'Edit task' : 'Create task')}</h2>
            </div>
          </div>
          <button className="icon-button" type="button" aria-label={t('Close')} onClick={close}>
            ×
          </button>
        </header>
        <form onSubmit={submit}>
          <div className="task-dialog-content">
            <label className="field">
              <span>{t('Task title')} *</span>
              <input
                ref={titleRef}
                required
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setError('');
                }}
                placeholder={
                  locale === 'pt-BR'
                    ? 'Ex.: Pesquisar tendências para o próximo vídeo'
                    : 'e.g. Research trends for the next video'
                }
              />
            </label>
            <label className="field">
              <span>{t('Description')}</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={5}
                placeholder={
                  locale === 'pt-BR'
                    ? 'Explique o resultado esperado e qualquer contexto útil.'
                    : 'Explain the expected outcome and any useful context.'
                }
              />
              <small>
                {locale === 'pt-BR'
                  ? 'Salvar organiza a tarefa. Abra a conversa para pedir a execução ao agente.'
                  : 'Saving organizes the task. Open the conversation to ask the agent to carry it out.'}
              </small>
            </label>
            <div className="field">
              <span>{t('Choose an agent')}</span>
              <SelectMenu
                className="field-select"
                value={agentId}
                onChange={setAgentId}
                ariaLabel={t('Choose an agent')}
                options={agents.map((agent) => ({ value: agent.id, label: `${agent.name} · ${agent.role}` }))}
              />
            </div>
            <div className="field">
              <span>{t('Status')}</span>
              <SelectMenu
                className="field-select"
                value={status}
                onChange={(value) => setStatus(value as TaskStatus)}
                ariaLabel={t('Status')}
                options={[
                  { value: 'research', label: t('Research') },
                  { value: 'running', label: t('Running') },
                  { value: 'review', label: t('Review') },
                  { value: 'done', label: t('Done') },
                ]}
              />
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <footer className="drawer-footer">
            {task && onDelete && (
              <button className="danger-button" type="button" onClick={onDelete}>
                {t('Delete')}
              </button>
            )}
            {task && onOpenChat && (
              <button
                className="soft-button"
                type="button"
                disabled={!title.trim() || !agents.some((agent) => agent.id === agentId)}
                onClick={() =>
                  onOpenChat({ title: title.trim(), description: description.trim(), agentId, status })
                }
              >
                {t('Open agent chat')}
              </button>
            )}
            <button className="soft-button" type="button" onClick={close}>
              {t('Cancel')}
            </button>
            <button className="primary-button" type="submit">
              <Icon name="plus" />
              {t(task ? 'Save changes' : 'Create task')}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
