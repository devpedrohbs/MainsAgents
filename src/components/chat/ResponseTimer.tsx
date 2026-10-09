import {useEffect,useState} from 'react';
import type {ChatActivityItem} from '../../features/chat/model/Chat';
import {formatResponseDuration,responseElapsedMs} from '../../features/chat/responseTiming';
import {useLanguage} from '../../app/LanguageProvider';
import '../../styles/response-timer.css';

const labels={
  running:{pt:'Trabalhando',en:'Working'},
  completed:{pt:'Finalizado',en:'Finished'},
  interrupted:{pt:'Interrompido',en:'Interrupted'},
  error:{pt:'Falhou',en:'Failed'},
} as const;

/** One compact line per agent execution. Counts only while that execution runs; the final duration stays frozen. */
export function RunStatusLine({run,steps=[]}:{run?:ChatActivityItem;steps?:readonly ChatActivityItem[]}){
  const {locale}=useLanguage(),pt=locale==='pt-BR';
  const running=!run?.endedAt,startedAt=run?.startedAt;
  const [now,setNow]=useState(Date.now);
  useEffect(()=>{if(!running||!startedAt)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[running,startedAt]);
  const state=running?'running':run?.outcome??'completed';
  const label=labels[state][pt?'pt':'en'];
  const time=startedAt?<time>{formatResponseDuration(responseElapsedMs({startedAt,endedAt:run?.endedAt},now))}</time>:null;
  const title=pt?'Tempo de trabalho desta execução, incluindo ferramentas e espera por aprovação.':'Working time of this execution, including tools and waiting for approval.';
  // Same markup while running, so tool events never reshape or blink the line; steps fold in only once it ends.
  return <div className="chat-run-status" data-state={state} title={title}>
    <span className="run-status-dot" aria-hidden="true"/><span className="run-status-label">{label}</span>{time&&<><span aria-hidden="true">·</span>{time}</>}
    {!running&&steps.length>0&&<details className="run-status-steps">
      <summary>{pt?`${steps.length} etapa${steps.length===1?'':'s'}`:`${steps.length} step${steps.length===1?'':'s'}`}</summary>
      <ol>{steps.map(step=><li key={step.id} data-status={step.status}>{step.label}</li>)}</ol>
    </details>}
  </div>;
}
