import type { KeyboardEvent, PointerEvent } from 'react';
import type { Task } from '../../app/types';
import { useLanguage } from '../../app/LanguageProvider';
import { useAgents } from '../../features/agents/AgentsProvider';
import { useChat } from '../../features/chat/ChatProvider';
import { useContentWorkflow } from '../../features/content/ContentWorkflowProvider';
import { AgentAvatar } from '../agents/AgentAvatar';
import { StatusIcon } from '../common/StatusIcon';
import { Icon } from '../common/Icon';

const busyStates=['thinking','searching','using-tool'];

export function TaskCard({task,onOpen,onInspect,selected,onRemove,onDragStart,onDragEnd,isDragging}:{task:Task;onOpen:(task:Task)=>void;onInspect:(task:Task)=>void;selected:boolean;onRemove:(taskId:string)=>void;onDragStart:(taskId:string)=>void;onDragEnd:()=>void;isDragging:boolean}) {
  const {getAgentById}=useAgents();
  const {getRunState}=useChat();
  const {state}=useContentWorkflow();
  const {locale,t}=useLanguage(),pt=locale==='pt-BR';
  const agent=getAgentById(task.agentId);
  const agentName=agent?.name??(task.contentId?(pt?'Fluxo editorial':'Editorial workflow'):t('Deleted agent'));
  const contentTitle=task.contentId?state.contents.find(content=>content.id===task.contentId)?.title:undefined;
  const scope=contentTitle&&contentTitle!==task.title?contentTitle:undefined;
  const busy=!!task.sessionId&&busyStates.includes(getRunState(task.sessionId));
  const line=busy?(pt?'Pensando…':'Thinking…'):[agentName,task.metadata.replace(/[\s·]+$/,'')].filter(Boolean).join(' · ');
  const startDrag=(event:PointerEvent<HTMLElement>)=>{if(event.button===0&&!task.contentId)onDragStart(task.id)};
  const openFromKeyboard=(event:KeyboardEvent<HTMLElement>)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onOpen(task)}};
  // The remove button sits next to the card (not inside it): the card itself is already a button.
  const removeLabel=task.contentId?(pt?`Retirar “${task.title}” do quadro (o conteúdo continua no Estúdio)`:`Remove “${task.title}” from the board (the content stays in the Studio)`):(pt?`Excluir a tarefa “${task.title}”`:`Delete task “${task.title}”`);
  return <div className="task-card-wrap"><article className={`task-card ${selected?'selected':''} ${task.status==='review'?'needs-review':''} ${isDragging?'dragging':''}`} tabIndex={0} role="button" aria-label={`${pt?'Abrir':'Open'} ${task.title}`} aria-grabbed={task.contentId?undefined:isDragging} title={task.contentId?(pt?'O status acompanha as aprovações no Estúdio de conteúdo.':'Editorial status follows approval in Content Studio.'):undefined} onClick={()=>onOpen(task)} onKeyDown={openFromKeyboard} onPointerDown={startDrag} onPointerCancel={onDragEnd}>
    {scope&&<span className="task-scope">{scope}</span>}
    <span className="task-state"><StatusIcon state={busy||task.status==='running'?'running':task.status==='review'?'waiting':task.status==='done'?'done':'queued'}/><span className="v2-mono task-id" title={task.id}>{task.id}</span></span>
    <h3>{task.title}</h3>
    <div className="task-agent">
      {agent?<AgentAvatar name={agent.name} image={agent.avatarImage} mascot={agent.avatarMascot} role={agent.role} thinking={busy}/>:<span className="agent-monogram">E</span>}
      <span className={busy?'ov-shimmer':''}>{line}</span>
    </div>
    {task.status==='review'&&<span className="task-review-action">{pt?'Revisar':'Review'}</span>}
  </article>
  <button type="button" className="task-card-inspect" aria-label={pt?`Ver detalhes de ${task.title}`:`View details for ${task.title}`} onClick={()=>onInspect(task)}><Icon name="search"/></button>
  <button type="button" className="task-card-remove" aria-label={removeLabel} title={removeLabel} onClick={()=>onRemove(task.id)}><Icon name="close"/></button></div>;
}
