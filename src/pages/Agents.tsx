import type { Agent } from '../features/agents/model/Agent';
import { AgentList } from '../components/agents/AgentList';
import { Icon } from '../components/common/Icon';
import { useLanguage } from '../app/LanguageProvider';

export function Agents({agents,onSelect,onCreate}:{agents:readonly Agent[];onSelect:(agentId:string)=>void;onCreate:()=>void}) {
  const {t}=useLanguage();
  return <div className="page"><div className="page-head"><div><p className="eyebrow">{t('Your team')}</p><h1>{t('Agents')}</h1><p>{t('Specialists with clear roles, tools, and working context.')}</p></div><button className="primary-button" onClick={onCreate}><Icon name="plus"/>{t('Create agent')}</button></div><AgentList agents={agents} onSelect={onSelect}/></div>;
}
