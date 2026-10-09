import { useEffect, useRef, useState } from 'react';
import type { Task, TaskStatus } from './types';
import { useHashRouter } from './useHashRouter';
import { useAgents } from '../features/agents/AgentsProvider';
import type { AgentEditorValues, AgentId } from '../features/agents/model/Agent';
import { AppShell } from '../components/layout/AppShell';
import { CommandPalette } from '../components/command/CommandPalette';
import { AgentEditorDrawer } from '../components/agents/AgentEditorDrawer';
import { AgentChooser } from '../components/agents/AgentChooser';
import { QuickCreate } from '../components/layout/QuickCreate';
import { readChatDraft, writeChatDraft } from '../features/chat/chatDrafts';
import { Home } from '../pages/Home';
import { ContentStudio } from '../pages/ContentStudio';
import { Board } from '../pages/Board';
import { Canvas } from '../pages/Canvas';
import { Flow } from '../pages/Flow';
import { Agents } from '../pages/Agents';
import { AgentSettings } from '../pages/AgentSettings';
import { Sessions } from '../pages/Sessions';
import { Settings } from '../pages/Settings';
import { useCanvas } from '../components/canvas/CanvasProvider';
import { useWorkspaces } from './WorkspaceProvider';
import { useChat } from '../features/chat/ChatProvider';
import { usePersistentState, updatePersistentValue } from '../data/localPersistence';
import { useLanguage } from './LanguageProvider';
import { TaskEditorDialog, type TaskDraft } from '../components/tasks/TaskEditorDialog';
import { WelcomeGuide } from '../components/onboarding/WelcomeGuide';
import { agentTemplates, localizeTemplate } from '../features/agents/agentTemplates';
import { useContentWorkflow } from '../features/content/ContentWorkflowProvider';
import { editorialInbox, type EditorialInboxItem } from '../features/content/editorialInbox';
import {useChatInbox} from '../features/chat/useChatInbox';
import {AgentComparisonView} from '../components/chat/AgentComparisonView';
import {useProduction} from '../features/production/ProductionProvider';
import {ProductionDialog} from '../components/production/ProductionDialog';
import {executionOverview, type ExecutionOverviewItem} from '../components/production/ExecutionOverviewProjection';
import {startDraftScope} from '../features/production/productionDrafts';
import {putStudioField, type StudioDrafts} from '../features/content/studioDraftModel';

