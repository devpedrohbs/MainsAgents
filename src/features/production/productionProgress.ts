import {productionStageLabel,type ProductionRun} from './model.ts';

export type ProgressPhaseStatus='completed'|'current'|'stopped'|'unconfirmed'|'upcoming';
export type ProgressState='active'|'waiting'|'paused'|'blocked'|'canceled'|'complete'|'unknown';
export interface ProgressPhase {id:string;label:string;status:ProgressPhaseStatus;stageLabel?:string}
export interface ProductionProgressView {state:ProgressState;phases:ProgressPhase[];stageLabel:string;stoppedAt?:string;nextAction:string;reason?:string;updatedAt:string}

/** Ordered phases over the coordinator's linear stages (production-protocol.mjs). */
const phases:Array<{id:string;pt:string;en:string;stages:string[]}>=[
 {id:'script',pt:'Roteiro',en:'Script',stages:['writing','script-review','notion']},
 {id:'recording',pt:'Gravação',en:'Recording',stages:['recording']},
 {id:'editing',pt:'Edição',en:'Editing',stages:['planning-edit','editing','video-review']},
 {id:'package',pt:'Capas e legendas',en:'Covers and captions',stages:['platforms','preparing-package','generating-cover','covers-review','package-review']},
 {id:'schedule',pt:'Agendamento',en:'Scheduling',stages:['schedule','scheduling']},
 {id:'complete',pt:'Concluído',en:'Done',stages:['complete']},
];
const phaseOf=(stage?:string)=>stage?phases.findIndex(phase=>phase.stages.includes(stage)):-1;
const userStages=['script-review','recording','video-review','platforms','covers-review','package-review','schedule'];

const actions:Record<string,[string,string]>={
 writing:['Aguarde: o agente está estruturando o roteiro.','Wait: the agent is structuring the script.'],
 'script-review':['Escolha hook, CTA e caminho, edite o roteiro e aprove a versão para liberar o Notion e a gravação.','Choose hook, CTA and path, edit the script and approve the version to release Notion and recording.'],
 notion:['Aguarde: o roteiro aprovado está sendo registrado no Notion.','Wait: the approved script is being saved to Notion.'],
 recording:['Grave o vídeo e envie a gravação para a edição básica.','Record the video and send it for basic editing.'],
 'planning-edit':['Aguarde: o editor está preparando o plano de edição.','Wait: the editor is preparing the editing plan.'],
 editing:['Aguarde: o vídeo está sendo editado neste PC.','Wait: the video is being edited on this PC.'],
 'video-review':['Revise o vídeo editado e aprove ou peça um ajuste.','Review the edited video, then approve it or request a revision.'],
 platforms:['Escolha as plataformas onde deseja publicar.','Choose the platforms to publish on.'],
 'preparing-package':['Aguarde: as legendas por rede estão sendo preparadas.','Wait: per-network captions are being prepared.'],
 'covers-review':['Exporte as três capas locais por formato, compare e aprove uma por rede. Nenhuma IA é usada.','Export the three local covers per format, compare them and approve one per network. No AI is used.'],
 'generating-cover':['Aguarde: as capas estão sendo geradas.','Wait: covers are being generated.'],
 'package-review':['Revise capas e legendas de cada rede e aprove ou peça uma nova versão.','Review each network\'s covers and captions, then approve or request a new version.'],
 schedule:['Escolha o horário e as contas para agendar.','Choose the time and accounts to schedule.'],
 scheduling:['Aguarde a confirmação dos agendamentos e confira as entregas.','Wait for schedule confirmation and check the deliveries.'],
 complete:['Nenhuma ação pendente. Acompanhe as publicações nas entregas.','Nothing pending. Follow the publications in deliveries.'],
};

/** Last linear stage recorded by the coordinator's audit trail (setStage logs the stage name). */
function lastRecordedStage(run:ProductionRun){
 for(const event of [...(run.events??[])].reverse()){
  if(phaseOf(event.action)>=0&&event.action!=='complete')return event.action;
  if(event.action==='idea-approved')return 'writing'; // creation starts at writing without a stage event
  if(event.action==='recorded-import')return 'planning-edit'; // recorded entry starts at edit planning
 }
}
/** Where a paused/blocked/canceled run stopped; undefined when the evidence is missing. */
function stoppedStage(run:ProductionRun){
 const resume=phaseOf(run.resumeStage)>=0?run.resumeStage:undefined;
 // Cancel does not set resumeStage, so a leftover value from an earlier pause may be stale.
 return run.stage==='canceled'?lastRecordedStage(run)??resume:resume??lastRecordedStage(run);
}

export function productionProgress(run:ProductionRun,pt=true):ProductionProgressView{
 const say=([ptText,enText]:[string,string])=>pt?ptText:enText;
 const halted=['paused','blocked','canceled'].includes(run.stage);
 const at=halted?stoppedStage(run):run.stage,current=phaseOf(at);
 const known=halted||current>=0;
 const state:ProgressState=!known?'unknown':halted?run.stage as ProgressState:run.stage==='complete'?'complete':userStages.includes(run.stage)?'waiting':'active';
 const events=(run.events??[]).filter(event=>phaseOf(event.action)>=0);
 // Linear order alone is not evidence: without an audit event an earlier phase stays unconfirmed.
 const evidenced=(index:number)=>events.some(event=>phaseOf(event.action)===index)||(index===0&&events.some(event=>phaseOf(event.action)>0));
 // A recorded entry never had a script or recording phase in the app: they are omitted, not shown as pending/unconfirmed.
 const skipped=run.entry?.kind==='recorded'?['script','recording']:[];
 const list=phases.map((phase,index):ProgressPhase=>{
  const label=pt?phase.pt:phase.en;
  if(state==='complete')return {id:phase.id,label,status:'completed'};
  if(current<0||index>current)return {id:phase.id,label,status:'upcoming'};
  if(index===current)return {id:phase.id,label,status:halted?'stopped':'current',stageLabel:at?productionStageLabel(at,pt):undefined};
  return {id:phase.id,label,status:evidenced(index)?'completed':'unconfirmed'};
 }).filter(phase=>!skipped.includes(phase.id));
 const where=at&&phaseOf(at)>=0?productionStageLabel(at,pt):undefined;
 const reason=run.error?.trim()||undefined;
 let nextAction:string;
 if(state==='unknown')nextAction=say([`Etapa não reconhecida (${run.stage}). Abra a conversa da produção para verificar o estado real.`,`Unrecognized stage (${run.stage}). Open the production chat to check its actual state.`]);
 else if(state==='canceled')nextAction=say(['Produção cancelada. Nada será executado; inicie uma nova produção para continuar.','Production canceled. Nothing else will run; start a new production to continue.']);
 else if(halted&&run.imported)nextAction=say(['Histórico importado não autoriza execução. Inicie uma nova produção a partir da ideia.','Imported history does not authorize execution. Start a new production from the idea.']);
 else if(state==='paused')nextAction=say([`Retome para verificar o turno e os arquivos salvos${where?` e continuar em “${where}”`:''}.`,`Resume to verify the saved turn and files${where?` and continue at “${where}”`:''}.`]);
 else if(state==='blocked')nextAction=say(['Resolva o problema indicado e retome; envios externos incertos devem ser conferidos nas entregas.','Fix the reported problem and resume; check deliveries for any uncertain external send.']);
 else nextAction=say(actions[run.stage]);
 return {state,phases:list,stageLabel:productionStageLabel(run.stage,pt),stoppedAt:halted?where:undefined,nextAction,reason:halted?reason:undefined,updatedAt:run.updatedAt};
}
