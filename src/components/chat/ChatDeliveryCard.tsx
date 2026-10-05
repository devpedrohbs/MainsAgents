import {useEffect,useState} from 'react';
import type {Agent} from '../../features/agents/model/Agent';
import type {AgentSession,ChatMessageItem} from '../../features/chat/model/Chat';
import type {ApprovedScript,EditorialArtifact,ScriptOptions} from '../../features/content/model';
import {useContentWorkflow} from '../../features/content/ContentWorkflowProvider';
import {useLanguage} from '../../app/LanguageProvider';
import {decodeChatDelivery,type ChatDelivery} from '../../../chat-delivery-protocol.mjs';
import {FlowDialog} from '../common/FlowDialog';
import {SelectMenu} from '../common/SelectMenu';
import {EditorialWorkPanel} from '../content/EditorialWorkPanel';
import '../../styles/chat-deliveries.css';
import {FileDeliveryCard} from './FileDeliveryCard';

export function ChatDeliveryCard({agent,session,message}:{agent:Agent;session:AgentSession;message:ChatMessageItem}) {
  const {locale}=useLanguage(),pt=locale==='pt-BR';
  const {state,captureChatDelivery,workJobs}=useContentWorkflow();
  const [saving,setSaving]=useState(false),[error,setError]=useState(''),[chooseContent,setChooseContent]=useState(false);
  const [contentId,setContentId]=useState(session.contentId??'');
  const [review,setReview]=useState<EditorialArtifact|null>(null);
  const [workContentId,setWorkContentId]=useState<string|null>(null);
  const delivery=decodeChatDelivery(message.content);
  if(!delivery||message.deliveryState!=='completed')return <p className="message-content">{message.content}</p>;
  if(delivery.kind==='file-delivery')return <FileDeliveryCard agent={agent} session={session} message={message} delivery={delivery.data}/>;
  const artifacts=state.artifacts.filter(item=>item.type===delivery.kind&&item.source?.sessionId===session.id&&item.source?.messageId===message.id);
  const candidates=state.contents.filter(item=>item.workspaceId===agent.workspaceId&&state.topics.some(topic=>topic.id===item.topicId&&topic.status==='approved'));
  const workContent=state.contents.find(item=>item.id===workContentId);
  const save=async(target?:string)=>{
    setSaving(true);setError('');
    try {await captureChatDelivery(session.id,message.id,message.content,target);setChooseContent(false);}
    catch(failure){setError(failure instanceof Error?failure.message:String(failure));}
    finally {setSaving(false);}
  };
  const open=(artifact:EditorialArtifact)=>window.dispatchEvent(new CustomEvent('mainsagents:open-content',{detail:artifact.contentId?{contentId:artifact.contentId}:{topicId:artifact.topicId}}));
  return <section className="chat-delivery" aria-label={pt?'Entrega do agente':'Agent delivery'}>
    <header><b>{delivery.kind==='research'?(pt?'Pesquisa com fontes':'Sourced research'):(pt?'Opções de roteiro':'Script options')}</b><span>{artifacts.length?(pt?'Salva no Estúdio':'Saved in Studio'):(pt?'Pronta para revisar':'Ready to review')}</span></header>
    <DeliveryPreview delivery={delivery}/>
    {!artifacts.length?<div className="delivery-actions"><button type="button" className="soft-button" disabled={saving||!window.mainsAgentsDesktop?.state} onClick={()=>delivery.kind==='research'?void save():setChooseContent(true)}>{saving?(pt?'Salvando…':'Saving…'):(pt?'Salvar entrega':'Save delivery')}</button>{!window.mainsAgentsDesktop?.state&&<small>{pt?'Abra o aplicativo desktop para salvar esta entrega.':'Open the desktop app to save this delivery.'}</small>}</div>:artifacts.map(artifact=>{
      const content=state.contents.find(item=>item.id===artifact.contentId);
      const current=artifact.type==='research'?state.topics.find(item=>item.id===artifact.topicId)?.researchArtifactId===artifact.id:content?.scriptOptionsArtifactId===artifact.id;
      const approved=current&&Boolean(content?.approvedScriptArtifactId);
      const decision=state.approvals.find(item=>item.artifactId===artifact.id&&item.action==='script-review');
      const label=approved?(pt?'Aprovada':'Approved'):decision?.decision==='revision-requested'?(pt?'Ajuste solicitado':'Changes requested'):content?.status==='script-rejected'?(pt?'Rejeitada':'Rejected'):(pt?'Aguardando revisão':'Awaiting review');
      return <div className="delivery-record" key={artifact.id}><span>{artifact.type==='research'?(artifact.data as {title:string}).title:content?.title}<small>{pt?'Versão':'Version'} {artifact.version} · {current?label:(pt?'Versão anterior':'Previous version')}</small></span><div className="delivery-actions">{artifact.type==='script-options'&&current&&<button type="button" className="soft-button" onClick={()=>setReview(structuredClone(artifact))}>{approved?(pt?'Ver aprovação':'Review approval'):(pt?'Revisar e aprovar':'Review and approve')}</button>}{content&&(approved||workJobs.some(job=>job.contentId===content.id))&&<button type="button" className="soft-button" onClick={()=>setWorkContentId(content.id)}>{pt?'Trabalho persistente':'Persistent work'}</button>}<button type="button" className="text-link" onClick={()=>open(artifact)}>{pt?'Abrir no Estúdio':'Open in Studio'}</button></div>{current&&decision&&!approved&&<p className="editorial-hint">{decision.notes}</p>}</div>;
    })}
    {error&&<p role="alert" className="delivery-error">{error}</p>}
    <details className="delivery-original"><summary>{pt?'Ver resposta original':'View original response'}</summary><p className="message-content">{message.content}</p></details>
    {chooseContent&&<FlowDialog title={pt?'Salvar roteiro no conteúdo':'Save script to content'} description={pt?'Vincule esta resposta a uma pauta aprovada. As opções anteriores ficam no histórico; a nova versão precisa de aprovação.':'Link this response to an approved topic. Earlier options stay in history; the new version requires approval.'} onClose={()=>{if(!saving)setChooseContent(false)}}><div className="delivery-review-fields"><label>{pt?'Conteúdo':'Content'}<SelectMenu value={contentId} ariaLabel={pt?'Conteúdo da entrega':'Delivery content'} onChange={setContentId} options={[{value:'',label:pt?'Escolha um conteúdo':'Choose content'},...candidates.map(item=>({value:item.id,label:item.title}))]}/></label>{!candidates.length&&<p>{pt?'Aprove uma pauta no Estúdio antes de salvar o roteiro. Sua resposta permanece no chat.':'Approve a topic in Studio before saving script options. Your response stays in chat.'}</p>}{error&&<p role="alert" className="delivery-error">{error}</p>}<button className="primary-button" disabled={saving||!candidates.some(item=>item.id===contentId)} onClick={()=>void save(contentId)}>{pt?'Salvar nova versão':'Save new version'}</button></div></FlowDialog>}
    {review&&<ScriptDeliveryReview artifact={review} onClose={()=>setReview(null)}/>}
    {workContent&&<FlowDialog title={pt?'Enviar e acompanhar o especialista':'Send and follow the specialist'} description={pt?'Usa a fila salva do Estúdio. Este trabalho tem sua própria sessão de execução; os dois chats comuns continuam independentes.':'Uses Studio’s saved queue. This work has its own execution session; the ordinary chats remain independent.'} onClose={()=>setWorkContentId(null)}><EditorialWorkPanel topicId={workContent.topicId} content={workContent} initialSourceAgentId={agent.id}/></FlowDialog>}
  </section>;
}

