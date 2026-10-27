import type { Agent } from '../../features/agents/model/Agent';
import type { AgentSession, ChatMessageItem } from '../../features/chat/model/Chat';
import type { CanvasFlowNode } from './canvasTypes';
import { belongsToCanvas, resolveCanvasChat } from './canvasState.ts';

export function contextLabel(node:CanvasFlowNode):string {
  const data=node.data;
  const value=String(data.title??data.caption??data.hook??data.text??data.summary??data.browserUrl??data.label??'Canvas object');
  return value.length>64?`${value.slice(0,61).trim()}…`:value;
}

export function contextContent(node:CanvasFlowNode,workspaceId:string,agents:readonly Agent[],sessions:readonly AgentSession[]):string {
  if(!belongsToCanvas(node,workspaceId))return '';
  const data=node.data;
  const linked=node.type==='chat'?resolveCanvasChat(node,workspaceId,agents,sessions).session:undefined;
  const transcript=linked?.messages.filter((item):item is ChatMessageItem=>item.type==='message').map(item=>`${item.role}: ${item.content}`).join('\n')??'';
  return [data.title,data.text,data.summary,data.description,data.hook,data.preview,data.caption,data.url,data.browserUrl,data.command,data.terminalOutput,transcript].filter((value):value is string=>typeof value==='string'&&Boolean(value.trim())).join('\n\n').slice(0,12_000);
}

export function getUpstreamNodes(nodeId:string,nodes:readonly CanvasFlowNode[],edges:readonly {source:string;target:string}[],workspaceId:string):CanvasFlowNode[] {
  const byId=new Map(nodes.filter(node=>belongsToCanvas(node,workspaceId)).map(node=>[node.id,node]));
  const found=new Map<string,CanvasFlowNode>();
  const pending=edges.filter(edge=>edge.target===nodeId).map(edge=>edge.source);
  while(pending.length&&found.size<30){
    const sourceId=pending.pop()!;
    if(sourceId===nodeId||found.has(sourceId))continue;
    const node=byId.get(sourceId);if(!node)continue;
    found.set(sourceId,node);
    for(const edge of edges)if(edge.target===sourceId&&!found.has(edge.source))pending.push(edge.source);
  }
  return [...found.values()].reverse();
}
