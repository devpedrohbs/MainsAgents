/** A separate layout for the relationship view. Never modifies saved Canvas positions. */
export function arrangeRelations<T extends {id:string;position:{x:number;y:number}}>(nodes:readonly T[],edges:readonly {source:string;target:string}[]):T[] {
  const ids=new Set(nodes.map(node=>node.id));
  const incoming=new Map(nodes.map(node=>[node.id,0]));
  const outgoing=new Map(nodes.map(node=>[node.id,[] as string[]]));
  for(const edge of edges){if(!ids.has(edge.source)||!ids.has(edge.target))continue;incoming.set(edge.target,incoming.get(edge.target)!+1);outgoing.get(edge.source)!.push(edge.target)}
  const queue=nodes.filter(node=>incoming.get(node.id)===0).map(node=>node.id);
  const ranks=new Map(queue.map(id=>[id,0]));
  for(let index=0;index<queue.length;index++){const id=queue[index];for(const target of outgoing.get(id)!){ranks.set(target,Math.max(ranks.get(target)??0,ranks.get(id)!+1));incoming.set(target,incoming.get(target)!-1);if(incoming.get(target)===0)queue.push(target)}}
  const completed=new Set(queue),cycleRank=Math.max(0,...ranks.values())+1;
  for(const node of nodes)if(!completed.has(node.id))ranks.set(node.id,cycleRank);
  const groups=new Map<number,T[]>();for(const node of nodes){const rank=ranks.get(node.id)??0;groups.set(rank,[...(groups.get(rank)??[]),node])}
  const positions=new Map<string,{x:number;y:number}>();for(const [rank,items] of groups)items.forEach((node,index)=>positions.set(node.id,{x:(index-(items.length-1)/2)*320,y:rank*210}));
  return nodes.map(node=>({...node,position:positions.get(node.id)!}));
}
