/**
 * B10 — automatic, READ-ONLY refresh of scheduled deliveries through the already configured connectors.
 * It only calls `publishing.observe` (provider read + verification); it never creates, edits, cancels or resends,
 * and never turns a network failure into "failed". Runs only for the active profile, while the app is alive;
 * settings are local and bounded. No cloud worker, new endpoint or account is involved.
 */
export const REFRESH_INTERVALS=Object.freeze([5,15,30,60]);
export const REFRESH_LIMITS=Object.freeze({maxPerRun:20,openCacheMs:60_000,tickMs:30_000,maxResults:50});
const defaults=Object.freeze({auto:true,intervalMinutes:15});

export function validateRefreshSettings(raw){
 if(!raw||typeof raw!=='object'||Object.keys(raw).some(key=>!['auto','intervalMinutes'].includes(key)))throw Error('Configuração de atualização inválida.');
 if(typeof raw.auto!=='boolean'||!REFRESH_INTERVALS.includes(raw.intervalMinutes))throw Error(`Escolha um intervalo de ${REFRESH_INTERVALS.join(', ')} minutos.`);
 return {auto:raw.auto,intervalMinutes:raw.intervalMinutes};
}
/** Scheduled deliveries with a confirmed provider receipt: overdue/soonest first, bounded per run. */
export function refreshCandidates(publications=[],{now=Date.now(),max=REFRESH_LIMITS.maxPerRun}={}){
 return publications.filter(item=>item?.status==='scheduled'&&item.operation?.phase==='confirmed'&&typeof item.operation.externalId==='string')
  .sort((a,b)=>(Date.parse(a.plannedAt)||now)-(Date.parse(b.plannedAt)||now)).slice(0,max).map(item=>item.id);
}

export function createPublicationStatusRefresh(db,{publishing,getCurrentProfile,clock=()=>Date.now(),tickMs=REFRESH_LIMITS.tickMs}={}){
 db.exec('CREATE TABLE IF NOT EXISTS publication_refresh (profile_id TEXT PRIMARY KEY,settings_json TEXT NOT NULL,status_json TEXT NOT NULL)');
 let closed=false;const running=new Map();
 const row=profile=>db.prepare('SELECT settings_json,status_json FROM publication_refresh WHERE profile_id=?').get(profile);
 const settings=profile=>{const value=row(profile);try{return value?validateRefreshSettings(JSON.parse(value.settings_json)):{...defaults};}catch{return {...defaults};}};
 const status=profile=>{const value=row(profile);return value?JSON.parse(value.status_json):{lastRunAt:null,results:[]};};
 const save=(profile,next)=>db.prepare('INSERT INTO publication_refresh VALUES(?,?,?) ON CONFLICT(profile_id) DO UPDATE SET settings_json=excluded.settings_json,status_json=excluded.status_json').run(profile,JSON.stringify(next.settings??settings(profile)),JSON.stringify(next.status??status(profile)));
 const deliveries=profile=>{const value=db.prepare('SELECT state_json FROM editorial_state WHERE profile_id=?').get(profile);return value?JSON.parse(value.state_json).publications??[]:[];};
 const active=profile=>!closed&&(!getCurrentProfile||getCurrentProfile()===profile);
 const snapshot=profile=>({settings:settings(profile),status:{...status(profile),running:running.has(profile)}});

 async function run(profile,reason){
  const ids=refreshCandidates(deliveries(profile),{now:clock()}),results=[];let stopped=false;
  for(const id of ids){
   if(!active(profile)){stopped=true;break;}
   try{results.push(await publishing.observe(profile,id));}
   catch(error){if(!active(profile)){stopped=true;break;}results.push({id,state:'unknown',status:'scheduled',error:String(error?.message??error).slice(0,300)});}
  }
  const at=new Date(clock()).toISOString(),previous=status(profile);
  // Notifications: real transitions (trusted receipts) and checks that could not confirm anything; the known state was kept.
  const notices=results.filter(item=>['updated','unknown','attention'].includes(item.state)).map(item=>({...item,at}));
  const next={lastRunAt:at,lastReason:reason,checked:ids.length,stopped,results:results.slice(0,REFRESH_LIMITS.maxResults),notices:[...notices,...(previous.notices??[])].slice(0,REFRESH_LIMITS.maxResults)};
  if(!closed)save(profile,{status:next});
  return next;
 }
 /** reason: 'open' (cached for 60 s), 'manual' (always checks), 'auto' (timer). Concurrent calls share the run in flight. */
 async function refresh(profile,{reason='manual'}={}){
  if(!['open','manual','auto'].includes(reason))throw Error('Motivo de atualização inválido.');
  if(!active(profile))throw Error('O perfil ativo mudou ou o app está fechando.');
  if(running.has(profile))return running.get(profile).then(()=>snapshot(profile));
  const last=Date.parse(status(profile).lastRunAt??'');
  if(reason==='open'&&Number.isFinite(last)&&clock()-last<REFRESH_LIMITS.openCacheMs)return Promise.resolve({...snapshot(profile),cached:true});
  const task=run(profile,reason).finally(()=>running.delete(profile));running.set(profile,task);
  return task.then(()=>snapshot(profile));
 }
 const timer=setInterval(()=>{
  if(closed||!getCurrentProfile)return;const profile=getCurrentProfile();if(!profile||running.has(profile))return;
  const value=settings(profile),last=Date.parse(status(profile).lastRunAt??'');
  if(value.auto&&(!Number.isFinite(last)||clock()-last>=value.intervalMinutes*60_000))void refresh(profile,{reason:'auto'}).catch(()=>{});
 },tickMs);timer.unref?.();
 return {
  snapshot,
  refresh,
  configure(profile,input){if(!active(profile))throw Error('O perfil ativo mudou.');save(profile,{settings:validateRefreshSettings(input)});return snapshot(profile);},
  dismiss(profile){if(!active(profile))throw Error('O perfil ativo mudou.');save(profile,{status:{...status(profile),notices:[]}});return snapshot(profile);},
  async close(){closed=true;clearInterval(timer);await Promise.allSettled([...running.values()]);},
 };
}
