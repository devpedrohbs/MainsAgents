import type { AgentId } from '../features/agents/model/Agent';

export type PageId = 'home' | 'board' | 'canvas' | 'agents' | 'agent-settings' | 'sessions' | 'settings';
export type TaskStatus = 'research' | 'running' | 'review' | 'done';
export type NodeType = 'note' | 'research' | 'image' | 'contentIdea' | 'hook' | 'script';

export interface Task { id:string; title:string; description:string; agentId:AgentId; workspaceId:string; status:TaskStatus; metadata:string; createdAt:string }
export interface CanvasNodeModel {
  id:string;
  type:NodeType;
  label:string;
  title?:string;
  source?:string;
  summary?:string;
  url?:string;
  imageUrl?:string;
  caption?:string;
  platform?:string;
  description?:string;
  hook?:string;
  preview?:string;
  wordCount?:number;
  text?:string;
  meta?:string;
  sourceMessageId?:string;
  groupId?:string;
  groupLabel?:string;
  agentId?:AgentId;
  x:number;
  y:number;
}
export interface CanvasEdgeModel { id:string; source:string; target:string }
export interface NavigationProps { currentPage:PageId; onNavigate:(page:PageId)=>void }
