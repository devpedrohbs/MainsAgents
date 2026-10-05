import {useStudioDraftField,studioDraftKey} from '../../features/content/studioDrafts';
import {useEffect,useState} from 'react';
import {useLanguage} from '../../app/LanguageProvider';
import {useAgents} from '../../features/agents/AgentsProvider';
import {useContentWorkflow} from '../../features/content/ContentWorkflowProvider';
import type {EditorialContent,SpecialistResult,WorkflowJob} from '../../features/content/model';
import {SelectMenu} from '../common/SelectMenu';
import {FlowDialog} from '../common/FlowDialog';
import './editorial-work.css';

function WorkDialog({id,onClose}:{id:string;onClose:()=>void}){
  const {locale}=useLanguage(),pt=locale==='pt-BR';
  const {workDetail}=useContentWorkflow();const [job,setJob]=useState<WorkflowJob>(),[error,setError]=useState('');
  useEffect(()=>{let active=true,inFlight=false;const refresh=async()=>{if(inFlight)return;inFlight=true;try{const detail=await workDetail(id);if(active){setJob(detail);setError('')}}catch(error){if(active)setError(String(error))}finally{inFlight=false}};void refresh();const timer=setInterval(()=>void refresh(),1000);return()=>{active=false;clearInterval(timer)}},[id,workDetail]);
  const result=job?.kind==='handoff'?job.result as SpecialistResult|undefined:undefined;
  return <FlowDialog title={pt?'Acompanhar trabalho':'Follow work'} description={pt?'Fechar este painel ou navegar não interrompe o trabalho.':'Closing this panel or navigating does not interrupt work.'} onClose={onClose}>
    <div className="editorial-work-dialog-body">{error&&<p role="alert">{error}</p>}{!job&&!error&&<p>{pt?'Carregando…':'Loading…'}</p>}{job&&<>
      <div className="editorial-work-pair"><section><h3>{job.sourceAgent?.name??(pt?'Instrução enviada':'Sent instruction')}</h3><details><summary>{pt?'Contexto e briefing':'Context and briefing'}</summary><pre>{job.prompt}</pre></details><ul>{job.files.map(file=><li key={file.assetId}>{file.name}<code>{file.path}</code></li>)}</ul></section>
        <section><h3>{job.agent.name}</h3><p className="editorial-meta">{job.activity??job.status} · {pt?'Tentativa':'Attempt'} {job.attempt}</p>{result?<><p className="editorial-work-output">{result.summary}</p>{result.blockers.length>0&&<div className="editorial-work-blockers"><strong>{pt?'Impedimentos relatados':'Reported blockers'}</strong><ul>{result.blockers.map((item,index)=><li key={index}>{item}</li>)}</ul></div>}{result.outputFiles.map(file=><p key={file.path}><b>{file.name}</b><code>{file.path}</code></p>)}</>:<pre className="editorial-work-output">{job.output||(pt?'Aguardando resposta…':'Waiting for a response…')}</pre>}{job.error&&<p role="alert">{job.error}</p>}</section></div>
      <p className="editorial-meta">{pt?'Sessão do fluxo':'Workflow session'}: {job.sessionId??'—'}<br/>{pt?'Thread Codex':'Codex thread'}: {job.threadId??'—'}</p>
      {job.history.length>0&&<details><summary>{pt?'Tentativas anteriores':'Previous attempts'}</summary>{job.history.map(item=><section key={item.attempt}><h4>{pt?'Tentativa':'Attempt'} {item.attempt}</h4><p>{item.error}</p><pre>{item.output}</pre></section>)}</details>}
      <details><summary>{pt?'Atividades salvas':'Saved activities'}</summary><ol>{job.events?.map((event,index)=><li key={index}><time>{new Date(event.at).toLocaleTimeString(locale)}</time> · {event.type}{event.detail&&` · ${event.detail}`}</li>)}</ol></details>
    </>}</div>
  </FlowDialog>;
}

