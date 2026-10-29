import {useEffect,useState} from 'react';
import {readCodexUsage,type CodexUsage} from '../chat/codexUsage';
import {readClaudeUsage,usageReportedEvent,type UsageProvider} from './usageLedger';

export type ProviderLimits=CodexUsage&{observedAt?:string|null;source?:'account';stale?:boolean;error?:string};
export const usageProviderKey='usage-provider';

/** Plan limits read from the connected accounts, refreshed while mounted. */
export function useProviderUsage(provider:UsageProvider,{enabled=true,intervalMs=120_000,refresh=0}:{enabled?:boolean;intervalMs?:number;refresh?:number}={}){
 const [usage,setUsage]=useState<ProviderLimits|null>(null),[error,setError]=useState(false),[loading,setLoading]=useState(false);
 useEffect(()=>{
  if(!enabled)return;
  const controller=new AbortController();
  setUsage(null);setError(false);
  const load=(force=false)=>{setLoading(true);(provider==='claude'?readClaudeUsage(controller.signal,force):readCodexUsage(controller.signal))
   .then(result=>{if(!controller.signal.aborted){setUsage(result);setError(false);}})
   .catch(()=>{if(!controller.signal.aborted)setError(true);})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);});};
  load(refresh>0);
  const timer=window.setInterval(()=>load(),intervalMs);
  // A reply of this provider just reported usage: re-read now (Codex settles its counters shortly after the turn ends).
  let soon:number|undefined;
  const live=(event:Event)=>{if((event as CustomEvent<UsageProvider>).detail!==provider)return;window.clearTimeout(soon);load(true);if(provider==='codex')soon=window.setTimeout(()=>load(),2500);};
  window.addEventListener(usageReportedEvent,live);
  return()=>{controller.abort();window.clearInterval(timer);window.clearTimeout(soon);window.removeEventListener(usageReportedEvent,live);};
 },[provider,enabled,intervalMs,refresh]);
 return {usage,error,loading};
}
