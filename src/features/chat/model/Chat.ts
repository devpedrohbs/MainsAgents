import type { AgentId } from '../../agents/model/Agent';
import type { ProviderAuthMode, ProviderId } from '../AiProvider';
import type { AgentHandoff } from '../agentHandoff';
import type { SessionComparison } from '../agentComparison';

export type ChatRunState = 'idle' | 'thinking' | 'searching' | 'using-tool' | 'finished' | 'error';
export type ChatRole = 'user' | 'agent';
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

export interface ChatContextReference {
  nodeId: string;
  label: string;
  kind: string;
  content?: string;
}

export interface ChatMessageItem {
  id: string;
  type: 'message';
  role: ChatRole;
  content: string;
  createdAt: string;
  contextNodes?: ChatContextReference[];
  selectedSkill?: string;
  sourceAgentName?: string;
  handoffId?: string;
  images?: ChatImageAttachment[];
  /** Only a successfully completed turn can be saved as an editorial delivery. */
  deliveryState?: 'streaming' | 'completed' | 'interrupted';
  responseDurationMs?: number;
  /** Host-verified files delivered by this message (production/edit/handoff). Display only; the host re-verifies on open. */
  receipts?: DeliveryReceiptView[];
  /** Local videos attached to this user message (absolute paths; the host inspects them, never reads them as text). */
  attachments?: ChatAttachment[];
  /** This user message was sent as an edit request to the local engine (host-decided; see chat-edit-requests.mjs). */
  chatEdit?: {kind: 'edit' | 'adjust'};
  /** Camera + screen options of an edit request with two videos (roles are on each attachment; never inferred). */
  sourcePair?: {voice?: 'camera' | 'screen'; layout: 'camera-corner' | 'screen-full' | 'alternate'};
  /** Production message: preview of ONLY the adjusted window (served by the host when its sha256 still matches). */
  adjustPreview?: {runId: string; sha256: string; start: number; duration: number; window: {start: number; end: number}};
  /** Production message: a localized visual adjustment was delivered (proof flags for display). */
  localAdjust?: {id: string; window: {start: number; end: number}; sameAudio?: boolean; timelineCompatible?: boolean};
}

/** role: the person's explicit choice when two videos form a camera + screen pair. */
export interface ChatAttachment {kind: 'video'; path: string; name: string; role?: 'camera' | 'screen'}

/** Public shape of a host delivery receipt (delivery-receipts.mjs). */
export interface DeliveryReceiptView {
  id: string;
  schema?: string;
  source: {kind: 'production-video'|'production-captions'|'production-adjusted'|'media-export'|'delegation'|'editor-tool'|'generated-image'|'paper-export'; id: string; step?: string};
  contentId?: string; workspaceId?: string; sessionId?: string; assetId?: string; versionId?: string;
  name: string; path: string; size: number; sha256: string; fileKind: string; version: number; label?: string;
  producedBy?: {agentName?: string; providerId?: string; modelId?: string};
  createdAt: string;
}

export interface ChatImageAttachment {
  id:string;
  url:string;
  mimeType:'image/png'|'image/jpeg'|'image/webp';
  filename:string;
  alt:string;
  prompt?:string;
  /** Portable backup bytes; live media normally stays in the durable media directory. */
  dataUrl?:string;
}

export type ChatRunOutcome = 'completed' | 'interrupted' | 'error';

export interface ChatActivityItem {
  id: string;
  type: 'activity';
  label: string;
  status: 'running' | 'done' | 'error';
  /** 'run' = the single status line of one agent execution; tool steps stay out of the main feed. */
  kind?: 'run';
  startedAt?: string;
  endedAt?: string;
  outcome?: ChatRunOutcome;
}

export type ChatItem = ChatMessageItem | ChatActivityItem;

export interface AgentSession {
  id: string;
  responseTiming?: {id:string;startedAt:string;endedAt?:string;outcome?:ChatRunOutcome};
  contentId?:string;
  /** Bounded, path-free snapshot of this session's own content/production (reference data for the chat agent). */
  productionContext?:{id:string;stage:string;stageLabel?:string;title?:string;notionUrl?:string;entry?:{origin:'notion'|'text'|'delegation';video:string;context?:string;cardUrl?:string;truncated?:{shownChars:number;totalChars:number}};script?:{status:string;hook?:string;cta?:string;text?:string;truncated?:{shownChars:number;totalChars:number}};cardNotes?:string;cardNotesTruncated?:{shownChars:number;totalChars:number};materials?:{editedVideo:string;platforms?:string[];editPlan?:string};lastDecision?:{action:string;at:string;detail?:string};error?:string;recentResults:string[];
    /** Set when this chat is not the run's main conversation: the snapshot is read-only reference for another chat of the same content. */
    conductedIn?:'main-session';deliveries?:Array<{platform:string;text:string;version:number;status:string}>};
  /** Content title saved when a content session is created; used before any production exists. */
  contentTitle?:string;
  topicId?:string;
  agentId: AgentId;
  providerId?: ProviderId;
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
  remoteSessionId?: string;
  authMode?: ProviderAuthMode;
  /** Legacy field retained so existing local Codex sessions can resume. */
  codexThreadId?: string;
  delegationRuntimeVersion?: number;
  previousCodexThreadId?: string;
  /** Provider threads replaced because they could no longer be resumed (latest 5). The local history never changes. */
  threadRecoveries?: Array<{previousRemoteSessionId:string;remoteSessionId:string;at:string}>;
  handoffs?: AgentHandoff[];
  pendingManualHandoff?:{id:string;fingerprint:string};
  originHandoffId?: string;
  agentConnection?: { enabled: boolean; targetAgentId: AgentId; targetSessionId?: string };
  /** Saved on both sides of a Codex/Claude comparison; never replayed automatically. */
  comparison?: SessionComparison;
  title: string;
  messages: ChatItem[];
  createdAt: string;
  updatedAt: string;
}
