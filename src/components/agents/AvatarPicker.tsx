import { useRef, useState, type CSSProperties } from 'react';
import { AgentAvatar, MascotFigure } from './AgentAvatar';
import { defaultMascot, mascotColors, mascotMoods, mascotProps, mascotShapes, randomMascot, type AgentMascot, type MascotMood, type MascotProp, type MascotShape } from '../../features/agents/mascot';

/**
 * Identity picker: the MainsAgents mascot (shape, colour, object, eyes) or a photo from the PC. Switching to the mascot keeps the
 * photo aside until the drawer closes, so going back to "Foto" does not ask for the file again; saving with the mascot drops it.
 */
export function AvatarPicker({name,role,image,mascot,pt,onImage,onMascot,onChoosePhoto}:{name:string;role:string;image:string;mascot?:AgentMascot;pt:boolean;onImage:(image:string)=>void;onMascot:(mascot:AgentMascot)=>void;onChoosePhoto:()=>void}) {
  const [tab,setTab]=useState<'mascot'|'photo'>(image?'photo':'mascot');
  const stash=useRef(image);
  const look=mascot??defaultMascot({name,role});
  const set=(patch:Partial<AgentMascot>)=>onMascot({...look,...patch});
  const toMascot=()=>{if(image)stash.current=image;onImage('');setTab('mascot');};
  const toPhoto=()=>{if(stash.current)onImage(stash.current);setTab('photo');};
  const say=(label:[string,string])=>pt?label[0]:label[1];
  return <div className="avatar-picker">
    <div className="avatar-picker-tabs" role="group" aria-label={pt?'Tipo de avatar':'Avatar type'}>
      <button type="button" aria-pressed={tab==='mascot'} onClick={toMascot}>{pt?'Boneco':'Mascot'}</button>
      <button type="button" aria-pressed={tab==='photo'} onClick={toPhoto}>{pt?'Foto':'Photo'}</button>
    </div>
    <div className="avatar-picker-preview">
      {tab==='mascot'?<span className="avatar-picker-tile" style={{'--mascot':look.color} as CSSProperties}><MascotFigure mascot={look} thinking/></span>:<AgentAvatar className="avatar-picker-photo" name={name} image={image} mascot={look}/>}
      <div><b>{name||(pt?'Novo agente':'New agent')}</b><span>{tab==='photo'?(image?(pt?'Foto do computador':'Photo from your PC'):(pt?'Sem foto: o boneco aparece até você escolher uma.':'No photo yet: the mascot shows until you choose one.')):`${say(mascotShapes[look.shape].label)} · ${say(mascotProps[look.prop].label).toLowerCase()} · ${say(mascotMoods[look.mood].label).toLowerCase()}`}</span></div>
    </div>
    {tab==='mascot'?<div className="avatar-picker-options">
      <fieldset><legend>{pt?'Forma':'Shape'}</legend><div className="avatar-shapes">{(Object.keys(mascotShapes) as MascotShape[]).map(shape=><button type="button" key={shape} aria-pressed={look.shape===shape} onClick={()=>set({shape})}><MascotFigure mascot={{...look,shape,prop:'none',mood:'normal'}}/>{say(mascotShapes[shape].label)}</button>)}</div></fieldset>
      <fieldset><legend>{pt?'Cor':'Colour'}</legend><div className="avatar-colors">{mascotColors.map(([ptName,enName,color])=><button type="button" key={color} aria-pressed={look.color===color} aria-label={pt?ptName:enName} title={pt?ptName:enName} style={{background:color}} onClick={()=>set({color})}/>)}</div></fieldset>
      <fieldset><legend>{pt?'Objeto na mão':'Object in hand'}</legend><div className="avatar-chips">{(Object.keys(mascotProps) as MascotProp[]).map(prop=><button type="button" key={prop} aria-pressed={look.prop===prop} onClick={()=>set({prop})}>{say(mascotProps[prop].label)}</button>)}</div></fieldset>
      <fieldset><legend>{pt?'Expressão':'Expression'}</legend><div className="avatar-chips">{(Object.keys(mascotMoods) as MascotMood[]).map(mood=><button type="button" key={mood} aria-pressed={look.mood===mood} onClick={()=>set({mood})}>{say(mascotMoods[mood].label)}</button>)}</div></fieldset>
      <button type="button" className="soft-button avatar-shuffle" onClick={()=>onMascot(randomMascot())}>{pt?'Sortear combinação':'Shuffle'}</button>
    </div>:<div className="avatar-photo-drop">
      <b>{pt?'Escolha uma foto do computador':'Choose a photo from your PC'}</b>
      <span>{pt?'PNG, JPG ou WebP. A foto é recortada em quadrado e fica só neste PC.':'PNG, JPG or WebP. It is cropped square and stays on this PC.'}</span>
      <div><button type="button" className="primary-button" onClick={onChoosePhoto}>{image?(pt?'Trocar foto…':'Change photo…'):(pt?'Escolher foto…':'Choose photo…')}</button>{image&&<button type="button" className="soft-button" onClick={()=>{stash.current='';onImage('');}}>{pt?'Remover foto':'Remove photo'}</button>}</div>
    </div>}
  </div>;
}
