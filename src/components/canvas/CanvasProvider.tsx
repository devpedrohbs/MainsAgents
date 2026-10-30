import { createContext, useCallback, useContext, useMemo, useRef, useState, type Dispatch, type PropsWithChildren, type SetStateAction } from 'react';
import { applyEdgeChanges, applyNodeChanges, type Edge, type EdgeChange, type NodeChange, type Viewport } from '@xyflow/react';
import { useWorkspaces } from '../../app/WorkspaceProvider';
import type { Agent, AgentId } from '../../features/agents/model/Agent';
import type { ChatContextReference, ChatMessageItem } from '../../features/chat/model/Chat';
import type { CanvasFlowNode, CanvasNodeData, CanvasNodeKind } from './canvasTypes';
import { readPersistentValue, usePersistentState } from '../../data/localPersistence';
import { useAgents } from '../../features/agents/AgentsProvider';
import { attachCanvasContext, pendingCanvasNodeIds, pruneCanvasContext, reconcileCanvasGraph, type CanvasGraph, type CanvasPendingContexts } from './canvasState';
import { canvasSizes, findCanvasPosition } from './canvasGeometry';
import { browserHome } from './browserNavigation';
import { chatImageSource } from '../../features/chat/chatImages';
import { addCollaborationChats, type CollaborationCanvasInput } from './collaborationCanvas';
import {canvasBoard,canvasScopeKey,createCanvasBoard,findCanvasNodeBoard,readCanvasWorkspace,removeCanvasBoard,renameCanvasBoard,updateCanvasBoard,type CanvasBoardSummary,type CanvasViewState} from './canvasBoards';
import {storageProfile} from '../../data/IndexedDbStateStore';

interface AddResponseResult { kind:CanvasNodeKind; label:string; nodeId:string }
interface CanvasContextValue {
  boards:readonly CanvasBoardSummary[];
  activeBoardId:string;
  activateBoard:(boardId:string)=>void;
  createBoard:(name:string)=>string;
  renameBoard:(boardId:string,name:string)=>void;
  removeBoard:(boardId:string)=>void;
  nodes:CanvasFlowNode[];
  allNodes:readonly {workspaceId:string;boardId:string;boardName:string;node:CanvasFlowNode}[];
  edges:Edge[];
  setNodes:Dispatch<SetStateAction<CanvasFlowNode[]>>;
  setEdges:Dispatch<SetStateAction<Edge[]>>;
  updateGraph:(update:(graph:CanvasGraph)=>CanvasGraph)=>void;
  onNodesChange:(changes:NodeChange<CanvasFlowNode>[])=>void;
  onEdgesChange:(changes:EdgeChange[])=>void;
  view:CanvasViewState;
  updateView:(viewport:Viewport,width:number,height:number)=>void;
  addNode:(kind:CanvasNodeKind,position?:{x:number;y:number})=>string;
  updateNodeData:(workspaceId:string,nodeId:string,change:Partial<CanvasNodeData>|((data:CanvasNodeData)=>CanvasNodeData))=>void;
  addAgentResponse:(message:ChatMessageItem,agent:Agent,link?:{contentId?:string;topicId?:string})=>AddResponseResult;
  hasMessageNode:(messageId:string)=>boolean;
  attachNodesToAgent:(agentId:AgentId,nodeIds:string[])=>void;
  getAgentContext:(agentId:AgentId)=>ChatContextReference[];
  removeNodeFromAgentContext:(agentId:AgentId,nodeId:string)=>void;
  clearAgentContext:(agentId:AgentId)=>void;
  groupNodes:(nodeIds:string[])=>string;
  selectNode:(workspaceId:string,nodeId:string,boardId?:string)=>void;
  addCollaboration:(input:CollaborationCanvasInput)=>void;
  focusRequest:(CollaborationCanvasInput & {requestId:string})|null;
  clearFocusRequest:(requestId:string)=>void;
  registerVisibleChats:(sessionIds:string[])=>void;
  hasVisibleChats:(sourceSessionId:string,targetSessionId:string)=>boolean;
}

const kindLabels:Record<CanvasNodeKind,string>={note:'Note',research:'Research',image:'Image',contentIdea:'Content idea',hook:'Hook',script:'Script',terminal:'Terminal',browser:'Browser',chat:'Chat'};
const CanvasContext=createContext<CanvasContextValue|null>(null);