function DeliveryPreview({delivery}:{delivery:ChatDelivery}) {
  const {locale}=useLanguage(),pt=locale==='pt-BR';
  if(delivery.kind==='file-delivery')return <p>{delivery.data.summary}</p>;
  if(delivery.kind==='research')return <div className="delivery-preview">{delivery.data.map((topic,index)=><div key={index}><h4>{topic.title}</h4><p>{topic.summary}</p><details><summary>{pt?'Ângulos, fontes e pontos a verificar':'Angles, sources and facts to check'}</summary><p>{topic.whyItMatters}</p><ul>{topic.angles.map((angle,i)=><li key={i}>{angle}</li>)}</ul><div className="delivery-sources">{topic.sources.map((source,i)=><a href={source.url} target="_blank" rel="noopener noreferrer" key={i}>{source.title}</a>)}</div>{topic.factualQuestions.length>0&&<ul>{topic.factualQuestions.map((question,i)=><li key={i}>{question}</li>)}</ul>}</details></div>)}</div>;
  return <div className="delivery-preview"><p>{delivery.data.hooks[0]}</p><small>{delivery.data.hooks.length} hooks · {delivery.data.paths.length} {pt?'caminhos':'paths'}</small><details><summary>{pt?'Ler roteiro proposto':'Read proposed script'}</summary><p>{delivery.data.draftScript}</p></details></div>;
}

