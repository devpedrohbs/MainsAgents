import type { Agent } from '../../features/agents/model/Agent';
import { AgentRow } from './AgentRow';

interface AgentListProps { agents:readonly Agent[]; compact?:boolean; selectedId?:string; onSelect:(agentId:string)=>void; onChat?:(agentId:string)=>void; onConfigure?:(agentId:string)=>void }
export function AgentList({agents,compact=false,selectedId,onSelect,onChat,onConfigure}:AgentListProps) {
  const className=compact?'':'agents-list';
  return <div className={className}>{agents.map((agent)=><AgentRow key={agent.id} agent={agent} compact={compact} selected={selectedId===agent.id} onSelect={onSelect} onChat={onChat} onConfigure={onConfigure}/>)}</div>;
}