export function App() {
  const { page, navigate } = useHashRouter();
  const { locale, focusMode, t } = useLanguage();
  const { agents: allAgents, getAgentById, createAgent, updateAgent, deleteAgent } = useAgents();
  const { currentWorkspaceId, workspaces, setCurrentWorkspaceId } = useWorkspaces();
  const {runs: productionRuns} = useProduction();
  const [executionId, setExecutionId] = useState<string | null>(null);
  useEffect(() => setExecutionId(null), [currentWorkspaceId]);
  const currentExecution = executionOverview(productionRuns, currentWorkspaceId, locale === 'pt-BR').find(item => item.id === executionId);
  const openExecution = (item: ExecutionOverviewItem, chat = false) => {
    const current = executionOverview(productionRuns, currentWorkspaceId, locale === 'pt-BR').find(candidate => candidate.id === item.id);
    if (!current) return;
    if (chat) {
      if (!current.chat || !allAgents.some(agent => agent.id === current.chat?.agentId && agent.workspaceId === currentWorkspaceId)) return;
      openSession(current.chat.agentId, current.chat.sessionId);
      selectAgent(current.chat.agentId);
    } else if (current.detail) {
      const target = current.detail;
      updatePersistentValue<StudioDrafts>('studio-drafts', {}, drafts => putStudioField(drafts, startDraftScope(target.workspaceId, target.flowId, target.sessionId), 'run', target.runId));
      setExecutionId(current.id);
    }
  };
  const { sessions, createSession, openSession } = useChat();
  const chatInbox=useChatInbox(sessions,allAgents,currentWorkspaceId);
  const { state: editorialState, ready: editorialReady, jobs: editorialJobs } = useContentWorkflow();
  const { attachNodesToAgent, addNode, allNodes, selectNode } = useCanvas();
  const deferredWorkspaceAction = useRef<(() => void) | null>(null);
  const inWorkspace = (workspaceId: string, action: () => void) => {
    if (workspaceId === currentWorkspaceId) action();
    else {
      deferredWorkspaceAction.current = action;
      setCurrentWorkspaceId(workspaceId);
    }
  };
  const agents = allAgents.filter((agent) => agent.workspaceId === currentWorkspaceId);
  const [activeAgentId, setActiveAgentId] = useState<AgentId>(agents[0]?.id ?? '');
  const [editorAgentId, setEditorAgentId] = useState<AgentId | 'new' | null>(null);
  const [agentTemplateId, setAgentTemplateId] = useState<string | null>(null);
  const [welcomeDismissed, setWelcomeDismissed] = usePersistentState<boolean>('welcome-dismissed', false);
  const [taskDialogStatus, setTaskDialogStatus] = useState<TaskStatus | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [selectedContentId, setSelectedContentId] = useState<string | null>(null);
  const [selectedEditorialTopicId, setSelectedEditorialTopicId] = useState<string | null>(null);
  const openEditorialItem = (item: EditorialInboxItem) => {
    const current = editorialInbox(editorialState, editorialJobs, currentWorkspaceId).find(candidate => candidate.id === item.id);
    if (!current) { notify(locale === 'pt-BR' ? 'Esta pendência já mudou. Confira a lista atualizada.' : 'This item has changed. Check the updated list.'); return; }
    setSelectedContentId(current.contentId ?? null);
    setSelectedEditorialTopicId(current.topicId);
    updatePersistentValue('studio-view','studio','studio');navigate('content');
  };
  useEffect(()=>{
    const open=(event:Event)=>{
      const detail=(event as CustomEvent<{contentId?:string;topicId?:string}>).detail;
      const id=detail?.contentId;
      const item=editorialState.contents.find(content=>content.id===id);
      if(!item){const topic=editorialState.topics.find(topic=>topic.id===detail?.topicId);if(topic){setCurrentWorkspaceId(topic.workspaceId);setSelectedContentId(topic.contentId??null);setSelectedEditorialTopicId(topic.id);updatePersistentValue('studio-view','studio','studio');navigate('content');}return;}
      setCurrentWorkspaceId(item.workspaceId);setSelectedContentId(item.id);setSelectedEditorialTopicId(item.topicId);updatePersistentValue('studio-view','studio','studio');navigate('content');
    };
    window.addEventListener('mainsagents:open-content',open);return()=>window.removeEventListener('mainsagents:open-content',open);
  },[editorialState.contents,editorialState.topics,setCurrentWorkspaceId,navigate]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [chatPresentation, setChatPresentation] = usePersistentState<'side' | 'floating'>(
    'chat-presentation',
    'side',
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [agentChoice, setAgentChoice] = useState<{ kind: 'session' | 'context'; nodeIds?: string[] } | null>(
    null,
  );
  const [pendingCreation, setPendingCreation] = useState<{
    kind: 'session' | 'context' | 'task';
    nodeIds?: string[];
    status?: TaskStatus;
  } | null>(null);
  const [settingsSection, setSettingsSection] = useState<
    'interface' | 'providers' | 'data' | 'account' | 'help'
  >('interface');
  const [commandOpen, setCommandOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [undoAction, setUndoAction] = useState<(() => void) | null>(null);
  const [storageError, setStorageError] = useState('');
  const [allTasks, setAllTasks, tasksHydrated] = usePersistentState<Task[]>('tasks', []);
  const workspaceTasks = allTasks.filter((task) => task.workspaceId === currentWorkspaceId);
  const activeAgent = getAgentById(activeAgentId) ?? agents[0];
  const editorAgent = editorAgentId && editorAgentId !== 'new' ? getAgentById(editorAgentId) : undefined;
  const editorTemplate = agentTemplates.find((template) => template.id === agentTemplateId);
  const notify = (message: string) => {
    setToast(message);
    setUndoAction(null);
    window.clearTimeout(window.__mainsToast);
    window.__mainsToast = window.setTimeout(() => setToast(''), 2200);
  };
  const notifyUndo = (message: string, action: () => void) => {
    setToast(message);
    setUndoAction(() => action);
    window.clearTimeout(window.__mainsToast);
    window.__mainsToast = window.setTimeout(() => {
      setToast('');
      setUndoAction(null);
    }, 7000);
  };
  const selectAgent = (agentId: string, settings = false) => {
    setActiveAgentId(agentId);
    setPanelOpen(true);
    if (settings) navigate('agent-settings');
  };
  const editAgent = (agentId: AgentId) => {
    setActiveAgentId(agentId);
    setEditorAgentId(agentId);
  };
  const continueWithAgent = (
    agentId: string,
    intent: { kind: 'session' | 'context' | 'task'; nodeIds?: string[]; status?: TaskStatus },
  ) => {
    const agent = getAgentById(agentId);
    setActiveAgentId(agentId);
    if (intent.kind === 'task') {
      setTaskDialogStatus(intent.status ?? 'research');
      return;
    }
    if (intent.kind === 'session')
      createSession(agentId, undefined, agent?.providerId ?? 'codex', agent?.modelId);
    else attachNodesToAgent(agentId, intent.nodeIds ?? []);
    setPanelOpen(true);
  };
  const saveAgent = (values: AgentEditorValues) => {
    if (editorAgentId === 'new') {
      const created = createAgent(values);
      inWorkspace(created.workspaceId, () => {
        setActiveAgentId(created.id);
        if (pendingCreation) {
          if (pendingCreation.kind === 'task') setTaskDialogStatus(pendingCreation.status ?? 'research');
          else {
            if (pendingCreation.kind === 'context')
              attachNodesToAgent(created.id, pendingCreation.nodeIds ?? []);
            else createSession(created.id, undefined, created.providerId ?? 'codex', created.modelId);
            setPanelOpen(true);
          }
        } else {
          navigate('agents');
          setPanelOpen(true);
        }
        notify(locale === 'pt-BR' ? `${created.name} criado` : `${created.name} created`);
      });
    } else if (editorAgentId) {
      updateAgent(editorAgentId, values);
      notify(locale === 'pt-BR' ? `${values.name} atualizado` : `${values.name} updated`);
    }
    setEditorAgentId(null);
    setAgentTemplateId(null);
    setPendingCreation(null);
  };
  const removeAgent = () => {
    if (!editorAgentId || editorAgentId === 'new') return;
    const remaining = agents.filter((agent) => agent.id !== editorAgentId);
    const removed = getAgentById(editorAgentId);
    deleteAgent(editorAgentId);
    if (activeAgentId === editorAgentId) setActiveAgentId(remaining[0]?.id ?? '');
    setEditorAgentId(null);
    notify(`${removed?.name ?? 'Agent'} deleted`);
  };
  const openTask = (task: Task) => {
    if (task.contentId) {
      setSelectedContentId(task.contentId);
      setSelectedEditorialTopicId(null);
      updatePersistentValue('studio-view','studio','studio');navigate('content');
      return;
    }
    setActiveAgentId(task.agentId);
    setEditingTaskId(task.id);
  };
  const openTaskConversation = (draft: TaskDraft) => {
    const task = allTasks.find((item) => item.id === editingTaskId);
    const agent = getAgentById(draft.agentId);
    if (!task || !agent) return;
    const existing = sessions.find(
      (session) => session.id === task.sessionId && session.agentId === agent.id,
    );
    const session =
      existing ?? createSession(agent.id, draft.title, agent.providerId ?? 'codex', agent.modelId);
    if (existing) openSession(agent.id, session.id);
    if (!existing && !readChatDraft(agent.id, session.id).text)
      writeChatDraft(agent.id, session.id, {
        text: `${draft.title}\n\n${draft.description}`.trim(),
        skill: null,
      });
    setAllTasks((current) =>
      current.map((item) => (item.id === task.id ? { ...item, ...draft, sessionId: session.id } : item)),
    );
    sessionStorage.removeItem(`mainsagents:task-draft:${task.id}`);
    setEditingTaskId(null);
    selectAgent(agent.id);
  };
  const moveTask = (taskId: string, status: TaskStatus) => {
    const task = allTasks.find((item) => item.id === taskId);
    if (!task || task.status === status) return;
    if (task.contentId) {
      notify(
        locale === 'pt-BR'
          ? 'O status deste card acompanha a aprovação no Estúdio de conteúdo.'
          : 'This card follows approvals in Content Studio.',
      );
      return;
    }
    setAllTasks((current) => current.map((item) => (item.id === taskId ? { ...item, status } : item)));
    notifyUndo(`${task.title} moved to ${status}`, () =>
      setAllTasks((current) =>
        current.map((item) => (item.id === taskId ? { ...item, status: task.status } : item)),
      ),
    );
  };
  const newTask = (status: TaskStatus = 'research') => {
    if (!agents.length) {
      setPendingCreation({ kind: 'task', status });
      setAgentTemplateId(null);
      setEditorAgentId('new');
      notify(
        locale === 'pt-BR'
          ? 'Crie um agente antes de adicionar uma tarefa'
          : 'Create an agent before adding a task',
      );
      return;
    }
    setTaskDialogStatus(status);
  };
  const saveTask = (draft: TaskDraft) => {
    if (editingTaskId) {
      setAllTasks((current) =>
        current.map((task) => (task.id === editingTaskId ? { ...task, ...draft } : task)),
      );
      setEditingTaskId(null);
      notify(t('Task updated'));
      return;
    }
    const task: Task = {
      id: `task-${Date.now().toString(36)}`,
      title: draft.title,
      description: draft.description,
      agentId: draft.agentId,
      workspaceId: currentWorkspaceId,
      status: draft.status,
      metadata: locale === 'pt-BR' ? 'Nova' : 'New',
      createdAt: new Date().toISOString(),
    };
    setAllTasks((current) => [task, ...current]);
    setTaskDialogStatus(null);
    navigate('board');
    notify(t('Task created'));
  };
  const deleteTask = () => {
    if (!editingTaskId) return;
    const task = allTasks.find((item) => item.id === editingTaskId);
    if (!task) return;
    if (
      !window.confirm(
        locale === 'pt-BR' ? `Excluir a tarefa “${task.title}”?` : `Delete task “${task.title}”?`,
      )
    )
      return;
    sessionStorage.removeItem(`mainsagents:task-draft:${task.id}`);
    setAllTasks((current) => current.filter((item) => item.id !== editingTaskId));
    setEditingTaskId(null);
    notifyUndo(t('Task deleted'), () => setAllTasks((current) => [task, ...current]));
  };
  const newSession = () => setAgentChoice({ kind: 'session' });
  const sendCanvasContext = (nodeIds: string[]) => setAgentChoice({ kind: 'context', nodeIds });
  const addCanvasNode = (kind: Parameters<typeof addNode>[0]) => {
    addNode(kind);
    navigate('canvas');
    notify(
      locale === 'pt-BR'
        ? `${kind === 'note' ? 'Nota' : 'Imagem'} adicionada ao Canvas`
        : `${kind === 'note' ? 'Note' : 'Image'} added to Canvas`,
    );
  };
  const startAgentCreation = () => {
    setPendingCreation(null);
    setAgentTemplateId(null);
    setEditorAgentId('new');
  };
  useEffect(() => {
    if (!agents.some((agent) => agent.id === activeAgentId)) setActiveAgentId(agents[0]?.id ?? '');
  }, [currentWorkspaceId, allAgents]);
  useEffect(() => {
    setAgentChoice(null);
    setPendingCreation(null);
    setEditorAgentId(null);
    setEditingTaskId(null);
    setTaskDialogStatus(null);
    const action = deferredWorkspaceAction.current;
    deferredWorkspaceAction.current = null;
    action?.();
  }, [currentWorkspaceId]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (!document.querySelector('[aria-modal="true"]')) setCommandOpen(true);
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    const report = (event: Event) => setStorageError((event as CustomEvent<string>).detail);
    window.addEventListener('mainsagents:persistence-error', report);
    return () => window.removeEventListener('mainsagents:persistence-error', report);
  }, []);
  useEffect(() => {
    const reopen = () => {
      setWelcomeDismissed(false);
      navigate('home');
    };
    window.addEventListener('mainsagents:show-welcome', reopen);
    return () => window.removeEventListener('mainsagents:show-welcome', reopen);
  }, [navigate, setWelcomeDismissed]);
  useEffect(() => {
    if (!editorialReady || !tasksHydrated) return;
    setAllTasks((current) => {
      let changed = false;
      const next = [...current];
      for (const item of editorialState.contents) {
        const topic = editorialState.topics.find((candidate) => candidate.id === item.topicId);
        const run =
          editorialState.runs.find((candidate) => candidate.contentId === item.id) ??
          editorialState.runs.find((candidate) => candidate.topicId === (topic?.requestId ?? item.topicId));
        const status: TaskStatus =
          item.status === 'script-approved'
            ? 'done'
            : item.status === 'script-review' || item.status === 'error'
              ? 'review'
              : item.status === 'generating'
                ? 'running'
                : 'research';
        const metadata = `${item.format} · ${item.platforms.join(', ')}${item.plannedAt ? ` · ${item.plannedAt}` : ''}`;
        const index = next.findIndex((task) => task.id === item.taskId);
        if (index < 0) {
          next.unshift({
            id: item.taskId,
            title: item.title,
            description: topic?.summary ?? '',
            agentId: run?.agentId ?? '',
            workspaceId: item.workspaceId,
            status,
            metadata,
            createdAt: item.createdAt,
            topicId: item.topicId,
            contentId: item.id,
            sessionId: run?.sessionId,
            executionId: run?.id,
          });
          changed = true;
          continue;
        }
        const previous = next[index];
        if (
          previous.status !== status ||
          previous.metadata !== metadata ||
          previous.agentId !== (run?.agentId ?? previous.agentId) ||
          previous.sessionId !== run?.sessionId ||
          previous.executionId !== run?.id
        ) {
          next[index] = {
            ...previous,
            status,
            metadata,
            agentId: run?.agentId ?? previous.agentId,
            sessionId: run?.sessionId,
            executionId: run?.id,
            contentId: item.id,
            topicId: item.topicId,
          };
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [
    editorialReady,
    editorialState.contents,
    editorialState.runs,
    editorialState.topics,
    setAllTasks,
    tasksHydrated,
  ]);
  const content =
    page === 'content' ? (
      <ContentStudio
        onCreateAgent={startAgentCreation}
        key={currentWorkspaceId}
        selectedContentId={selectedContentId}
        selectedTopicId={selectedEditorialTopicId}
        onOpenSession={(agentId, sessionId) => {
          selectAgent(agentId);
          openSession(agentId, sessionId);
        }}
      />
    ) : page === 'board' ? (
      <Board
        key={currentWorkspaceId}
        tasks={workspaceTasks}
        onOpenTask={openTask}
        onMoveTask={moveTask}
        onToast={notify}
        onAddTask={newTask}
      />
    ) : page === 'canvas' ? (
      <Canvas onToast={notify} onAskAgent={sendCanvasContext} onSendToAgent={sendCanvasContext} />
    ) : page === 'flow' ? (
      <Flow onOpenCanvas={() => navigate('canvas')} onSelectAgent={selectAgent} onOpenStudio={()=>{updatePersistentValue('studio-view','studio','studio');navigate('content')}} />
    ) : page === 'agents' ? (
      <Agents
        key={currentWorkspaceId}
        agents={agents}
        onSelect={editAgent}
        onChat={selectAgent}
        onCreate={startAgentCreation}
      />
    ) : page === 'agent-settings' && activeAgent ? (
      <AgentSettings
        agent={activeAgent}
        onBack={() => navigate('agents')}
        onEdit={() => editAgent(activeAgent.id)}
      />
    ) : page === 'sessions' ? (
      <Sessions
        key={currentWorkspaceId}
        onNewSession={newSession}
        onCreateAgent={startAgentCreation}
        onActivateAgent={(id) => selectAgent(id)}
        onToast={notify}
      />
    ) : page === 'settings' ? (
      <Settings initialSection={settingsSection} />
    ) : (
      <>
        {!welcomeDismissed && (
          <WelcomeGuide
            hasAgent={agents.length > 0}
            onTemplate={(id) => {
              setAgentTemplateId(id);
              setEditorAgentId('new');
            }}
            onBlank={startAgentCreation}
            onSession={newSession}
            onCanvas={() => navigate('canvas')}
            onCodexSettings={() => {
              setSettingsSection('providers');
              navigate('settings');
            }}
            onDismiss={() => setWelcomeDismissed(true)}
          />
        )}
        <Home
          tasks={workspaceTasks}
          onOpenTask={openTask}
          onCreateAgent={startAgentCreation}
          onCreateTask={() => newTask()}
          onSelectAgent={(id) => selectAgent(id)}
          onNavigate={navigate}
          onOpenEditorial={openEditorialItem}
          chatInbox={chatInbox}
          onOpenChatInbox={item=>{openSession(item.agentId,item.sessionId);selectAgent(item.agentId);}}
          showEmptyPrompt={welcomeDismissed}
          onOpenExecution={item => openExecution(item)}
          onOpenExecutionChat={item => openExecution(item, true)}
        />
      </>
    );
  return (
    <>
      {currentExecution?.detail && <ProductionDialog key={currentExecution.id} workspaceId={currentExecution.detail.workspaceId} flowId={currentExecution.detail.flowId} sessionId={currentExecution.detail.sessionId} onClose={() => setExecutionId(null)} onSelectAgent={id => selectAgent(id)}/>}
      <AppShell
        onProviderSettings={() => {
          setSettingsSection('providers');
          setPanelOpen(false);
          navigate('settings');
        }}
        page={page}
        agents={agents}
        activeAgent={activeAgent}
        panelOpen={panelOpen}
        chatPresentation={chatPresentation}
        onToggleChatPresentation={() =>
          setChatPresentation((mode) => (mode === 'side' ? 'floating' : 'side'))
        }
        onNavigate={navigate}
        onSelectAgent={(id) => selectAgent(id)}
        onEditAgent={editAgent}
        onTogglePanel={() => setPanelOpen((open) => !open)}
        onOpenCommand={() => setCommandOpen(true)}
        onCreate={() => setCreateOpen(true)}
        onToast={notify}
        focusMode={focusMode}
      >
        {content}
      </AppShell>
      <AgentComparisonView onNavigate={navigate} onEditAgent={editAgent} onProviderSettings={()=>{setSettingsSection('providers');setPanelOpen(false);navigate('settings')}} onToast={notify}/>
      <CommandPalette
        agents={allAgents}
        tasks={allTasks}
        sessions={sessions}
        nodes={allNodes}
        workspaces={workspaces}
        currentWorkspaceId={currentWorkspaceId}
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        onNavigate={navigate}
        onNewAgent={startAgentCreation}
        onNewTask={() => newTask()}
        onNewSession={newSession}
        onAddNode={addCanvasNode}
        onOpenAgent={(id) => {
          const agent = getAgentById(id);
          if (agent) inWorkspace(agent.workspaceId, () => selectAgent(id));
        }}
        onOpenTask={(task) =>
          inWorkspace(task.workspaceId, () => {
            navigate('board');
            openTask(task);
          })
        }
        onOpenSession={(agentId, sessionId) => {
          const agent = getAgentById(agentId);
          if (agent)
            inWorkspace(agent.workspaceId, () => {
              openSession(agentId, sessionId);
              selectAgent(agentId);
              navigate('sessions');
            });
        }}
        onOpenNode={(workspaceId, nodeId) =>
          inWorkspace(workspaceId, () => {
            selectNode(workspaceId, nodeId);
            navigate('canvas');
          })
        }
        onSwitchWorkspace={(workspaceId) => {
          setCurrentWorkspaceId(workspaceId);
          notify(
            `${workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? 'Workspace'} opened`,
          );
        }}
      />
      {createOpen && (
        <QuickCreate
          onClose={() => setCreateOpen(false)}
          onAgent={startAgentCreation}
          onTask={() => newTask()}
          onSession={newSession}
          onNote={() => addCanvasNode('note')}
          onContent={() => navigate('content')}
        />
      )}
      {agentChoice && (
        <AgentChooser
          agents={agents}
          title={
            locale === 'pt-BR'
              ? agentChoice.kind === 'session'
                ? 'Com quem você quer conversar?'
                : 'Qual agente deve receber o contexto?'
              : agentChoice.kind === 'session'
                ? 'Who would you like to talk to?'
                : 'Which agent should receive the context?'
          }
          description={
            locale === 'pt-BR'
              ? agentChoice.kind === 'session'
                ? 'Uma nova conversa mantém seu próprio histórico.'
                : `${agentChoice.nodeIds?.length ?? 0} ${(agentChoice.nodeIds?.length ?? 0) === 1 ? 'objeto do Canvas será anexado' : 'objetos do Canvas serão anexados'} à próxima mensagem.`
              : agentChoice.kind === 'session'
                ? 'A new conversation keeps its own history.'
                : `${agentChoice.nodeIds?.length ?? 0} Canvas objects will be attached to your next message.`
          }
          onChoose={(id) => {
            continueWithAgent(id, agentChoice);
            setAgentChoice(null);
          }}
          onCreate={() => {
            setPendingCreation(agentChoice);
            setAgentChoice(null);
            setAgentTemplateId(null);
            setEditorAgentId('new');
          }}
          onClose={() => setAgentChoice(null)}
        />
      )}
      {editorAgentId && (
        <AgentEditorDrawer
          agent={editorAgent}
          initialValues={editorTemplate ? localizeTemplate(editorTemplate, locale).values : undefined}
          onClose={() => {
            setEditorAgentId(null);
            setAgentTemplateId(null);
            setPendingCreation(null);
          }}
          onOpenProviderSettings={() => {
            setEditorAgentId(null);
            setSettingsSection('providers');
            navigate('settings');
          }}
          onSave={saveAgent}
          onDelete={editorAgentId === 'new' ? undefined : removeAgent}
        />
      )}
      {taskDialogStatus && (
        <TaskEditorDialog
          agents={agents}
          initialAgentId={activeAgent?.id}
          initialStatus={taskDialogStatus}
          onClose={() => setTaskDialogStatus(null)}
          onSave={saveTask}
        />
      )}
      {editingTaskId && (
        <TaskEditorDialog
          agents={agents}
          task={allTasks.find((task) => task.id === editingTaskId)}
          onClose={() => setEditingTaskId(null)}
          onSave={saveTask}
          onDelete={deleteTask}
          onOpenChat={openTaskConversation}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
          {undoAction && (
            <button
              onClick={() => {
                undoAction();
                setUndoAction(null);
                setToast('');
                window.clearTimeout(window.__mainsToast);
              }}
            >
              {t('Undo')}
            </button>
          )}
        </div>
      )}
      {storageError && (
        <div className="storage-error" role="alert">
          <span>{storageError}</span>
          <button onClick={() => setStorageError('')} aria-label="Dismiss storage error">
            ×
          </button>
        </div>
      )}
    </>
  );
}

declare global {
  interface Window {
    __mainsToast: number;
  }
}
