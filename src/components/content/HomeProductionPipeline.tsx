import type {EditorialState} from '../../features/content/model';
import {pipelineColumnIds,pipelineColumnLabel,pipelineCount,projectHomePipeline,type PipelineRun} from '../../features/content/homePipeline';
import {useLanguage} from '../../app/LanguageProvider';

/** `runs` are the production runs of the active profile; the projection ignores other workspaces and contents. */
export function HomeProductionPipeline({state,workspaceId,runs=[],onOpenStudio}:{state:EditorialState;workspaceId:string;runs?:readonly PipelineRun[];onOpenStudio:()=>void}){
 const {locale}=useLanguage(),pt=locale==='pt-BR';
 const projection=projectHomePipeline({contents:state.contents,topics:state.topics,runs,workspaceId});
 const columns=pipelineColumnIds.map(id=>({id,label:pipelineColumnLabel(id,pt),items:projection[id]})),count=pipelineCount(projection);
 return <section className="precision-pipeline work-panel" aria-labelledby="production-pipeline-title"><div className="panel-heading"><div><h2 id="production-pipeline-title">{pt?'Pipeline de conteúdo':'Content pipeline'}</h2><p>{count} {pt?'conteúdos e pautas por etapa':'contents and ideas by stage'}</p></div><button className="text-link" onClick={onOpenStudio}>{pt?'Abrir Estúdio':'Open Studio'}</button></div>
 <div className="precision-pipeline-columns" style={{gridTemplateColumns:`repeat(${columns.length},minmax(0,1fr))`}}>{columns.map((column,index)=><div className="precision-pipeline-stage" data-column={column.id} key={column.id} style={{'--stage-tone':`${35+index*8}%`} as React.CSSProperties}><div className="precision-pipeline-marker"/><span>{column.label}</span><strong>{column.items.length}</strong>{column.items.slice(0,2).map(item=><button key={item.id} title={item.title} onClick={()=>{onOpenStudio();window.dispatchEvent(new CustomEvent('mainsagents:open-content',{detail:{contentId:item.contentId,topicId:item.topicId}}));}}>{item.title}</button>)}{!column.items.length&&<small>{pt?'Sem itens':'No items'}</small>}{column.items.length>2&&<button className="precision-pipeline-more" onClick={onOpenStudio}>+{column.items.length-2} {pt?'no Estúdio':'in Studio'}</button>}</div>)}</div>
 </section>;
}
