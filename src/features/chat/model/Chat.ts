import type { AgentId } from '../../agents/model/Agent';

export type ChatRunState = 'idle' | 'thinking' | 'searching' | 'using-tool' | 'finished' | 'error';
export type ChatRole = 'user' | 'agent';

export interface ChatContextReference {
  nodeId: string;
  label: string;
  kind: string;
}

export interface ChatMessageItem {
  id: string;
  type: 'message';
  role: ChatRole;
  content: string;
  createdAt: string;
  contextNodes?: ChatContextReference[];
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
  codexThreadId?: string;
  title: string;
  messages: ChatItem[];
  createdAt: string;
  updatedAt: string;
}
