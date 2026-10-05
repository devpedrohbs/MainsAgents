import type { AgentId } from '../../agents/model/Agent';
import type { ProviderAuthMode, ProviderId } from '../AiProvider';
import type { AgentHandoff } from '../agentHandoff';

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

export interface ChatActivityItem {
  id: string;
  type: 'activity';
  label: string;
  status: 'running' | 'done' | 'error';
}

export type ChatItem = ChatMessageItem | ChatActivityItem;

export interface AgentSession {
  id: string;
  contentId?:string;
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
  title: string;
  messages: ChatItem[];
  createdAt: string;
  updatedAt: string;
}
