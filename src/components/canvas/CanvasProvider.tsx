import { createContext, useCallback, useContext, useMemo, useState, type Dispatch, type PropsWithChildren, type SetStateAction } from 'react';
import { applyEdgeChanges, applyNodeChanges, type Edge, type EdgeChange, type NodeChange, type Viewport } from '@xyflow/react';
import { useWorkspaces } from '../../app/WorkspaceProvider';
import type { Agent, AgentId } from '../../features/agents/model/Agent';
import type { ChatContextReference, ChatMessageItem } from '../../features/chat/model/Chat';
import type { CanvasFlowNode, CanvasNodeData, CanvasNodeKind } from './canvasTypes';
import { usePersistentState } from '../../data/localPersistence';

interface CanvasViewState { viewport:Viewport; width:number; height:number; ready:boolean }
interface WorkspaceCanvasState { nodes:CanvasFlowNode[]; edges:Edge[]; view:CanvasViewState }
interface AddResponseResult { kind:CanvasNodeKind; label:string; nodeId:string }
interface CanvasContextValue {
  nodes:CanvasFlowNode[];
  edges:Edge[];
  setNodes:Dispatch<SetStateAction<CanvasFlowNode[]>>;
  setEdges:Dispatch<SetStateAction<Edge[]>>;
  onNodesChange:(changes:NodeChange<CanvasFlowNode>[])=>void;
  onEdgesChange:(changes:EdgeChange[])=>void;
  view:CanvasViewState;
  updateView:(viewport:Viewport,width:number,height:number)=>void;
  addNode:(kind:CanvasNodeKind)=>string;
  addAgentResponse:(message:ChatMessageItem,agent:Agent)=>AddResponseResult;
  hasMessageNode:(messageId:string)=>boolean;
  attachNodesToAgent:(agentId:AgentId,nodeIds:string[])=>void;
  getAgentContext:(agentId:AgentId)=>ChatContextReference[];
  removeNodeFromAgentContext:(agentId:AgentId,nodeId:string)=>void;
  clearAgentContext:(agentId:AgentId)=>void;
  groupNodes:(nodeIds:string[])=>string;
}

const kindLabels:Record<CanvasNodeKind,string>={note:'Note',research:'Research',image:'Image',contentIdea:'Content idea',hook:'Hook',script:'Script'};
const initialView:CanvasViewState={viewport:{x:0,y:0,zoom:1},width:900,height:640,ready:false};
const CanvasContext=createContext<CanvasContextValue|null>(null);

