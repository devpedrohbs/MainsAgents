import type { ReactNode } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CanvasFlowNode, CanvasNodeKind } from '../canvasTypes';
import { useAgents } from '../../../features/agents/AgentsProvider';
import { Icon, type IconName } from '../../common/Icon';

const nodeIcons:Record<CanvasNodeKind,IconName>={note:'note',research:'search',image:'image',contentIdea:'spark',hook:'link',script:'script'};

function CanvasNodeShell({data,selected,kind,children}:{data:CanvasFlowNode['data'];selected:boolean;kind:CanvasNodeKind;children:ReactNode}) {
  const {getAgentById}=useAgents();
  const footer=[data.meta,data.groupLabel,data.agentId?getAgentById(data.agentId)?.name:undefined].filter(Boolean).join(' · ');

  return <article className={`flow-node ${kind} ${selected?'selected':''} ${data.groupId?'grouped':''}`} aria-label={`${data.label} node`}>
    <Handle className="flow-handle" type="target" position={Position.Left}/>
    <div className="flow-node-type"><Icon name={nodeIcons[kind]}/><span>{data.label}</span></div>
    <div className="flow-node-content">{children}</div>
    {footer&&<footer><span>{footer}</span><span aria-hidden="true">•••</span></footer>}
    <Handle className="flow-handle" type="source" position={Position.Right}/>
  </article>;
}

export function ResearchNode({data,selected}:NodeProps<CanvasFlowNode>) {
  return <CanvasNodeShell data={data} selected={selected} kind="research"><span className="research-source">{data.source}</span><h3>{data.title}</h3><p>{data.summary}</p>{data.url&&<a className="research-url nodrag" href={data.url} target="_blank" rel="noreferrer" onClick={(event)=>event.stopPropagation()}><Icon name="link"/>{compactUrl(data.url)}</a>}</CanvasNodeShell>;
}

export function ImageNode({data,selected}:NodeProps<CanvasFlowNode>) {
  return <CanvasNodeShell data={data} selected={selected} kind="image">{data.imageUrl&&<img className="flow-image" src={data.imageUrl} alt="" draggable={false}/>}<p className="image-caption">{data.caption}</p></CanvasNodeShell>;
}

export function ContentIdeaNode({data,selected}:NodeProps<CanvasFlowNode>) {
  return <CanvasNodeShell data={data} selected={selected} kind="contentIdea"><span className="platform-chip">{data.platform}</span><h3>{data.title}</h3><p>{data.description}</p></CanvasNodeShell>;
}

export function HookNode({data,selected}:NodeProps<CanvasFlowNode>) {
  return <CanvasNodeShell data={data} selected={selected} kind="hook"><blockquote>{data.hook}</blockquote></CanvasNodeShell>;
}

export function ScriptNode({data,selected}:NodeProps<CanvasFlowNode>) {
  return <CanvasNodeShell data={data} selected={selected} kind="script"><h3>{data.title}</h3><p>{data.preview}</p><span className="word-count">{data.wordCount ?? 0} words</span></CanvasNodeShell>;
}

export function NoteNode({data,selected}:NodeProps<CanvasFlowNode>) {
  return <CanvasNodeShell data={data} selected={selected} kind="note"><p className="note-text">{data.text}</p></CanvasNodeShell>;
}

function compactUrl(url:string) {
  try { return new URL(url).hostname.replace(/^www\./,''); }
  catch { return url; }
}
