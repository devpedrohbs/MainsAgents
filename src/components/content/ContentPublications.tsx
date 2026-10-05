import {useEffect,useState} from 'react';
import {useContentWorkflow} from '../../features/content/ContentWorkflowProvider';
import {useLanguage} from '../../app/LanguageProvider';
import type {EditorialContent,PublicationDelivery,PublicationStatus,Platform} from '../../features/content/model';
import {publicationPlatforms} from '../../../publication-model.mjs';
import {localTimeToInstant,zonedDateTime} from '../../../publication-time.mjs';
import {SelectMenu} from '../common/SelectMenu';
import {FlowDialog} from '../common/FlowDialog';
import './content-publications.css';

const labels:Record<PublicationStatus,[string,string]>={draft:['Rascunho','Draft'],'in-review':['Em revisão','In review'],approved:['Aprovado para envio','Approved to send'],sending:['Envio pendente','Sending'],scheduled:['Agendamento confirmado','Schedule confirmed'],published:['Publicado','Published'],failed:['Falha','Failed']};
export const publicationLabel=(status:PublicationStatus,pt:boolean)=>labels[status][pt?0:1];
const defaultZone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone||'America/Sao_Paulo';
const zones=['America/Sao_Paulo','America/Manaus','America/Recife','America/New_York','Europe/Lisbon','UTC'];

export function ContentPublications({content}:{content:EditorialContent}){
  const {state,publicationCommand}=useContentWorkflow(),{locale}=useLanguage(),pt=locale==='pt-BR';
  const [editing,setEditing]=useState<PublicationDelivery|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const deliveries=(state.publications??[]).filter(item=>item.contentId===content.id&&item.workspaceId===content.workspaceId);
  const add=async(platform:Platform)=>{setBusy(true);setError('');try{const timeZone=defaultZone();await publicationCommand({action:'create',contentId:content.id,platform,draft:{text:'',assetIds:[],timeZone}})}catch(failure){setError(String((failure as Error).message))}finally{setBusy(false)}};
  return <section className="editorial-card content-publications" aria-label={pt?'Entregas por rede':'Network deliveries'}>
    <div className="editorial-section-head"><div><h2>{pt?'Entregas por rede':'Network deliveries'}</h2><p className="editorial-hint">{pt?'Revise texto, arquivos e horário de cada rede. Um horário planejado ainda não é um agendamento.':'Review text, files and time for each network. A planned time is not a confirmed schedule.'}</p></div><button type="button" className="text-link" onClick={()=>window.dispatchEvent(new CustomEvent('mainsagents:publication-calendar'))}>{pt?'Ver calendário':'View calendar'}</button></div>
    <div className="publication-rows">{deliveries.map(item=><button type="button" className="publication-row" key={item.id} onClick={()=>setEditing(structuredClone(item))}><b>{item.platform}</b><span>{publicationLabel(item.status,pt)}<small>v{item.version}{item.plannedAt?` · ${pt?'Planejado':'Planned'}: ${new Date(item.plannedAt).toLocaleString(locale,{timeZone:item.timeZone})} (${item.timeZone})`:''}</small></span><span>{pt?'Abrir':'Open'}</span></button>)}</div>
    <div className="editorial-actions">{publicationPlatforms.filter(platform=>!deliveries.some(item=>item.platform===platform)).map(platform=><button type="button" className="soft-button" key={platform} disabled={busy} onClick={()=>void add(platform as Platform)}>+ {platform}</button>)}</div>
    {error&&<p className="delivery-error" role="alert">{error}</p>}
    {editing&&<PublicationEditor delivery={editing} onClose={()=>setEditing(null)}/>}
  </section>;
}

