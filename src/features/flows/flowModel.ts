import type {Agent} from '../agents/model/Agent';

export type FlowBoxKind='content-agent'|'video-input'|'video-agent'|'publishing-agent';
export interface FlowBox {id:string;kind:FlowBoxKind;title:string;position:{x:number;y:number};agentId?:string;sessionId?:string}
export interface FlowLink {id:string;source:string;target:string;kind:'sequence'|'context'}
export interface ProductionFlow {id:string;workspaceId:string;name:string;contentId?:string;nodes:FlowBox[];edges:FlowLink[];createdAt:string;updatedAt:string}
export interface ProductionFlows {schemaVersion:1;flows:ProductionFlow[];activeByWorkspace:Record<string,string>}
export const boxKinds:FlowBoxKind[]=['content-agent','video-input','video-agent','publishing-agent'];
export const boxTitle=(kind:FlowBoxKind,pt=true)=>({
  'content-agent':pt?'Agente de conteúdo':'Content agent',
  'video-input':pt?'Vídeos da gravação':'Recorded videos',
  'video-agent':pt?'Editor de vídeo':'Video editor',
  'publishing-agent':pt?'Preparar publicação':'Prepare publication',
})[kind];
const id=(prefix:string)=>`${prefix}-${crypto.randomUUID()}`;
export function createProductionFlow(workspaceId:string,name:string,agents:readonly Agent[],pt=true):ProductionFlow {
  const available=agents.filter(agent=>agent.workspaceId===workspaceId);
  const content=available.find(agent=>/conte[uú]do|content/.test(`${agent.name} ${agent.role}`.toLowerCase()));
  const editor=available.find(agent=>/v[ií]deo|video/.test(`${agent.name} ${agent.role}`.toLowerCase())&&agent.id!==content?.id);
  const at=new Date().toISOString(),nodes=boxKinds.map((kind,index)=>({id:id('box'),kind,title:boxTitle(kind,pt),position:{x:80+index*350,y:140},...(kind==='video-agent'&&editor?{agentId:editor.id}:kind!=='video-input'&&kind!=='video-agent'&&content?{agentId:content.id}:{})}));
  return {id:id('flow'),workspaceId,name:name.trim().slice(0,120)|| (pt?'Fluxo de criação de conteúdo':'Content creation flow'),nodes,edges:nodes.slice(1).map((node,index)=>({id:id('link'),source:nodes[index].id,target:node.id,kind:'sequence'})),createdAt:at,updatedAt:at};
}
export function initialProductionFlows(workspaceId:string,agents:readonly Agent[],pt=true):ProductionFlows {
  const flow=createProductionFlow(workspaceId,pt?'Fluxo de criação de conteúdo':'Content creation flow',agents,pt);
  return {schemaVersion:1,flows:[flow],activeByWorkspace:{[workspaceId]:flow.id}};
}
export function duplicateProductionFlow(flow:ProductionFlow,pt=true):ProductionFlow {
  const keys=new Map(flow.nodes.map(node=>[node.id,id('box')])),at=new Date().toISOString();
  const copy={...flow,id:id('flow'),name:`${flow.name.slice(0,100)} ${pt?'(cópia)':'(copy)'}`,nodes:flow.nodes.map(({sessionId,...node})=>({...node,id:keys.get(node.id)!,position:{...node.position}})),edges:flow.edges.map(edge=>({...edge,id:id('link'),source:keys.get(edge.source)!,target:keys.get(edge.target)!})),createdAt:at,updatedAt:at};
  delete copy.contentId;return copy;
}
export function canConnectFlow(flow:ProductionFlow,source:string,target:string,kind:FlowLink['kind']='sequence',omitId?:string):boolean {
  if(source===target||![source,target].every(key=>flow.nodes.some(node=>node.id===key)))return false;
  const edges=flow.edges.filter(edge=>edge.id!==omitId);
  if(edges.some(edge=>edge.source===source&&edge.target===target))return false;
  if(kind==='context')return true;
  const pending=[target],seen=new Set<string>();
  while(pending.length){const key=pending.pop()!;if(key===source)return false;if(seen.has(key))continue;seen.add(key);pending.push(...edges.filter(edge=>edge.source===key&&edge.kind==='sequence').map(edge=>edge.target));}
  return true;
}
export function linkFlow(flow:ProductionFlow,source:string,target:string,kind:FlowLink['kind']='sequence'):ProductionFlow {
  if(!canConnectFlow(flow,source,target,kind))throw Error('Invalid flow connection.');
  return {...flow,edges:[...flow.edges,{id:id('link'),source,target,kind}],updatedAt:new Date().toISOString()};
}
export function upstreamFlowBox(flow:ProductionFlow,target:string,kind:FlowBoxKind):FlowBox|undefined {
  const pending=[target],seen=new Set<string>();
  while(pending.length){const key=pending.shift()!;if(seen.has(key))continue;seen.add(key);if(key!==target){const box=flow.nodes.find(node=>node.id===key);if(box?.kind===kind)return box;}pending.push(...flow.edges.filter(edge=>edge.target===key&&edge.kind==='sequence').map(edge=>edge.source));}
}
export function bindFlowContent(flow:ProductionFlow,contentId?:string,sessions:readonly {id:string;agentId:string;contentId?:string}[]=[]):ProductionFlow {
  if(flow.contentId===contentId)return flow;
  return {...flow,contentId,nodes:flow.nodes.map(({sessionId,...node})=>({...node,...(contentId&&sessionId&&sessions.some(session=>session.id===sessionId&&session.agentId===node.agentId&&session.contentId===contentId)?{sessionId}:{})})),updatedAt:new Date().toISOString()};
}
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value:unknown,max=200)=>typeof value==='string'&&value.length>0&&value.length<=max;
export function validateProductionFlows(value:unknown):value is ProductionFlows {
  if(!object(value)||value.schemaVersion!==1||!Array.isArray(value.flows)||value.flows.length>1000||!object(value.activeByWorkspace))return false;
  const ids=new Set<string>();
  for(const item of value.flows){
    if(!object(item)||!text(item.id)||ids.has(item.id as string)||!text(item.workspaceId)||!text(item.name,120)||item.contentId!==undefined&&!text(item.contentId)||![item.createdAt,item.updatedAt].every(at=>typeof at==='string'&&Number.isFinite(Date.parse(at)))||!Array.isArray(item.nodes)||item.nodes.length>100||!Array.isArray(item.edges)||item.edges.length>500)return false;
    ids.add(item.id as string);const boxes=new Set<string>(),links=new Set<string>();
    for(const node of item.nodes){if(!object(node)||!text(node.id)||boxes.has(node.id as string)||!boxKinds.includes(node.kind as FlowBoxKind)||!text(node.title,120)||!object(node.position)||![node.position.x,node.position.y].every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=100000)||node.agentId!==undefined&&!text(node.agentId)||node.sessionId!==undefined&&!text(node.sessionId))return false;boxes.add(node.id as string);}
    const graph={...item,edges:[]} as unknown as ProductionFlow;
    for(const edge of item.edges){if(!object(edge)||!text(edge.id)||links.has(edge.id as string)||!text(edge.source)||!text(edge.target)||!['sequence','context'].includes(String(edge.kind))||!canConnectFlow(graph,String(edge.source),String(edge.target),edge.kind as FlowLink['kind']))return false;links.add(edge.id as string);graph.edges.push(edge as unknown as FlowLink);}
  }
  const flows=value.flows as ProductionFlow[];
  return Object.entries(value.activeByWorkspace).every(([workspace,key])=>text(workspace)&&typeof key==='string'&&flows.some(flow=>flow.id===key&&flow.workspaceId===workspace));
}
export function mergeProductionFlows(current:ProductionFlows,incoming:ProductionFlows):ProductionFlows {
  const saved=new Map(incoming.flows.map(flow=>[flow.id,flow]));for(const flow of current.flows)saved.set(flow.id,flow);
  const flows=[...saved.values()],activeByWorkspace={...incoming.activeByWorkspace,...current.activeByWorkspace};
  for(const [workspace,key] of Object.entries(activeByWorkspace))if(!flows.some(flow=>flow.id===key&&flow.workspaceId===workspace))delete activeByWorkspace[workspace];
  return {schemaVersion:1,flows,activeByWorkspace};
}
