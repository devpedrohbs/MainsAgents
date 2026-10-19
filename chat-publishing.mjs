import {randomUUID} from 'node:crypto';
import {artifactHash} from './editorial-jobs.mjs';
import {inspectLocalAsset} from './editorial-local-files.mjs';
import {localTimeToInstant,zonedDateTime} from './publication-time.mjs';
import {validTimeZone} from './publication-model.mjs';
import {permittedMcpAction} from './runtime-tool-policy.mjs';
import {publishingAutomationEnabled,validPublishingAutomation} from './publishing-automation.mjs';
import {classifyMessage,resolveIntent} from './chat-schedule-intent.mjs';

/**
 * Contract mainsagents.chat-publishing/1: one bounded tool for Claude and Codex chats that schedules an already
 * produced post (1–20 ordered images or one video) through the app's own publication executor. Authority is the
 * person's persisted words — the scheduling request saved in this session plus the agent's saved preference — never
 * a model argument. Every external write keeps the executor's idempotency, file hashes and read-back verification.
 */
export const scheduleTool={
 type:'function',name:'mainsagents_schedule_post',
 description:'Schedule a finished post or carousel the user asked to schedule, through the MainsAgents publishing connector. action "accounts" lists the real connected accounts for a network; action "schedule" uploads the files in order, schedules them for a future time and verifies the provider result; action "status" lists this chat\'s scheduling requests. Use only files and a caption already shown to the user in this chat. Never invent a date, account, caption or path; ask the user once for what is missing.',
 inputSchema:{type:'object',additionalProperties:false,required:['action'],properties:{
  action:{type:'string',enum:['accounts','schedule','status']},
  platform:{type:'string',enum:['Instagram','LinkedIn','TikTok']},
  provider:{type:'string',enum:['publora','zernio'],description:'Optional; the saved preference or the network default is used.'},
  accountId:{type:'string',maxLength:240,description:'Exact id from action "accounts". Optional when exactly one account is connected for the network.'},
  caption:{type:'string',maxLength:5000,description:'The exact caption already shown to the user.'},
  files:{type:'array',minItems:1,maxItems:20,items:{type:'string',maxLength:4096},description:'Absolute paths of the exported slides, in carousel order.'},
  scheduledAt:{type:'string',description:'Local wall time YYYY-MM-DDTHH:mm stated by the user, in timeZone.'},
  timeZone:{type:'string',maxLength:100,description:'IANA zone, e.g. America/Sao_Paulo.'},
  title:{type:'string',maxLength:200},
  confirmRequestId:{type:'string',maxLength:100,description:'Only after the user confirmed a summary returned as awaiting-confirmation.'},
 }},
};

const defaults={Instagram:'publora',LinkedIn:'publora',TikTok:'zernio'};
// Same lead time as the publication executor (prepare/execute refuse less than two minutes; it rechecks after upload).
const leadMs=120_000,pendingMs=60*60_000;
// JSON in a saved message doubles backslashes; any run of separators compares as one.
const pathKey=value=>String(value).replace(/[\\/]+/g,'/').toLowerCase();
const userMessages=session=>(session?.messages??[]).filter(item=>item?.type==='message'&&item.role==='user'&&typeof item.content==='string');
// Only the user's own messages: a path the assistant wrote is not proof of what was produced or shown.
const shown=(session,needle)=>(session?.messages??[]).some(item=>item?.type==='message'&&typeof item.content==='string'&&item.role==='user'&&pathKey(item.content).includes(pathKey(needle)));
const shownText=(session,text)=>{const flat=value=>String(value).replace(/\\n/g,'\n').replace(/\s+/g,' ').trim();const target=flat(text);return !target||(session?.messages??[]).some(item=>item?.type==='message'&&typeof item.content==='string'&&flat(item.content).includes(target));};
export const connectAction={
 publora:'Publora is not connected for the MainsAgents runtime. Connect it once: run `codex mcp login publora` in a terminal and finish the browser sign-in, then ask again. The app never signs in or stores tokens for you.',
 zernio:'Zernio is not configured. Save a Zernio API key in Content → Calendar → Connection settings, then ask again.',
};
const failure=(provider,error)=>{const text=String(error?.message??error);return /reconnect|configure|api key|unavailable|connect|auth|401|403/i.test(text)?`${text} ${connectAction[provider]}`:text;};
const reply=(success,data)=>({success,content:JSON.stringify(data)});

