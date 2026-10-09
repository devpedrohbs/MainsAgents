import {useState} from 'react';
import {productionStageLabel,type ProductionRun} from '../../features/production/model';
import {budgetUsage,PRODUCTION_BUDGET_RANGE} from '../../../production-budget.mjs';
import './production-budget.css';

const providerLabel=(id:string)=>id==='claude'?'Claude Code':id==='codex'?'Codex':id;
const editorStages=['planning-edit','editing','video-review'],publisherStages=['platforms','preparing-package','generating-cover','covers-review','package-review','schedule','scheduling'];
const reasonText:Record<string,[string,string]>={'no-result':['o CLI terminou sem enviar o resultado','the CLI ended without sending a result'],cancelled:['execução cancelada antes do resultado','run cancelled before the result'],timeout:['tempo esgotado antes do resultado','timed out before the result'],'not-reported':['o provedor não informou uso','the provider did not report usage'],'zeroed-error':['resultado de erro sem valores confiáveis','error result without reliable values'],'error-result':['resultado de erro: pode estar incompleto','error result: may be incomplete'],'provider-no-usage':['este provedor não informa uso','this provider does not report usage']};
const fmt=(value:number|undefined,locale:string)=>value===undefined?undefined:value.toLocaleString(locale);
const automatic=['writing','notion','planning-edit','editing','preparing-package','generating-cover','scheduling'];

