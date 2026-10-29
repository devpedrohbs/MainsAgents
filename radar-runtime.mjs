import {randomUUID} from 'node:crypto';
import {SourceError,createYoutubeApi,youtubeFeed,newsFeed,hackerNews,sha,safeUrl} from './radar-sources.mjs';
import {videoMetrics,isVideoHighlight} from './radar-metrics.mjs';

/**
 * Radar editorial (contract: radar-contract.d.mts). Deterministic daily collection of free sources into append-only
 * snapshots, scoped by profile + workspace. No AI runs here. The schedule runs in the desktop host only: a day is claimed
 * atomically in SQLite (one scheduled/catch-up run per day, at most 3 attempts after failures), a missed day is recorded as
 * a gap when the next run happens, never back-filled. A source that hit a limit waits for its retryAt; nothing falls back
 * to a paid service.
 */
export const RADAR_LIMITS=Object.freeze({sources:50,items:2000,pageSize:50,maxPageSize:100,runs:20,dayAttempts:3,retryMinutes:30,tickMs:60_000,searchChannels:8,gapDays:60});
const kinds=['youtube-channel','youtube-search','news-rss','hackernews'];
const radarOf=kind=>kind.startsWith('youtube')?'youtube':'news';
const fail=(code,message,status=400)=>{throw Object.assign(Error(message),{code,status});};
const pad=n=>String(n).padStart(2,'0');
export const dayKey=ms=>{const d=new Date(ms);return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;};
const atLocal=(ms,time,addDays=0)=>{const [h,m]=time.split(':').map(Number),d=new Date(ms);d.setDate(d.getDate()+addDays);d.setHours(h,m,0,0);return d.getTime();};
/** Local calendar days strictly between two day keys (both excluded), capped. */
export function daysBetween(from,to,cap=RADAR_LIMITS.gapDays){
 const out=[];if(!from||from>=to)return out;const [y,m,d]=from.split('-').map(Number),cursor=new Date(y,m-1,d,12);
 for(;;){cursor.setDate(cursor.getDate()+1);const key=dayKey(cursor.getTime());if(key>=to||out.length>=cap)return out;out.push(key);}
}

export function validateRadarConfig(input,existingIds=new Set()){
 if(!input||typeof input!=='object')fail('invalid_config','Configuração do Radar inválida.');
 const schedule=input.schedule;
 if(!schedule||typeof schedule.enabled!=='boolean'||typeof schedule.time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time))fail('invalid_schedule','Informe o horário diário no formato HH:MM.');
 if(!Array.isArray(input.sources)||input.sources.length>RADAR_LIMITS.sources)fail('invalid_sources',`Use no máximo ${RADAR_LIMITS.sources} fontes.`);
 const seen=new Set(),label=(v,fallback)=>{if(v!==undefined&&(typeof v!=='string'||v.length>80))fail('invalid_label','Nome da fonte inválido (até 80 caracteres).');return v?.trim()||fallback;};
 const sources=input.sources.map(raw=>{
  if(!raw||!kinds.includes(raw.kind)||typeof raw.enabled!=='boolean')fail('invalid_source','Fonte do Radar inválida.');
  if(raw.id!==undefined&&(typeof raw.id!=='string'||!existingIds.has(raw.id)))fail('unknown_source','Fonte desconhecida; recarregue o Radar.');
  const base={id:raw.id??randomUUID(),kind:raw.kind,enabled:raw.enabled};let source,key;
  if(raw.kind==='youtube-channel'){if(typeof raw.channelId!=='string'||!/^UC[\w-]{22}$/.test(raw.channelId))fail('invalid_channel','O ID do canal começa com "UC" e tem 24 caracteres (está em youtube.com/channel/UC…).');source={...base,channelId:raw.channelId,label:label(raw.label,raw.channelId)};key=raw.channelId;}
  else if(raw.kind==='youtube-search'){const query=typeof raw.query==='string'?raw.query.trim():'';if(!query||query.length>120)fail('invalid_query','O tema de busca precisa ter de 1 a 120 caracteres.');if(raw.regionCode!==undefined&&!/^[A-Z]{2}$/.test(raw.regionCode))fail('invalid_region','Região inválida (ex.: BR).');source={...base,query,...(raw.regionCode?{regionCode:raw.regionCode}:{}),label:query};key=`${query.toLowerCase()}|${raw.regionCode??''}`;}
  else if(raw.kind==='news-rss'){const url=safeUrl(raw.url);if(!url||!url.startsWith('https:')||url.length>2048)fail('invalid_feed','Use o endereço https do feed RSS/Atom.');source={...base,url,label:label(raw.label,new URL(url).hostname.replace(/^www\./,''))};key=url;}
  else{const minScore=raw.minScore??100;if(!Number.isSafeInteger(minScore)||minScore<1||minScore>5000)fail('invalid_min_score','Pontuação mínima do Hacker News entre 1 e 5000.');source={...base,minScore,label:'Hacker News'};key='hn';}
  if(seen.has(`${raw.kind}:${key}`))fail('duplicate_source','Essa fonte já está na lista.');seen.add(`${raw.kind}:${key}`);
  return source;
 });
 return {schedule:{enabled:schedule.enabled,time:schedule.time},sources};
}

