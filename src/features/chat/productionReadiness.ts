// B02 — "Pronto para produzir?" Pure view over the rows runtimeDiagnosticsView already builds from the existing
// local diagnostics endpoints. No new probes, no AI, no business rules: it only regroups what was verified.
import type {CapabilityRow,Fact} from './runtimeDiagnosticsView.ts';

export type ReadinessState='ready'|'blocked'|'unverified'|'unchecked';
export type ReadinessId='provider'|'ffmpeg'|'whisper'|'remotion'|'integrations'|'notion';
export interface ReadinessItem {id:ReadinessId;title:string;state:ReadinessState;stateLabel:string;detail:string;/** Where to fix it, in words; the UI shows the same place as a real control. */next?:string;optional?:boolean}
export interface ReadinessView {items:ReadinessItem[];summary:string;allChecked:boolean}

const stateText:Record<ReadinessState,[string,string]>={ready:['Pronto','Ready'],blocked:['Bloqueado','Blocked'],unverified:['Não comprovado','Not proven'],unchecked:['Ainda não verificado','Not checked yet']};
const fromFacts=(facts:Fact[]):ReadinessState=>facts.some(f=>f.state==='no')?'blocked':facts.some(f=>f.state==='unknown')?'unverified':facts.every(f=>f.state==='yes')&&facts.length?'ready':'unchecked';
const find=(rows:CapabilityRow[],id:string)=>rows.find(row=>row.id===id);
const fact=(row:CapabilityRow|undefined,...labels:string[])=>(row?.facts??[]).filter(f=>labels.some(label=>f.label.toLowerCase()===label.toLowerCase()));

/**
 * `rows` is the list RuntimeDiagnostics already shows (codex, claude, mcp:<server>, media).
 * Anything not verified stays `unchecked`/`unverified`; nothing becomes "ready" by assumption.
 */
export function productionReadiness(rows:CapabilityRow[],pt:boolean):ReadinessView{
 const t=(a:string,b:string)=>pt?a:b;
 const item=(id:ReadinessId,title:string,state:ReadinessState,detail:string,next?:string,optional?:boolean):ReadinessItem=>({id,title,state,stateLabel:t(...stateText[state]),detail,next,optional});
 const items:ReadinessItem[]=[];

 // Provider + sign-in: at least one of the two production providers must be fully ready.
 const codex=find(rows,'codex'),claude=find(rows,'claude');
 const providerRows=[codex,claude].filter((row):row is CapabilityRow=>!!row);
 const login=(row:CapabilityRow)=>fact(row,'Conta','Account','Login');
 const providerState=(row:CapabilityRow):ReadinessState=>row.level==='unchecked'?'unchecked':fromFacts([...fact(row,'Runtime','Instalação','Installation'),...login(row)]);
 const states=providerRows.map(providerState);
 const providerOverall:ReadinessState=states.includes('ready')?'ready':states.every(s=>s==='unchecked')?'unchecked':states.includes('unverified')?'unverified':'blocked';
 const providerDetail=providerRows.map(row=>`${row.title}: ${row.facts.filter(f=>['Runtime','Conta','Account','Login','Instalação','Installation'].includes(f.label)).map(f=>`${f.label} ${f.value}`).join(' · ')}`).join(' | ');
 items.push(item('provider',t('Provedor de IA e login','AI provider and sign-in'),providerOverall,providerDetail||t('Ainda não verificado.','Not checked yet.'),providerOverall==='ready'?undefined:(providerRows.map(row=>row.next?.text).filter(Boolean)[0]??t('Use “Verificar capacidades”.','Use “Check capabilities”.'))));

 const media=find(rows,'media');
 const mediaItem=(id:ReadinessId,title:string,labels:string[],optional?:boolean)=>{
  const facts=fact(media,...labels);
  const state:ReadinessState=!media||!facts.length||media.level==='unchecked'?'unchecked':fromFacts(facts);
  items.push(item(id,title,state,(facts.length===1?facts[0].value:facts.map(f=>`${f.label}: ${f.value}`).join(' · '))||t('Ainda não verificado.','Not checked yet.'),state==='ready'||state==='unchecked'?undefined:media?.next?.text,optional));
 };
 mediaItem('ffmpeg','FFmpeg',['ffmpeg','ffprobe']);
 mediaItem('whisper',t('Transcrição (Whisper)','Transcription (Whisper)'),['Transcrição (Whisper)','Transcription (Whisper)'],true);
 mediaItem('remotion',t('Animações (Remotion + navegador)','Animations (Remotion + browser)'),['Animações (Remotion + navegador)','Animations (Remotion + browser)'],true);

 // Integrations: only publishing providers the diagnostics already lists; a catalog without a real read is "not proven".
 const integrations=rows.filter(row=>row.kind==='mcp'&&['zernio','publora'].includes(row.title.toLowerCase()));
 if(!integrations.length)items.push(item('integrations',t('Integrações de publicação','Publishing integrations'),rows.some(row=>row.kind==='mcp')||codex?.level!=='unchecked'?'unverified':'unchecked',t('Nenhum provedor de publicação (Zernio ou Publora) apareceu nas ferramentas do Codex.','No publishing provider (Zernio or Publora) appeared in the Codex tools.'),t('Conecte um provedor nas configurações do Codex e verifique de novo.','Connect a provider in the Codex settings and check again.'),true));
 else{
  const levels=integrations.map(row=>row.level);
  const state:ReadinessState=levels.includes('ready')?'ready':levels.includes('unverified')?'unverified':levels.every(l=>l==='unchecked')?'unchecked':'blocked';
  items.push(item('integrations',t('Integrações de publicação','Publishing integrations'),state,integrations.map(row=>`${row.title}: ${row.levelLabel}`).join(' · '),state==='ready'?undefined:integrations.map(row=>row.next?.text).filter(Boolean)[0],true));
 }

 // B07: Notion is optional — only productions started in Notion mode need it; local mode never reads it.
 const notion=rows.find(row=>row.kind==='mcp'&&row.title.toLowerCase()==='notion');
 items.push(item('notion','Notion',!notion||notion.level==='unchecked'?'unchecked':notion.level==='ready'?'ready':notion.level==='unverified'?'unverified':'blocked',notion?t(`Opcional: só para produções no modo Notion. ${notion.levelLabel}.`,`Optional: only for productions in Notion mode. ${notion.levelLabel}.`):t('Opcional: o modo local produz sem Notion. Para usar o card, conecte o Notion nas ferramentas do Codex.','Optional: local mode produces without Notion. To use the card, connect Notion in Codex tools.'),notion&&notion.level!=='ready'?notion.next?.text:undefined,true));
 const required=items.filter(entry=>!entry.optional),blocked=required.filter(entry=>entry.state==='blocked'),notProven=items.filter(entry=>entry.state==='unverified'||(entry.optional&&entry.state==='blocked'));
 const allChecked=items.every(entry=>entry.state!=='unchecked');
 const summary=items.every(entry=>entry.state==='unchecked')?t('Nada verificado ainda. A verificação é manual e não usa IA.','Nothing checked yet. The check is manual and uses no AI.')
  :blocked.length?t(`${blocked.length} item(ns) obrigatório(s) bloqueiam a produção.`,`${blocked.length} required item(s) block production.`)
  :notProven.length||!allChecked?t('Nenhum bloqueio verificado; há itens opcionais ou ainda não comprovados.','No verified blocker; some items are optional or not proven yet.')
  :t('Tudo verificado está pronto para produzir.','Everything checked is ready to produce.');
 return {items,summary,allChecked};
}
