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
  productionContext?:{id:string;stage:string;stageLabel?:string;title?:string;notionUrl?:string;entry?:{origin:'notion'|'text';video:string;context?:string;cardUrl?:string;truncated?:{shownChars:number;totalChars:number}};script?:{status:string;hook?:string;cta?:string;text?:string;truncated?:{shownChars:number;totalChars:number}};cardNotes?:string;cardNotesTruncated?:{shownChars:number;totalChars:number};materials?:{editedVideo:string;platforms?:string[];editPlan?:string};lastDecision?:{action:string;at:string;detail?:string};error?:string;recentResults:string[];deliveries?:Array<{platform:string;text:string;version:number;status:string}>};
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
