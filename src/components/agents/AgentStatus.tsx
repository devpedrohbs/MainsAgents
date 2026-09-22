import type { TaskStatus } from '../../app/types';
import type { AgentStatusValue } from '../../features/agents/model/Agent';
import { agentStatusLabels } from '../../features/agents/model/Agent';
const taskLabels:Record<TaskStatus,string>={research:'Research',running:'Running',review:'Needs review',done:'Completed'};
export function AgentStatus({status}:{status:AgentStatusValue|TaskStatus}) { return <span className={`status ${status}`}><i/>{status==='working'||status==='idle'?agentStatusLabels[status]:taskLabels[status]}</span> }
