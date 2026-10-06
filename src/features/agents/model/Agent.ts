export type AgentId = string;
export type AgentStatusValue = 'working' | 'review' | 'idle';
export type AgentTool = 'web-search' | 'files' | 'canvas-context' | 'subagents';
export type AgentProviderId = 'codex' | 'claude' | 'gemini';

export interface Agent {
  id: AgentId;
  name: string;
  role: string;
  description: string;
  instructions: string;
  status: AgentStatusValue;
  workspaceId: string;
  tools: AgentTool[];
  providerId?: AgentProviderId;
  mcpPermissions?:Array<'read'|'write'|'schedule'|'publish'|'delete'|'unknown'>;
  notionAutomation?:{enabled:boolean;dataSourceId:string};
  modelId?: string;
  avatarImage?: string;
  skillsDirectory?: string;
  skills?: string[];
  skillFiles?: Record<string, string>;
  disabledSkills?: string[];
  skillsInstallKey?: string;
  createdAt: string;
  updatedAt: string;
}

export const agentStatusLabels: Record<AgentStatusValue, string> = {
  working: 'Active',
  review: 'Needs review',
  idle: 'Ready',
};

export const agentToolDetails: Record<AgentTool, { label: string; description: string }> = {
  'web-search': { label: 'Web Search', description: 'Search and read public sources.' },
  files: { label: 'Files', description: 'Read files attached to the workspace.' },
  'canvas-context': { label: 'Canvas Context', description: 'Read selected nodes and create canvas results.' },
  subagents: { label: 'Agent collaboration', description: 'Send briefings to agents in this workspace and follow both chats.' },
};

export type AgentEditorValues = Pick<Agent, 'name' | 'role' | 'description' | 'instructions' | 'workspaceId' | 'tools' | 'skillsDirectory' | 'skills' | 'skillFiles' | 'disabledSkills' | 'skillsInstallKey' | 'providerId' | 'modelId' | 'avatarImage'|'mcpPermissions'|'notionAutomation'>;

export function getAgentInitials(agent: Pick<Agent, 'name'>): string {
  return agent.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}
