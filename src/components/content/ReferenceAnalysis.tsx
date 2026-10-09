import {useCallback,useEffect,useRef,useState} from 'react';
import {storageProfile} from '../../data/IndexedDbStateStore';
import type {InspirationReference} from '../../features/content/inspiration';

export interface ReferenceAnalysis {
 id:string;workspaceId:string;referenceId:string;referenceRevision:number;status:'running'|'done'|'failed'|'canceled'|'interrupted';phase?:string;
 source:{assetId:string;versionId:string;sha256:string};agent:{id:string;name:string;providerId:string;modelId?:string};providerLabel?:string;
 coverage?:{transcript:string;timing:string;sceneDetection:string;frames:string;transcriptChars:number};
 evidence?:{durationSeconds:number;pauses:{count:number;totalSeconds:number;longestSeconds:number};sceneChanges:number[];cutsPerMinute:number;words?:number;wordsPerMinute?:number};
 result?:{hook:{text:string;startSeconds:number;endSeconds:number;why:string};rhythm:{pace:string;summary:string};structure:Array<{label:string;startSeconds:number;endSeconds:number;summary:string}>;takeaways:string[];limitations:string[]};
 limitations:string[];error?:string;imported?:boolean;current?:boolean;briefings?:Array<{topicId:string;linkedAt:string;unlinkedAt?:string}>;createdAt:string;finishedAt?:string;
 usage?:{status:string;tokens?:{input?:number;output?:number}};
}
const profile=()=>window.mainsAgentsDesktop?.state?storageProfile():localStorage.getItem('mainsagents-profile')||'default';
async function api(body?:Record<string,unknown>):Promise<{analyses:ReferenceAnalysis[]}>{
 const response=await fetch(`/api/content/inspiration/analyses?profile=${encodeURIComponent(profile())}`,{cache:'no-store',...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});
 const value=await response.json();if(!response.ok)throw Error(value.error??String(response.status));return {analyses:Array.isArray(value.analyses)?value.analyses:[]};
}

/** Server-owned analyses; polled only while one is running. */
export function useReferenceAnalyses(){
 const [analyses,setAnalyses]=useState<ReferenceAnalysis[]>([]),live=useRef(true);
 const reload=useCallback(async()=>{try{const value=await api();if(live.current)setAnalyses(value.analyses);}catch{/* keeps the last known list */}},[]);
 const act=useCallback(async(body:Record<string,unknown>)=>{const value=await api(body);if(live.current)setAnalyses(value.analyses);},[]);
 useEffect(()=>{live.current=true;void reload();return()=>{live.current=false}},[reload]);
 const running=analyses.some(item=>item.status==='running');
 useEffect(()=>{if(!running)return;const timer=setInterval(()=>void reload(),1200);return()=>clearInterval(timer)},[running,reload]);
 return {analyses,act,reload};
}

const fmt=(s:number)=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
/**
 * B09 panel for one reference. Link-only references are never fetched or analyzed. A local video is analyzed only after
 * the user picks an agent and authorizes one AI call; evidence (FFmpeg timing + local Whisper) stays local and visible.
 */
