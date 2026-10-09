import {randomUUID} from 'node:crypto';
import {artifactHash} from './editorial-jobs.mjs';
import {validateScriptOptions,scriptPrompt} from './editorial-protocol.mjs';
import {validateEditPlan,validatePublicationPackage,parseProductionSchedule,validateSmartEditDirection,smartEditAnimations} from './production-protocol.mjs';
import {matchingWorkflowTurn} from './editorial-workflow-queue.mjs';
import {inspectLocalAsset} from './editorial-local-files.mjs';
import {runMediaProcess} from './editorial-media.mjs';
import {mkdir,rename} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {validTimeZone,validNetworkSettings} from './publication-model.mjs';
import {notionDataSourceId} from './notion-automation-policy.mjs';
import {productionPreflight} from './production-preflight.mjs';
import {initialBudget,validateBudgetLimits,reserveCall,markCall,budgetStopApplies,ensureBudget,recordUsage} from './production-budget.mjs';
import {productionRuntimeFor,providerOf,providerLabel,providerStatus,productionProviders} from './production-runtime.mjs';
import {scriptData,scriptVersion,validateScriptEdit,recordingReady,migrateScriptGate,scriptModeOf} from './production-script.mjs';
import {motionPreference,notionPageId,validateRecordedEntry,isRecordedEntry,recordedBlockedActions,recordedContextPrompt} from './production-import.mjs';
import * as thumbnailEngine from './editorial-thumbnails.mjs';
import {initialCovers,coverFormats,sameSource,validateBrandInput,validateFormat,validateDestinations,coverInputsHash,engineConcepts,galleryConcepts,migrateCoverGate} from './production-covers.mjs';
import {readFile,rm,readdir,stat as statFile,writeFile} from 'node:fs/promises';
import * as captionsModule from './editorial-captions.mjs';
import {captionsFromWords} from './production-caption-words.mjs';
import {captionStyles,captionBase,captionsCurrent,coverVideo,initialCaptions,captionVersion,captionInput,captionLanguage,validateCaptionStyle,sameRef} from './production-captions.mjs';

const stamp=()=>new Date().toISOString(),automatic=['writing','notion','planning-edit','editing','preparing-package','generating-cover','scheduling'];
const terminal=['complete','canceled'];
const material=delivery=>({platform:delivery.platform,text:delivery.text,media:delivery.media,cover:delivery.cover});
const plainSession=(agent,content,name,id)=>({id:id??`production-session-${randomUUID()}`,agentId:agent.id,providerId:agent.providerId??'codex',contentId:content.id,topicId:content.topicId,title:name.slice(0,120),messages:[],createdAt:stamp(),updatedAt:stamp()});

