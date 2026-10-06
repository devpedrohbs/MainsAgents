import type {ProductionRun} from '../../features/production/model';
import {productionProgress,type ProgressPhaseStatus,type ProgressState} from '../../features/production/productionProgress';
import './production-progress.css';

const statusText:Record<ProgressPhaseStatus,[string,string]>={
 completed:['Concluída','Completed'],current:['Etapa atual','Current step'],stopped:['Parou aqui','Stopped here'],
 unconfirmed:['Sem registro de conclusão','No completion record'],upcoming:['Próxima','Upcoming'],
};
const statusMark:Record<ProgressPhaseStatus,string>={completed:'✓',current:'●',stopped:'‖',unconfirmed:'?',upcoming:'○'};
const stateText:Record<ProgressState,[string,string]>={
 active:['Em andamento','In progress'],waiting:['Aguardando você','Waiting for you'],paused:['Pausada','Paused'],
 blocked:['Precisa de atenção','Needs attention'],canceled:['Cancelada','Canceled'],complete:['Concluída','Complete'],unknown:['Estado desconhecido','Unknown state'],
};

export function ProductionProgress({run,pt}:{run:ProductionRun;pt:boolean}){
 const view=productionProgress(run,pt),say=([ptText,enText]:[string,string])=>pt?ptText:enText;
 const halted=['paused','blocked','canceled'].includes(view.state);
 const updated=new Date(view.updatedAt);
 return <section className="production-progress" data-state={view.state} aria-label={pt?'Progresso da produção':'Production progress'}>
  <header className="production-progress-head">
   <span className="production-progress-state">{say(stateText[view.state])}</span>
   {!Number.isNaN(updated.getTime())&&<time dateTime={view.updatedAt}>{pt?'Atualizada ':'Updated '}{updated.toLocaleString(pt?'pt-BR':'en-US',{dateStyle:'short',timeStyle:'short'})}</time>}
  </header>
  <ol className="production-progress-steps">
   {view.phases.map((phase,index)=><li key={phase.id} data-status={phase.status} aria-current={phase.status==='current'||phase.status==='stopped'?'step':undefined}>
    <span className="production-progress-mark" aria-hidden="true">{statusMark[phase.status]}</span>
    <span className="production-progress-text">
     <strong><span className="production-progress-sr">{pt?`Etapa ${index+1} de ${view.phases.length}: `:`Step ${index+1} of ${view.phases.length}: `}</span>{phase.label}</strong>
     <small>{say(statusText[phase.status])}{phase.stageLabel&&` · ${phase.stageLabel}`}</small>
    </span>
   </li>)}
  </ol>
  <div className="production-progress-next" role={view.state==='blocked'?'alert':'status'}>
   {halted&&<p>{view.stoppedAt?(pt?`Parou em: ${view.stoppedAt}.`:`Stopped at: ${view.stoppedAt}.`):(pt?'Não há registro confiável da etapa em que parou.':'There is no reliable record of where it stopped.')}</p>}
   {view.reason&&<p>{pt?'Motivo registrado: ':'Recorded reason: '}{view.reason}</p>}
   <p><strong>{pt?'Próxima ação: ':'Next action: '}</strong>{view.nextAction}</p>
  </div>
 </section>;
}
