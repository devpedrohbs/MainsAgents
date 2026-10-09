import type {Agent} from '../agents/model/Agent';

export type FlowBoxKind='content-agent'|'video-input'|'video-agent'|'publishing-agent';
export interface FlowBox {id:string;kind:FlowBoxKind;title:string;position:{x:number;y:number};agentId?:string;sessionId?:string}
export interface FlowLink {id:string;source:string;target:string;kind:'sequence'|'context'}
export interface ProductionFlow {id:string;workspaceId:string;name:string;contentId?:string;
 /** B07: last mode chosen at start for this flow (a starting point; every start still shows and sends it explicitly). Absent = Notion. */
 scriptMode?:'notion'|'local';nodes:FlowBox[];edges:FlowLink[];createdAt:string;updatedAt:string}
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

/**
 * How the semi-automatic production really reads a flow. The coordinator picks the FIRST saved box of each kind
 * (content, video editor, publishing — the publisher falls back to the content agent) and always runs the fixed order
 * script/Notion → recording → editing → package → scheduling. Connections never reorder, skip or trigger those stages;
 * outside it, the manual briefing send still follows `sequence` links (upstreamFlowBox). Pure: no AI, no storage, no runtime.
 */
export type FlowExecutionStatus='supported'|'missing'|'unsupported'|'ambiguous'|'custom-layout';
export type FlowExecutionIssueCode='missing-box'|'missing-agent'|'unsupported-provider'|'ambiguous-role'|'publisher-fallback'|'custom-layout'|'context-links';
export interface FlowExecutionIssue {code:FlowExecutionIssueCode;level:'error'|'warning'|'info';boxIds:string[];message:string;fix:string}
export interface FlowExecutionRole {kind:'content-agent'|'video-agent'|'publishing-agent';boxId?:string;agentId?:string;agentName?:string;fallback?:boolean}
export interface FlowExecutionSemantics {status:FlowExecutionStatus;roles:FlowExecutionRole[];issues:FlowExecutionIssue[];stages:string[]}
type SemanticsAgent=Pick<Agent,'id'|'name'|'workspaceId'>&{providerId?:string};
export const executionStageLabels=(pt=true)=>pt?['Roteiro (e card no Notion, se ativado)','Gravação (você envia o vídeo)','Edição do vídeo','Capas e legendas por rede','Agendamento autorizado']:['Script (and Notion card, if enabled)','Recording (you add the video)','Video editing','Covers and captions per network','Authorized scheduling'];
export function flowExecutionSemantics(flow:ProductionFlow,agents:readonly SemanticsAgent[],pt=true):FlowExecutionSemantics{
 const issues:FlowExecutionIssue[]=[],issue=(code:FlowExecutionIssueCode,level:FlowExecutionIssue['level'],boxIds:string[],message:string,fix:string)=>issues.push({code,level,boxIds,message,fix});
 const label=(kind:FlowBoxKind)=>boxTitle(kind,pt).toLowerCase();
 const roles:FlowExecutionRole[]=[];
 for(const kind of ['content-agent','video-agent','publishing-agent'] as const){
  const boxes=flow.nodes.filter(node=>node.kind===kind),used=boxes[0];
  if(!used){
   if(kind==='publishing-agent'){const content=roles[0];roles.push({kind,boxId:content?.boxId,agentId:content?.agentId,agentName:content?.agentName,fallback:true});issue('publisher-fallback','info',[],pt?'Sem caixa de publicação: o agente de conteúdo prepara capas e legendas.':'No publishing box: the content agent prepares covers and captions.',pt?'Adicione uma caixa “Preparar publicação” se quiser outro agente nessa etapa.':'Add a “Prepare publication” box to use another agent for that stage.');continue;}
   roles.push({kind});issue('missing-box','error',[],pt?`Falta uma caixa de ${label(kind)}; a produção não pode iniciar.`:`A ${label(kind)} box is missing; production cannot start.`,pt?`Use “Adicionar caixa” e escolha ${boxTitle(kind,pt)}.`:`Use “Add box” and choose ${boxTitle(kind,pt)}.`);continue;
  }
  const agent=agents.find(item=>item.id===used.agentId&&item.workspaceId===flow.workspaceId);
  roles.push({kind,boxId:used.id,agentId:agent?.id,agentName:agent?.name});
  if(boxes.length>1)issue('ambiguous-role','warning',boxes.map(box=>box.id),pt?`${boxes.length} caixas de ${label(kind)}: a produção usa somente “${used.title}” (a primeira na lista salva deste fluxo), independentemente das conexões.`:`${boxes.length} ${label(kind)} boxes: production only uses “${used.title}” (the first in this flow’s saved list), regardless of connections.`,pt?'Remova as caixas extras ou coloque o agente desejado na caixa usada.':'Remove the extra boxes or set the intended agent on the box that is used.');
  if(!agent)issue('missing-agent','error',[used.id],pt?`“${used.title}” não tem um agente deste workspace.`:`“${used.title}” has no agent from this workspace.`,pt?'Selecione a caixa e escolha um agente Codex.':'Select the box and choose a Codex agent.');
  else if((agent.providerId??'codex')!=='codex')issue('unsupported-provider','error',[used.id],pt?`“${agent.name}” usa ${agent.providerId==='claude'?'Claude':agent.providerId}; a produção semiautomática executa somente agentes Codex. O agente continua disponível no chat.`:`“${agent.name}” uses ${agent.providerId==='claude'?'Claude':agent.providerId}; semi-automatic production only runs Codex agents. The agent stays available in chat.`,pt?'Escolha um agente Codex nesta caixa para produzir; use o outro agente na conversa ou na comparação.':'Choose a Codex agent in this box to produce; use the other agent in chat or comparison.');
 }
 // The drawing is "standard" when its sequence links form exactly the fixed chain between the boxes in use.
 const chain=[flow.nodes.find(n=>n.kind==='content-agent'),flow.nodes.find(n=>n.kind==='video-input'),flow.nodes.find(n=>n.kind==='video-agent'),flow.nodes.find(n=>n.kind==='publishing-agent')].filter((n):n is FlowBox=>!!n);
 const expected=new Set(chain.slice(1).map((node,index)=>`${chain[index].id}>${node.id}`)),sequence=flow.edges.filter(edge=>edge.kind==='sequence');
 const extraBoxes=flow.nodes.length>chain.length,custom=extraBoxes||sequence.length!==expected.size||sequence.some(edge=>!expected.has(`${edge.source}>${edge.target}`));
 if(custom)issue('custom-layout','info',[],pt?'Este desenho difere da ordem padrão. Na produção semiautomática, as conexões não mudam a execução: ela segue sempre roteiro/Notion → gravação → edição → pacote → agendamento. O envio manual de briefing pela caixa de vídeos continua usando as conexões “Próxima etapa”.':'This drawing differs from the standard order. In semi-automatic production, connections do not change execution: it always follows script/Notion → recording → editing → package → scheduling. The manual briefing send from the videos box still follows “Next stage” connections.',pt?'Mantenha o desenho se ele ajuda a organizar; para a produção semiautomática, confira os agentes das caixas usadas.':'Keep the drawing if it helps you organize; for semi-automatic production, check the agents in the boxes that are used.');
 const context=flow.edges.filter(edge=>edge.kind==='context');
 if(context.length)issue('context-links','info',[...new Set(context.flatMap(edge=>[edge.source,edge.target]))],pt?'Conexões de contexto não enviam dados automaticamente; na produção semiautomática o contexto vem do roteiro, do card Notion e dos arquivos aprovados.':'Context connections do not send data automatically; in semi-automatic production, context comes from the script, the Notion card and approved files.',pt?'Para compartilhar algo a mais, use a conversa do agente.':'To share anything else, use the agent’s chat.');
 const status:FlowExecutionStatus=issues.some(i=>i.code==='missing-box'||i.code==='missing-agent')?'missing':issues.some(i=>i.code==='unsupported-provider')?'unsupported':issues.some(i=>i.code==='ambiguous-role')?'ambiguous':custom?'custom-layout':'supported';
 return {status,roles,issues,stages:executionStageLabels(pt)};
}