/** One authoritative production record per content. UI surfaces only submit decisions. */
export function createProductionCoordinator(db,{getBriefings,thumbnails=thumbnailEngine,captionEngine=captionsModule,getRuntime,getChatRuntime,getProviderStatus,getAgents,getFlows,getSessions,getCurrentProfile,getNotion,jobs,media,publications,publishing,directory,inspect=inspectLocalAsset,run=runMediaProcess,ffmpeg='ffmpeg'}={}){
 db.exec(`CREATE TABLE IF NOT EXISTS production_runs(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,workspace_id TEXT NOT NULL,content_id TEXT NOT NULL,revision INTEGER NOT NULL,data_json TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS production_commands(profile_id TEXT NOT NULL,request_id TEXT NOT NULL,signature TEXT NOT NULL,run_id TEXT NOT NULL,PRIMARY KEY(profile_id,request_id));
 CREATE TABLE IF NOT EXISTS production_authority(profile_id TEXT NOT NULL,run_id TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(profile_id,run_id));
 CREATE TABLE IF NOT EXISTS production_lease(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL,expires INTEGER NOT NULL);`);
 const owner=randomUUID();let closed=false,active,controller,activeId,recovered=false;const locks=new Set(),providerCache=new Map(),coverRenders=new Map(),captionJobs=new Map(),frameCandidates=new Map(),frameIndex=new Map(),importReads=new Map();let frameSlots=0;const frameWaiters=[];
 const own=()=>db.prepare('SELECT owner FROM production_lease WHERE id=1').get()?.owner===owner;
 const acquire=()=>{db.prepare('INSERT OR IGNORE INTO production_lease VALUES(1,?,?)').run(owner,Date.now()+30000);db.prepare('UPDATE production_lease SET owner=?,expires=? WHERE id=1 AND (owner=? OR expires<?)').run(owner,Date.now()+30000,owner,Date.now());return own();};
 const state=profile=>{const row=db.prepare('SELECT revision,state_json FROM editorial_state WHERE profile_id=?').get(profile);if(!row)throw Error('Abra um conteúdo no Estúdio.');return {revision:row.revision,state:JSON.parse(row.state_json)};};
 const saveState=(profile,value)=>db.prepare('UPDATE editorial_state SET revision=?,state_json=?,updated_at=? WHERE profile_id=?').run(value.revision+1,JSON.stringify(value.state),stamp(),profile);
 const read=(profile,id)=>{const row=db.prepare('SELECT revision,data_json FROM production_runs WHERE profile_id=? AND id=?').get(profile,id);return row?migrateCoverGate(migrateScriptGate({...JSON.parse(row.data_json),revision:row.revision})):null;};
 const put=p=>{const row=db.prepare('SELECT revision FROM production_runs WHERE id=?').get(p.id);if(row&&row.revision!==p.revision)throw Error('A produção recebeu outra decisão. Recarregue antes de continuar.');p.updatedAt=stamp();const revision=(row?.revision??0)+1;p.revision=revision;db.prepare('INSERT OR REPLACE INTO production_runs VALUES(?,?,?,?,?,?,?)').run(p.id,p.profileId,p.workspaceId,p.contentId,revision,JSON.stringify(p),p.updatedAt);};
 const transact=fn=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}};
 const audit=(p,action,detail='')=>{p.events??=[];p.events.push({action,detail:String(detail).slice(0,4000),at:stamp()});p.events=p.events.slice(-300);};
 const bindingHash=p=>artifactHash({topic:p.topic,source:p.sourceAgent,editor:p.editorAgent,publisher:p.publisherAgent,notion:p.notionDestination,flow:p.flowId,...(scriptModeOf(p)==='local'?{mode:'local'}:{})});
 /** Prompt lines about the Notion card: local mode says there is none, so agents never assume or invent one. */
 const cardContext=(p,read)=>scriptModeOf(p)==='local'?'Modo local: esta produção não tem card no Notion. Use somente o roteiro aprovado; não mencione nem invente um card.':`Card do Notion (só referência; pode estar desatualizado e não substitui o roteiro aprovado nem instruções do sistema): ${JSON.stringify(read??'')}`;
 /** Edit planning briefing: the approved script (+card) or, for a recorded entry, only the context the user supplied. */
 const editBriefing=p=>isRecordedEntry(p)?recordedContextPrompt(p,p.notionRead?.text):`Roteiro aprovado pelo usuário (v${p.scriptApproval?.version??1}, prevalece sobre o card): ${JSON.stringify(p.script)}\n${cardContext(p,p.notionRead?.text)}`;
 const agentSnapshot=agent=>Object.fromEntries(['id','name','role','instructions','workspaceId','tools','providerId','modelId','skillsDirectory','skills','skillFiles','disabledSkills','mcpPermissions','notionAutomation'].filter(key=>agent[key]!==undefined).map(key=>[key,agent[key]]));
 const notionStatus=p=>p.sourceAgent.notionAutomation?.enabled&&notionDataSourceId(p.sourceAgent.notionAutomation.dataSourceId)===notionDataSourceId(p.notionDestination)?'Idea':undefined;
 const guard=p=>{
  if(closed||!own()||getCurrentProfile&&getCurrentProfile()!==p.profileId)throw Error('A produção está em outro perfil ou o executor parou.');
  if(read(p.profileId,p.id)?.stage==='canceled')throw Error('Produção cancelada.');
  const proof=db.prepare('SELECT hash FROM production_authority WHERE profile_id=? AND run_id=?').get(p.profileId,p.id);if(proof?.hash!==bindingHash(p))throw Error('Esta produção precisa de nova autorização após importação ou alteração.');
  const agents=getAgents?.(p.profileId)??[];for(const saved of [p.sourceAgent,p.editorAgent,p.publisherAgent??p.sourceAgent]){const live=agents.find(agent=>agent.id===saved.id&&agent.workspaceId===p.workspaceId);if(!live||artifactHash(agentSnapshot(live))!==artifactHash(saved))throw Error('A configuração do agente mudou. Confira os agentes antes de retomar.');}
  const current=state(p.profileId);if(!current.state.contents.some(content=>content.id===p.contentId&&content.workspaceId===p.workspaceId))throw Error('O conteúdo vinculado foi removido.');return current;
 };
 const refAsset=(p,ref,kind)=>{const value=guard(p),asset=value.state.assets?.find(a=>a.id===ref?.assetId&&a.contentId===p.contentId&&a.workspaceId===p.workspaceId),v=asset?.versions.find(v=>v.id===asset.currentVersionId);if(!asset||asset.status!=='available'||v?.id!==ref.versionId||v.sha256!==ref.sha256||kind&&asset.kind!==kind)throw Error('Uma versão de arquivo mudou. Revise o material atual.');return {asset,v};};
 const fileRef=asset=>({assetId:asset.id,versionId:asset.currentVersionId,sha256:asset.versions.find(v=>v.id===asset.currentVersionId).sha256});
 const verifyRef=async(p,ref,kind)=>{const {asset,v}=refAsset(p,ref,kind),actual=await inspect(v.path);refAsset(p,ref,kind);if(actual.status!=='available'||actual.sha256!==v.sha256)throw Error('O arquivo mudou no disco. Verifique e aprove a nova versão.');return {asset,v,actual};};
 const setStage=(p,stage)=>{p.stage=stage;p.error=undefined;audit(p,stage);put(p);};
 const message=(p,role,content,{editor=false,publisher=false,image}={})=>{const session=publisher?(p.publisherSession??p.sourceSession):editor?p.editorSession:p.sourceSession,id=`production:${p.id}:${p.epoch}:${p.stage}:${role}`;session.messages=session.messages.filter(m=>m.id!==id);session.messages.push({id,type:'message',role:'agent',content,createdAt:stamp(),deliveryState:'completed',...(image?{images:[image]}:{})});session.updatedAt=stamp();};
 const resetStep=p=>{delete p.step;};
 /** Automatic edit: the editor agent only chooses bounded parameters and overlay texts; FFmpeg detects and cuts, Remotion animates. */
 const planSmartEdit=async p=>{
  const ref={contentId:p.contentId,...p.inputVideo},caps=await media.capabilities(),language=String(p.language??'pt-BR').slice(0,2).toLowerCase()==='en'?'en':'pt';
  const intensity=motionPreference(p.editPreferences.motion),motionWanted=caps.animate&&typeof media.motion==='function'&&intensity!=='off';
  let spoken='';
  if(caps.transcribe&&p.videoMetadata?.hasAudio){try{const {transcript}=await media.transcribe(p.profileId,{...ref,language});guard(p);spoken=transcript.noSpeech?'':transcript.segments.map(item=>`[${item.start.toFixed(1)}s] ${item.text}`).join('\n').slice(0,8000);}catch(error){if(/canceled|cancelad|profile|perfil|changed|mudou/i.test(error.message))throw error;audit(p,'transcription-failed',error.message);}}
  const prompt=`Prepare a direção de uma edição AUTOMÁTICA deste vídeo. Você é o especialista configurado, use suas skills. Não execute comandos, não edite arquivos e não publique. O executor local detecta silêncios com FFmpeg, remove-os com margem para proteger a fala e ${caps.animate?'aplica animações fixas (título de entrada, tarja de identificação e CTA final) com Remotion':'não tem animações disponíveis agora (deixe os textos vazios)'}.\nMetadata: ${JSON.stringify(p.videoMetadata)}\n${editBriefing(p)}\nTranscrição local da gravação (Whisper; pode conter erros de reconhecimento, use apenas como referência do que foi falado): ${spoken?JSON.stringify(spoken):'indisponível'}\nFeedback: ${p.feedback??''}\n${motionWanted?'O executor também aplica motion dinâmico (aproximações, texto animado e cartões com tela dividida) nos momentos de ênfase que ele MEDE na voz; você pode indicar até 6 frases-chave curtas, copiadas literalmente da transcrição, para virar cartões/textos (frases que não foram ditas são ignoradas).\n':''}Retorne SOMENTE JSON: {"removeSilences":true,"silence":{"thresholdDb":-35,"minDuration":0.6,"padding":0.2},"normalizeAudio":true,"theme":"dark","animations":{"title":"título curto (até 80) ou vazio","lowerThird":{"name":"nome (até 60) ou vazio","role":"função ou vazio"},"cta":"chamada final curta ou vazio"},${motionWanted?'"highlights":["frase-chave dita no vídeo (até 60)"],':''}"summary":"o que será feito"}. Limites: thresholdDb -60..-20, minDuration 0.3..5, padding 0.05..0.6. Use somente informações do roteiro/card; não invente nomes.`;
  const step=await ai(p,p.editorAgent,prompt),direction=validateSmartEditDirection(step.output,{animate:caps.animate});
  const {analysis}=await media.analyze(p.profileId,{...ref,options:direction.silence,...(spoken?{transcript:'local',language}:{})});guard(p);
  const retakes=analysis.candidates.filter(item=>item.kind==='possibleRetake').slice(0,50).map(({start,end,label})=>({start,end,label}));
  const segments=direction.removeSilences&&analysis.suggestedSegments.length?analysis.suggestedSegments:[{start:0,end:analysis.metadata.duration}];
  const expected=segments.reduce((sum,item)=>sum+item.end-item.start,0);
  const animations=smartEditAnimations(direction,expected);let motion,motionSummary='',motionNote='';
  // Motion: words + voice emphasis measured on this recording, placed on the edited timeline. A failure keeps the edit without motion.
  if(motionWanted){try{const result=await media.motion(p.profileId,{...ref,segments,intensity,highlights:direction.highlights,language,reserved:animations.map(item=>({start:item.start,end:item.start+item.duration}))});guard(p);motion=result.motion;motionSummary=result.summary;}catch(error){if(/canceled|cancelad|profile|perfil|changed|mudou/i.test(error.message))throw error;audit(p,'motion-failed',error.message);motionNote=`motion não aplicado (${error.message.slice(0,160)})`;}}
  const preview=await media.plan(p.profileId,{...ref,plan:{segments,animations,format:p.editPreferences.format,normalizeAudio:direction.normalizeAudio,theme:direction.theme,...(motion?.cues.length?{motion}:{})}});guard(p);
  const removed=preview.removed.reduce((sum,item)=>sum+item.end-item.start,0);
  p.editPlan={mode:'smart',plan:preview.plan,planHash:preview.planHash,outputDuration:preview.outputDuration,sourceDuration:preview.sourceDuration,removedSeconds:Math.round(removed*10)/10,cuts:preview.removed.length,limitations:analysis.limitations,possibleRetakes:retakes,transcribed:Boolean(analysis.transcript),summary:direction.summary,...(motionSummary?{motionSummary}:{})};
  const notes=[analysis.limitations.includes('noAudio')?'o vídeo não tem áudio, então não há silêncios para cortar':'',analysis.limitations.includes('allSilent')?'o áudio parece todo silencioso; mantive o vídeo inteiro':'',!caps.animate&&Object.keys(direction.animations).length===0?'animações indisponíveis neste computador':'',!analysis.transcript?'transcrição local indisponível':'',retakes.length?`${retakes.length} possível(is) retomada(s)/repetição(ões) em ${retakes.map(item=>`${item.start.toFixed(1)}s`).slice(0,8).join(', ')} — mantidas no vídeo; revise se quiser cortar`:'',motionNote].filter(Boolean);
  message(p,'plan',`Plano do Editor de Vídeo (automático): ${direction.summary}\nCortes: ${p.editPlan.cuts} trecho(s) de silêncio, ${p.editPlan.removedSeconds}s removidos (${preview.sourceDuration.toFixed(1)}s → ${preview.outputDuration.toFixed(1)}s).\nAnimações: ${preview.plan.animations.map(item=>item.kind).join(', ')||'nenhuma'}.${motionSummary?`\nMotion ${motionSummary}`:''}${notes.length?`\nObservações: ${notes.join('; ')}.`:''}\nVou exportar localmente e devolver o arquivo para revisão.`,{editor:true});resetStep(p);setStage(p,'editing');
 };
 const rtFor=(p,agent=p.sourceAgent)=>{const id=providerOf(agent);if(!productionProviders.includes(id))throw Error(`O agente “${agent.name}” usa ${providerLabel(id)}, que não executa produções.`);const runtime=productionRuntimeFor(id,{getRuntime,getChatRuntime});if(!runtime)throw Error(id==='claude'?'Claude Code indisponível neste app. Esta etapa usa o agente Claude configurado e não troca de provedor; conecte o Claude Code CLI e retome.':'Conecte o Codex CLI para continuar esta produção.');return runtime;};
 // Local sign-in check (no inference) before reserving budget: a signed-out CLI never consumes an attempt.
 const checkAuth=async id=>{if(!getProviderStatus||id!=='claude')return;let value;try{value=await getProviderStatus(id);}catch{return;}providerCache.set(id,value);if(value?.state==='login-required')throw Error('Claude Code está instalado, mas sem login. Rode “claude auth login” e retome; nada foi enviado.');if(value?.state==='not-installed')throw Error('Claude Code CLI não encontrado neste PC. Instale-o e retome; nada foi enviado.');};
 async function ai(p,agent,prompt,{image=false}={}){
  const rt=rtFor(p,agent);guard(p);const step=p.step??{id:`${p.id}-${p.stage}-${p.epoch}`,attempt:1,phase:'queued',prompt,output:'',images:[],providerId:rt.providerId};p.step=step;
  if(step.providerId&&step.providerId!==rt.providerId)throw Error('O provedor desta etapa mudou. Confira os agentes antes de retomar.');step.providerId=rt.providerId;
  // A provider without reconciliation (Claude CLI) gets a fresh session per attempt; an uncertain session is never reused.
  const fresh=()=>{step.attempt++;step.phase='queued';step.output='';step.images=[];delete step.executionId;if(!rt.capabilities.reconcile)delete step.threadId;p.resend=false;};
  if(step.prompt!==prompt)throw Error('A entrada desta etapa mudou. Inicie uma nova revisão.');
  if(step.phase==='done'&&!p.resend)return step;
  if(step.phase==='done'&&p.resend){fresh();put(p);}
  if(['sending','streaming'].includes(step.phase)){
   const thread=rt.capabilities.reconcile?await rt.readThread(step.threadId):null;guard(p);const turn=thread?matchingWorkflowTurn(step,thread):undefined;
   if(turn?.status==='completed'){step.output=(turn.items??[]).filter(x=>x.type==='agentMessage').at(-1)?.text??'';for(const item of turn.items??[]){const event=rt.imageFromItem?.(item,turn.id);if(event?.type==='image.completed'&&!step.images.some(x=>x.id===event.image.id))step.images.push(event.image);}markCall(p,step.callId,'completed',stamp());step.phase='done';put(p);return step;}
   if(turn?.status==='inProgress'||thread?.status?.type==='active')throw Error('O turno anterior ainda está ativo. Consulte novamente após terminar.');
   markCall(p,step.callId,'uncertain',stamp());
   if(!p.resend)throw Error(thread?'Não foi possível confirmar o turno anterior. Autorize explicitamente o reenvio para usar mais tokens.':`${providerLabel(rt.providerId)} não permite conferir o turno interrompido. Revise a conversa e autorize explicitamente o reenvio para usar mais tokens.`);
   fresh();
  }
  await checkAuth(rt.providerId);
  if(!step.threadId){step.phase='creating-thread';put(p);step.threadId=await rt.createSession(agent);guard(p);step.phase='thread-ready';put(p);}else await rt.resumeSession(step.threadId,agent);
  const thread=rt.capabilities.reconcile?await rt.readThread(step.threadId):null;if(thread?.status?.type==='active')throw Error('A sessão da etapa já tem um turno ativo.');
  guard(p);step.budgetKey=`${step.id}:${artifactHash(prompt).slice(0,16)}`;
  // Reserve durably before dispatch: a crash after this point counts the call, never refunds it.
  const call=reserveCall(p,{key:step.budgetKey,stage:p.stage,attempt:step.attempt},stamp());step.callId=call.id;step.phase='sending';put(p);
  let execution;try{execution=await rt.send(step.threadId,`[MainsAgents work ${step.id} attempt ${step.attempt}]\n${prompt}`,agent);}catch(error){markCall(p,call.id,'uncertain',stamp());throw error;}
  markCall(p,call.id,'sent',stamp());step.executionId=execution.executionId;step.phase='streaming';put(p);
  let completed=false,last=0,failed=false;try{for await(const event of rt.events(step.executionId,controller.signal)){
   if(closed||controller.signal.aborted)throw Error('Etapa interrompida.');
   // B11: usage the Claude CLI itself reported for THIS execution; first report wins, counts/limits untouched.
   if(event.type==='usage.reported'&&rt.providerId==='claude'&&(event.executionId===undefined||event.executionId===step.executionId))recordUsage(p,call.id,event.usage,stamp());
   if(event.type==='message.delta')step.output+=event.delta;
   if(event.type==='message.completed')step.output=event.content;
   if(event.type==='image.completed'&&!step.images.some(x=>x.id===event.image.id))step.images.push(event.image);
   if(event.type==='image.failed')throw Error(event.message);
   if(step.output.length>500000)throw Error('A resposta excedeu o limite de armazenamento.');
   if(event.type==='execution.failed'){failed=true;throw Error(event.message);}if(event.type==='execution.cancelled')throw Error('Etapa cancelada.');if(event.type==='execution.completed')completed=true;
   if(Date.now()-last>200){put(p);last=Date.now();}
  }}catch(error){if(!completed)markCall(p,call.id,failed?'failed':'uncertain',stamp());if(!completed&&!failed)await rt.cancel(step.threadId,step.executionId).catch(()=>{});throw error;}
  markCall(p,call.id,completed?'completed':'uncertain',stamp());
  if(!completed||image&&!step.images.length)throw Error(image?`${providerLabel(rt.providerId)} não devolveu uma imagem real. A geração nativa pode estar indisponível nesta conta/CLI.`:'O turno terminou sem confirmação.');
  guard(p);step.phase='done';put(p);return step;
 }
 const addAsset=(p,file,role='output')=>transact(()=>{const value=guard(p);value.state.assets??=[];let asset=value.state.assets.find(a=>a.contentId===p.contentId&&a.versions.some(v=>v.sha256===file.sha256));if(!asset){const at=stamp(),v={id:randomUUID(),path:file.path,name:file.name,size:file.size,sha256:file.sha256,modifiedAt:file.modifiedAt,createdAt:at};asset={id:`asset-${randomUUID()}`,workspaceId:p.workspaceId,contentId:p.contentId,kind:file.kind,role,name:file.name,currentVersionId:v.id,versions:[v],status:'available',checkedAt:file.checkedAt,createdAt:at,updatedAt:at};value.state.assets.push(asset);}const content=value.state.contents.find(c=>c.id===p.contentId);content.assetIds=value.state.assets.filter(a=>a.contentId===p.contentId).map(a=>a.id);saveState(p.profileId,value);return asset;});
 /** Creates/edits one delivery per network with its approved caption, the approved video and the exact chosen cover. */
 const createDeliveries=(p,covers)=>{
  p.deliveries=[];for(const entry of p.package.deliveries){let value=state(p.profileId),old=value.state.publications?.find(d=>d.contentId===p.contentId&&d.platform===entry.platform);if(old?.operation||old&&old.productionId!==p.id)throw Error('Já existe uma entrega desta rede. Revise no Estúdio antes de gerar outra.');const cover=covers[entry.platform];entry.cover=cover;const receipt=publications.command(p.profileId,{revision:value.revision,action:old?'edit':'create',id:old?.id,expectedDelivery:old,contentId:p.contentId,platform:entry.platform,timeZone:p.timeZone,draft:{text:entry.caption,timeZone:p.timeZone,assetIds:[p.approvedVideo.assetId],coverAssetId:cover.assetId}});const delivery=receipt.state.publications.find(d=>d.contentId===p.contentId&&d.platform===entry.platform);value=state(p.profileId);value.state.publications.find(d=>d.id===delivery.id).productionId=p.id;saveState(p.profileId,value);p.deliveries.push(delivery.id);}
 };
 /** Logo: an available image of this content's library, verified on disk; never a path from the request. */
 const logoFor=async(p,brand)=>{if(!brand.logoAssetId)return {};const {v}=await verifyRef(p,(()=>{const asset=state(p.profileId).state.assets?.find(a=>a.id===brand.logoAssetId&&a.contentId===p.contentId&&a.workspaceId===p.workspaceId&&a.kind==='image');if(!asset)throw Error('Escolha um logo de imagem da biblioteca deste conteúdo.');return fileRef(asset);})(),'image');return {logoPath:v.path,logoSha256:v.sha256};};
 async function renderCovers(profile,id,renderId){
  const abort=new AbortController();coverRenders.set(id,abort);let p;
  try{
   p=read(profile,id);const job=p.covers.render,{v}=await verifyRef(p,coverVideo(p),'video'),logo=await logoFor(p,job.brand);
   const outputDirectory=join(directory,profile,p.id,'covers');await mkdir(outputDirectory,{recursive:true});
   let manifest;try{manifest=await thumbnails.renderThumbnailSet({source:{path:v.path,...p.covers.source},format:job.format,concepts:engineConcepts(job.concepts),brand:{theme:job.brand.theme,accent:job.brand.accent,...logo},safeAreaPreview:false,outputDirectory,signal:abort.signal});}
   catch(error){
    // Same spec already committed on disk (e.g. an earlier result discarded as late): reuse it after verifying every file hash.
    if(error?.code!=='output_exists'||typeof error.details?.batchDirectory!=='string')throw error;
    manifest=JSON.parse(await readFile(join(error.details.batchDirectory,'manifest.json'),'utf8'));
    if(manifest.schema!=='mainsagents.thumbnails/1'||!sameSource(manifest.source,p.covers.source)||manifest.format?.id!==job.format||!Array.isArray(manifest.items)||manifest.items.length!==3)throw Error('O lote de capas existente não corresponde a esta exportação.');
    for(const item of manifest.items){item.export.path=join(error.details.batchDirectory,item.export.fileName);}
   }
   if(closed)return;p=read(profile,id);
   // Late result: the run moved on, another render started or the video changed. The verified files stay on disk but are never offered.
   if(p.stage!=='covers-review'||p.covers?.render?.id!==renderId||p.covers.render.status!=='running'||!sameSource(manifest.source,coverVideo(p))||!sameSource(p.covers.source,coverVideo(p)))return;
   const items=[];for(const item of manifest.items){const file=await inspect(item.export.path);if(file.status!=='available'||file.sha256!==item.export.sha256||file.kind!=='image'||basename(item.export.path)!==item.export.fileName)throw Error('Não foi possível verificar uma capa exportada.');const asset=addAsset(p,file,'output');items.push({concept:item.concept,assetId:asset.id,versionId:asset.currentVersionId,sha256:file.sha256,width:item.export.width,height:item.export.height,warnings:item.warnings});}
   transact(()=>{const latest=read(profile,id);if(latest.covers?.render?.id!==renderId||latest.covers.render.status!=='running'||latest.stage!=='covers-review')return;latest.covers.batches={...latest.covers.batches,[job.format]:{batchId:manifest.batchId,specHash:manifest.specHash,inputsHash:job.inputsHash,format:job.format,source:{...latest.covers.source},concepts:job.concepts,brand:job.brand,items,createdAt:manifest.createdAt}};latest.covers.render={...job,status:'done',finishedAt:stamp()};audit(latest,'covers-rendered',`${job.format} · ${manifest.batchId}`);put(latest);});
  }catch(error){
   if(closed)return;
   try{transact(()=>{const latest=read(profile,id);if(latest?.covers?.render?.id!==renderId||latest.covers.render.status!=='running')return;latest.covers.render={...latest.covers.render,status:abort.signal.aborted?(closed?'interrupted':'canceled'):'failed',error:abort.signal.aborted?undefined:String(error.message).slice(0,2000),finishedAt:stamp()};put(latest);});}catch{}
  }finally{if(coverRenders.get(id)===abort)coverRenders.delete(id);}
 }
 const statusError=(status,text)=>Object.assign(Error(text),{status});
 /** One background caption job per run (transcription or burn). A late result for another base/job is discarded. */
 const captionsBusy=p=>p.captions?.transcription?.status==='running'||p.captions?.render?.status==='running';
 const settleCaptionJob=(profile,id,kind,jobId,abort,error)=>{if(closed)return;try{transact(()=>{const latest=read(profile,id),job=latest?.captions?.[kind];if(job?.id!==jobId||job.status!=='running')return;latest.captions[kind]={...job,status:abort.signal.aborted?'canceled':'failed',error:abort.signal.aborted?undefined:String(error?.message??error).slice(0,2000),finishedAt:stamp()};put(latest);});}catch{}};
 async function transcribeCaptions(profile,id,jobId){
  const abort=new AbortController();captionJobs.set(id,abort);
  try{
   const p=read(profile,id),base=p.captions.base;await verifyRef(p,base,'video');
   const {transcript}=await media.transcribe(profile,{contentId:p.contentId,...base,language:p.captions.language},{signal:abort.signal});
   if(closed||abort.signal.aborted)throw Error('Transcrição cancelada.');
   transact(()=>{const latest=read(profile,id),c=latest?.captions,job=c?.transcription;if(latest?.stage!=='video-review'||job?.id!==jobId||job.status!=='running'||!sameRef(c.base,base))return;
    // Word mode: 1–3 recognized words per caption from whisper word timings (falls back to sentences, with a warning).
    const built=job.mode==='words'?captionsFromWords(transcript.noSpeech?null:transcript,c.durationSeconds):captionEngine.captionsFromTranscript(transcript.noSpeech?null:transcript,c.durationSeconds);
    if(!built.segments.length){c.transcription={...job,status:'failed',error:'Nenhuma fala foi reconhecida neste vídeo. Escreva as legendas ou importe um SRT.',finishedAt:stamp()};put(latest);return;}
    const next=captionVersion(c,built.segments,{origin:'transcript',timing:job.mode==='words'&&!built.warnings.includes('no-word-timing')?'words':transcript.timing??'sentences',warnings:built.warnings},stamp());
    if(next){c.versions=[...c.versions,next].slice(-30);delete c.approved;}
    c.transcription={...job,status:'done',engine:`${transcript.engine??'whisper.cpp'} ${transcript.model??''}`.trim(),finishedAt:stamp()};audit(latest,'captions-transcribed',next?`v${next.version} · ${next.segments.length} legenda(s)`:'sem mudanças');put(latest);});
  }catch(error){settleCaptionJob(profile,id,'transcription',jobId,abort,error);}finally{if(captionJobs.get(id)===abort)captionJobs.delete(id);}
 }
 async function renderCaptions(profile,id,renderId){
  const abort=new AbortController();captionJobs.set(id,abort);let outputPath,srtPath,offered=false;
  try{
   let p=read(profile,id);const c=p.captions,job=c.render,version=c.versions.find(v=>v.version===job.version&&v.hash===job.hash),base=c.base;
   if(!version)throw Error('A versão aprovada das legendas não existe mais.');
   const {v}=await verifyRef(p,base,'video'),folder=join(directory,profile,p.id,'captions');await mkdir(folder,{recursive:true});
   outputPath=join(folder,`video-legendado-v${version.version}-${job.style}-${renderId.slice(0,8)}.mp4`);srtPath=outputPath.replace(/\.mp4$/,'.srt');
   let last=0;const manifest=await captionEngine.renderBurnedCaptions({source:{path:v.path,...base},segments:version.segments,styleId:job.style,outputPath,signal:abort.signal,onProgress:event=>{if(closed||Date.now()-last<700)return;last=Date.now();try{transact(()=>{const latest=read(profile,id);if(latest?.captions?.render?.id!==renderId||latest.captions.render.status!=='running')return;latest.captions.render.progress=Math.round(event.progress*100);put(latest);});}catch{}}});
   if(closed){await rm(outputPath,{force:true}).catch(()=>{});return;}p=read(profile,id);
   // Late result (canceled, another render, new base or stage moved on): the verified file is removed and never offered.
   if(p?.stage!=='video-review'||p.captions?.render?.id!==renderId||p.captions.render.status!=='running'||!sameRef(p.captions.base,base)||!captionsCurrent(p)){await rm(outputPath,{force:true});return;}
   const file=await inspect(outputPath);if(file.status!=='available'||file.kind!=='video'||file.sha256!==manifest.output.sha256)throw Error('Não foi possível verificar o vídeo legendado.');
   await writeFile(srtPath,captionEngine.captionsToSrt(version.segments),{encoding:'utf8',flag:'wx'});const srt=await inspect(srtPath);
   const asset=addAsset(p,file,'output'),srtAsset=srt.status==='available'?addAsset(p,srt,'output'):null;offered=true;
   transact(()=>{const latest=read(profile,id);if(latest?.captions?.render?.id!==renderId||latest.captions.render.status!=='running'||latest.stage!=='video-review')return;
    latest.captions.output={...fileRef(asset),version:version.version,hash:version.hash,style:job.style,...(srtAsset?{srtAssetId:srtAsset.id}:{}),audio:manifest.audio,font:manifest.font.family,engine:`${manifest.engine.id}/${manifest.engine.version}`,createdAt:stamp()};
    latest.outputVideo=fileRef(asset);latest.captions.render={...latest.captions.render,status:'done',progress:100,finishedAt:stamp()};
    message(latest,`captions-v${version.version}-${job.style}`,`Legendas de fala v${version.version} gravadas no vídeo (estilo ${job.style}): ${asset.name}\n${file.path}\n\nO vídeo sem legendas continua salvo. Confira e aprove esta versão. O SRT da mesma versão continua disponível para o CapCut.`,{editor:true});
    audit(latest,'captions-rendered',`v${version.version} · ${job.style} · ${manifest.audio}`);put(latest);});
  }catch(error){if(outputPath&&!offered&&!closed)await rm(outputPath,{force:true}).catch(()=>{});settleCaptionJob(profile,id,'render',renderId,abort,error);}
  finally{if(captionJobs.get(id)===abort)captionJobs.delete(id);}
 }
 /** Captions of the current base video; a new edit (different base) starts a fresh, empty caption history. */
 async function ensureCaptions(p,language){
  if(captionsCurrent(p)){if(language!==undefined)p.captions.language=captionLanguage(language);return p.captions;}
  const base=captionBase(p);await verifyRef(p,base,'video');const meta=(await media.inspect(p.profileId,{contentId:p.contentId,assetId:base.assetId})).metadata;
  p.captions=initialCaptions(base,meta.duration,captionLanguage(language??String(p.language??'pt-BR').slice(0,2).toLowerCase()));return p.captions;
 }
 /** Frame picker (B03): only in covers-review of the active profile; the video comes from the registered version, never a request path. */
 const frameRun=(profile,runId)=>{const p=read(profile,runId);if(!p||getCurrentProfile&&getCurrentProfile()!==profile)throw statusError(404,'Produção não encontrada.');if(p.imported)throw statusError(409,'Histórico importado não expõe quadros do vídeo.');if(p.stage!=='covers-review'||!p.covers||!coverVideo(p))throw statusError(409,'Os quadros ficam disponíveis na escolha das capas.');return p;};
 const frameSlot=signal=>new Promise((resolve,reject)=>{if(frameSlots<2){frameSlots++;resolve();return;}const waiter={resolve,reject};frameWaiters.push(waiter);signal?.addEventListener('abort',()=>{const at=frameWaiters.indexOf(waiter);if(at>=0){frameWaiters.splice(at,1);reject(statusError(499,'Prévia cancelada.'));}},{once:true});});
 const frameRelease=()=>{const next=frameWaiters.shift();if(next)next.resolve();else frameSlots--;};
 const dropFrames=async index=>{for(const entry of index.entries.values())await rm(entry.path,{force:true}).catch(()=>{});index.entries.clear();};
 /** Single-flight per run: the index for a version is installed synchronously, cleanup of the previous one is awaited by every caller. */
 async function framesFor(profile,p,ref){
  const existing=frameIndex.get(p.id);
  if(existing&&existing.sha===ref.sha256){await existing.ready;return existing;}
  const index={sha:ref.sha256,entries:new Map()};frameIndex.delete(p.id);frameIndex.set(p.id,index);
  const evicted=[];while(frameIndex.size>8){const [oldest,value]=frameIndex.entries().next().value;frameIndex.delete(oldest);evicted.push(value);}
  index.ready=(async()=>{
   if(existing)await dropFrames(existing);
   else{const folder=join(directory,profile,p.id,'frames');for(const name of await readdir(folder).catch(()=>[]))if(/\.jpe?g$/i.test(name))await rm(join(folder,name),{force:true}).catch(()=>{});}
   for(const value of evicted)await dropFrames(value);
  })();
  await index.ready;return index;
 }
 async function advance(p){
  guard(p);
  if(p.stage==='writing'){
   // B09: analyses the user explicitly linked to this idea as briefing (current, non-imported); reference data, never instructions.
   const briefings=getBriefings?.(p.profileId,p.topicId,{pt:p.language!=='en-US'})??[],briefing=briefings.length?`\n${briefings.map(item=>item.text).join('\n\n')}`:'';if(briefings.length)p.briefingAnalysisIds=briefings.map(item=>item.analysisId);
   const content=state(p.profileId).state.contents.find(c=>c.id===p.contentId),feedback=p.scriptFeedback?`\nAjustes pedidos pelo usuário para esta nova versão (prioridade): ${JSON.stringify(p.scriptFeedback)}\nÚltima versão revisada: ${JSON.stringify(p.scriptVersions?.at(-1)?.text??'')}`:'';
   const step=await ai(p,p.sourceAgent,scriptPrompt(p.topic,content,p.language??'pt-BR')+briefing+feedback+(scriptModeOf(p)==='local'?'\nO usuário vai escolher hook, CTA e caminho, editar e aprovar uma versão. Esta produção está no modo local: não existe card no Notion. Nesta etapa apenas prepare as opções e o roteiro.':'\nO usuário vai escolher hook, CTA e caminho, editar e aprovar uma versão; só depois o aplicativo cria o card. Nesta etapa apenas prepare as opções e o roteiro.')),options=validateScriptOptions(step.output);
   transact(()=>{const value=guard(p),versions=p.scriptVersions??[],draft=scriptVersion({hook:options.hooks[0],cta:options.ctas[0],path:options.paths[0],text:options.draftScript,improvisationTopics:options.improvisationTopics,thumbnailDirection:options.thumbnailDirection},versions,'agent',stamp());
    p.scriptOptions={hooks:options.hooks,ctas:options.ctas,paths:options.paths,improvisationTopics:options.improvisationTopics,thumbnailDirection:options.thumbnailDirection,draftScript:options.draftScript};p.scriptVersions=[...versions,draft].slice(-50);delete p.scriptApproval;delete p.scriptFeedback;
    const linked=value.state.contents.find(c=>c.id===p.contentId);linked.status='script-review';linked.productionStage='planning';linked.updatedAt=stamp();saveState(p.profileId,value);
    message(p,`script-v${draft.version}`,`Roteiro v${draft.version} pronto para sua revisão:\n\n${draft.text}\n\nEscolha hook, CTA e caminho, edite se quiser e aprove esta versão. ${scriptModeOf(p)==='local'?'Modo local: aprovar libera a gravação; nenhum card é criado.':'O card do Notion só é criado depois da sua aprovação.'}`);resetStep(p);setStage(p,'script-review');});
  }
  if(p.stage==='notion'){
   if(scriptModeOf(p)!=='notion')throw Error('Esta produção está no modo local. Ative o Notion explicitamente para registrar o card.');
   const approved=p.scriptApproval,latest=p.scriptVersions?.at(-1);if(!approved||latest?.hash!==approved.hash||artifactHash(p.script)!==approved.hash)throw Error('O roteiro mudou depois da aprovação. Aprove a versão atual antes de registrar no Notion.');
   if(!p.notionJobId){p.notionJobId=jobs.queueDraft(p.profileId,{contentId:p.contentId,artifactId:p.draftArtifactId,dataSourceId:p.notionDestination,productionId:p.id,notionStatus:notionStatus(p)});put(p);}
   const job=jobs.list(p.profileId).find(j=>j.id===p.notionJobId);if(job?.status==='failed')throw Error(job.error);if(job?.status!=='succeeded')return;
   if(job.artifactId!==p.draftArtifactId)throw Error('O Notion confirmou outra versão do roteiro. Revise antes de gravar.');
   p.notion={...job.result,scriptVersion:approved.version,scriptHash:approved.hash};
   // Legacy card written under the previous contract: bind it to v1, then wait for an explicit review instead of releasing recording.
   if(approved.reviewRequired){delete p.scriptApproval;message(p,'notion-legacy',`Card confirmado no Notion: ${job.result.url}

Esta produção começou antes da aprovação de roteiro. Revise e aprove a versão atual para liberar a gravação; aprovar sem alterações não cria outro card.`);setStage(p,'script-review');return;}
   transact(()=>{const value=guard(p),linked=value.state.contents.find(c=>c.id===p.contentId);linked.productionStage='ready-to-record';linked.updatedAt=stamp();saveState(p.profileId,value);});
   message(p,`notion-v${approved.version}`,`Card confirmado no Notion com o roteiro aprovado v${approved.version}: ${job.result.url}\n\nA gravação está liberada para esta versão. Quando estiver pronto, adicione o vídeo nesta produção.`);setStage(p,'recording');
  }
  if(p.stage==='planning-edit'){
   await verifyRef(p,p.inputVideo,'video');
   if(!p.videoMetadata){p.videoMetadata=(await media.inspect(p.profileId,{contentId:p.contentId,assetId:p.inputVideo.assetId})).metadata;put(p);}
   if(scriptModeOf(p)==='notion'&&p.notion&&!p.notionRead){const connector=getNotion?.();if(!connector?.readCard)throw Error('A consulta atual do card Notion está indisponível.');p.notionRead=await connector.readCard(p.notion.pageId,p.notionDestination,p.contentId);guard(p);put(p);}
   if(p.editPreferences.mode==='smart'){await planSmartEdit(p);return;}
   const prompt=`Prepare um plano de edição básica para este vídeo. Você é o especialista configurado, use suas skills. Não execute comandos, não edite diretamente arquivos e não publique. O executor local aplicará somente o plano JSON validado.\nMetadata: ${JSON.stringify(p.videoMetadata)}\n${editBriefing(p)}\nPreferências autorizadas: ${JSON.stringify(p.editPreferences)}\nFeedback: ${p.feedback??''}\nRetorne SOMENTE JSON: {"start":0,"duration":${p.videoMetadata.duration},"format":"${p.editPreferences.format}","normalizeAudio":true,"fadeSeconds":0.15,"summary":"alterações propostas"}. Preserve falas; sem informação suficiente, mantenha o intervalo inteiro. Não escolha portrait se não autorizado.`;
   const step=await ai(p,p.editorAgent,prompt);p.editPlan=validateEditPlan(step.output,p.videoMetadata,p.editPreferences);message(p,'plan',`Plano do Editor de Vídeo: ${p.editPlan.summary}. Vou executar o corte/exportação local e devolver o arquivo para revisão.`,{editor:true});resetStep(p);setStage(p,'editing');
  }
  if(p.stage==='editing'){
   await verifyRef(p,p.inputVideo,'video');
   if(!p.videoJobId){if(media.list(p.profileId).some(j=>['queued','running'].includes(j.status)))return;const value=state(p.profileId),job=p.editPlan.mode==='smart'?media.enqueue(p.profileId,{mode:'advanced',authorize:true,revision:value.revision,contentId:p.contentId,...p.inputVideo,plan:p.editPlan.plan,planHash:p.editPlan.planHash,requestKey:`production-${p.id}-${p.epoch}`}).job:media.enqueue(p.profileId,{revision:value.revision,contentId:p.contentId,...p.inputVideo,start:p.editPlan.start,duration:p.editPlan.duration,edit:{format:p.editPlan.format,normalizeAudio:p.editPlan.normalizeAudio,fadeSeconds:p.editPlan.fadeSeconds},requestKey:`production-${p.id}-${p.epoch}`}).job;p.videoJobId=job.id;put(p);}
   const job=media.list(p.profileId).find(j=>j.id===p.videoJobId);if(['failed','interrupted','canceled'].includes(job?.status))throw Error(job.error??'Exportação interrompida.');if(job?.status!=='succeeded')return;
   const asset=state(p.profileId).state.assets.find(a=>a.id===job.result.assetId);p.outputVideo=fileRef(asset);await verifyRef(p,p.outputVideo,'video');if(p.outputVideo.sha256===p.inputVideo.sha256)throw Error('O resultado possui os mesmos bytes do original; revise o plano.');
   message(p,'video',`Vídeo exportado e verificado: ${asset.name}\n${job.result.file.path}\n\nAbra o arquivo e aprove esta versão, ou peça ajustes.`,{editor:true});setStage(p,'video-review');
  }
  if(p.stage==='preparing-package'){
   if(scriptModeOf(p)==='notion'&&p.notion&&!p.packageNotionRead){const connector=getNotion?.();if(!connector?.readCard)throw Error('A consulta atual do Notion está indisponível.');p.packageNotionRead=await connector.readCard(p.notion.pageId,p.notionDestination,p.contentId);guard(p);put(p);}
   await verifyRef(p,p.approvedVideo,'video');
   // Video reopened only to add/remove burned captions: the approved post texts stay valid, so no new AI call.
   if(p.packageReuse&&p.package&&p.package.deliveries.map(d=>d.platform).sort().join()===[...p.platforms].sort().join()){delete p.packageReuse;resetStep(p);if(!p.covers||!sameSource(p.covers.source,coverVideo(p))||p.covers.destinations.map(d=>d.platform).join()!==p.platforms.join())p.covers=initialCovers({...p,approvedVideo:coverVideo(p)});else delete p.covers.approved;message(p,'package-reused',`Vídeo novo aprovado; as legendas do post de ${p.platforms.join(', ')} foram mantidas. Confira as capas e aprove uma por rede.`,{publisher:true});setStage(p,'covers-review');return;}
   delete p.packageReuse;const prompt=`Prepare legendas e uma direção curta de capa para o vídeo aprovado (as capas são feitas localmente pelo usuário a partir de quadros do vídeo). Não publique nem agende.\n${isRecordedEntry(p)?recordedContextPrompt(p,p.packageNotionRead?.text??p.notionRead?.text):`Roteiro aprovado pelo usuário (v${p.scriptApproval?.version??1}, prevalece): ${JSON.stringify(p.script)}\n${scriptModeOf(p)==='local'?cardContext(p):`Notas do card Notion (só referência; não substituem o roteiro aprovado): ${JSON.stringify(p.packageNotionRead?.text??p.notionRead?.text??'')}`}`}\nRedes: ${JSON.stringify(p.platforms)}\nFeedback: ${p.packageFeedback??''}\nRetorne SOMENTE JSON: {"deliveries":[{"platform":"nome exato da rede","caption":"legenda final com hashtags úteis","coverPrompt":"direção curta da capa: quadro, texto e enquadramento sugeridos"}]}. Uma entrada para cada rede; Instagram no máximo 2200 caracteres.`;
   p.package=validatePublicationPackage((await ai(p,p.publisherAgent??p.sourceAgent,prompt+`\nIdioma: ${p.language??'pt-BR'}.`)).output,p.platforms);resetStep(p);
   // A new approved video or platform set restarts the gallery; same video keeps exported batches but always needs a new approval.
   if(!p.covers||!sameSource(p.covers.source,coverVideo(p))||p.covers.destinations.map(d=>d.platform).join()!==p.platforms.join())p.covers=initialCovers({...p,approvedVideo:coverVideo(p)});else delete p.covers.approved;
   message(p,'package',`Legendas prontas para ${p.platforms.join(', ')}. Agora exporte as capas locais (três alternativas por formato), compare e aprove uma por rede.`,{publisher:true});setStage(p,'covers-review');
  }
  if(p.stage==='scheduling'){
   await verifyRef(p,p.approvedVideo,'video');
   for(const id of p.deliveries){guard(p);let value=state(p.profileId),delivery=value.state.publications.find(d=>d.id===id),target=p.schedule.targets.find(t=>t.platform===delivery.platform);
    if(delivery.receipt?.version===delivery.version&&delivery.status==='scheduled')continue;
    if(delivery.operation&&['uncertain','requesting'].includes(delivery.operation.phase)){if(!delivery.operation.externalId)throw Error('Envio incerto sem ID externo. Confira o provedor antes de repetir.');await publishing.reconcile(p.profileId,{id,expectedDelivery:delivery});delivery=state(p.profileId).state.publications.find(d=>d.id===id);if(delivery.status==='scheduled')continue;throw Error('O provedor ainda não confirmou este agendamento.');}
    if(artifactHash(material(delivery))!==p.approvedMaterials[id])throw Error('A legenda, capa ou vídeo mudou após aprovação. Revise o pacote novamente.');
    if(!delivery.operation){
     let receipt=publications.command(p.profileId,{revision:value.revision,action:'edit',id,expectedDelivery:delivery,contentId:p.contentId,draft:{text:delivery.text,timeZone:p.schedule.timeZone,plannedAt:p.schedule.plannedAt,assetIds:delivery.media.map(f=>f.assetId),coverAssetId:delivery.cover?.assetId,networkSettings:target.networkSettings}});delivery=receipt.state.publications.find(d=>d.id===id);
     receipt=publications.command(p.profileId,{revision:receipt.revision,action:'submit',id,contentId:p.contentId,expectedDelivery:delivery});delivery=receipt.state.publications.find(d=>d.id===id);
     receipt=publications.command(p.profileId,{revision:receipt.revision,action:'approve',id,contentId:p.contentId,expectedDelivery:delivery,notes:'Pacote e horário autorizados na produção semiautomática.'});delivery=receipt.state.publications.find(d=>d.id===id);
    }
    if(!delivery.operation||Date.parse(delivery.operation.expiresAt)<=Date.now()){await publishing.prepare(p.profileId,{id,revision:state(p.profileId).revision,expectedDelivery:delivery,provider:target.provider,accountId:target.accountId,mode:'schedule'});delivery=state(p.profileId).state.publications.find(d=>d.id===id);}
    guard(p);await publishing.execute(p.profileId,{id,expectedDelivery:delivery,authorize:true});
   }
   message(p,'scheduled',`Agendamentos confirmados para ${new Date(p.schedule.plannedAt).toLocaleString('pt-BR',{timeZone:p.schedule.timeZone})} (${p.schedule.timeZone}). Os recibos estão nas entregas e no calendário.`);setStage(p,'complete');
  }
 }
 async function drain(){for(const row of db.prepare("SELECT profile_id,id FROM production_runs ORDER BY updated_at").all()){
  if(closed||!own())return;const p=read(row.profile_id,row.id);if(!automatic.includes(p.stage)||getCurrentProfile&&getCurrentProfile()!==p.profileId)continue;
  activeId=p.id;controller=new AbortController();const timer=setTimeout(()=>controller.abort(),30*60*1000);timer.unref?.();
  try{await advance(p);}catch(error){const latest=read(p.profileId,p.id);if(latest?.revision===p.revision&&!terminal.includes(latest.stage)){p.resumeStage=p.stage;p.stage=closed||error.budgetStop?'paused':'blocked';p.error=error.message;if(error.budgetStop){p.budgetStop=error.budgetStop;audit(p,'budget-limit',p.error);}else audit(p,'blocked',p.error);put(p);}}finally{clearTimeout(timer);activeId=undefined;}
 }}
 const recover=()=>{if(recovered||!own())return;recovered=true;for(const row of db.prepare('SELECT profile_id,id FROM production_runs').all()){const p=read(row.profile_id,row.id);if(p.covers?.render?.status==='running'&&!coverRenders.has(p.id)){p.covers.render={...p.covers.render,status:'interrupted',finishedAt:stamp()};put(p);}for(const kind of ['transcription','render'])if(p.captions?.[kind]?.status==='running'&&!captionJobs.has(p.id)){p.captions[kind]={...p.captions[kind],status:'interrupted',finishedAt:stamp()};put(p);}if(automatic.includes(p.stage)){p.resumeStage=p.stage;p.stage='paused';p.error='O app fechou durante uma etapa. Retome para verificar o resultado salvo.';put(p);}}};
 const kick=()=>{if(closed||active||!own())return;active=drain().finally(()=>active=undefined);};
 const timer=setInterval(()=>{if(closed)return;if(own())db.prepare('UPDATE production_lease SET expires=? WHERE owner=?').run(Date.now()+30000,owner);else acquire();recover();kick();},800);timer.unref?.();acquire();recover();
 // Same snapshot for the read-only preflight and the start revalidation; never contacts runtime, Notion or providers.
 const providersFor=()=>{const result={};if(getChatRuntime||getProviderStatus){let chat=null;try{chat=getChatRuntime?.('claude')??null}catch{}result.claude=providerStatus('claude',{runtime:chat,status:providerCache.get('claude')});}return result;};
 const modeOf=input=>input?.scriptMode===undefined||input.scriptMode==='notion'?'notion':input.scriptMode==='local'?'local':null;
 const preflightFor=(profile,input,media)=>{
  const flow=getFlows?.(profile)?.flows?.find(f=>f.id===input.flowId),agents=getAgents?.(profile)??[],row=db.prepare('SELECT state_json FROM editorial_state WHERE profile_id=?').get(profile),topics=row?JSON.parse(row.state_json).topics??[]:[];
  // Recorded entry: the topic is the one of the session's content; the card connection is read-only (never a write check).
  const recorded=input.entry==='recorded',contents=row&&recorded?JSON.parse(row.state_json).contents??[]:[],content=recorded&&flow?contents.find(c=>c.id===input.contentId&&c.workspaceId===flow.workspaceId):undefined,entry=recorded?{kind:'recorded',context:input.context?.kind==='notion'?'notion':'text',video:!!(content&&typeof input.assetId==='string'&&(JSON.parse(row.state_json).assets??[]).some(a=>a.id===input.assetId&&a.contentId===content.id&&a.kind==='video'&&a.role==='source'&&a.status==='available'))}:undefined;
  const topic=flow&&(recorded?topics.find(t=>t.id===content?.topicId&&t.workspaceId===flow.workspaceId):topics.find(t=>t.id===input.topicId&&t.workspaceId===flow.workspaceId)),runtime=getRuntime?(()=>{try{return getRuntime()??null}catch{return null}})():undefined,pick=kind=>flow?.nodes.find(n=>n.kind===kind)?.agentId,find=id=>agents.find(a=>a.id===id&&a.workspaceId===flow?.workspaceId);
  const report=productionPreflight({flow,agents,topic,topicCurrent:recorded||input.expectedTopic===undefined||!!topic&&artifactHash(topic)===artifactHash(input.expectedTopic),notion:flow&&(recorded?entry.context==='notion':modeOf(input)==='notion')?jobs.connection(profile,flow.workspaceId):undefined,notionDestination:input.notionDestination,scriptMode:recorded?'local':modeOf(input)??'notion',entry,runtime:getRuntime?{connected:!!runtime,imageFile:!runtime||typeof runtime.imageFile==='function'}:undefined,providers:providersFor(),media,budget:input.budget},{locale:input.language});
  return {flow,report,content,topic,roles:{source:find(pick('content-agent')),editor:find(pick('video-agent')),publisher:find(pick('publishing-agent')??pick('content-agent'))}};
 };
 const commandMemo=(profile,input)=>{if(typeof input.requestId!=='string'||!input.requestId||input.requestId.length>120)throw Error('Informe uma identidade para esta decisão.');const row=db.prepare('SELECT * FROM production_commands WHERE profile_id=? AND request_id=?').get(profile,input.requestId),signature=artifactHash(input);if(row){if(row.signature!==signature)throw Error('Esta decisão já foi usada com outros dados.');return read(profile,row.run_id);}return null;};
 const recordCommand=(profile,input,p)=>db.prepare('INSERT INTO production_commands VALUES(?,?,?,?)').run(profile,input.requestId,artifactHash(input),p.id);
 return {
  list(profile){const value=db.prepare('SELECT state_json FROM editorial_state WHERE profile_id=?').get(profile),deliveries=value?JSON.parse(value.state_json).publications??[]:[];return db.prepare('SELECT id FROM production_runs WHERE profile_id=? ORDER BY updated_at DESC').all(profile).map(row=>{const p=read(profile,row.id),reviews=deliveries.filter(d=>p.deliveries?.includes(d.id));return {...p,...(p.stage==='covers-review'?{coverFormats:coverFormats()}:{}),...(p.stage==='video-review'?{captionStyles:captionStyles()}:{}),providers:{source:providerOf(p.sourceAgent),editor:providerOf(p.editorAgent),publisher:providerOf(p.publisherAgent??p.sourceAgent)},recordingReady:recordingReady(p),reviewDeliveries:reviews,reviewHash:artifactHash(Object.fromEntries(reviews.map(d=>[d.id,artifactHash(material(d))])))};});},
  authorizeDraft(row){try{const payload=JSON.parse(row.payload_json),p=read(row.profile_id,payload.productionId);guard(p);return p.stage==='notion'&&p.draftArtifactId===row.artifact_id&&p.scriptApproval?.hash===row.artifact_hash&&p.scriptVersions?.at(-1)?.hash===row.artifact_hash&&p.notionDestination===row.destination&&payload.notionStatus===notionStatus(p);}catch{return false;}},
  /** Read-only: no run, command, job, turn, Notion read or account lookup. FFmpeg is probed only when asked. */
  async preflight(profile,input={},{probeMedia=false}={}){const media=probeMedia?await this.media():undefined;if(getProviderStatus){try{providerCache.set('claude',await getProviderStatus('claude'));}catch{providerCache.delete('claude');}}return preflightFor(profile,input,media).report;},
  async media(){const value=await media.capabilities();let local;try{local=await thumbnails.getThumbnailCapabilities();}catch{local={available:false,reasons:['verificação falhou']};}return {ffmpeg:value.ffmpeg,ffprobe:value.ffprobe,thumbnails:local.available,...(local.available?{}:{thumbnailReasons:local.reasons??[]})};},
  /** Content session entry: reads ONLY the card the user chose, with the authorized connection; never searches, creates or updates cards. */
  async readImportCard(profile,input={}){
   if(getCurrentProfile&&getCurrentProfile()!==profile)throw statusError(409,'O perfil ativo mudou. Reabra o espaço.');
   const pageId=notionPageId(input.card);if(!pageId)throw statusError(400,'Cole o link ou o ID de um card do Notion (notion.so). Sem link, cole o contexto como texto.');
   const content=state(profile).state.contents.find(c=>c.id===input.contentId&&c.workspaceId===input.workspaceId);if(!content)throw statusError(404,'Conteúdo não encontrado neste espaço.');
   const config=jobs.connection(profile,content.workspaceId);if(!config?.dataSourceId)throw statusError(409,'Nenhuma base Notion autorizada neste espaço para ler o card. Cole o contexto ou o roteiro como texto.');
   const connector=getNotion?.();if(!connector?.readCard)throw statusError(503,'A leitura do Notion está indisponível agora (reconecte o Notion pelo Codex). Cole o contexto ou o roteiro como texto.');
   let read;try{read=await connector.readCard(pageId,config.dataSourceId,content.id);}catch(error){throw statusError(502,`Não foi possível ler este card: ${String(error?.message??error).slice(0,300)} Nada foi criado ou alterado no Notion. Confira o link ou cole o contexto como texto.`);}
   if(typeof read?.text!=='string'||!read.text.trim())throw statusError(502,'O card foi encontrado, mas não trouxe texto legível. Cole o contexto como texto.');
   const record={pageId,url:`https://www.notion.so/${pageId}`,dataSourceId:config.dataSourceId,text:read.text.slice(0,64000),fetchedAt:read.fetchedAt??stamp()};
   importReads.delete(`${profile}|${content.id}|${pageId}`);importReads.set(`${profile}|${content.id}|${pageId}`,record);while(importReads.size>32)importReads.delete(importReads.keys().next().value);
   return {pageId,url:record.url,chars:record.text.length,excerpt:record.text.slice(0,1200),fetchedAt:record.fetchedAt};
  },
  /** Content session entry with a video already recorded: starts at edit planning; no idea, script, approval or Notion write is created or simulated. */
  startRecorded(profile,input){
   const prior=commandMemo(profile,input);if(prior)return prior;
   if(input.authorize!==true)throw Error('Revise o vídeo e o contexto e autorize iniciar a edição.');
   const entry=validateRecordedEntry(input);if(input.timeZone!==undefined&&!validTimeZone(input.timeZone))throw Error('Escolha um fuso válido.');
   const check=preflightFor(profile,{...input,entry:'recorded'}),flow=check.flow,content=check.content,topic=check.topic,{source,editor,publisher}=check.roles;
   if(!flow||!content||!topic)throw Error('Abra a sessão de um conteúdo deste espaço e escolha o fluxo.');
   if(!check.report.ready)throw Error(check.report.blockers[0].message);
   if(input.preflightFingerprint!==undefined&&input.preflightFingerprint!==check.report.fingerprint)throw Error('A configuração mudou desde a verificação. Revise a verificação antes de iniciar.');
   const session=getSessions?.(profile)?.find(s=>s.id===input.sourceSessionId);
   if(!session||session.agentId!==source.id||session.contentId!==content.id)throw Error('Use a sessão deste conteúdo no agente de entrada do fluxo; nenhum agente ou sessão novo é criado para o vídeo.');
   const existing=this.list(profile).find(p=>p.contentId===content.id&&!terminal.includes(p.stage)&&!p.imported);
   if(existing){if(isRecordedEntry(existing)&&existing.entry.video.assetId===input.assetId)return existing;throw Error('Este conteúdo já tem uma produção em andamento. Continue por ela nesta sessão.');}
   const current=state(profile),asset=current.state.assets?.find(a=>a.id===input.assetId&&a.contentId===content.id&&a.workspaceId===flow.workspaceId&&a.kind==='video'&&a.role==='source'&&a.status==='available');
   if(!asset)throw Error('Associe o vídeo já gravado a este conteúdo antes de iniciar.');
   let read,config;
   if(entry.context.kind==='notion'){config=jobs.connection(profile,flow.workspaceId);read=importReads.get(`${profile}|${content.id}|${entry.context.pageId}`);if(!read||read.dataSourceId!==config?.dataSourceId)throw Error('Leia o card escolhido nesta sessão antes de iniciar (a leitura anterior expirou ou a base mudou).');}
   const limits=input.budget===undefined?undefined:validateBudgetLimits(input.budget);
   const p=transact(()=>{const at=stamp(),id=`production-${randomUUID()}`,value=state(profile),linked=value.state.contents.find(c=>c.id===content.id);linked.productionStage='editing';linked.updatedAt=at;saveState(profile,value);
    const video=fileRef(asset),origin=entry.context.kind;
    const p={id,profileId:profile,workspaceId:flow.workspaceId,contentId:content.id,topicId:topic.id,flowId:flow.id,name:flow.name,topic:structuredClone(topic),sourceAgent:agentSnapshot(source),editorAgent:agentSnapshot(editor),publisherAgent:agentSnapshot(publisher),sourceSession:plainSession(source,content,content.title,session.id),editorSession:plainSession(editor,content,`${content.title} · edição`),...(publisher.id!==source.id?{publisherSession:plainSession(publisher,content,`${content.title} · publicação`)}:{}),language:input.language==='en-US'?'en-US':'pt-BR',
     ...(origin==='notion'?{notionDestination:config.dataSourceId,notion:{url:read.url,pageId:read.pageId,imported:true},notionRead:{pageId:read.pageId,contentId:content.id,text:read.text,hash:read.pageId,fetchedAt:read.fetchedAt}}:{scriptMode:'local'}),
     entry:{kind:'recorded',origin,context:origin==='notion'?{kind:'notion',pageId:read.pageId,url:read.url,fetchedAt:read.fetchedAt,chars:read.text.length}:entry.context,video:{...video,name:asset.name},sessionId:session.id,authorizedAt:at},
     timeZone:input.timeZone??'America/Sao_Paulo',epoch:1,stage:'planning-edit',scriptGate:2,scriptVersions:[],inputVideo:video,editPreferences:{format:entry.format,mode:entry.editMode,motion:entry.motion},budget:initialBudget(limits,at),events:[],createdAt:at,updatedAt:at};
    audit(p,'recorded-import',`Vídeo já gravado (${asset.name}) com ${origin==='notion'?`card existente ${read.url} (somente leitura)`:'contexto colado'}. Edição autorizada agora; nenhuma ideia, roteiro, aprovação anterior ou card foi criado.`);
    message(p,'recorded-entry',`Vídeo já gravado recebido: ${asset.name}. Contexto: ${origin==='notion'?`card do Notion ${read.url} (lido, sem alterações)`:'texto colado nesta sessão'}. Vou preparar o plano de edição; você revisa o vídeo antes de aprovar.`);
    db.prepare('INSERT INTO production_authority VALUES(?,?,?)').run(profile,id,bindingHash(p));put(p);recordCommand(profile,input,p);return p;});
   kick();return p;
  },
  start(profile,input){if(input?.entry==='recorded')return this.startRecorded(profile,input);const prior=commandMemo(profile,input);if(prior)return prior;const mode=modeOf(input);if(!mode)throw Error('Escolha o modo Notion ou local.');if(input.authorize!==true)throw Error(mode==='local'?'Confirme a ideia e a geração do roteiro no modo local.':'Confirme a ideia, a geração do roteiro e o destino Notion.');if(input.timeZone!==undefined&&!validTimeZone(input.timeZone))throw Error('Escolha um fuso válido.');
   const check=preflightFor(profile,input),flow=check.flow,{source,editor,publisher}=check.roles;if(!check.report.ready)throw Error(check.report.blockers[0].message);
   if(input.preflightFingerprint!==undefined&&input.preflightFingerprint!==check.report.fingerprint)throw Error('A configuração mudou desde a verificação. Revise a verificação antes de iniciar.');
   const current=state(profile),topic=current.state.topics.find(t=>t.id===input.topicId&&t.workspaceId===flow.workspaceId),config=mode==='notion'?jobs.connection(profile,flow.workspaceId):null;
   const limits=input.budget===undefined?undefined:validateBudgetLimits(input.budget);
   const existing=this.list(profile).find(p=>p.flowId===flow.id&&p.topicId===topic.id&&!terminal.includes(p.stage)&&!p.imported);if(existing)return existing;
   const p=transact(()=>{const at=stamp(),id=`production-${randomUUID()}`,content=current.state.contents.find(c=>c.id===topic.contentId)??{id:`content-${randomUUID()}`,workspaceId:flow.workspaceId,topicId:topic.id,title:topic.title,format:'short-video',platforms:[],status:'planning',productionStage:'planning',taskId:`task-${randomUUID()}`,createdAt:at,updatedAt:at};if(!current.state.contents.some(c=>c.id===content.id))current.state.contents.unshift(content);topic.status='approved';topic.contentId=content.id;topic.updatedAt=at;saveState(profile,current);
    // Reuse only this content's session or an empty generic chat; a filled generic chat is never silently adopted.
    const sourceSession=getSessions?.(profile)?.find(s=>s.id===input.sourceSessionId&&s.agentId===source.id&&(s.contentId?s.contentId===content.id:!(s.messages??[]).some(m=>m?.type==='message'))),p={id,profileId:profile,workspaceId:flow.workspaceId,contentId:content.id,topicId:topic.id,flowId:flow.id,name:flow.name,topic:structuredClone(topic),sourceAgent:agentSnapshot(source),editorAgent:agentSnapshot(editor),publisherAgent:agentSnapshot(publisher),sourceSession:plainSession(source,content,flow.name,sourceSession?.id),editorSession:plainSession(editor,content,`${flow.name} · edição`),...(publisher.id!==source.id?{publisherSession:plainSession(publisher,content,`${flow.name} · publicação`)}:{}),language:input.language==='en-US'?'en-US':'pt-BR',...(mode==='local'?{scriptMode:'local'}:{notionDestination:config.dataSourceId}),timeZone:input.timeZone??'America/Sao_Paulo',epoch:1,stage:'writing',scriptGate:2,scriptVersions:[],budget:initialBudget(limits,at),events:[],createdAt:at,updatedAt:at};audit(p,'idea-approved',mode==='local'?'Gerar roteiro no modo local (sem Notion) autorizado.':'Gerar roteiro e criar card no Notion autorizado.');db.prepare('INSERT INTO production_authority VALUES(?,?,?)').run(profile,id,bindingHash(p));put(p);recordCommand(profile,input,p);return p;});kick();return p;
  },
  async command(profile,input){if(locks.has(input.id))throw Error('Uma decisão desta produção está em andamento.');locks.add(input.id);let after;try{
   const prior=commandMemo(profile,input);if(prior)return prior;const p=read(profile,input.id);if(!p||p.revision!==input.revision)throw Error('A produção mudou. Revise a versão atual.');
   if(input.action==='resume'){
    if(!['paused','blocked'].includes(p.stage)||input.authorize!==true)throw Error('Confira a etapa antes de retomar.');
    if(p.imported||!db.prepare('SELECT hash FROM production_authority WHERE profile_id=? AND run_id=?').get(profile,p.id))throw Error('Backup restaura histórico, não autorizações. Inicie uma nova produção com revisão da ideia e destino.');guard(p);if(budgetStopApplies(p))throw Error('O limite revisado ainda não permite continuar. Ajuste o limite antes de retomar.');delete p.budgetStop;p.resend=input.resend===true;
    if(p.resumeStage==='notion'&&p.notionJobId&&jobs.list(profile).find(j=>j.id===p.notionJobId)?.status==='failed'){p.stage='notion';put(p);jobs.retry(profile,p.notionJobId);}
    if(p.resumeStage==='editing'&&p.videoJobId&&media.list(profile).some(j=>j.id===p.videoJobId&&['failed','interrupted'].includes(j.status)))await media.retry(profile,p.videoJobId);
    p.stage=p.resumeStage;delete p.resumeStage;if(p.stage==='notion')jobs.kick();
   }else{
    guard(p);
    if(isRecordedEntry(p)&&recordedBlockedActions.includes(input.action))throw Error('Este conteúdo entrou com vídeo já gravado: roteiro, card e gravação não são refeitos aqui.');
    if(input.action==='save-script'){
     const halted=['paused','blocked'].includes(p.stage)&&['script-review','notion'].includes(p.resumeStage);
     if(!['script-review','recording'].includes(p.stage)&&!halted)throw Error('O roteiro só pode ser editado antes da gravação.');
     if(p.notionJobId&&['queued','running'].includes(jobs.list(profile).find(j=>j.id===p.notionJobId)?.status))throw Error('Aguarde a confirmação do Notion antes de editar o roteiro.');
     const latest=p.scriptVersions?.at(-1);if(!latest||input.baseVersion!==latest.version)throw Error('O roteiro mudou desde que você abriu esta versão. Revise a versão atual.');
     const data=validateScriptEdit(input,p.scriptOptions,latest);
     if(artifactHash(data)!==latest.hash){const next=scriptVersion(data,p.scriptVersions,'user',stamp());p.scriptVersions=[...p.scriptVersions,next].slice(-50);delete p.scriptApproval;delete p.recordingPrep;delete p.notionJobId;delete p.draftArtifactId;delete p.resumeStage;p.error=undefined;p.stage='script-review';
      const value=state(profile),linked=value.state.contents.find(c=>c.id===p.contentId);linked.status='script-review';linked.productionStage='planning';linked.updatedAt=stamp();saveState(profile,value);
      audit(p,'script-saved',`v${next.version}${p.notion?' · o card atual será atualizado só após nova aprovação':''}`);}
    }else if(input.action==='approve-script'){
     const latest=p.scriptVersions?.at(-1);
     if(p.scriptApproval&&latest&&p.scriptApproval.hash===latest.hash&&input.expectedHash===latest.hash&&p.stage!=='script-review')return p;
     if(p.stage!=='script-review'||input.authorize!==true||!latest||input.version!==latest.version||input.expectedHash!==latest.hash)throw Error('Revise e aprove a versão atual do roteiro.');
     const data=scriptData(latest),id=`production-script-${p.id}-v${latest.version}`;if(artifactHash(data)!==latest.hash)throw Error('A versão do roteiro está inconsistente. Salve-a novamente.');
     // The confirmed card already holds exactly this version (e.g. a legacy card or an edit reverted): no duplicate card.
     if(scriptModeOf(p)==='local'){
      // B07 local mode: the approved version/hash releases recording; no Notion job, read or card. The artifact is kept so Notion can be enabled later for this exact hash.
      const value=state(profile);if(!value.state.artifacts.some(x=>x.id===id))value.state.artifacts.unshift({id,workspaceId:p.workspaceId,contentId:p.contentId,topicId:p.topicId,type:'script-draft',version:latest.version,data,createdAt:stamp()});
      const linked=value.state.contents.find(c=>c.id===p.contentId);linked.status='script-approved';linked.productionStage='ready-to-record';linked.updatedAt=stamp();saveState(profile,value);
      p.draftArtifactId=id;p.script=data;p.scriptApproval={version:latest.version,hash:latest.hash,approvedAt:stamp()};delete p.notionJobId;resetStep(p);p.stage='recording';
      message(p,`script-approved-v${latest.version}`,`Roteiro v${latest.version} aprovado no modo local (sem Notion). A gravação está liberada para esta versão.`);}
     else if(p.notion?.scriptHash===latest.hash){const value=state(profile),linked=value.state.contents.find(c=>c.id===p.contentId);linked.status='script-approved';linked.productionStage='ready-to-record';linked.updatedAt=stamp();saveState(profile,value);p.script=data;p.scriptApproval={version:latest.version,hash:latest.hash,approvedAt:stamp()};delete p.notionJobId;resetStep(p);p.stage='recording';message(p,`script-approved-v${latest.version}`,`Roteiro v${latest.version} aprovado. O card do Notion já contém esta versão (${p.notion.url}); a gravação está liberada.`);}
     else{
     const value=state(profile);if(!value.state.artifacts.some(x=>x.id===id))value.state.artifacts.unshift({id,workspaceId:p.workspaceId,contentId:p.contentId,topicId:p.topicId,type:'script-draft',version:latest.version,data,createdAt:stamp()});
     const linked=value.state.contents.find(c=>c.id===p.contentId);linked.status='script-approved';linked.updatedAt=stamp();saveState(profile,value);
     p.draftArtifactId=id;p.script=data;p.scriptApproval={version:latest.version,hash:latest.hash,approvedAt:stamp()};delete p.notionJobId;resetStep(p);p.stage='notion';
     message(p,`script-approved-v${latest.version}`,`Roteiro v${latest.version} aprovado. Vou registrar esta versão no Notion autorizado; a gravação é liberada depois da confirmação.`);}
    }else if(input.action==='regenerate-script'){
     const halted=['paused','blocked'].includes(p.stage)&&['writing','script-review','notion'].includes(p.resumeStage);
     if(!['script-review','recording'].includes(p.stage)&&!halted||typeof input.notes!=='string'||!input.notes.trim())throw Error('Informe o que mudar no roteiro antes de gerar outra versão.');
     if(p.notionJobId&&['queued','running'].includes(jobs.list(profile).find(j=>j.id===p.notionJobId)?.status))throw Error('Aguarde a confirmação do Notion antes de gerar outra versão.');
     p.scriptFeedback=input.notes.slice(0,5000);p.epoch++;resetStep(p);delete p.scriptApproval;delete p.recordingPrep;delete p.notionJobId;delete p.draftArtifactId;delete p.resumeStage;p.error=undefined;p.stage='writing';
    }else if(input.action==='enable-notion'){
     // B07: switch a local run to Notion explicitly. Same artifact+hash+destination reuses the queued/confirmed card (idempotent job), never a duplicate.
     if(scriptModeOf(p)!=='local'||input.authorize!==true)throw Error('Confirme o destino Notion para ativar nesta produção.');
     const halted=['paused','blocked'].includes(p.stage)?p.resumeStage:p.stage;if(!['script-review','recording'].includes(halted)||['paused','blocked'].includes(p.stage))throw Error('O Notion pode ser ativado durante a revisão do roteiro ou antes de enviar a gravação.');
     const config=jobs.connection(profile,p.workspaceId);if(!config?.autoSync||!config.dataSourceId||input.notionDestination!==config.dataSourceId)throw Error('Confira e habilite o destino Notion autorizado.');
     delete p.scriptMode;p.notionDestination=config.dataSourceId;audit(p,'notion-enabled',config.dataSourceId);
     if(p.stage==='recording'&&p.scriptApproval&&p.notion?.scriptHash!==p.scriptApproval.hash){
      const value=state(profile),linked=value.state.contents.find(c=>c.id===p.contentId);linked.productionStage='planning';linked.updatedAt=stamp();saveState(profile,value);
      resetStep(p);p.stage='notion';message(p,`notion-enabled-v${p.scriptApproval.version}`,`Notion ativado. Vou registrar o roteiro aprovado v${p.scriptApproval.version} (mesmo hash) no destino autorizado; a gravação volta a ser liberada depois da confirmação.`);}
     // Re-bind the explicit authorization right after the decision is committed (same synchronous turn, before the drain loop runs).
     after=()=>db.prepare('UPDATE production_authority SET hash=? WHERE profile_id=? AND run_id=?').run(bindingHash(p),profile,p.id);
    }else if(input.action==='recording-prep'){
     // Checklist and B-roll/material notes for the approved script version; never a gate and never an AI call.
     if(p.stage!=='recording'||!recordingReady(p))throw Error('O pacote de gravação está disponível depois do roteiro aprovado e confirmado.');
     if(input.version!==p.scriptApproval.version||input.hash!==p.scriptApproval.hash)throw Error('O roteiro mudou. Reabra o pacote de gravação.');
     const prep=p.recordingPrep?.hash===input.hash&&p.recordingPrep.version===input.version?{...p.recordingPrep}:{version:input.version,hash:input.hash,checklist:{}};
     if(input.checklist!==undefined){if(!input.checklist||typeof input.checklist!=='object'||Object.entries(input.checklist).some(([k,v])=>!['framing','light','audio','product'].includes(k)||typeof v!=='boolean'))throw Error('Checklist inválido.');prep.checklist={...input.checklist};}
     if(input.suggestions!==undefined){if(!Array.isArray(input.suggestions)||input.suggestions.length>200||input.suggestions.some(x=>!x||typeof x.id!=='string'||x.id.length>60||!Number.isInteger(x.sceneIndex)||!['broll','material'].includes(x.kind)||typeof x.text!=='string'||x.text.length>1000))throw Error('Sugestões inválidas.');prep.suggestions=input.suggestions.map(({id,sceneIndex,kind,text})=>({id,sceneIndex,kind,text}));}
     p.recordingPrep={...prep,updatedAt:stamp()};
    }else if(input.action==='cover-render'){
     if(p.stage!=='covers-review'||!p.covers)throw Error('As capas são exportadas depois das legendas.');if(p.covers.render?.status==='running')throw Error('Uma exportação de capas já está em andamento. Aguarde ou cancele.');
     const format=validateFormat(input.format),brand=validateBrandInput(input.brand),{v}=await verifyRef(p,coverVideo(p),'video');
     let inputsHash;try{inputsHash=coverInputsHash({sourcePath:v.path,source:p.covers.source,format,concepts:input.concepts,brand});}catch(error){throw Error(`Revise os campos da capa: ${error.message}`);}
     const concepts=galleryConcepts(input.concepts);if(concepts.some(c=>p.covers.durationSeconds>0&&c.timestampSeconds>p.covers.durationSeconds))throw Error('O quadro escolhido está fora do vídeo aprovado.');
     if(brand.logoAssetId)await logoFor(p,brand);
     p.covers.concepts=concepts;p.covers.brand=brand;delete p.covers.approved;
     const existing=p.covers.batches?.[format];let reusable=false;
     if(existing?.inputsHash===inputsHash&&sameSource(existing.source,coverVideo(p))){try{for(const item of existing.items)await verifyRef(p,{assetId:item.assetId,versionId:item.versionId,sha256:item.sha256},'image');reusable=true;}catch{}}
     if(reusable)p.covers.render={id:randomUUID(),format,status:'done',reused:true,concepts,brand,inputsHash,startedAt:stamp(),finishedAt:stamp()};
     else{p.covers.render={id:randomUUID(),format,status:'running',concepts,brand,inputsHash,startedAt:stamp()};after=()=>void renderCovers(profile,p.id,p.covers.render.id);}
    }else if(input.action==='cover-cancel'){
     if(p.covers?.render?.status!=='running')throw Error('Não há exportação de capas em andamento.');coverRenders.get(p.id)?.abort();p.covers.render={...p.covers.render,status:'canceled',finishedAt:stamp()};
    }else if(input.action==='approve-covers'){
     if(p.stage!=='covers-review'||!p.covers||input.authorize!==true)throw Error('Compare as capas exportadas e aprove uma por rede.');if(p.covers.render?.status==='running')throw Error('Aguarde a exportação terminar antes de aprovar.');
     const destinations=validateDestinations(input.destinations,p.platforms),brand=validateBrandInput(input.brand),{v}=await verifyRef(p,coverVideo(p),'video'),chosen={};
     if(!Array.isArray(input.selections))throw Error('Escolha uma capa para cada formato.');
     for(const format of new Set(destinations.map(d=>d.format))){
      const selection=input.selections.find(s=>s?.format===format),batch=p.covers.batches?.[format];
      if(!selection||!batch||selection.batchId!==batch.batchId)throw Error('A capa escolhida não é a exportação atual deste formato. Exporte e compare novamente.');
      if(!sameSource(batch.source,coverVideo(p))||!sameSource(p.covers.source,coverVideo(p)))throw Error('O vídeo aprovado mudou depois da exportação. Exporte as capas novamente.');
      let current;try{current=coverInputsHash({sourcePath:v.path,source:p.covers.source,format,concepts:input.concepts,brand});}catch(error){throw Error(`Revise os campos da capa: ${error.message}`);}
      if(current!==batch.inputsHash)throw Error('Os campos da capa mudaram depois da exportação. Exporte novamente antes de aprovar.');
      const item=batch.items.find(i=>i.concept===selection.concept);if(!item)throw Error('Escolha uma das três capas exportadas.');
      await verifyRef(p,{assetId:item.assetId,versionId:item.versionId,sha256:item.sha256},'image');chosen[format]={format,concept:item.concept,batchId:batch.batchId,assetId:item.assetId,versionId:item.versionId,sha256:item.sha256};
     }
     const covers=Object.fromEntries(destinations.map(d=>[d.platform,{assetId:chosen[d.format].assetId,versionId:chosen[d.format].versionId,sha256:chosen[d.format].sha256}]));
     p.covers.destinations=destinations;p.covers.concepts=galleryConcepts(input.concepts);p.covers.brand=brand;p.covers.approved={selections:destinations.map(d=>({platform:d.platform,...chosen[d.format]})),approvedAt:stamp()};
     createDeliveries(p,covers);message(p,'covers-approved',`Capas aprovadas: ${destinations.map(d=>`${d.platform} (${chosen[d.format].concept})`).join(', ')}. Revise o pacote final; após sua aprovação, vou perguntar a data e as contas para agendar.`,{publisher:true});p.stage='package-review';
    }else if(input.action==='video'){
     if(p.stage!=='recording'||input.authorize!==true)throw Error('Confirme a gravação e a edição básica.');if(!recordingReady(p))throw Error('Aprove o roteiro atual e aguarde a confirmação do Notion antes de enviar a gravação.');const asset=state(profile).state.assets?.find(a=>a.id===input.assetId&&a.contentId===p.contentId&&a.kind==='video'&&a.role==='source');if(!asset)throw Error('Associe o vídeo original ao conteúdo.');p.inputVideo=fileRef(asset);await verifyRef(p,p.inputVideo,'video');p.editPreferences={format:input.format==='portrait'?'portrait':'original',mode:input.editMode==='smart'?'smart':'basic',motion:motionPreference(input.motion)};p.stage='planning-edit';
    }else if(input.action==='captions-transcribe'){
     // Local Whisper of the base (uncaptioned) video; the result is a new caption version to review, never an approval.
     if(p.stage!=='video-review'||!p.outputVideo)throw Error('As legendas de fala são revisadas junto com o vídeo, antes da aprovação.');if(captionsBusy(p))throw Error('Aguarde a tarefa de legendas em andamento ou cancele.');
     await ensureCaptions(p,input.language);const meta=(await media.inspect(profile,{contentId:p.contentId,assetId:p.captions.base.assetId})).metadata;if(!meta.hasAudio)throw Error('Este vídeo não tem áudio para transcrever. Escreva as legendas ou importe um SRT.');
     const caps=await media.capabilities();if(!caps.transcribe)throw Error(`Transcrição local indisponível${caps.transcribeReasons?.length?`: ${caps.transcribeReasons.join(' ')}`:''}. Escreva as legendas ou importe um SRT.`);
     if(input.mode!==undefined&&!['sentences','words'].includes(input.mode))throw Error('Escolha legendas por frase ou por palavra.');
     p.captions.transcription={id:randomUUID(),status:'running',...(input.mode==='words'?{mode:'words'}:{}),startedAt:stamp()};after=()=>void transcribeCaptions(profile,p.id,p.captions.transcription.id);
    }else if(input.action==='captions-save'){
     if(p.stage!=='video-review'||!p.outputVideo)throw Error('As legendas de fala são revisadas junto com o vídeo, antes da aprovação.');if(captionsBusy(p))throw Error('Aguarde a tarefa de legendas em andamento ou cancele.');
     await ensureCaptions(p);const latest=p.captions.versions.at(-1);if((latest?.version??0)!==input.baseVersion)throw Error('As legendas mudaram desde que você abriu esta versão. Revise a versão atual.');
     let data;try{data=captionInput(input,p.captions.durationSeconds);}catch(error){throw Error(`Revise as legendas: ${error.message}`);}
     const next=captionVersion(p.captions,data.segments,{origin:data.origin,timing:data.timing,warnings:data.origin==='srt'?['imported-srt']:latest?.warnings?.filter(w=>w!=='no-speech')??[]},stamp());
     if(next){p.captions.versions=[...p.captions.versions,next].slice(-30);delete p.captions.approved;audit(p,'captions-saved',`v${next.version} · ${next.origin}`);}
    }else if(input.action==='captions-approve'){
     if(p.stage!=='video-review'||!captionsCurrent(p)||input.authorize!==true)throw Error('Revise e aprove a versão atual das legendas.');const latest=p.captions.versions.at(-1),style=validateCaptionStyle(input.style);
     if(!latest||input.version!==latest.version||input.hash!==latest.hash)throw Error('Revise e aprove a versão atual das legendas.');
     p.captions.approved={version:latest.version,hash:latest.hash,style,approvedAt:stamp()};
    }else if(input.action==='captions-render'){
     if(p.stage!=='video-review'||!captionsCurrent(p)||input.authorize!==true)throw Error('Aprove as legendas antes de gravar no vídeo.');if(captionsBusy(p))throw Error('Aguarde a tarefa de legendas em andamento ou cancele.');
     const a=p.captions.approved,latest=p.captions.versions.at(-1);
     if(!a||a.hash!==latest?.hash||input.version!==a.version||input.hash!==a.hash||input.style!==a.style)throw Error('A versão ou o estilo mudou depois da aprovação. Aprove novamente.');
     await verifyRef(p,p.captions.base,'video');
     let reused=false;if(p.captions.output&&p.captions.output.hash===a.hash&&p.captions.output.style===a.style){try{await verifyRef(p,p.captions.output,'video');p.outputVideo={assetId:p.captions.output.assetId,versionId:p.captions.output.versionId,sha256:p.captions.output.sha256};p.captions.render={id:randomUUID(),status:'done',reused:true,version:a.version,hash:a.hash,style:a.style,startedAt:stamp(),finishedAt:stamp()};reused=true;}catch{delete p.captions.output;}}
     if(!reused){p.captions.render={id:randomUUID(),status:'running',version:a.version,hash:a.hash,style:a.style,progress:0,startedAt:stamp()};after=()=>void renderCaptions(profile,p.id,p.captions.render.id);}
    }else if(input.action==='captions-cancel'){
     if(!captionsBusy(p))throw Error('Não há tarefa de legendas em andamento.');captionJobs.get(p.id)?.abort();
     for(const kind of ['transcription','render'])if(p.captions[kind]?.status==='running')p.captions[kind]={...p.captions[kind],status:'canceled',finishedAt:stamp()};
    }else if(input.action==='captions-remove'){
     // Back to the uncaptioned base; the burned file stays in the library but is no longer the version to approve.
     if(p.stage!=='video-review'||!p.captions?.output||!sameRef(p.captions.output,p.outputVideo)||captionsBusy(p))throw Error('Não há vídeo legendado em revisão.');
     await verifyRef(p,p.captions.base,'video');p.outputVideo={...p.captions.base};delete p.captions.output;
    }else if(input.action==='reopen-video'){
     // Reopen the approved video only to add/change burned captions: every dependent approval (covers, package, schedule) is withdrawn.
     if(!['platforms','covers-review','package-review','schedule'].includes(p.stage)||input.authorize!==true||!p.approvedVideo)throw Error('Confirme que quer reabrir o vídeo aprovado.');
     if((p.deliveries??[]).some(id=>state(profile).state.publications.find(d=>d.id===id)?.operation))throw Error('Confira os envios externos antes de trocar o vídeo.');
     if(p.covers?.render?.status==='running'){coverRenders.get(p.id)?.abort();p.covers.render={...p.covers.render,status:'canceled',finishedAt:stamp()};}
     await verifyRef(p,p.approvedVideo,'video');p.outputVideo=structuredClone(p.approvedVideo);delete p.approvedVideo;delete p.approvedMaterials;delete p.schedule;delete p.scheduleHash;if(p.covers)delete p.covers.approved;if(p.package)p.packageReuse=true;resetStep(p);p.stage='video-review';
     const value=state(profile);value.state.contents.find(c=>c.id===p.contentId).productionStage='video-review';saveState(profile,value);
    }else if(input.action==='approve-video'){
     if(captionsBusy(p))throw Error('Aguarde as legendas terminarem (ou cancele) antes de aprovar o vídeo.');
     if(p.stage!=='video-review'||input.authorize!==true||artifactHash(input.expectedVideo)!==artifactHash(p.outputVideo))throw Error('Confira o vídeo de saída desta versão.');await verifyRef(p,p.outputVideo,'video');p.approvedVideo=structuredClone(p.outputVideo);p.stage='platforms';const value=state(profile);value.state.contents.find(c=>c.id===p.contentId).productionStage='ready';saveState(profile,value);message(p,'video-approved','Vídeo aprovado. Escolha as redes para eu preparar capas e legendas.');
    }else if(input.action==='use-edited-video'){
     // The user adjusted the automatic cut in the review screen and exported it; that verified file becomes the version to approve.
     if(p.stage!=='video-review'||input.authorize!==true||typeof input.jobId!=='string')throw Error('Confira o vídeo ajustado antes de usá-lo nesta produção.');
     const job=media.list(profile).find(j=>j.id===input.jobId),value=state(profile),asset=value.state.assets?.find(a=>a.id===job?.result?.assetId&&a.contentId===p.contentId&&a.kind==='video');
     if(job?.status!=='succeeded'||job.mode!=='advanced'||job.contentId!==p.contentId||job.assetId!==p.inputVideo.assetId||job.versionId!==p.inputVideo.versionId||job.sha256!==p.inputVideo.sha256||!asset)throw Error('Use uma edição verificada feita a partir da gravação desta produção.');
     p.outputVideo=fileRef(asset);await verifyRef(p,p.outputVideo,'video');p.videoJobId=job.id;audit(p,'use-edited-video',job.id);message(p,'video-adjusted',`Você ajustou os cortes e exportou uma nova versão: ${asset.name}
${job.result.file.path}

Confira e aprove esta versão.`,{editor:true});put(p);
    }else if(input.action==='revise-video'){
     if(!['video-review','platforms','covers-review','package-review','schedule'].includes(p.stage)||typeof input.notes!=='string'||!input.notes.trim())throw Error('Informe o ajuste do vídeo.');if(p.covers?.render?.status==='running'){coverRenders.get(p.id)?.abort();p.covers.render={...p.covers.render,status:'canceled',finishedAt:stamp()};}if((p.deliveries??[]).some(id=>state(profile).state.publications.find(d=>d.id===id)?.operation))throw Error('Confira os envios externos antes de trocar o vídeo.');if(captionsBusy(p))captionJobs.get(p.id)?.abort();delete p.captions;delete p.packageReuse;p.feedback=input.notes.slice(0,5000);p.epoch++;delete p.videoJobId;delete p.approvedVideo;delete p.outputVideo;delete p.notionRead;delete p.packageNotionRead;delete p.approvedMaterials;delete p.schedule;delete p.scheduleHash;p.stage='planning-edit';resetStep(p);
    }else if(input.action==='platforms'){
     if(p.stage!=='platforms'||!Array.isArray(input.platforms)||!input.platforms.length||input.platforms.length>3||new Set(input.platforms).size!==input.platforms.length||input.platforms.some(s=>!['Instagram','TikTok','LinkedIn'].includes(s)))throw Error('Escolha Instagram, TikTok ou LinkedIn.');await verifyRef(p,p.approvedVideo,'video');p.platforms=input.platforms;p.stage='preparing-package';resetStep(p);
    }else if(input.action==='approve-package'){
     if(!['package-review','schedule'].includes(p.stage)||input.authorize!==true)throw Error('Revise as capas, legendas e o vídeo antes de aprovar.');p.approvedMaterials={};for(const id of p.deliveries){const delivery=state(profile).state.publications.find(d=>d.id===id),chosen=p.covers?.approved?.selections.find(s=>s.platform===delivery.platform);if(p.covers?.approved&&(!chosen||delivery.cover?.assetId!==chosen.assetId||delivery.cover?.versionId!==chosen.versionId||delivery.cover?.sha256!==chosen.sha256))throw Error('A capa desta entrega não é a capa aprovada. Reabra as capas.');await verifyRef(p,delivery.cover,'image');await verifyRef(p,p.approvedVideo,'video');p.approvedMaterials[id]=artifactHash(material(state(profile).state.publications.find(d=>d.id===id)));}if(artifactHash(p.approvedMaterials)!==input.expectedHash)throw Error('Uma entrega mudou. Reabra a revisão.');delete p.schedule;delete p.scheduleHash;p.stage='schedule';message(p,'package-approved','Pacote aprovado. Para quando deseja agendar? Informe a data e o horário; vou mostrar contas e fuso antes de enviar.');
    }else if(input.action==='revise-package'){
     if(!['covers-review','package-review','schedule'].includes(p.stage)||typeof input.notes!=='string'||!input.notes.trim())throw Error('Informe o ajuste das capas e legendas.');if(p.covers?.render?.status==='running')throw Error('Aguarde ou cancele a exportação de capas antes de pedir outra versão.');if((p.deliveries??[]).some(id=>state(profile).state.publications.find(d=>d.id===id)?.operation))throw Error('Confira a entrega externa antes de gerar outra versão.');p.packageFeedback=input.notes.slice(0,5000);p.epoch++;delete p.approvedMaterials;delete p.packageNotionRead;delete p.schedule;delete p.scheduleHash;resetStep(p);p.stage='preparing-package';
    }else if(input.action==='prepare-schedule'){
     if(p.stage!=='schedule'||!Array.isArray(input.targets)||input.targets.length!==p.deliveries.length)throw Error('Escolha uma conta para cada rede.');if(!validTimeZone(input.timeZone??p.timeZone))throw Error('Escolha um fuso válido.');const parsed=typeof input.text==='string'?parseProductionSchedule(input.text,input.timeZone??p.timeZone):{plannedAt:input.plannedAt,timeZone:input.timeZone??p.timeZone};if(typeof parsed?.plannedAt!=='string'||!Number.isFinite(Date.parse(parsed.plannedAt))||Date.parse(parsed.plannedAt)<Date.now()+120000)throw Error('Informe data e horário futuros sem ambiguidade.');
     for(const id of p.deliveries){const d=state(profile).state.publications.find(d=>d.id===id),target=input.targets.find(t=>t.platform===d.platform);if(!target||!['zernio','publora'].includes(target.provider))throw Error('Escolha o provedor de cada rede.');if(d.cover&&target.provider==='publora')throw Error('Este conector Publora não envia capa de vídeo. Escolha Zernio para o pacote com capa.');if(!validNetworkSettings(d.platform,target.networkSettings)||target.networkSettings?.contentType==='story'&&d.cover)throw Error('Revise as opções desta rede para vídeo com capa.');if(d.platform==='TikTok'&&(!target.networkSettings?.tiktokSettings?.privacy_level||!target.networkSettings.tiktokSettings.content_preview_confirmed||!target.networkSettings.tiktokSettings.express_consent_given))throw Error('Escolha a privacidade TikTok e confirme ambos os consentimentos.');await verifyRef(p,p.approvedVideo,'video');await verifyRef(p,d.cover,'image');const accounts=(await publishing.accounts(profile,{provider:target.provider,platform:d.platform})).accounts;if(!accounts.some(a=>a.id===target.accountId))throw Error('A conta escolhida está indisponível.');if(artifactHash(material(state(profile).state.publications.find(d=>d.id===id)))!==p.approvedMaterials[id])throw Error('O pacote aprovado mudou. Revise novamente.');}
     p.schedule={...parsed,targets:structuredClone(input.targets)};p.scheduleHash=artifactHash({schedule:p.schedule,materials:p.approvedMaterials});
    }else if(input.action==='schedule'){
     if(p.stage!=='schedule'||input.authorize!==true||!p.schedule||input.expectedHash!==p.scheduleHash)throw Error('Confira e autorize o horário, contas e pacote exatos.');p.stage='scheduling';
    }else if(input.action==='adjust-budget'){
     if(automatic.includes(p.stage)||terminal.includes(p.stage)||input.authorize!==true)throw Error('Ajuste o limite com a produção pausada ou aguardando você, após revisar o uso.');const budget=ensureBudget(p,stamp());if(input.reviewedCalls!==budget.calls.length)throw Error('O uso mudou desde a revisão. Confira as chamadas atuais.');const limits=validateBudgetLimits(input.limits);audit(p,'budget-limits',`Chamadas ${budget.maxCalls}→${limits.maxCalls}; tentativas por etapa ${budget.maxAttemptsPerStep}→${limits.maxAttemptsPerStep}; usadas ${budget.calls.length}.`);Object.assign(budget,limits);
    }else if(input.action==='cancel'){
     if(p.stage==='scheduling'||p.stage==='complete')throw Error('Cancele os agendamentos confirmados nas entregas, com autorização por provedor.');if(p.videoJobId&&media.list(profile).some(job=>job.id===p.videoJobId&&['queued','running'].includes(job.status)))await media.cancel(profile,p.videoJobId);if(p.covers?.render?.status==='running'){coverRenders.get(p.id)?.abort();p.covers.render={...p.covers.render,status:'canceled',finishedAt:stamp()};}if(captionsBusy(p)){captionJobs.get(p.id)?.abort();for(const kind of ['transcription','render'])if(p.captions[kind]?.status==='running')p.captions[kind]={...p.captions[kind],status:'canceled',finishedAt:stamp()};}if(activeId===p.id)controller?.abort();if(p.step?.executionId&&['sending','streaming'].includes(p.step.phase))await productionRuntimeFor(p.step.providerId??'codex',{getRuntime,getChatRuntime})?.cancel(p.step.threadId,p.step.executionId).catch(()=>{});p.stage='canceled';
    }else throw Error('Ação de produção desconhecida.');
   }
   transact(()=>{if(input.action!=='recording-prep')audit(p,input.action);put(p);recordCommand(profile,input,p);});after?.();kick();return p;
  }finally{locks.delete(input.id);}},
  kick,
  /** Gallery preview: only cover files exported for this run, served when the bytes still match the recorded sha256. */
  async coverFile(profile,runId,assetId,versionId){
   const p=read(profile,runId);if(!p||getCurrentProfile&&getCurrentProfile()!==profile)throw Object.assign(Error('Produção não encontrada.'),{status:404});
   if(p.imported)throw Object.assign(Error('Histórico importado não expõe arquivos de capa.'),{status:409});
   const delivered=state(profile).state.publications?.filter(d=>(p.deliveries??[]).includes(d.id)).some(d=>d.cover?.assetId===assetId&&d.cover?.versionId===versionId),known=delivered||Object.values(p.covers?.batches??{}).some(b=>b.items.some(i=>i.assetId===assetId&&i.versionId===versionId));
   if(!known)throw Object.assign(Error('Capa não encontrada nesta produção.'),{status:404});
   const asset=state(profile).state.assets?.find(a=>a.id===assetId&&a.contentId===p.contentId&&a.workspaceId===p.workspaceId&&a.kind==='image'),version=asset?.versions.find(v=>v.id===versionId);if(!version)throw Object.assign(Error('Capa não encontrada.'),{status:404});
   const bytes=await readFile(version.path),{createHash}=await import('node:crypto');if(createHash('sha256').update(bytes).digest('hex')!==version.sha256)throw Object.assign(Error('A capa mudou no disco.'),{status:409});
   return {bytes,type:/\.png$/i.test(version.path)?'image/png':'image/jpeg'};
  },
  /** B03: up to six honest candidate instants (scene change or even spacing) of the uncaptioned approved video; cached per version. */
  async coverCandidates(profile,runId){
   const p=frameRun(profile,runId),ref=coverVideo(p),key=`${p.id}|${ref.sha256}`;
   if(!frameCandidates.has(key)){if(frameCandidates.size>=16)frameCandidates.delete(frameCandidates.keys().next().value);const {v}=refAsset(p,ref,'video');frameCandidates.set(key,thumbnails.suggestCandidateFrames({source:{path:v.path,...ref},count:6}).catch(error=>{frameCandidates.delete(key);throw error;}));}
   const result=await frameCandidates.get(key);if(!sameRef(coverVideo(frameRun(profile,runId)),ref))throw statusError(409,'O vídeo aprovado mudou. Recarregue as capas.');
   return {source:ref,durationSeconds:result.durationSeconds,candidates:result.candidates,note:result.note};
  },
  /** B03: JPG of one instant (0.1 s grid) of the exact version the client saw; bounded cache, cancellable, late results deleted. */
  async coverFrame(profile,runId,query={},signal){
   let p=frameRun(profile,runId);const ref=coverVideo(p);
   if(query.versionId!==ref.versionId||query.sha256!==ref.sha256)throw statusError(409,'O vídeo aprovado mudou. Recarregue as capas.');
   const raw=Number(query.timestampSeconds),t=Math.round(raw*10)/10,duration=Number(p.covers.durationSeconds)||0;
   if(!Number.isFinite(raw)||t<0||duration>0&&t>duration)throw statusError(400,'Escolha um instante dentro do vídeo.');
   const index=await framesFor(profile,p,ref),key=String(Math.round(t*10)),cached=index.entries.get(key),{createHash}=await import('node:crypto'),digest=bytes=>createHash('sha256').update(bytes).digest('hex');
   if(cached){try{const bytes=await readFile(cached.path);if(digest(bytes)===cached.sha256){index.entries.delete(key);index.entries.set(key,cached);return {bytes,type:'image/jpeg',timestampSeconds:t,cached:true};}}catch{}index.entries.delete(key);}
   await frameSlot(signal);let out;
   try{
    if(signal?.aborted)throw statusError(499,'Prévia cancelada.');
    const {v}=refAsset(p,ref,'video'),folder=join(directory,profile,p.id,'frames');await mkdir(folder,{recursive:true});out=join(folder,`${ref.sha256.slice(0,16)}-${key}-${randomUUID().slice(0,8)}.jpg`);
    const result=await thumbnails.extractFramePreview({source:{path:v.path,...ref},timestampSeconds:t,outputPath:out,maxWidth:480,signal});
    p=read(profile,runId);
    if(signal?.aborted||p?.stage!=='covers-review'||!sameRef(coverVideo(p),ref)||frameIndex.get(runId)!==index){await rm(out,{force:true});throw statusError(409,'Prévia descartada: o vídeo ou a etapa mudou.');}
    const bytes=await readFile(out);index.entries.set(key,{path:out,sha256:result.sha256});
    while(index.entries.size>48){const [oldest,entry]=index.entries.entries().next().value;index.entries.delete(oldest);await rm(entry.path,{force:true}).catch(()=>{});}
    return {bytes,type:'image/jpeg',timestampSeconds:t};
   }catch(error){if(out&&!index.entries.has(key))await rm(out,{force:true}).catch(()=>{});if(error?.code==='cancelled')throw statusError(499,'Prévia cancelada.');throw error.status?error:statusError(error?.code==='invalid_input'?400:500,error.message);}
   finally{frameRelease();}
  },
  /** B05: read-only engine diagnostics for the caption editor (no render). */
  async captionCapabilities(){let value;try{value=await captionEngine.getCaptionCapabilities();}catch(error){value={available:false,reasons:[error.message],styles:captionStyles()};}const caps=await media.capabilities().catch(()=>({transcribe:false}));return {...value,transcribe:caps.transcribe===true,...(caps.transcribeReasons?{transcribeReasons:caps.transcribeReasons}:{})};},
  async close(){if(closed)return;closed=true;clearInterval(timer);controller?.abort();for(const abort of [...coverRenders.values(),...captionJobs.values()])abort.abort();if(own())for(const row of db.prepare('SELECT profile_id,id FROM production_runs').all()){const p=read(row.profile_id,row.id);if(automatic.includes(p.stage)){p.resumeStage=p.stage;p.stage='paused';p.error='App encerrado. Retome para conferir o resultado.';put(p);if(p.step?.executionId&&['sending','streaming'].includes(p.step.phase))await productionRuntimeFor(p.step.providerId??'codex',{getRuntime,getChatRuntime})?.cancel(p.step.threadId,p.step.executionId).catch(()=>{});}}await active;db.prepare('DELETE FROM production_lease WHERE owner=?').run(owner);},
 };
}
