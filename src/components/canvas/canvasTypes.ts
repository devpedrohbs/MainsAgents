import type { Node } from '@xyflow/react';
import type { AgentId } from '../../features/agents/model/Agent';

export type CanvasNodeKind = 'note' | 'research' | 'image' | 'contentIdea' | 'hook' | 'script';

export interface CanvasNodeData extends Record<string, unknown> {
  label: string;
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
}

export type CanvasFlowNode = Node<CanvasNodeData, CanvasNodeKind>;
