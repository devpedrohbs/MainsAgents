import {useCallback,useEffect,useState} from 'react';
import {storageProfile} from '../../data/IndexedDbStateStore';
import type {PublicationDelivery} from '../../features/content/model';

interface Result {id:string;state:'updated'|'unchanged'|'unknown'|'attention'|'skipped'|'busy'|'stopped';status?:string;external?:string;error?:string;at?:string}
interface Snapshot {settings:{auto:boolean;intervalMinutes:number};status:{lastRunAt:string|null;lastReason?:string;checked?:number;results:Result[];notices?:Result[];running?:boolean};cached?:boolean}
const intervals=[5,15,30,60];
const profile=()=>window.mainsAgentsDesktop?.state?storageProfile():localStorage.getItem('mainsagents-profile')||'default';
async function call(path:string,body?:Record<string,unknown>):Promise<Snapshot>{
 const response=await fetch(`/api/content/publishing/${path}?profile=${encodeURIComponent(profile())}`,{cache:'no-store',...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});
 const value=await response.json();if(!response.ok)throw Error(value.error??String(response.status));if(!value?.settings||!value?.status)throw Error('Resposta de status inválida.');return value;
}

/**
 * B10: read-only status of scheduled deliveries. Checks on open (cached 1 min), on demand and — while the app is open —
 * at the chosen interval. Nothing here creates, edits, cancels or resends; a failed check keeps the known state.
 */
export function PublicationStatusRefresh({deliveries,pt}:{deliveries:PublicationDelivery[];pt:boolean}){
 const say=(a:string,b:string)=>pt?a:b;
 const [snap,setSnap]=useState<Snapshot|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const run=useCallback(async(task:()=>Promise<Snapshot>)=>{setBusy(true);setError('');try{setSnap(await task())}catch(failure){setError((failure as Error).message)}finally{setBusy(false)}},[]);
 const watched=deliveries.filter(d=>d.status==='scheduled'&&d.operation?.phase==='confirmed');
 useEffect(()=>{if(watched.length)void run(()=>call('status',{reason:'open'}));else void call('status').then(setSnap).catch(()=>{});},[watched.length,run]);// eslint-disable-line react-hooks/exhaustive-deps
 const mine=new Set(deliveries.map(d=>d.id)),platform=(id:string)=>deliveries.find(d=>d.id===id)?.platform??id;
 const notices=(snap?.status.notices??[]).filter(n=>mine.has(n.id));
 const when=snap?.status.lastRunAt?new Date(snap.status.lastRunAt).toLocaleTimeString(pt?'pt-BR':'en-US',{hour:'2-digit',minute:'2-digit'}):null;
 const text=(n:Result)=>n.state==='updated'?(n.status==='published'?say('publicado (recibo confirmado pelo provedor)','published (receipt confirmed by the provider)'):say('falhou segundo o provedor','failed according to the provider')):n.state==='attention'?say(`o provedor mostra “${n.external}”; nada foi alterado aqui, confira no provedor`,`the provider shows “${n.external}”; nothing was changed here, check the provider`):say('não foi possível consultar; o estado agendado foi mantido','could not check; the scheduled state was kept');
 if(!watched.length&&!notices.length)return null;
 return <div className="publication-status-refresh" aria-label={say('Atualização de status','Status refresh')}>
  <p className="editorial-hint">{say('Status consultado só por leitura nos provedores já configurados; nenhum envio, edição ou cancelamento é feito por aqui.','Status is only read from the configured providers; nothing is sent, edited or canceled from here.')} {when?say(`Última consulta: ${when}${snap?.cached?' (em cache)':''}.`,`Last check: ${when}${snap?.cached?' (cached)':''}.`):say('Ainda não consultado.','Not checked yet.')}</p>
  <div className="editorial-actions">
   <button type="button" className="soft-button" disabled={busy||!watched.length} onClick={()=>void run(()=>call('status',{reason:'manual'}))}>{busy?say('Consultando…','Checking…'):say('Atualizar status agora','Refresh status now')}</button>
   {snap&&<label className="production-check"><input type="checkbox" checked={snap.settings.auto} disabled={busy} onChange={event=>void run(()=>call('status/settings',{auto:event.target.checked,intervalMinutes:snap.settings.intervalMinutes}))}/>{say('Atualizar automaticamente enquanto o app estiver aberto, a cada','Refresh automatically while the app is open, every')}</label>}
   {snap&&<select aria-label={say('Intervalo de atualização','Refresh interval')} value={snap.settings.intervalMinutes} disabled={busy||!snap.settings.auto} onChange={event=>void run(()=>call('status/settings',{auto:snap.settings.auto,intervalMinutes:Number(event.target.value)}))}>{intervals.map(m=><option key={m} value={m}>{m} min</option>)}</select>}
  </div>
  {notices.length>0&&<ul className="publication-status-notices" role="status">{notices.map(n=><li key={`${n.id}-${n.at}-${n.state}`} data-state={n.state}><b>{platform(n.id)}</b>: {text(n)}{n.error?` (${n.error})`:''}</li>)}</ul>}
  {notices.length>0&&<button type="button" className="text-link" disabled={busy} onClick={()=>void run(()=>call('status/dismiss',{}))}>{say('Limpar avisos','Clear notices')}</button>}
  {error&&<p className="delivery-error" role="alert">{error}</p>}
 </div>;
}
