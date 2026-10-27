import { useState } from 'react';
import type { Task, TaskStatus } from '../app/types';
import { useWorkspaces } from '../app/WorkspaceProvider';
import { TaskColumn } from '../components/tasks/TaskColumn';
import { useLanguage } from '../app/LanguageProvider';
import { useAgents } from '../features/agents/AgentsProvider';
import { AgentAvatar } from '../components/agents/AgentAvatar';
import { Icon } from '../components/common/Icon';

const columns: { status: TaskStatus; label: string }[] = [
  { status: 'research', label: 'Research' },
  { status: 'running', label: 'Running' },
  { status: 'review', label: 'Review' },
  { status: 'done', label: 'Done' },
];
export function Board({
  tasks,
  onOpenTask,
  onMoveTask,
  onToast,
  onAddTask,
}: {
  tasks: Task[];
  onOpenTask: (task: Task) => void;
  onMoveTask: (taskId: string, status: TaskStatus) => void;
  onToast: (message: string) => void;
  onAddTask: (status: TaskStatus) => void;
}) {
  const { currentWorkspaceId } = useWorkspaces();
  const { agents } = useAgents();
  const [agentFilter, setAgentFilter] = useState('all');
  const { t, locale } = useLanguage();
  const [query, setQuery] = useState('');
  const filtered = tasks
    .filter(
      (task) =>
        (agentFilter === 'all' || task.agentId === agentFilter) &&
        (task.title + ' ' + task.description)
          .toLocaleLowerCase(locale)
          .includes(query.trim().toLocaleLowerCase(locale)),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pt = locale === 'pt-BR';
  const workspaceAgents = agents.filter((agent) => agent.workspaceId === currentWorkspaceId);
  const review = tasks.filter((task) => task.status === 'review').length;
  const summary = pt
    ? `${tasks.length} tarefa${tasks.length === 1 ? '' : 's'}${review ? ` · ${review} esperando sua revisão` : ''}. Arraste os cartões para mudar o status.`
    : `${tasks.length} task${tasks.length === 1 ? '' : 's'}${review ? ` · ${review} awaiting your review` : ''}. Drag cards to change status.`;
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<TaskStatus | null>(null);
  const finishDrag = () => {
    setDraggingTaskId(null);
    setDropTarget(null);
  };
  const drop = (taskId: string, status: TaskStatus) => {
    const task = tasks.find((item) => item.id === taskId);
    if (task && task.status !== status) onMoveTask(taskId, status);
    finishDrag();
  };
  return (
    <div className="page board-page qb" data-od-id="task-board">
      <div className="qb-head">
        <div>
          <h1>{pt ? 'Quadro' : 'Board'}</h1>
          <p>{summary}</p>
        </div>
        <label className="search-field">
          <Icon name="search" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={pt ? 'Buscar tarefas…' : 'Search tasks…'}
            aria-label={pt ? 'Buscar tarefas' : 'Search tasks'}
          />
        </label>
        <button className="primary-button" onClick={() => onAddTask('research')}>
          <Icon name="plus" />
          {t('New Task')}
        </button>
      </div>
      {tasks.length === 0 && (
        <div className="board-guidance">
          <span className="first-use-mark">
            <Icon name="board" />
          </span>
          <div>
            <b>{t('Your task board is ready')}</b>
            <span>{t('Add a task and assign an agent. Move it across columns as the work progresses.')}</span>
          </div>
          <button className="soft-button" onClick={() => onAddTask('research')}>
            <Icon name="plus" />
            {t('Add your first task')}
          </button>
        </div>
      )}
      {/* The agents' faces are the filter. */}
      <div className="qb-faces" role="group" aria-label={pt ? 'Filtrar tarefas por agente' : 'Filter tasks by agent'} data-od-id="board-filters">
        <button aria-pressed={agentFilter === 'all'} onClick={() => setAgentFilter('all')}>{pt ? 'Todos os agentes' : 'All agents'}</button>
        {workspaceAgents.map((agent) => (
          <button key={agent.id} aria-pressed={agentFilter === agent.id} onClick={() => setAgentFilter(agentFilter === agent.id ? 'all' : agent.id)}>
            <AgentAvatar name={agent.name} image={agent.avatarImage} mascot={agent.avatarMascot} role={agent.role} />
            {agent.name}<span>{tasks.filter((task) => task.agentId === agent.id).length}</span>
          </button>
        ))}
        <span className="result-count" role="status">{filtered.length} {pt ? 'tarefas' : 'tasks'}</span>
        {(query || agentFilter !== 'all') && <button className="text-link" onClick={() => { setQuery(''); setAgentFilter('all'); }}>{pt ? 'Limpar' : 'Clear'}</button>}
      </div>
      {(query || agentFilter !== 'all') && filtered.length === 0 && (
        <p className="filter-feedback">
          {locale === 'pt-BR' ? 'Nenhuma tarefa corresponde à busca.' : 'No tasks match your search.'}
        </p>
      )}
      <div className={`board ${draggingTaskId ? 'is-dragging' : ''}`}>
        {columns.map(({ status, label }) => (
          <TaskColumn
            key={status}
            status={status}
            label={t(label)}
            tasks={filtered.filter((task) => task.status === status)}
            draggingTaskId={draggingTaskId}
            isDropTarget={dropTarget === status}
            onOpen={onOpenTask}
            onAdd={onAddTask}
            onDragStart={(taskId) => {
              setDraggingTaskId(taskId);
              setDropTarget(null);
            }}
            onDragEnd={finishDrag}
            onDragOver={setDropTarget}
            onDragLeave={(leftStatus) =>
              setDropTarget((current) => (current === leftStatus ? null : current))
            }
            onDrop={drop}
          />
        ))}
      </div>
    </div>
  );
}