export function CanvasProvider({children}:PropsWithChildren) {
  const {currentWorkspaceId}=useWorkspaces();
  const {getAgentById}=useAgents();
  const profileId=storageProfile();
  const [workspaceCanvases,setWorkspaceCanvases]=usePersistentState<Record<string,unknown>>('canvas-workspaces',{});
  const [contextNodeIds,setContextNodeIds]=useState<CanvasPendingContexts>({});
  const workspaceState=readCanvasWorkspace(workspaceCanvases[currentWorkspaceId]);
  const activeBoardId=workspaceState.activeBoardId,scopeKey=canvasScopeKey(currentWorkspaceId,activeBoardId,profileId);
  const canvasState=canvasBoard(workspaceState);
  const {nodes,edges,view}=canvasState;
  const boards=workspaceState.boards.map(({id,name,nodes})=>({id,name,nodeCount:nodes.length}));
  const allNodes=useMemo(()=>Object.entries(workspaceCanvases).flatMap(([workspaceId,raw])=>readCanvasWorkspace(raw).boards.flatMap(board=>board.nodes.map(node=>({workspaceId,boardId:board.id,boardName:board.name,node})))),[workspaceCanvases]);
  const activateBoard=useCallback((boardId:string)=>setWorkspaceCanvases(current=>{if(storageProfile()!==profileId)return current;const state=readCanvasWorkspace(current[currentWorkspaceId]);canvasBoard(state,boardId);return state.activeBoardId===boardId?current:{...current,[currentWorkspaceId]:{...state,activeBoardId:boardId}};}),[currentWorkspaceId,profileId,setWorkspaceCanvases]);
  const createBoard=useCallback((name:string)=>{if(storageProfile()!==profileId)throw Error('The active profile changed. Reopen the Canvas.');const id=`canvas-${crypto.randomUUID()}`;setWorkspaceCanvases(current=>({...current,[currentWorkspaceId]:createCanvasBoard(readCanvasWorkspace(current[currentWorkspaceId]),id,name)}));return id;},[currentWorkspaceId,profileId,setWorkspaceCanvases]);
  const renameBoard=useCallback((id:string,name:string)=>setWorkspaceCanvases(current=>storageProfile()!==profileId?current:{...current,[currentWorkspaceId]:renameCanvasBoard(readCanvasWorkspace(current[currentWorkspaceId]),id,name)}),[currentWorkspaceId,profileId,setWorkspaceCanvases]);
  const removeBoard=useCallback((id:string)=>{
    if(storageProfile()!==profileId)return;
    setWorkspaceCanvases(current=>({...current,[currentWorkspaceId]:removeCanvasBoard(readCanvasWorkspace(current[currentWorkspaceId]),id)}));
    const key=canvasScopeKey(currentWorkspaceId,id,profileId);delete visibleChats.current[key];setContextNodeIds(current=>{const next={...current};delete next[key];return next;});
  },[currentWorkspaceId,profileId,setWorkspaceCanvases]);
  const updateGraph=useCallback((update:(graph:CanvasGraph)=>CanvasGraph)=>{
    if(storageProfile()!==profileId)return;
    // PersistentState is synchronous: read its live value rather than a render snapshot.
    const current=readPersistentValue<Record<string,unknown>>('canvas-workspaces',{});
    const workspace=readCanvasWorkspace(current[currentWorkspaceId]);
    // Late events from an unmounted board never mutate the newly selected board.
    const state=workspace.boards.find(board=>board.id===activeBoardId);if(!state)return;
    const next=reconcileCanvasGraph(update({nodes:state.nodes,edges:state.edges}));
    if(next.nodes===state.nodes&&next.edges===state.edges)return;
    setWorkspaceCanvases({...current,[currentWorkspaceId]:updateCanvasBoard(workspace,activeBoardId,board=>({...board,...next}))});
    if(next.nodes!==state.nodes)setContextNodeIds(pending=>pruneCanvasContext(pending,scopeKey,next.nodes,currentWorkspaceId));
  },[currentWorkspaceId,activeBoardId,scopeKey,profileId,setWorkspaceCanvases]);
  const setNodes=useCallback<Dispatch<SetStateAction<CanvasFlowNode[]>>>(update=>updateGraph(current=>({...current,nodes:typeof update==='function'?update(current.nodes):update})),[updateGraph]);
  const setEdges=useCallback<Dispatch<SetStateAction<Edge[]>>>(update=>updateGraph(current=>({...current,edges:typeof update==='function'?update(current.edges):update})),[updateGraph]);
  const [focusRequest,setFocusRequest]=useState<CanvasContextValue['focusRequest']>(null);
  const visibleChats=useRef<Record<string,string[]>>({});
  const registerVisibleChats=useCallback((sessionIds:string[])=>{visibleChats.current[scopeKey]=sessionIds},[scopeKey]);
  const hasVisibleChats=useCallback((sourceSessionId:string,targetSessionId:string)=>{const visible=visibleChats.current[scopeKey]??[];return visible.includes(sourceSessionId)&&visible.includes(targetSessionId)},[scopeKey]);
  const clearFocusRequest=useCallback((requestId:string)=>setFocusRequest(current=>current?.requestId===requestId?null:current),[]);
  const addCollaboration=useCallback((input:CollaborationCanvasInput)=>{
    if(storageProfile()!==profileId)return;
    let boardId:string|undefined;
    setWorkspaceCanvases(current=>{
      const workspace=readCanvasWorkspace(current[input.workspaceId]),state=canvasBoard(workspace);
      boardId=state.id;
      const next=addCollaborationChats(state.nodes,state.edges,state.view,{...input,boardId:state.id});
      return {...current,[input.workspaceId]:updateCanvasBoard(workspace,state.id,board=>({...board,nodes:next.nodes,edges:next.edges}))};
    });
    setFocusRequest({...input,boardId,requestId:crypto.randomUUID()});
  },[profileId,setWorkspaceCanvases]);

  const onNodesChange=useCallback((changes:NodeChange<CanvasFlowNode>[])=>setNodes((current)=>applyNodeChanges(changes,current)),[setNodes]);
  const onEdgesChange=useCallback((changes:EdgeChange[])=>setEdges((current)=>applyEdgeChanges(changes,current)),[setEdges]);
  const updateView=useCallback((viewport:Viewport,width:number,height:number)=>setWorkspaceCanvases(current=>{if(storageProfile()!==profileId||![viewport.x,viewport.y,viewport.zoom,width,height].every(Number.isFinite)||viewport.zoom<=0||width<=0||height<=0)return current;const workspace=readCanvasWorkspace(current[currentWorkspaceId]);if(!workspace.boards.some(board=>board.id===activeBoardId))return current;return {...current,[currentWorkspaceId]:updateCanvasBoard(workspace,activeBoardId,board=>({...board,view:{viewport,width,height,ready:true}}))};}),[currentWorkspaceId,activeBoardId,profileId,setWorkspaceCanvases]);
  const addNode=useCallback((kind:CanvasNodeKind,position?:{x:number;y:number})=>{const nodeId=`node-${kind}-${crypto.randomUUID()}`;setNodes((current)=>[...current.map((node)=>({...node,selected:false})),{id:nodeId,type:kind,position:position??findCanvasPosition(current,view,kind),width:canvasSizes[kind].width,height:canvasSizes[kind].height,selected:true,data:newNodeData(kind,currentWorkspaceId)}]);return nodeId},[currentWorkspaceId,setNodes,view]);
  const updateNodeData=useCallback((workspaceId:string,nodeId:string,change:Partial<CanvasNodeData>|((data:CanvasNodeData)=>CanvasNodeData))=>setWorkspaceCanvases(current=>{if(storageProfile()!==profileId||!current[workspaceId])return current;const workspace=readCanvasWorkspace(current[workspaceId]),state=findCanvasNodeBoard(workspace,nodeId);if(!state)return current;return {...current,[workspaceId]:updateCanvasBoard(workspace,state.id,board=>({...board,nodes:board.nodes.map(node=>node.id===nodeId?{...node,data:typeof change==='function'?change(node.data):{...node.data,...change}}:node)}))};}),[profileId,setWorkspaceCanvases]);

  const addAgentResponse=useCallback((message:ChatMessageItem,agent:Agent,link?:{contentId?:string;topicId?:string}):AddResponseResult=>{
    if(storageProfile()!==profileId)throw Error('The active profile changed. Reopen this conversation.');
    const kind=message.images?.some(image=>chatImageSource(image))?'image':classifyResponse(message.content,agent);
    const owner=agent.workspaceId;
    const current=readPersistentValue<Record<string,unknown>>('canvas-workspaces',{}),workspace=readCanvasWorkspace(current[owner]);
    const state=canvasBoard(workspace);
    const existing=workspace.boards.flatMap(board=>board.nodes).find(node=>node.data.sourceMessageId===message.id);
    if(existing)return {kind:existing.type??kind,label:kindLabels[existing.type??kind],nodeId:existing.id};
    const nodeId=`chat-${message.id}-${crypto.randomUUID()}`;
    const node:CanvasFlowNode={id:nodeId,type:kind,position:findCanvasPosition(state.nodes,state.view,kind),width:canvasSizes[kind].width,height:canvasSizes[kind].height,selected:true,data:{...responseData(kind,message,agent),...link,workspaceId:owner}};
    setWorkspaceCanvases({...current,[owner]:updateCanvasBoard(workspace,state.id,board=>({...board,nodes:[...board.nodes.map(item=>({...item,selected:false})),node]}))});
    return {kind,label:kindLabels[kind],nodeId};
  },[profileId,setWorkspaceCanvases]);

  const attachNodesToAgent=useCallback((agentId:AgentId,nodeIds:string[])=>{
    if(storageProfile()!==profileId)return;
    const current=readPersistentValue<Record<string,unknown>>('canvas-workspaces',{});
    const agent=readPersistentValue<Agent[]>('agents',[]).find(item=>item.id===agentId);
    const workspace=readCanvasWorkspace(current[currentWorkspaceId]),board=workspace.boards.find(board=>board.id===activeBoardId);if(!board)return;
    setContextNodeIds(pending=>attachCanvasContext(pending,scopeKey,agent,nodeIds,board.nodes,currentWorkspaceId));
  },[currentWorkspaceId,activeBoardId,scopeKey,profileId]);
  const removeNodeFromAgentContext=useCallback((agentId:AgentId,nodeId:string)=>setContextNodeIds(current=>{
    const entries=current[scopeKey];if(!entries?.[agentId])return current;
    return {...current,[scopeKey]:{...entries,[agentId]:entries[agentId].filter(id=>id!==nodeId)}};
  }),[scopeKey]);
  const clearAgentContext=useCallback((agentId:AgentId)=>setContextNodeIds(current=>{
    const entries=current[scopeKey];if(!entries?.[agentId])return current;
    const next={...entries};delete next[agentId];return {...current,[scopeKey]:next};
  }),[scopeKey]);
  const getAgentContext=useCallback((agentId:AgentId):ChatContextReference[]=>storageProfile()!==profileId?[]:pendingCanvasNodeIds(contextNodeIds,scopeKey,getAgentById(agentId),nodes,currentWorkspaceId).flatMap(nodeId=>{
    const node=nodes.find(item=>item.id===nodeId)!;return [{nodeId,boardId:activeBoardId,label:getNodeContextLabel(node),kind:node.type,content:getNodeContextContent(node)}];
  }),[contextNodeIds,currentWorkspaceId,activeBoardId,profileId,scopeKey,getAgentById,nodes]);
  const groupNodes=useCallback((nodeIds:string[])=>{const groupId=`group-${Date.now().toString(36)}`;setNodes((current)=>{const groupNumber=new Set(current.map((node)=>node.data.groupId).filter(Boolean)).size+1;return current.map((node)=>nodeIds.includes(node.id)?{...node,data:{...node.data,groupId,groupLabel:`Group ${String(groupNumber).padStart(2,'0')}`}}:node)});return groupId},[setNodes]);
  const selectNode=useCallback((workspaceId:string,nodeId:string,boardId?:string)=>setWorkspaceCanvases(current=>{if(storageProfile()!==profileId||!current[workspaceId])return current;const workspace=readCanvasWorkspace(current[workspaceId]),state=findCanvasNodeBoard(workspace,nodeId,boardId);if(!state)return current;const next=updateCanvasBoard(workspace,state.id,board=>({...board,nodes:board.nodes.map(node=>({...node,selected:node.id===nodeId}))}));return {...current,[workspaceId]:{...next,activeBoardId:state.id}};}),[profileId,setWorkspaceCanvases]);

  const value=useMemo<CanvasContextValue>(()=>({boards,activeBoardId,activateBoard,createBoard,renameBoard,removeBoard,nodes,allNodes,edges,setNodes,setEdges,updateGraph,onNodesChange,onEdgesChange,view,updateView,addNode,updateNodeData,addAgentResponse,hasMessageNode:(messageId)=>allNodes.some(item=>item.workspaceId===currentWorkspaceId&&item.node.data.sourceMessageId===messageId),attachNodesToAgent,getAgentContext,removeNodeFromAgentContext,clearAgentContext,groupNodes,selectNode,addCollaboration,focusRequest,clearFocusRequest,registerVisibleChats,hasVisibleChats}),[boards,activeBoardId,activateBoard,createBoard,renameBoard,removeBoard,currentWorkspaceId,addAgentResponse,addNode,allNodes,attachNodesToAgent,clearAgentContext,edges,getAgentContext,groupNodes,nodes,onEdgesChange,onNodesChange,removeNodeFromAgentContext,selectNode,updateGraph,updateNodeData,updateView,view,addCollaboration,focusRequest,clearFocusRequest,registerVisibleChats,hasVisibleChats]);
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
  if(kind==='image')return {...base,imageUrl:message.images?.map(chatImageSource).find(Boolean),caption:content};
  if(kind==='research')return {...base,source:agent.name,title:makeTitle(content),summary:content,url:findUrl(content)};
  if(kind==='contentIdea')return {...base,platform:findPlatform(content),title:makeTitle(content),description:content};
  if(kind==='hook')return {...base,hook:content};
  if(kind==='script')return {...base,title:makeTitle(content),preview:content,wordCount:content.split(/\s+/).filter(Boolean).length};
  return {...base,text:content};
}

