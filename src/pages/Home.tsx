import { useState } from 'react';
import type { Task, PageId } from '../app/types';
import { useChat } from '../features/chat/ChatProvider';
import { useAgents } from '../features/agents/AgentsProvider';
import { AgentStatus } from '../components/agents/AgentStatus';
import { AgentAvatar } from '../components/agents/AgentAvatar';
import { Icon } from '../components/common/Icon';
import { useWorkspaces } from '../app/WorkspaceProvider';
import { useLanguage } from '../app/LanguageProvider';

type TaskView = 'active' | 'review' | 'done';
interface HomeProps {
  tasks: Task[];
  onOpenTask: (task: Task) => void;
  onCreateAgent: () => void;
  onCreateTask: () => void;
  onSelectAgent: (id: string) => void;
  onNavigate: (page: PageId) => void;
  showEmptyPrompt: boolean;
}

export function Home({
  tasks,
  onOpenTask,
  onCreateAgent,
  onCreateTask,
  onSelectAgent,
  onNavigate,
}: HomeProps) {
  const { agents: allAgents, getAgentById } = useAgents();
  const { currentWorkspaceId, currentWorkspace } = useWorkspaces();
  const { sessions, openSession } = useChat();
  const { locale, t } = useLanguage();
  const pt = locale === 'pt-BR';
  const [taskView, setTaskView] = useState<TaskView>('active');
  const agents = allAgents.filter((agent) => agent.workspaceId === currentWorkspaceId);
  const agentIds = new Set(agents.map((agent) => agent.id));
  const recentSessions = sessions
    .filter(
      (session) => agentIds.has(session.agentId) && session.messages.some((item) => item.type === 'message'),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 3);
  const groups: Record<TaskView, Task[]> = {
    active: tasks.filter((task) => task.status === 'research' || task.status === 'running'),
    review: tasks.filter((task) => task.status === 'review'),
    done: tasks.filter((task) => task.status === 'done'),
  };
  const visibleTasks = [...groups[taskView]].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const tabs: { id: TaskView; label: string }[] = [
    { id: 'active', label: pt ? 'Em andamento' : 'In progress' },
    { id: 'review', label: pt ? 'Para revisar' : 'To review' },
    { id: 'done', label: pt ? 'Concluídas' : 'Completed' },
  ];
  const summaries = [
    {
      id: 'active' as const,
      label: pt ? 'Tarefas em andamento' : 'Tasks in progress',
      detail: pt ? 'Pesquisa e execução' : 'Research and execution',
      icon: 'board' as const,
    },
    {
      id: 'review' as const,
      label: pt ? 'Aguardando revisão' : 'Awaiting review',
      detail: pt ? 'Precisam do seu olhar' : 'Ready for your attention',
      icon: 'history' as const,
    },
    {
      id: 'done' as const,
      label: pt ? 'Tarefas concluídas' : 'Completed tasks',
      detail: pt ? 'Entregas neste workspace' : 'Deliveries in this workspace',
      icon: 'note' as const,
    },
  ];
  return (
    <div className="page overview-page" data-od-id="workspace-overview">
      <header className="page-head" data-od-id="overview-header">
        <div>
          <p className="eyebrow">
            {new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(
              new Date(),
            )}
          </p>
          <h1 data-od-id="overview-heading">{pt ? 'Visão geral' : 'Overview'}</h1>
          <p>
            {pt
              ? 'Seu trabalho, seus agentes e os próximos passos.'
              : 'Your work, your agents, and what comes next.'}
          </p>
        </div>
        <button
          className="primary-button"
          data-od-id="overview-create"
          onClick={agents.length ? onCreateTask : onCreateAgent}
        >
          <Icon name="plus" />
          {agents.length ? t('New Task') : t('Create agent')}
        </button>
      </header>
      <section
        className="summary-grid"
        aria-label={pt ? 'Resumo das tarefas' : 'Task summary'}
        data-od-id="task-summary"
      >
        {summaries.map((item) => (
          <button
            key={item.id}
            className={'summary-card summary-' + item.id}
            onClick={() => setTaskView(item.id)}
            aria-pressed={taskView === item.id}
            data-od-id={'summary-' + item.id}
          >
            <span className="summary-label">
              {item.label}
              <Icon name={item.icon} />
            </span>
            <strong>{groups[item.id].length.toLocaleString(locale)}</strong>
            <span className="summary-detail">
              {item.id === 'review' && groups.review.length > 0 ? <i className="review-dot" /> : null}
              {item.detail}
              <Icon name="chevron" />
            </span>
          </button>
        ))}
      </section>
      <div className="overview-grid">
        <section className="work-panel" data-od-id="workspace-tasks" aria-labelledby="tasks-heading">
          <div className="panel-heading">
            <h2 id="tasks-heading">{pt ? 'Suas tarefas' : 'Your tasks'}</h2>
            <button className="text-link" onClick={() => onNavigate('board')} data-od-id="open-task-board">
              {pt ? 'Abrir quadro' : 'Open board'}
              <Icon name="chevron" />
            </button>
          </div>
          <div
            className="task-view-tabs"
            role="group"
            aria-label={pt ? 'Filtrar tarefas por status' : 'Filter tasks by status'}
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                aria-pressed={taskView === tab.id}
                className={taskView === tab.id ? 'selected' : ''}
                onClick={() => setTaskView(tab.id)}
                data-od-id={'task-filter-' + tab.id}
              >
                {tab.label}
                <span>{groups[tab.id].length}</span>
              </button>
            ))}
          </div>
          <div className="overview-task-list" aria-live="polite">
            {visibleTasks.length ? (
              visibleTasks.slice(0, 6).map((task) => {
                const agent = getAgentById(task.agentId);
                return (
                  <button
                    className="overview-task-row"
                    key={task.id}
                    onClick={() => onOpenTask(task)}
                    data-od-id={'overview-task-' + task.id}
                  >
                    <AgentAvatar name={agent?.name ?? t('Deleted agent')} image={agent?.avatarImage} />
                    <span className="overview-task-copy">
                      <b>{task.title}</b>
                      <span>
                        {agent?.name ?? t('Deleted agent')} ·{' '}
                        {new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(
                          new Date(task.createdAt),
                        )}
                      </span>
                    </span>
                    <AgentStatus status={task.status} />
                    <Icon name="chevron" />
                  </button>
                );
              })
            ) : (
              <div className="workspace-empty">
                <span className="empty-symbol">
                  <Icon name={taskView === 'review' ? 'history' : taskView === 'done' ? 'note' : 'board'} />
                </span>
                <h3>
                  {taskView === 'review'
                    ? pt
                      ? 'Tudo em dia por aqui'
                      : 'You’re all caught up'
                    : taskView === 'done'
                      ? pt
                        ? 'Suas entregas ficam aqui'
                        : 'A home for your completed work'
                      : pt
                        ? 'Qual é o próximo passo?'
                        : 'What’s next?'}
                </h3>
                <p>
                  {taskView === 'review'
                    ? pt
                      ? 'Quando uma tarefa precisar de revisão, ela aparecerá aqui.'
                      : 'Tasks that need your review will appear here.'
                    : taskView === 'done'
                      ? pt
                        ? 'Conclua uma tarefa no quadro para acompanhar suas entregas.'
                        : 'Complete a task on the board to keep track of your results.'
                      : agents.length
                        ? pt
                          ? 'Crie uma tarefa, escolha o agente e acompanhe o trabalho.'
                          : 'Create a task, choose an agent, and follow the work.'
                        : pt
                          ? 'Comece com um agente para pesquisar, organizar ideias ou criar conteúdo.'
                          : 'Start with an agent to research, organize ideas, or create content.'}
                </p>
                {taskView === 'active' && (
                  <button className="soft-button" onClick={agents.length ? onCreateTask : onCreateAgent}>
                    <Icon name="plus" />
                    {agents.length ? t('New Task') : t('Create your first agent')}
                  </button>
                )}
              </div>
            )}
          </div>
          {visibleTasks.length > 6 && (
            <button className="panel-footer-action" onClick={() => onNavigate('board')}>
              {pt ? 'Ver todas as tarefas no quadro' : 'View all tasks on the board'}
              <Icon name="chevron" />
            </button>
          )}
        </section>
        <aside className="overview-side" data-od-id="workspace-team">
          <section className="team-panel" data-od-id="team-panel">
            <div className="panel-heading">
              <h2>{t('Your team')}</h2>
              <span className="neutral-count">{agents.length}</span>
            </div>
            {agents.length ? (
              <div className="team-list">
                {agents.slice(0, 4).map((agent) => (
                  <button
                    className="team-row"
                    key={agent.id}
                    onClick={() => onSelectAgent(agent.id)}
                    data-od-id={'team-agent-' + agent.id}
                  >
                    <AgentAvatar name={agent.name} image={agent.avatarImage} />
                    <span>
                      <b>{agent.name}</b>
                      <small>{agent.role}</small>
                    </span>
                    <Icon name="message" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="team-empty">
                <p>
                  {pt
                    ? 'Um especialista para cada parte do trabalho.'
                    : 'A specialist for every part of your work.'}
                </p>
                <span>
                  {pt
                    ? 'Defina a função e reúna o contexto que cada agente precisa.'
                    : 'Define a role and gather the context each agent needs.'}
                </span>
              </div>
            )}
            <button
              className="panel-footer-action"
              onClick={agents.length ? () => onNavigate('agents') : onCreateAgent}
            >
              {agents.length ? (pt ? 'Gerenciar equipe' : 'Manage team') : t('Create agent')}
              <Icon name={agents.length ? 'chevron' : 'plus'} />
            </button>
          </section>
          {recentSessions.length > 0 && (
            <section className="team-panel recent-conversations">
              <div className="panel-heading">
                <h2>{pt ? 'Continuar conversas' : 'Continue conversations'}</h2>
              </div>
              {recentSessions.map((session) => (
                <button
                  className="recent-conversation"
                  key={session.id}
                  onClick={() => {
                    openSession(session.agentId, session.id);
                    onSelectAgent(session.agentId);
                  }}
                >
                  <Icon name="message" />
                  <span>
                    <b>{session.title}</b>
                    <small>{getAgentById(session.agentId)?.name}</small>
                  </span>
                  <Icon name="chevron" />
                </button>
              ))}
              <button className="panel-footer-action" onClick={() => onNavigate('sessions')}>
                {pt ? 'Ver histórico' : 'View history'}
                <Icon name="chevron" />
              </button>
            </section>
          )}
          <section className="canvas-shortcut" data-od-id="canvas-shortcut">
            <span className="canvas-shortcut-mark">
              <Icon name="canvas" />
            </span>
            <h2>{pt ? 'Dê espaço às ideias' : 'Give your ideas room'}</h2>
            <p>
              {pt
                ? 'Conecte notas, pesquisas e respostas dos agentes no mesmo canvas.'
                : 'Connect notes, research, and agent responses on the same canvas.'}
            </p>
            <button
              className="soft-button"
              onClick={() => onNavigate('canvas')}
              data-od-id="overview-open-canvas"
            >
              {t('Open Canvas')}
              <Icon name="chevron" />
            </button>
          </section>
        </aside>
      </div>
      <footer className="overview-footer" data-od-id="overview-footer">
        <span>
          <Icon name="folder" />
          {currentWorkspace.name}
        </span>
        <span>{pt ? 'Um espaço para pensar e fazer.' : 'A space to think and make.'}</span>
      </footer>
    </div>
  );
}
