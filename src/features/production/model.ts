import type {AgentSession,ChatItem} from '../chat/model/Chat';
import type {ProductionBudget,ProductionBudgetStop} from '../../../production-budget.mjs';
import type {ProductionCaptions} from '../../../production-captions.mjs';
export type {ProductionCaptions,CaptionVersion} from '../../../production-captions.mjs';
import type {EditorialTopic,PublicationDelivery,PublicationMedia} from '../content/model';
export type ProductionProvider='codex'|'claude';
export interface ScriptPath {title:string;outline:string}
/** Immutable script version; `hash` is the sha256 of its data (hook, cta, path, text, improvisationTopics, thumbnailDirection). */
export interface ScriptVersion {version:number;hook:string;cta:string;path:ScriptPath;text:string;improvisationTopics:string[];thumbnailDirection:string;hash:string;source:'agent'|'user'|'legacy';createdAt:string}
export interface ScriptOptions {hooks:string[];ctas:string[];paths:ScriptPath[];improvisationTopics:string[];thumbnailDirection:string;draftScript:string}
/** `reviewRequired`: legacy card still being written; the user must review before recording. */
export interface ScriptApproval {version:number;hash:string;approvedAt:string;legacy?:boolean;reviewRequired?:boolean}
export interface CoverConcept {id:'product'|'person'|'benefit';timestampSeconds:number;title:string;kicker:string;framing:{focusX:number;focusY:number;zoom:number}}
export interface CoverBrand {theme:'dark'|'light';accent:string;logoAssetId?:string}
export interface CoverSource {assetId:string;versionId:string;sha256:string}
export interface CoverBatch {batchId:string;specHash:string;inputsHash:string;format:string;source:CoverSource;concepts:CoverConcept[];brand:CoverBrand;items:Array<{concept:CoverConcept['id'];assetId:string;versionId:string;sha256:string;width:number;height:number;warnings?:string[]}>;createdAt:string}
export interface ProductionCovers {
 source:CoverSource;durationSeconds:number;concepts:CoverConcept[];brand:CoverBrand;destinations:Array<{platform:string;format:string;confirmed?:boolean}>;
 batches:Record<string,CoverBatch>;
 render?:{id:string;format:string;status:'running'|'done'|'failed'|'canceled'|'interrupted';error?:string;reused?:boolean;startedAt:string;finishedAt?:string};
 approved?:{selections:Array<{platform:string;format:string;concept:string;batchId:string;assetId:string;versionId:string;sha256:string}>;approvedAt:string};
}
/** Agent snapshot saved at start: the provider/model that actually runs each role. */
export interface ProductionAgentRef {id:string;name:string;providerId?:string;modelId?:string}
export interface ProductionRun {
 id:string;revision:number;workspaceId:string;contentId:string;topicId:string;flowId:string;name:string;stage:string;resumeStage?:string;error?:string;imported?:boolean;
 sourceAgent:ProductionAgentRef;editorAgent:ProductionAgentRef;publisherAgent?:ProductionAgentRef;sourceSession:AgentSession;editorSession:AgentSession;publisherSession?:AgentSession;topic:EditorialTopic;
 /** B07: 'local' = approved script releases recording without Notion; absent = Notion mode (default/legacy). */
 scriptMode?:'local';notionDestination?:string;notion?:{url:string;pageId:string;scriptVersion?:number;scriptHash?:string;imported?:boolean};
 /** Content session entry with a video already recorded: no app idea/script/approval; the context is one chosen card (read-only) or pasted text. */
 entry?:{kind:'recorded';origin:'notion'|'text';context:{kind:'notion';pageId:string;url:string;fetchedAt:string;chars:number}|{kind:'text';text:string;hash:string};video:PublicationMedia&{name:string};sessionId:string;authorizedAt:string};
 /** Read-only card text read for this run (server-owned); package stage may re-read it. */
 notionRead?:{text:string;fetchedAt?:string};packageNotionRead?:{text:string;fetchedAt?:string};editPlan?:{summary?:string;motionSummary?:string};
 inputVideo?:PublicationMedia;editPreferences?:{format:'original'|'portrait';mode:'smart'|'basic';motion?:'off'|'subtle'|'balanced'|'intense'};
 scriptGate?:number;scriptOptions?:ScriptOptions;scriptVersions?:ScriptVersion[];scriptApproval?:ScriptApproval;script?:Omit<ScriptVersion,'version'|'hash'|'source'|'createdAt'>;
 /** Server-computed: the latest version is approved and its Notion card is confirmed. */
 recordingReady?:boolean;
 /** F02: checklist and B-roll/material notes for the approved script version/hash (ignored when they differ). */
 recordingPrep?:{version:number;hash:string;checklist:Partial<Record<'framing'|'light'|'audio'|'product',boolean>>;suggestions?:Array<{id:string;sceneIndex:number;kind:'broll'|'material';text:string}>;updatedAt:string};
 /** Local cover gate (covers-review). */
 /** B05: speech captions burned into the video under review (video-review). `captionStyles` is sent only in that stage. */
 captions?:ProductionCaptions;captionStyles?:Array<{id:'classic'|'boxed'|'highlight';label:string}>;
 covers?:ProductionCovers;coverFormats?:Array<{id:string;label:string;width:number;height:number}>;providers?:{source:ProductionProvider|string;editor:ProductionProvider|string;publisher:ProductionProvider|string};timeZone:string;videoJobId?:string;outputVideo?:PublicationMedia;approvedVideo?:PublicationMedia;
 reviewDeliveries?:PublicationDelivery[];reviewHash?:string;platforms?:string[];step?:{output:string;phase:string;budgetKey?:string;callId?:string};
 /** Absent on productions created before budgets existed: their earlier usage was not measured. */
 budget?:ProductionBudget;budgetStop?:ProductionBudgetStop;
 schedule?:{plannedAt:string;timeZone:string;targets:ScheduleTarget[]};scheduleHash?:string;events?:Array<{action:string;detail:string;at:string}>;updatedAt:string;
}
export interface ScheduleTarget {platform:string;provider:'zernio'|'publora';accountId:string;networkSettings?:PublicationDelivery['networkSettings']}
export const productionStageLabel=(stage:string,pt=true):string=>({writing:pt?'Estruturando roteiro':'Structuring script','script-review':pt?'Aguardando aprovação do roteiro':'Waiting for script approval',notion:pt?'Registrando no Notion':'Saving to Notion',recording:pt?'Aguardando gravação':'Waiting for recording','planning-edit':pt?'Editor preparando o plano':'Editor preparing the plan',editing:pt?'Editando vídeo':'Editing video','video-review':pt?'Aguardando aprovação do vídeo':'Waiting for video approval',platforms:pt?'Escolher plataformas':'Choose platforms','preparing-package':pt?'Preparando legendas':'Preparing captions','generating-cover':pt?'Gerando capas':'Generating covers','covers-review':pt?'Escolher capas':'Choose covers','package-review':pt?'Aguardando aprovação do pacote':'Waiting for package approval',schedule:pt?'Escolher horário e contas':'Choose time and accounts',scheduling:pt?'Agendando':'Scheduling',complete:pt?'Agendamentos confirmados':'Schedules confirmed',paused:pt?'Produção pausada':'Production paused',blocked:pt?'Precisa de atenção':'Needs attention',canceled:pt?'Produção cancelada':'Production canceled'}[stage]??stage);
/** Absolute local paths never reach a prompt: the chat agent gets file names and states, not disk locations. */
const withoutPaths=(text:string)=>text.replace(/[A-Za-z]:[\\/][^\s"'<>|]+/g,'[arquivo local]').replace(/(^|[\s(])\/(?:Users|home|tmp|var|private|mnt|Volumes)\/[^\s"'<>]+/g,'$1[arquivo local]');
const clip=(text:unknown,max:number)=>typeof text==='string'?withoutPaths(text).slice(0,max):undefined;
/** Explicit marker when a long text was cut: the chat must not assume it saw the whole document (the rest is never sent automatically). */
const cut=(text:unknown,max:number)=>typeof text==='string'&&text.length>max?{truncated:{shownChars:max,totalChars:text.length}}:{};
/** Bounded, path-free content snapshot the chat agent can answer from (reference data, never authorization). */
export function productionChatContext(run:ProductionRun,results:readonly ChatItem[]):NonNullable<AgentSession['productionContext']>{
 const last=[...(run.events??[])].reverse().find(event=>!['recording-prep'].includes(event.action));
 const entry=run.entry?{origin:run.entry.origin,video:run.entry.video.name,context:run.entry.context.kind==='text'?clip(run.entry.context.text,6000):clip(run.notionRead?.text,6000),...cut(run.entry.context.kind==='text'?run.entry.context.text:run.notionRead?.text,6000),...(run.entry.context.kind==='notion'?{cardUrl:run.entry.context.url}:{})}:undefined;
 const script=run.script??run.scriptVersions?.at(-1);
 return {id:run.id,stage:run.stage,stageLabel:productionStageLabel(run.stage),title:clip(run.topic?.title,200),notionUrl:run.notion?.url,
  ...(entry?{entry}:{}),
  ...(script&&!entry?{script:{status:run.scriptApproval?`aprovado v${run.scriptApproval.version}`:'aguardando revisão',hook:clip(script.hook,500),cta:clip(script.cta,500),text:clip(script.text,6000),...cut(script.text,6000)}}:{}),
  ...(!entry&&run.notionRead?.text?{cardNotes:clip(run.packageNotionRead?.text??run.notionRead.text,3000),...(cut(run.packageNotionRead?.text??run.notionRead.text,3000).truncated?{cardNotesTruncated:cut(run.packageNotionRead?.text??run.notionRead.text,3000).truncated}:{})}:{}),
  materials:{editedVideo:run.approvedVideo?'aprovado':run.outputVideo?'aguardando revisão':'ainda não exportado',...(run.platforms?.length?{platforms:run.platforms}:{}),...(run.editPlan?.summary?{editPlan:clip(run.editPlan.summary,500)}:{})},
  ...(last?{lastDecision:{action:last.action,at:last.at,...(last.detail?{detail:clip(last.detail,300)}:{})}}:{}),
  ...(run.error?{error:clip(run.error,500)}:{}),
  recentResults:results.filter(item=>item.type==='message').slice(-5).map(item=>item.type==='message'?clip(item.content,4000)??'':''),
  deliveries:run.reviewDeliveries?.map(d=>({platform:d.platform,text:d.text,version:d.version,status:d.status}))};
}
/**
 * Only production-owned messages may be mirrored; user history and model choices win. The main (source) conversation also
 * receives the editor/publisher results of the SAME run. A role session of the same agent as the main one is never created as
 * an extra visible chat (its results already reach the main one); an existing one keeps being updated.
 */
export function mergeProductionSessions(current:AgentSession[],runs:ProductionRun[],agents:readonly {id:string;workspaceId:string}[]):AgentSession[]{
 const result=current.slice();
 for(const run of runs){
  const owned=(shadow?:AgentSession)=>!!shadow&&shadow.contentId===run.contentId&&agents.some(agent=>agent.id===shadow.agentId&&agent.workspaceId===run.workspaceId);
  const mine=(shadow?:AgentSession)=>owned(shadow)?shadow!.messages.filter(message=>message.id.startsWith(`production:${run.id}:`)):[];
  const roles:Array<[AgentSession|undefined,string|undefined]>=[[run.editorSession,run.editorAgent?.name],[run.publisherSession,run.publisherAgent?.name]];
  const relayed=roles.flatMap(([shadow,name])=>mine(shadow).map(item=>item.type==='message'&&name?{...item,sourceAgentName:item.sourceAgentName??name}:item));
  const main=[...mine(run.sourceSession),...relayed].sort((a,b)=>(a.type==='message'?a.createdAt:'').localeCompare(b.type==='message'?b.createdAt:''));
  const productionContext=productionChatContext(run,main);
  for(const shadow of [run.sourceSession,run.editorSession,run.publisherSession]){
   if(!owned(shadow))continue;
   const isMain=shadow===run.sourceSession,incoming=isMain?main:mine(shadow),index=result.findIndex(session=>session.id===shadow!.id);
   if(index<0){if(!isMain&&shadow!.agentId===run.sourceSession.agentId)continue;result.push({...shadow!,topicId:run.topicId,messages:incoming,productionContext});continue;}
   const old=result[index];if(old.agentId!==shadow!.agentId||old.contentId&&old.contentId!==run.contentId)continue;
   const messages=new Map<string,ChatItem>(old.messages.map(item=>[item.id,item]));for(const item of incoming)messages.set(item.id,item);
   result[index]={...old,contentId:run.contentId,topicId:run.topicId,productionContext,messages:[...messages.values()],updatedAt:old.updatedAt>shadow!.updatedAt?old.updatedAt:shadow!.updatedAt};
  }
 }
 return JSON.stringify(result)===JSON.stringify(current)?current:result;
}
