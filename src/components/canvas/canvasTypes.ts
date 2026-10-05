import type { Node } from '@xyflow/react';
import type { AgentId } from '../../features/agents/model/Agent';

export type CanvasNodeKind = 'note' | 'research' | 'image' | 'contentIdea' | 'hook' | 'script' | 'terminal' | 'browser' | 'chat';

export interface CanvasNodeData extends Record<string, unknown> {
  label: string;
  contentId?:string;
  topicId?:string;
  artifactId?:string;
  title?: string;
  source?: string;
  summary?: string;
  url?: string;
  imageUrl?: string;
  caption?: string;
  platform?: string;
  description?: string;
  hook?: string;
  preview?: string;
  wordCount?: number;
  text?: string;
  meta?: string;
  sourceMessageId?: string;
  groupId?: string;
  groupLabel?: string;
  agentId?: AgentId;
  agentLabel?: string;
  workspaceId?: string;
  command?: string;
  terminalOutput?: string;
  terminalCwd?: string;
  terminalShell?: string;
  terminalHistory?: string[];
  terminalExitCode?: number | null;
  terminalEventCursor?: number;
  terminalExecutionId?: string;
  terminalStatus?: 'idle' | 'running' | 'finished' | 'error' | 'cancelled';
  browserUrl?: string;
  chatAgentId?: AgentId;
  chatSessionId?: string;
  chatHandoffId?: string;
}

export type CanvasFlowNode = Node<CanvasNodeData, CanvasNodeKind>;
