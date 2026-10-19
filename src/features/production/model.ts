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
 entry?:{kind:'recorded';origin:'notion'|'text'|'delegation';delegationJobIds?:string[];requestedBy?:string;context:{kind:'notion';pageId:string;url:string;fetchedAt:string;chars:number}|{kind:'text';text:string;hash:string};video:PublicationMedia&{name:string};sessionId:string;authorizedAt:string};
 /** Read-only card text read for this run (server-owned); package stage may re-read it. */
 notionRead?:{text:string;fetchedAt?:string};packageNotionRead?:{text:string;fetchedAt?:string};editPlan?:{summary?:string;motionSummary?:string};
 inputVideo?:PublicationMedia;editPreferences?:{format:'original'|'portrait';mode:'smart'|'basic';motion?:'off'|'subtle'|'balanced'|'intense';style?:string;acceptBasic?:{at:string;reason:string}};
 /** Who directs edits/motion for this run (absent on older runs = the editor agent itself). Display: `editDirector` below. */
 editDirector?:{name:string;provider:string;model?:string;choice:'claude'|'codex'|'agent'};
 /** Runtime records of the edit director (read-only): who really ran each turn and the last turn-limit stop. */
 authoring?:{executions?:EditorExecution[];lastStop?:EditorStop;continuations?:number;
  /** Set by the runtime when the director/model changed while blocked/paused: Resume starts a new plan (not the old checkpoint). */
  restartPending?:{at:string;reason?:string}|boolean};
 /** 'motion' when requested motion could not be delivered: the dialog offers the explicit 'accept-basic-edit' choice. */
 blockReason?:'motion'|'provider-limit';
 /** Wait for a provider usage limit (host-owned facts): since, reset only when the provider sent it, what is kept and what is left. */
 providerWait?:ProviderWaitView;
 /** Camera + screen pair of this edit (both exact sources, offset, voice, layout, how the offset was obtained). */
 sourcePair?:{offsetSeconds:number;voice:'camera'|'screen';layout:'camera-corner'|'screen-full'|'alternate';hash:string;sync:{origin:'measured'|'manual';verified:boolean;driftSeconds?:number}};
 scriptGate?:number;scriptOptions?:ScriptOptions;scriptVersions?:ScriptVersion[];scriptApproval?:ScriptApproval;script?:Omit<ScriptVersion,'version'|'hash'|'source'|'createdAt'>;
 /** Server-computed: the latest version is approved and its Notion card is confirmed. */
 recordingReady?:boolean;
 /** F02: checklist and B-roll/material notes for the approved script version/hash (ignored when they differ). */
 recordingPrep?:{version:number;hash:string;checklist:Partial<Record<'framing'|'light'|'audio'|'product',boolean>>;suggestions?:Array<{id:string;sceneIndex:number;kind:'broll'|'material';text:string}>;updatedAt:string};
 /** Local cover gate (covers-review). */
 /** B05: speech captions burned into the video under review (video-review). `captionStyles` is sent only in that stage. */
 captions?:ProductionCaptions;captionStyles?:Array<{id:'classic'|'boxed'|'highlight';label:string}>;
 covers?:ProductionCovers;coverFormats?:Array<{id:string;label:string;width:number;height:number}>;providers?:{source:ProductionProvider|string;editor:ProductionProvider|string;publisher:ProductionProvider|string};timeZone:string;videoJobId?:string;outputVideo?:PublicationMedia;approvedVideo?:PublicationMedia;
 /** Localized visual adjustment in progress/done (host-owned) and the bounded history that allows going back. */
 localAdjust?:{id:string;window:{start:number;end:number};request:string;epoch:number;status:'planning'|'rendering'|'done'|'canceled';preview?:{sha256:string;start:number;duration:number}};
 localAdjustments?:Array<{id:string;window:{start:number;end:number};request:string;status:'applied'|'canceled'|'reverted';output?:PublicationMedia;base?:{outputVideo:PublicationMedia};proof?:{sameAudio?:boolean;timelineCompatible?:boolean;error?:string};at:string}>;
 reviewDeliveries?:PublicationDelivery[];reviewHash?:string;platforms?:string[];step?:{output:string;phase:string;budgetKey?:string;callId?:string};
 /** Absent on productions created before budgets existed: their earlier usage was not measured. */
 budget?:ProductionBudget;budgetStop?:ProductionBudgetStop;
 schedule?:{plannedAt:string;timeZone:string;targets:ScheduleTarget[]};scheduleHash?:string;events?:Array<{action:string;detail:string;at:string}>;updatedAt:string;
}
export interface ProviderWaitView {providerId:string;label:string;kind:'quota'|'rate-limit';since:string;resetsAt:string|null;generation:number;sent:boolean;stage:string;done:string[];remaining:string[];evidence?:{source:string;value:string;at:string}}
/** One edit-director turn as recorded by the runtime. `model` = reported by the provider (null when not reported). */
export interface EditorExecution {index:number;kind:'initial'|'continuation';continuation:number;legacy?:boolean;providerId:string|null;requestedModel:string|null;model:string|null;executionId?:string|null;outcome:'completed'|'failed'|'turn_limit';code?:string|null;numTurns?:number|null;maxTurns?:number|null;callsBefore?:number|null;callsAfter?:number|null;revisionBefore?:number|null;revisionAfter?:number|null;startedAt?:string;at:string}
export interface EditorStop {code:string;numTurns:number|null;maxTurns:number|null;callsAtStart?:number|null;calls:number|null;callsLeft:number|null;revision:number|null;finalized?:boolean;reason?:string;continuable:boolean;continuationsUsed?:number;maxContinuations?:number;at:string}
export interface ScheduleTarget {platform:string;provider:'zernio'|'publora';accountId:string;networkSettings?:PublicationDelivery['networkSettings']}
export const productionStageLabel=(stage:string,pt=true):string=>({writing:pt?'Estruturando roteiro':'Structuring script','script-review':pt?'Aguardando aprovação do roteiro':'Waiting for script approval',notion:pt?'Registrando no Notion':'Saving to Notion',recording:pt?'Aguardando gravação':'Waiting for recording','planning-edit':pt?'Editor preparando o plano':'Editor preparing the plan',editing:pt?'Editando vídeo':'Editing video','video-review':pt?'Aguardando aprovação do vídeo':'Waiting for video approval',platforms:pt?'Escolher plataformas':'Choose platforms','preparing-package':pt?'Preparando legendas':'Preparing captions','generating-cover':pt?'Gerando capas':'Generating covers','covers-review':pt?'Escolher capas':'Choose covers','package-review':pt?'Aguardando aprovação do pacote':'Waiting for package approval',schedule:pt?'Escolher horário e contas':'Choose time and accounts',scheduling:pt?'Agendando':'Scheduling',complete:pt?'Agendamentos confirmados':'Schedules confirmed',paused:pt?'Produção pausada':'Production paused',blocked:pt?'Precisa de atenção':'Needs attention',canceled:pt?'Produção cancelada':'Production canceled'}[stage]??stage);
/** Absolute local paths never reach a prompt: the chat agent gets file names and states, not disk locations. */
const withoutPaths=(text:string)=>text.replace(/[A-Za-z]:[\\/][^\s"'<>|]+/g,'[arquivo local]').replace(/(^|[\s(])\/(?:Users|home|tmp|var|private|mnt|Volumes)\/[^\s"'<>]+/g,'$1[arquivo local]');
const clip=(text:unknown,max:number)=>typeof text==='string'?withoutPaths(text).slice(0,max):undefined;
/** Explicit marker when a long text was cut: the chat must not assume it saw the whole document (the rest is never sent automatically). */
const cut=(text:unknown,max:number)=>typeof text==='string'&&text.length>max?{truncated:{shownChars:max,totalChars:text.length}}:{};
/** Name/version of the latest host-verified file of the run (the path stays with the user's receipt card, never the prompt). */
const deliveredFile=(run:ProductionRun)=>{const item=[...(run.editorSession?.messages??[])].reverse().find(message=>message.type==='message'&&message.receipts?.length);const receipt=item?.type==='message'?item.receipts?.[0]:undefined;return receipt?{name:receipt.name,version:receipt.version,verified:true,shownToUserWithPath:true}:undefined;};
/** Bounded, path-free content snapshot the chat agent can answer from (reference data, never authorization). */
export function productionChatContext(run:ProductionRun,results:readonly ChatItem[]):NonNullable<AgentSession['productionContext']>{
 const last=[...(run.events??[])].reverse().find(event=>!['recording-prep'].includes(event.action));
 const entry=run.entry?{origin:run.entry.origin,video:run.entry.video.name,context:run.entry.context.kind==='text'?clip(run.entry.context.text,6000):clip(run.notionRead?.text,6000),...cut(run.entry.context.kind==='text'?run.entry.context.text:run.notionRead?.text,6000),...(run.entry.context.kind==='notion'?{cardUrl:run.entry.context.url}:{})}:undefined;
 const script=run.script??run.scriptVersions?.at(-1);
 return {id:run.id,stage:run.stage,stageLabel:productionStageLabel(run.stage),title:clip(run.topic?.title,200),notionUrl:run.notion?.url,
  ...(entry?{entry}:{}),
  ...(script&&!entry?{script:{status:run.scriptApproval?`aprovado v${run.scriptApproval.version}`:'aguardando revisão',hook:clip(script.hook,500),cta:clip(script.cta,500),text:clip(script.text,6000),...cut(script.text,6000)}}:{}),
  ...(!entry&&run.notionRead?.text?{cardNotes:clip(run.packageNotionRead?.text??run.notionRead.text,3000),...(cut(run.packageNotionRead?.text??run.notionRead.text,3000).truncated?{cardNotesTruncated:cut(run.packageNotionRead?.text??run.notionRead.text,3000).truncated}:{})}:{}),
  materials:{editedVideo:run.approvedVideo?'aprovado':run.outputVideo?'aguardando revisão':'ainda não exportado',...(deliveredFile(run)?{deliveredFile:deliveredFile(run)}:{}),...(run.editDirector?{editDirector:`${run.editDirector.name} · ${run.editDirector.provider}${run.editDirector.model?` · ${run.editDirector.model}`:''}`}:{}),...(run.platforms?.length?{platforms:run.platforms}:{}),...(run.editPlan?.summary?{editPlan:clip(run.editPlan.summary,500)}:{})},
  ...(last?{lastDecision:{action:last.action,at:last.at,...(last.detail?{detail:clip(last.detail,300)}:{})}}:{}),
  ...(run.error?{error:clip(run.error,500)}:{}),
  recentResults:results.filter(item=>item.type==='message').slice(-5).map(item=>item.type==='message'?clip(item.content,4000)??'':''),
  deliveries:run.reviewDeliveries?.map(d=>({platform:d.platform,text:d.text,version:d.version,status:d.status}))};
}
const finishedStages=['complete','canceled'];
/** The production a content is following now: the active one, else the latest finished one. Same workspace and content only. */
export function contentRun(runs:readonly ProductionRun[],contentId:string,workspaceId:string){
 const own=runs.filter(run=>run.workspaceId===workspaceId&&run.contentId===contentId).sort((a,b)=>(b.updatedAt??'').localeCompare(a.updatedAt??''));
 return own.find(run=>!finishedStages.includes(run.stage))??own[0];
}

/**
 * Only production-owned messages may be mirrored; user history and model choices win. The main (source) conversation also
 * receives the editor/publisher results of the SAME run. A role session of the same agent as the main one is never created as
 * an extra visible chat (its results already reach the main one); an existing one keeps being updated.
 */
/** A chat without content joins a run's content only when nothing of its own would be mixed in. */
export function generalChatJoinsRun(session:AgentSession,run:ProductionRun){
 if(session.contentId)return false;
 if(session.messages.every(item=>item.id.startsWith('production:')))return true;
 return !!session.originHandoffId&&!!run.entry?.delegationJobIds?.includes(session.originHandoffId)&&session.id!==run.sourceSession.id;
}
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
   // A General chat with its own conversation is never silently turned into this content (it can be organized explicitly).
   // Only an empty/production-only chat or the specialist chat created for this run's own delegation joins the content.
   const adopt=!!old.contentId||generalChatJoinsRun(old,run);
   const latest=adopt||runs.filter(item=>[item.sourceSession.id,item.editorSession.id,item.publisherSession?.id].includes(old.id)).sort((a,b)=>(b.updatedAt??'').localeCompare(a.updatedAt??''))[0]===run;
   result[index]={...old,...(adopt?{contentId:run.contentId,topicId:run.topicId}:{}),productionContext:latest?productionContext:old.productionContext,messages:[...messages.values()],updatedAt:old.updatedAt>shadow!.updatedAt?old.updatedAt:shadow!.updatedAt};
  }
 }
 // Another chat of the SAME content (e.g. a new chat opened later) gets a read-only snapshot of that content's production:
 // no messages are copied, nothing is commanded from it, and a generic chat or another content never receives it.
 const roles=new Set(runs.flatMap(run=>[run.sourceSession.id,run.editorSession.id,run.publisherSession?.id]));
 for(let index=0;index<result.length;index++){
  const session=result[index];if(!session.contentId||roles.has(session.id))continue;
  const workspaceId=agents.find(agent=>agent.id===session.agentId)?.workspaceId,run=workspaceId?contentRun(runs,session.contentId,workspaceId):undefined;
  if(!run){if(session.productionContext?.conductedIn){const {productionContext:_drop,...rest}=session;result[index]=rest;}continue;}
  const productionContext={...productionChatContext(run,run.sourceSession.messages.filter(item=>item.id.startsWith(`production:${run.id}:`))),conductedIn:'main-session' as const};
  if(JSON.stringify(productionContext)!==JSON.stringify(session.productionContext))result[index]={...session,productionContext};
 }
 return JSON.stringify(result)===JSON.stringify(current)?current:result;
}
