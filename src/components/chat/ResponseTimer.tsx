import {useEffect,useState} from 'react';
import type {AgentSession} from '../../features/chat/model/Chat';
import {formatResponseDuration,responseElapsedMs} from '../../features/chat/responseTiming';
import {useLanguage} from '../../app/LanguageProvider';
import '../../styles/response-timer.css';

export function ResponseTimer({timing}:{timing:AgentSession['responseTiming']}){
 const {locale}=useLanguage(),pt=locale==='pt-BR';
 const [now,setNow]=useState(Date.now);
 useEffect(()=>{setNow(Date.now());if(!timing||timing.endedAt)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[timing?.id,timing?.endedAt]);
 if(!timing)return null;
 const running=!timing.endedAt,label=running?(pt?'Em andamento':'Running'):timing.outcome==='completed'?(pt?'Concluído em':'Completed in'):timing.outcome==='interrupted'?(pt?'Interrompido após':'Interrupted after'):(pt?'Falhou após':'Failed after');
 return <div className="chat-response-timer" data-running={running} title={pt?'Tempo total desta resposta, incluindo ferramentas e espera por aprovação.':'Total response time, including tools and waiting for approval.'}><span>{label}</span><time>{formatResponseDuration(responseElapsedMs(timing,now))}</time></div>;
}