export function ScriptDeliveryReview({artifact,onClose,initialDecision='approve',initialNotes=''}:{artifact:EditorialArtifact;onClose:()=>void;initialDecision?:'approve'|'rejected'|'revision-requested';initialNotes?:string}) {
  const {locale}=useLanguage(),pt=locale==='pt-BR';
  const {state,jobs,approveScript,reviewScript,runScript,getNotionConnection}=useContentWorkflow();
  const options=artifact.data as ScriptOptions;
  const content=state.contents.find(item=>item.id===artifact.contentId);
  const existing=state.artifacts.find(item=>item.id===content?.approvedScriptArtifactId)?.data as ApprovedScript|undefined;
  const [script,setScript]=useState<ApprovedScript>(()=>structuredClone(existing??{hook:options.hooks[0],cta:options.ctas[0],path:options.paths[0],text:options.draftScript,improvisationTopics:options.improvisationTopics,thumbnailDirection:options.thumbnailDirection}));
  const [destination,setDestination]=useState<string|null>(null),[sync,setSync]=useState(false),[notes,setNotes]=useState(initialNotes);
  const [decision,setDecision]=useState(initialDecision),[savedDecision,setSavedDecision]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
  // Destination is frozen for the open review, not silently refreshed under its checkbox.
  useEffect(()=>{let active=true;void getNotionConnection(artifact.workspaceId).then(config=>{if(active)setDestination(config.autoSync?config.dataSourceId:'')}).catch(failure=>{if(active){setDestination('');setError(String(failure.message??failure))}});return()=>{active=false}},[artifact.workspaceId,getNotionConnection]);
  const current=content?.scriptOptionsArtifactId===artifact.id&&state.artifacts.some(item=>item.id===artifact.id&&item.version===artifact.version&&JSON.stringify(item.data)===JSON.stringify(artifact.data));
  const job=jobs.find(item=>item.contentId===content?.id&&item.artifactId===content?.approvedScriptArtifactId);
  const revisionAgentId=artifact.source?.agentId??state.runs.find(run=>run.id===artifact.runId)?.agentId;
  const submit=async()=>{if(!content)return;setBusy(true);setError('');try{if(decision==='approve')await approveScript(content.id,script,notes,sync,{artifact,destination:destination??undefined});else await reviewScript(artifact,decision,notes);setSaved(true);setSavedDecision(decision)}catch(failure){setError(failure instanceof Error?failure.message:String(failure))}finally{setBusy(false)}};
  return <FlowDialog title={pt?'Revisar roteiro':'Review script'} description={`${content?.title??''} · ${pt?'Versão':'Version'} ${artifact.version}`} onClose={()=>{if(!busy)onClose()}}><div className="delivery-review-fields">
    <div className="editorial-segment" aria-label={pt?'Decisão da revisão':'Review decision'}>{(['approve','revision-requested','rejected'] as const).map(value=><button type="button" key={value} disabled={busy} aria-pressed={decision===value} onClick={()=>{setDecision(value);setSaved(false)}}>{value==='approve'?(pt?'Aprovar':'Approve'):value==='rejected'?(pt?'Rejeitar':'Reject'):(pt?'Pedir ajuste':'Request changes')}</button>)}</div>
    {initialDecision!=='approve'||initialNotes?<p className="editorial-hint">{pt?'Pedido reconhecido no chat. Confira a versão e confirme a decisão abaixo.':'Request recognized in chat. Review the version and confirm below.'}</p>:null}
    {!current&&<p role="alert" className="delivery-error">{pt?'Esta versão mudou. Feche e abra a entrega atual antes de aprovar.':'This version changed. Close and review the current delivery before approving.'}</p>}
    <label>Hook<SelectMenu ariaLabel="Hook" value={script.hook} onChange={hook=>setScript({...script,hook})} options={[...new Set([script.hook,...options.hooks])].map(value=>({value,label:value}))}/></label>
    <label>CTA<SelectMenu ariaLabel="CTA" value={script.cta} onChange={cta=>setScript({...script,cta})} options={[...new Set([script.cta,...options.ctas])].map(value=>({value,label:value}))}/></label>
    <label>{pt?'Caminho narrativo':'Narrative path'}<SelectMenu ariaLabel={pt?'Caminho narrativo':'Narrative path'} value={String(options.paths.findIndex(path=>path.title===script.path.title))} onChange={index=>setScript({...script,path:options.paths[Number(index)]??script.path})} options={[...(options.paths.some(path=>path.title===script.path.title)?[]:[{value:'-1',label:script.path.title}]),...options.paths.map((path,index)=>({value:String(index),label:path.title}))]}/></label>
    <p className="delivery-path">{script.path.outline}</p>
    <label>{pt?'Roteiro':'Script'}<textarea className="delivery-script" value={script.text} onChange={event=>setScript({...script,text:event.target.value})}/></label>
    <details><summary>{pt?'Improviso e thumbnail':'Talking points and thumbnail'}</summary><label>{pt?'Tópicos para improvisar':'Talking points'}<textarea value={script.improvisationTopics.join('\n')} onChange={event=>setScript({...script,improvisationTopics:event.target.value.split('\n')})}/></label><label>Thumbnail<textarea value={script.thumbnailDirection} onChange={event=>setScript({...script,thumbnailDirection:event.target.value})}/></label></details>
    <label>{pt?'Observações da revisão':'Review notes'}<textarea value={notes} onChange={event=>setNotes(event.target.value)}/></label>
    <label className="delivery-notion-choice"><input type="checkbox" checked={sync&&decision==='approve'} disabled={!destination||busy||decision!=='approve'} onChange={event=>setSync(event.target.checked)}/>{pt?'Enviar esta versão ao Notion':'Send this version to Notion'}</label>
    <small>{destination?`${pt?'Destino revisado':'Reviewed destination'}: ${destination}`:destination===null?(pt?'Conferindo destino…':'Checking destination…'):(pt?'Configure o destino do Notion no Estúdio para habilitar o envio.':'Configure the Notion destination in Studio to enable sending.')}</small>
    {error&&<p role="alert" className="delivery-error">{error}</p>}
    {saved&&<p role="status">{savedDecision==='approve'?(pt?'Aprovação salva.':'Approval saved.'):savedDecision==='rejected'?(pt?'Rejeição salva. As versões anteriores permanecem no histórico.':'Rejection saved. Earlier versions remain in history.'):(pt?'Pedido de ajuste salvo. Gere uma nova versão quando estiver pronto.':'Changes saved. Generate a new version when ready.')} {savedDecision==='approve'&&job?(job.status==='succeeded'?(pt?'Card confirmado no Notion.':'Notion card confirmed.'):job.status==='failed'?job.error:(pt?'Envio na fila. Acompanhe no Estúdio.':'Delivery queued. Follow it in Studio.')):''}</p>}
    {saved&&savedDecision==='revision-requested'&&revisionAgentId&&content&&<button type="button" className="soft-button" disabled={busy} onClick={()=>{setBusy(true);setError('');void runScript(content.id,revisionAgentId).then(onClose).catch(failure=>setError(failure.message)).finally(()=>setBusy(false))}}>{pt?'Gerar nova versão com o ajuste':'Generate a revised version'}</button>}
  </div><footer className="delivery-review-footer"><button type="button" className="primary-button" disabled={busy||!current||(decision==='approve'&&(script.text.trim().length<80||sync&&!destination))||(decision==='revision-requested'&&!notes.trim())} onClick={()=>void submit()}>{busy?(pt?'Salvando…':'Saving…'):decision==='rejected'?(pt?'Confirmar rejeição':'Confirm rejection'):decision==='revision-requested'?(pt?'Salvar pedido de ajuste':'Save change request'):sync?(pt?'Aprovar e enviar ao Notion':'Approve and send to Notion'):(pt?'Aprovar esta versão':'Approve this version')}</button></footer></FlowDialog>;
}