export function createRadar(db,{secureStorage,getCurrentProfile,fetch:fetchImpl=globalThis.fetch,clock=()=>Date.now(),tickMs=RADAR_LIMITS.tickMs,autoTick=true}={}){
 db.exec(`CREATE TABLE IF NOT EXISTS radar_config(profile_id TEXT NOT NULL,workspace_id TEXT NOT NULL,schedule_json TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(profile_id,workspace_id));
 CREATE TABLE IF NOT EXISTS radar_sources(profile_id TEXT NOT NULL,workspace_id TEXT NOT NULL,id TEXT NOT NULL,position INTEGER NOT NULL,input_json TEXT NOT NULL,enabled INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'idle',last_attempt_at TEXT,last_success_at TEXT,error_code TEXT,error_message TEXT,retry_at TEXT,PRIMARY KEY(profile_id,workspace_id,id));
 CREATE TABLE IF NOT EXISTS radar_items(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,workspace_id TEXT NOT NULL,kind TEXT NOT NULL,platform TEXT NOT NULL,external_id TEXT NOT NULL,url TEXT NOT NULL,title TEXT NOT NULL,author TEXT,channel_id TEXT,published_at TEXT,duration_seconds INTEGER,live INTEGER NOT NULL DEFAULT 0,first_seen_at TEXT NOT NULL,last_seen_at TEXT NOT NULL,source_ids_json TEXT NOT NULL,UNIQUE(profile_id,workspace_id,kind,external_id));
 CREATE TABLE IF NOT EXISTS radar_snapshots(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,workspace_id TEXT NOT NULL,item_id TEXT NOT NULL,run_id TEXT NOT NULL,collected_at TEXT NOT NULL,views INTEGER,likes INTEGER,comments INTEGER,score INTEGER,source TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS radar_snapshots_item ON radar_snapshots(item_id,collected_at);
 CREATE TABLE IF NOT EXISTS radar_baselines(profile_id TEXT NOT NULL,workspace_id TEXT NOT NULL,channel_id TEXT NOT NULL,run_id TEXT NOT NULL,collected_at TEXT NOT NULL,videos_json TEXT NOT NULL,PRIMARY KEY(profile_id,workspace_id,channel_id,run_id));
 CREATE TABLE IF NOT EXISTS radar_runs(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,workspace_id TEXT NOT NULL,day_key TEXT NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL,started_at TEXT NOT NULL,finished_at TEXT,sources_json TEXT NOT NULL,gap_days_json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS radar_day_claims(profile_id TEXT NOT NULL,workspace_id TEXT NOT NULL,day_key TEXT NOT NULL,attempts INTEGER NOT NULL,status TEXT NOT NULL,next_attempt_at TEXT,PRIMARY KEY(profile_id,workspace_id,day_key));
 CREATE TABLE IF NOT EXISTS radar_credentials(profile_id TEXT PRIMARY KEY,encrypted_key TEXT NOT NULL);`);
 // A run left 'running' by a process that died is interrupted, and its day claim may be retried.
 db.exec("UPDATE radar_runs SET status='interrupted',finished_at=started_at WHERE status='running'; UPDATE radar_day_claims SET status='failed' WHERE status='running'");
 let closed=false;const running=new Map(),controllers=new Map();
 const now=()=>new Date(clock()).toISOString();
 const guard=scope=>{
  if(!scope||typeof scope.profile!=='string'||!/^[\w-]{1,120}$/.test(scope.profile)||typeof scope.workspaceId!=='string'||!scope.workspaceId||scope.workspaceId.length>200)fail('invalid_scope','Perfil ou workspace inválido.');
  if(closed)fail('closing','O app está fechando.',503);
  if(getCurrentProfile&&getCurrentProfile()!==scope.profile)fail('profile_changed','O perfil ativo mudou.',409);
 };
 const keyOf=scope=>`${scope.profile}\0${scope.workspaceId}`;
 const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const out=fn();db.exec('COMMIT');return out;}catch(error){db.exec('ROLLBACK');throw error;}};

 // ---- Credentials (same model as the calendar key: encrypted, never returned to the renderer) ----
 const available=()=>Boolean(secureStorage?.isEncryptionAvailable?.());
 const checkProfile=profile=>{if(typeof profile!=='string'||!/^[\w-]{1,120}$/.test(profile))fail('invalid_profile','Perfil inválido.');};
 const credentials={
  status(profile){checkProfile(profile);return {configured:Boolean(db.prepare('SELECT 1 FROM radar_credentials WHERE profile_id=?').get(profile)),secureStorage:available()};},
  save(profile,key){checkProfile(profile);if(!available())fail('secure_storage','O armazenamento seguro do Windows não está disponível.');if(typeof key!=='string'||!/^AIza[\w-]{35}$/.test(key.trim()))fail('invalid_key','Chave inválida: a chave da YouTube API começa com "AIza" e tem 39 caracteres.');
   db.prepare('INSERT INTO radar_credentials VALUES(?,?) ON CONFLICT(profile_id) DO UPDATE SET encrypted_key=excluded.encrypted_key').run(profile,secureStorage.encryptString(key.trim()).toString('base64'));
   // A new key ends a needs_reauth wait of every YouTube source of this profile.
   db.prepare("UPDATE radar_sources SET status='idle',error_code=NULL,error_message=NULL WHERE profile_id=? AND status='needs_reauth' AND input_json LIKE '%\"kind\":\"youtube%'").run(profile);
   return credentials.status(profile);},
  remove(profile){checkProfile(profile);db.prepare('DELETE FROM radar_credentials WHERE profile_id=?').run(profile);return credentials.status(profile);},
 };
 const apiKey=profile=>{const row=db.prepare('SELECT encrypted_key FROM radar_credentials WHERE profile_id=?').get(profile);if(!row)return '';if(!available())throw new SourceError('needs_reauth','secure_storage','O armazenamento seguro do Windows não está disponível para ler a chave.');try{return secureStorage.decryptString(Buffer.from(row.encrypted_key,'base64'));}catch{throw new SourceError('needs_reauth','invalid_api_key','Cadastre a chave da YouTube API novamente neste computador.');}};

 // ---- Config ----
 const scheduleOf=scope=>{const row=db.prepare('SELECT schedule_json FROM radar_config WHERE profile_id=? AND workspace_id=?').get(scope.profile,scope.workspaceId);return row?JSON.parse(row.schedule_json):{enabled:false,time:'07:00'};};
 const sourceRows=scope=>db.prepare('SELECT * FROM radar_sources WHERE profile_id=? AND workspace_id=? ORDER BY position').all(scope.profile,scope.workspaceId);
 const sourceInput=row=>({...JSON.parse(row.input_json),id:row.id,enabled:Boolean(row.enabled)});
 const publicSource=row=>{const input=JSON.parse(row.input_json);return {id:row.id,kind:input.kind,label:input.label,enabled:Boolean(row.enabled),status:row.status,lastAttemptAt:row.last_attempt_at,lastSuccessAt:row.last_success_at,errorCode:row.error_code,errorMessage:row.error_message,retryAt:row.retry_at};};
 function configure(scope,input){
  guard(scope);if(running.has(keyOf(scope)))fail('already_running','Aguarde a coleta em andamento terminar para mudar a configuração.',409);
  const existing=new Set(sourceRows(scope).map(r=>r.id)),config=validateRadarConfig(input,existing);
  tx(()=>{
   db.prepare('INSERT INTO radar_config VALUES(?,?,?,?) ON CONFLICT(profile_id,workspace_id) DO UPDATE SET schedule_json=excluded.schedule_json,updated_at=excluded.updated_at').run(scope.profile,scope.workspaceId,JSON.stringify(config.schedule),now());
   const keep=new Set(config.sources.map(s=>s.id));
   for(const id of existing)if(!keep.has(id))db.prepare('DELETE FROM radar_sources WHERE profile_id=? AND workspace_id=? AND id=?').run(scope.profile,scope.workspaceId,id);
   config.sources.forEach(({id,enabled,...source},position)=>{
    const prior=db.prepare('SELECT input_json FROM radar_sources WHERE profile_id=? AND workspace_id=? AND id=?').get(scope.profile,scope.workspaceId,id);
    // Editing what a source points to resets its status; toggling or reordering keeps it.
    const changed=prior&&JSON.stringify({...JSON.parse(prior.input_json),label:undefined})!==JSON.stringify({...source,label:undefined});
    if(!prior)db.prepare('INSERT INTO radar_sources(profile_id,workspace_id,id,position,input_json,enabled) VALUES(?,?,?,?,?,?)').run(scope.profile,scope.workspaceId,id,position,JSON.stringify(source),enabled?1:0);
    else db.prepare(`UPDATE radar_sources SET position=?,input_json=?,enabled=?${changed?",status='idle',error_code=NULL,error_message=NULL,retry_at=NULL":''} WHERE profile_id=? AND workspace_id=? AND id=?`).run(position,JSON.stringify(source),enabled?1:0,scope.profile,scope.workspaceId,id);
   });
  });
  return snapshot(scope);
 }

 // ---- Persistence of a collection ----
 function upsertItem(scope,{kind,platform,externalId,url,title,author,channelId=null,publishedAt=null,durationSeconds=null,live=false},sourceId,at){
  const row=db.prepare('SELECT id,source_ids_json FROM radar_items WHERE profile_id=? AND workspace_id=? AND kind=? AND external_id=?').get(scope.profile,scope.workspaceId,kind,externalId);
  if(!row){const id=randomUUID();db.prepare('INSERT INTO radar_items VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,scope.profile,scope.workspaceId,kind,platform,externalId,url,title.slice(0,300),author?.slice(0,200)??null,channelId,publishedAt,Number.isFinite(durationSeconds)?durationSeconds:null,live?1:0,at,at,JSON.stringify([sourceId]));return id;}
  const ids=JSON.parse(row.source_ids_json);if(!ids.includes(sourceId))ids.push(sourceId);
  // Fields a source did not return (null) keep what an earlier, richer collection saw (e.g. RSS has no duration).
  db.prepare('UPDATE radar_items SET url=?,title=?,author=COALESCE(?,author),channel_id=COALESCE(?,channel_id),published_at=COALESCE(?,published_at),duration_seconds=COALESCE(?,duration_seconds),live=MAX(live,?),last_seen_at=?,source_ids_json=? WHERE id=?')
   .run(url,title.slice(0,300),author?.slice(0,200)??null,channelId,publishedAt,Number.isFinite(durationSeconds)?durationSeconds:null,live?1:0,at,JSON.stringify(ids),row.id);
  return row.id;
 }
 const addSnapshot=(scope,itemId,runId,at,{views=null,likes=null,comments=null,score=null},source)=>db.prepare('INSERT INTO radar_snapshots VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),scope.profile,scope.workspaceId,itemId,runId,at,views,likes,comments,score,source);
 function saveVideos(scope,sourceId,runId,at,videos,source){
  for(const v of videos){const id=upsertItem(scope,{kind:'youtube',platform:'youtube',externalId:v.videoId,url:`https://www.youtube.com/watch?v=${v.videoId}`,title:v.title,author:v.author,channelId:v.channelId,publishedAt:v.publishedAt,durationSeconds:v.durationSeconds,live:v.live},sourceId,at);addSnapshot(scope,id,runId,at,v,source);}
 }
 const saveBaseline=(scope,channelId,runId,at,videos)=>db.prepare('INSERT OR REPLACE INTO radar_baselines VALUES(?,?,?,?,?,?)').run(scope.profile,scope.workspaceId,channelId,runId,at,JSON.stringify(videos.map(({videoId,views,publishedAt,durationSeconds,live})=>({videoId,views,publishedAt,durationSeconds,live}))));

 async function collectSource(scope,input,runId,signal){
  const at=now();let count=0,partial=null;
  if(input.kind==='youtube-channel'){
   let key='',videos,source='youtube-rss';
   try{key=apiKey(scope.profile);}catch(error){partial={code:error.code,message:`${error.message} Coletado pelo RSS do canal.`};}
   if(key){
    try{videos=(await createYoutubeApi({key,fetch:fetchImpl,clock,signal}).channelVideos(input.channelId)).videos;source='youtube-api';}
    // Quota or key problem: the free channel feed still works (views only), so this source degrades instead of stopping.
    catch(error){if(signal.aborted||!(error instanceof SourceError)||!['limit_reached','needs_reauth'].includes(error.status))throw error;partial={code:error.code,message:`${error.message} Coletado pelo RSS do canal.`};}
   }
   videos??=await youtubeFeed(input.channelId,{fetch:fetchImpl,signal});
   if(signal.aborted)throw signal.reason;
   tx(()=>{saveVideos(scope,input.id,runId,at,videos,source);saveBaseline(scope,input.channelId,runId,at,videos);});count=videos.length;
  }else if(input.kind==='youtube-search'){
   const key=apiKey(scope.profile);if(!key)throw new SourceError('error','missing_api_key','A busca por tema precisa da chave gratuita da YouTube API; os canais seguidos funcionam sem ela (RSS).');
   const api=createYoutubeApi({key,fetch:fetchImpl,clock,signal}),videos=await api.search(input.query,{regionCode:input.regionCode});
   tx(()=>saveVideos(scope,input.id,runId,at,videos,'youtube-api'));count=videos.length;
   // Baseline of each found channel, so "above its own channel" can be measured (~3 units per channel, bounded).
   const fresh=db.prepare('SELECT 1 FROM radar_baselines WHERE profile_id=? AND workspace_id=? AND channel_id=? AND run_id=?');
   const channels=[...new Set(videos.map(v=>v.channelId).filter(Boolean))].filter(id=>!fresh.get(scope.profile,scope.workspaceId,id,runId)).slice(0,RADAR_LIMITS.searchChannels);
   for(const channelId of channels){
    try{const sample=await api.channelVideos(channelId);if(signal.aborted)throw signal.reason;saveBaseline(scope,channelId,runId,now(),sample.videos);}
    catch(error){if(signal.aborted||error.status==='limit_reached'||error.status==='needs_reauth')throw error;partial={code:'baseline_partial',message:'Parte dos canais encontrados ficou sem base de comparação.'};}
   }
  }else if(input.kind==='news-rss'){
   const entries=await newsFeed(input.url,{fetch:fetchImpl,signal});if(signal.aborted)throw signal.reason;
   tx(()=>{for(const e of entries)upsertItem(scope,{kind:'news',platform:'web',externalId:sha(e.url),url:e.url,title:e.title,author:e.author,publishedAt:e.publishedAt},input.id,at);});count=entries.length;
  }else{
   const stories=await hackerNews({fetch:fetchImpl,signal});if(signal.aborted)throw signal.reason;
   tx(()=>{for(const s of stories){const id=upsertItem(scope,{kind:'news',platform:'web',externalId:sha(s.url),url:s.url,title:s.title,author:s.author,publishedAt:s.publishedAt},input.id,at);addSnapshot(scope,id,runId,at,{score:s.score,comments:s.comments},'hackernews');}});count=stories.length;
  }
  return {count,partial};
 }

 async function execute(scope,run,kind,signal){
  const results=[];
  for(const row of sourceRows(scope).filter(r=>r.enabled&&(!kind||radarOf(JSON.parse(r.input_json).kind)===kind))){
   if(signal.aborted)break;
   const input=sourceInput(row),at=now();
   if(row.status==='limit_reached'&&row.retry_at&&Date.parse(row.retry_at)>clock()){results.push({sourceId:row.id,status:'limit_reached',items:0,errorCode:row.error_code,skipped:true});continue;}
   const set=(status,{code=null,message=null,retryAt=null,success=false}={})=>db.prepare(`UPDATE radar_sources SET status=?,last_attempt_at=?,error_code=?,error_message=?,retry_at=?${success?',last_success_at=?':''} WHERE profile_id=? AND workspace_id=? AND id=?`).run(status,at,code,message,retryAt,...(success?[at]:[]),scope.profile,scope.workspaceId,row.id);
   try{const {count,partial}=await collectSource(scope,input,run.id,signal);const status=partial?'partial':'ok';set(status,{code:partial?.code,message:partial?.message,success:true});results.push({sourceId:row.id,status,items:count,errorCode:partial?.code??null});}
   catch(error){
    if(signal.aborted)break;
    const known=error instanceof SourceError,status=known?error.status:'error',code=known?error.code:'unexpected';
    set(status,{code,message:known?error.message:'Falha inesperada ao coletar esta fonte.',retryAt:error.retryAt??null});results.push({sourceId:row.id,status,items:0,errorCode:code});
   }
  }
  return results;
 }

 function collect(scope,{kind,reason='manual'}={}){
  guard(scope);
  if(kind!==undefined&&!['youtube','news'].includes(kind))fail('invalid_kind','Tipo de radar inválido.');
  if(!['manual','schedule','catch-up'].includes(reason))fail('invalid_reason','Motivo de coleta inválido.');
  const key=keyOf(scope);if(running.has(key))fail('already_running','Já há uma coleta em andamento.',409);
  const at=now(),today=dayKey(clock());
  const last=db.prepare("SELECT day_key FROM radar_runs WHERE profile_id=? AND workspace_id=? AND status IN ('succeeded','partial') ORDER BY started_at DESC LIMIT 1").get(scope.profile,scope.workspaceId);
  const run={id:randomUUID(),dayKey:today,reason,gapDays:daysBetween(last?.day_key,today)};
  db.prepare("INSERT INTO radar_runs VALUES(?,?,?,?,?,'running',?,NULL,'[]',?)").run(run.id,scope.profile,scope.workspaceId,today,reason,at,JSON.stringify(run.gapDays));
  const controller=new AbortController();controllers.set(key,controller);
  const task=(async()=>{
   let results=[],status='failed';
   try{
    results=await execute(scope,run,kind,controller.signal);
    // A source still waiting for its limit is skipped: it neither succeeds nor fails the run (and is not retried today).
    const tried=results.filter(r=>!r.skipped),good=tried.filter(r=>['ok','partial'].includes(r.status));
    status=controller.signal.aborted?'interrupted':!results.length||(tried.length===results.length&&tried.every(r=>r.status==='ok'))?'succeeded':good.length||!tried.length?'partial':'failed';
   }catch{status=controller.signal.aborted?'interrupted':'failed';}
   finally{db.prepare('UPDATE radar_runs SET status=?,finished_at=?,sources_json=? WHERE id=?').run(status,now(),JSON.stringify(results.map(({sourceId,status:s,items,errorCode})=>({sourceId,status:s,items,errorCode}))),run.id);running.delete(key);controllers.delete(key);}
   return status;
  })();
  running.set(key,{run,task});
  return {runId:run.id,status:'running',task};
 }

 // ---- Schedule ----
 const claimRow=(scope,day)=>db.prepare('SELECT * FROM radar_day_claims WHERE profile_id=? AND workspace_id=? AND day_key=?').get(scope.profile,scope.workspaceId,day);
 function nextRunAt(scope){
  const schedule=scheduleOf(scope);if(!schedule.enabled)return null;
  const t=clock(),claim=claimRow(scope,dayKey(t));
  if(!claim||claim.status==='running')return new Date(atLocal(t,schedule.time)).toISOString();
  if(claim.status==='failed'&&claim.attempts<RADAR_LIMITS.dayAttempts)return new Date(Math.max(atLocal(t,schedule.time),Date.parse(claim.next_attempt_at??'')||0)).toISOString();
  return new Date(atLocal(t,schedule.time,1)).toISOString();
 }
 /** Claims today's run atomically: absent → attempt 1; failed with attempts left and its retry time reached → next attempt. */
 function claim(scope,day,t){
  return tx(()=>{
   const row=claimRow(scope,day);
   if(!row){db.prepare("INSERT INTO radar_day_claims VALUES(?,?,?,1,'running',NULL)").run(scope.profile,scope.workspaceId,day);return true;}
   if(row.status!=='failed'||row.attempts>=RADAR_LIMITS.dayAttempts||(row.next_attempt_at&&Date.parse(row.next_attempt_at)>t))return false;
   db.prepare("UPDATE radar_day_claims SET attempts=attempts+1,status='running' WHERE profile_id=? AND workspace_id=? AND day_key=?").run(scope.profile,scope.workspaceId,day);return true;
  });
 }
 /** Called by the host on startup, on power resume and every minute. Only the active profile; never two runs of one scope. */
 async function refreshDue({reason='tick'}={}){
  if(closed||!getCurrentProfile)return [];const profile=getCurrentProfile();if(!profile)return [];
  if(!['startup','resume','tick'].includes(reason))fail('invalid_reason','Motivo inválido.');
  const started=[],t=clock(),day=dayKey(t);
  for(const {workspace_id:workspaceId,schedule_json} of db.prepare('SELECT workspace_id,schedule_json FROM radar_config WHERE profile_id=?').all(profile)){
   const schedule=JSON.parse(schedule_json),scope={profile,workspaceId};
   if(!schedule.enabled||t<atLocal(t,schedule.time)||running.has(keyOf(scope))||!claim(scope,day,t))continue;
   // On time when the tick lands within an hour of the scheduled minute; otherwise (PC was off/asleep) a catch-up.
   const runReason=reason==='tick'&&t-atLocal(t,schedule.time)<3_600_000?'schedule':'catch-up';
   let handle;try{handle=collect(scope,{reason:runReason});}catch{db.prepare("UPDATE radar_day_claims SET status='failed',next_attempt_at=? WHERE profile_id=? AND workspace_id=? AND day_key=?").run(new Date(t+RADAR_LIMITS.retryMinutes*60_000).toISOString(),profile,workspaceId,day);continue;}
   started.push(handle.task.then(status=>{
    const done=['succeeded','partial'].includes(status);
    db.prepare('UPDATE radar_day_claims SET status=?,next_attempt_at=? WHERE profile_id=? AND workspace_id=? AND day_key=?').run(done?'done':'failed',done?null:new Date(clock()+RADAR_LIMITS.retryMinutes*60_000).toISOString(),profile,workspaceId,day);
    return {workspaceId,runId:handle.runId,status};
   }));
  }
  return Promise.all(started);
 }

 // ---- Reads ----
 const runOf=row=>({id:row.id,dayKey:row.day_key,reason:row.reason,status:row.status,startedAt:row.started_at,finishedAt:row.finished_at,sources:JSON.parse(row.sources_json),gapDays:JSON.parse(row.gap_days_json)});
 const snapOf=row=>({id:row.id,itemId:row.item_id,runId:row.run_id,collectedAt:row.collected_at,views:row.views,likes:row.likes,comments:row.comments,score:row.score,source:row.source});
 function itemOf(scope,row,minScore){
  const snapshots=db.prepare('SELECT * FROM radar_snapshots WHERE item_id=? ORDER BY collected_at').all(row.id).map(snapOf);
  const base={id:row.id,kind:row.kind,platform:row.platform,externalId:row.external_id,url:row.url,title:row.title,author:row.author,channelId:row.channel_id,publishedAt:row.published_at,durationSeconds:row.duration_seconds,firstSeenAt:row.first_seen_at,lastSeenAt:row.last_seen_at,sourceIds:JSON.parse(row.source_ids_json),promoted:[]};
  if(row.kind==='news'){const latest=snapshots.at(-1);return {...base,metrics:null,highlight:Number.isFinite(latest?.score)&&latest.score>=minScore,_snapshots:snapshots};}
  const b=row.channel_id&&db.prepare('SELECT collected_at,videos_json FROM radar_baselines WHERE profile_id=? AND workspace_id=? AND channel_id=? ORDER BY collected_at DESC LIMIT 1').get(scope.profile,scope.workspaceId,row.channel_id);
  const metrics=videoMetrics({externalId:row.external_id,publishedAt:row.published_at,durationSeconds:row.duration_seconds,live:Boolean(row.live)},snapshots,b?{collectedAt:b.collected_at,videos:JSON.parse(b.videos_json)}:null);
  return {...base,metrics,highlight:isVideoHighlight(metrics),_snapshots:snapshots};
 }
 const hnMin=scope=>{const row=sourceRows(scope).find(r=>JSON.parse(r.input_json).kind==='hackernews');return row?JSON.parse(row.input_json).minScore:100;};
 function snapshot(scope,query={}){
  guard(scope);
  const kind=query.kind,limit=Math.min(Math.max(Number(query.limit)||RADAR_LIMITS.pageSize,1),RADAR_LIMITS.maxPageSize),offset=Math.max(Number.parseInt(query.cursor??'0',10)||0,0);
  if(kind!==undefined&&!['youtube','news'].includes(kind))fail('invalid_kind','Tipo de radar inválido.');
  const minScore=hnMin(scope);
  let items=db.prepare(`SELECT * FROM radar_items WHERE profile_id=? AND workspace_id=?${kind?' AND kind=?':''} ORDER BY last_seen_at DESC,published_at DESC LIMIT ${RADAR_LIMITS.items}`).all(scope.profile,scope.workspaceId,...(kind?[kind]:[])).map(row=>itemOf(scope,row,minScore));
  if(query.highlight)items=items.filter(i=>i.highlight).sort((a,b)=>(b.metrics?.logScore??b._snapshots.at(-1)?.score??0)-(a.metrics?.logScore??a._snapshots.at(-1)?.score??0));
  const page=items.slice(offset,offset+limit).map(({_snapshots,...item})=>item),active=running.get(keyOf(scope));
  const runs=db.prepare('SELECT * FROM radar_runs WHERE profile_id=? AND workspace_id=? ORDER BY started_at DESC LIMIT ?').all(scope.profile,scope.workspaceId,RADAR_LIMITS.runs).map(runOf);
  const status=credentials.status(scope.profile);
  return {schemaVersion:1,profile:scope.profile,workspaceId:scope.workspaceId,config:{schedule:scheduleOf(scope),sources:sourceRows(scope).map(sourceInput)},
   credentials:{youtubeApiKey:status.configured,secureStorage:status.secureStorage},sources:sourceRows(scope).map(publicSource),items:page,nextCursor:offset+limit<items.length?String(offset+limit):null,
   runs,running:active?runs.find(r=>r.id===active.run.id)??null:null,nextRunAt:nextRunAt(scope),
   synthesis:{status:'none',providerId:null,createdAt:null,waitingUntil:null,recommendations:[]}};
 }
 function history(scope,itemId){
  guard(scope);const row=db.prepare('SELECT * FROM radar_items WHERE id=? AND profile_id=? AND workspace_id=?').get(itemId,scope.profile,scope.workspaceId);
  if(!row)fail('not_found','Item do Radar não encontrado.',404);
  const {_snapshots,...item}=itemOf(scope,row,hnMin(scope));return {item,snapshots:_snapshots};
 }

 const timer=autoTick?setInterval(()=>{void refreshDue({reason:'tick'}).catch(()=>{});},tickMs):null;timer?.unref?.();
 return {
  snapshot,configure,history,refreshDue,credentials,
  collect:(scope,input)=>{const {task:_task,...out}=collect(scope,input);void _task;return out;},
  /** Tests/host: the in-flight run of a scope, to await it. */
  pending:scope=>running.get(keyOf(scope))?.task??null,
  async close(){closed=true;if(timer)clearInterval(timer);for(const c of controllers.values())c.abort(Error('closing'));await Promise.allSettled([...running.values()].map(r=>r.task));},
 };
}
