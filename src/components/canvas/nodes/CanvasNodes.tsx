export { TerminalNode } from './TerminalNode';
import { useEffect, useRef, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useChatDraft, writeChatDraft } from '../../../features/chat/chatDrafts';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { AgentSession, ChatContextReference, ChatMessageItem } from '../../../features/chat/model/Chat';
import { useAgents } from '../../../features/agents/AgentsProvider';
import { useChat } from '../../../features/chat/ChatProvider';
import { useWorkspaces } from '../../../app/WorkspaceProvider';
import { useCanvas } from '../CanvasProvider';
import type { CanvasFlowNode, CanvasNodeKind } from '../canvasTypes';
import { Icon, type IconName } from '../../common/Icon';
import { useLanguage } from '../../../app/LanguageProvider';
import { SelectMenu } from '../../common/SelectMenu';
import { CanvasBrowser } from './CanvasBrowser';
import { browserHome } from '../browserNavigation';
import { ChatMessageImages } from '../../chat/ChatMessageImages';

const nodeIcons:Record<CanvasNodeKind,IconName>={note:'note',research:'search',image:'image',contentIdea:'spark',hook:'link',script:'script',terminal:'terminal',browser:'globe',chat:'message'};

function CanvasNodeShell({id,data,selected,kind,children,header,showFooter=true}:{id:string;data:CanvasFlowNode['data'];selected:boolean;kind:CanvasNodeKind;children:ReactNode;header?:ReactNode;showFooter?:boolean}) {
  const {getAgentById}=useAgents();
  const footer=[data.meta,data.groupLabel,data.agentId?getAgentById(data.agentId)?.name:undefined].filter(Boolean).join(' · ');

  return <article className={`flow-node ${kind} ${selected?'selected':''} ${data.groupId?'grouped':''} ${data.chatHandoffId?'collaboration-chat':''}`} aria-label={`${data.label} node`}>
    <Handle className="flow-handle" type="target" position={Position.Left}/>
    {header??<div className="flow-node-type"><Icon name={nodeIcons[kind]}/><span>{data.label}</span></div>}
    <div className="flow-node-content">{children}</div>
    {data.contentId&&<button type="button" className="soft-button nodrag nopan" onClick={()=>window.dispatchEvent(new CustomEvent('mainsagents:open-content',{detail:{contentId:data.contentId}}))}>↗ {document.documentElement.lang==='pt-BR'?'Abrir conteúdo':'Open content'}</button>}
    {showFooter&&footer&&<footer><span>{footer}</span><span aria-hidden="true">•••</span></footer>}
    <Handle className="flow-handle" type="source" position={Position.Right}/>
  </article>;
}

export function ResearchNode({id,data,selected}:NodeProps<CanvasFlowNode>) {
  return <CanvasNodeShell id={id} data={data} selected={selected} kind="research"><span className="research-source">{data.source}</span><h3>{data.title}</h3><p>{data.summary}</p>{data.url&&<a className="research-url nodrag" href={data.url} target="_blank" rel="noreferrer" onClick={(event)=>event.stopPropagation()}><Icon name="link"/>{compactUrl(data.url)}</a>}</CanvasNodeShell>;
}

export function ImageNode({id,data,selected}:NodeProps<CanvasFlowNode>) {
  return <CanvasNodeShell id={id} data={data} selected={selected} kind="image">{data.imageUrl&&<img className="flow-image" src={data.imageUrl} alt="" draggable={false}/>}<p className="image-caption">{data.caption}</p></CanvasNodeShell>;
}

export function ContentIdeaNode({id,data,selected}:NodeProps<CanvasFlowNode>) {
  return <CanvasNodeShell id={id} data={data} selected={selected} kind="contentIdea"><span className="platform-chip">{data.platform}</span><h3>{data.title}</h3><p>{data.description}</p></CanvasNodeShell>;
}

export function HookNode({id,data,selected}:NodeProps<CanvasFlowNode>) {
  return <CanvasNodeShell id={id} data={data} selected={selected} kind="hook"><blockquote>{data.hook}</blockquote></CanvasNodeShell>;
}

export function ScriptNode({id,data,selected}:NodeProps<CanvasFlowNode>) {
  return <CanvasNodeShell id={id} data={data} selected={selected} kind="script"><h3>{data.title}</h3><p>{data.preview}</p><span className="word-count">{data.wordCount ?? 0} words</span></CanvasNodeShell>;
}

export function NoteNode({id,data,selected}:NodeProps<CanvasFlowNode>) {
  const {currentWorkspaceId}=useWorkspaces();
  const {updateNodeData}=useCanvas();
  const {t}=useLanguage();
  const workspaceId=String(data.workspaceId??currentWorkspaceId);
  return <CanvasNodeShell id={id} data={data} selected={selected} kind="note" showFooter={Boolean(data.groupLabel||data.agentId)} header={<div className="sticky-note-grip"><span className="sticky-note-dot"/><span>{t('Note')}</span><span className="sticky-note-grip-lines" aria-hidden="true">⋮⋮</span></div>}><textarea className="note-editor nodrag nowheel" aria-label={t('Note text')} value={String(data.text??'')} placeholder={t('Write a note…')} onChange={(event)=>updateNodeData(workspaceId,id,{text:event.target.value})}/></CanvasNodeShell>;
}

