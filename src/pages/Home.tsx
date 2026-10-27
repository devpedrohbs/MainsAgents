import { useState } from 'react';
import type { Task, PageId } from '../app/types';
import { useChat } from '../features/chat/ChatProvider';
import { useAgents } from '../features/agents/AgentsProvider';
import type { Agent } from '../features/agents/model/Agent';
import { AgentAvatar } from '../components/agents/AgentAvatar';
import { Icon } from '../components/common/Icon';
import { useWorkspaces } from '../app/WorkspaceProvider';
import { useLanguage } from '../app/LanguageProvider';
import { useContentWorkflow } from '../features/content/ContentWorkflowProvider';
import { editorialInbox, type EditorialInboxItem } from '../features/content/editorialInbox';
import { editorialInboxLabel } from '../components/content/EditorialInbox';
import type {ChatInboxItem} from '../features/chat/chatInbox';
import {useChatInboxState} from '../features/chat/chatInboxState';
import {pipelineColumnIds,pipelineColumnLabel,projectHomePipeline,type PipelineItem} from '../features/content/homePipeline';
import {useProduction} from '../features/production/ProductionProvider';
import {ExecutionOverview} from '../components/production/ExecutionOverview';
import type {ExecutionOverviewItem} from '../components/production/ExecutionOverviewProjection';
import {usePersistentState} from '../data/localPersistence';

type TaskView = 'active' | 'review' | 'done';
interface HomeProps {
  tasks: Task[];
  onOpenTask: (task: Task) => void;
  onCreateAgent: () => void;
  onCreateTask: () => void;
  onSelectAgent: (id: string) => void;
  onNavigate: (page: PageId) => void;
  onOpenEditorial: (item: EditorialInboxItem) => void;
  chatInbox:ChatInboxItem[];
  onOpenChatInbox:(item:ChatInboxItem)=>void;
  showEmptyPrompt: boolean;
  onOpenExecution: (item: ExecutionOverviewItem) => void;
  onOpenExecutionChat: (item: ExecutionOverviewItem) => void;
}

const busyStates = ['thinking', 'searching', 'using-tool'];
type NeedTone = 'blocked' | 'review' | 'reply' | 'approval' | 'next';
/** One row of "Precisa de você": everything that waits on the user, whatever produced it. */
interface Need { id: string; tone: NeedTone; title: string; context: string; at: string; agent?: Agent; icon: 'script' | 'note' | 'history' | 'message' | 'board'; action: string; open: () => void; data: Record<string, string> }
const toneRank: Record<NeedTone, number> = { blocked: 0, approval: 1, review: 2, reply: 3, next: 4 };