export function CanvasProvider({children}:PropsWithChildren) {
  const {currentWorkspaceId}=useWorkspaces();
  const [workspaceCanvases,setWorkspaceCanvases]=usePersistentState<Record<string,WorkspaceCanvasState>>('canvas-workspaces',{});
  const canvasState=workspaceCanvases[currentWorkspaceId]??{nodes:[],edges:[],view:{...initialView,viewport:{...initialView.viewport}}};
  const {nodes,edges,view}=canvasState;
  const setNodes=useCallback<Dispatch<SetStateAction<CanvasFlowNode[]>>>((update)=>setWorkspaceCanvases((current)=>{const state=current[currentWorkspaceId]??{nodes:[],edges:[],view:{...initialView,viewport:{...initialView.viewport}}};const next=typeof update==='function'?update(state.nodes):update;return {...current,[currentWorkspaceId]:{...state,nodes:next}}}),[currentWorkspaceId]);
  const setEdges=useCallback<Dispatch<SetStateAction<Edge[]>>>((update)=>setWorkspaceCanvases((current)=>{const state=current[currentWorkspaceId]??{nodes:[],edges:[],view:{...initialView,viewport:{...initialView.viewport}}};const next=typeof update==='function'?update(state.edges):update;return {...current,[currentWorkspaceId]:{...state,edges:next}}}),[currentWorkspaceId]);
  const [contextNodeIds,setContextNodeIds]=useState<Record<AgentId,string[]>>({});

  const onNodesChange=useCallback((changes:NodeChange<CanvasFlowNode>[])=>setNodes((current)=>applyNodeChanges(changes,current)),[setNodes]);
  const onEdgesChange=useCallback((changes:EdgeChange[])=>setEdges((current)=>applyEdgeChanges(changes,current)),[setEdges]);
  const updateView=useCallback((viewport:Viewport,width:number,height:number)=>setWorkspaceCanvases((current)=>{const state=current[currentWorkspaceId]??{nodes:[],edges:[],view:initialView};return {...current,[currentWorkspaceId]:{...state,view:{viewport,width,height,ready:true}}}}),[currentWorkspaceId]);
  const addNode=useCallback((kind:CanvasNodeKind)=>{const nodeId=`node-${kind}-${Date.now().toString(36)}`;setNodes((current)=>[...current.map((node)=>({...node,selected:false})),{id:nodeId,type:kind,position:findFreePosition(current,view),selected:true,data:newNodeData(kind)}]);return nodeId},[setNodes,view]);

  const addAgentResponse=useCallback((message:ChatMessageItem,agent:Agent):AddResponseResult=>{
    const kind=classifyResponse(message.content,agent);
    const nodeId=`chat-${message.id}-${Date.now().toString(36)}`;
    setNodes((current)=>{
      if(current.some((node)=>node.data.sourceMessageId===message.id))return current;
      const position=findFreePosition(current,view);
      const node:CanvasFlowNode={id:nodeId,type:kind,position,selected:true,data:responseData(kind,message,agent)};
      return [...current.map((item)=>({...item,selected:false})),node];
    });
    return {kind,label:kindLabels[kind],nodeId};
  },[setNodes,view]);

  const attachNodesToAgent=useCallback((agentId:AgentId,nodeIds:string[])=>setContextNodeIds((current)=>({...current,[agentId]:Array.from(new Set([...(current[agentId]??[]),...nodeIds]))})),[]);
  const removeNodeFromAgentContext=useCallback((agentId:AgentId,nodeId:string)=>setContextNodeIds((current)=>({...current,[agentId]:(current[agentId]??[]).filter((id)=>id!==nodeId)})),[]);
  const clearAgentContext=useCallback((agentId:AgentId)=>setContextNodeIds((current)=>({...current,[agentId]:[]})),[]);
  const getAgentContext=useCallback((agentId:AgentId):ChatContextReference[]=>(contextNodeIds[agentId]??[]).flatMap((nodeId)=>{const node=nodes.find((item)=>item.id===nodeId);return node?[{nodeId,label:getNodeContextLabel(node),kind:node.type}]:[]}),[contextNodeIds,nodes]);
  const groupNodes=useCallback((nodeIds:string[])=>{const groupId=`group-${Date.now().toString(36)}`;setNodes((current)=>{const groupNumber=new Set(current.map((node)=>node.data.groupId).filter(Boolean)).size+1;return current.map((node)=>nodeIds.includes(node.id)?{...node,data:{...node.data,groupId,groupLabel:`Group ${String(groupNumber).padStart(2,'0')}`}}:node)});return groupId},[setNodes]);

  const value=useMemo<CanvasContextValue>(()=>({nodes,edges,setNodes,setEdges,onNodesChange,onEdgesChange,view,updateView,addNode,addAgentResponse,hasMessageNode:(messageId)=>nodes.some((node)=>node.data.sourceMessageId===messageId),attachNodesToAgent,getAgentContext,removeNodeFromAgentContext,clearAgentContext,groupNodes}),[addAgentResponse,addNode,attachNodesToAgent,clearAgentContext,edges,getAgentContext,groupNodes,nodes,onEdgesChange,onNodesChange,removeNodeFromAgentContext,updateView,view]);
  return <CanvasContext.Provider value={value}>{children}</CanvasContext.Provider>;
}

export function useCanvas():CanvasContextValue {
  const context=useContext(CanvasContext);
  if(!context)throw new Error('useCanvas must be used inside CanvasProvider');
  return context;
}

