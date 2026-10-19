import {useEffect,useId,useRef,useState} from 'react';
import {Icon} from '../common/Icon';
import '../../styles/content-deletion.css';

/** "…" menu of a content box with the destructive "Delete content and chats…" item (keyboard: Enter/Space, arrows, Escape). */
export function ContentActionsMenu({title,pt,disabled,onDelete}:{title:string;pt:boolean;disabled?:boolean;onDelete:()=>void}){
 const [open,setOpen]=useState(false),id=useId(),button=useRef<HTMLButtonElement>(null),item=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(!open)return;item.current?.focus();
  const close=(event:MouseEvent)=>{if(!(event.target instanceof Node)||!button.current?.parentElement?.contains(event.target))setOpen(false);};
  window.addEventListener('mousedown',close);return()=>window.removeEventListener('mousedown',close);},[open]);
 const label=pt?`Ações de “${title}”`:`Actions for “${title}”`;
 return <span className="content-actions" onKeyDown={event=>{if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();setOpen(false);button.current?.focus();}}}>
  <button ref={button} type="button" className="icon-button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open?id:undefined} disabled={disabled} onClick={()=>setOpen(value=>!value)}><Icon name="more"/></button>
  {open&&<div id={id} role="menu" aria-label={label} className="content-actions-menu">
   <button ref={item} type="button" role="menuitem" onKeyDown={event=>{if(event.key==='Tab')setOpen(false);}} onClick={()=>{setOpen(false);onDelete();}}>{pt?'Excluir conteúdo e conversas…':'Delete content and chats…'}</button>
  </div>}
 </span>;
}
