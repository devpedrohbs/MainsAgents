export type AgentId = string;
export type AgentStatusValue = 'working' | 'review' | 'idle';
export type AgentTool = 'web-search' | 'files' | 'canvas-context' | 'subagents';

export interface Agent {
  id: AgentId;
  name: string;
  role: string;
  description: string;
  instructions: string;
  status: AgentStatusValue;
  workspaceId: string;
  tools: AgentTool[];
  skillsDirectory?: string;
  skills?: string[];
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
  subagents: { label: 'Subagents', description: 'Delegate focused work to other agents.' },
};

export type AgentEditorValues = Pick<Agent, 'name' | 'role' | 'description' | 'instructions' | 'workspaceId' | 'tools' | 'skillsDirectory' | 'skills'>;

export function getAgentInitials(agent: Pick<Agent, 'name'>): string {
  return agent.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}
