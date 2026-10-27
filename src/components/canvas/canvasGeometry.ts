import type { CanvasFlowNode, CanvasNodeKind } from './canvasTypes';

export const canvasSizes:Record<CanvasNodeKind,{width:number;height:number;minWidth:number;minHeight:number}>={
  note:{width:280,height:240,minWidth:200,minHeight:160},
  research:{width:320,height:300,minWidth:240,minHeight:180},
  image:{width:340,height:320,minWidth:220,minHeight:180},
  contentIdea:{width:320,height:280,minWidth:240,minHeight:180},
  hook:{width:320,height:240,minWidth:220,minHeight:160},
  script:{width:340,height:320,minWidth:240,minHeight:180},
  terminal:{width:560,height:360,minWidth:340,minHeight:250},
  browser:{width:720,height:520,minWidth:360,minHeight:280},
  chat:{width:420,height:560,minWidth:320,minHeight:340},
};

export function canvasNodeSize(node:CanvasFlowNode) {
  const fallback=canvasSizes[node.type??'note'];
  return {width:node.width??node.measured?.width??fallback.width,height:node.height??node.measured?.height??fallback.height};
}

/** Look for space around the visible center, using the actual sizes of nearby blocks. */
export function findCanvasPosition(nodes:CanvasFlowNode[],view:{viewport:{x:number;y:number;zoom:number};width:number;height:number},kind:CanvasNodeKind) {
  const size=canvasSizes[kind],zoom=view.viewport.zoom;
  const center={x:(view.width/2-view.viewport.x)/zoom-size.width/2,y:(view.height/2-view.viewport.y)/zoom-size.height/2};
  const gap=32;
  const fits=(point:{x:number;y:number})=>nodes.every(node=>{
    const other=canvasNodeSize(node);
    return point.x+size.width+gap<=node.position.x||point.x>=node.position.x+other.width+gap||point.y+size.height+gap<=node.position.y||point.y>=node.position.y+other.height+gap;
  });
  const candidates=[center];
  for(let ring=1;ring<=12;ring++)for(let row=-ring;row<=ring;row++)for(let col=-ring;col<=ring;col++){
    if(Math.max(Math.abs(row),Math.abs(col))===ring)candidates.push({x:center.x+col*(size.width+gap),y:center.y+row*(size.height+gap)});
  }
  return candidates.find(fits)??{x:center.x+nodes.length*(size.width+gap),y:center.y};
}

export function arrangeCanvasNodes(nodes:CanvasFlowNode[],ids:Set<string>,mode:'left'|'top'|'grid'):CanvasFlowNode[] {
  const selected=nodes.filter(node=>ids.has(node.id)).sort((a,b)=>a.position.y-b.position.y||a.position.x-b.position.x);
  if(selected.length<2)return nodes;
  const left=Math.min(...selected.map(node=>node.position.x)),top=Math.min(...selected.map(node=>node.position.y));
  const positions=new Map<string,{x:number;y:number}>();
  const columns=Math.ceil(Math.sqrt(selected.length));
  let x=left,y=top,rowHeight=0;
  selected.forEach((node,index)=>{
    if(mode==='grid'&&index>0&&index%columns===0){x=left;y+=rowHeight+32;rowHeight=0}
    positions.set(node.id,mode==='left'?{x:left,y:node.position.y}:mode==='top'?{x:node.position.x,y:top}:{x,y});
    const size=canvasNodeSize(node);x+=size.width+32;rowHeight=Math.max(rowHeight,size.height);
  });
  return nodes.map(node=>positions.has(node.id)?{...node,position:positions.get(node.id)!}:node);
}
