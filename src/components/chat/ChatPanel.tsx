import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Agent } from '../../features/agents/model/Agent';
import { agentStatusLabels, agentToolDetails, getAgentInitials } from '../../features/agents/model/Agent';
import { useChat } from '../../features/chat/ChatProvider';
import type { ChatRunState, ReasoningEffort } from '../../features/chat/model/Chat';
import { Icon } from '../common/Icon';
import { useCanvas, getNodeContextContent, getNodeContextLabel } from '../canvas/CanvasProvider';
import { useWorkspaces } from '../../app/WorkspaceProvider';
import { useLanguage } from '../../app/LanguageProvider';
import { AgentAvatar } from '../agents/AgentAvatar';
import type { ProviderId, ProviderConnectionState } from '../../features/chat/AiProvider';
import { sessionProviderId } from '../../features/chat/AiProvider';
import { SelectMenu } from '../common/SelectMenu';
import { draftSlot, readChatDraft, writeChatDraft, useChatDraft } from '../../features/chat/chatDrafts';
import { matchingSkills, slashSkillToken, removeSlashSkillToken, typedSkillCommand } from '../../features/chat/skillCommands';
import { useAgents } from '../../features/agents/AgentsProvider';
import { AgentHandoffDialog } from './AgentHandoffDialog';
import { AgentConnectionBar } from './AgentConnectionBar';
import { ChatMessageImages } from './ChatMessageImages';
import {ChatDeliveryCard,ScriptDeliveryReview} from './ChatDeliveryCard';
import {DeliveryReceiptCard} from './DeliveryReceiptCard';
import {useContentWorkflow} from '../../features/content/ContentWorkflowProvider';
import type {EditorialArtifact} from '../../features/content/model';
import {editorialReviewCommand} from '../../features/content/reviewCommands';
import {useProduction} from '../../features/production/ProductionProvider';
import {productionStageLabel} from '../../features/production/model';
import {productionChatIntent} from '../../../production-protocol.mjs';
import {ProductionDialog} from '../production/ProductionDialog';
import {FlowDialog} from '../common/FlowDialog';
import {RuntimeActionApprovals} from './RuntimeActionApprovals';
import {NativeDelegationWork} from './NativeDelegationWork';
import {markChatSessionSeen} from '../../features/chat/chatInboxState';
import {FileDeliveryReview} from './FileDeliveryReview';
import {RunStatusLine} from './ResponseTimer';
import {chatFeed} from '../../features/chat/responseTiming';
import {ComparisonLauncher} from './ComparisonLauncher';
import {ProviderChoice, ConversationProviderBar} from './ProviderChoice';
import {editingLabel,productionSessionIds,providerSwitchPlan} from '../../features/chat/providerChoice';
import {executionText,lastExecution} from '../../features/production/editorExecutions';
import type {EditDirector} from '../../features/production/ProductionProvider';
import {MessageMarkdown} from './MessageMarkdown';
import {ContentSessionCard} from './ContentSessionCard';
import {RecordedEntry} from '../production/RecordedEntry';
import {AdjustPreview,ChatEditCard,MessageAttachments} from './ChatEditCard';
import {classifyEditRequest,withTimeWindow} from '../../../chat-edit-intent.mjs';
import {attachmentOf,isVideoPath,messageVideos,type ChatEditAction} from '../../features/chat/chatEdits';
import {providerGateNotice,type ProviderGateView} from '../../features/production/providerWait';
import {storageProfile} from '../../data/IndexedDbStateStore';
import type {ChatMessageItem} from '../../features/chat/model/Chat';
import type {ChatAttachment} from '../../features/chat/model/Chat';
import {contentBinding,contentSessionSummary,linkedRun,sessionListLabel} from '../../features/chat/contentSessions';
import {contentLink,contentSpaces,effectiveScope,linkOf,resolveScopeSession,scopeContentId,scopeOfSession,scopeSessions} from '../../features/chat/contentScopes';
import type {AgentSession} from '../../features/chat/model/Chat';
import {ContentScopeBar} from './ContentScopeBar';
import {ContentDeletionDialog} from '../content/ContentDeletionDialog';
import {DeletionRefused} from '../../features/content/contentDeletion';
import {OrganizeChatDialog} from './OrganizeChatDialog';

type ChatTab = 'chat' | 'sessions' | 'context';
const stateLabels: Record<ChatRunState, string> = {
  idle: 'Idle',
  thinking: 'Thinking',
  searching: 'Searching',
  'using-tool': 'Tool usage',
  finished: 'Finished',
  error: 'Error',
};
const tabLabels: Record<ChatTab, string> = { chat: 'Chat', sessions: 'Sessions', context: 'Context' };

interface ChatPanelProps {
  onSelectAgent: (agentId: string) => void;
  agent: Agent;
  onNavigateHistory: () => void;
  onNavigateSettings: () => void;
  onProviderSettings: () => void;
  onOpenCanvas: () => void;
  onToast: (message: string) => void;
  presentation: 'side' | 'floating';
  onTogglePresentation: () => void;
  onClose: () => void;
  sessionId?: string;
  comparisonMode?:boolean;
}

