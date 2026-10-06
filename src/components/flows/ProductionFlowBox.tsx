import {useState,type DragEvent} from 'react';
import {Handle,Position,type Node,type NodeProps} from '@xyflow/react';
import {AgentAvatar} from '../agents/AgentAvatar';
import {Icon,type IconName} from '../common/Icon';
import type {FlowBox,FlowBoxKind} from '../../features/flows/flowModel';
import type {Agent} from '../../features/agents/model/Agent';
export const flowIcons:Record<FlowBoxKind,IconName>={'content-agent':'spark','video-input':'play','video-agent':'users','publishing-agent':'calendar'};
export const flowDescriptions=(pt:boolean):Record<FlowBoxKind,string>=>({
 'content-agent':pt?'Ideias, aprovação, roteiro e Notion na mesma conversa.':'Ideas, approval, script and Notion in one conversation.',
 'video-input':pt?'Sua gravação e os arquivos que seguem para edição.':'Your recording and the files for editing.',
 'video-agent':pt?'Edição, resultado e ajustes com seu especialista.':'Editing, output and revisions with your specialist.',
 'publishing-agent':pt?'Capas, legendas e planejamento por rede.':'Covers, captions and per-channel planning.',
});
export interface ProductionBoxData extends Record<string,unknown>{box:FlowBox;agent?:Agent;pt:boolean;detail:string;status:string;tone:'quiet'|'active'|'attention'|'done';busy:boolean;open:()=>void;configure:()=>void;pick:()=>void;drop:(files:File[])=>void}
export type ProductionNode=Node<ProductionBoxData,'production'>;
export function ProductionFlowBox({data,selected}:NodeProps<ProductionNode>){
 const [drag,setDrag]=useState(false),video=data.box.kind==='video-input';
 const drop=(event:DragEvent)=>{if(!event.dataTransfer.types.includes('Files'))return;event.preventDefault();event.stopPropagation();setDrag(false);data.drop(Array.from(event.dataTransfer.files))};
 return <article className={`production-box ${selected?'selected':''} ${drag?'drop-ready':''}`} data-flow-box={data.box.id} data-kind={data.box.kind}>
  <Handle type="target" position={Position.Left}/>
  <header>{data.agent?<AgentAvatar name={data.agent.name} image={data.agent.avatarImage}/>:<span className="production-box-icon"><Icon name={flowIcons[data.box.kind]}/></span>}<div><strong>{data.box.title}</strong><small>{data.agent?.name??(video?(data.pt?'Arquivo local':'Local file'):(data.pt?'Selecione um agente':'Choose an agent'))}</small></div><button className="icon-button nodrag nopan" aria-label={data.pt?'Configurar caixa':'Configure box'} onClick={data.configure}><Icon name="more"/></button></header>
  <p>{flowDescriptions(data.pt)[data.box.kind]}</p>
  {video?<div className="flow-video-drop nodrag nopan" onDragOver={event=>{if(event.dataTransfer.types.includes('Files')){event.preventDefault();setDrag(true)}}} onDragLeave={()=>setDrag(false)} onDrop={drop}><Icon name="play"/><span>{data.detail}</span><button disabled={data.busy} className="text-link" onClick={data.pick}>{data.busy?(data.pt?'Verificando…':'Verifying…'):(data.pt?'Adicionar vídeo':'Add video')}</button></div>:<div className="production-box-summary">{data.detail}</div>}
  <footer><span className="flow-box-status" data-tone={data.tone}><i/>{data.status}</span><button className="soft-button nodrag nopan" onClick={event=>{event.stopPropagation();data.open()}}>{video?(data.pt?'Ver arquivos':'View files'):data.agent?(data.pt?'Abrir conversa':'Open chat'):(data.pt?'Escolher agente':'Choose agent')}<Icon name="chevron"/></button></footer>
  <Handle type="source" position={Position.Right}/>
 </article>;
}
