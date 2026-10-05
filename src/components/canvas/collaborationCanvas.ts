import type { Edge, Viewport } from '@xyflow/react';
import type { Agent } from '../../features/agents/model/Agent';
import type { AgentSession } from '../../features/chat/model/Chat';
import type { CanvasFlowNode } from './canvasTypes';

export interface CollaborationChat { agent:Agent; session:AgentSession }
export interface CollaborationCanvasInput {
  workspaceId:string;
  handoffId:string;
  source:CollaborationChat;
  target:CollaborationChat;
}

const width=420,height=560,gap=100,margin=40;
const size=(node:CanvasFlowNode)=>({width:node.measured?.width??node.width??(node.type==='chat'?width:280),height:node.measured?.height??node.height??(node.type==='chat'?height:240)});
const overlaps=(position:{x:number;y:number},nodes:readonly CanvasFlowNode[],pair=false)=>nodes.some(node=>{
  const bounds=size(node);
  return position.x<node.position.x+bounds.width+margin&&position.x+(pair?width*2+gap:width)+margin>node.position.x&&position.y<node.position.y+bounds.height+margin&&position.y+height+margin>node.position.y;
});

/** Bind live sessions; never copy transcripts or create conversations as a side effect. */
export function addCollaborationChats(nodes:CanvasFlowNode[],edges:Edge[],view:{viewport:Viewport;width:number;height:number},input:CollaborationCanvasInput):{nodes:CanvasFlowNode[];edges:Edge[];nodeIds:string[]} {
  const {workspaceId,source,target,handoffId}=input;
  if(source.agent.workspaceId!==workspaceId||target.agent.workspaceId!==workspaceId||source.session.agentId!==source.agent.id||target.session.agentId!==target.agent.id||source.session.id===target.session.id)throw new Error('Invalid collaboration sessions');
  const existing=(chat:CollaborationChat)=>nodes.find(node=>node.type==='chat'&&node.data.chatAgentId===chat.agent.id&&node.data.chatSessionId===chat.session.id&&(!node.data.workspaceId||node.data.workspaceId===workspaceId));
  const sourceNode=existing(source),targetNode=existing(target);
  let position=sourceNode?{x:sourceNode.position.x+size(sourceNode).width+gap,y:sourceNode.position.y}:targetNode?{x:targetNode.position.x-width-gap,y:targetNode.position.y}:{x:(view.width/2-view.viewport.x)/view.viewport.zoom-width-gap/2,y:(view.height/2-view.viewport.y)/view.viewport.zoom-height/2};
  const pair=!sourceNode&&!targetNode;
  // Move past occupied objects, including browser and terminal windows on crowded canvases.
  while(overlaps(position,nodes,pair))position={...position,y:Math.max(...nodes.filter(node=>overlaps(position,[node],pair)).map(node=>node.position.y+size(node).height+margin))};
  const makeNode=(chat:CollaborationChat,previous:CanvasFlowNode|undefined,index:number):CanvasFlowNode=>{
    if(previous)return {...previous,data:{...previous.data,chatHandoffId:handoffId}};
    const baseId=`session-chat-${encodeURIComponent(chat.session.id)}`;
    let id=baseId,suffix=2;
    while(nodes.some(node=>node.id===id))id=`${baseId}-${suffix++}`;
    return {id,type:'chat',position:{x:position.x+(pair?index*(width+gap):0),y:position.y},data:{label:'Chat',meta:chat.session.title,workspaceId,chatAgentId:chat.agent.id,chatSessionId:chat.session.id,agentId:chat.agent.id,agentLabel:chat.agent.name,chatHandoffId:handoffId}};
  };
  const from=makeNode(source,sourceNode,0),to=makeNode(target,targetNode,1),nodeIds=[from.id,to.id];
  const nextNodes=[...nodes.map(node=>node.id===from.id?from:node.id===to.id?to:node),...(!sourceNode?[from]:[]),...(!targetNode?[to]:[])].map(node=>({...node,selected:nodeIds.includes(node.id)}));
  const connected=edges.some(edge=>edge.source===from.id&&edge.target===to.id);
  const nextEdges:Edge[]=connected?edges:[...edges,{id:`collaboration-${from.id}-${to.id}`,source:from.id,target:to.id,type:'smoothstep',markerEnd:{type:'arrowclosed',color:'var(--muted)',width:14,height:14},data:{handoffId}}];
  return {nodes:nextNodes,edges:nextEdges,nodeIds};
}