export function BrowserNode({id,data,selected}:NodeProps<CanvasFlowNode>) {
  const {currentWorkspaceId}=useWorkspaces();
  const {updateNodeData}=useCanvas();
  const {t}=useLanguage();
  const workspaceId=String(data.workspaceId??currentWorkspaceId);
  const url=String(data.browserUrl||browserHome);
  const hostname=(()=>{try{return new URL(url).hostname.replace(/^www\./,'')}catch{return ''}})();
  return <CanvasNodeShell id={id} data={data} selected={selected} kind="browser" showFooter={false} header={<div className="browser-window-chrome"><span className="browser-window-dots" aria-hidden="true"><i/><i/><i/></span><span className="browser-window-title">{hostname||t('Browser')}</span>{url&&<a className="browser-window-open nodrag" href={url} target="_blank" rel="noreferrer" onClick={event=>event.stopPropagation()} aria-label={t('Open website in a new window')} title={t('Open website in a new window')}><Icon name="external"/></a>}</div>}>
    <CanvasBrowser url={url} onNavigate={browserUrl=>updateNodeData(workspaceId,id,{browserUrl})}/>
  </CanvasNodeShell>;
}

export function ChatNode({id,data,selected}:NodeProps<CanvasFlowNode>) {
  const {currentWorkspaceId}=useWorkspaces();
  const {agents}=useAgents();
  const {nodes,edges,allNodes,updateNodeData}=useCanvas();
  const {sessions,createSession,openSession,sendMessage,getRunState,refreshSessionImages}=useChat();
  const {t,locale}=useLanguage();
  const workspaceId=String(data.workspaceId??currentWorkspaceId);
  const availableAgents=agents.filter(agent=>agent.workspaceId===workspaceId);
  const agent=agents.find(item=>item.id===data.chatAgentId);
  const session=sessions.find(item=>item.id===data.chatSessionId&&item.agentId===agent?.id);
  const messages=session?.messages.filter((item):item is ChatMessageItem=>item.type==='message')??[];
  const state=getRunState(session?.id);
  const busy=['thinking','searching','using-tool'].includes(state);
  const chatDraft=useChatDraft(agent?.id??'',session?.id);
  const draft=chatDraft.text;
  const setDraft=(text:string)=>{if(agent&&session)writeChatDraft(agent.id,session.id,{...chatDraft,text})};
  const transcriptRef=useRef<HTMLDivElement>(null);
  const followRef=useRef(true);
  const inbound=getUpstreamNodes(id,nodes,edges);
  const savedContext=(chatDraft.context??[]).flatMap(ref=>{
    const node=allNodes.find(item=>item.workspaceId===workspaceId&&ref.workspaceId===workspaceId&&item.node.id===ref.nodeId)?.node;
    return node?[{nodeId:node.id,label:contextLabel(node),kind:node.type??'note',content:contextContent(node,sessions)}]:[];
  });
  const contextNodes:ChatContextReference[]=[...new Map([...savedContext,...inbound.map(node=>({nodeId:node.id,label:contextLabel(node),kind:node.type??'note',content:contextContent(node,sessions)}))].map(ref=>[ref.nodeId,ref])).values()];
  const missingContext=(chatDraft.context??[]).filter(ref=>!savedContext.some(item=>item.nodeId===ref.nodeId));

  useEffect(()=>{followRef.current=true},[session?.id]);
  useEffect(()=>{if(session?.codexThreadId)void refreshSessionImages(session.id).catch(()=>{});},[session?.id,session?.codexThreadId,refreshSessionImages]);
  useEffect(()=>{const element=transcriptRef.current;if(element&&followRef.current)element.scrollTop=element.scrollHeight},[messages.length,messages.at(-1)?.content,session?.id,busy]);

  const chooseAgent=(agentId:string)=>{
    const next=availableAgents.find(item=>item.id===agentId);
    if(!next){updateNodeData(workspaceId,id,{chatAgentId:undefined,chatSessionId:undefined});return}
    const nextSession=createSession(next.id,t('Canvas chat'),next.providerId??'codex',next.modelId);
    updateNodeData(workspaceId,id,{chatAgentId:next.id,chatSessionId:nextSession.id,agentId:next.id,agentLabel:next.name});
  };
  const submit=(event:FormEvent)=>{
    event.preventDefault();
    const content=draft.trim();
    if(!content||!agent||!session||busy)return;
    openSession(agent.id,session.id);
    followRef.current=true;
    sendMessage(agent,content,contextNodes,session.id,chatDraft.skill??undefined);
    writeChatDraft(agent.id,session.id,{text:'',skill:null,context:[]});
  };
  const handleKeyDown=(event:KeyboardEvent<HTMLTextAreaElement>)=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();event.currentTarget.form?.requestSubmit()}};

  return <CanvasNodeShell id={id} data={data} selected={selected} kind="chat" showFooter={!data.chatHandoffId}>
    <div className="canvas-chat-head nodrag"><SelectMenu className="canvas-node-select" ariaLabel={t('Choose an agent')} value={data.chatAgentId??''} onChange={chooseAgent} options={[{value:'',label:t('Choose an agent')},...availableAgents.map(item=>({value:item.id,label:item.name}))]}/>{agent&&<span>{agent.role}</span>}</div>
    {agent&&session?<>
      {data.chatHandoffId&&<div className="canvas-chat-session" title={session.title}>{session.title}</div>}
      <div className="canvas-chat-transcript nodrag nowheel" ref={transcriptRef} aria-live="polite" onScroll={event=>{const element=event.currentTarget;followRef.current=element.scrollHeight-element.scrollTop-element.clientHeight<48}}>
        {messages.length?messages.map(message=><div key={message.id} className={`canvas-chat-message ${message.role} ${message.sourceAgentName?'received-task':''}`}><small>{message.sourceAgentName??(message.role==='user'?t('You'):agent.name)}</small>{message.sourceAgentName?<details className="canvas-chat-briefing"><summary>{t('Task')} · {message.sourceAgentName}</summary><p>{message.content}</p></details>:message.content&&<p>{message.content}</p>}{message.images?.length?<ChatMessageImages images={message.images} onLoad={()=>{if(followRef.current&&transcriptRef.current)transcriptRef.current.scrollTop=transcriptRef.current.scrollHeight;}}/>:null}{message.contextNodes&&message.contextNodes.length>0&&<span className="canvas-chat-context-used">{t('Used {{count}} connected objects',{count:message.contextNodes.length})}</span>}</div>):<p className="canvas-chat-empty">{inbound.length?t('Connected objects will be included with your message.') :t('Start a conversation or connect objects to provide context.')}</p>}
        {busy&&<div className="canvas-chat-thinking">{t(state==='using-tool'?'Using a tool…':state==='searching'?'Searching…':'Thinking…')}</div>}
        {state==='error'&&<p className="canvas-chat-error" role="alert">{t('Error')} · {t('Check your AI connection and try again.')}</p>}
      </div>
      {contextNodes.length>0&&<div className="canvas-chat-connections"><Icon name="link"/><span>{t('{{count}} connected objects as context',{count:contextNodes.length})}</span></div>}
      {missingContext.length>0&&<p className="composer-draft-warning" role="status">{locale==='pt-BR'?'Contexto indisponível; não será enviado: ':'Unavailable context; will not be sent: '}{missingContext.map(ref=>ref.label).join(', ')}</p>}
      <form className="canvas-chat-composer nodrag" onSubmit={submit}><textarea className="nodrag nowheel" aria-label={t('Message')} placeholder={t('Message {{name}}…',{name:agent.name})} value={draft} onChange={event=>setDraft(event.target.value)} onKeyDown={handleKeyDown} rows={2}/><button className="canvas-chat-send nodrag" type="submit" disabled={!draft.trim()||busy} aria-label={t('Send message')}><Icon name="play"/></button></form>
    </>:<div className="canvas-chat-setup"><Icon name="message"/><p>{availableAgents.length?t('Choose an agent to give this chat its own conversation.'):t('Create an agent in this workspace to start a Canvas chat.')}</p></div>}
  </CanvasNodeShell>;
}