export function ChatPanel({
  onSelectAgent,
  agent,
  onNavigateHistory,
  onNavigateSettings,
  onProviderSettings,
  onOpenCanvas,
  onToast,
  presentation,
  onTogglePresentation,
  onClose,
  sessionId,
  comparisonMode=false,
}: ChatPanelProps) {
  const { getWorkspaceById } = useWorkspaces();
  const { agents } = useAgents();
  const { locale, t, reducedMotion } = useLanguage();
  const editorial=useContentWorkflow(),editorialState=editorial.state;
  const production=useProduction();
  const [productionOpen,setProductionOpen]=useState(false),[productionText,setProductionText]=useState<string>();
  const [reviewRequest,setReviewRequest]=useState<{artifacts:EditorialArtifact[];selectedId:string;decision:'approve'|'rejected'|'revision-requested';notes:string;confirmedTarget:boolean}|null>(null);
  const [composerSelection, setComposerSelection] = useState({ start:0, end:0 });
  const [dismissedSlash, setDismissedSlash] = useState<string|null>(null);
  const [showLatest, setShowLatest] = useState(false);
  const [skillsPickerOpen, setSkillsPickerOpen] = useState(false);
  const [skillMenuIndex, setSkillMenuIndex] = useState(0);
  const [tab, setTab] = useState<ChatTab>('chat');
  const [composerOptionsOpen, setComposerOptionsOpen] = useState(false);
  const [handoffBrief, setHandoffBrief] = useState<{text:string;sessionId:string}|null>(null);
  const [comparisonBrief,setComparisonBrief]=useState<string|null>(null);
  const [providerChoiceOpen,setProviderChoiceOpen]=useState(false);
  const [sameAgentModels,setSameAgentModels]=useState<{codexModelId?:string;claudeModelId?:string}|null>(null);
  const composerOptionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setComposerOptionsOpen(false);
    setSkillsPickerOpen(false);
  }, [agent.id]);
  useEffect(() => {
    if (!composerOptionsOpen) return;
    const close = (event: PointerEvent) => {
      if (!composerOptionsRef.current?.contains(event.target as Node)) setComposerOptionsOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [composerOptionsOpen]);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError,setDeleteError]=useState<{sessionId:string;message:string}|null>(null),[deletingSessionId,setDeletingSessionId]=useState<string|null>(null);
  const [contentToDelete,setContentToDelete]=useState<{contentId:string;workspaceId:string;title:string}|null>(null);
  const [connection, setConnection] = useState<ProviderConnectionState | 'checking'>('checking');
  const [models, setModels] = useState<readonly { id: string; name: string }[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const followLatestRef = useRef(true);
  const {
    getRunState,
    createSession,
    openSession,
    renameSession,
    deleteSession,
    sendMessage,
    cancelExecution,
    listModels,
    getProviderStatus,
    setSessionModel,
    setSessionProvider,
    isSessionBusy,
    setSessionReasoningEffort,
    sessions,
    handoffs,
    showCollaboration,
    refreshSessionImages,
    comparisons,
    showComparison,
    contentScopes,
    selectScope,
    legacyActiveSessionId,
    reportFocusedSession,
    pinVisibleSession,
    sendEditRequest,
    chatEditRequests,
    admitChatEdit,
    cancelChatEditMeasure,
    refreshChatEdits,
  } = useChat();
  const { addAgentResponse, hasMessageNode, getAgentContext, clearAgentContext, allNodes } =
    useCanvas();
  const pt=locale==='pt-BR';
  // Content space of this chat: chosen per workspace and saved; the chat shown is this agent's chat of THAT scope only.
  // Until saved contents AND productions are loaded the saved scope is kept as is (never Recovery or a General chat by mistake)
  // and scope actions wait.
  const scopePending=!editorial.ready||(!production.ready&&!production.error);
  const scopeCtx={workspaceId:agent.workspaceId,contents:editorialState.contents,runs:production.runs,pending:scopePending};
  const legacySession=sessions.find(item=>item.id===legacyActiveSessionId(agent.id)&&item.agentId===agent.id);
  const scope=effectiveScope(contentScopes,scopeCtx,legacySession?scopeOfSession(legacySession,scopeCtx):undefined);
  const scopeContent=editorialState.contents.find(item=>item.id===scopeContentId(scope)&&item.workspaceId===agent.workspaceId);
  const workspaceAgents=agents.filter(item=>item.workspaceId===agent.workspaceId);
  const spaces=contentSpaces(sessions,workspaceAgents.map(item=>item.id),scopeCtx,pt);
  // While saved contents load, the saved choice is kept (shown as loading), never reported as an invalid link.
  if(!spaces.some(space=>space.scope===scope))spaces.push({scope,kind:'content',title:pt?'Carregando conteúdo…':'Loading content…',chats:agentSessionsCount(sessions,scope),agents:[]});
  const scopeTitle=spaces.find(space=>space.scope===scope)?.title??(pt?'Geral':'General');
  const agentSessions = scopeSessions(sessions,agent.id,scope,scopeCtx);
  const activeSession = sessionId?sessions.find(item=>item.id===sessionId&&item.agentId===agent.id):resolveScopeSession(sessions,contentScopes,agent.id,scope,scopeCtx,legacySession?.id);
  // New chats inherit the selected content (General stays General; the recovery bucket never receives new chats).
  const newChatLink=scopeContent?contentLink(scopeContent):undefined;
  const [organizing,setOrganizing]=useState<AgentSession|null>(null);
  useEffect(()=>{if(sessionId)return;reportFocusedSession(activeSession?.id);return()=>reportFocusedSession(undefined);},[sessionId,activeSession?.id,reportFocusedSession]);
  // The chat on screen becomes its slot's saved pointer: a newer background sibling (native/production import) never replaces it.
  useEffect(()=>{if(sessionId||comparisonMode||scopePending||!activeSession)return;pinVisibleSession(agent.workspaceId,agent.id,scope,activeSession.id);},[sessionId,comparisonMode,scopePending,activeSession?.id,agent.workspaceId,agent.id,scope,pinVisibleSession]);
  // Unsent text lives in the shown chat, else in THIS scope's own "no chat yet" slot (General keeps the legacy one).
  const slot=draftSlot(activeSession?.id,agent.workspaceId,scope);
  const pairedComparison=activeSession?.comparison,comparisonAvailable=comparisons.some(pair=>pair.id===pairedComparison?.id);
  const comparisonModelLocked=pairedComparison?.mode==='same-agent';
  // A content session only ever shows and commands its own content's production (validated by workspace + contentId + sessionId).
  const binding=contentBinding(activeSession,{workspaceId:agent.workspaceId,contents:editorialState.contents,runs:production.runs});
  const linkedProduction=binding.kind==='invalid'?undefined:binding.kind==='content'?binding.run:linkedRun(production.runs,activeSession,agent.workspaceId);
  // Another chat of the same content acts on THAT content's production through its main session (same run, same receipts); never a new run.
  const productionTarget=binding.kind==='content'&&!binding.run&&binding.mainRun?{sessionId:binding.mainRun.sourceSession.id,agentId:binding.mainRun.sourceSession.agentId}:{sessionId:activeSession?.id,agentId:agent.id};
  const contentSummary=contentSessionSummary(binding,editorialState.assets??[],locale==='pt-BR');
  const [recordedOpen,setRecordedOpen]=useState(false),[newContentOpen,setNewContentOpen]=useState(false),[newContentTitle,setNewContentTitle]=useState(''),[creatingContent,setCreatingContent]=useState(false);
  useEffect(()=>{setRecordedOpen(false);},[activeSession?.id]);
  const startContentSession=async()=>{
    const title=newContentTitle.trim();if(!title||creatingContent)return;setCreatingContent(true);
    try{
      // Own content + own session: never adopts a filled generic chat, the "new" draft or another content's remote thread.
      const content=await editorial.createSessionContent(agent.workspaceId,title);
      createSession(agent.id,title,agent.providerId??'codex',agent.modelId,{contentId:content.id,topicId:content.topicId,contentTitle:content.title},'select');
      setNewContentOpen(false);setTab('chat');onToast(locale==='pt-BR'?`Conteúdo “${title}” criado em ${agent.name}`:`Content “${title}” created in ${agent.name}`);
    }catch(error){onToast(error instanceof Error?error.message:String(error));}finally{setCreatingContent(false);}
  };
  useEffect(()=>{if(activeSession&&tab==='chat'&&document.visibilityState==='visible')markChatSessionSeen(activeSession);},[activeSession,tab]);
  const linkedHandoffs=handoffs.filter(item=>item.sourceSessionId===activeSession?.id||item.targetSessionId===activeSession?.id);
  const lastMessage = activeSession?.messages[activeSession.messages.length - 1];
  const lastMessageContent = lastMessage?.type === 'message' ? lastMessage.content : undefined;
  const lastRunError = activeSession?.messages
    .slice()
    .reverse()
    .find((item) => item.type === 'activity' && item.kind !== 'run' && item.status === 'error');
  const draft = useChatDraft(agent.id, slot);
  const message = draft.text;
  const selectedSkill = draft.skill;
  const pendingContext = getAgentContext(agent.id);
  const contextNodes = (draft.context ?? []).flatMap(ref => {
    const node = allNodes.find(item => item.workspaceId === agent.workspaceId && ref.workspaceId === agent.workspaceId && item.node.id === ref.nodeId)?.node;
    return node ? [{ nodeId: node.id, label: getNodeContextLabel(node), kind: node.type, content: getNodeContextContent(node) }] : [];
  });
  const missingContext = (draft.context ?? []).filter(ref => !contextNodes.some(item => item.nodeId === ref.nodeId));
  const pendingContextKey = pendingContext.map(item => item.nodeId).join('\n');
  useEffect(() => {
    if (!pendingContext.length) return;
    const latest = readChatDraft(agent.id, slot);
    const refs = new Map((latest.context ?? []).map(ref => [ref.nodeId, ref]));
    pendingContext.forEach(item => refs.set(item.nodeId, { nodeId: item.nodeId, label: item.label, workspaceId: agent.workspaceId }));
    writeChatDraft(agent.id, slot, { ...latest, context: [...refs.values()] });
    clearAgentContext(agent.id);
  }, [agent.id, agent.workspaceId, activeSession?.id, scope, pendingContextKey, clearAgentContext]);
  const runState = getRunState(activeSession?.id);
  const busy = runState === 'thinking' || runState === 'searching' || runState === 'using-tool';
  const providerId: ProviderId = activeSession
    ? sessionProviderId(activeSession)
    : (agent.providerId ?? 'codex');
  useEffect(()=>{
    if(connection!=='connected'||!activeSession?.id||!activeSession.codexThreadId)return;
    void refreshSessionImages(activeSession.id).catch(()=>{/* Existing local images and messages remain available offline. */});
  },[connection,activeSession?.id,activeSession?.codexThreadId,refreshSessionImages]);
  const selectedModelId = activeSession?.modelId ?? '';
  // Provider of THIS chat vs who directs the edit of its production: two separate choices, each read from its own record.
  const editRun=linkedProduction??(binding.kind==='content'?binding.mainRun:undefined);
  const [workspaceDirector,setWorkspaceDirector]=useState<EditDirector>();
  const needsDefault=!!editRun&&!editRun.editDirector&&editRun.editPreferences?.mode!=='basic';
  useEffect(()=>{if(!needsDefault)return;let live=true;void production.editDirector(agent.workspaceId).then(value=>{if(live)setWorkspaceDirector(value)}).catch(()=>{});return()=>{live=false};},[needsDefault,agent.workspaceId,providerChoiceOpen]);// eslint-disable-line react-hooks/exhaustive-deps
  const editing=editingLabel(editRun,needsDefault?workspaceDirector:undefined);
  const editingExecution=editRun&&lastExecution(editRun),editingRun=editingExecution?executionText(editingExecution,pt):undefined;
  const switchBusy=busy||!!activeSession&&isSessionBusy(activeSession.id);
  const switchPlan=providerSwitchPlan(activeSession,{busy:switchBusy,productionSessionIds:productionSessionIds(production.runs)});
  const selectedEffort: ReasoningEffort = activeSession?.reasoningEffort ?? 'medium';
  const slashToken = composerSelection.start===composerSelection.end ? slashSkillToken(message,composerSelection.end) : null;
  const slashKey = slashToken ? `${slashToken.start}:${composerSelection.end}:${slashToken.query}` : null;
  const skillMenuOpen = (skillsPickerOpen || (slashKey!==null && slashKey!==dismissedSlash)) && !busy;
  const skillChoices = skillMenuOpen ? matchingSkills(agent.skills ?? [], skillsPickerOpen?'':slashToken?.query??'') : [];

  useEffect(() => {
    let mounted = true;
    setConnection('checking');
    const check = async () => {
      try {
        const status = await getProviderStatus(providerId);
        if (mounted) setConnection(status.state);
      } catch {
        if (mounted) setConnection('error');
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 30_000);
    window.addEventListener('focus', check);
    return () => {
      mounted = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
    };
  }, [getProviderStatus, providerId]);
  useEffect(() => {
    let active = true;
    setModels([]);
    setModelsLoading(true);
    void listModels(providerId)
      .then((items) => {
        if (active) setModels(items);
      })
      .catch(() => {
        if (active) setModels([]);
      })
      .finally(() => {
        if (active) setModelsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [agent.id, listModels, providerId]);

  useEffect(() => {
    setEditingSessionId(null);
    setConfirmDeleteId(null);
    setSkillMenuIndex(0);
    setTab('chat');
  }, [agent.id]);

  useEffect(() => {
    const restored = readChatDraft(agent.id, slot);
    setComposerSelection({ start:restored.text.length, end:restored.text.length });
    setDismissedSlash(null);
    setShowLatest(false);
    setSkillMenuIndex(0);
  }, [agent.id, activeSession?.id, scope]);
  const updateDraft = (text: string, skill: string | null = selectedSkill) => {
    setComposerSelection({ start:text.length, end:text.length });
    writeChatDraft(agent.id, slot, { ...readChatDraft(agent.id, slot), text, skill });
  };
  const ensureSession = () => {
    if (activeSession) return activeSession;
    if (scopePending) throw new Error(pt ? 'Aguarde: os conteúdos ainda estão carregando.' : 'Wait: contents are still loading.');
    const session = createSession(agent.id, undefined, providerId, agent.modelId, newChatLink, 'select');
    writeChatDraft(agent.id, session.id, draft);
    writeChatDraft(agent.id, slot, { text: '', skill: null });
    return session;
  };
  useEffect(() => {
    if (selectedSkill && !agent.skills?.includes(selectedSkill)) updateDraft(message, null);
  }, [agent.skills, selectedSkill]);

  useEffect(() => {
    followLatestRef.current = true;
    if (tab === 'chat')
      requestAnimationFrame(() => bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight }));
  }, [activeSession?.id]);

  useEffect(() => {
    if (tab === 'chat' && followLatestRef.current)
      requestAnimationFrame(() =>
        bodyRef.current?.scrollTo({
          top: bodyRef.current.scrollHeight,
          behavior: reducedMotion ? 'instant' : 'smooth',
        }),
      );
  }, [activeSession?.id, activeSession?.messages.length, lastMessageContent, tab, reducedMotion]);

  useEffect(() => {
    if (contextNodes.length) {
      setTab('chat');
      requestAnimationFrame(() => composerRef.current?.focus());
    }
  }, [contextNodes.length]);

  const startSession = (target=scopeContent) => {
    if (scopePending) return;
    // A new chat opens in the selected content (own thread, same content link) or in General; never in another content.
    const content=target;
    // Untitled: the first message names it, so several chats of one content stay distinguishable (the content is shown above).
    createSession(agent.id, undefined, agent.providerId ?? 'codex', agent.modelId, content?contentLink(content):undefined, 'select');
    setTab('chat');
    onToast(content?(locale==='pt-BR'?`Nova conversa sobre “${content.title}”`:`New conversation about “${content.title}”`):locale === 'pt-BR' ? `Nova conversa com ${agent.name}` : `New conversation with ${agent.name}`);
  };

  const changeModel = (modelId: string) => {if(!comparisonModelLocked)setSessionModel(ensureSession().id, modelId || undefined);};
  const changeEffort = (effort: string) =>
    setSessionReasoningEffort(ensureSession().id, effort as ReasoningEffort);
  const chooseSkill = (skill: string) => {
    const next = !skillsPickerOpen && slashToken ? removeSlashSkillToken(message,slashToken) : {text:message,caret:composerSelection.end};
    updateDraft(next.text, skill);
    setComposerSelection({start:next.caret,end:next.caret});
    setSkillsPickerOpen(false);
    setSkillMenuIndex(0);
    requestAnimationFrame(() => {
      composerRef.current?.focus();
      composerRef.current?.setSelectionRange(next.caret,next.caret);
    });
  };

  // Videos attached to the message being written (absolute local paths; the host inspects them when the request is sent).
  const native=window.mainsAgentsDesktop;
  const slotKey=JSON.stringify(slot??null);
  const [videoAttachments,setVideoAttachments]=useState<{slot:string;items:ChatAttachment[]}>({slot:'',items:[]});
  const attachments=videoAttachments.slot===slotKey?videoAttachments.items:[];
  // Camera + screen: with two attached videos the person marks each one (Câmera / Tela). Nothing is inferred from order or name.
  const [pairDraft,setPairDraft]=useState<{slot:string;roles:Record<string,'camera'|'screen'>;voice?:'camera'|'screen';layout:'camera-corner'|'screen-full'|'alternate'}>({slot:'',roles:{},layout:'camera-corner'});
  const pair=pairDraft.slot===slotKey?pairDraft:{slot:slotKey,roles:{} as Record<string,'camera'|'screen'>,layout:'camera-corner' as const};
  const roleOf=(path:string)=>pair.roles[path.toLowerCase()];
  const setRole=(path:string,role:'camera'|'screen')=>setPairDraft(()=>{const roles:Record<string,'camera'|'screen'>={};for(const [key,value] of Object.entries(pair.roles))if(value!==role)roles[key]=value;roles[path.toLowerCase()]=role;return {...pair,slot:slotKey,roles};});
  const pairReady=attachments.length===2&&attachments.every(item=>roleOf(item.path))&&new Set(attachments.map(item=>roleOf(item.path))).size===2;
  const pairStarted=attachments.length===2&&attachments.some(item=>roleOf(item.path));
  const resetPair=()=>setPairDraft({slot:slotKey,roles:{},layout:'camera-corner'});
  const [dropping,setDropping]=useState(false),[editWorking,setEditWorking]=useState<string|null>(null);
  const addVideos=(paths:readonly string[])=>{
    const valid=paths.filter(path=>typeof path==='string'&&path&&isVideoPath(path));
    if(paths.length&&valid.length<paths.length)onToast(pt?'Só arquivos de vídeo (mp4, mov, m4v, mkv, webm, avi) podem ser anexados aqui.':'Only video files (mp4, mov, m4v, mkv, webm, avi) can be attached here.');
    if(!valid.length)return;
    setVideoAttachments(current=>{const base=current.slot===slotKey?current.items:[];return {slot:slotKey,items:[...new Map([...base,...valid.map(attachmentOf)].map(item=>[item.path.toLowerCase(),item])).values()].slice(0,5)};});
  };
  const pickVideos=async()=>{try{addVideos(await native?.files?.selectVideos?.()??[]);}catch(error){onToast(error instanceof Error?error.message:String(error));}};
  const editIntent=!comparisonMode&&!selectedSkill&&native?.state?classifyEditRequest(message):null;
  const directEdit=editIntent?.kind==='edit'||editIntent?.kind==='adjust';
  const startEdit=(text:string,videos:readonly ChatAttachment[],kind:'edit'|'adjust',sessionId?:string,sourcePair?:ChatMessageItem['sourcePair'])=>{
    if(scopePending)return;
    const target=sessionId??ensureSession().id;
    setEditWorking(target);void sendEditRequest(agent,text,videos,target,kind,sourcePair).catch(error=>onToast(error instanceof Error?error.message:String(error))).finally(()=>setEditWorking(null));
  };
  // Open usage-limit waits of this profile (host facts; the provider itself is never contacted to check).
  const [gates,setGates]=useState<ProviderGateView[]>([]);
  useEffect(()=>{if(!native?.state)return;let alive=true;const load=async()=>{try{const response=await fetch(`/api/content/provider-waits?profile=${encodeURIComponent(storageProfile())}`,{cache:'no-store'});if(!response.ok)return;const body=await response.json() as {waits?:ProviderGateView[]};if(alive&&Array.isArray(body.waits))setGates(body.waits);}catch{/* last known */}};void load();const timer=window.setInterval(()=>void load(),15000);return()=>{alive=false;window.clearInterval(timer);};},[native?.state]);
  const gate=gates.find(item=>item.providerId===providerId);
  const runEditAction=async(action:ChatEditAction,run:import('../../features/production/model').ProductionRun|undefined,messageId?:string)=>{
    if(action==='open-production'){setProductionText(undefined);setProductionOpen(true);return;}
    if(action==='cancel-measure'){if(activeSession&&messageId)try{await cancelChatEditMeasure(activeSession.id,messageId);}catch(error){onToast(error instanceof Error?error.message:String(error));}return;}
    if(!run)return;
    try{
      // Explicit Resume of a usage-limit wait: carries the wait generation the person saw (a newer limit is never cleared by it).
      if(action==='resume')await production.command(run,'resume',{authorize:true,...(run.providerWait?{waitGeneration:run.providerWait.generation}:{})});
      if(action==='cancel-edit')await production.command(run,'cancel');
      if(action==='cancel-adjust')await production.command(run,'cancel-local-adjust');
      if(action==='revert')await production.command(run,'revert-local-adjust',{authorize:true,expectedOutputSha256:run.outputVideo?.sha256});
    }catch(error){onToast(error instanceof Error?error.message:String(error));}
  };
  const sessionHasEdits=Boolean(activeSession?.messages.some(item=>item.type==='message'&&item.chatEdit));
  useEffect(()=>{if(!activeSession?.id||!sessionHasEdits)return;const id=activeSession.id;void refreshChatEdits(id);const timer=window.setInterval(()=>void refreshChatEdits(id),3000);return()=>window.clearInterval(timer);},[activeSession?.id,sessionHasEdits,refreshChatEdits]);

  const send = () => {
    const productionIntent=!comparisonMode&&!selectedSkill&&!contextNodes.length?productionChatIntent(message):null;
    if(productionIntent&&(linkedProduction||binding.kind==='content'&&binding.mainRun||productionIntent.type==='idea')){setProductionText(productionIntent.text);setProductionOpen(true);return;}
    // An unequivocal edit request goes to the local edit engine (host-decided), never as a chat turn the model cannot execute.
    if(directEdit&&editIntent){
      if(scopePending)return;
      if(pairStarted&&!pairReady){onToast(pt?'Marque um vídeo como Câmera e o outro como Tela (ou desmarque os dois para escolher um só vídeo).':'Mark one video as Camera and the other as Screen (or clear both to pick a single video).');return;}
      const target=ensureSession();
      const videos=pairReady?attachments.map(item=>({...item,role:roleOf(item.path)})):attachments;
      startEdit(message.trim(),videos,editIntent.kind as 'edit'|'adjust',target.id,pairReady?{...(pair.voice?{voice:pair.voice}:{}),layout:pair.layout}:undefined);
      setVideoAttachments({slot:slotKey,items:[]});resetPair();clearAgentContext(agent.id);writeChatDraft(agent.id,target.id,{text:'',skill:null,context:[]});
      return;
    }
    if (busy || connection !== 'connected') return;
    const decision=!comparisonMode&&!selectedSkill&&!contextNodes.length?editorialReviewCommand(message):null;
    const targets=decision?editorialState.artifacts.filter(artifact=>artifact.type===(decision.target==='files'?'file-delivery':'script-options')&&artifact.source?.sessionId===activeSession?.id&&editorialState.contents.some(content=>content.id===artifact.contentId&&content.workspaceId===agent.workspaceId&&(decision.target==='files'?content.fileDeliveryArtifactId:content.scriptOptionsArtifactId)===artifact.id)):[];
    if(decision&&targets.length){
      setReviewRequest({artifacts:structuredClone(targets),selectedId:targets[0].id,...decision,confirmedTarget:targets.length===1});
      return;
    }
    const typed = selectedSkill ? null : typedSkillCommand(message, agent.skills ?? []);
    const skill = selectedSkill ?? typed?.skill;
    const content = typed ? typed.content : message.trim();
    if (!content) {
      if (typed) chooseSkill(typed.skill);
      return;
    }
    // Sending without a chat opens one in the selected content (never a General chat for a content scope).
    if (scopePending) return;
    const target = ensureSession();
    // Attached videos travel as file references (path + name) for the model to read with its own tools; never as authorization.
    const files=attachments.map((item,index)=>({nodeId:`video-${index}-${item.path}`,kind:'file',label:item.name,content:item.path}));
    sendMessage(agent, content, [...contextNodes,...files], target.id, skill ?? undefined);
    setVideoAttachments({slot:slotKey,items:[]});
    clearAgentContext(agent.id);
    writeChatDraft(agent.id, target.id, { text: '', skill: null, context: [] });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (skillMenuOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSkillMenuIndex((index) => (skillChoices.length ? (index + 1) % skillChoices.length : 0));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSkillMenuIndex((index) =>
          skillChoices.length ? (index - 1 + skillChoices.length) % skillChoices.length : 0,
        );
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        if (skillChoices[skillMenuIndex]) chooseSkill(skillChoices[skillMenuIndex]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setSkillsPickerOpen(false);
        setDismissedSlash(slashKey);
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  const beginRename = (sessionId: string, title: string) => {
    setEditingSessionId(sessionId);
    setRenameValue(title);
    setConfirmDeleteId(null);
  };

  const finishRename = () => {
    if (editingSessionId && renameValue.trim()) renameSession(editingSessionId, renameValue);
    setEditingSessionId(null);
  };

  return (
    <div className="chat-panel editorial-chat">
      <div className="chat-top">
        <header className="chat-head">
          <span className={`conversation-avatar status-${agent.status}`} title={`${agent.role} · ${t(agentStatusLabels[agent.status])}`}><AgentAvatar name={agent.name} image={agent.avatarImage} /><i aria-hidden="true"/></span>
          <div className="chat-head-identity">
          {sessionId?<strong className="collaboration-agent-name">{agent.name}</strong>:<SelectMenu className="conversation-agent-picker" value={agent.id} onChange={onSelectAgent} ariaLabel={locale==='pt-BR'?'Conversar com':'Chat with'} options={agents.filter(item=>item.workspaceId===agent.workspaceId).map(item=>({value:item.id,label:item.name}))}/>}
          {activeSession&&<span className="chat-head-subtitle">{activeSession.title} · {countMessages(activeSession.messages.filter(item=>item.type==='message').length, locale)}</span>}
          {!comparisonMode&&<ConversationProviderBar providerId={providerId} modelLabel={models.find(model=>model.id===selectedModelId)?.name||selectedModelId||undefined} connection={connection} editing={editing} editingRun={editingRun} busy={switchBusy} readOnly={!!sessionId} onChoose={()=>setProviderChoiceOpen(true)} onOpenProduction={sessionId?undefined:()=>{setProductionText(undefined);setProductionOpen(true)}}/>}
          </div>
          <div className="chat-head-actions">
            <details className="conversation-options" onClick={event=>{if((event.target as HTMLElement).closest('button'))event.currentTarget.open=false;}} onKeyDown={event=>{if(event.key==='Escape'&&event.currentTarget.open){event.preventDefault();event.currentTarget.open=false;event.currentTarget.querySelector('summary')?.focus();}}}><summary aria-label={locale==='pt-BR'?'Opções da conversa':'Conversation options'} title={locale==='pt-BR'?'Opções da conversa':'Conversation options'}><Icon name="more"/></summary><div>
            {!comparisonMode&&<button className="soft-button" onClick={()=>setComparisonBrief(message)}>{locale==='pt-BR'?'Consultar dois agentes':'Consult two agents'}</button>}
            {!comparisonMode&&pairedComparison&&<button className="soft-button" disabled={!comparisonAvailable} onClick={()=>showComparison(pairedComparison.id)}>{locale==='pt-BR'?'Reabrir comparação':'Reopen comparison'}</button>}
            <button
              className="icon-button"
              aria-label={t('New session')}
              title={t('New session')}
              disabled={!!sessionId}
              onClick={()=>startSession()}
            >
              <Icon name="plus" />
            </button>
            <button
              className="icon-button"
              aria-label={locale === 'pt-BR' ? 'Abrir todas as sessões' : 'Open all sessions'}
              title={locale === 'pt-BR' ? 'Abrir todas as sessões' : 'Open all sessions'}
              onClick={onNavigateHistory}
            >
              <Icon name="history" />
            </button>
            <button className="icon-button" disabled={!!sessionId} title={locale==='pt-BR'?'Sessões deste agente':'Agent sessions'} onClick={()=>setTab('sessions')}><Icon name="history"/></button>
            {agent.tools.includes('subagents')&&<button className="icon-button" disabled={busy||!agents.some(item=>item.workspaceId===agent.workspaceId&&item.id!==agent.id)} aria-label={locale==='pt-BR'?'Enviar a outro agente':'Send to another agent'} title={locale==='pt-BR'?'Enviar a outro agente':'Send to another agent'} onClick={()=>setHandoffBrief({text:'',sessionId:ensureSession().id})}><Icon name="users"/></button>}
            <button className="icon-button" title={t('Context')} onClick={()=>setTab('context')}><Icon name="folder"/></button>
            <button
              className="icon-button"
              aria-label={t('Agent settings')}
              title={t('Agent settings')}
              onClick={onNavigateSettings}
            >
              <Icon name="more" />
            </button>
            <button
              className="chat-expand-button"
              aria-label={t(presentation === 'side' ? 'Open chat in center' : 'Dock chat to side')}
              title={t(presentation === 'side' ? 'Open chat in center' : 'Dock chat to side')}
              onClick={onTogglePresentation}
            >
              <Icon name="panel" />
              <span>{t(presentation === 'side' ? 'Full view' : 'Dock')}</span>
            </button>
            </div></details>
            <button className="icon-button conversation-expand" aria-label={t(presentation === 'side' ? 'Open chat in center' : 'Dock chat to side')} title={t(presentation === 'side' ? 'Open chat in center' : 'Dock chat to side')} onClick={onTogglePresentation}><Icon name="panel"/></button>
            <button
              className="icon-button"
              aria-label={t('Close chat')}
              title={t('Close chat')}
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </header>
        {!sessionId&&!comparisonMode&&<ContentScopeBar spaces={spaces} scope={scope} agents={workspaceAgents} currentAgentId={agent.id} pt={pt} disabled={creatingContent||scopePending}
          onSelect={next=>{selectScope(agent.workspaceId,next);setNewContentOpen(false);}} onNewContent={()=>{setNewContentTitle('');setNewContentOpen(true);}} onSelectAgent={onSelectAgent}
          onDeleteContent={scopeContent?()=>setContentToDelete({contentId:scopeContent.id,workspaceId:agent.workspaceId,title:scopeContent.title}):undefined}/>}
        {newContentOpen&&<form className="new-content-session" onSubmit={event=>{event.preventDefault();void startContentSession();}}>
          <label>{pt?'Nome do conteúdo':'Content name'}<input autoFocus aria-label={pt?'Nome do novo conteúdo':'New content name'} value={newContentTitle} maxLength={120} disabled={creatingContent} onChange={event=>setNewContentTitle(event.target.value)} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();setNewContentOpen(false);}}} placeholder={pt?'Ex.: Tutorial de automação no Excel':'E.g. Excel automation tutorial'}/></label>
          <small>{pt?`Só o nome basta: não precisa de ideia aprovada. Abre uma conversa nova com ${agent.name} (mesmas skills e fluxo); conversa, arquivos e produção ficam separados por conteúdo.`:`A name is enough: no approved idea needed. Opens a fresh chat with ${agent.name} (same skills and flow); chat, files and production stay separate per content.`}</small>
          <div><button type="button" className="text-link" disabled={creatingContent} onClick={()=>setNewContentOpen(false)}>{t('Cancel')}</button><button type="submit" className="primary-button" disabled={creatingContent||!newContentTitle.trim()}>{creatingContent?(pt?'Criando…':'Creating…'):(pt?'Criar conteúdo':'Create content')}</button></div>
        </form>}
        <AgentConnectionBar agent={agent} session={activeSession} ensureSession={ensureSession}
          busy={busy} providerId={providerId} onError={onToast}/>
        <nav className="chat-tabs" hidden={tab==='chat'} aria-label={`${agent.name} panel`}>
          {(['chat', 'sessions', 'context'] as ChatTab[]).map((item) => (
            <button
              key={item}
              className={tab === item ? 'active' : ''}
              aria-selected={tab === item}
              onClick={() => setTab(item)}
            >
              {t(tabLabels[item])}
            </button>
          ))}
          <span className={`run-state ${runState}`}>
            <i />
            {t(stateLabels[runState])}
          </span>
        </nav>
      </div>

      {tab === 'chat' && activeSession && <div className="chat-approval-dock"><RuntimeActionApprovals sessionId={activeSession.id}/></div>}
      {tab === 'chat' && (
        <div
          className="chat-body"
          ref={bodyRef}
          onScroll={(event) => {
            const element = event.currentTarget;
            followLatestRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 72;
            setShowLatest(!followLatestRef.current);
          }}
        >
          {activeSession && (
            <div className="active-session-bar">
              <span>{activeSession.title}</span>
              {activeSession.contentId&&<button type="button" onClick={()=>window.dispatchEvent(new CustomEvent('mainsagents:open-content',{detail:{contentId:activeSession.contentId}}))}>{locale==='pt-BR'?'Abrir conteúdo':'Open content'}</button>}
              {!sessionId&&!comparisonMode&&!scopePending&&binding.kind==='generic'&&<button type="button" onClick={()=>setOrganizing(activeSession)}>{pt?'Organizar em conteúdo':'Organize into content'}</button>}
              {!sessionId&&<button onClick={() => setTab('sessions')}>{t('All sessions')}</button>}
            </div>
          )}
          {contentSummary?<ContentSessionCard summary={contentSummary} pt={locale==='pt-BR'} onProduction={()=>{setProductionText(undefined);setProductionOpen(true)}} onScript={()=>{setProductionText(undefined);setProductionOpen(true)}} onRecorded={()=>setRecordedOpen(true)} onMainSession={target=>{openSession(target.agentId,target.sessionId);if(target.agentId!==agent.id)onSelectAgent?.(target.agentId);setTab('chat');}}/>
          :<div className="production-summary"><span>{linkedProduction?productionStageLabel(linkedProduction.stage,locale==='pt-BR'):(locale==='pt-BR'?'Ideia → vídeo → publicação':'Idea → video → publication')}</span><button className="text-link" onClick={()=>{setProductionText(undefined);setProductionOpen(true)}}>{locale==='pt-BR'?'Ver produção':'View production'}</button></div>}
          {activeSession&&<NativeDelegationWork sessionId={activeSession.id}/>}
          {!activeSession&&!sessionId&&scope!=='general'&&(
            <div className="chat-empty scope-empty" role="status">
              {scopeContent?<>
                <h3>{pt?`${agent.name} ainda não conversou sobre “${scopeContent.title}”`:`${agent.name} has no chat about “${scopeContent.title}” yet`}</h3>
                <p>{pt?'A conversa nova já nasce ligada a este conteúdo, sem misturar com outros vídeos. As conversas dos outros agentes deste conteúdo estão logo acima.':'The new chat is linked to this content from the start, never mixed with other videos. Other agents’ chats of this content are listed above.'}</p>
                <button type="button" className="primary-button" onClick={()=>startSession()}>{pt?`Começar conversa sobre “${scopeContent.title}”`:`Start a chat about “${scopeContent.title}”`}</button>
              </>:<>
                <h3>{pt?`Nenhuma conversa de ${agent.name} precisa de atenção`:`No ${agent.name} chat needs attention`}</h3>
                <p>{pt?'Escolha um conteúdo ou Geral para continuar.':'Choose a content or General to continue.'}</p>
                <button type="button" className="soft-button" onClick={()=>selectScope(agent.workspaceId,'general')}>{pt?'Ir para Geral':'Go to General'}</button>
              </>}
            </div>
          )}
          {(activeSession ? activeSession.messages.length === 0 : sessionId || scope==='general') && (
            <div className="chat-empty">
              <AgentAvatar name={agent.name} image={agent.avatarImage} />
              <h3>
                {locale === 'pt-BR'
                  ? 'O que vamos criar?'
                  : 'What shall we create?'}
              </h3>
              <p>{agent.description || (locale==='pt-BR'?'Envie uma ideia, peça uma pesquisa ou traga referências do Canvas.':'Share an idea, ask for research, or bring references from the Canvas.')}</p>
            </div>
          )}
          {chatFeed(activeSession?.messages ?? []).map((entry) => {
            if (entry.kind === 'run') return <RunStatusLine key={entry.run.id} run={entry.run} steps={entry.steps}/>;
            const item = entry.item;
            return item.type === 'activity' ? (
              <div className={`tool-activity ${item.status}`} key={item.id}>
                <span className="activity-symbol" aria-hidden="true">{item.status==='done'?'✓':item.status==='error'?'!':<Icon name="spark"/>}</span>
                <span>{item.label}</span>
              </div>
            ) : (
              <article className={`chat-message ${item.role === 'user' ? 'user' : ''}`} key={item.id}>
                <div className="message-meta">
                  <b>{item.sourceAgentName??(item.role === 'user' ? t('You') : agent.name)}</b>
                  <span>{formatTime(item.createdAt, locale)}</span>
                </div>
                {item.role==='user'&&item.sourceAgentName?<details className="received-agent-task">
                  <summary>{locale==='pt-BR'?`Tarefa recebida de ${item.sourceAgentName}`:`Task received from ${item.sourceAgentName}`}</summary>
                  <MessageMarkdown className="message-content" text={item.content}/>
                </details>:item.content&&(item.role==='agent'&&activeSession?<ChatDeliveryCard agent={agent} session={activeSession} message={item}/>:item.role==='agent'?<MessageMarkdown className="message-content" text={item.content}/>:<p className="message-content">{item.content}</p>)}
                {item.role==='user'?<MessageAttachments message={item} pt={pt}/>:null}
                {item.adjustPreview?<AdjustPreview message={item} pt={pt}/>:null}
                {item.role==='user'&&item.chatEdit&&activeSession?(()=>{const request=chatEditRequests[item.id],run=request?.runId?production.runs.find(entry=>entry.id===request.runId):undefined;
                  return <ChatEditCard request={request} run={run} mediaJobs={editorial.mediaJobs} pt={pt} working={editWorking===activeSession.id||request?.status==='pending'}
                    onAdmit={extra=>void admitChatEdit(activeSession.id,item.id,extra)}
                    onOption={window=>startEdit(withTimeWindow(item.content,window),[],'adjust',activeSession.id)}
                    onAction={action=>void runEditAction(action,run,item.id)}/>;})():null}
                {item.role==='user'&&!item.chatEdit&&!item.sourceAgentName&&native?.state&&!comparisonMode&&activeSession?(()=>{const intent=classifyEditRequest(item.content);if(intent.kind!=='ambiguous')return null;
                  const videos=messageVideos(item),adjust=intent.window&&intent.window.end>intent.window.start;
                  if(!adjust&&!videos.length&&!linkedProduction&&!editorialState.assets?.some(asset=>asset.contentId===activeSession.contentId&&asset.kind==='video'&&asset.role==='source'))return null;
                  const text=adjust?withTimeWindow(item.content.replace(/\?/g,'').replace(/^\s*(?:pode|poderia|consegue|você pode|voce pode|vc pode|can you|could you)\s+/i,''),intent.window!):(pt?'Editar este vídeo':'Edit this video');
                  return <div className="chat-edit-cta"><span>{pt?'Quer que o app faça isso agora?':'Should the app do this now?'}</span><button type="button" className="soft-button" disabled={editWorking===activeSession.id} onClick={()=>startEdit(text,videos,adjust?'adjust':'edit',activeSession.id)}>{adjust?(pt?'Fazer este ajuste':'Make this adjustment'):(pt?'Editar este vídeo':'Edit this video')}</button></div>;})():null}
                {item.receipts?.length ? <DeliveryReceiptCard receipts={item.receipts}/> : null}
                {item.images?.length ? <ChatMessageImages images={item.images} onLoad={()=>{if(followLatestRef.current&&bodyRef.current)bodyRef.current.scrollTop=bodyRef.current.scrollHeight;}}/>:null}
                {item.selectedSkill && (
                  <div className="message-skill-used">
                    <span>/</span>
                    {item.selectedSkill}
                  </div>
                )}
                {item.contextNodes && item.contextNodes.length > 0 && (
                  <div className="message-context-used">
                    <span>{locale === 'pt-BR' ? 'Contexto usado' : 'Used context'}</span>
                    <div>
                      {item.contextNodes.map((context) => (
                        <i key={context.nodeId}>{context.label}</i>
                      ))}
                    </div>
                  </div>
                )}
                {item.role === 'agent' && (
                  <div className="message-actions">
                    <button
                      disabled={hasMessageNode(item.id)}
                      onClick={() => {
                        const origins=editorialState.artifacts.filter(artifact=>artifact.source?.messageId===item.id&&artifact.source?.sessionId===activeSession?.id);
                        const origin=origins.length===1?origins[0]:undefined;
                        const link=origin?{contentId:origin.contentId,topicId:origin.topicId}:origins.length?undefined:{contentId:activeSession?.contentId,topicId:activeSession?.topicId};
                        const result = addAgentResponse(item, agent, link);
                        onOpenCanvas();
                        onToast(
                          locale === 'pt-BR'
                            ? `${result.label} adicionado ao Canvas`
                            : `${result.label} added to Canvas`,
                        );
                      }}
                    >
                      {t(hasMessageNode(item.id) ? 'Added to Canvas' : 'Add to Canvas')}
                    </button>
                    <button
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(item.content)
                          .then(() => onToast(t('Copied to clipboard')))
                          .catch(() => onToast(t('Could not copy message')));
                      }}
                    >
                      {t('Copy')}
                    </button>
                    {!comparisonMode&&<button onClick={()=>setComparisonBrief(item.content)}>{locale==='pt-BR'?'Consultar dois agentes':'Consult two agents'}</button>}
                    {!comparisonMode&&agent.tools.includes('subagents')&&agents.some(candidate=>candidate.workspaceId===agent.workspaceId&&candidate.id!==agent.id)&&<button disabled={busy} onClick={()=>setHandoffBrief({text:item.content,sessionId:ensureSession().id})}>{locale==='pt-BR'?'Enviar a outro agente':'Send to another agent'}</button>}
                  </div>
                )}
              </article>
            );
          })}
          {linkedHandoffs.map(item=><div className={`handoff-card ${item.status}`} key={item.id}>
            <div><span>{agents.find(candidate=>candidate.id===item.sourceAgentId)?.name??'Agent'} → {agents.find(candidate=>candidate.id===item.targetAgentId)?.name??'Agent'}</span><small>{/* "completed" only means the specialist answered; its answer (not this label) says whether a file was produced. */}{locale==='pt-BR'?({running:'Trabalhando',completed:'Especialista respondeu',error:'Erro',cancelled:'Interrompido',interrupted:'Interrompido ao fechar o app'}[item.status]):item.status==='completed'?'specialist replied':item.status}</small></div>
            <b>{item.title}</b>
            {item.files.length>0&&<small>{item.files.length} {locale==='pt-BR'?'arquivo(s) referenciado(s)':'file reference(s)'}</small>}
            {item.error&&<p>{item.error}</p>}
            <button onClick={()=>showCollaboration(item.id)}>{locale==='pt-BR'?'Ver os dois chats':'View both chats'}</button>
          </div>)}
          {busy && !activeSession?.messages.some(item => item.type === 'activity' && item.kind === 'run' && !item.endedAt) && <RunStatusLine/>}
          {runState === 'error' && (
            <div className="chat-error" role="alert">
              <b>{t('Could not finish this response.')}</b>
              <span>
                {lastRunError?.type === 'activity'
                  ? lastRunError.label
                  : t('Check the provider connection and send another message to retry.')}
              </span>
            </div>
          )}
        </div>
      )}

      {tab === 'sessions' && (
        <div className="chat-body chat-tab-body">
          <div className="chat-tab-heading sessions-heading">
            <div>
              <b>{scopeTitle}</b>
              <span>
                {agentSessions.length}{' '}
                {pt ? `conversas de ${agent.name} neste espaço` : `${agent.name} chats in this space`}
              </span>
            </div>
            <div className="sessions-heading-actions">
              <button className="soft-button" disabled={comparisonMode} onClick={()=>{setNewContentTitle('');setNewContentOpen(true)}}>
                <Icon name="plus" />
                {locale==='pt-BR'?'Novo conteúdo':'New content'}
              </button>
              {scope!=='recovery'&&<button className="soft-button" onClick={()=>startSession()}>
                <Icon name="plus" />
                {t('New')}
              </button>}
            </div>
          </div>
          {!agentSessions.length&&<p className="panel-sessions-empty" role="status">{scope==='general'?(pt?`${agent.name} não tem conversas em Geral. Use “Novo” para uma ideia solta.`:`${agent.name} has no General chats. Use “New” for a loose idea.`):scope==='recovery'?(pt?'Nada precisa de atenção aqui.':'Nothing needs attention here.'):(pt?`${agent.name} ainda não tem conversa neste conteúdo. Use “Novo” para começar.`:`${agent.name} has no chat in this content yet. Use “New” to start.`)}</p>}
          <div className="panel-sessions">
            {agentSessions.map((session) => (
              <article
                className={`panel-session ${activeSession?.id === session.id ? 'active' : ''}`}
                key={session.id}
              >
                {editingSessionId === session.id ? (
                  <input
                    className="session-rename"
                    autoFocus
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onBlur={finishRename}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') finishRename();
                      if (event.key === 'Escape') setEditingSessionId(null);
                    }}
                  />
                ) : (
                  <button
                    className="panel-session-main"
                    onClick={() => {
                      openSession(agent.id, session.id);
                      setTab('chat');
                    }}
                  >
                    <span>
                      <b>{session.title}</b>
                      {(()=>{const label=sessionListLabel(contentBinding(session,{workspaceId:agent.workspaceId,contents:editorialState.contents,runs:production.runs}),locale==='pt-BR');return label&&<small className="session-content-label">{label}</small>;})()}
                      <small>
                        {countMessages(session.messages.length, locale)} ·{' '}
                        {formatSessionDate(session.updatedAt, locale)}
                      </small>
                    </span>
                    {activeSession?.id === session.id && <i>{t('Active')}</i>}
                  </button>
                )}
                {editingSessionId !== session.id && (
                  <div className="session-actions">
                    {confirmDeleteId === session.id ? ((()=>{
                      // A chat that conducts a production is part of the content: removing only this projection would come back.
                      const role=production.runs.find(run=>[run.sourceSession.id,run.editorSession.id,run.publisherSession?.id].includes(session.id));
                      const roleContent=role&&editorialState.contents.find(item=>item.id===role.contentId);
                      return role?<>
                        <small className="session-delete-note session-role-note">{pt?'Esta conversa conduz a produção deste conteúdo. Para removê-la, exclua o conteúdo inteiro.':'This chat conducts this content’s production. To remove it, delete the whole content.'}</small>
                        <button onClick={() => setConfirmDeleteId(null)}>{t('Cancel')}</button>
                        <button className="danger" onClick={()=>{setConfirmDeleteId(null);setContentToDelete({contentId:role.contentId,workspaceId:role.workspaceId,title:roleContent?.title??role.name});}}>{pt?'Excluir conteúdo inteiro…':'Delete whole content…'}</button>
                      </>:<>
                        {session.contentId&&<small className="session-delete-note">{pt?'Remove só esta conversa. O conteúdo e as outras conversas dele continuam.':'Removes only this chat. The content and its other chats stay.'}</small>}
                        {deleteError?.sessionId===session.id&&<small className="session-delete-note" role="alert">{deleteError.message}</small>}
                        <button disabled={deletingSessionId===session.id} onClick={() => {setConfirmDeleteId(null);setDeleteError(null);}}>{t('Cancel')}</button>
                        <button
                          className="danger"
                          disabled={deletingSessionId===session.id}
                          aria-busy={deletingSessionId===session.id}
                          onClick={() => {
                            setDeletingSessionId(session.id);setDeleteError(null);
                            deleteSession(session.id).then(()=>{setConfirmDeleteId(null);onToast(pt?'Conversa excluída':'Chat deleted');},error=>{
                              if(error instanceof DeletionRefused&&error.code==='production-role'&&error.contentId){setConfirmDeleteId(null);setContentToDelete({contentId:error.contentId,workspaceId:error.workspaceId??agent.workspaceId,title:editorialState.contents.find(item=>item.id===error.contentId)?.title??session.title});return;}
                              setDeleteError({sessionId:session.id,message:error instanceof Error?error.message:String(error)});
                            }).finally(()=>setDeletingSessionId(null));
                          }}
                        >
                          {deletingSessionId===session.id?(pt?'Excluindo…':'Deleting…'):t('Confirm')}
                        </button>
                      </>;})()
                    ) : (
                      <>
                        <button
                          aria-label={`${t('Rename')} ${session.title}`}
                          onClick={() => beginRename(session.id, session.title)}
                        >
                          {t('Rename')}
                        </button>
                        {!session.contentId&&!comparisonMode&&<button aria-label={pt?`Organizar ${session.title} em um conteúdo`:`Organize ${session.title} into a content`} onClick={()=>setOrganizing(session)}>{pt?'Organizar':'Organize'}</button>}
                        <button
                          aria-label={`${t('Delete')} ${session.title}`}
                          onClick={() => {
                            setConfirmDeleteId(session.id);
                            setEditingSessionId(null);
                          }}
                        >
                          {t('Delete')}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      )}

      {tab === 'context' && (
        <div className="chat-body chat-tab-body">
          <div className="chat-tab-heading">
            <b>{t('Agent context')}</b>
            <span>{t('Local agent configuration')}</span>
          </div>
          <div className="context-block">
            <span>{t('Instructions')}</span>
            <p>{agent.instructions}</p>
          </div>
          <div className="context-block">
            <span>{t('Workspace')}</span>
            <p>{getWorkspaceById(agent.workspaceId)?.name ?? agent.workspaceId}</p>
          </div>
          <div className="context-block">
            <span>{t('Tools')}</span>
            <div className="context-tools">
              {agent.tools.map((tool) => (
                <i key={tool}>{t(agentToolDetails[tool].label)}</i>
              ))}
            </div>
          </div>
          {agent.skillsDirectory && (
            <div className="context-block">
              <span>{t('Skills')}</span>
              <p>{agent.skillsDirectory}</p>
              <div className="context-tools">
                {(agent.skills ?? []).map((skill) => (
                  <i key={skill}>{skill}</i>
                ))}
              </div>
            </div>
          )}
          <div className="context-note">
            <Icon name="link" />
            {t('Canvas context will include selected objects when Codex is connected.')}
          </div>
        </div>
      )}

      {tab === 'chat' && (
        <footer className="chat-compose">
          {connection !== 'connected' && (
            <div className="composer-connection" role="status">
              <span>
                {connection === 'checking'
                  ? t('Checking connection…')
                  : locale === 'pt-BR'
                    ? `Conecte ${providerId === 'claude' ? 'Claude Code' : providerId === 'codex' ? 'Codex CLI' : 'Gemini'} para enviar mensagens.`
                    : `Connect ${providerId === 'claude' ? 'Claude Code' : providerId === 'codex' ? 'Codex CLI' : 'Gemini'} to send messages.`}
              </span>
              {connection !== 'checking' && (
                <button className="text-link" onClick={onProviderSettings}>
                  {locale === 'pt-BR' ? 'Abrir conexões' : 'Open connections'}
                </button>
              )}
            </div>
          )}
          {showLatest && (
            <button
              className="latest-message-button soft-button"
              onClick={() => {
                followLatestRef.current = true;
                setShowLatest(false);
                bodyRef.current?.scrollTo({
                  top: bodyRef.current.scrollHeight,
                  behavior: reducedMotion ? 'instant' : 'smooth',
                });
              }}
            >
              {locale === 'pt-BR' ? 'Ir para a última mensagem' : 'Jump to latest message'} ↓
            </button>
          )}
          <div className={`composer${dropping?' is-dropping':''}`}
            onDragOver={event=>{if(!native?.files||!event.dataTransfer.types.includes('Files'))return;event.preventDefault();event.dataTransfer.dropEffect='link';setDropping(true);}}
            onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setDropping(false);}}
            onDrop={event=>{if(!native?.files||!event.dataTransfer.files.length)return;event.preventDefault();setDropping(false);const paths=Array.from(event.dataTransfer.files).map(file=>{try{return native.files!.pathForFile(file);}catch{return '';}});addVideos(paths.filter(Boolean));}}>
            {skillMenuOpen && (
              <div
                className="skill-command-menu"
                id="agent-skill-menu"
                role="listbox"
                aria-label={locale === 'pt-BR' ? 'Skills deste agente' : 'This agent’s skills'}
              >
                <div className="skill-command-heading">
                  <span>{locale === 'pt-BR' ? 'Skills do agente' : 'Agent skills'}</span>
                  <small>
                    {locale === 'pt-BR' ? '↑↓ navegar · Enter selecionar' : '↑↓ navigate · Enter select'}
                  </small>
                </div>
                {skillChoices.length ? (
                  skillChoices.map((skill, index) => (
                    <button
                      id={'skill-option-' + index}
                      key={skill}
                      type="button"
                      role="option"
                      aria-selected={index === skillMenuIndex}
                      className={index === skillMenuIndex ? 'active' : ''}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => chooseSkill(skill)}
                    >
                      <span className="skill-command-symbol">/</span>
                      <span>{skill}</span>
                    </button>
                  ))
                ) : (
                  <div className="skill-command-empty">
                    {agent.skills?.length
                      ? locale === 'pt-BR'
                        ? 'Nenhuma skill corresponde à busca.'
                        : 'No matching skill.'
                      : locale === 'pt-BR'
                        ? 'Este agente ainda não tem skills vinculadas.'
                        : 'This agent has no associated skills yet.'}
                    <button type="button" onClick={onNavigateSettings}>
                      {locale === 'pt-BR' ? 'Gerenciar skills' : 'Manage skills'}
                    </button>
                  </div>
                )}
              </div>
            )}
            {selectedSkill && (
              <div className="composer-selected-skill">
                <span>{locale === 'pt-BR' ? 'Usar skill' : 'Use skill'}</span>
                <button
                  type="button"
                  onClick={() => {
                    updateDraft(message, null);
                    composerRef.current?.focus();
                  }}
                  aria-label={
                    locale === 'pt-BR'
                      ? 'Remover skill ' + selectedSkill + ' da mensagem'
                      : 'Remove skill ' + selectedSkill + ' from message'
                  }
                >
                  /{selectedSkill}
                  <b aria-hidden="true">×</b>
                </button>
              </div>
            )}
            {contextNodes.length > 0 && (
              <div className="composer-context">
                <span>{t('Context')}</span>
                <div>
                  {contextNodes.map((context) => (
                    <button
                      key={context.nodeId}
                      aria-label={
                        locale === 'pt-BR'
                          ? `Remover ${context.label} do contexto`
                          : `Remove ${context.label} from context`
                      }
                      onClick={() => writeChatDraft(agent.id, slot, { ...draft, context: draft.context?.filter(ref => ref.nodeId !== context.nodeId) })}
                    >
                      {context.label}
                      <b aria-hidden="true">×</b>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {attachments.length>0&&<div className="composer-attachments">
              <span>{pt?'Vídeo':'Video'}</span>
              {attachments.map(item=><button key={item.path} type="button" title={item.path} aria-label={pt?`Remover ${item.name} da mensagem`:`Remove ${item.name} from the message`} onClick={()=>{setVideoAttachments({slot:slotKey,items:attachments.filter(other=>other.path!==item.path)});resetPair();}}>🎞 {item.name}<b aria-hidden="true">×</b></button>)}
            </div>}
            {attachments.length===2&&<fieldset className="composer-pair" data-od-id="composer-pair">
              <legend>{pt?'Câmera + tela? Marque cada vídeo (opcional)':'Camera + screen? Mark each video (optional)'}</legend>
              {attachments.map(item=><div className="composer-pair-row" key={item.path} role="radiogroup" aria-label={pt?`Papel de ${item.name}`:`Role of ${item.name}`}>
                <span title={item.path}>{item.name}</span>
                {(['camera','screen'] as const).map(role=><label key={role} className={`composer-role${roleOf(item.path)===role?' is-on':''}`}><input type="radio" name={`role-${item.path}`} checked={roleOf(item.path)===role} onChange={()=>setRole(item.path,role)}/>{role==='camera'?(pt?'Câmera':'Camera'):(pt?'Tela':'Screen')}</label>)}
              </div>)}
              {pairReady&&<div className="composer-pair-options">
                <label>{pt?'Voz':'Voice'}<select value={pair.voice??''} onChange={event=>setPairDraft({...pair,slot:slotKey,voice:(event.target.value||undefined) as 'camera'|'screen'|undefined})}><option value="" title={pt?'Câmera se tiver áudio; senão, tela':'Camera if it has audio, else screen'}>{pt?'Automática':'Automatic'}</option><option value="camera">{pt?'Câmera':'Camera'}</option><option value="screen">{pt?'Tela':'Screen'}</option></select></label>
                <label>{pt?'Layout':'Layout'}<select value={pair.layout} onChange={event=>setPairDraft({...pair,slot:slotKey,layout:event.target.value as 'camera-corner'|'screen-full'|'alternate'})}><option value="camera-corner">{pt?'Tela com câmera no canto':'Screen with camera in the corner'}</option><option value="screen-full">{pt?'Tela inteira':'Full screen'}</option><option value="alternate">{pt?'Alternar câmera e tela':'Alternate camera and screen'}</option></select></label>
              </div>}
              {pairStarted&&!pairReady&&<p className="composer-pair-hint" role="note">{pt?'Marque um como Câmera e o outro como Tela.':'Mark one as Camera and the other as Screen.'}</p>}
            </fieldset>}
            {gate&&<div className="composer-provider-wait" role="status" data-od-id="composer-provider-wait">{providerGateNotice(gate,pt,locale)}</div>}
            {missingContext.length > 0 && <div className="composer-draft-warning" role="status">
              <span>{locale === 'pt-BR' ? 'Contexto indisponível: ' : 'Unavailable context: '}{missingContext.map(ref => ref.label).join(', ')}. {locale === 'pt-BR' ? 'Não será enviado.' : 'Will not be sent.'}</span>
              <button type="button" className="text-link" onClick={() => writeChatDraft(agent.id, slot, { ...draft, context: draft.context?.filter(ref => contextNodes.some(item => item.nodeId === ref.nodeId)) })}>{locale === 'pt-BR' ? 'Remover referências' : 'Remove references'}</button>
            </div>}
            <textarea
              ref={composerRef}
              value={message}
              onChange={(event) => {
                updateDraft(event.target.value);
                setComposerSelection({start:event.target.selectionStart,end:event.target.selectionEnd});
                setDismissedSlash(null);
                setSkillMenuIndex(0);
              }}
              onSelect={(event)=>{
                const input=event.currentTarget;
                setComposerSelection({start:input.selectionStart,end:input.selectionEnd});
                setSkillMenuIndex(0);
              }}
              onKeyDown={onKeyDown}
              aria-haspopup="listbox"
              aria-expanded={skillMenuOpen}
              aria-controls={skillMenuOpen ? 'agent-skill-menu' : undefined}
              aria-activedescendant={
                skillMenuOpen && skillChoices.length ? 'skill-option-' + skillMenuIndex : undefined
              }
              aria-label={locale === 'pt-BR' ? `Pergunte para ${agent.name}` : `Ask ${agent.name}`}
              placeholder={
                busy
                  ? locale==='pt-BR'?'Prepare a próxima mensagem enquanto o agente responde…':'Draft your next message while the agent responds…'
                  : locale === 'pt-BR'
                    ? 'O que vamos criar juntos?'
                    : 'What shall we create together?'
              }
            />
            <div className="composer-bar">
              <div className="composer-options-root" ref={composerOptionsRef} onKeyDown={event=>{if(event.key==='Escape'&&composerOptionsOpen){event.preventDefault();setComposerOptionsOpen(false);composerOptionsRef.current?.querySelector<HTMLButtonElement>('.composer-options-trigger')?.focus();}}}>
                <button className="composer-options-trigger" type="button" aria-label={locale==='pt-BR'?'Modelo, esforço e skills':'Model, effort and skills'} aria-expanded={composerOptionsOpen} onClick={()=>setComposerOptionsOpen(open=>!open)}><Icon name="plus"/></button>
                {composerOptionsOpen && <div className="composer-options-popover" aria-label={locale==='pt-BR'?'Opções da mensagem':'Message options'}>
                <h3>{locale==='pt-BR'?'Como o agente responde':'How the agent responds'}</h3>
              <div className="chat-model-picker">
                {comparisonModelLocked&&<span className="composer-draft-warning">{locale==='pt-BR'?'Modelo definido nesta comparação. Inicie outra consulta para mudar.':'Model fixed for this comparison. Start another consultation to change it.'}</span>}
                <span>{t('Model')}</span>
                <SelectMenu
                  className="chat-select model-select"
                  ariaLabel={t('Model')}
                  value={selectedModelId}
                  disabled={comparisonModelLocked || busy || modelsLoading || models.length === 0}
                  placement="top"
                  onChange={changeModel}
                  options={[
                    {
                      value: '',
                      label: modelsLoading
                        ? t('Loading models…')
                        : models.length
                          ? t('Provider default')
                          : t('Models unavailable'),
                    },
                    ...(activeSession?.modelId && !models.some((model) => model.id === activeSession.modelId)
                      ? [{ value: activeSession.modelId, label: activeSession.modelId }]
                      : []),
                    ...models.map((model) => ({ value: model.id, label: model.name })),
                  ]}
                />
              </div>
              <div className="chat-effort-picker">
                <span>{locale === 'pt-BR' ? 'Esforço' : 'Effort'}</span>
                <SelectMenu
                  className="chat-select effort-select"
                  ariaLabel={locale === 'pt-BR' ? 'Esforço do modelo' : 'Model effort'}
                  value={selectedEffort}
                  disabled={busy}
                  placement="top"
                  onChange={changeEffort}
                  options={[
                    { value: 'low', label: locale === 'pt-BR' ? 'Leve' : 'Light' },
                    { value: 'medium', label: locale === 'pt-BR' ? 'Médio' : 'Medium' },
                    { value: 'high', label: locale === 'pt-BR' ? 'Alto' : 'High' },
                    { value: 'xhigh', label: locale === 'pt-BR' ? 'Extra alto' : 'Extra High' },
                  ]}
                />
              </div>
                <button className="composer-skill-action" type="button" disabled={busy} onClick={()=>{setComposerOptionsOpen(false);setSkillsPickerOpen(true);composerRef.current?.focus();}}><Icon name="spark"/>{locale==='pt-BR'?'Selecionar uma skill':'Select a skill'}<span>/</span></button>
                <button className="composer-skill-action" type="button" onClick={()=>{setComposerOptionsOpen(false);onOpenCanvas();}}><Icon name="canvas"/>{locale==='pt-BR'?'Escolher contexto no Canvas':'Choose Canvas context'}</button>
                </div>}
              </div>
              <button className="composer-model-summary" type="button" onClick={()=>setComposerOptionsOpen(true)} title={locale==='pt-BR'?'Alterar modelo e esforço':'Change model and effort'}>{models.find(model=>model.id===selectedModelId)?.name || selectedModelId || (providerId==='codex'?'Codex':providerId==='claude'?'Claude':'Gemini')}<span>{selectedEffort==='low'?(locale==='pt-BR'?'Leve':'Light'):selectedEffort==='high'?(locale==='pt-BR'?'Alto':'High'):selectedEffort==='xhigh'?(locale==='pt-BR'?'Extra alto':'Extra High'):(locale==='pt-BR'?'Médio':'Medium')}</span></button>
              {native?.files?.selectVideos&&<button type="button" className="composer-attach" onClick={()=>void pickVideos()} aria-label={pt?'Anexar vídeo à mensagem':'Attach a video to the message'}>{pt?'Anexar vídeo':'Attach video'}</button>}
              {busy&&!directEdit ? (
                <button
                  className="send-button stop"
                  onClick={() => cancelExecution(activeSession?.id)}
                  aria-label={t('Cancel execution')}
                >
                  ■
                </button>
              ) : (
                <button
                  className="send-button"
                  disabled={!message.trim() || skillMenuOpen || (connection !== 'connected'&&!directEdit) || scopePending}
                  onClick={send}
                  aria-label={t('Send')}
                >
                  ↑
                </button>
              )}
            </div>
          </div>
          <p className="composer-hint">
            {locale === 'pt-BR'
              ? 'Enter para enviar · Shift + Enter para nova linha · / para skills'
              : 'Enter to send · Shift + Enter for a new line · / for skills'}
          </p>
        </footer>
      )}
      {handoffBrief!==null&&<AgentHandoffDialog agent={agent} sessionId={handoffBrief.sessionId} initialBriefing={handoffBrief.text} context={contextNodes} onClose={()=>setHandoffBrief(null)}/>}
      {!comparisonMode&&pairedComparison&&!comparisonAvailable&&<p className="comparison-unavailable" role="status">{locale==='pt-BR'?'Não é possível reabrir: um agente ou uma sessão do par foi excluído ou está indisponível. Esta conversa continua disponível.':'Cannot reopen: an agent or paired session was deleted or is unavailable. This chat remains available.'}</p>}
      {contentToDelete&&<ContentDeletionDialog contentId={contentToDelete.contentId} workspaceId={contentToDelete.workspaceId} fallbackTitle={contentToDelete.title} pt={pt} onClose={()=>setContentToDelete(null)}
        onDeleted={({title,chats})=>{setContentToDelete(null);selectScope(contentToDelete.workspaceId,'general');setTab('chat');onToast(pt?`“${title}” e ${chats} ${chats===1?'conversa excluídos':'conversas excluídos'} deste computador`:`“${title}” and ${chats} ${chats===1?'chat':'chats'} deleted from this computer`);
          // The trigger is gone with the content: focus lands on the content picker (now General).
          window.requestAnimationFrame(()=>document.querySelector<HTMLElement>('.content-scope-picker .select-menu-trigger')?.focus());}}/>}
      {organizing&&<OrganizeChatDialog session={organizing} pt={pt} onClose={()=>setOrganizing(null)} onDone={(content,count)=>{setOrganizing(null);onToast(pt?`${count} ${count===1?'conversa organizada':'conversas organizadas'} em “${content.title}”`:`${count} chat(s) organized into “${content.title}”`);}} onFreshChat={content=>{setOrganizing(null);startSession(content);}}/>}
      {providerChoiceOpen&&<ProviderChoice agentName={agent.name} currentProvider={providerId} currentModel={selectedModelId} busy={switchBusy} plan={switchPlan} editing={editing} onClose={()=>setProviderChoiceOpen(false)} onCreate={(provider,model)=>{
        try{
          if(activeSession&&switchPlan.kind==='in-place'){
            // Same chat, same draft slot: only its provider binding changes (re-checked against the live chat).
            setSessionProvider(activeSession.id,provider,model,{productionSessionIds:productionSessionIds(production.runs)});
            onToast(pt?`Esta conversa agora usa ${provider==='claude'?'Claude':'Codex'}. Nada foi enviado.`:`This chat now uses ${provider==='claude'?'Claude':'Codex'}. Nothing was sent.`);
          }else if(switchPlan.kind==='blocked'){onToast(pt?'Aguarde a resposta atual para trocar o provedor.':'Wait for the current response to change the provider.');return;}
          else{
            if(scopePending){onToast(pt?'Aguarde: os conteúdos ainda estão carregando.':'Wait: contents are still loading.');return;}
            // A chat with history keeps its provider and thread; the new chat lives in the same content and gets a copy of the draft.
            const session=createSession(agent.id,undefined,provider,model,binding.kind==='content'?linkOf(activeSession):activeSession?undefined:newChatLink,'select');
            writeChatDraft(agent.id,session.id,structuredClone(draft));
            if(!activeSession)writeChatDraft(agent.id,slot,{text:'',skill:null});
            onToast(pt?'Nova conversa preparada. O histórico anterior foi mantido; revise o rascunho antes de enviar.':'New chat prepared. The earlier history was kept; review the draft before sending.');
          }
          setProviderChoiceOpen(false);setTab('chat');requestAnimationFrame(()=>composerRef.current?.focus());
        }catch(error){onToast(error instanceof Error?error.message:String(error));}
      }} onBoth={models=>{if(missingContext.length){onToast(locale==='pt-BR'?'Revise as referências de contexto ausentes antes de consultar ambos.':'Review missing context references before consulting both.');return;}setProviderChoiceOpen(false);setSameAgentModels(models);setComparisonBrief(message)}}/>}
      {comparisonBrief!==null&&<ComparisonLauncher link={binding.kind==='content'?linkOf(activeSession):activeSession?undefined:newChatLink} workspaceId={agent.workspaceId} agentId={agent.id} briefing={comparisonBrief} context={contextNodes} mode={sameAgentModels?'same-agent':'agents'} initialModels={sameAgentModels??undefined} onClose={()=>{setComparisonBrief(null);setSameAgentModels(null);requestAnimationFrame(()=>composerRef.current?.focus())}}/>}
      {productionOpen&&<ProductionDialog workspaceId={agent.workspaceId} sessionId={productionTarget.sessionId} agentId={productionTarget.agentId} initialText={productionText} onSelectAgent={onSelectAgent} onClose={()=>setProductionOpen(false)}/>}
      {recordedOpen&&activeSession&&binding.kind==='content'&&!binding.run&&<RecordedEntry agent={agent} session={activeSession} content={binding.content} onClose={()=>setRecordedOpen(false)} onStarted={()=>{setRecordedOpen(false);onToast(locale==='pt-BR'?'Edição iniciada neste conteúdo. Acompanhe a próxima etapa aqui.':'Editing started for this content. Follow the next step here.');}}/>}
      {reviewRequest&&(reviewRequest.confirmedTarget?(reviewRequest.artifacts.find(item=>item.id===reviewRequest.selectedId)?.type==='file-delivery'?<FileDeliveryReview artifact={reviewRequest.artifacts.find(item=>item.id===reviewRequest.selectedId)!} initialDecision={reviewRequest.decision} initialNotes={reviewRequest.notes} onClose={()=>setReviewRequest(null)}/>:<ScriptDeliveryReview artifact={reviewRequest.artifacts.find(item=>item.id===reviewRequest.selectedId)!} initialDecision={reviewRequest.decision} initialNotes={reviewRequest.notes} onClose={()=>setReviewRequest(null)}/>):<FlowDialog title={locale==='pt-BR'?'Qual roteiro você quer revisar?':'Which script do you want to review?'} onClose={()=>setReviewRequest(null)}><div className="delivery-review-fields"><SelectMenu ariaLabel={locale==='pt-BR'?'Roteiro para revisar':'Script to review'} value={reviewRequest.selectedId} onChange={selectedId=>setReviewRequest({...reviewRequest,selectedId})} options={reviewRequest.artifacts.map(item=>({value:item.id,label:`${editorialState.contents.find(content=>content.id===item.contentId)?.title} · v${item.version}`}))}/><button className="primary-button" onClick={()=>setReviewRequest({...reviewRequest,confirmedTarget:true})}>{locale==='pt-BR'?'Revisar esta versão':'Review this version'}</button></div></FlowDialog>)}
    </div>
  );
}

function countMessages(count: number, locale: string): string {
  return `${count} ${locale === 'pt-BR' ? (count === 1 ? 'item' : 'itens') : count === 1 ? 'item' : 'items'}`;
}
function formatTime(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(
    new Date(value),
  );
}
const agentSessionsCount=(sessions:readonly AgentSession[],scope:string)=>sessions.filter(session=>(session.contentId?`content:${session.contentId}`:'general')===scope).length;

function formatSessionDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date(value));
}
