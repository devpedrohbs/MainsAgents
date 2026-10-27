import type { CSSProperties } from 'react';
import { defaultMascot, mascotBowTie, mascotMoods, mascotProps, mascotShapes, type AgentMascot } from '../../features/agents/mascot';

/** The conductor in the agent's look. `thinking` animates it (bob, blink, the object in hand keeps time). */
export function MascotFigure({mascot,thinking=false,className=''}:{mascot:AgentMascot;thinking?:boolean;className?:string}) {
  const mood=mascotMoods[mascot.mood],prop=mascotProps[mascot.prop],ink='#141416';
  return <svg className={`mascot-figure ${thinking?'thinking':''} ${className}`} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <g className="mascot-body">
      <path d={mascotShapes[mascot.shape].path} fill={mascot.color}/>
      <g className="mascot-eyes"><path d={mood.path} fill={mood.line?'none':ink} stroke={mood.line?ink:'none'} strokeWidth="2.4" strokeLinecap="round"/></g>
      <path d={mascotBowTie} fill={ink}/>
      {mascot.prop!=='none'&&<g className="mascot-prop">{prop.stroke&&<path d={prop.stroke} fill="none" stroke={mascot.color} strokeWidth="2.2" strokeLinecap="round"/>}<path d={prop.fill} fill={mascot.color}/></g>}
    </g>
  </svg>;
}

/** Photo when the agent has one, otherwise its mascot (the chosen look, or a stable default from name and role). */
export function AgentAvatar({name,image,mascot,role,thinking=false,className=''}:{name:string;image?:string;mascot?:AgentMascot;role?:string;thinking?:boolean;className?:string}) {
  if(image)return <span className={`agent-avatar agent-photo ${className}`} aria-hidden="true"><img src={image} alt=""/></span>;
  const look=mascot??defaultMascot({name,role});
  return <span className={`agent-avatar agent-mascot ${className}`} style={{'--mascot':look.color} as CSSProperties} aria-hidden="true"><MascotFigure mascot={look} thinking={thinking}/></span>;
}
