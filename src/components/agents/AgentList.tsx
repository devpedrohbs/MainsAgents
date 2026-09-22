import type { Agent } from '../../features/agents/model/Agent';
import { AgentRow } from './AgentRow';

interface AgentListProps { agents:readonly Agent[]; compact?:boolean; onSelect:(agentId:string)=>void }
export function AgentList({agents,compact=false,onSelect}:AgentListProps) {
  const className=compact?'':'agents-list';
  return <div className={className}>{agents.map((agent)=><AgentRow key={agent.id} agent={agent} compact={compact} onSelect={onSelect}/>)}</div>;
}
