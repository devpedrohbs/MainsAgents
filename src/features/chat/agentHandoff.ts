import type { Agent } from '../agents/model/Agent';
import type { ChatContextReference } from './model/Chat';

export interface AgentHandoffRequest {
  targetAgentId: string;
  title: string;
  instructions: string;
  files: string[];
  sessionMode?: 'continue' | 'new';
}

export interface AgentHandoff extends AgentHandoffRequest {
  id: string;
  sourceAgentId: string;
  sourceSessionId: string;
  targetSessionId: string;
  workspaceId: string;
  context: ChatContextReference[];
  status: 'running' | 'completed' | 'error' | 'cancelled' | 'interrupted';
  result?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export function handoffTargets(source: Agent, agents: readonly Agent[], ancestors: readonly string[] = []): Agent[] {
  return source.tools.includes('subagents') && ancestors.length < 2
    ? agents.filter(agent => agent.workspaceId === source.workspaceId && agent.id !== source.id && !ancestors.includes(agent.id))
    : [];
}

export function validateHandoff(value: unknown, source: Agent, agents: readonly Agent[], ancestors: readonly string[] = []): {request: AgentHandoffRequest; target: Agent} {
  if (!value || typeof value !== 'object') throw new Error('Invalid agent briefing.');
  const input = value as Partial<AgentHandoffRequest>;
  const target = handoffTargets(source, agents, ancestors).find(agent => agent.id === input.targetAgentId);
  if (!target) throw new Error('The agent is unavailable, belongs to another workspace, or delegation is disabled.');
  if (typeof input.instructions !== 'string' || !input.instructions.trim() || input.instructions.length > 32000) throw new Error('Provide instructions of up to 32,000 characters.');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 120) throw new Error('Provide a title of up to 120 characters.');
  if (!Array.isArray(input.files) || input.files.length > 20 || input.files.some(file => typeof file !== 'string' || file.length > 2048 || !/^(?:[a-z]:[\\/]|\/[^/])[^\r\n\0]*$/i.test(file))) throw new Error('Use absolute local file paths (up to 20 files).');
  if (input.sessionMode !== undefined && !['continue', 'new'].includes(input.sessionMode)) throw new Error('Invalid specialist session mode.');
  return {target, request: {targetAgentId: target.id, title: input.title.trim(), instructions: input.instructions.trim(), files: [...new Set(input.files)], ...(input.sessionMode ? {sessionMode: input.sessionMode} : {})}};
}

export function handoffBriefing(source: Pick<Agent, 'name' | 'role'>, request: AgentHandoffRequest): string {
  return `Task from ${source.name} (${source.role}): ${request.title}\n\n${request.instructions}${request.files.length ? `\n\nLocal file references:\n${request.files.join('\n')}` : ''}\n\nFollow your configured role, instructions and skills. Return the requested result to the requesting agent. Report any relevant blockers honestly. Respect the user's approval requirements. Local paths reference files on this computer; they are not uploads.`;
}
