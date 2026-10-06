import type {EditorialState} from '../../features/content/model';
import {useLanguage} from '../../app/LanguageProvider';

export function HomeProductionPipeline({state,workspaceId,onOpenStudio}:{state:EditorialState;workspaceId:string;onOpenStudio:()=>void}){
 const {locale}=useLanguage(),pt=locale==='pt-BR';
 const columns=(pt?['Pauta','Pesquisa','Roteiro','Gravação','Edição','Publicação']:['Ideas','Research','Script','Recording','Editing','Publishing']).map(label=>({label,items:[] as Array<{id:string;title:string;topicId?:string;contentId?:string}>}));
 const contents=state.contents.filter(c=>c.workspaceId===workspaceId&&c.productionStage!=='archived'),contentTopics=new Set(contents.map(c=>c.topicId));
 for(const topic of state.topics.filter(t=>t.workspaceId===workspaceId&&t.status!=='rejected'&&!contentTopics.has(t.id)))columns[topic.status==='researching'?1:0].items.push({id:topic.id,title:topic.title,topicId:topic.id});
 for(const content of contents){const stage=content.productionStage,index=stage==='ready'?5:stage==='editing'||stage==='video-review'?4:stage==='recording'||stage==='ready-to-record'?3:2;columns[index].items.push({id:content.id,title:content.title,topicId:content.topicId,contentId:content.id});}
 const count=columns.reduce((total,column)=>total+column.items.length,0);
 return <section className="precision-pipeline work-panel" aria-labelledby="production-pipeline-title"><div className="panel-heading"><div><h2 id="production-pipeline-title">{pt?'Pipeline de conteúdo':'Content pipeline'}</h2><p>{count} {pt?'conteúdos e pautas por etapa':'contents and ideas by stage'}</p></div><button className="text-link" onClick={onOpenStudio}>{pt?'Abrir Estúdio':'Open Studio'}</button></div>
 <div className="precision-pipeline-columns">{columns.map((column,index)=><div className="precision-pipeline-stage" key={column.label} style={{'--stage-tone':`${35+index*13}%`} as React.CSSProperties}><div className="precision-pipeline-marker"/><span>{column.label}</span><strong>{column.items.length}</strong>{column.items.slice(0,2).map(item=><button key={item.id} title={item.title} onClick={()=>{onOpenStudio();window.dispatchEvent(new CustomEvent('mainsagents:open-content',{detail:{contentId:item.contentId,topicId:item.topicId}}));}}>{item.title}</button>)}{!column.items.length&&<small>{pt?'Sem itens':'No items'}</small>}{column.items.length>2&&<button className="precision-pipeline-more" onClick={onOpenStudio}>+{column.items.length-2} {pt?'no Estúdio':'in Studio'}</button>}</div>)}</div>
 </section>;
}