export function PublicationEditor({delivery,onClose}:{delivery:PublicationDelivery;onClose:()=>void}){
  const {state,publicationCommand}=useContentWorkflow(),{locale}=useLanguage(),pt=locale==='pt-BR';
  const [snapshot,setSnapshot]=useState(delivery),[text,setText]=useState(delivery.text),[timeZone,setTimeZone]=useState(delivery.timeZone);
  const [planned,setPlanned]=useState(zonedDateTime(delivery.plannedAt,delivery.timeZone)),[selected,setSelected]=useState(delivery.media.map(item=>item.assetId));
  const [notes,setNotes]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
  const live=(state.publications??[]).find(item=>item.id===delivery.id);
  const stale=JSON.stringify(live)!==JSON.stringify(snapshot);
  const assets=(state.assets??[]).filter(item=>item.contentId===delivery.contentId&&item.workspaceId===delivery.workspaceId);
  const changed=text!==snapshot.text||timeZone!==snapshot.timeZone||planned!==zonedDateTime(snapshot.plannedAt,snapshot.timeZone)||JSON.stringify(selected)!==JSON.stringify(snapshot.media.map(item=>item.assetId));
  const locked=['sending','scheduled','published'].includes(snapshot.status);
  const command=async(action:string)=>{setBusy(true);setSaved(false);setError('');try{
    await publicationCommand({action,id:snapshot.id,contentId:snapshot.contentId,expectedDelivery:snapshot,notes,draft:{text,timeZone,plannedAt:localTimeToInstant(planned,timeZone),assetIds:selected}});
    // State arrives through the provider. Close after a decision to prevent stale double submission.
    if(action!=='edit')onClose();else setSaved(true);
  }catch(failure){setError(String((failure as Error).message))}finally{setBusy(false)}};
  // Refresh only after our own save, never silently replace a version under review.
  useEffect(()=>{if(saved&&live&&JSON.stringify(live)!==JSON.stringify(snapshot)){setSnapshot(structuredClone(live));setSaved(false)}},[saved,live,snapshot]);
  return <FlowDialog title={`${delivery.platform} · ${pt?'Entrega':'Delivery'}`} description={`${state.contents.find(item=>item.id===delivery.contentId)?.title??''} · v${snapshot.version} · ${publicationLabel(snapshot.status,pt)}`} onClose={()=>{if(!busy)onClose()}}><div className="delivery-review-fields publication-editor">
    {stale&&!saved&&<p role="alert" className="delivery-error">{pt?'Esta entrega mudou. Feche e abra novamente para revisar a versão atual.':'This delivery changed. Close and reopen to review the current version.'}</p>}
    <label>{pt?'Texto da publicação':'Post text'}<textarea aria-label={pt?'Texto da publicação':'Post text'} value={text} disabled={locked||busy} onChange={event=>setText(event.target.value)}/></label>
    <fieldset className="publication-files"><legend>{pt?'Arquivos desta entrega':'Delivery files'}</legend>{assets.length?assets.map(asset=><label key={asset.id}><input type="checkbox" disabled={locked||busy||asset.status!=='available'} checked={selected.includes(asset.id)} onChange={()=>setSelected(items=>items.includes(asset.id)?items.filter(id=>id!==asset.id):[...items,asset.id])}/>{asset.name}<small>{asset.status}</small></label>):<p className="editorial-hint">{pt?'Adicione arquivos na biblioteca do conteúdo para selecioná-los aqui.':'Add files to the content library to select them here.'}</p>}{selected.some(id=>!assets.some(asset=>asset.id===id))&&<p role="alert">{pt?'Um arquivo foi removido.':'A file was removed.'}<button className="text-link" onClick={()=>setSelected(items=>items.filter(id=>assets.some(asset=>asset.id===id)))}>{pt?'Remover vínculo ausente':'Remove missing link'}</button></p>}</fieldset>
    <label>{pt?'Fuso do horário planejado':'Planned time zone'}<SelectMenu ariaLabel={pt?'Fuso horário':'Time zone'} value={timeZone} disabled={locked||busy} onChange={zone=>{if(planned){try{const instant=localTimeToInstant(planned,timeZone);setPlanned(zonedDateTime(instant,zone));}catch{setPlanned('');}}setTimeZone(zone)}} options={[...new Set([timeZone,...zones])].map(value=>({value,label:value}))}/></label>
    <label>{pt?'Data e hora planejadas':'Planned date and time'}<input type="datetime-local" aria-label={pt?'Data e hora planejadas':'Planned date and time'} value={planned} disabled={locked||busy} onChange={event=>setPlanned(event.target.value)}/></label>
    <p className="editorial-hint">{pt?'Salvar ou aprovar organiza esta entrega localmente. O envio ao Publora terá uma autorização separada.':'Saving or approving organizes this delivery locally. Sending to Publora will require separate authorization.'}</p>
    <label>{pt?'Observação da revisão':'Review note'}<textarea value={notes} disabled={locked||busy} onChange={event=>setNotes(event.target.value)}/></label>
    {error&&<p role="alert" className="delivery-error">{error}</p>}
    {snapshot.history.length>0&&<details><summary>{pt?'Versões e decisões':'Versions and decisions'}</summary>{[...snapshot.history].reverse().map((entry,index)=><div className="publication-history" key={index}><b>v{entry.version} · {publicationLabel(entry.status,pt)}</b><small>{new Date(entry.at).toLocaleString(locale)}</small><p>{entry.notes}</p><details><summary>{pt?'Texto revisado':'Reviewed text'}</summary><p>{entry.payload?.text}</p></details></div>)}</details>}
  </div><footer className="delivery-review-footer publication-footer">
    <button className="soft-button" disabled={busy||stale||locked||!changed} onClick={()=>void command('edit')}>{pt?'Salvar alterações':'Save changes'}</button>
    {snapshot.status==='draft'&&<button className="primary-button" disabled={busy||stale||changed||!text.trim()&&!selected.length} onClick={()=>void command('submit')}>{pt?'Enviar para revisão':'Submit for review'}</button>}
    {snapshot.status==='in-review'&&<><button className="soft-button" disabled={busy||stale||changed} onClick={()=>void command('revise')}>{pt?'Pedir ajuste':'Request changes'}</button><button className="soft-button" disabled={busy||stale||changed} onClick={()=>void command('reject')}>{pt?'Rejeitar':'Reject'}</button><button className="primary-button" disabled={busy||stale||changed} onClick={()=>void command('approve')}>{pt?'Aprovar esta entrega':'Approve delivery'}</button></>}
  </footer></FlowDialog>;
}

