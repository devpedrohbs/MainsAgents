import type {AgentSession} from './model/Chat';
import type {EditorialAsset} from '../content/assetModel';
import type {EditorialContent} from '../content/model';
import {productionStageLabel,type ProductionRun} from '../production/model.ts';
import {productionProgress} from '../production/productionProgress.ts';

/**
 * Content sessions: one main conversation per content inside the SAME agent. Identity is the persisted link
 * (workspace + contentId + sessionId), never the title. Every summary is derived from saved state only:
 * agent messages never advance it.
 */
export type ContentBinding =
 | {kind:'generic'}
 | {kind:'content';content:EditorialContent;run?:ProductionRun}
 | {kind:'invalid';reason:'missing-content'|'other-workspace'|'run-mismatch'};

/** Production run owned by this session: same workspace, the session is one of its role sessions and, for a content session, the same content. */
export function linkedRun(runs:readonly ProductionRun[],session:AgentSession|undefined,workspaceId:string){
 if(!session)return undefined;
 return runs.find(run=>run.workspaceId===workspaceId&&[run.sourceSession.id,run.editorSession.id,run.publisherSession?.id].includes(session.id)&&(!session.contentId||run.contentId===session.contentId));
}

export function contentBinding(session:AgentSession|undefined,{workspaceId,contents,runs}:{workspaceId:string;contents:readonly EditorialContent[];runs:readonly ProductionRun[]}):ContentBinding{
 if(!session?.contentId)return {kind:'generic'};
 const content=contents.find(item=>item.id===session.contentId);
 if(!content)return {kind:'invalid',reason:'missing-content'};
 if(content.workspaceId!==workspaceId)return {kind:'invalid',reason:'other-workspace'};
 // A run that lists this session but belongs to another content is never shown here.
 if(runs.some(run=>run.workspaceId===workspaceId&&run.contentId!==content.id&&[run.sourceSession.id,run.editorSession.id,run.publisherSession?.id].includes(session.id)))return {kind:'invalid',reason:'run-mismatch'};
 return {kind:'content',content,run:linkedRun(runs,session,workspaceId)??runs.find(run=>run.workspaceId===workspaceId&&run.contentId===content.id&&run.sourceSession.id===session.id)};
}

export interface ContentSessionSummary {
 title:string;stage:string;materials:string[];lastDecision?:string;nextAction:string;
 /** What the chat can offer next without choosing another agent. */
 next:'start'|'production'|'repair';
}

const say=(pt:boolean,ptText:string,enText:string)=>pt?ptText:enText;
const decisionLabels:Record<string,[string,string]>={
 'recorded-import':['Vídeo já gravado importado e edição autorizada','Recorded video imported and editing authorized'],
 'idea-approved':['Ideia aprovada e roteiro autorizado','Idea approved and script authorized'],
 'approve-script':['Roteiro aprovado','Script approved'],'approve-video':['Vídeo aprovado','Video approved'],'platforms':['Redes escolhidas','Networks chosen'],
 'approve-covers':['Capas aprovadas','Covers approved'],'approve-package':['Pacote aprovado','Package approved'],'schedule':['Agendamento autorizado','Scheduling authorized'],
 'revise-video':['Ajuste do vídeo pedido','Video revision requested'],'revise-package':['Novas legendas pedidas','New captions requested'],'resume':['Produção retomada','Production resumed'],'cancel':['Produção interrompida','Production stopped'],
};

