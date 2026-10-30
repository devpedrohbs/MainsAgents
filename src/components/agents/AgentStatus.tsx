import { StatusIcon, type RunState } from '../common/StatusIcon';
import type { TaskStatus } from '../../app/types';
import type { AgentStatusValue } from '../../features/agents/model/Agent';
import { agentStatusLabels } from '../../features/agents/model/Agent';
import { useLanguage } from '../../app/LanguageProvider';
const states:Record<AgentStatusValue|TaskStatus,RunState>={working:'running',idle:'queued',research:'queued',running:'running',review:'waiting',done:'done'};
const taskLabels:Record<TaskStatus,string>={research:'Research',running:'Running',review:'Needs review',done:'Completed'};
export function AgentStatus({status}:{status:AgentStatusValue|TaskStatus}) { const {t}=useLanguage();return <span className={`status ${status}`}><StatusIcon state={states[status]}/>{t(status==='working'||status==='idle'?agentStatusLabels[status]:taskLabels[status])}</span> }