export function EditorialWorkPanel({topicId,content,requestedJobId,initialSourceAgentId}:{topicId:string;content?:EditorialContent;requestedJobId?:string;initialSourceAgentId?:string}){
  const {locale}=useLanguage(),pt=locale==='pt-BR';const {agents}=useAgents();
  const {state,workJobs,workError,transferWork,retryWork,cancelWork}=useContentWorkflow();
  const workspaceId=state.topics.find(topic=>topic.id===topicId)?.workspaceId;
  const eligible=agents.filter(agent=>agent.workspaceId===workspaceId&&(agent.providerId??'codex')==='codex');
  const sources=eligible.filter(agent=>agent.tools.includes('subagents'));
  const draftScope=studioDraftKey('handoff',workspaceId??'none',content?.id??topicId,content?.approvedScriptArtifactId??'none');
  const [sourceId,setSourceId]=useStudioDraftField<string>(draftScope,'source',initialSourceAgentId??''),[targetId,setTargetId]=useStudioDraftField<string>(draftScope,'target',''),[brief,setBrief]=useStudioDraftField<string>(draftScope,'brief',''),[selectedFiles,setSelectedFiles]=useStudioDraftField<string[]>(draftScope,'files',[]),[newSession,setNewSession]=useStudioDraftField<boolean>(draftScope,'newSession',false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[openId,setOpenId]=useState<string>(),[confirmId,setConfirmId]=useState<string>();
  const jobs=workJobs.filter(job=>job.workspaceId===workspaceId&&job.topicId===topicId);
  const assets=(state.assets??[]).filter(asset=>asset.contentId===content?.id&&asset.workspaceId===workspaceId);
  useEffect(()=>{if(!sources.some(agent=>agent.id===sourceId))setSourceId(sources[0]?.id??'');},[sources,sourceId]);
  useEffect(()=>{if(!eligible.some(agent=>agent.id===targetId&&agent.id!==sourceId))setTargetId(eligible.find(agent=>agent.id!==sourceId)?.id??'');},[eligible,sourceId,targetId]);
  useEffect(()=>{if(requestedJobId)setOpenId(requestedJobId)},[requestedJobId]);
  const action=async(fn:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');try{await fn()}catch(error){setError(error instanceof Error?error.message:String(error))}finally{setBusy(false)}};
  const status=(job:WorkflowJob)=>({queued:pt?'Na fila':'Queued',running:pt?'Trabalhando':'Working',succeeded:pt?'Resposta salva':'Response saved',failed:pt?'Precisa de atenção':'Needs attention',interrupted:pt?'Interrompido':'Interrupted',blocked:pt?'Bloqueado':'Blocked',canceled:pt?'Cancelado':'Canceled'}[job.status]);
  if(!jobs.length&&!content?.approvedScriptArtifactId&&!workError)return null;
  return <section className="editorial-card editorial-work-panel" aria-label={pt?'Trabalhos persistentes':'Persistent work'}>
    <div className="editorial-section-head"><div><span className="editorial-kicker">{pt?'EXECUÇÃO':'EXECUTION'}</span><h2>{pt?'Trabalhos e especialistas':'Work and specialists'}</h2><p className="editorial-meta">{pt?'Instruções, respostas e arquivos vinculados à mesma pauta.':'Instructions, responses and files linked to the same content.'}</p></div></div>
    {(workError||error)&&<p className="editorial-work-error" role="alert">{error||workError}</p>}
    {jobs.map(job=><article key={job.id} className="editorial-work-item"><div><strong>{job.kind==='research'?(pt?'Pesquisa':'Research'):job.kind==='script'?(pt?'Roteiro':'Script'):`${job.sourceAgent?.name} → ${job.agent.name}`}</strong><span className="editorial-meta">{job.agent.name} · {status(job)} · {pt?'Tentativa':'Attempt'} {job.attempt}</span></div>
      {job.error&&<p>{job.error}</p>}{job.kind==='handoff'&&job.status==='succeeded'&&(job.result as SpecialistResult)?.blockers?.length>0&&<p>{pt?'O especialista relatou impedimentos. Abra a resposta para revisar.':'The specialist reported blockers. Open the response to review.'}</p>}
      <div className="editorial-actions"><button className="soft-button" onClick={()=>setOpenId(job.id)}>{pt?'Acompanhar':'Follow'}</button>
        {['queued','running'].includes(job.status)&&<button className="soft-button" disabled={busy} onClick={()=>void action(()=>cancelWork(job.id))}>{pt?'Cancelar trabalho':'Cancel work'}</button>}
        {['failed','interrupted','blocked'].includes(job.status)&&<><button className="soft-button" disabled={busy} onClick={()=>void action(()=>retryWork(job.id))}>{pt?'Verificar e retomar':'Verify and resume'}</button>{['sending','streaming','response-complete'].includes(job.phase)&&<button className="soft-button" disabled={busy} onClick={()=>setConfirmId(job.id)}>{pt?'Reenviar instrução':'Resend instruction'}</button>}</>}
      </div>
    </article>)}
    {content?.status==='script-approved'&&<details className="editorial-work-transfer"><summary>{pt?'Enviar ao especialista':'Send to a specialist'}</summary><form onSubmit={event=>{event.preventDefault();void action(async()=>{await transferWork(content.id,sourceId,targetId,brief,selectedFiles.filter(id=>assets.some(asset=>asset.id===id)),newSession,content.approvedScriptArtifactId);setBrief('');})}}>
      <div className="editorial-work-fields"><label>{pt?'Agente de origem':'Source agent'}<SelectMenu value={sourceId} options={sources.map(agent=>({value:agent.id,label:agent.name}))} onChange={setSourceId} ariaLabel={pt?'Agente de origem':'Source agent'} disabled={busy}/></label><label>{pt?'Especialista que recebe':'Receiving specialist'}<SelectMenu value={targetId} options={eligible.filter(agent=>agent.id!==sourceId).map(agent=>({value:agent.id,label:agent.name}))} onChange={setTargetId} ariaLabel={pt?'Especialista que recebe':'Receiving specialist'} disabled={busy}/></label></div>
      {!sourceId&&<p>{pt?'Habilite colaboração em um agente Codex deste workspace.':'Enable collaboration on a Codex agent in this workspace.'}</p>}
      <label>{pt?'Instruções para esta etapa':'Instructions for this step'}<textarea aria-label={pt?'Briefing ao especialista':'Specialist briefing'} value={brief} onChange={event=>setBrief(event.target.value)} placeholder={pt?'O que o especialista deve analisar ou preparar?':'What should the specialist analyze or prepare?'} maxLength={32000} rows={3}/></label>
      {assets.length>0&&<fieldset><legend>{pt?'Arquivos da pauta':'Content files'}</legend>{assets.map(asset=><label key={asset.id}><input type="checkbox" checked={selectedFiles.includes(asset.id)} disabled={busy||selectedFiles.length>=20&&!selectedFiles.includes(asset.id)} onChange={event=>setSelectedFiles(current=>event.target.checked?[...current,asset.id]:current.filter(id=>id!==asset.id))}/><span>{asset.name}</span></label>)}</fieldset>}
      <label className="editorial-work-check"><input type="checkbox" checked={newSession} onChange={event=>setNewSession(event.target.checked)} disabled={busy}/><span>{pt?'Abrir uma nova sessão no especialista':'Open a new specialist session'}</span></label>
      <p className="editorial-meta">{pt?'Inclui o roteiro aprovado e verifica os arquivos antes de enviar. Continua a sessão deste conteúdo por padrão. Nesta etapa o especialista pode pesquisar e analisar arquivos; edição e publicação exigem os próximos recursos.':'Includes the approved script and verifies files before sending. Continues this content’s specialist session by default. The specialist can research and read files here; editing and publishing require the upcoming features.'}</p>
      <button className="primary-button" disabled={busy||!sourceId||!targetId||!brief.trim()||jobs.some(job=>job.kind==='handoff'&&['queued','running'].includes(job.status))}>{pt?'Enviar trabalho':'Send work'}</button>
    </form></details>}
    {openId&&<WorkDialog id={openId} onClose={()=>setOpenId(undefined)}/>}
    {confirmId&&<FlowDialog title={pt?'Reenviar esta instrução?':'Resend this instruction?'} description={pt?'O app verificará primeiro se a resposta anterior já terminou. Se precisar enviar novamente, uma nova tentativa poderá consumir seu plano. O resultado anterior será mantido.':'The app will check whether the previous response already finished. If it needs to resend, another attempt may use your plan. The previous result will be preserved.'} onClose={()=>setConfirmId(undefined)}><footer><button className="soft-button" onClick={()=>setConfirmId(undefined)}>{pt?'Voltar':'Back'}</button><button className="primary-button" disabled={busy} onClick={()=>void action(async()=>{await retryWork(confirmId,true);setConfirmId(undefined)})}>{pt?'Confirmar nova tentativa':'Confirm new attempt'}</button></footer></FlowDialog>}
  </section>;
}
