import {useEffect,useState} from 'react';
import type {ChatActivityItem} from '../../features/chat/model/Chat';
import {responseElapsedMs} from '../../features/chat/responseTiming';
import {finishedSteps,formatRunDuration,liveRunView} from '../../features/chat/runSteps';
import {useLanguage} from '../../app/LanguageProvider';
import {AgentAvatar} from '../agents/AgentAvatar';
import type {Agent} from '../../features/agents/model/Agent';
import '../../styles/response-timer.css';

const finalLabels={
  completed:{pt:'Trabalhou por',en:'Worked for'},
  interrupted:{pt:'Interrompido em',en:'Stopped after'},
  error:{pt:'Falhou em',en:'Failed after'},
} as const;

/**
 * One line per agent execution. While it runs: the agent's mascot, what it is doing right now (from the real tool steps)
 * and the last finished steps. Once it ends: "Worked for 14 s · 5 steps", with the steps folded inside.
 */
export function RunStatusLine({run,steps=[],agent,writing=false,awaitingApproval=false}:{run?:ChatActivityItem;steps?:readonly ChatActivityItem[];agent?:Pick<Agent,'name'|'role'|'avatarImage'|'avatarMascot'>;writing?:boolean;awaitingApproval?:boolean}){
  const {locale}=useLanguage(),pt=locale==='pt-BR';
  const running=!run?.endedAt,startedAt=run?.startedAt;
  const [now,setNow]=useState(Date.now);
  useEffect(()=>{if(!running||!startedAt)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[running,startedAt]);
  const state=running?'running':run?.outcome??'completed';
  const elapsed=startedAt?formatRunDuration(responseElapsedMs({startedAt,endedAt:run?.endedAt},now)):undefined;
  const title=pt?'Tempo de trabalho desta execução, incluindo ferramentas e espera por aprovação.':'Working time of this execution, including tools and waiting for approval.';
  if(running&&agent){
    const view=liveRunView(steps,{writing,awaitingApproval,pt}),trail=writing?[]:view.trail.slice(-2);
    return <div className="chat-run-status is-live" data-state={state} data-tone={view.tone} title={title} role="status" aria-live="polite">
      <AgentAvatar className="run-status-mascot" name={agent.name} role={agent.role} image={agent.avatarImage} mascot={agent.avatarMascot} thinking/>
      <span className="run-status-text">
        {/* Keyed by the phrase: each new step fades in instead of the text jumping in place. */}
        <span className="run-status-label" key={view.label}>{view.label}</span>
        <span className="run-status-meta">{elapsed&&<time>{elapsed}</time>}{view.detail&&<><span aria-hidden="true"> · </span><span className="run-status-detail">{view.detail}</span></>}</span>
      </span>
      {trail.length>0&&<ol className="run-status-trail" aria-label={pt?'Etapas concluídas':'Finished steps'}>{trail.map((text,index)=><li key={`${index}-${text}`}><Check/>{text}</li>)}</ol>}
    </div>;
  }
  if(running)return <div className="chat-run-status" data-state={state} title={title} role="status"><span className="run-status-dot" aria-hidden="true"/><span className="run-status-label">{pt?'Pensando…':'Thinking…'}</span>{elapsed&&<time>{elapsed}</time>}</div>;
  const done=finishedSteps(steps,pt),label=finalLabels[state as keyof typeof finalLabels]??finalLabels.completed;
  const count=done.length?<span className="run-status-count">{pt?`${done.length} etapa${done.length===1?'':'s'}`:`${done.length} step${done.length===1?'':'s'}`}</span>:null;
  const line=<><span className="run-status-dot" aria-hidden="true"/><span className="run-status-label">{label[pt?'pt':'en']}</span>{elapsed&&<time>{elapsed}</time>}{count&&<><span aria-hidden="true">·</span>{count}</>}</>;
  return <div className="chat-run-status" data-state={state} title={title}>
    {done.length?<details className="run-status-steps">
      <summary><Chevron/>{line}</summary>
      <ol>{done.map(step=><li key={step.id} data-status={step.failed?'error':'done'}>{step.failed?<span className="run-status-fail" aria-hidden="true">!</span>:<Check/>}{step.text}</li>)}</ol>
    </details>:line}
  </div>;
}

const Check=()=><svg className="run-status-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>;
const Chevron=()=><svg className="run-status-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>;
