import type {Agent} from '../../features/agents/model/Agent';
import type {ContentSpace,ScopeKey} from '../../features/chat/contentScopes';
import {SelectMenu} from '../common/SelectMenu';
import {Icon} from '../common/Icon';
import {ContentActionsMenu} from '../content/ContentActionsMenu';

const chatsLabel=(count:number,pt:boolean)=>pt?`${count} ${count===1?'conversa':'conversas'}`:`${count} ${count===1?'chat':'chats'}`;

/**
 * Visible content space of the chat: which content (or General) this agent is working on, and the same content's chats in the
 * other agents of the workspace. Switching agents keeps this content; it never jumps to another content's chat.
 */
export function ContentScopeBar({spaces,scope,agents,currentAgentId,pt,disabled,onSelect,onNewContent,onSelectAgent,onDeleteContent}:{
 spaces:readonly ContentSpace[];scope:ScopeKey;agents:readonly Agent[];currentAgentId:string;pt:boolean;disabled?:boolean;
 onSelect:(scope:ScopeKey)=>void;onNewContent:()=>void;onSelectAgent:(agentId:string)=>void;
 /** Opens the single confirmation that deletes this content and all its chats locally (only for a real content). */
 onDeleteContent?:()=>void;
}){
 const current=spaces.find(space=>space.scope===scope)??spaces[0];
 const options=spaces.map(space=>({value:space.scope,label:space.title,description:space.kind==='general'?`${pt?'Ideias sem conteúdo':'Ideas without content'} · ${chatsLabel(space.chats,pt)}`:space.kind==='recovery'?`${pt?'Vínculo inválido':'Invalid link'} · ${chatsLabel(space.chats,pt)}`:`${space.stage} · ${chatsLabel(space.chats,pt)}`}));
 return <section className={`content-scope-bar scope-${current?.kind??'general'}`} aria-label={pt?'Espaço de conteúdo':'Content space'}>
  {/* The content title gets the row; the full title stays available as a tooltip and in the menu. */}
  <div className="content-scope-row" title={current?.title}>
   <SelectMenu className="content-scope-picker" value={current?.scope??'general'} options={options} disabled={disabled} ariaLabel={pt?'Conteúdo desta conversa':'This chat’s content'} onChange={value=>onSelect(value as ScopeKey)}/>
   <button type="button" className="content-scope-new icon-button" disabled={disabled} onClick={onNewContent} aria-label={pt?'Novo conteúdo':'New content'} title={pt?'Novo conteúdo: cria um conteúdo com conversa própria':'New content: creates a content with its own chat'}><Icon name="plus"/></button>
   {current?.kind==='content'&&onDeleteContent&&<ContentActionsMenu title={current.title} pt={pt} disabled={disabled} onDelete={onDeleteContent}/>}
  </div>
  {current?.kind==='content'&&<div className="content-scope-meta">
  {current.stage&&<span className={`content-scope-stage${current.archived?' archived':''}`} title={pt?'Etapa real da produção':'Real production stage'}>{current.stage}</span>}
  {agents.length>1&&<nav className="content-scope-agents" aria-label={pt?`Agentes neste conteúdo: ${current.title}`:`Agents in this content: ${current.title}`}>
   {agents.map(agent=>{const chats=current.agents.find(item=>item.agentId===agent.id)?.chats??0;const active=agent.id===currentAgentId;
    return <button type="button" key={agent.id} className={chats?'':'empty'} aria-pressed={active} disabled={disabled&&!active} onClick={()=>{if(!active)onSelectAgent(agent.id);}} title={chats?(pt?`Abrir a conversa de ${agent.name} neste conteúdo`:`Open ${agent.name}’s chat in this content`):(pt?`${agent.name} ainda não conversou sobre este conteúdo`:`${agent.name} has no chat in this content yet`)}>
     <span>{agent.name}</span><small>{chats}</small>
    </button>;})}
  </nav>}
  </div>}
  {current?.kind==='recovery'&&<p className="content-scope-note" role="note">{pt?'Conversas cujo conteúdo foi removido ou pertence a outro espaço. Tudo continua salvo; abra para revisar.':'Chats whose content was removed or belongs to another workspace. Everything is still saved; open one to review it.'}</p>}
 </section>;
}
