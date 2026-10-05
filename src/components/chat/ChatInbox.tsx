import {useState} from 'react';
import {useLanguage} from '../../app/LanguageProvider';
import type {ChatInboxItem} from '../../features/chat/chatInbox';
import {useChatInboxState} from '../../features/chat/chatInboxState';
import {Icon} from '../common/Icon';
export function ChatInbox({items,onOpen}:{items:ChatInboxItem[];onOpen:(item:ChatInboxItem)=>void}){
  const {locale}=useLanguage(),pt=locale==='pt-BR';
  const [preferences,setPreferences]=useChatInboxState(),[expanded,setExpanded]=useState(false);
  return <section className="work-panel editorial-inbox" aria-labelledby="chat-inbox-heading"><div className="panel-heading"><h2 id="chat-inbox-heading">{pt?'Caixa de entrada dos chats':'Chat inbox'} <span className="inbox-count">{items.length}</span></h2><button className="text-link" aria-pressed={!preferences.muted} onClick={()=>setPreferences(current=>({...current,muted:!current.muted}))}>{preferences.muted?(pt?'Ativar avisos':'Enable notifications'):(pt?'Silenciar avisos':'Mute notifications')}</button></div>
    {items.length?<><ul className="inbox-list">{(expanded?items:items.slice(0,5)).map(item=><li key={item.id}><button className="inbox-row" data-chat-inbox-id={item.id} onClick={()=>onOpen(item)}><Icon name={item.kind==='delivery'?'message':'history'}/><span className="inbox-copy"><b>{item.title}</b><small>{item.detail}</small></span><span className={`inbox-state ${item.kind==='delivery'?'next':'blocked'}`}>{item.kind==='approval'?(pt?'Sua autorização':'Your approval'):item.kind==='blocked'?(pt?'Verificar':'Check'):(pt?'Não vista':'Unseen')}</span><Icon name="chevron"/></button></li>)}</ul>{items.length>5&&<button className="panel-footer-action" onClick={()=>setExpanded(!expanded)} aria-expanded={expanded}>{expanded?(pt?'Mostrar menos':'Show less'):(pt?'Ver todas':'View all')}</button>}</>:<p className="inbox-notice">{pt?'Novas respostas e bloqueios dos agentes aparecem aqui.':'New agent responses and blockers appear here.'}</p>}
  </section>;
}