function classifyResponse(content:string,agent:Agent):CanvasNodeKind {
  const identity=`${agent.id} ${agent.name} ${agent.role}`.toLowerCase();
  if(/script|roteir/.test(identity))return 'script';
  if(/hook|abertura|opening/.test(identity))return 'hook';
  if(/content|conteúdo|idea|ideia|strategist/.test(identity))return 'contentIdea';
  if(/research|pesquisa|news|notícia|scout/.test(identity))return 'research';
  const text=content.toLowerCase();
  if(/\b(script|roteiro|narração|cena)\b/.test(text))return 'script';
  if(/\b(hook|gancho|abertura|opening)\b/.test(text))return 'hook';
  if(/\b(ideia|idea|carrossel|carousel|instagram|tiktok|youtube|conteúdo|content angle)\b/.test(text))return 'contentIdea';
  if(/\b(pesquisa|research|fonte|source|notícia|news|estudo|study)\b/.test(text))return 'research';
  return 'note';
}

function responseData(kind:CanvasNodeKind,message:ChatMessageItem,agent:Agent):CanvasNodeData {
  const content=message.content.trim();
  const base={label:kindLabels[kind],meta:`${agent.name} · now`,agentId:agent.id,sourceMessageId:message.id};
  if(kind==='research')return {...base,source:agent.name,title:makeTitle(content),summary:content,url:findUrl(content)};
  if(kind==='contentIdea')return {...base,platform:findPlatform(content),title:makeTitle(content),description:content};
  if(kind==='hook')return {...base,hook:content};
  if(kind==='script')return {...base,title:makeTitle(content),preview:content,wordCount:content.split(/\s+/).filter(Boolean).length};
  return {...base,text:content};
}

function newNodeData(kind:CanvasNodeKind):CanvasNodeData {
  const base={label:kindLabels[kind],meta:'Created from Command Palette'};
  if(kind==='image')return {...base,imageUrl:'/canvas-reference.svg',caption:'New image reference'};
  if(kind==='research')return {...base,source:'Source',title:'New research',summary:'Add a source-backed finding.'};
  if(kind==='contentIdea')return {...base,platform:'Content',title:'New content idea',description:'Develop this idea from the workspace context.'};
  if(kind==='hook')return {...base,hook:'Write a concise opening that earns the next second.'};
  if(kind==='script')return {...base,title:'New script',preview:'Develop the approved idea into a clear narrative.',wordCount:0};
  return {...base,text:'New note'};
}

function makeTitle(content:string):string {
  const sentence=content.split(/(?<=[.!?])\s/)[0] || content;
  return sentence.length>68?`${sentence.slice(0,65).trim()}…`:sentence;
}

function findUrl(content:string):string|undefined { return content.match(/https?:\/\/[^\s)]+/i)?.[0]; }
function findPlatform(content:string):string { return content.match(/\b(Instagram|TikTok|YouTube|LinkedIn|X|Threads)\b/i)?.[0] ?? 'Content'; }

function findFreePosition(nodes:CanvasFlowNode[],view:CanvasViewState):{x:number;y:number} {
  const {viewport,width,height}=view;
  const base={x:(width*.52-viewport.x)/viewport.zoom,y:(height*.46-viewport.y)/viewport.zoom};
  const stepX=285,stepY=215;
  const offsets=[[0,0],[stepX,0],[0,stepY],[-stepX,0],[0,-stepY],[stepX,stepY],[-stepX,stepY],[stepX,-stepY],[-stepX,-stepY],[stepX*2,0],[0,stepY*2]];
  const available=offsets.map(([x,y])=>({x:Math.max(20,base.x+x),y:Math.max(20,base.y+y)})).find((candidate)=>nodes.every((node)=>Math.abs(node.position.x-candidate.x)>250||Math.abs(node.position.y-candidate.y)>180));
  return available ?? {x:Math.max(20,base.x+nodes.length*24),y:Math.max(20,base.y+nodes.length*24)};
}

function getNodeContextLabel(node:CanvasFlowNode):string {
  const data=node.data;
  const label=data.title||data.caption||data.hook||data.text||data.summary||data.description||data.label;
  return label.length>34?`${label.slice(0,31).trim()}…`:label;
}
