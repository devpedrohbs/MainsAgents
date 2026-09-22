import type { Agent } from '../features/agents/model/Agent';
import { AgentList } from '../components/agents/AgentList';
import { Icon } from '../components/common/Icon';

export function Agents({agents,onSelect,onCreate}:{agents:readonly Agent[];onSelect:(agentId:string)=>void;onCreate:()=>void}) {
  return <div className="page"><div className="page-head"><div><p className="eyebrow">Your team</p><h1>Agents</h1><p>Specialists with clear roles, tools, and working context.</p></div><button className="primary-button" onClick={onCreate}><Icon name="plus"/>Create agent</button></div><AgentList agents={agents} onSelect={onSelect}/></div>;
}
