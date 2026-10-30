import type {Edge,Viewport} from '@xyflow/react';
import type {CanvasFlowNode} from './canvasTypes';

export interface CanvasViewState {viewport:Viewport;width:number;height:number;ready:boolean}
export interface CanvasBoard {id:string;name:string;nodes:CanvasFlowNode[];edges:Edge[];view:CanvasViewState}
export interface CanvasWorkspaceState {schemaVersion:2;activeBoardId:string;boards:CanvasBoard[]}
export interface CanvasBoardSummary {id:string;name:string;nodeCount:number}
export interface CanvasNodeEntry {workspaceId:string;boardId:string;boardName:string;node:CanvasFlowNode}
/** Explicit attachments keep their board identity. A legacy ambiguous id is never guessed. */
export function resolveCanvasReference(entries:readonly CanvasNodeEntry[],workspaceId:string,ref:{workspaceId:string;nodeId:string;boardId?:string}):CanvasNodeEntry|undefined {
 if(ref.workspaceId!==workspaceId)return undefined;
 const matches=entries.filter(item=>item.workspaceId===workspaceId&&item.node.id===ref.nodeId&&(!ref.boardId||item.boardId===ref.boardId));
 return matches.length===1?matches[0]:undefined;
}
export const initialCanvasView=():CanvasViewState=>({viewport:{x:0,y:0,zoom:1},width:900,height:640,ready:false});
export const newCanvasBoard=(id='main',name='Main canvas'):CanvasBoard=>({id,name,nodes:[],edges:[],view:initialCanvasView()});
const record=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const validView=(v:unknown):v is CanvasViewState=>record(v)&&record(v.viewport)&&[v.viewport.x,v.viewport.y,v.viewport.zoom,v.width,v.height].every(n=>typeof n==='number'&&Number.isFinite(n))&&Number(v.viewport.zoom)>0&&Number(v.width)>0&&Number(v.height)>0;
const validGraph=(v:unknown):v is Pick<CanvasBoard,'nodes'|'edges'>&Record<string,unknown>=>record(v)&&Array.isArray(v.nodes)&&Array.isArray(v.edges)&&v.nodes.every(n=>record(n)&&typeof n.id==='string'&&record(n.data))&&v.edges.every(e=>record(e)&&typeof e.id==='string'&&typeof e.source==='string'&&typeof e.target==='string');
const validBoard=(v:unknown):v is CanvasBoard=>record(v)&&typeof v.id==='string'&&v.id.length>0&&typeof v.name==='string'&&v.name.trim().length>0&&v.name.length<=80&&validGraph(v)&&validView(v.view);

/** Existing single-canvas snapshots remain readable; migration does not write until an explicit edit. */
export function readCanvasWorkspace(value:unknown):CanvasWorkspaceState {
 if(record(value)&&value.schemaVersion===2){
  if(!Array.isArray(value.boards)||!value.boards.length||!value.boards.every(validBoard)||new Set(value.boards.map(b=>b.id)).size!==value.boards.length)throw Error('Invalid canvas spaces. Saved data was preserved.');
  const boards=value.boards as CanvasBoard[];
  return {schemaVersion:2,boards,activeBoardId:boards.some(b=>b.id===value.activeBoardId)?String(value.activeBoardId):boards[0].id};
 }
 if(value===undefined||value===null)return {schemaVersion:2,activeBoardId:'main',boards:[newCanvasBoard()]};
 if(!validGraph(value))throw Error('Invalid saved canvas. Saved data was preserved.');
 return {schemaVersion:2,activeBoardId:'main',boards:[{id:'main',name:'Main canvas',nodes:value.nodes,edges:value.edges,view:validView((value as Record<string,unknown>).view)?(value as unknown as CanvasBoard).view:initialCanvasView()}]};
}

export function canvasBoard(state:CanvasWorkspaceState,boardId=state.activeBoardId):CanvasBoard {
 const board=state.boards.find(b=>b.id===boardId);if(!board)throw Error('Canvas space no longer exists.');return board;
}
export function updateCanvasBoard(state:CanvasWorkspaceState,boardId:string,update:(board:CanvasBoard)=>CanvasBoard):CanvasWorkspaceState {
 const board=canvasBoard(state,boardId),next=update(board);
 if(next===board)return state;
 return {...state,boards:state.boards.map(item=>item.id===boardId?next:item)};
}
function checkedName(state:CanvasWorkspaceState,name:string,ignoreId?:string){
 const trimmed=name.trim();if(!trimmed||trimmed.length>80)throw Error('Use a canvas space name between 1 and 80 characters.');
 if(state.boards.some(b=>b.id!==ignoreId&&b.name.toLocaleLowerCase()===trimmed.toLocaleLowerCase()))throw Error('A canvas space with this name already exists.');
 return trimmed;
}
export function createCanvasBoard(state:CanvasWorkspaceState,id:string,name:string):CanvasWorkspaceState {
 if(!id||state.boards.some(b=>b.id===id))throw Error('Canvas space identifier already exists.');
 return {...state,activeBoardId:id,boards:[...state.boards,newCanvasBoard(id,checkedName(state,name))]};
}
export function renameCanvasBoard(state:CanvasWorkspaceState,id:string,name:string):CanvasWorkspaceState {
 const next=checkedName(state,name,id);return updateCanvasBoard(state,id,board=>board.name===next?board:{...board,name:next});
}
export function removeCanvasBoard(state:CanvasWorkspaceState,id:string):CanvasWorkspaceState {
 const board=canvasBoard(state,id);
 if(state.boards.length===1)throw Error('Keep at least one canvas space.');
 if(board.nodes.some(n=>n.type==='terminal'&&n.data.terminalStatus==='running'))throw Error('Stop running terminals before deleting this canvas space.');
 const boards=state.boards.filter(b=>b.id!==id);return {...state,boards,activeBoardId:state.activeBoardId===id?boards[0].id:state.activeBoardId};
}
export const canvasScopeKey=(workspaceId:string,boardId:string,profileId='default')=>JSON.stringify([profileId,workspaceId,boardId]);
export function findCanvasNodeBoard(state:CanvasWorkspaceState,nodeId:string,boardId?:string):CanvasBoard|undefined {
 if(boardId)return state.boards.find(b=>b.id===boardId&&b.nodes.some(n=>n.id===nodeId));
 const matches=state.boards.filter(b=>b.nodes.some(n=>n.id===nodeId));
 // Refuse ambiguous imported ids rather than updating an unrelated board.
 return matches.length===1?matches[0]:undefined;
}

/** Backup merge keeps local choices and merges every board independently (legacy snapshots map to main). */
export function mergeCanvasWorkspaces(local:unknown,incoming:unknown):CanvasWorkspaceState {
 const a=readCanvasWorkspace(local),b=readCanvasWorkspace(incoming);
 const mergeRows=<T extends {id:string}>(left:T[],right:T[])=>[...new Map([...right,...left].map(row=>[row.id,row])).values()];
 const boards=[...a.boards];for(const remote of b.boards){const index=boards.findIndex(board=>board.id===remote.id);if(index<0)boards.push(remote);else{const current=boards[index];boards[index]={...remote,...current,nodes:mergeRows(current.nodes,remote.nodes),edges:mergeRows(current.edges,remote.edges)};}}
 return {...a,boards};
}
export function validCanvasWorkspace(value:unknown):boolean {try{readCanvasWorkspace(value);return true;}catch{return false;}}
