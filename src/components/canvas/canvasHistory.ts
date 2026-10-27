import type { Edge } from '@xyflow/react';
import type { CanvasFlowNode } from './canvasTypes';
import type { CanvasGraph } from './canvasState';
import { canvasNodeSize } from './canvasGeometry.ts';

type Geometry = Pick<CanvasFlowNode,'id'|'position'|'width'|'height'|'style'>;
export type CanvasHistoryEntry =
  | {kind:'create';nodeIds:string[]}
  | {kind:'remove';nodes:CanvasFlowNode[];edges:Edge[]}
  | {kind:'geometry';nodes:Geometry[]}
  | {kind:'connect';edgeIds:string[]}
  | {kind:'group';nodes:Array<{id:string;groupId?:string;groupLabel?:string}>};

export function rememberCanvasGeometry(nodes:readonly CanvasFlowNode[]):CanvasHistoryEntry {
  return {kind:'geometry',nodes:nodes.map(node=>({id:node.id,position:{...node.position},...canvasNodeSize(node),style:{width:node.style?.width,height:node.style?.height}}))};
}

export function rememberCanvasRemoval(graph:CanvasGraph,nodeIds:readonly string[],edgeIds:readonly string[]=[]):CanvasHistoryEntry {
  const removed=new Set(nodeIds),removedEdges=new Set(edgeIds);
  return {kind:'remove',nodes:graph.nodes.filter(node=>removed.has(node.id)).map(node=>({...node,position:{...node.position},data:{...node.data},dragging:false,resizing:false})),edges:graph.edges.filter(edge=>removedEdges.has(edge.id)||removed.has(edge.source)||removed.has(edge.target))};
}

/** Apply only the inverse of this action; never rewind unrelated nodes, text, sessions or runtime output. */
export function undoCanvasEntry(graph:CanvasGraph,entry:CanvasHistoryEntry):CanvasGraph {
  if(entry.kind==='create'){
    const ids=new Set(entry.nodeIds);
    return {nodes:graph.nodes.filter(node=>!ids.has(node.id)),edges:graph.edges.filter(edge=>!ids.has(edge.source)&&!ids.has(edge.target))};
  }
  if(entry.kind==='connect')return {...graph,edges:graph.edges.filter(edge=>!entry.edgeIds.includes(edge.id))};
  if(entry.kind==='remove'){
    const ids=new Set(graph.nodes.map(node=>node.id));
    const nodes=[...graph.nodes,...entry.nodes.filter(node=>!ids.has(node.id))];
    const available=new Set(nodes.map(node=>node.id)),edges=new Set(graph.edges.map(edge=>edge.id));
    return {nodes,edges:[...graph.edges,...entry.edges.filter(edge=>!edges.has(edge.id)&&available.has(edge.source)&&available.has(edge.target))]};
  }
  if(entry.kind==='group'){
    const previous=new Map(entry.nodes.map(node=>[node.id,node]));
    return {...graph,nodes:graph.nodes.map(node=>{
      const before=previous.get(node.id);
      return before?{...node,data:{...node.data,groupId:before.groupId,groupLabel:before.groupLabel}}:node;
    })};
  }
  const previous=new Map(entry.nodes.map(node=>[node.id,node]));
  return {...graph,nodes:graph.nodes.map(node=>{
    const before=previous.get(node.id);
    return before?{...node,position:{...before.position},width:before.width,height:before.height,style:{...node.style,width:before.style?.width,height:before.style?.height},measured:{...node.measured,width:before.width,height:before.height},dragging:false,resizing:false}:node;
  })};
}

export function canvasShortcutIntent(event:{key:string;code?:string;ctrlKey?:boolean;metaKey?:boolean;altKey?:boolean;shiftKey?:boolean;repeat?:boolean},scope:{active:boolean;editing:boolean;modal:boolean;button?:boolean}):'undo'|'pan'|'hand'|'select'|'note'|null {
  if(!scope.active||scope.editing||scope.modal)return null;
  if(event.code==='Space'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!scope.button)return 'pan';
  if(event.repeat)return null;
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z')return !event.shiftKey&&!event.altKey?'undo':null;
  if(event.ctrlKey||event.metaKey||event.altKey)return null;
  return ({h:'hand',v:'select',n:'note'} as const)[event.key.toLowerCase() as 'h'|'v'|'n']??null;
}