/** Resume card for a content session: real materials, last recorded decision, stage and next action. */
export function contentSessionSummary(binding:ContentBinding,assets:readonly EditorialAsset[],pt=true):ContentSessionSummary|null{
 if(binding.kind==='generic')return null;
 if(binding.kind==='invalid')return {title:say(pt,'Vínculo de conteúdo inválido','Invalid content link'),stage:say(pt,'Precisa de atenção','Needs attention'),materials:[],nextAction:binding.reason==='missing-content'?say(pt,'O conteúdo desta sessão não existe mais neste perfil. A conversa continua salva; nada foi apagado.','This session’s content no longer exists in this profile. The chat stays saved; nothing was deleted.'):binding.reason==='other-workspace'?say(pt,'Esta sessão aponta para um conteúdo de outro espaço; abra-a lá.','This session points to a content in another workspace; open it there.'):say(pt,'A produção vinculada pertence a outro conteúdo. Abra-a pela sessão desse conteúdo.','The linked production belongs to another content. Open it from that content’s session.'),next:'repair'};
 const {content,run}=binding,own=assets.filter(asset=>asset.contentId===content.id&&asset.workspaceId===content.workspaceId);
 const videos=own.filter(asset=>asset.kind==='video'&&asset.role==='source'),materials:string[]=[];
 if(run?.entry?.kind==='recorded'){
  materials.push(say(pt,`Vídeo gravado: ${run.entry.video.name}`,`Recorded video: ${run.entry.video.name}`));
  const ctx=run.entry.context;materials.push(ctx.kind==='notion'?say(pt,`Card do Notion (somente leitura): ${ctx.url}`,`Notion card (read-only): ${ctx.url}`):say(pt,`Contexto colado (${ctx.text.length} caracteres)`,`Pasted context (${ctx.text.length} characters)`));
 }else{
  if(videos.length)materials.push(say(pt,`${videos.length} vídeo(s) gravado(s): ${videos.map(v=>v.name).join(', ')}`,`${videos.length} recorded video(s): ${videos.map(v=>v.name).join(', ')}`));
  if(run?.scriptApproval)materials.push(say(pt,`Roteiro aprovado v${run.scriptApproval.version}`,`Approved script v${run.scriptApproval.version}`));
  else if(run?.scriptVersions?.length)materials.push(say(pt,`Roteiro v${run.scriptVersions.at(-1)!.version} aguardando revisão`,`Script v${run.scriptVersions.at(-1)!.version} awaiting review`));
  if(run?.notion?.url)materials.push(say(pt,`Card do Notion: ${run.notion.url}`,`Notion card: ${run.notion.url}`));
 }
 if(run?.approvedVideo)materials.push(say(pt,'Vídeo editado aprovado','Edited video approved'));
 else if(run?.outputVideo)materials.push(say(pt,'Vídeo editado aguardando revisão','Edited video awaiting review'));
 if(run?.reviewDeliveries?.length)materials.push(say(pt,`Pacote: ${run.reviewDeliveries.map(d=>d.platform).join(', ')}`,`Package: ${run.reviewDeliveries.map(d=>d.platform).join(', ')}`));
 if(!run)return {title:content.title,stage:say(pt,'Sem produção iniciada','No production started'),materials,nextAction:videos.length?say(pt,'Comece pela edição do vídeo já gravado (com card ou contexto) ou gere o roteiro a partir da ideia.','Start editing the recorded video (with a card or context) or generate the script from the idea.'):say(pt,'Converse com o agente sobre este conteúdo. Quando tiver o vídeo gravado, comece pela edição; ou gere o roteiro a partir da ideia.','Chat with the agent about this content. With a recorded video, start at editing; or generate the script from the idea.'),next:'start'};
 const decision=[...(run.events??[])].reverse().find(event=>decisionLabels[event.action]);
 const progress=productionProgress(run,pt);
 return {title:content.title,stage:productionStageLabel(run.stage,pt),materials,lastDecision:decision?`${say(pt,...decisionLabels[decision.action])} · ${new Date(decision.at).toLocaleString(pt?'pt-BR':'en-US',{dateStyle:'short',timeStyle:'short'})}`:undefined,nextAction:progress.nextAction,next:'production'};
}

/** Label for the session list: content title + real stage; generic chats keep their plain row. */
export function sessionListLabel(binding:ContentBinding,pt=true){
 if(binding.kind==='generic')return null;
 if(binding.kind==='invalid')return say(pt,'Conteúdo · vínculo inválido','Content · invalid link');
 return `${say(pt,'Conteúdo','Content')} · ${binding.run?productionStageLabel(binding.run.stage,pt):say(pt,'sem produção','no production')}`;
}

/** Content link a connected/specialist child session inherits from the session that created it. */
export const childContentLink=(source:Pick<AgentSession,'contentId'|'topicId'|'contentTitle'>|undefined)=>source?.contentId?{contentId:source.contentId,topicId:source.topicId,...(source.contentTitle?{contentTitle:source.contentTitle}:{})}:undefined;
/** Active session per agent after creating one: a background child (handoff) never replaces what the user is viewing. */
export function activeAfterCreate(current:Record<string,string>,agentId:string,sessionId:string,activate=true):Record<string,string>{
 return activate||!current[agentId]?{...current,[agentId]:sessionId}:current;
}
