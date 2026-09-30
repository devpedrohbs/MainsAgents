import { getAgentInitials } from '../../features/agents/model/Agent';

export function AgentAvatar({name,image,className=''}:{name:string;image?:string;className?:string}) {
  return <span className={`agent-avatar agent-monogram ${className}`} aria-hidden="true">{image?<img src={image} alt=""/>:getAgentInitials({name})}</span>;
}
