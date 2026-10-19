import type {ProductionRun} from '../production/model';
import type {MediaJob} from '../content/model';
import type {ChatAttachment,ChatMessageItem} from './model/Chat';
import {chatVideoPattern,videoPathsIn} from '../../../chat-edit-intent.mjs';
import {providerWaitText} from '../production/providerWait.ts';

/** Host view of an edit request made in a chat (chat-edit-requests.mjs). */
export interface ChatEditRequestView {
 key?:string;sessionId:string;messageId:string;kind?:'edit'|'adjust';adjustId?:string;
 status:'pending'|'admitted'|'started'|'needs-choice'|'needs-video'|'needs-editor'|'needs-window'|'refused'|'failed'|'measuring'|'needs-sync'|'canceled';
 /** Camera + screen request: names, voice and layout as admitted; sync = how the offset stands (measured/manual or why not). */
 pair?:{camera:{name:string};screen:{name:string};voice?:'camera'|'screen';layout:'camera-corner'|'screen-full'|'alternate'};
 facts?:{camera:{name:string;duration:number;hasAudio:boolean};screen:{name:string;duration:number;hasAudio:boolean}};
 sync?:{status:string;reason?:string;text?:string;offsetSeconds?:number;candidateOffset?:number;driftSeconds?:number;spanSeconds?:number;verified?:boolean};
 runId?:string;contentId?:string;editor?:{id:string;name:string};video?:{name:string};window?:{start:number;end:number};
 choices?:Array<{id:string;name:string}>;editors?:Array<{id:string;name:string}>;options?:Array<{kind:string;start:number;end:number;label:string}>;
 error?:string;reason?:string;updatedAt?:string;
}
export type ChatEditAction='cancel-edit'|'cancel-adjust'|'revert'|'open-production'|'retry'|'resume'|'cancel-measure';
export interface ChatEditStatus {tone:'progress'|'done'|'attention'|'error';title:string;detail?:string;progress?:number;actions:ChatEditAction[]}

const fileName=(path:string)=>path.split(/[\\/]/).pop()??path;
/** Videos a user message carries: attached files and absolute paths typed in it (never file contents). */
export function messageVideos(message:Pick<ChatMessageItem,'content'|'attachments'|'contextNodes'>):ChatAttachment[]{
 const attached=(message.attachments??[]).filter(item=>item.kind==='video'&&chatVideoPattern.test(item.path));
 const context=(message.contextNodes??[]).filter(item=>item.kind==='file'&&typeof item.content==='string'&&chatVideoPattern.test(item.content)).map(item=>({kind:'video' as const,path:item.content!,name:item.label||fileName(item.content!)}));
 const typed=videoPathsIn(message.content).map((path:string)=>({kind:'video' as const,path,name:fileName(path)}));
 return [...new Map([...attached,...context,...typed].map(item=>[item.path.toLowerCase(),item])).values()];
}
export const isVideoPath=(path:string)=>chatVideoPattern.test(path);
export const attachmentOf=(path:string):ChatAttachment=>({kind:'video',path,name:fileName(path)});

/** Who really directs the edit of this run (provider/model), as the run reports it. */
export function directorText(run:ProductionRun|undefined,pt:boolean){
 const d=run?.editDirector;if(!d)return '';
 const provider=d.provider==='claude'?'Claude Code':d.provider==='codex'?'Codex':d.provider;
 return `${d.name} (${provider}${d.model?` · ${d.model}`:''})`.trim()||(pt?'editor':'editor');
}
const seconds=(value:number)=>`${Number.isInteger(value)?value.toFixed(1):value}`.replace('.',',');
export const windowText=(window?:{start:number;end:number})=>window?`${seconds(window.start)}–${seconds(window.end)} s`:'';

