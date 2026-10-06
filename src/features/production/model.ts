import type {AgentSession,ChatItem} from '../chat/model/Chat';
import type {ProductionBudget,ProductionBudgetStop} from '../../../production-budget.mjs';
import type {EditorialTopic,PublicationDelivery,PublicationMedia} from '../content/model';
export interface ProductionRun {
 id:string;revision:number;workspaceId:string;contentId:string;topicId:string;flowId:string;name:string;stage:string;resumeStage?:string;error?:string;imported?:boolean;
 sourceAgent:{id:string;name:string};editorAgent:{id:string;name:string};publisherAgent?:{id:string;name:string};sourceSession:AgentSession;editorSession:AgentSession;publisherSession?:AgentSession;topic:EditorialTopic;
 notionDestination:string;notion?:{url:string;pageId:string};timeZone:string;outputVideo?:PublicationMedia;approvedVideo?:PublicationMedia;
 reviewDeliveries?:PublicationDelivery[];reviewHash?:string;platforms?:string[];step?:{output:string;phase:string;budgetKey?:string;callId?:string};
 /** Absent on productions created before budgets existed: their earlier usage was not measured. */
 budget?:ProductionBudget;budgetStop?:ProductionBudgetStop;
 schedule?:{plannedAt:string;timeZone:string;targets:ScheduleTarget[]};scheduleHash?:string;events?:Array<{action:string;detail:string;at:string}>;updatedAt:string;
}
export interface ScheduleTarget {platform:string;provider:'zernio'|'publora';accountId:string;networkSettings?:PublicationDelivery['networkSettings']}
export const productionStageLabel=(stage:string,pt=true):string=>({writing:pt?'Estruturando roteiro':'Structuring script',notion:pt?'Registrando no Notion':'Saving to Notion',recording:pt?'Aguardando gravação':'Waiting for recording','planning-edit':pt?'Editor preparando o plano':'Editor preparing the plan',editing:pt?'Editando vídeo':'Editing video','video-review':pt?'Aguardando aprovação do vídeo':'Waiting for video approval',platforms:pt?'Escolher plataformas':'Choose platforms','preparing-package':pt?'Preparando legendas':'Preparing captions','generating-cover':pt?'Gerando capas':'Generating covers','package-review':pt?'Aguardando aprovação do pacote':'Waiting for package approval',schedule:pt?'Escolher horário e contas':'Choose time and accounts',scheduling:pt?'Agendando':'Scheduling',complete:pt?'Agendamentos confirmados':'Schedules confirmed',paused:pt?'Produção pausada':'Production paused',blocked:pt?'Precisa de atenção':'Needs attention',canceled:pt?'Produção cancelada':'Production canceled'}[stage]??stage);
/** Only production-owned messages may be mirrored; user history and model choices win. */
export function mergeProductionSessions(current:AgentSession[],runs:ProductionRun[],agents:readonly {id:string;workspaceId:string}[]):AgentSession[]{
 const result=current.slice();
 for(const run of runs)for(const shadow of [run.sourceSession,run.editorSession,run.publisherSession]){
  if(!shadow||shadow.contentId!==run.contentId||!agents.some(agent=>agent.id===shadow.agentId&&agent.workspaceId===run.workspaceId))continue;
  const incoming=shadow.messages.filter(message=>message.id.startsWith(`production:${run.id}:`));const index=result.findIndex(session=>session.id===shadow.id);
  const productionContext={id:run.id,stage:run.stage,notionUrl:run.notion?.url,recentResults:incoming.filter(item=>item.type==='message').slice(-5).map(item=>item.type==='message'?item.content.slice(0,10000):''),deliveries:run.reviewDeliveries?.map(d=>({platform:d.platform,text:d.text,version:d.version,status:d.status}))};
  if(index<0){result.push({...shadow,topicId:run.topicId,messages:incoming,productionContext});continue;}
  const old=result[index];if(old.agentId!==shadow.agentId||old.contentId&&old.contentId!==run.contentId)continue;
  const messages=new Map<string,ChatItem>(old.messages.map(item=>[item.id,item]));for(const item of incoming)messages.set(item.id,item);
  result[index]={...old,contentId:run.contentId,topicId:run.topicId,productionContext,messages:[...messages.values()],updatedAt:old.updatedAt>shadow.updatedAt?old.updatedAt:shadow.updatedAt};
 }
 return JSON.stringify(result)===JSON.stringify(current)?current:result;
}