function newNodeData(kind:CanvasNodeKind,workspaceId:string):CanvasNodeData {
  const base={label:kindLabels[kind],meta:'Created from Canvas',workspaceId};
  if(kind==='terminal')return {...base,command:'',terminalOutput:'',terminalStatus:'idle'};
  if(kind==='browser')return {...base,browserUrl:browserHome};
  if(kind==='chat')return {...base,meta:'Connected to Canvas'};
  if(kind==='image')return {...base,imageUrl:'/canvas-reference.svg',caption:'New image reference'};
  if(kind==='research')return {...base,source:'Source',title:'New research',summary:'Add a source-backed finding.'};
  if(kind==='contentIdea')return {...base,platform:'Content',title:'New content idea',description:'Develop this idea from the workspace context.'};
  if(kind==='hook')return {...base,hook:'Write a concise opening that earns the next second.'};
  if(kind==='script')return {...base,title:'New script',preview:'Develop the approved idea into a clear narrative.',wordCount:0};
  return {...base,text:''};
}

function makeTitle(content:string):string {
  const sentence=content.split(/(?<=[.!?])\s/)[0] || content;
  return sentence.length>68?`${sentence.slice(0,65).trim()}…`:sentence;
}

function findUrl(content:string):string|undefined { return content.match(/https?:\/\/[^\s)]+/i)?.[0]; }
function findPlatform(content:string):string { return content.match(/\b(Instagram|TikTok|YouTube|LinkedIn|X|Threads)\b/i)?.[0] ?? 'Content'; }

export function getNodeContextLabel(node:CanvasFlowNode):string {
  const data=node.data;
  const label=data.title||data.caption||data.hook||data.text||data.summary||data.description||data.label;
  return label.length>34?`${label.slice(0,31).trim()}…`:label;
}

export function getNodeContextContent(node:CanvasFlowNode):string {
  const data=node.data;
  const fields=[data.title,data.text,data.summary,data.description,data.hook,data.preview,data.caption,data.url,data.browserUrl,data.command,data.terminalOutput].filter((value):value is string=>typeof value==='string'&&Boolean(value.trim()));
  return fields.join('\n\n').slice(0,12_000);
}