/** Real call/attempt usage from the coordinator ledger. Tokens and cost are never estimated. */
export function ProductionBudget({run,pt,busy,act}:{run:ProductionRun;pt:boolean;busy:boolean;act:(action:string,data:Record<string,unknown>)=>Promise<unknown>}){
 const usage=budgetUsage(run),[calls,setCalls]=useState(String(usage.maxCalls)),[attempts,setAttempts]=useState(String(usage.maxAttemptsPerStep)),[reviewed,setReviewed]=useState(false);
 const editable=!automatic.includes(run.stage)&&!['complete','canceled'].includes(run.stage)&&!run.imported;
 const range=PRODUCTION_BUDGET_RANGE,nextCalls=Number(calls),nextAttempts=Number(attempts);
 const valid=Number.isInteger(nextCalls)&&nextCalls>=range.maxCalls.min&&nextCalls<=range.maxCalls.max&&Number.isInteger(nextAttempts)&&nextAttempts>=range.maxAttemptsPerStep.min&&nextAttempts<=range.maxAttemptsPerStep.max;
 const changed=nextCalls!==usage.maxCalls||nextAttempts!==usage.maxAttemptsPerStep;
 const locale=pt?'pt-BR':'en-US',totals=usage.usageTotals,roleProvider=(stage:string)=>{const role=editorStages.includes(stage)?run.providers?.editor:publisherStages.includes(stage)?run.providers?.publisher:run.providers?.source;return role?providerLabel(String(role)):undefined;};
 const since=usage.measuredSince?new Date(usage.measuredSince).toLocaleString(pt?'pt-BR':'en-US',{dateStyle:'short',timeStyle:'short'}):'';
 async function save(){await act('adjust-budget',{authorize:true,reviewedCalls:usage.used,limits:{maxCalls:nextCalls,maxAttemptsPerStep:nextAttempts}});setReviewed(false);}
 return <section className="production-budget" aria-labelledby={`budget-${run.id}`}>
  <div className="production-budget-head"><strong id={`budget-${run.id}`}>{pt?'Uso de IA desta produção':'AI usage for this production'}</strong><span>{pt?`${usage.used} de ${usage.maxCalls} chamadas · ${usage.remaining} restantes`:`${usage.used} of ${usage.maxCalls} calls · ${usage.remaining} left`}</span></div>
  <meter min={0} max={usage.maxCalls} value={Math.min(usage.used,usage.maxCalls)} aria-label={pt?'Chamadas de IA usadas':'AI calls used'}/>
  <dl className="production-budget-facts">
   <div><dt>{pt?'Concluídas':'Completed'}</dt><dd>{usage.completed}</dd></div>
   <div><dt>{pt?'Falharam (contadas)':'Failed (counted)'}</dt><dd>{usage.failed}</dd></div>
   <div><dt>{pt?'Envio incerto (contado)':'Uncertain send (counted)'}</dt><dd>{usage.uncertain}</dd></div>
   {usage.inFlight>0&&<div><dt>{pt?'Em andamento':'In progress'}</dt><dd>{usage.inFlight}</dd></div>}
   <div><dt>{pt?'Tentativas da etapa atual':'Current step attempts'}</dt><dd>{run.step?.budgetKey?`${usage.stepAttempts} / ${usage.maxAttemptsPerStep}`:pt?`limite ${usage.maxAttemptsPerStep} por etapa`:`limit ${usage.maxAttemptsPerStep} per step`}</dd></div>
   <div><dt>{pt?'Tokens (reportados)':'Tokens (reported)'}</dt><dd>{totals?<>
     {([['input',pt?'entrada':'input'],['output',pt?'saída':'output'],['cacheRead',pt?'cache lido':'cache read'],['cacheCreation',pt?'cache criado':'cache created']] as const).map(([key,label])=><span key={key} className="production-budget-token">{label}: {fmt(totals[key],locale)??(pt?'indisponível':'unavailable')}</span>)}
     <small>{pt?`Informados pelo CLI do Claude em ${totals.callsReported} chamada(s)${totals.callsUnavailable?`; ${totals.callsUnavailable} sem relatório (indisponível, não zero)`:''}${totals.callsPartial?`; ${totals.callsPartial} possivelmente incompleta(s)`:''}. Soma só o que foi informado.`:`Reported by the Claude CLI for ${totals.callsReported} call(s)${totals.callsUnavailable?`; ${totals.callsUnavailable} without a report (unavailable, not zero)`:''}${totals.callsPartial?`; ${totals.callsPartial} possibly incomplete`:''}. Sums only what was reported.`}</small>
    </>:(pt?'Indisponível: nenhuma chamada informou uso. Só as chamadas são contadas; nada é estimado. Confira o consumo na conta de cada provedor.':'Unavailable: no call reported usage. Only calls are counted; nothing is estimated. Check usage in each provider account.')}</dd></div>
   {totals?.reportedCostUsd!==undefined&&<div><dt>{pt?'Custo reportado pelo CLI':'Cost reported by the CLI'}</dt><dd>US$ {totals.reportedCostUsd.toLocaleString(locale,{minimumFractionDigits:2,maximumFractionDigits:4})}<small>{pt?`Estimativa local do próprio CLI (${totals.costCalls} chamada(s)); não é fatura nem saldo da conta.`:`The CLI's own local estimate (${totals.costCalls} call(s)); not an invoice or account balance.`}</small></dd></div>}
  </dl>
  {usage.usageRows.length>0&&<details className="production-budget-calls"><summary>{pt?'Uso por etapa e tentativa':'Usage by step and attempt'}</summary>
   <ul>{usage.usageRows.map((row)=>{
    const info=row.usage,tokens=info?.tokens,provider=roleProvider(row.stage);
    return <li key={row.id}><strong>{productionStageLabel(row.stage,pt)} · {pt?'tentativa':'attempt'} {row.attempt}</strong>{provider&&<span> · {provider}</span>}{info?.model&&<span> · {pt?'modelo real':'actual model'} {info.model}</span>}
     <small>{info&&info.status!=='unavailable'&&tokens?`${pt?'entrada':'input'} ${fmt(tokens.input,locale)??'—'} · ${pt?'saída':'output'} ${fmt(tokens.output,locale)??'—'} · cache ${fmt(tokens.cacheRead,locale)??'—'}/${fmt(tokens.cacheCreation,locale)??'—'}${info.durationMs!==undefined?` · ${(info.durationMs/1000).toFixed(1)} s`:''}${info.status==='partial'?` · ${pt?'pode estar incompleto':'may be incomplete'}`:''}`:`${pt?'Indisponível':'Unavailable'}${info?.reason&&reasonText[info.reason]?`: ${reasonText[info.reason][pt?0:1]}`:row.callStatus==='reserved'||row.callStatus==='sent'?(pt?': em andamento':': in progress'):(pt?': não informado':': not reported')}`}</small></li>;})}</ul>
  </details>}
  {!usage.measured&&<p>{pt?'Produção criada antes dos limites: o uso anterior não foi medido. O limite padrão vale a partir da próxima chamada.':'Created before limits existed: earlier usage was not measured. The default limit applies from the next call.'}</p>}
  {usage.measured&&usage.legacy&&<p>{pt?`Uso anterior a ${since} não foi medido; a contagem começa nessa data.`:`Usage before ${since} was not measured; counting starts then.`}</p>}
  {usage.stop&&<p role="alert">{usage.stop.kind==='calls'?(pt?'Pausada no limite de chamadas. Nada foi enviado além dele.':'Paused at the call limit. Nothing was sent beyond it.'):(pt?'Pausada no limite de tentativas desta etapa. Nada foi reenviado.':'Paused at this step’s attempt limit. Nothing was resent.')} {pt?'Para continuar, revise o uso, aumente o limite e retome.':'To continue, review usage, raise the limit, then resume.'}</p>}
  {editable&&<details className="production-budget-adjust" open={Boolean(usage.stop)}>
   <summary>{pt?'Ajustar limites':'Adjust limits'}</summary>
   <div className="production-budget-fields">
    <label>{pt?`Chamadas de IA (${range.maxCalls.min}–${range.maxCalls.max})`:`AI calls (${range.maxCalls.min}–${range.maxCalls.max})`}<input type="number" inputMode="numeric" min={range.maxCalls.min} max={range.maxCalls.max} step={1} value={calls} onChange={event=>setCalls(event.target.value)}/></label>
    <label>{pt?`Tentativas por etapa (${range.maxAttemptsPerStep.min}–${range.maxAttemptsPerStep.max})`:`Attempts per step (${range.maxAttemptsPerStep.min}–${range.maxAttemptsPerStep.max})`}<input type="number" inputMode="numeric" min={range.maxAttemptsPerStep.min} max={range.maxAttemptsPerStep.max} step={1} value={attempts} onChange={event=>setAttempts(event.target.value)}/></label>
   </div>
   <label className="production-check"><input type="checkbox" checked={reviewed} onChange={event=>setReviewed(event.target.checked)}/>{pt?`Revisei o uso atual (${usage.used} chamadas, incluindo falhas e envios incertos).`:`I reviewed current usage (${usage.used} calls, including failures and uncertain sends).`}</label>
   {!valid&&<p role="alert">{pt?'Use números inteiros dentro dos intervalos indicados.':'Use whole numbers within the ranges shown.'}</p>}
   <button className="soft-button" disabled={busy||!valid||!changed||!reviewed} onClick={()=>void save()}>{pt?'Salvar limites':'Save limits'}</button>
   <small>{pt?'Salvar não retoma a produção nem repete chamadas; use “Retomar” depois.':'Saving does not resume the production or repeat calls; use “Resume” afterwards.'}</small>
  </details>}
 </section>;
}
