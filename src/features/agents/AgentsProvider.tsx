import { createContext, useContext, useMemo, type PropsWithChildren } from 'react';
import type { Agent, AgentEditorValues, AgentId } from './model/Agent';
import { usePersistentState } from '../../data/localPersistence';

interface AgentsContextValue {
  agents: readonly Agent[];
  getAgentById: (agentId: AgentId) => Agent | undefined;
  createAgent: (values: AgentEditorValues) => Agent;
  updateAgent: (agentId: AgentId, values: AgentEditorValues) => void;
  deleteAgent: (agentId: AgentId) => void;
}

const AgentsContext = createContext<AgentsContextValue | null>(null);

function createId(name: string): string {
  const slug = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug || 'agent'}-${Date.now().toString(36)}`;
}

export function AgentsProvider({ children }: PropsWithChildren) {
  const [agents, setAgents] = usePersistentState<Agent[]>('agents', []);

  const value = useMemo<AgentsContextValue>(() => ({
    agents,
    getAgentById: (agentId) => agents.find((agent) => agent.id === agentId),
    createAgent: (values) => {
      const now = new Date().toISOString();
      const agent: Agent = { ...values, id: createId(values.name), status: 'idle', createdAt: now, updatedAt: now };
      setAgents((current) => [...current, agent]);
      return agent;
    },
    updateAgent: (agentId, values) => {
      setAgents((current) => current.map((agent) => agent.id === agentId ? { ...agent, ...values, updatedAt: new Date().toISOString() } : agent));
    },
    deleteAgent: (agentId) => {
      setAgents((current) => current.filter((agent) => agent.id !== agentId));
    },
  }), [agents]);

  return <AgentsContext.Provider value={value}>{children}</AgentsContext.Provider>;
}

export function useAgents(): AgentsContextValue {
  const context = useContext(AgentsContext);
  if (!context) throw new Error('useAgents must be used inside AgentsProvider');
  return context;
}
