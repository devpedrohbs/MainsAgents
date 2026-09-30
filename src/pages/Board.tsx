import { useState } from 'react';
import type { Task, TaskStatus } from '../app/types';
import { useWorkspaces } from '../app/WorkspaceProvider';
import { TaskColumn } from '../components/tasks/TaskColumn';
import { useLanguage } from '../app/LanguageProvider';
import { useAgents } from '../features/agents/AgentsProvider';
import { SelectMenu } from '../components/common/SelectMenu';
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
  const { currentWorkspace, currentWorkspaceId } = useWorkspaces();
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
    <div className="page board-page" data-od-id="task-board">
      <div className="page-head">
        <div>
          <p className="eyebrow">{currentWorkspace.name}</p>
          <h1>{locale === 'pt-BR' ? 'Trabalho em andamento' : 'Work in progress'}</h1>
          <p>
            {locale === 'pt-BR'
              ? 'Organize as entregas. Arraste para mudar o status ou abra o card para editar e conversar.'
              : 'Organize deliverables. Drag to change status or open a card to edit and chat.'}
          </p>
        </div>
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
      <div className="collection-toolbar" data-od-id="board-filters">
        <label className="search-field">
          <Icon name="search" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={locale === 'pt-BR' ? 'Buscar tarefas…' : 'Search tasks…'}
            aria-label={locale === 'pt-BR' ? 'Buscar tarefas' : 'Search tasks'}
          />
        </label>
        <SelectMenu
          ariaLabel={locale === 'pt-BR' ? 'Filtrar tarefas por agente' : 'Filter tasks by agent'}
          value={agentFilter}
          onChange={setAgentFilter}
          options={[
            { value: 'all', label: locale === 'pt-BR' ? 'Todos os agentes' : 'All agents' },
            ...agents
              .filter((agent) => agent.workspaceId === currentWorkspaceId)
              .map((agent) => ({ value: agent.id, label: agent.name })),
          ]}
        />
        <span className="result-count" role="status">
          {filtered.length} {locale === 'pt-BR' ? 'tarefas' : 'tasks'}
        </span>
        {(query || agentFilter !== 'all') && (
          <button
            className="text-link"
            onClick={() => {
              setQuery('');
              setAgentFilter('all');
            }}
          >
            {locale === 'pt-BR' ? 'Limpar' : 'Clear'}
          </button>
        )}
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
