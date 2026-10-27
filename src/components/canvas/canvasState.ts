import type { Edge } from '@xyflow/react';
import type { Agent } from '../../features/agents/model/Agent';
import type { AgentSession } from '../../features/chat/model/Chat';
import type { CanvasFlowNode } from './canvasTypes';

export interface CanvasGraph { nodes:CanvasFlowNode[]; edges:Edge[] }
export type CanvasPendingContexts = Record<string,Record<string,string[]>>;

// The containing canvas is authoritative. Older nodes without a workspace field remain valid.
export function belongsToCanvas(node:Pick<CanvasFlowNode,'data'>,workspaceId:string):boolean {
  return !node.data.workspaceId||node.data.workspaceId===workspaceId;
}

export function resolveCanvasChat(node:Pick<CanvasFlowNode,'data'>,workspaceId:string,agents:readonly Agent[],sessions:readonly AgentSession[]) {
  const agent=belongsToCanvas(node,workspaceId)?agents.find(item=>item.id===node.data.chatAgentId&&item.workspaceId===workspaceId):undefined;
  const session=agent?sessions.find(item=>item.id===node.data.chatSessionId&&item.agentId===agent.id):undefined;
  return {agent,session};
}

export function pendingCanvasNodeIds(pending:CanvasPendingContexts,workspaceId:string,agent:Agent|undefined,nodes:readonly CanvasFlowNode[]):string[] {
  if(!agent||agent.workspaceId!==workspaceId)return [];
  const available=new Set(nodes.filter(node=>belongsToCanvas(node,workspaceId)).map(node=>node.id));
  return (pending[workspaceId]?.[agent.id]??[]).filter(id=>available.has(id));
}

export function attachCanvasContext(pending:CanvasPendingContexts,workspaceId:string,agent:Agent|undefined,nodeIds:readonly string[],nodes:readonly CanvasFlowNode[]):CanvasPendingContexts {
  if(!agent||agent.workspaceId!==workspaceId)return pending;
  const available=new Set(nodes.filter(node=>belongsToCanvas(node,workspaceId)).map(node=>node.id));
  const ids=[...new Set([...(pending[workspaceId]?.[agent.id]??[]),...nodeIds])].filter(id=>available.has(id));
  if(!ids.length)return pending;
  return {...pending,[workspaceId]:{...pending[workspaceId],[agent.id]:ids}};
}

export function pruneCanvasContext(pending:CanvasPendingContexts,workspaceId:string,nodes:readonly CanvasFlowNode[]):CanvasPendingContexts {
  const entries=pending[workspaceId];if(!entries)return pending;
  const available=new Set(nodes.filter(node=>belongsToCanvas(node,workspaceId)).map(node=>node.id));
  let changed=false;
  const cleaned=Object.fromEntries(Object.entries(entries).flatMap(([agentId,ids])=>{
    const next=ids.filter(id=>available.has(id));
    if(next.length!==ids.length)changed=true;
    return next.length?[[agentId,next]]:[];
  }));
  return changed?{...pending,[workspaceId]:cleaned}:pending;
}

export function reconcileCanvasGraph(graph:CanvasGraph):CanvasGraph {
  const ids=new Set(graph.nodes.map(node=>node.id));
  const edges=graph.edges.filter(edge=>ids.has(edge.source)&&ids.has(edge.target));
  return edges.length===graph.edges.length?graph:{...graph,edges};
}

export function duplicateCanvasNode(source:CanvasFlowNode,id:string):CanvasFlowNode {
  const data={...source.data};
  delete data.sourceMessageId;
  if(source.type==='terminal'){
    for(const key of ['terminalExecutionId','terminalEventCursor','terminalExitCode','terminalOutput','terminalStatus'] as const)delete data[key];
    Object.assign(data,{terminalOutput:'',terminalStatus:'idle',meta:'Local terminal'});
  }
  if(source.type==='chat'){
    for(const key of ['chatAgentId','chatSessionId','chatHandoffId','agentId','agentLabel'] as const)delete data[key];
    data.meta='Connected to Canvas';
  }
  return {...source,id,position:{x:source.position.x+34,y:source.position.y+34},selected:true,dragging:false,resizing:false,data};
}