export function createChatPublishing(db,{getCurrentProfile,getAgents,getSessions,execution,publications,inspect=inspectLocalAsset,sessionExports=()=>[],clock=()=>Date.now()}={}){
 db.exec('CREATE TABLE IF NOT EXISTS chat_publication_requests(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,request_key TEXT NOT NULL,status TEXT NOT NULL,data_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)');
 db.exec('CREATE INDEX IF NOT EXISTS chat_publication_requests_key ON chat_publication_requests(profile_id,request_key)');
 // A running request cannot still be sending after a restart: its result is unknown and is never replayed.
 db.prepare("UPDATE chat_publication_requests SET status='uncertain',updated_at=? WHERE status='running'").run(new Date(clock()).toISOString());
 const decode=row=>row&&{...JSON.parse(row.data_json),id:row.id,status:row.status,createdAt:row.created_at,updatedAt:row.updated_at};
 const save=(request,status)=>{const at=new Date(clock()).toISOString(),{id,status:_s,createdAt,updatedAt,...data}=request;db.prepare('INSERT INTO chat_publication_requests VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,data_json=excluded.data_json,updated_at=excluded.updated_at').run(id,request.profileId,request.requestKey,status,JSON.stringify(data),createdAt??at,at);return {...request,status,createdAt:createdAt??at,updatedAt:at};};
 const byKey=(profile,key)=>db.prepare('SELECT * FROM chat_publication_requests WHERE profile_id=? AND request_key=? ORDER BY created_at DESC').all(profile,key).map(decode);
 const byId=(profile,id)=>decode(db.prepare('SELECT * FROM chat_publication_requests WHERE profile_id=? AND id=?').get(profile,id));
 const running=new Set();

 function context(binding){
  if(!binding?.profileId||getCurrentProfile?.()!==binding.profileId)throw Error('The active profile changed. Nothing was scheduled.');
  const agent=(getAgents?.(binding.profileId)??[]).find(item=>item.id===binding.agentId),session=(getSessions?.(binding.profileId)??[]).find(item=>item.id===binding.sessionId);
  if(!agent||!session||session.agentId!==agent.id||!['claude','codex'].includes(agent.providerId??'codex'))throw Error('This chat is not bound to a Claude or Codex agent. Nothing was scheduled.');
  if(!permittedMcpAction(agent,'schedule'))throw Error('This agent does not permit scheduling. Enable “Schedule” in its MCP permissions (Configure → MCP permissions).');
  return {agent,session,workspaceId:agent.workspaceId};
 }
 // Persisted binding of a pending request to the post it was about: a later, different carousel never reuses it.
 db.exec('CREATE TABLE IF NOT EXISTS chat_publication_intents(profile_id TEXT NOT NULL,session_id TEXT NOT NULL,message_id TEXT NOT NULL,material_hash TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(profile_id,session_id,message_id))');
 const bindMaterial=(binding,intent,materialHash)=>{
  db.prepare('INSERT OR IGNORE INTO chat_publication_intents VALUES (?,?,?,?,?)').run(binding.profileId,binding.sessionId,intent.messageId,materialHash,new Date(clock()).toISOString());
  return db.prepare('SELECT material_hash FROM chat_publication_intents WHERE profile_id=? AND session_id=? AND message_id=?').get(binding.profileId,binding.sessionId,intent.messageId).material_hash===materialHash;
 };
 async function accounts(binding,{provider,platform}={}){
  context(binding);const selected=provider??defaults[platform]??'publora';
  try{return {provider:selected,accounts:(await execution.accounts(binding.profileId,{provider:selected,...(platform?{platform}:{})})).accounts};}
  catch(error){throw Error(failure(selected,error));}
 }

 /**
  * Authority comes from the person's messages (chat-schedule-intent.mjs): with the saved preference, network, date and
  * time must be ones the person stated for this request; model arguments only fill a summary the person then confirms.
  */
 async function plan(binding,args,{agent,session}){
  const preference=validPublishingAutomation(agent.publishingAutomation)?agent.publishingAutomation:{enabled:false,provider:'',timeZone:''};
  const timeZone=preference.timeZone||args.timeZone;
  if(!timeZone)return {state:'needs-input',missing:['timeZone'],question:'Ask the user for their time zone.'};
  if(!validTimeZone(timeZone))return {state:'needs-input',missing:['timeZone'],error:'Unknown time zone.'};
  const {intent,closed}=resolveIntent(session,{timeZone,now:clock()});
  if(!intent&&closed?.kind==='cancel')return {state:'stopped',error:'The user asked not to schedule. Do not schedule or ask for a confirmation; wait for a new explicit request.',messageId:closed.messageId};
  const eligible=!!intent&&preference.enabled&&publishingAutomationEnabled(agent),facts=intent?.facts??{},missing=[],reasons=[];
  // Files first: the pending request is bound to this exact material even while other details are still missing.
  if(!Array.isArray(args.files)||!args.files.length)missing.push('files');
  else if(new Set(args.files.map(pathKey)).size!==args.files.length)return {state:'needs-input',missing:['files'],error:'The same file appears twice. Send each slide once, in order.'};
  const files=[];
  for(const path of args.files??[]){const file=await inspect(path);if(file.status!=='available'||!file.sha256||!['image','video'].includes(file.kind))return {state:'needs-input',missing:['files'],error:`${path}: ${file.error??'not a stable image or video file'}`};files.push({path:file.path,name:file.name,kind:file.kind,sha256:file.sha256,size:file.size,modifiedAt:file.modifiedAt});}
  if(new Set(files.map(item=>item.sha256)).size!==files.length)return {state:'needs-input',missing:['files'],error:'Two slides have identical content. Check the export order.'};
  const materialHash=files.length?artifactHash(files.map(file=>file.sha256)):null;
  if(intent&&materialHash){
   if(files.some(file=>Date.parse(file.modifiedAt)>Date.parse(intent.at)))reasons.push('The files changed after the scheduling request.');
   else if(!bindMaterial(binding,intent,materialHash))reasons.push('This is not the post the scheduling request was about.');
  }
  if(typeof args.caption!=='string')missing.push('caption');
  // Network: the person's words; a model guess only reaches a summary to confirm.
  let platform=args.platform;
  if(eligible&&facts.platforms?.length){if(platform&&!facts.platforms.includes(platform))return {state:'needs-input',missing:['platform'],error:`The user asked for ${facts.platforms.join(' and ')}, not ${platform}.`};platform??=facts.platforms.length===1?facts.platforms[0]:undefined;}
  else if(eligible&&platform)reasons.push('The user did not name the network.');
  if(!platform)missing.push('platform');
  // Date and time: the person's own words in the saved time zone.
  let localTime=null;
  // The person's stated time wins over a different model reading of it.
  if(eligible&&intent.localTime)localTime=intent.localTime;
  // A date the person did not state is never filled in by the model: ask once for it.
  else if(eligible)missing.push('scheduledAt');
  else if(args.scheduledAt)localTime=args.scheduledAt;
  else missing.push('scheduledAt');
  const provider=args.provider||(platform==='TikTok'?'zernio':preference.provider||defaults[platform]||'publora');
  let list=[];
  if(platform){try{list=(await accounts(binding,{provider,platform})).accounts;}catch(error){return {state:'blocked',provider,platform,error:error.message};}}
  if(platform&&!list.length)return {state:'blocked',provider,platform,error:`No active ${platform} account is connected in ${provider}. ${connectAction[provider]}`};
  // Account: one the person named (@handle), the only connected one, or a model choice the person confirms.
  let accountId;
  if(facts.account){accountId=list.find(item=>item.id.toLowerCase()===facts.account||String(item.name).replace(/^@/,'').toLowerCase()===facts.account)?.id;if(!accountId&&platform)return {state:'needs-input',missing:['accountId'],error:`@${facts.account} is not a connected ${platform} account.`,accounts:list};}
  else if(list.length===1)accountId=list[0].id;
  else if(args.accountId&&list.some(item=>item.id===args.accountId)){accountId=args.accountId;if(eligible)reasons.push('The user did not choose the account.');}
  else if(args.accountId&&platform)return {state:'blocked',provider,platform,error:'That account is not among the connected accounts. Use action "accounts" and ask the user to choose.',accounts:list};
  else if(platform)missing.push('accountId');
  if(missing.length)return {state:'needs-input',missing,provider,platform,accounts:list,known:{platform,localTime,timeZone},userSaid:facts,question:`Ask the user once, in one short message, for: ${missing.join(', ')}. Do not guess and do not ask them to approve steps.`};
  let plannedAt;try{plannedAt=localTimeToInstant(localTime,timeZone);}catch(error){return {state:'needs-input',missing:['scheduledAt'],error:error.message};}
  if(Date.parse(plannedAt)<clock()+leadMs)return {state:'needs-input',missing:['scheduledAt'],error:'That time has passed or is too close. Ask for a future time; nothing is published immediately.'};
  // Provider plan limits are checked before any write, so a schedule is never half-created and then refused.
  if(execution.limits){let limits;try{limits=await execution.limits(binding.profileId,{provider,scheduledTime:plannedAt});}catch(error){return {state:'blocked',provider,platform,error:`Could not read the ${provider} plan limits, so nothing was sent: ${failure(provider,error)}`};}
   if(limits){const {scheduledRemaining,monthlyRemaining,maxScheduledDate,plan}=limits;
    if(maxScheduledDate&&Date.parse(plannedAt)>Date.parse(maxScheduledDate))return {state:'needs-input',missing:['scheduledAt'],error:`The ${plan||provider} plan only schedules until ${zonedDateTime(maxScheduledDate,timeZone)} (${timeZone}). Choose an earlier time or upgrade the plan.`};
    if(scheduledRemaining===0||monthlyRemaining===0)return {state:'blocked',provider,platform,error:`The ${plan||provider} plan has no ${scheduledRemaining===0?'free scheduled-post slot':'monthly posts'} left. Free a slot or upgrade in ${provider}; nothing was sent.`};}}
  // File source and order: the host's latest verified export batch for this session is canonical; an assistant naming a
  // path proves nothing. Without a batch, only files the user supplied in their own messages count.
  const batch=(sessionExports(binding.profileId,binding.sessionId)??[]).filter(item=>item?.path&&item.sha256);
  if(batch.length){if(batch.length!==files.length||batch.some((item,index)=>pathKey(item.path)!==pathKey(files[index].path)||item.sha256!==files[index].sha256))reasons.push('The files are not the latest verified export of this chat, in its order.');}
  else{const unshown=args.files.filter(path=>!shown(session,path));if(unshown.length)reasons.push(`No verified export or user-supplied file for: ${unshown.join(', ')}.`);}
  if(!shownText(session,args.caption))reasons.push('The caption was not shown to the user.');
  if(!intent)reasons.push(closed?`The scheduling request was closed by a later message (${closed.kind}).`:'No scheduling request from the user was found in this chat.');
  else if(!eligible)reasons.push('This agent has no saved scheduling preference.');
  const account=list.find(item=>item.id===accountId);
  const payload={platform,provider,accountId,accountName:account?.name??accountId,caption:args.caption,timeZone,localTime:zonedDateTime(plannedAt,timeZone),plannedAt,files:files.map(({modifiedAt,...file})=>file),title:String(args.title??'').trim().slice(0,200)||`Carrossel ${zonedDateTime(plannedAt,timeZone)}`};
  const requestMessage=intent&&session.messages.find(item=>item.id===intent.messageId);
  return {state:'ready',payload,hash:artifactHash(payload),materialHash,intent:intent&&{...intent,content:requestMessage?.content??''},automatic:eligible&&!reasons.length,reasons};
 }

 /** Builds the content card, ordered assets and the approved delivery, then runs the executor once. */
 async function perform(binding,request,workspaceId){
  const profile=binding.profileId,p=request.payload;
  let row=db.prepare('SELECT revision,state_json FROM editorial_state WHERE profile_id=?').get(profile);
  if(!row){const at=new Date(clock()).toISOString();db.prepare('INSERT OR IGNORE INTO editorial_state VALUES (?,?,?,?)').run(profile,0,JSON.stringify({schemaVersion:1,topics:[],contents:[],runs:[],artifacts:[],approvals:[]}),at);row=db.prepare('SELECT revision,state_json FROM editorial_state WHERE profile_id=?').get(profile);}
  // Files are re-hashed right before they become assets; a changed export stops here.
  for(const file of p.files){const check=await inspect(file.path);if(check.status!=='available'||check.sha256!==file.sha256)throw Object.assign(Error(`${file.name} changed after the request. Export it again and ask to schedule again.`),{certain:true});}
  let contentId=request.contentId,assetIds;
  db.exec('BEGIN IMMEDIATE');
  try{
   row=db.prepare('SELECT revision,state_json FROM editorial_state WHERE profile_id=?').get(profile);
   const state=JSON.parse(row.state_json),at=new Date(clock()).toISOString();
   if(!contentId||!state.contents.some(item=>item.id===contentId)){
    contentId=`content-${randomUUID()}`;const topicId=`topic-${randomUUID()}`;
    state.topics.unshift({id:topicId,workspaceId,requestId:topicId,inputKind:'text',input:p.title,priority:'normal',status:'approved',title:p.title,category:'Carrossel',summary:`Agendamento pedido no chat em ${request.sessionId}.`,whyItMatters:'Pedido explícito do usuário.',angles:[],sources:[],factualQuestions:[],contentId,createdAt:at,updatedAt:at});
    state.contents.unshift({id:contentId,workspaceId,topicId,title:p.title,format:p.files.length>1||p.files[0].kind==='image'?'carousel':'short-video',platforms:[p.platform],status:'planning',taskId:request.id,productionStage:'ready',assetIds:[],createdAt:at,updatedAt:at});
   }
   const content=state.contents.find(item=>item.id===contentId),assets=state.assets??=[];
   assetIds=p.files.map(file=>{
    let asset=assets.find(item=>item.contentId===contentId&&item.workspaceId===content.workspaceId&&item.versions.some(v=>v.sha256===file.sha256));
    if(!asset){const version={id:`version-${randomUUID()}`,path:file.path,name:file.name,size:file.size,sha256:file.sha256,modifiedAt:at,createdAt:at};asset={id:`asset-${randomUUID()}`,workspaceId:content.workspaceId,contentId,name:file.name,kind:file.kind,role:'output',currentVersionId:version.id,versions:[version],status:'available',checkedAt:at,createdAt:at,updatedAt:at};assets.push(asset);}
    if(asset.versions.find(v=>v.id===asset.currentVersionId)?.sha256!==file.sha256)throw Object.assign(Error('A slide matches an older saved version. Export again.'),{certain:true});
    return asset.id;
   });
   content.assetIds=assets.filter(item=>item.contentId===contentId).map(item=>item.id);content.updatedAt=at;
   db.prepare('UPDATE editorial_state SET revision=?,state_json=?,updated_at=? WHERE profile_id=?').run(row.revision+1,JSON.stringify(state),at,profile);
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw Object.assign(error,{certain:true});}
  request.contentId=contentId;save(request,'running');
  const snap=()=>{const value=db.prepare('SELECT revision,state_json FROM editorial_state WHERE profile_id=?').get(profile),state=JSON.parse(value.state_json);return {revision:value.revision,state,delivery:state.publications?.find(item=>item.contentId===contentId&&item.platform===p.platform)};};
  const command=(action,extra={})=>{const s=snap();return publications.command(profile,{revision:s.revision,contentId,id:s.delivery?.id,expectedDelivery:s.delivery,action,...extra});};
  try{
   const draft={text:p.caption,timeZone:p.timeZone,plannedAt:p.plannedAt,assetIds};
   if(!snap().delivery)command('create',{platform:p.platform,timeZone:p.timeZone,draft});else command('edit',{draft});
   command('submit',{notes:'Prepared from the chat scheduling request.'});
   command('approve',{notes:`Authorized by ${request.authority}: ${request.authorityText}`.slice(0,5000)});
   let s=snap();
   execution.prepare(profile,{id:s.delivery.id,revision:s.revision,expectedDelivery:s.delivery,mode:'schedule',accountId:p.accountId,provider:p.provider});
  }catch(error){throw Object.assign(error,{certain:true});}
  const s=snap();
  try{const result=await execution.execute(profile,{id:s.delivery.id,expectedDelivery:s.delivery,authorize:true});return {delivery:result.state.publications.find(item=>item.id===s.delivery.id)};}
  catch(error){const after=snap().delivery;throw Object.assign(error,{certain:!after?.operation||after.operation.phase==='preview',deliveryId:s.delivery.id});}
 }

 async function run(binding,request,workspaceId){
  if(running.has(request.id))return reply(false,{state:'running',requestId:request.id,message:'This schedule is already being sent. Do not call again.'});
  running.add(request.id);
  try{
   request=save(request,'running');
   const {delivery}=await perform(binding,request,workspaceId);
   request.receipt={deliveryId:delivery.id,externalId:delivery.receipt.id,provider:delivery.receipt.provider,scheduledAt:delivery.receipt.scheduledAt};
   save(request,'scheduled');
   return reply(true,{state:'scheduled',requestId:request.id,platform:request.payload.platform,account:request.payload.accountName,localTime:request.payload.localTime,timeZone:request.payload.timeZone,slides:request.payload.files.map(file=>file.name),receipt:request.receipt,message:'Scheduled and verified with the provider.'});
  }catch(error){
   if(error.certain){request.error=failure(request.payload.provider,error);save(request,'failed');return reply(false,{state:'failed',requestId:request.id,error:request.error,message:'Nothing was sent to the provider. Fix the issue and ask again.'});}
   request.error=String(error?.message??error);request.deliveryId=error.deliveryId;save(request,'uncertain');
   return reply(false,{state:'uncertain',requestId:request.id,error:request.error,message:'The provider result is unconfirmed. Do not schedule again; check the post in the provider or in Content → Publications.'});
  }finally{running.delete(request.id);}
 }

 async function call(binding,args,{executionId,callId}={}){
  try{
   const scope=context(binding);
   if(!args||typeof args!=='object'||Array.isArray(args))return reply(false,{state:'invalid',error:'Invalid arguments.'});
   if(args.action==='accounts'){const result=await accounts(binding,args);return reply(true,{state:'accounts',...result});}
   if(args.action==='status')return reply(true,{state:'status',requests:list(binding.profileId,binding.sessionId).slice(0,20).map(item=>({requestId:item.id,status:item.status,platform:item.payload?.platform,localTime:item.payload?.localTime,receipt:item.receipt,error:item.error}))});
   if(args.action!=='schedule')return reply(false,{state:'invalid',error:'Unsupported action.'});
   if(args.confirmRequestId)return confirmFromChat(binding,args.confirmRequestId,scope);
   const planned=await plan(binding,args,scope);
   if(planned.state!=='ready')return reply(false,planned);
   const {reasons}=planned;
   // One request (or, without one, one post) schedules at most once per network: repeats and argument tweaks reuse it.
   const anchor=planned.intent?`intent:${planned.intent.messageId}`:`material:${planned.materialHash}`,requestKey=artifactHash({session:binding.sessionId,anchor,platform:planned.payload.platform});
   const sent=list(binding.profileId,binding.sessionId).find(item=>['running','scheduled','uncertain'].includes(item.status)&&item.payload?.platform===planned.payload.platform&&item.materialHash===planned.materialHash&&(!planned.intent||Date.parse(planned.intent.at)<=Date.parse(item.createdAt)));
   const prior=sent??byKey(binding.profileId,requestKey).find(item=>['running','scheduled','uncertain','awaiting-confirmation'].includes(item.status));
   if(prior&&prior.status!=='awaiting-confirmation')return reply(prior.status==='scheduled',{state:prior.status==='scheduled'?'already-scheduled':prior.status,requestId:prior.id,receipt:prior.receipt,error:prior.error,message:prior.status==='scheduled'?'This request was already scheduled; no duplicate was created. To schedule another post, the user must ask again.':'An earlier attempt for this request has an unconfirmed result. Do not schedule again; check the provider.'});
   // A changed summary is a new request: an answer to the old one never confirms it.
   const same=prior&&prior.hash===planned.hash;if(prior&&!same)save(prior,'superseded');
   const base={id:same?prior.id:randomUUID(),profileId:binding.profileId,requestKey,sessionId:binding.sessionId,agentId:binding.agentId,workspaceId:scope.workspaceId,executionId,callId,payload:planned.payload,hash:planned.hash,materialHash:planned.materialHash,intentMessageId:planned.intent?.messageId,createdAt:same?prior.createdAt:undefined};
   if(planned.automatic)return run(binding,{...base,authority:`the user's scheduling request in chat (message ${planned.intent.messageId}) under the agent's saved scheduling preference`,authorityText:JSON.stringify(String(planned.intent.content).slice(0,1000))},scope.workspaceId);
   // Only a user message after this point (by chat order, not clock) can confirm it.
   const pending=save({...base,expiresAt:new Date(clock()+pendingMs).toISOString(),reasons,afterMessageId:userMessages(scope.session).at(-1)?.id??null},'awaiting-confirmation');
   return reply(false,{state:'awaiting-confirmation',requestId:pending.id,hash:pending.hash,summary:{platform:planned.payload.platform,account:planned.payload.accountName,localTime:planned.payload.localTime,timeZone:planned.payload.timeZone,caption:planned.payload.caption,slides:planned.payload.files.map(file=>file.name)},reason:reasons.join(' '),message:'Show this one summary to the user and ask for a single confirmation (or they can confirm the card in the app). After the user confirms in their own message, call schedule again with confirmRequestId. Never confirm on their behalf.'});
  }catch(error){return reply(false,{state:'blocked',error:String(error?.message??error)});}
 }

 async function execute(binding,request,decisionText){
  const scope=context(binding);
  if(request.status!=='awaiting-confirmation'||Date.parse(request.expiresAt)<=clock())return reply(false,{state:'expired',requestId:request.id,message:'This confirmation expired or was already used. Prepare the schedule again.'});
  // Recheck the plan: a changed file, account or past time never runs on an old confirmation.
  const files=[];for(const file of request.payload.files){const check=await inspect(file.path);if(check.status!=='available'||check.sha256!==file.sha256){save({...request,error:`${file.name} changed.`},'failed');return reply(false,{state:'failed',requestId:request.id,error:`${file.name} changed after the summary. Prepare the schedule again.`});}files.push(file);}
  if(Date.parse(request.payload.plannedAt)<clock()+leadMs){save(request,'failed');return reply(false,{state:'failed',requestId:request.id,error:'The planned time is too close or has passed. Choose a new time.'});}
  // One confirmation runs one summary: other summaries waiting in this chat are retired.
  for(const other of list(binding.profileId,binding.sessionId))if(other.id!==request.id&&other.status==='awaiting-confirmation')save(other,'superseded');
  return run(binding,{...request,authority:'the user\'s confirmation of the scheduling summary',authorityText:decisionText},scope.workspaceId);
 }
 async function confirmFromChat(binding,requestId,scope){
  const request=byId(binding.profileId,requestId);
  if(!request||request.sessionId!==binding.sessionId)return reply(false,{state:'invalid',error:'Unknown scheduling request for this chat.'});
  const users=userMessages(scope.session),answer=users.slice(users.findIndex(item=>item.id===request.afterMessageId)+1).at(-1);
  const kind=answer&&classifyMessage(answer.content,{at:answer.createdAt,timeZone:request.payload.timeZone});
  if(kind==='cancel'){save(request,'denied');return reply(false,{state:'denied',requestId,message:'The user declined. Nothing was scheduled.'});}
  if(!answer||!['confirm','request'].includes(kind))return reply(false,{state:'awaiting-confirmation',requestId,message:'The user has not confirmed this summary in a new message. Ask them; never confirm for them.'});
  return execute(binding,request,`chat message ${answer.id}: ${JSON.stringify(answer.content.slice(0,500))}`);
 }
 /** The app's confirmation card (one decision for the whole schedule). */
 async function decide(binding,{requestId,hash,decision}){
  const request=byId(binding.profileId,requestId);
  if(!request||request.sessionId!==binding.sessionId||request.hash!==hash||!['approve','deny'].includes(decision))throw Error('This scheduling summary changed or is unavailable. Review it again.');
  if(decision==='deny'){save(request,'denied');return reply(false,{state:'denied',requestId});}
  return execute(binding,request,'confirmation card in the app');
 }
 function list(profile,sessionId){return db.prepare('SELECT * FROM chat_publication_requests WHERE profile_id=? ORDER BY created_at DESC LIMIT 200').all(profile).map(decode).filter(item=>!sessionId||item.sessionId===sessionId);}
 return {call,accounts,decide,list};
}
