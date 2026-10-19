/**
 * Edit requests made in a chat (any agent/provider) that start the REAL local edit engine of the app, with progress and
 * delivery in the same chat. The host owns the decision:
 *  - the request is the user's own SAVED message (session + message id read from the saved chat, never text sent by the
 *    renderer), classified here by deterministic rules: analysis, how-to, negation, quotes and bare attachments never
 *    authorize an edit; a polite explicit request does;
 *  - the video is the one attached to that message (or an absolute path typed in it), else the single source video of the
 *    chat's content; several candidates or none => the person chooses, nothing is guessed;
 *  - the editor is the chat's own agent when it is the video editor, else the workspace's single video editor (several =>
 *    the person chooses); the director of the edit stays the workspace choice (default Claude Code) inside the coordinator;
 *  - a durable ledger row keyed by the saved message is written BEFORE any effect; a retry, reload or double send of the same
 *    message reconciles with that row and the coordinator's job link instead of starting another run or render.
 * Nothing here publishes, schedules, resumes an old run or reads the file contents as instructions.
 */
import {createHash} from 'node:crypto';
import {inspectLocalAsset} from './editorial-local-files.mjs';
import {isSessionFenced,isContentFenced} from './content-deletion.mjs';
import {classifyEditRequest,videoPathsIn,chatVideoPattern} from './chat-edit-intent.mjs';
import {defaultVoice,overlapOf,offsetSentence,pairLayouts,pairVoices,PAIR_LIMITS} from './source-pairs.mjs';
import {syncReasonText} from './source-sync.mjs';
export {classifyEditRequest,parseTimeWindow,videoPathsIn,chatVideoPattern,CHAT_EDIT_CLASSIFIER_VERSION} from './chat-edit-intent.mjs';

const sha=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const failure=(status,message,extra={})=>Object.assign(new Error(message),{status,...extra});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const plainId=value=>typeof value==='string'&&/^[\w:.-]{1,200}$/.test(value);

// ------------------------------------------------------------------ host service

const ledgerKey=(profile,sessionId,messageId)=>sha(`chat-edit|${profile}|${sessionId}|${messageId}`).slice(0,40);
const decode=row=>row?{...JSON.parse(row.data_json),status:row.status}:null;
const title=text=>String(text??'').replace(/\s+/g,' ').trim().slice(0,80)||'Edição de vídeo';