export function ReferenceAnalysisPanel({reference,analyses,act,agents,topics,pt}:{reference:InspirationReference;analyses:ReferenceAnalysis[];act:(body:Record<string,unknown>)=>Promise<void>;agents:Array<{id:string;name:string;providerId?:string;modelId?:string}>;topics:Array<{id:string;title:string}>;pt:boolean}){
 const say=(a:string,b:string)=>pt?a:b;
 const mine=analyses.filter(item=>item.referenceId===reference.id),latest=mine[0];
 const [agentId,setAgentId]=useState(''),[authorize,setAuthorize]=useState(false),[topicId,setTopicId]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const usable=agents.filter(agent=>['codex','claude'].includes(agent.providerId??'codex'));
 const run=async(body:Record<string,unknown>)=>{setBusy(true);setError('');try{await act(body)}catch(failure){setError((failure as Error).message)}finally{setBusy(false)}};
 if(!reference.asset)return <p className="inspiration-meta reference-analysis-none">{say('Não analisado: links não são acessados, baixados nem raspados. Para analisar, adicione o vídeo autorizado ao workspace e vincule-o aqui.','Not analyzed: links are never accessed, downloaded or scraped. To analyze, add the authorized video to the workspace and link it here.')}</p>;
 const r=latest?.result,linked=(latest?.briefings??[]).filter(link=>!link.unlinkedAt);
 return <div className="reference-analysis" aria-label={say('Análise da referência','Reference analysis')}>
  {!latest&&<p className="inspiration-meta">{say('Ainda sem análise.','Not analyzed yet.')}</p>}
  {latest?.status==='running'&&<p role="status">{latest.phase==='ai'?say(`Enviando a análise ao ${latest.providerLabel??latest.agent.name}…`,`Sending the analysis to ${latest.providerLabel??latest.agent.name}…`):say('Medindo tempos e transcrevendo localmente…','Measuring timing and transcribing locally…')} <button type="button" className="text-link" disabled={busy} onClick={()=>void run({action:'cancel',analysisId:latest.id})}>{say('Cancelar','Cancel')}</button></p>}
  {latest&&['failed','canceled','interrupted'].includes(latest.status)&&<p className={latest.status==='failed'?'inspiration-error':'inspiration-meta'} role={latest.status==='failed'?'alert':'status'}>{latest.status==='failed'?latest.error:latest.status==='canceled'?say('Análise cancelada; nada foi salvo.','Analysis canceled; nothing was saved.'):say('Análise interrompida; autorize de novo se quiser.','Analysis interrupted; authorize again if you want.')}</p>}
  {latest?.status==='done'&&r&&<div className="reference-analysis-result">
   <p className="inspiration-meta">{say(`Analisado por ${latest.agent.name} (${latest.providerLabel??latest.agent.providerId}${latest.agent.modelId?` · ${latest.agent.modelId}`:''}) em ${new Date(latest.finishedAt??latest.createdAt).toLocaleString('pt-BR')}`,`Analyzed by ${latest.agent.name} (${latest.providerLabel??latest.agent.providerId}${latest.agent.modelId?` · ${latest.agent.modelId}`:''}) on ${new Date(latest.finishedAt??latest.createdAt).toLocaleString('en-US')}`)} · {say('vídeo','video')} #{latest.source.sha256.slice(0,8)}{latest.imported?say(' · histórico importado',' · imported history'):''}{latest.current===false?say(' · desatualizada (referência ou vídeo mudou)',' · stale (reference or video changed)'):''}</p>
   <dl>
    <dt>{say('Gancho','Hook')} ({fmt(r.hook.startSeconds)}–{fmt(r.hook.endSeconds)})</dt><dd>{r.hook.text?`“${r.hook.text}” — `:''}{r.hook.why}</dd>
    <dt>{say('Ritmo','Rhythm')}</dt><dd>{r.rhythm.pace} — {r.rhythm.summary}{latest.evidence?say(` (medido: ${latest.evidence.pauses.count} pausas, ${latest.evidence.cutsPerMinute} mudanças de cena/min${latest.evidence.wordsPerMinute?`, ${latest.evidence.wordsPerMinute} palavras/min`:''})`,` (measured: ${latest.evidence.pauses.count} pauses, ${latest.evidence.cutsPerMinute} scene changes/min${latest.evidence.wordsPerMinute?`, ${latest.evidence.wordsPerMinute} words/min`:''})`):''}</dd>
    <dt>{say('Estrutura','Structure')}</dt><dd><ol>{r.structure.map((part,index)=><li key={index}><b>{part.label}</b> ({fmt(part.startSeconds)}–{fmt(part.endSeconds)}): {part.summary}</li>)}</ol></dd>
    {r.takeaways.length>0&&<><dt>{say('Padrões reaproveitáveis','Reusable patterns')}</dt><dd><ul>{r.takeaways.map((item,index)=><li key={index}>{item}</li>)}</ul></dd></>}
   </dl>
   <p className="inspiration-meta">{say('Cobertura','Coverage')}: {say('transcrição','transcript')} {latest.coverage?.transcript} · {say('tempos','timing')} FFmpeg · {say('quadros não enviados','frames not sent')}. {say('Limites','Limits')}: {[...latest.limitations,...r.limitations].join(' ')}</p>
   <div className="reference-analysis-briefing">
    <label>{say('Usar esta análise como briefing da ideia','Use this analysis as briefing for the idea')}<select aria-label={say('Ideia para o briefing','Idea for the briefing')} value={topicId} disabled={busy} onChange={event=>setTopicId(event.target.value)}><option value="">{say('Escolher ideia','Choose idea')}</option>{topics.map(topic=><option key={topic.id} value={topic.id}>{topic.title}</option>)}</select></label>
    <button type="button" className="soft-button" disabled={busy||!topicId||latest.imported||latest.current===false} onClick={()=>void run({action:'link',analysisId:latest.id,topicId}).then(()=>setTopicId(''))}>{say('Vincular','Link')}</button>
    {linked.map(link=><span key={link.topicId} className="reference-analysis-link">{topics.find(topic=>topic.id===link.topicId)?.title??link.topicId} <button type="button" className="text-link" disabled={busy} onClick={()=>void run({action:'unlink',analysisId:latest.id,topicId:link.topicId})}>{say('Desvincular','Unlink')}</button></span>)}
    {(latest.imported||latest.current===false)&&<p className="inspiration-meta">{say('Para usar como briefing, autorize uma nova análise da versão atual.','To use it as briefing, authorize a new analysis of the current version.')}</p>}
   </div>
  </div>}
  {latest?.status!=='running'&&<div className="reference-analysis-start">
   <label>{say('Agente','Agent')}<select aria-label={say('Agente da análise','Analysis agent')} value={agentId} disabled={busy} onChange={event=>{setAgentId(event.target.value);setAuthorize(false)}}><option value="">{say('Escolher agente','Choose agent')}</option>{usable.map(agent=><option key={agent.id} value={agent.id}>{agent.name} ({agent.providerId==='claude'?'Claude Code':'Codex'}{agent.modelId?` · ${agent.modelId}`:''})</option>)}</select></label>
   <label className="production-check"><input type="checkbox" checked={authorize} disabled={busy||!agentId} onChange={event=>setAuthorize(event.target.checked)}/>{say('Autorizo uma chamada de IA deste agente com a transcrição local e os tempos medidos (nenhuma imagem é enviada).','I authorize one AI call of this agent with the local transcript and measured timing (no image is sent).')}</label>
   <button type="button" className="primary-button" disabled={busy||!agentId||!authorize} onClick={()=>void run({action:'analyze',workspaceId:reference.workspaceId,referenceId:reference.id,referenceRevision:reference.revision,agentId,requestKey:crypto.randomUUID(),authorize:true,language:pt?'pt-BR':'en-US'}).then(()=>setAuthorize(false))}>{latest?say('Analisar de novo','Analyze again'):say('Analisar gancho, ritmo e estrutura','Analyze hook, rhythm and structure')}</button>
  </div>}
  {error&&<p role="alert" className="inspiration-error">{error}</p>}
 </div>;
}