/** PT/EN sentence of the offset convention (screenTime = cameraTime − offset). */
export function offsetText(offset:number,pt:boolean){const value=Math.abs(offset).toFixed(2);if(Math.abs(offset)<0.0005)return pt?'Câmera e tela começam juntas.':'Camera and screen start together.';return pt?`A tela começa ${value.replace('.',',')} s ${offset>0?'depois':'antes'} da câmera.`:`The screen starts ${value} s ${offset>0?'after':'before'} the camera.`;}
const layoutText=(layout:string,pt:boolean)=>({'camera-corner':pt?'câmera no canto':'camera in the corner','screen-full':pt?'tela inteira':'full screen','alternate':pt?'alternar':'alternate'} as Record<string,string>)[layout]??layout;
/** One line about the pair of this request: roles, voice, layout and how the offset stands (never "synchronized" unless measured). */
export function pairLine(request:ChatEditRequestView|undefined,run:ProductionRun|undefined,pt:boolean){
 const pair=request?.pair;if(!pair)return '';
 const voice=(run?.sourcePair?.voice??pair.voice)==='screen'?(pt?'tela':'screen'):(pt?'câmera':'camera');
 const sync=run?.sourcePair?{offset:run.sourcePair.offsetSeconds,measured:run.sourcePair.sync.origin==='measured'}:request.sync?.offsetSeconds!==undefined&&['measured','manual'].includes(request.sync.status)?{offset:request.sync.offsetSeconds,measured:request.sync.status==='measured'}:null;
 const how=sync?` · ${offsetText(sync.offset,pt)} ${sync.measured?(pt?'(medido no áudio comum)':'(measured from the common audio)'):(pt?'(manual, não verificado pelo app)':'(manual, not verified by the app)')}`:'';
 return `${pt?'Câmera':'Camera'}: ${pair.camera.name} · ${pt?'Tela':'Screen'}: ${pair.screen.name} · ${pt?'voz':'voice'}: ${voice} · ${layoutText(pair.layout,pt)}${how}`;
}
/** What the card shows for one request: real host/run state only (never inferred from the model's text). */
export function chatEditStatus(request:ChatEditRequestView|undefined,run:ProductionRun|undefined,mediaJobs:readonly MediaJob[],pt:boolean):ChatEditStatus{
 const t=(a:string,b:string)=>pt?a:b;
 if(!request||request.status==='pending'||request.status==='admitted'&&!run)return {tone:'progress',title:request?.kind==='adjust'?t('Preparando o ajuste do trecho…','Preparing the adjustment…'):t('Verificando o vídeo e iniciando a edição…','Checking the video and starting the edit…'),actions:[]};
 if(request.status==='needs-choice')return {tone:'attention',title:t('Qual vídeo editar?','Which video should be edited?'),detail:t('Esta mensagem tem mais de um vídeo possível. Escolha um; nada foi iniciado.','This message has more than one possible video. Choose one; nothing was started.'),actions:[]};
 if(request.status==='needs-editor')return {tone:'attention',title:t('Qual editor de vídeo?','Which video editor?'),detail:t('Há mais de um editor de vídeo neste espaço. Escolha quem edita; nada foi iniciado.','There is more than one video editor in this space. Choose one; nothing was started.'),actions:[]};
 if(request.status==='needs-video')return {tone:'attention',title:t('Nenhum vídeo para editar','No video to edit'),detail:t('Anexe o vídeo (arraste para a caixa de mensagem ou use “Anexar vídeo”) e peça de novo.','Attach the video (drag it to the message box or use “Attach video”) and ask again.'),actions:[]};
 if(request.status==='needs-window')return {tone:'attention',title:t('O trecho corta uma cena ao meio','The interval cuts a scene in half'),detail:request.error,actions:[]};
 if(request.status==='measuring')return {tone:'progress',title:t('Medindo o atraso entre câmera e tela…','Measuring the camera/screen offset…'),detail:t('Pelo áudio comum das duas gravações, aqui no seu computador. Nada foi iniciado ainda.','From the common audio of both recordings, on this computer. Nothing was started yet.'),actions:['cancel-measure']};
 if(request.status==='needs-sync'){const s=request.sync,title=s?.status==='drift'?t('O atraso muda ao longo da gravação','The offset changes along the recording'):s?.status==='no-common-audio'?t('Sem áudio comum para medir o atraso','No common audio to measure the offset'):s?.status==='no-overlap'?t('As gravações não se sobrepõem','The recordings do not overlap'):t('Atraso não comprovado','Offset not proven');
  return {tone:'attention',title,detail:`${s?.text??''} ${t('Informe o atraso, confira a prévia curta e confirme; o resultado fica marcado como não verificado. Nada foi iniciado.','Enter the offset, check the short preview and confirm; the result is marked as not verified. Nothing was started.')}`.trim(),actions:['cancel-measure']};}
 if(request.status==='canceled')return {tone:'error',title:t('Pedido cancelado','Request canceled'),detail:request.error,actions:[]};
 if(request.status==='refused'||request.status==='failed')return {tone:'error',title:request.kind==='adjust'?t('Ajuste não iniciado','Adjustment not started'):t('Edição não iniciada','Edit not started'),detail:request.error,actions:request.status==='failed'?['retry']:[]};
 if(!run)return {tone:'progress',title:t('Aguardando a produção…','Waiting for the production…'),actions:[]};
 // Usage-limit wait (host facts): what is kept, what is left, reset only if the provider sent it; Resume is explicit.
 if(run.stage==='blocked'&&run.blockReason==='provider-limit'&&run.providerWait){const text=providerWaitText(run.providerWait,pt);return {tone:'attention',title:text.title,detail:`${text.since} · ${text.reset}. ${text.how}`,actions:['resume',request.kind==='adjust'?'cancel-adjust':'cancel-edit']};}
 const director=directorText(run,pt),job=run.videoJobId?mediaJobs.find(item=>item.id===run.videoJobId):undefined;
 const progress=job&&['queued','running'].includes(job.status)?Math.max(0,Math.min(100,Math.round(job.progress??0))):undefined;
 if(request.kind==='adjust'){
  const label=windowText(request.window),history=run.localAdjustments??[],entry=[...history].reverse().find(item=>item.id===request.adjustId),live=run.localAdjust?.id===request.adjustId?run.localAdjust:undefined;
  if(run.stage==='canceled')return {tone:'error',title:t('Ajuste cancelado','Adjustment canceled'),detail:t('Esta produção foi cancelada; os arquivos anteriores continuam preservados.','This production was canceled; previous files remain preserved.'),actions:[]};
  if(live?.status==='planning')return {tone:'progress',title:t(`Ajustando ${label}`,`Adjusting ${label}`),detail:t(`Direção: ${director}. A versão atual continua disponível.`,`Directed by ${director}. The current version stays available.`),actions:['cancel-adjust']};
  if(live?.status==='rendering')return {tone:'progress',title:t('Exportando a versão ajustada','Exporting the adjusted version'),detail:t('A prévia do trecho está acima; o áudio é o mesmo da versão anterior.','The window preview is above; the audio is the same as the previous version.'),progress,actions:['cancel-adjust']};
  if(entry?.status==='applied'){const current=entry.output?.sha256===run.outputVideo?.sha256;return {tone:'done',title:t(`Ajuste aplicado em ${label}`,`Adjustment applied to ${label}`),detail:entry.proof?.sameAudio?t('Áudio idêntico ao da versão anterior; fora do trecho nada mudou no plano.','Audio identical to the previous version; nothing changed outside the window in the plan.'):t('Confira o áudio antes de aprovar: a prova de áudio idêntico não foi concluída.','Check the audio before approving: identical audio was not proven.'),actions:current&&run.stage==='video-review'?['revert']:[]};}
  if(entry?.status==='reverted')return {tone:'done',title:t('Versão anterior restaurada','Previous version restored'),detail:t('Os dois arquivos continuam na biblioteca do conteúdo.','Both files stay in the content library.'),actions:[]};
  if(entry?.status==='canceled'||live?.status==='canceled')return {tone:'error',title:t('Ajuste cancelado','Adjustment canceled'),detail:t('A versão anterior continua em revisão.','The previous version stays under review.'),actions:[]};
  if(['blocked','paused'].includes(run.stage))return {tone:'attention',title:t('Ajuste parado','Adjustment stopped'),detail:run.error,actions:['open-production','cancel-adjust']};
  return {tone:'progress',title:t(`Ajustando ${label}`,`Adjusting ${label}`),actions:[]};
 }
 if(run.stage==='planning-edit')return {tone:'progress',title:t('Planejando cortes e motion','Planning cuts and motion'),detail:t(`Direção: ${director}`,`Directed by ${director}`),actions:['cancel-edit']};
 if(run.stage==='editing')return {tone:'progress',title:t('Exportando o vídeo editado','Exporting the edited video'),detail:t(`Direção: ${director}`,`Directed by ${director}`),progress,actions:['cancel-edit']};
 if(['blocked','paused'].includes(run.stage))return {tone:'attention',title:t('Edição parada','Edit stopped'),detail:run.error,actions:['open-production','cancel-edit']};
 if(run.stage==='canceled')return {tone:'error',title:t('Edição cancelada','Edit canceled'),detail:t('O original continua intacto.','The original stays untouched.'),actions:[]};
 if(run.stage==='video-review')return {tone:'done',title:t('Vídeo editado entregue','Edited video delivered'),detail:t(`O arquivo verificado está nesta conversa. Peça ajustes aqui (ex.: “Entre 12 e 18 segundos troque a animação por uma comparação”). Direção: ${director}.`,`The verified file is in this chat. Ask for changes here (e.g. “Between 12 and 18 seconds replace the animation with a comparison”). Directed by ${director}.`),actions:['open-production']};
 return {tone:'done',title:t('Edição concluída','Edit finished'),detail:director?t(`Direção: ${director}`,`Directed by ${director}`):undefined,actions:['open-production']};
}