export function createChatEditRequests(db,{getCurrentProfile,getAgents,getSessions,production,inspect=inspectLocalAsset,isVideoEditor,flowEditors,media}={}){
 db.exec('CREATE TABLE IF NOT EXISTS chat_edit_requests(profile_id TEXT NOT NULL,key TEXT NOT NULL,session_id TEXT NOT NULL,message_id TEXT NOT NULL,content_id TEXT,status TEXT NOT NULL,data_json TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(profile_id,key))');
 const read=(profile,key)=>decode(db.prepare('SELECT status,data_json FROM chat_edit_requests WHERE profile_id=? AND key=?').get(profile,key));
 const write=(profile,row)=>{row.updatedAt=new Date().toISOString();db.prepare('INSERT OR REPLACE INTO chat_edit_requests VALUES(?,?,?,?,?,?,?,?)').run(profile,row.key,row.sessionId,row.messageId,row.contentId??null,row.status,JSON.stringify(row),row.updatedAt);return row;};
 const profileCheck=profile=>{if(getCurrentProfile&&getCurrentProfile()!==profile)throw failure(409,'O perfil ativo mudou. Reabra a conversa.');};
 const inFlight=new Map(),measuring=new Map();
 /** The saved chat and the saved user message: the only source of the request. Fences are checked every time. */
 const bound=(profile,sessionId,messageId)=>{
  profileCheck(profile);
  if(isSessionFenced(db,profile,sessionId))throw failure(410,'Esta conversa foi excluída (ou está sendo excluída com o conteúdo). Nada foi iniciado.');
  const session=(getSessions?.(profile)??[]).find(item=>item.id===sessionId);
  if(!session)throw failure(404,'Conversa não encontrada. Nada foi iniciado.');
  if(session.contentId&&isContentFenced(db,profile,session.contentId))throw failure(410,'O conteúdo desta conversa foi excluído. Nada foi iniciado.');
  const agent=(getAgents?.(profile)??[]).find(item=>item.id===session.agentId);
  if(!agent)throw failure(409,'O agente desta conversa não existe mais.');
  const message=(session.messages??[]).find(item=>item?.id===messageId&&item.type==='message'&&item.role==='user');
  if(!message||typeof message.content!=='string')throw failure(409,'A mensagem do pedido não está salva nesta conversa. Envie de novo.');
  return {session,agent,message};
 };
 const editorsOf=(profile,agent)=>{const agents=(getAgents?.(profile)??[]).filter(item=>item.workspaceId===agent.workspaceId&&isVideoEditor?.(profile,item));const preferred=flowEditors?.(profile,agent.workspaceId)??[];const ranked=agents.filter(item=>preferred.includes(item.id));return ranked.length?ranked:agents;};
 /** Candidate videos of the request, in order: attached to the message, typed in it, else the content's source videos. */
 const candidatesOf=(profile,session,message)=>{
  const attached=(Array.isArray(message.attachments)?message.attachments:[]).filter(item=>item?.kind==='video'&&typeof item.path==='string'&&chatVideoPattern.test(item.path)).map(item=>({kind:'path',path:item.path,name:String(item.name??item.path.split(/[\\/]/).pop()).slice(0,200),...(['camera','screen'].includes(item.role)?{role:item.role}:{})}));
  const typed=videoPathsIn(message.content).map(path=>({kind:'path',path,name:path.split(/[\\/]/).pop()}));
  const direct=[...new Map([...attached,...typed].map(item=>[item.path.toLowerCase(),item])).values()];
  if(direct.length)return {origin:'message',items:direct};
  if(!session.contentId)return {origin:'none',items:[]};
  const row=db.prepare('SELECT state_json FROM editorial_state WHERE profile_id=?').get(profile),state=row?JSON.parse(row.state_json):{};
  const content=(state.contents??[]).find(item=>item.id===session.contentId);
  const items=(state.assets??[]).filter(asset=>asset.contentId===session.contentId&&asset.workspaceId===content?.workspaceId&&asset.kind==='video'&&asset.role==='source'&&asset.status==='available').map(asset=>{const version=asset.versions?.find(item=>item.id===asset.currentVersionId);return version?{kind:'asset',assetId:asset.id,versionId:version.id,sha256:version.sha256,path:version.path,name:asset.name}:null;}).filter(Boolean);
  return {origin:'content',items};
 };
 const choiceId=item=>item.kind==='asset'?`asset:${item.assetId}:${item.versionId}`:`path:${sha(item.path.toLowerCase()).slice(0,24)}`;
 const contextHash=({session,agent,message})=>sha({session:{id:session.id,agentId:session.agentId,providerId:session.providerId,contentId:session.contentId},agent,message:{id:message.id,content:message.content,attachments:message.attachments??[],...(message.sourcePair?{sourcePair:message.sourcePair}:{})}});
 /**
  * Camera + screen pair of a saved message: roles are the person's explicit choice on each attachment (never inferred from
  * order or name). Only when roles are present: exactly two videos, one camera and one screen. null = single-video request.
  */
 const pairOf=message=>{
  const videos=(Array.isArray(message.attachments)?message.attachments:[]).filter(item=>item?.kind==='video'&&typeof item.path==='string'&&chatVideoPattern.test(item.path));
  if(!videos.some(item=>item.role!==undefined))return null;
  const camera=videos.filter(item=>item.role==='camera'),screen=videos.filter(item=>item.role==='screen');
  if(videos.length!==2||camera.length!==1||screen.length!==1)throw failure(409,'Para editar câmera + tela, anexe exatamente dois vídeos e marque um como Câmera e o outro como Tela. Nada foi iniciado.');
  if(camera[0].path.toLowerCase()===screen[0].path.toLowerCase())throw failure(409,'Câmera e tela precisam ser dois arquivos diferentes. Nada foi iniciado.');
  const options=message.sourcePair&&typeof message.sourcePair==='object'?message.sourcePair:{};
  if(options.voice!==undefined&&!pairVoices.includes(options.voice))throw failure(409,'Fonte de voz inválida.');
  if(options.layout!==undefined&&!pairLayouts.includes(options.layout))throw failure(409,'Layout inválido.');
  const name=item=>String(item.name??item.path.split(/[\\/]/).pop()).slice(0,200);
  return {camera:{path:camera[0].path,name:name(camera[0])},screen:{path:screen[0].path,name:name(screen[0])},voice:options.voice,layout:options.layout??'camera-corner'};
 };
 const view=row=>row&&{key:row.key,sessionId:row.sessionId,messageId:row.messageId,kind:row.kind,status:row.status,...(row.pair?{pair:row.pair}:{}),...(row.sync?{sync:row.sync}:{}),...(row.adjustId?{adjustId:row.adjustId}:{}),...(row.runId?{runId:row.runId}:{}),...(row.contentId?{contentId:row.contentId}:{}),...(row.editor?{editor:row.editor}:{}),...(row.video?{video:{name:row.video.name}}:{}),...(row.window?{window:row.window}:{}),...(row.choices?{choices:row.choices}:{}),...(row.editors?{editors:row.editors}:{}),...(row.options?{options:row.options}:{}),...(row.error?{error:row.error}:{}),...(row.reason?{reason:row.reason}:{}),updatedAt:row.updatedAt};

 /** Run of this chat to adjust: the run it conducts, else the run of its content (same workspace). Never a global "last run". */
 const runFor=(profile,session,agent)=>{
  const runs=(production.list?.(profile)??[]).filter(run=>run.workspaceId===agent.workspaceId&&!['complete','canceled'].includes(run.stage));
  const matches=runs.filter(run=>session.contentId?run.contentId===session.contentId:[run.sourceSession?.id,run.editorSession?.id].includes(session.id));
  if(matches.length>1)throw failure(409,'Esta conversa tem mais de um vídeo editado. Abra o conteúdo do vídeo que deseja ajustar e faça o pedido nele.');
  return matches[0];
 };

 async function admitEdit(profile,input,row,{session,agent,message}){
  const pair=pairOf(message);
  if(pair)return admitPair(profile,input,row,{session,agent,message},pair);
  const pool=candidatesOf(profile,session,message);
  let video;
  if(input.choice!==undefined){video=pool.items.find(item=>choiceId(item)===input.choice);if(!video)throw failure(409,'Este vídeo não é uma das opções desta mensagem. Escolha de novo.');}
  else if(pool.items.length===1)video=pool.items[0];
  else if(pool.items.length>1)return write(profile,{...row,status:'needs-choice',choices:pool.items.map(item=>({id:choiceId(item),name:item.name})).slice(0,12),reason:pool.origin==='message'?'several-attached':'several-in-content'});
  else return write(profile,{...row,status:'needs-video',reason:session.contentId?'content-has-no-video':'no-video'});
  const editors=agent&&isVideoEditor?.(profile,agent)?[agent]:editorsOf(profile,agent);
  let editor;
  if(input.editorAgentId!==undefined){editor=editors.find(item=>item.id===input.editorAgentId);if(!editor)throw failure(409,'Escolha um editor de vídeo deste espaço.');}
  else if(editors.length===1)editor=editors[0];
  else if(editors.length>1)return write(profile,{...row,status:'needs-editor',selection:{...row.selection,choice:choiceId(video)},editors:editors.map(item=>({id:item.id,name:item.name})).slice(0,12),video:{name:video.name}});
  else return write(profile,{...row,status:'refused',reason:'no-editor',error:'Não há agente editor de vídeo neste espaço. Crie um ou associe um editor ao fluxo; nada foi iniciado.'});
  const jobId=`chat-edit-${row.key}`;
  const snapshot={context:contextHash({session,agent,message}),video:structuredClone(video),editor:sha(editor),director:sha(production.editDirector?.(profile,agent.workspaceId)??null)};
  if(row.snapshot&&sha(row.snapshot)!==sha(snapshot))throw failure(409,'O pedido, vídeo, editor ou diretor mudou desde a admissão. Envie um novo pedido.');
  const validate=()=>{
   const live=bound(profile,input.sessionId,input.messageId),selected=candidatesOf(profile,live.session,live.message).items.find(item=>choiceId(item)===choiceId(video));
   const liveEditor=(getAgents?.(profile)??[]).find(item=>item.id===editor.id);
   if(contextHash(live)!==snapshot.context||!selected||sha(selected)!==sha(snapshot.video)||sha(liveEditor)!==snapshot.editor||sha(production.editDirector?.(profile,agent.workspaceId)??null)!==snapshot.director)throw failure(409,'O pedido, vídeo, editor ou diretor mudou durante a verificação. Nada foi iniciado.');
  };
  // Durable admission BEFORE any effect: a crash from here on is reconciled by the job link (no second run).
  write(profile,{...row,status:'admitted',jobId,snapshot,editor:{id:editor.id,name:editor.name},video:{name:video.name}});
  const file=await inspect(video.path);
  validate();
  if(file.status!=='available'||file.kind!=='video')throw failure(422,file.error||'O vídeo anexado não pôde ser verificado (arquivo ausente ou não é vídeo). Nada foi iniciado.');
  if(video.kind==='asset'&&file.sha256!==video.sha256)throw failure(409,'O vídeo do conteúdo mudou no disco. Confira a versão atual; nada foi iniciado.');
  const verified=read(profile,row.key)?.verifiedSha256??row.verifiedSha256;
  if(verified&&verified!==file.sha256)throw failure(409,'O vídeo mudou desde a admissão deste pedido. Envie uma nova mensagem.');
  write(profile,{...read(profile,row.key),verifiedSha256:file.sha256});
  const instructions=`${message.content.trim()}\n\n(Pedido feito diretamente no chat de ${agent.name}; vídeo: ${video.name}.)`;
  const run=await production.startDelegatedEdit(profile,{jobId,sourceAgentId:agent.id,sourceSessionId:session.id,targetAgentId:editor.id,...(editor.id===agent.id?{targetSessionId:`chat-editor-${row.key}`}:{}),contentId:session.contentId,title:title(message.content),instructions,videoPath:file.path,expectedSha256:file.sha256,admission:{kind:'chat',sessionId:session.id,messageId:message.id,validate}});
  bound(profile,input.sessionId,input.messageId);
  return write(profile,{...read(profile,row.key)??row,status:'started',jobId,runId:run.id,contentId:run.contentId,editor:{id:editor.id,name:editor.name},video:{name:video.name},error:undefined,reason:undefined});
 }
 /**
  * Camera + screen admission: both files verified (sha256, before/after every await), the offset measured locally from their
  * common audio or set manually by the person (then marked not verified), then ONE startDelegatedEdit that creates content,
  * both assets, the pair and the run atomically. Inconclusive/drift/no common audio => 'needs-sync' with the reason.
  */
 async function admitPair(profile,input,row,{session,agent,message},pair){
  if(!media?.probeLocal||!media?.measurePair)throw failure(503,'O motor local de mídia não está disponível para câmera + tela.');
  const editors=agent&&isVideoEditor?.(profile,agent)?[agent]:editorsOf(profile,agent);
  let editor;
  if(input.editorAgentId!==undefined){editor=editors.find(item=>item.id===input.editorAgentId);if(!editor)throw failure(409,'Escolha um editor de vídeo deste espaço.');}
  else if(editors.length===1)editor=editors[0];
  else if(editors.length>1)return write(profile,{...row,status:'needs-editor',editors:editors.map(item=>({id:item.id,name:item.name})).slice(0,12),pair:{camera:{name:pair.camera.name},screen:{name:pair.screen.name},layout:pair.layout}});
  else return write(profile,{...row,status:'refused',reason:'no-editor',error:'Não há agente editor de vídeo neste espaço. Crie um ou associe um editor ao fluxo; nada foi iniciado.'});
  const jobId=`chat-edit-${row.key}`,context=contextHash({session,agent,message});
  const snapshot={context,pair:{camera:pair.camera.path.toLowerCase(),screen:pair.screen.path.toLowerCase(),voice:pair.voice??null,layout:pair.layout},editor:sha(editor),director:sha(production.editDirector?.(profile,agent.workspaceId)??null)};
  if(row.snapshot&&sha(row.snapshot)!==sha(snapshot))throw failure(409,'O pedido, os vídeos, o editor ou o diretor mudaram desde a admissão. Envie um novo pedido.');
  const validate=()=>{
   const live=bound(profile,input.sessionId,input.messageId),livePair=pairOf(live.message),liveEditor=(getAgents?.(profile)??[]).find(item=>item.id===editor.id);
   if(contextHash(live)!==context||!livePair||livePair.camera.path.toLowerCase()!==snapshot.pair.camera||livePair.screen.path.toLowerCase()!==snapshot.pair.screen||sha(liveEditor)!==snapshot.editor||sha(production.editDirector?.(profile,agent.workspaceId)??null)!==snapshot.director)throw failure(409,'O pedido, os vídeos, o editor ou o diretor mudaram durante a verificação. Nada foi iniciado.');
  };
  const summary={camera:{name:pair.camera.name},screen:{name:pair.screen.name},layout:pair.layout};
  write(profile,{...row,status:'admitted',jobId,snapshot,editor:{id:editor.id,name:editor.name},pair:summary});
  const camera=await inspect(pair.camera.path);validate();const screen=await inspect(pair.screen.path);validate();
  for(const [file,label] of [[camera,'da câmera'],[screen,'da tela']])if(file.status!=='available'||file.kind!=='video')throw failure(422,file.error||`O vídeo ${label} não pôde ser verificado (arquivo ausente ou não é vídeo). Nada foi iniciado.`);
  if(camera.sha256===screen.sha256)throw failure(409,'Câmera e tela são o mesmo arquivo. Anexe as duas gravações diferentes. Nada foi iniciado.');
  const prior=read(profile,row.key)??row;
  if(prior.verifiedSha256&&prior.verifiedSha256!==camera.sha256||prior.verifiedScreenSha256&&prior.verifiedScreenSha256!==screen.sha256)throw failure(409,'Um dos vídeos mudou desde a admissão deste pedido. Envie uma nova mensagem.');
  write(profile,{...prior,verifiedSha256:camera.sha256,verifiedScreenSha256:screen.sha256});
  const [cameraMeta,screenMeta]=[await media.probeLocal(camera.path),await media.probeLocal(screen.path)];validate();
  const voice=pair.voice??defaultVoice({cameraHasAudio:cameraMeta.hasAudio,screenHasAudio:screenMeta.hasAudio});
  if(pair.voice==='camera'&&!cameraMeta.hasAudio&&screenMeta.hasAudio||pair.voice==='screen'&&!screenMeta.hasAudio)throw failure(409,`A ${pair.voice==='camera'?'câmera':'tela'} não tem áudio; escolha a outra fonte de voz. Nada foi iniciado.`);
  const facts={camera:{name:pair.camera.name,duration:cameraMeta.duration,hasAudio:cameraMeta.hasAudio,sha256:camera.sha256.slice(0,12)},screen:{name:pair.screen.name,duration:screenMeta.duration,hasAudio:screenMeta.hasAudio,sha256:screen.sha256.slice(0,12)},voice,layout:pair.layout};
  let sync;
  if(input.sync!==undefined){
   // The person's own offset (with or without common audio): accepted, shown as NOT verified, never labeled synchronized.
   const measured=prior.measurement?.key===`${camera.sha256}|${screen.sha256}`?prior.measurement.result:null;
   sync={origin:'manual',verified:false,offsetSeconds:input.sync.offsetSeconds,...(Number.isFinite(measured?.driftSeconds)?{driftSeconds:measured.driftSeconds}:{}),...(measured?.status&&measured.status!=='measured'?{reason:measured.reason??measured.status}:{})};
  }else{
   const key=`${camera.sha256}|${screen.sha256}`;let result=prior.measurement?.key===key?prior.measurement.result:null;
   if(!result){
    const controller=new AbortController();measuring.set(row.key,controller);write(profile,{...read(profile,row.key),status:'measuring',pair:{...summary,voice},facts});
    try{result=await media.measurePair({camera:{path:camera.path,duration:cameraMeta.duration,hasAudio:cameraMeta.hasAudio},screen:{path:screen.path,duration:screenMeta.duration,hasAudio:screenMeta.hasAudio}},{signal:controller.signal});}
    catch(error){if(controller.signal.aborted)throw failure(409,'Medição do atraso cancelada. Nada foi iniciado.',{reason:'canceled'});throw error;}
    finally{if(measuring.get(row.key)===controller)measuring.delete(row.key);}
    validate();write(profile,{...read(profile,row.key),measurement:{key,result,at:new Date().toISOString()}});
   }
   if(result.status!=='measured')return write(profile,{...read(profile,row.key),status:'needs-sync',pair:{...summary,voice},facts,sync:{status:result.status,reason:result.reason,text:syncReasonText[result.reason]??'Não foi possível medir o atraso com segurança.',...(Number.isFinite(result.candidateOffset)?{candidateOffset:result.candidateOffset}:{}),...(Number.isFinite(result.offsetSeconds)?{candidateOffset:result.offsetSeconds}:{}),...(Number.isFinite(result.driftSeconds)?{driftSeconds:result.driftSeconds,spanSeconds:result.spanSeconds}:{})},error:undefined});
   sync={origin:'measured',verified:true,offsetSeconds:result.offsetSeconds,driftSeconds:result.driftSeconds,score:result.score,measuredAt:new Date().toISOString()};
  }
  const overlap=overlapOf({cameraDuration:cameraMeta.duration,screenDuration:screenMeta.duration,offsetSeconds:sync.offsetSeconds});
  if(overlap.seconds<PAIR_LIMITS.minOverlapSeconds)return write(profile,{...read(profile,row.key),status:'needs-sync',pair:{...summary,voice},facts,sync:{status:'no-overlap',reason:'no-overlap',text:`Com esse atraso (${offsetSentence(sync.offsetSeconds)}) as gravações não se sobrepõem. Confira o atraso.`},error:undefined});
  const instructions=`${message.content.trim()}

(Pedido feito diretamente no chat de ${agent.name}; câmera: ${pair.camera.name}; tela: ${pair.screen.name}.)`;
  const run=await production.startDelegatedEdit(profile,{jobId,sourceAgentId:agent.id,sourceSessionId:session.id,targetAgentId:editor.id,...(editor.id===agent.id?{targetSessionId:`chat-editor-${row.key}`}:{}),contentId:session.contentId,title:title(message.content),instructions,videoPath:camera.path,expectedSha256:camera.sha256,screenPath:screen.path,expectedScreenSha256:screen.sha256,pair:{offsetSeconds:sync.offsetSeconds,voice,layout:pair.layout,sync},admission:{kind:'chat',sessionId:session.id,messageId:message.id,validate}});
  bound(profile,input.sessionId,input.messageId);
  return write(profile,{...read(profile,row.key)??row,status:'started',jobId,runId:run.id,contentId:run.contentId,editor:{id:editor.id,name:editor.name},pair:{...summary,voice},facts,sync:{status:sync.origin,offsetSeconds:sync.offsetSeconds,text:offsetSentence(sync.offsetSeconds),verified:sync.verified,...(Number.isFinite(sync.driftSeconds)?{driftSeconds:sync.driftSeconds}:{})},error:undefined,reason:undefined});
 }
 async function admitAdjust(profile,input,row,{session,agent,message},intent){
  const run=row.commandInput?production.get(profile,row.commandInput.id):runFor(profile,session,agent);
  if(run&&(run.workspaceId!==agent.workspaceId||session.contentId&&run.contentId!==session.contentId||!session.contentId&&![run.sourceSession?.id,run.editorSession?.id].includes(session.id)))throw failure(409,'O ajuste salvo não pertence a esta conversa/conteúdo.');
  if(!run)return write(profile,{...row,status:'refused',reason:'no-edited-video',error:'Esta conversa ainda não tem um vídeo editado pelo app para ajustar. Peça a edição primeiro.'});
  const window=intent.window;
  const requestId=`chat-adjust-${row.key}${input.window?`-${sha(input.window).slice(0,8)}`:''}`;
  write(profile,{...row,status:'admitted',runId:run.id,contentId:run.contentId,window,adjustId:requestId});
  try{
   const latest=production.get(profile,run.id);
   if(!row.commandInput&&latest.stage!=='video-review'&&!latest.localAdjust)throw failure(409,['planning-edit','editing'].includes(latest.stage)?'A versão atual ainda está sendo produzida. Aguarde a entrega e peça o ajuste em seguida.':'Esta produção não está com um vídeo em revisão para ajustar.');
   const snapshot=contextHash({session,agent,message});
   const validate=()=>{if(contextHash(bound(profile,input.sessionId,input.messageId))!==snapshot)throw failure(409,'O pedido salvo mudou durante a verificação. Peça o ajuste de novo.');};
   const commandInput=row.commandInput??{id:run.id,revision:latest.revision,action:'local-adjust',requestId,authorize:true,window,request:message.content.trim().slice(0,2000),base:{outputSha256:latest.outputVideo?.sha256,planHash:latest.editPlan?.planHash}};
   write(profile,{...read(profile,row.key),commandInput});
   const result=await production.command(profile,commandInput,validate);
   bound(profile,input.sessionId,input.messageId);
   return write(profile,{...read(profile,row.key)??row,status:'started',runId:result.id,contentId:result.contentId,window,error:undefined,options:undefined});
  }catch(error){
   if(error.patchOptions)return write(profile,{...read(profile,row.key)??row,status:'needs-window',window,options:error.patchOptions,error:error.message});
   throw error;
  }
 }
 /**
  * Starts (or reconciles) the work of one saved user message. input: {sessionId,messageId,choice?,editorAgentId?,window?}.
  * Same message + same payload = same row (no second run); a different payload on a finished row is refused.
  */
 async function admit(profile,input={}){
  if(!plainId(input.sessionId)||!plainId(input.messageId)||input.requestId!==undefined&&!uuid.test(input.requestId))throw failure(400,'Pedido inválido.');
  if(input.window!==undefined&&!(input.window&&Number.isFinite(input.window.start)&&Number.isFinite(input.window.end)))throw failure(400,'Intervalo inválido.');
  if(input.sync!==undefined&&!(input.sync&&Number.isFinite(input.sync.offsetSeconds)&&Math.abs(input.sync.offsetSeconds)<=PAIR_LIMITS.maxOffsetSeconds&&Object.keys(input.sync).every(key=>key==='offsetSeconds')))throw failure(400,`Atraso inválido: informe segundos entre −${PAIR_LIMITS.maxOffsetSeconds} e ${PAIR_LIMITS.maxOffsetSeconds}.`);
  if(input.sync!==undefined)input={...input,sync:{offsetSeconds:Math.round(input.sync.offsetSeconds*1000)/1000}};
  const context=bound(profile,input.sessionId,input.messageId),intent=classifyEditRequest(context.message.content);
  if(!['edit','adjust'].includes(intent.kind))throw failure(422,intent.kind==='ambiguous'?'Este texto não é um pedido inequívoco de edição. Use “Editar este vídeo” para iniciar.':'Esta mensagem não pede uma edição; nada foi iniciado.',{reason:intent.reason});
  const key=ledgerKey(profile,input.sessionId,input.messageId),prior=read(profile,key);
  if(input.window!==undefined&&sha(input.window)!==sha(intent.window))throw failure(409,'O intervalo precisa ser o da mensagem salva. Selecione um trecho em uma nova mensagem.');
  input={...(prior?.selection??{}),...input};
  const payload={choice:input.choice??null,editorAgentId:input.editorAgentId??null,window:input.window??null,...(input.sync!==undefined?{sync:input.sync}:{})};
  const signature=sha({content:context.message.content,attachments:context.message.attachments??[],kind:intent.kind,...payload});
  if(prior){
   if(prior.contextHash&&prior.contextHash!==contextHash(context))throw failure(409,'A mensagem ou conversa mudou desde o pedido. Envie uma nova mensagem.');
   if(prior.status==='admitted'&&prior.signature&&prior.signature!==signature)throw failure(409,'Este pedido já foi admitido com outros dados.');
   if(prior.status==='started'){if(prior.signature!==signature)throw failure(409,'Este pedido já foi iniciado com outros dados.');return view(prior);}
   // A crash after admission: the job link says whether the run exists; never a second run.
   if(prior.status==='admitted'&&prior.jobId){const run=production.linkedRun?.(profile,prior.jobId);if(run)return view(write(profile,{...prior,status:'started',runId:run.id,contentId:run.contentId}));}
  }
  const row={key,sessionId:input.sessionId,messageId:input.messageId,contentId:context.session.contentId,kind:intent.kind,classifier:1,signature,contextHash:contextHash(context),selection:Object.fromEntries(Object.entries(payload).filter(([key,value])=>value!==null&&key!=='sync')),...(prior?.snapshot?{snapshot:prior.snapshot}:{}),...(prior?.verifiedSha256?{verifiedSha256:prior.verifiedSha256}:{}),...(prior?.verifiedScreenSha256?{verifiedScreenSha256:prior.verifiedScreenSha256}:{}),...(prior?.measurement?{measurement:prior.measurement}:{}),...(prior?.commandInput?{commandInput:prior.commandInput}:{}),createdAt:prior?.createdAt??new Date().toISOString(),...(prior?.runId?{runId:prior.runId}:{})};
  try{return view(intent.kind==='edit'?await admitEdit(profile,input,row,context):await admitAdjust(profile,input,row,context,intent));}
  catch(error){
   // Fenced/deleted: nothing is written back (the ledger row of a deleted chat is purged with it).
   if(error.status!==410&&!isSessionFenced(db,profile,input.sessionId)){const current=read(profile,key);if(current&&current.status!=='started')write(profile,{...current,status:'failed',error:String(error.message).slice(0,600)});}
   throw error;
  }
 }
 // A measurement interrupted by an app restart is never shown as still running: the person retries (nothing was started).
 const settled=row=>row?.status==='measuring'&&!measuring.has(row.key)&&!inFlight.has(row.key)?{...row,status:'failed',error:'A medição do atraso foi interrompida (o app fechou). Nada foi iniciado; tente de novo.'}:row;
 function list(profile,sessionId){profileCheck(profile);return db.prepare('SELECT status,data_json FROM chat_edit_requests WHERE profile_id=? AND session_id=? ORDER BY updated_at').all(profile,String(sessionId??'')).map(decode).map(settled).map(view);}
 async function serializedAdmit(profile,input={}){
  const key=ledgerKey(profile,input.sessionId,input.messageId),pending=inFlight.get(key);
  if(pending){await pending.catch(()=>{});return serializedAdmit(profile,input);}
  const work=admit(profile,input);inFlight.set(key,work);
  try{return await work;}finally{if(inFlight.get(key)===work)inFlight.delete(key);}
 }
 /** Cancels the offset measurement of one saved message (nothing was started; the row records the cancel). */
 function cancelMeasurement(profile,{sessionId,messageId}={}){
  profileCheck(profile);const key=ledgerKey(profile,sessionId,messageId),controller=measuring.get(key);
  controller?.abort();const row=read(profile,key);
  if(row&&['measuring','needs-sync','admitted'].includes(row.status)&&!isSessionFenced(db,profile,sessionId))write(profile,{...row,status:'canceled',error:'Pedido câmera + tela cancelado por você. Nada foi iniciado.'});
  return view(read(profile,key));
 }
 /**
  * Short check preview (camera | screen side by side, both audios) of the message's verified pair at an offset. Never the
  * edit and never authority: the files are re-verified by sha256 against the admission before rendering.
  */
 async function syncPreview(profile,{sessionId,messageId,offsetSeconds}={}){
  if(!Number.isFinite(offsetSeconds)||Math.abs(offsetSeconds)>PAIR_LIMITS.maxOffsetSeconds)throw failure(400,'Atraso inválido.');
  const {message}=bound(profile,sessionId,messageId),pair=pairOf(message),row=read(profile,ledgerKey(profile,sessionId,messageId));
  if(!pair||!row?.verifiedSha256||!row.verifiedScreenSha256)throw failure(409,'Este pedido não tem um par câmera + tela verificado.');
  const [camera,screen]=[await inspect(pair.camera.path),await inspect(pair.screen.path)];bound(profile,sessionId,messageId);
  if(camera.sha256!==row.verifiedSha256||screen.sha256!==row.verifiedScreenSha256)throw failure(409,'Um dos vídeos mudou desde a verificação. Envie de novo.');
  const [cm,sm]=[await media.probeLocal(camera.path),await media.probeLocal(screen.path)];
  const overlap=overlapOf({cameraDuration:cm.duration,screenDuration:sm.duration,offsetSeconds});if(overlap.seconds<1)throw failure(409,'Com esse atraso as gravações não se sobrepõem.');
  const start=Math.min(overlap.end-Math.min(6,overlap.seconds),overlap.start+Math.min(5,overlap.seconds/4));
  const file=await media.pairPreview(profile,{camera:{path:camera.path,sha256:camera.sha256,hasAudio:cm.hasAudio},screen:{path:screen.path,sha256:screen.sha256,hasAudio:sm.hasAudio},offsetSeconds,start,duration:Math.min(6,overlap.seconds)});
  bound(profile,sessionId,messageId);return file;
 }
 return {admit:serializedAdmit,list,classify:classifyEditRequest,cancelMeasurement,syncPreview};
}