function contextLabel(node:CanvasFlowNode):string {
  const data=node.data;
  const value=String(data.title??data.caption??data.hook??data.text??data.summary??data.browserUrl??data.label??'Canvas object');
  return value.length>64?`${value.slice(0,61).trim()}…`:value;
}

function contextContent(node:CanvasFlowNode,sessions:readonly AgentSession[]):string {
  const data=node.data;
  const linkedSession=data.chatSessionId?sessions.find(session=>session.id===data.chatSessionId):undefined;
  const transcript=linkedSession?.messages.filter((item):item is ChatMessageItem=>item.type==='message').map(item=>`${item.role}: ${item.content}`).join('\n')??'';
  return [data.title,data.text,data.summary,data.description,data.hook,data.preview,data.caption,data.url,data.browserUrl,data.command,data.terminalOutput,transcript].filter((value):value is string=>typeof value==='string'&&Boolean(value.trim())).join('\n\n').slice(0,12_000);
}

function getUpstreamNodes(nodeId:string,nodes:readonly CanvasFlowNode[],edges:readonly {source:string;target:string}[]):CanvasFlowNode[] {
  const byId=new Map(nodes.map(node=>[node.id,node]));
  const found=new Map<string,CanvasFlowNode>();
  const pending=edges.filter(edge=>edge.target===nodeId).map(edge=>edge.source);
  while(pending.length&&found.size<30){
    const sourceId=pending.pop()!;
    if(sourceId===nodeId||found.has(sourceId))continue;
    const node=byId.get(sourceId);
    if(!node)continue;
    found.set(sourceId,node);
    for(const edge of edges)if(edge.target===sourceId&&!found.has(edge.source))pending.push(edge.source);
  }
  return [...found.values()].reverse();
}

function compactUrl(url:string) {
  try { return new URL(url).hostname.replace(/^www\./,''); }
  catch { return url; }
}
