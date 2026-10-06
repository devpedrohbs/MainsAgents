import {useState} from 'react';
import type {ProductionRun} from '../../features/production/model';
import {budgetUsage,PRODUCTION_BUDGET_RANGE} from '../../../production-budget.mjs';
import './production-budget.css';

const automatic=['writing','notion','planning-edit','editing','preparing-package','generating-cover','scheduling'];

/** Real call/attempt usage from the coordinator ledger. Tokens and cost are never estimated. */
export function ProductionBudget({run,pt,busy,act}:{run:ProductionRun;pt:boolean;busy:boolean;act:(action:string,data:Record<string,unknown>)=>Promise<unknown>}){
 const usage=budgetUsage(run),[calls,setCalls]=useState(String(usage.maxCalls)),[attempts,setAttempts]=useState(String(usage.maxAttemptsPerStep)),[reviewed,setReviewed]=useState(false);
 const editable=!automatic.includes(run.stage)&&!['complete','canceled'].includes(run.stage)&&!run.imported;
 const range=PRODUCTION_BUDGET_RANGE,nextCalls=Number(calls),nextAttempts=Number(attempts);
 const valid=Number.isInteger(nextCalls)&&nextCalls>=range.maxCalls.min&&nextCalls<=range.maxCalls.max&&Number.isInteger(nextAttempts)&&nextAttempts>=range.maxAttemptsPerStep.min&&nextAttempts<=range.maxAttemptsPerStep.max;
 const changed=nextCalls!==usage.maxCalls||nextAttempts!==usage.maxAttemptsPerStep;
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
   <div><dt>{pt?'Tokens e custo':'Tokens and cost'}</dt><dd>{pt?'Indisponíveis: o Codex CLI não informa esse uso ao app':'Unavailable: Codex CLI does not report this usage to the app'}</dd></div>
  </dl>
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
