import type { AgentId } from '../../agents/model/Agent';
import type { ProviderAuthMode, ProviderId } from '../AiProvider';

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
  agentId: AgentId;
  providerId?: ProviderId;
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
  remoteSessionId?: string;
  authMode?: ProviderAuthMode;
  /** Legacy field retained so existing local Codex sessions can resume. */
  codexThreadId?: string;
  title: string;
  messages: ChatItem[];
  createdAt: string;
  updatedAt: string;
}
