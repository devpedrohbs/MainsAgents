import {newEditorialId,type EditorialContent,type EditorialState,type EditorialTopic} from './model.ts';

/** A local recording container, never an approval or a Notion import. */
export function createRecordingContent(state:EditorialState,workspaceId:string,title:string){
 const clean=title.trim();if(!workspaceId||!clean||clean.length>120)throw Error('Give this recording a title (up to 120 characters).');
 const at=new Date().toISOString(),topicId=newEditorialId('topic'),content:EditorialContent={id:newEditorialId('content'),workspaceId,topicId,title:clean,format:'short-video',platforms:[],status:'planning',productionStage:'recording',taskId:newEditorialId('task'),createdAt:at,updatedAt:at};
 const topic:EditorialTopic={id:topicId,requestId:topicId,workspaceId,title:clean,inputKind:'text',input:clean,category:'Gravação',priority:'normal',status:'draft',summary:'Gravação adicionada diretamente pelo criador; roteiro e contexto ainda precisam ser associados.',whyItMatters:'Cadastro local para manter os arquivos desta gravação juntos.',angles:[],sources:[],factualQuestions:[],contentId:content.id,createdAt:at,updatedAt:at};
 return {content,state:{...state,topics:[topic,...state.topics],contents:[content,...state.contents]}};
}

/**
 * Content created from an agent chat ("Novo conteúdo"): its own content + idea in review, linked by id to one new
 * chat session. Never an approval, script or Notion import; the user approves the idea explicitly to generate a script,
 * or enters with a video already recorded.
 */
export function createSessionContent(state:EditorialState,workspaceId:string,title:string,brief=''){
 const created=createRecordingContent(state,workspaceId,title),summary=brief.trim().slice(0,2000);
 const content:EditorialContent={...created.content,productionStage:'planning'};
 const topic:EditorialTopic={...created.state.topics[0],status:'review',category:'Conteúdo',input:summary||content.title,summary:summary||`Conteúdo “${content.title}” criado na conversa do agente.`,whyItMatters:'Sessão de conteúdo: conversa, arquivos e produção próprios.'};
 return {content,topic,state:{...created.state,topics:[topic,...created.state.topics.slice(1)],contents:[content,...created.state.contents.slice(1)]}};
}