export function Home({
  tasks,
  onOpenTask,
  onCreateAgent,
  onCreateTask,
  onSelectAgent,
  onNavigate,
  onOpenEditorial,
  chatInbox,onOpenChatInbox,
  onOpenExecution, onOpenExecutionChat,
}: HomeProps) {
  const { agents: allAgents, getAgentById } = useAgents();
  const { runs: productionRuns } = useProduction();
  const { currentWorkspaceId } = useWorkspaces();
  const { sessions, getRunState } = useChat();
  const { locale, t } = useLanguage();
  const { state, jobs, ready, storageError, jobsError } = useContentWorkflow();
  const [inboxPrefs, setInboxPrefs] = useChatInboxState();
  const [expanded, setExpanded] = useState(false);
  const pt = locale === 'pt-BR';
  const agents = allAgents.filter((agent) => agent.workspaceId === currentWorkspaceId);
  const agentIds = new Set(agents.map((agent) => agent.id));
  const workspaceSessions = sessions.filter((session) => agentIds.has(session.agentId));
  const groups: Record<TaskView, Task[]> = {
    active: tasks.filter((task) => task.status === 'research' || task.status === 'running'),
    review: tasks.filter((task) => task.status === 'review'),
    done: tasks.filter((task) => task.status === 'done'),
  };

  const ago = (at: string) => {
    const minutes = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60000));
    if (!Number.isFinite(minutes)) return '';
    if (minutes < 1) return pt ? 'agora' : 'now';
    if (minutes < 60) return pt ? `há ${minutes} min` : `${minutes} min ago`;
    if (minutes < 1440) return pt ? `há ${Math.round(minutes / 60)} h` : `${Math.round(minutes / 60)} h ago`;
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(new Date(at));
  };
  // The agent that worked on a content most recently (editorial items carry no agent of their own).
  const agentForContent = (contentId?: string) => {
    if (!contentId) return undefined;
    const session = workspaceSessions.filter((item) => item.contentId === contentId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    return session ? getAgentById(session.agentId) : undefined;
  };
  const busySession = (agentId: string) => workspaceSessions.find((session) => session.agentId === agentId && busyStates.includes(getRunState(session.id)));

  const needs: Need[] = [
    ...editorialInbox(state, jobs, currentWorkspaceId).map((item): Need => ({
      id: 'editorial:' + item.id,
      tone: item.urgency === 'blocked' ? 'blocked' : item.urgency === 'review' ? 'review' : 'next',
      title: editorialInboxLabel(item.kind, pt) + (item.artifactVersion ? ` · v${item.artifactVersion}` : ''),
      context: [item.title, item.detail].filter(Boolean).join(' · '),
      at: item.updatedAt, agent: agentForContent(item.contentId),
      icon: item.urgency === 'blocked' ? 'history' : item.kind.includes('script') ? 'script' : 'note',
      action: item.urgency === 'blocked' ? (pt ? 'Retomar' : 'Resume') : item.urgency === 'review' ? (pt ? 'Revisar' : 'Review') : (pt ? 'Continuar' : 'Continue'),
      open: () => onOpenEditorial(item), data: { 'data-inbox-id': item.id },
    })),
    ...chatInbox.map((item): Need => ({
      id: 'chat:' + item.id,
      tone: item.kind === 'approval' ? 'approval' : item.kind === 'blocked' ? 'blocked' : 'reply',
      title: item.detail.split('\n')[0] || item.title,
      context: item.title, at: item.at, agent: getAgentById(item.agentId), icon: 'message',
      action: item.kind === 'approval' ? (pt ? 'Autorizar' : 'Approve') : item.kind === 'blocked' ? (pt ? 'Verificar' : 'Check') : (pt ? 'Abrir' : 'Open'),
      open: () => onOpenChatInbox(item), data: { 'data-chat-inbox-id': item.id },
    })),
    ...groups.review.map((task): Need => ({
      id: 'task:' + task.id, tone: 'review', title: task.title, context: pt ? 'Tarefa' : 'Task', at: task.createdAt,
      agent: getAgentById(task.agentId), icon: 'board', action: pt ? 'Revisar' : 'Review',
      open: () => onOpenTask(task), data: { 'data-od-id': 'overview-task-' + task.id },
    })),
  ].sort((a, b) => toneRank[a.tone] - toneRank[b.tone] || b.at.localeCompare(a.at));
  const toneLabel: Record<NeedTone, string> = pt
    ? { blocked: 'Bloqueado', approval: 'Autorização', review: 'Revisão', reply: 'Resposta', next: 'Próximo passo' }
    : { blocked: 'Blocked', approval: 'Approval', review: 'Review', reply: 'Reply', next: 'Next step' };
  const shownNeeds = expanded ? needs : needs.slice(0, 5);

  // Production: one row per content or idea, placed on the 8 stages by the same projection the Studio uses; furthest along first.
  const projection = projectHomePipeline({ contents: state.contents, topics: state.topics, runs: productionRuns, workspaceId: currentWorkspaceId });
  const production = pipelineColumnIds.flatMap((column) => projection[column].map((item) => ({ column, item }))).reverse();
  const facesFor = (item: PipelineItem) => {
    const ids = [...new Set(workspaceSessions.filter((session) => item.contentId ? session.contentId === item.contentId : !!item.topicId && session.topicId === item.topicId).map((session) => session.agentId))];
    return ids.map((id) => getAgentById(id)).filter((agent): agent is Agent => !!agent);
  };
  // Every Studio entry here names its view, so a calendar left open last time never hijacks "Open Studio".
  const [, setStudioView] = usePersistentState<'studio' | 'calendar'>('studio-view', 'studio');
  const openStudio = (view: 'studio' | 'calendar') => { setStudioView(view); onNavigate('content'); };
  const openProduction = (item: PipelineItem) => { openStudio('studio'); window.dispatchEvent(new CustomEvent('mainsagents:open-content', { detail: { contentId: item.contentId, topicId: item.topicId } })); };
  const hasRuns = productionRuns.some((run) => run.workspaceId === currentWorkspaceId);
  // Continue: the work in progress touched most recently, offered when nothing waits on the user. Scheduled and published work is finished here.
  const touchedAt = (item: PipelineItem) => state.contents.find((content) => content.id === item.contentId)?.updatedAt ?? state.topics.find((topic) => topic.id === item.topicId)?.updatedAt ?? '';
  const resume = production.filter(({ column }) => column !== 'schedule' && column !== 'published').sort((a, b) => touchedAt(b.item).localeCompare(touchedAt(a.item)))[0];

  // Where to start: the three steps every new workspace goes through, each done by real data, never by a click here.
  // Hiding is remembered per workspace, so a new empty workspace still shows its guide.
  const [startHidden, setStartHidden] = usePersistentState<boolean>(`overview-start-hidden:${currentWorkspaceId}`, false);
  const startSteps = [
    { id: 'team', done: agents.length > 0, title: pt ? 'Monte a equipe' : 'Build the team', detail: pt ? 'Crie um agente com um papel claro, como pesquisa ou roteiro.' : 'Create an agent with a clear role, such as research or scripting.', action: t('Create agent'), run: onCreateAgent },
    { id: 'idea', done: state.topics.some((topic) => topic.workspaceId === currentWorkspaceId) || state.contents.some((content) => content.workspaceId === currentWorkspaceId), title: pt ? 'Crie a primeira pauta' : 'Create the first idea', detail: pt ? 'No Estúdio, descreva o assunto. O agente pesquisa e traz fontes e ângulos.' : 'In the Studio, describe the subject. The agent researches it and brings sources and angles.', action: pt ? 'Abrir Estúdio' : 'Open Studio', run: () => openStudio('studio') },
    { id: 'schedule', done: (state.publications ?? []).some((item) => item.workspaceId === currentWorkspaceId && !!item.plannedAt), title: pt ? 'Agende a publicação' : 'Schedule the post', detail: pt ? 'Com o conteúdo aprovado, escolha data e rede no Calendário.' : 'Once the content is approved, pick a date and channel in the Calendar.', action: pt ? 'Abrir Calendário' : 'Open Calendar', run: () => openStudio('calendar') },
  ];
  const startCurrent = startSteps.findIndex((step) => !step.done);
  const showStart = ready && !startHidden && startCurrent >= 0;
  // Real pending items come first: with any, the guide moves below them and gives up the primary action.
  const startFirst = needs.length === 0;
  const startGuide = <section className="ov-card ov-start" aria-labelledby="start-heading" data-od-id="overview-start">
    <div className="ov-card-head">
      <h2 id="start-heading">{pt ? 'Por onde começar' : 'Where to start'}<span className="ov-sub">{pt ? `${startSteps.filter((step) => step.done).length} de ${startSteps.length}` : `${startSteps.filter((step) => step.done).length} of ${startSteps.length}`}</span></h2>
      <button className="text-link" onClick={() => setStartHidden(true)}>{pt ? 'Ocultar guia' : 'Hide guide'}</button>
    </div>
    <ol className="ov-start-steps">{startSteps.map((step, index) => (
      <li key={step.id} className={step.done ? 'done' : index === startCurrent ? 'current' : ''} data-step={step.id}>
        <span className="ov-start-mark" aria-hidden="true">{step.done ? <svg viewBox="0 0 24 24"><path d="M6 12.5l4 4 8-9" /></svg> : index + 1}</span>
        <span className="ov-row-copy"><b>{step.title}</b><small>{step.done ? (pt ? 'Feito' : 'Done') : step.detail}</small></span>
        {index === startCurrent && <button type="button" className={startFirst ? 'primary-button' : 'soft-button'} onClick={step.run} data-od-id={`overview-start-${step.id}`}>{step.action}</button>}
      </li>
    ))}</ol>
  </section>;

  const working = agents.filter((agent) => busySession(agent.id)).length;
  const hour = new Date().getHours();
  const greeting = pt ? (hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite') : (hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening');
  const summary = [
    working ? (pt ? `${working} agente${working === 1 ? '' : 's'} trabalhando agora` : `${working} agent${working === 1 ? '' : 's'} working now`) : (pt ? 'Ninguém trabalhando agora' : 'Nobody working right now'),
    needs.length ? (pt ? `${needs.length} ${needs.length === 1 ? 'coisa esperando' : 'coisas esperando'} você` : `${needs.length} waiting on you`) : (pt ? 'nada esperando você' : 'nothing waiting on you'),
  ].join(' · ') + '.';
  const idleLine = (agent: Agent) => {
    const last = workspaceSessions.filter((session) => session.agentId === agent.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    return last ? (pt ? `Livre · ativo ${ago(last.updatedAt)}` : `Free · active ${ago(last.updatedAt)}`) : (pt ? 'Livre' : 'Free');
  };
  const providerName = (agent: Agent) => agent.providerId === 'claude' ? 'Claude' : agent.providerId === 'gemini' ? 'Gemini' : 'Codex';

  return (
    <div className="page overview-page ov" data-od-id="workspace-overview">
      <header className="ov-head" data-od-id="overview-header">
        <div>
          <p className="ov-date">{new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</p>
          <h1 data-od-id="overview-heading">{greeting}</h1>
          <p className="ov-lede">{summary}</p>
        </div>
        <div className="ov-head-side">
          {agents.length > 0 && <button className="ov-team-pill" onClick={() => onNavigate('agents')} aria-label={pt ? 'Abrir equipe' : 'Open team'}>
            <span className="ov-faces">{agents.slice(0, 5).map((agent) => <AgentAvatar key={agent.id} name={agent.name} image={agent.avatarImage} mascot={agent.avatarMascot} role={agent.role} thinking={!!busySession(agent.id)} />)}</span>
            <span>{working ? (pt ? `${working} de ${agents.length} trabalhando` : `${working} of ${agents.length} working`) : (pt ? `${agents.length} agente${agents.length === 1 ? '' : 's'} livre${agents.length === 1 ? '' : 's'}` : `${agents.length} free`)}</span>
          </button>}
          {ready && startHidden && startCurrent >= 0 && <button className="text-link" onClick={() => setStartHidden(false)} data-od-id="overview-start-show">{pt ? 'Por onde começar' : 'Where to start'}</button>}
          {/* While the guide is open its current step is the one primary action on the page. */}
          <button className={showStart && startFirst ? 'soft-button' : 'primary-button'} data-od-id="overview-create" onClick={agents.length ? onCreateTask : onCreateAgent}>
            <Icon name="plus" />
            {agents.length ? t('New Task') : t('Create agent')}
          </button>
        </div>
      </header>

      <div className="ov-grid">
        <div className="ov-main">
          {showStart && startFirst && startGuide}
          <section className="ov-card ov-needs" aria-labelledby="needs-heading" data-od-id="overview-needs">
            <div className="ov-card-head">
              <h2 id="needs-heading">{pt ? 'Precisa de você' : 'Needs you'}{ready && needs.length > 0 && <span className="ov-needs-count">{needs.length}</span>}</h2>
              <button className="text-link" aria-pressed={!inboxPrefs.muted} onClick={() => setInboxPrefs((current) => ({ ...current, muted: !current.muted }))}>
                {inboxPrefs.muted ? (pt ? 'Ativar avisos' : 'Enable notifications') : (pt ? 'Silenciar avisos' : 'Mute notifications')}
              </button>
            </div>
            {(storageError || jobsError) && <div className="ov-alert" role="alert"><b>{pt ? 'Não foi possível atualizar todas as pendências' : 'Could not refresh all next steps'}</b><span>{storageError || jobsError}</span></div>}
            {!ready ? <p className="ov-empty" role="status">{pt ? 'Carregando suas pendências…' : 'Loading your next steps…'}</p> : needs.length ? <div className="ov-list">
              {shownNeeds.map((need) => (
                <button key={need.id} className={`ov-row inbox-row ov-need ${need.tone}`} onClick={need.open} {...need.data}>
                  {need.agent ? <AgentAvatar name={need.agent.name} image={need.agent.avatarImage} mascot={need.agent.avatarMascot} role={need.agent.role} /> : <span className="ov-need-icon" aria-hidden="true"><Icon name={need.icon} /></span>}
                  <span className="ov-row-copy">
                    <b>{need.title}</b>
                    <small>{[need.agent?.name, need.context, ago(need.at)].filter(Boolean).join(' · ')}</small>
                  </span>
                  <span className={`ov-tone ${need.tone}`}>{toneLabel[need.tone]}</span>
                  <span className="ov-action">{need.action}</span>
                </button>
              ))}
            </div> : <div className="ov-empty"><b>{pt ? 'Tudo em dia' : 'All caught up'}</b><span>{pt ? 'Revisões, respostas dos agentes e escolhas aparecem aqui.' : 'Reviews, agent replies and choices appear here.'}</span>
              {resume && <button className="ov-row ov-resume" onClick={() => openProduction(resume.item)} data-od-id="overview-resume">
                <span className="ov-need-icon" aria-hidden="true"><Icon name="script" /></span>
                <span className="ov-row-copy"><small>{pt ? 'Continuar de onde parou' : 'Pick up where you left off'}</small><b>{resume.item.title}</b></span>
                <span className="ov-action">{pt ? 'Continuar' : 'Continue'}</span>
              </button>}
            </div>}
            {needs.length > 5 && <button className="ov-more" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? (pt ? 'Mostrar menos' : 'Show less') : (pt ? `Ver todas (${needs.length})` : `View all (${needs.length})`)}</button>}
          </section>
          {showStart && !startFirst && startGuide}

          <section className="ov-card ov-production" aria-labelledby="production-heading" data-od-id="overview-production">
            <div className="ov-card-head">
              <h2 id="production-heading">{pt ? 'Em produção' : 'In production'}<span className="ov-sub">{production.length} {pt ? (production.length === 1 ? 'item' : 'itens') : (production.length === 1 ? 'item' : 'items')}</span></h2>
              <button className="text-link" onClick={() => openStudio('studio')}>{pt ? 'Abrir Estúdio' : 'Open Studio'}<Icon name="chevron" /></button>
            </div>
            {production.length ? <>
              <div className="ov-prod-labels" aria-hidden="true"><span>{pt ? 'Conteúdo' : 'Content'}</span><span>{pipelineColumnLabel('ideas', pt)} → {pipelineColumnLabel('published', pt)}</span><span /></div>
              <div className="ov-list">{production.map(({ column, item }) => {
                const step = pipelineColumnIds.indexOf(column) + 1, faces = facesFor(item);
                return <button key={item.id} className="ov-row ov-prod-row" data-column={column} onClick={() => openProduction(item)} title={item.title}>
                  <span className="ov-row-copy"><b className="ov-prod-title">{item.title}</b><small className="ov-prod-stage">{pipelineColumnLabel(column, pt)} · {pt ? `etapa ${step} de 8` : `stage ${step} of 8`}</small></span>
                  <span className="ov-bars" role="img" aria-label={pt ? `Etapa ${step} de 8` : `Stage ${step} of 8`}>{pipelineColumnIds.map((id, index) => <i key={id} className={index + 1 < step ? 'done' : index + 1 === step ? 'current' : ''} />)}</span>
                  <span className="ov-faces">{faces.slice(0, 3).map((agent) => <AgentAvatar key={agent.id} name={agent.name} image={agent.avatarImage} mascot={agent.avatarMascot} role={agent.role} thinking={!!busySession(agent.id)} />)}</span>
                </button>;
              })}</div>
            </> : <div className="ov-empty"><b>{pt ? 'Nada em produção' : 'Nothing in production'}</b><span>{pt ? 'Crie uma pauta no Estúdio para começar.' : 'Create an idea in the Studio to get started.'}</span><button className="soft-button" onClick={() => openStudio('studio')}><Icon name="plus" />{pt ? 'Abrir Estúdio' : 'Open Studio'}</button></div>}
          </section>

          {hasRuns && <ExecutionOverview onOpen={onOpenExecution} onOpenChat={onOpenExecutionChat} />}
        </div>

        <aside className="ov-side" data-od-id="workspace-team">
          <section className="ov-card ov-now" aria-labelledby="now-heading" data-od-id="team-panel">
            <div className="ov-card-head">
              <h2 id="now-heading">{pt ? 'Agora' : 'Now'}{working > 0 && <i className="ov-live" aria-hidden="true" />}</h2>
              <button className="text-link" onClick={agents.length ? () => onNavigate('agents') : onCreateAgent}>{agents.length ? (pt ? 'Equipe' : 'Team') : t('Create agent')}<Icon name="chevron" /></button>
            </div>
            {agents.length ? <div className="ov-list">{agents.map((agent) => {
              const busy = busySession(agent.id);
              return <button className={`ov-row ov-agent ${busy ? 'busy' : ''}`} key={agent.id} onClick={() => onSelectAgent(agent.id)} data-od-id={'team-agent-' + agent.id}>
                <AgentAvatar name={agent.name} image={agent.avatarImage} mascot={agent.avatarMascot} role={agent.role} thinking={!!busy} />
                <span className="ov-row-copy"><b>{agent.name}</b><small className={busy ? 'ov-shimmer' : ''}>{busy ? `${pt ? 'Pensando…' : 'Thinking…'} ${busy.title}` : idleLine(agent)}</small></span>
                <span className="ov-provider">{providerName(agent)}</span>
              </button>;
            })}</div> : <div className="ov-empty"><span>{pt ? 'Um especialista para cada parte do trabalho.' : 'A specialist for every part of your work.'}</span></div>}
          </section>

          <section className="ov-card ov-tasks" aria-labelledby="tasks-heading" data-od-id="workspace-tasks">
            <div className="ov-card-head">
              <h2 id="tasks-heading">{pt ? 'Tarefas' : 'Tasks'}</h2>
              <button className="text-link" onClick={() => onNavigate('board')} data-od-id="open-task-board">{pt ? 'Quadro' : 'Board'}<Icon name="chevron" /></button>
            </div>
            <div className="ov-task-stats">
              {(['active', 'review', 'done'] as const).map((view) => <button key={view} className={view} onClick={() => onNavigate('board')} data-od-id={'summary-' + view}>
                <b>{groups[view].length.toLocaleString(locale)}</b>
                <span>{view === 'active' ? (pt ? 'Em andamento' : 'In progress') : view === 'review' ? (pt ? 'Para revisar' : 'To review') : (pt ? 'Concluídas' : 'Completed')}</span>
              </button>)}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