export function PublicationCalendar({workspaceId}:{workspaceId:string}){
  const {state}=useContentWorkflow(),{locale}=useLanguage(),pt=locale==='pt-BR';
  const [zone,setZone]=useState(defaultZone),[month,setMonth]=useState(()=>zonedDateTime(new Date().toISOString(),defaultZone()).slice(0,7)),[editing,setEditing]=useState<PublicationDelivery|null>(null);
  const deliveries=(state.publications??[]).filter(item=>item.workspaceId===workspaceId);
  const [year,number]=month.split('-').map(Number),days=new Date(Date.UTC(year,number,0)).getUTCDate(),offset=(new Date(Date.UTC(year,number-1,1)).getUTCDay()+6)%7;
  const dateOf=(item:PublicationDelivery)=>zonedDateTime(item.plannedAt,zone).slice(0,10);
  const move=(delta:number)=>{const value=new Date(Date.UTC(year,number-1+delta,1));setMonth(value.toISOString().slice(0,7))};
  const tile=(item:PublicationDelivery)=><button type="button" className="calendar-delivery" key={item.id} onClick={()=>setEditing(structuredClone(item))}><b>{state.contents.find(content=>content.id===item.contentId)?.title}</b><span>{item.platform} · {publicationLabel(item.status,pt)}</span><small>{item.plannedAt?`${item.receipt?(pt?'Confirmado':'Confirmed'):(pt?'Planejado':'Planned')} ${zonedDateTime(item.plannedAt,zone).slice(11)}`:(pt?'Sem horário':'No time')}</small></button>;
  return <section className="editorial-card publication-calendar" aria-label={pt?'Calendário de entregas':'Delivery calendar'}><div className="editorial-section-head"><div><h2>{pt?'Calendário de entregas':'Delivery calendar'}</h2><p className="editorial-hint">{pt?'Os horários abaixo são planejamento local. Confirmações externas aparecem somente com recibo do provedor.':'Times below are local plans. External confirmations require a provider receipt.'}</p></div><SelectMenu ariaLabel={pt?'Fuso do calendário':'Calendar time zone'} value={zone} onChange={setZone} options={[...new Set([zone,...zones])].map(value=>({value,label:value}))}/></div><nav className="calendar-month" aria-label={pt?'Navegar meses':'Browse months'}><button className="soft-button" aria-label={pt?'Mês anterior':'Previous month'} onClick={()=>move(-1)}>‹</button><strong>{new Date(Date.UTC(year,number-1,15)).toLocaleDateString(locale,{month:'long',year:'numeric',timeZone:'UTC'})}</strong><button className="soft-button" aria-label={pt?'Próximo mês':'Next month'} onClick={()=>move(1)}>›</button></nav>
    <div className="calendar-grid">{(pt?['Seg','Ter','Qua','Qui','Sex','Sáb','Dom']:['Mon','Tue','Wed','Thu','Fri','Sat','Sun']).map(day=><span className="calendar-weekday" key={day}>{day}</span>)}{Array.from({length:offset},(_,index)=><div className="calendar-spacer" key={`empty-${index}`}/>)}{Array.from({length:days},(_,index)=>{const day=String(index+1).padStart(2,'0'),date=`${month}-${day}`;return <div className="calendar-day" key={date} aria-label={date}><time dateTime={date}>{index+1}</time>{deliveries.filter(item=>dateOf(item)===date).sort((a,b)=>a.plannedAt!.localeCompare(b.plannedAt!)).map(tile)}</div>})}</div>
    <div className="calendar-agenda"><h3>{pt?'Agenda do mês':'Monthly agenda'}</h3>{deliveries.filter(item=>dateOf(item).startsWith(month)).sort((a,b)=>a.plannedAt!.localeCompare(b.plannedAt!)).map(item=><div key={item.id}><time>{new Date(item.plannedAt!).toLocaleDateString(locale,{timeZone:zone})}</time>{tile(item)}</div>)}</div>
    <details className="calendar-unscheduled" open><summary>{pt?'Sem horário planejado':'No planned time'} ({deliveries.filter(item=>!item.plannedAt).length})</summary><div>{deliveries.filter(item=>!item.plannedAt).map(tile)}</div></details>
    {!deliveries.length&&<p className="editorial-hint">{pt?'Abra um conteúdo e adicione uma entrega por rede para começar.':'Open content and add a network delivery to begin.'}</p>}
    {editing&&<PublicationEditor delivery={editing} onClose={()=>setEditing(null)}/>}
  </section>;
}
