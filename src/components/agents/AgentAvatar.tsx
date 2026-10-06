import type { CSSProperties } from 'react';
import { getAgentInitials } from '../../features/agents/model/Agent';

// Stable hue per agent name; the stylesheet turns it into a tinted monogram for both themes.
const hueFor = (name:string) => [...name].reduce((hash,char)=>(hash*31+char.charCodeAt(0))>>>0,7)%360;

export function AgentAvatar({name,image,className=''}:{name:string;image?:string;className?:string}) {
  return <span className={`agent-avatar agent-monogram ${className}`} style={{'--agent-hue':hueFor(name)} as CSSProperties} aria-hidden="true">{image?<img src={image} alt=""/>:getAgentInitials({name})}</span>;
}
