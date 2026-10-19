import {useMemo,useRef,useState} from 'react';
import type {AgentSession} from '../../features/chat/model/Chat';
import type {EditorialContent} from '../../features/content/model';
import {useAgents} from '../../features/agents/AgentsProvider';
import {useChat} from '../../features/chat/ChatProvider';
import {useContentWorkflow} from '../../features/content/ContentWorkflowProvider';
import {useProduction} from '../../features/production/ProductionProvider';
import {OrganizeRefused,chatFamily,organizeCheck,organizeProblemText,type OrganizeProblem} from '../../features/chat/contentScopes';
import {FlowDialog} from '../common/FlowDialog';
import {SelectMenu} from '../common/SelectMenu';

/**
 * Explicit organize of a General chat into an existing content. Nothing is guessed from titles: the user picks the content,
 * optionally includes the chats explicitly connected to it (all of them or none), and the move is refused with the reason when
 * it would mix contents. The guard runs again on the live state when the user confirms. A refused move offers a fresh chat in
 * that content instead; the old chat stays in General untouched.
 */
export function OrganizeChatDialog({session,pt,onClose,onDone,onFreshChat}:{
 session:AgentSession;pt:boolean;onClose:()=>void;onDone:(content:EditorialContent,count:number)=>void;onFreshChat:(content:EditorialContent)=>void;
}){
 const {agents}=useAgents(),{sessions,assignSessionsToContent,isSessionBusy}=useChat(),{state}=useContentWorkflow(),{runs}=useProduction();
 // Read at confirmation time: the authoritative editorial/production state as it is THEN, not when the dialog opened.
 const live=useRef({state,runs,agents});live.current={state,runs,agents};
 const workspaceId=agents.find(agent=>agent.id===session.agentId)?.workspaceId;
 const contents=state.contents.filter(content=>content.workspaceId===workspaceId&&content.productionStage!=='archived');
 const [contentId,setContentId]=useState(contents[0]?.id??''),[family,setFamily]=useState(false),[error,setError]=useState('');
 const target=contents.find(content=>content.id===contentId);
 const group=useMemo(()=>chatFamily(session,sessions),[session,sessions]);
 const relatives=group.members.filter(item=>item.id!==session.id);
 const ids=family?group.members.map(item=>item.id):[session.id];
 const groupProblems:OrganizeProblem[]=family&&group.truncated?['family-too-large']:[];
 const check=organizeCheck(ids,target,{sessions,agents,runs,artifacts:state.artifacts,busy:isSessionBusy},groupProblems);
 const agentName=(id:string)=>agents.find(agent=>agent.id===id)?.name??(pt?'Agente removido':'Deleted agent');
 const confirm=()=>{
  if(!target||!check.ok)return;
  try{
   const moved=check.members.filter(member=>!member.already).length;
   assignSessionsToContent({rootId:session.id,family,ids,contentId:target.id},()=>({contents:live.current.state.contents.filter(content=>content.workspaceId===workspaceId),runs:live.current.runs,artifacts:live.current.state.artifacts,agents:live.current.agents}),session.id);
   onDone(target,moved);
  }catch(reason){setError(reason instanceof OrganizeRefused?`${pt?'Nada foi movido':'Nothing moved'}: ${reason.problems.map(problem=>organizeProblemText(problem,pt)).join(' ')}`:reason instanceof Error?reason.message:String(reason));}
 };
 return <FlowDialog title={pt?'Organizar em um conteúdo':'Organize into a content'} description={pt?'Escolha o conteúdo a que esta conversa pertence. O histórico e a conversa do provedor continuam os mesmos; a partir daqui ela aparece só nesse conteúdo.':'Choose the content this chat belongs to. History and provider thread stay the same; from now on it only shows in that content.'} onClose={onClose}>
  <form className="handoff-form organize-chat-form" onSubmit={event=>{event.preventDefault();confirm();}}>
   {contents.length?<label>{pt?'Conteúdo':'Content'}<SelectMenu value={contentId} onChange={setContentId} ariaLabel={pt?'Conteúdo de destino':'Target content'} options={contents.map(content=>({value:content.id,label:content.title}))}/></label>
    :<p role="status">{pt?'Este espaço ainda não tem conteúdos. Crie um em “Novo conteúdo”.':'This workspace has no contents yet. Create one with “New content”.'}</p>}
   {relatives.length>0&&<label className="organize-family"><input type="checkbox" checked={family} onChange={event=>setFamily(event.target.checked)}/>{group.truncated?(pt?`Levar junto as conversas conectadas a esta (mais de ${relatives.length})`:`Also move the chats connected to this one (more than ${relatives.length})`):(pt?`Levar junto as ${relatives.length} conversas conectadas a esta (conexões, envios entre agentes ou comparação)`:`Also move the ${relatives.length} chats connected to this one (connections, handoffs or comparison)`)}</label>}
   {group.crossScope.length>0&&<p className="organize-note" role="note">{pt?`${group.crossScope.length} ${group.crossScope.length===1?'conversa ligada pertence':'conversas ligadas pertencem'} a outro conteúdo (${group.crossScope.map(item=>item.title).join(', ')}). ${group.crossScope.length===1?'Ela não será movida':'Elas não serão movidas'} nem contam como conversas deste conteúdo; um pedido novo abre uma conversa nova aqui.`:`${group.crossScope.length} linked chat(s) belong to another content (${group.crossScope.map(item=>item.title).join(', ')}). They are not moved and do not count as this content’s chats; a new request opens a fresh chat here.`}</p>}
   <ul className="organize-members" aria-label={pt?'Conversas que serão organizadas':'Chats to organize'}>
    {check.members.map(member=><li key={member.session?.id??'missing'} data-blocked={member.problems.length?'true':undefined}>
     <b>{member.session?.title??'—'}</b><small>{member.session?agentName(member.session.agentId):''}{member.already?(pt?' · já está neste conteúdo':' · already in this content'):''}</small>
     {member.problems.map(problem=><span key={problem} className="organize-problem">{organizeProblemText(problem,pt)}</span>)}
    </li>)}
   </ul>
   {groupProblems.map(problem=><p key={problem} role="alert">{organizeProblemText(problem,pt)}</p>)}
   {target&&!check.ok&&check.members.some(member=>member.problems.length)&&<p role="alert">{pt?'Mover agora misturaria contextos, então nada será alterado. Você pode começar uma conversa nova neste conteúdo; a antiga continua em Geral.':'Moving now would mix contexts, so nothing changes. You can start a fresh chat in this content; the old one stays in General.'}</p>}
   {error&&<p role="alert">{error}</p>}
   <footer>
    <button type="button" className="soft-button" onClick={onClose}>{pt?'Cancelar':'Cancel'}</button>
    {target&&!check.ok&&<button type="button" className="soft-button" onClick={()=>onFreshChat(target)}>{pt?'Começar conversa nova aqui':'Start a fresh chat here'}</button>}
    <button className="primary-button" disabled={!target||!check.ok}>{pt?'Organizar':'Organize'}</button>
   </footer>
  </form>
 </FlowDialog>;
}
