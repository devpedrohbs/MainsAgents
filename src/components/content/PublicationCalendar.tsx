import {useRef,useState} from 'react';
import {useContentWorkflow} from '../../features/content/ContentWorkflowProvider';
import {useLanguage} from '../../app/LanguageProvider';
import type {PublicationDelivery} from '../../features/content/model';
import {zonedDateTime} from '../../../publication-time.mjs';
import {publicationPlatforms} from '../../../publication-model.mjs';
import {PublicationEditor,publicationLabel} from './ContentPublications';
import {ProviderCalendar} from './ProviderCalendar';
import {PublicationTile,NetworkLogo,PostCover,imagePreviewUrl} from './PublicationTile';
import {SelectMenu} from '../common/SelectMenu';
import {FlowDialog} from '../common/FlowDialog';
import {Icon} from '../common/Icon';
import './publication-calendar.css';

type CalendarView='month'|'week'|'agenda';
const defaultZone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone||'America/Sao_Paulo';
const zones=['America/Sao_Paulo','America/Manaus','America/Recife','America/New_York','Europe/Lisbon','UTC'];
const asDate=(day:string)=>new Date(`${day}T12:00:00Z`);
const addDays=(day:string,days:number)=>{const d=asDate(day);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)};
const weekStart=(day:string)=>addDays(day,-((asDate(day).getUTCDay()+6)%7));

export function PublicationCalendar({workspaceId}:{workspaceId:string}) {
  const {state}=useContentWorkflow(),{locale}=useLanguage(),pt=locale==='pt-BR';
  const [zone,setZone]=useState(defaultZone);
  const today=zonedDateTime(new Date().toISOString(),zone).slice(0,10);
  const [anchor,setAnchor]=useState(today),[view,setView]=useState<CalendarView>('month');
  const [network,setNetwork]=useState('all'),[status,setStatus]=useState('all'),[query,setQuery]=useState('');
  const [selectedDay,setSelectedDay]=useState(today),[previewId,setPreviewId]=useState<string>(),[editingId,setEditingId]=useState<string>();
  const [covers,setCovers]=useState<Record<string,string>>({}),[coverError,setCoverError]=useState('');
  const coverInput=useRef<HTMLInputElement>(null);
  const deliveries=(state.publications??[]).filter(item=>item.workspaceId===workspaceId);
  const title=(item:PublicationDelivery)=>state.contents.find(c=>c.id===item.contentId)?.title||item.text.split('\n')[0]||(pt?'Publicação':'Publication');
  const dateOf=(item:PublicationDelivery)=>zonedDateTime(item.plannedAt,zone).slice(0,10);
  const timeOf=(item:PublicationDelivery)=>item.plannedAt?zonedDateTime(item.plannedAt,zone).slice(11,16):undefined;
  const coverOf=(item:PublicationDelivery)=>{
    if(covers[item.id])return covers[item.id];
    for(const media of item.media){
      const asset=state.assets?.find(a=>a.id===media.assetId&&a.contentId===item.contentId&&a.workspaceId===workspaceId);
      const preview=imagePreviewUrl(asset?.thumbnailUrl)||imagePreviewUrl(asset?.kind==='image'?asset.versions.find(v=>v.id===media.versionId)?.path:undefined);
      if(preview)return preview;
    }
    const uploaded=imagePreviewUrl(item.operation?.uploads?.find(upload=>upload.type==='image'&&upload.status==='uploaded')?.url);
    // Reference artwork can illustrate a draft without becoming its delivered media.
    const reference=state.assets?.find(a=>a.contentId===item.contentId&&a.workspaceId===workspaceId&&a.thumbnailUrl);
    return uploaded||imagePreviewUrl(reference?.thumbnailUrl);
  };
  const matching=deliveries.filter(item=>(network==='all'||item.platform===network)&&(status==='all'||item.status===status)&&`${title(item)} ${item.text}`.toLocaleLowerCase(locale).includes(query.trim().toLocaleLowerCase(locale)));
  const sorted=[...matching].sort((a,b)=>(a.plannedAt??'').localeCompare(b.plannedAt??''));
  const [year,number]=anchor.slice(0,7).split('-').map(Number);
  const month=anchor.slice(0,7),first=`${month}-01`;
  const days=new Date(Date.UTC(year,number,0)).getUTCDate();
  const offset=(asDate(first).getUTCDay()+6)%7;
  const start=view==='week'?weekStart(anchor):addDays(first,-offset);
  const visibleDays=Array.from({length:view==='week'?7:Math.ceil((days+offset)/7)*7},(_,i)=>addDays(start,i));
  const inPeriod=(item:PublicationDelivery)=>view==='week'?visibleDays.includes(dateOf(item)):dateOf(item).startsWith(month);
  const periodPosts=sorted.filter(item=>item.plannedAt&&inPeriod(item));
  const unscheduled=sorted.filter(item=>!item.plannedAt);
  const selectedPosts=sorted.filter(item=>dateOf(item)===selectedDay);
  const preview=deliveries.find(item=>item.id===previewId),editing=deliveries.find(item=>item.id===editingId);
  const filtered=network!=='all'||status!=='all'||query.trim()!=='';
  const dateLabel=(day:string,options:Intl.DateTimeFormatOptions)=>asDate(day).toLocaleDateString(locale,{...options,timeZone:'UTC'});
  const move=(delta:number)=>{
    const next=view==='week'?addDays(anchor,delta*7):new Date(Date.UTC(year,number-1+delta,1,12)).toISOString().slice(0,10);
    setAnchor(next);setSelectedDay(next);
  };
  const openPreview=(item:PublicationDelivery)=>{setPreviewId(item.id);setCoverError('')};
  const tile=(item:PublicationDelivery,compact=false,scope='grid')=><PublicationTile key={item.id} id={`${scope}-${item.id}`} title={title(item)} platform={item.platform} status={item.status} statusLabel={publicationLabel(item.status,pt).replace(pt?'Aprovado para envio':'Approved to send',pt?'Aprovado':'Approved')} time={timeOf(item)} cover={coverOf(item)} pt={pt} compact={compact} onClick={()=>openPreview(item)}/>;
  const clearFilters=()=>{setNetwork('all');setStatus('all');setQuery('')};
  const addCover=(file?:File)=>{
    if(!file||!preview)return;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>8*1024*1024){setCoverError(pt?'Escolha uma imagem PNG, JPG ou WebP de até 8 MB.':'Choose a PNG, JPG or WebP image up to 8 MB.');return}
    const id=preview.id,reader=new FileReader();
    reader.onload=()=>{setCovers(current=>({...current,[id]:String(reader.result)}));setCoverError('')};
    reader.onerror=()=>setCoverError(pt?'Não foi possível ler esta imagem.':'Could not read this image.');
    reader.readAsDataURL(file);
  };

  return <section className="publication-calendar calendar-workspace" data-od-id="publication-calendar" aria-label={pt?'Calendário de postagens':'Publishing calendar'}>
    <header className="calendar-topline" data-od-id="calendar-toolbar">
      <div className="calendar-period"><h2 aria-live="polite">{view==='week'?`${dateLabel(start,{day:'numeric',month:'short'})} – ${dateLabel(addDays(start,6),{day:'numeric',month:'short'})}`:dateLabel(first,{month:'long',year:'numeric'})}</h2><span>{periodPosts.length} {pt?'posts planejados':'planned posts'}</span></div>
      <div className="calendar-navigation"><button className="soft-button" onClick={()=>{setAnchor(today);setSelectedDay(today)}} data-od-id="calendar-today">{pt?'Hoje':'Today'}</button><button className="icon-button" aria-label={pt?'Período anterior':'Previous period'} onClick={()=>move(-1)}><Icon name="chevron" className="chevron-back"/></button><button className="icon-button" aria-label={pt?'Próximo período':'Next period'} onClick={()=>move(1)}><Icon name="chevron"/></button></div>
      <div className="calendar-view-tabs" role="group" aria-label={pt?'Visualização do calendário':'Calendar view'}>{(['month','week','agenda'] as const).map(mode=><button key={mode} aria-pressed={view===mode} onClick={()=>setView(mode)} data-od-id={`calendar-view-${mode}`}>{mode==='month'?(pt?'Mês':'Month'):mode==='week'?(pt?'Semana':'Week'):(pt?'Lista':'List')}</button>)}</div>
    </header>
    <div className="calendar-filters" data-od-id="calendar-filters">
      <div className="calendar-network-filters" role="group" aria-label={pt?'Filtrar por rede social':'Filter by social network'}><button className="network-filter" aria-pressed={network==='all'} onClick={()=>setNetwork('all')}>{pt?'Todas as redes':'All channels'}</button>{publicationPlatforms.map(platform=><button key={platform} className="network-filter" aria-pressed={network===platform} onClick={()=>setNetwork(network===platform?'all':platform)} data-od-id={`calendar-filter-${platform.toLowerCase()}`}><NetworkLogo platform={platform}/><span>{platform}</span></button>)}</div>
      <label className="calendar-search"><Icon name="search"/><input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder={pt?'Buscar post…':'Search posts…'} aria-label={pt?'Buscar post':'Search posts'}/></label>
      <SelectMenu value={status} onChange={setStatus} ariaLabel={pt?'Filtrar por status':'Filter by status'} options={[{value:'all',label:pt?'Todos os status':'All statuses'},...(['draft','in-review','approved','sending','scheduled','published','failed'] as const).map(value=>({value,label:publicationLabel(value,pt)}))]}/>
    </div>
    <div className="calendar-layout" data-view={view}>
      <div className="calendar-board">
        {view!=='agenda'&&<div className={`publishing-grid ${view==='week'?'week-grid':''}`} data-od-id="calendar-date-grid">
          {(pt?['Seg','Ter','Qua','Qui','Sex','Sáb','Dom']:['Mon','Tue','Wed','Thu','Fri','Sat','Sun']).map(day=><span className="publishing-weekday" key={day}>{day}</span>)}
          {visibleDays.map(day=>{const items=sorted.filter(item=>dateOf(item)===day),outside=view==='month'&&!day.startsWith(month);return <article className={`publishing-day ${outside?'outside':''} ${selectedDay===day?'selected':''} ${day===today?'today':''}`} key={day} data-od-id={`calendar-day-${day}`}><button className="publishing-day-number" onClick={()=>setSelectedDay(day)} aria-pressed={selectedDay===day} aria-label={`${dateLabel(day,{weekday:'long',day:'numeric',month:'long'})} · ${items.length} posts`}><time dateTime={day}>{Number(day.slice(-2))}</time>{items.length>0&&<small>{items.length}</small>}</button>{items.slice(0,view==='week'?8:2).map(item=>tile(item))}{items.length>(view==='week'?8:2)&&<button className="calendar-more" onClick={()=>setSelectedDay(day)}>+{items.length-(view==='week'?8:2)} {pt?'posts':'posts'}</button>}</article>})}
        </div>}
        <div className={`publishing-agenda ${view==='agenda'?'visible':''}`} data-od-id="calendar-agenda">{Array.from(new Set(periodPosts.map(dateOf))).map(day=><section key={day} className="agenda-day"><header><strong>{dateLabel(day,{day:'numeric'})}</strong><span>{dateLabel(day,{weekday:'short',month:'short'})}</span>{day===today&&<small>{pt?'Hoje':'Today'}</small>}</header><div>{periodPosts.filter(item=>dateOf(item)===day).map(item=>tile(item,true,'agenda'))}</div></section>)}</div>
        {periodPosts.length===0&&<div className="calendar-empty" role="status"><Icon name="calendar"/><strong>{filtered?(pt?'Nenhum post com esses filtros':'No posts match these filters'):(pt?'Seu calendário está livre':'Your calendar is clear')}</strong><p>{filtered?(pt?'Tente outra rede ou palavra.':'Try another channel or keyword.'):(pt?'Adicione uma data às entregas no Estúdio para vê-las aqui.':'Add a date to deliveries in the Studio to see them here.')}</p>{filtered&&<button className="text-link" onClick={clearFilters}>{pt?'Limpar filtros':'Clear filters'}</button>}</div>}
      </div>
      <aside className="calendar-day-panel" data-od-id="calendar-day-panel"><header><span>{selectedDay===today?(pt?'Hoje':'Today'):dateLabel(selectedDay,{weekday:'long'})}</span><h3>{dateLabel(selectedDay,{day:'numeric',month:'long'})}</h3><small>{selectedPosts.length} {pt?'posts':'posts'}</small></header><div>{selectedPosts.length?selectedPosts.map(item=>tile(item,true,'day')):<div className="day-panel-empty"><Icon name="calendar"/><p>{pt?'Sem posts neste dia.':'No posts on this day.'}</p><span>{pt?'Selecione uma data para ver os detalhes.':'Select a date to see its posts.'}</span></div>}</div><div className="calendar-day-note"><i/>{pt?'Rascunhos e aprovações ficam no Estúdio.':'Drafts and approvals live in the Studio.'}</div></aside>
    </div>
    <footer className="calendar-footer"><div className="calendar-legend"><span><i className="draft"/>{pt?'Rascunho':'Draft'}</span><span><i className="in-review"/>{pt?'Revisão':'Review'}</span><span><i className="approved"/>{pt?'Aprovado':'Approved'}</span><span><i className="scheduled"/>{pt?'Agendado':'Scheduled'}</span></div><SelectMenu ariaLabel={pt?'Fuso do calendário':'Calendar time zone'} value={zone} onChange={setZone} options={[...new Set([zone,...zones])].map(value=>({value,label:value.replace('America/','').replaceAll('_',' ')}))}/></footer>
    <p className="calendar-confirmation-note">{pt?'Horários planejados. Agendamentos confirmados exibem o recibo do provedor.':'Planned times. Confirmed schedules display the provider receipt.'}</p>
    {unscheduled.length>0&&<details className="calendar-backlog" open data-od-id="calendar-backlog"><summary>{pt?'Ainda sem data':'Not dated yet'} <span>{unscheduled.length}</span></summary><div>{unscheduled.map(item=>tile(item,true,'backlog'))}</div></details>}
    <details className="calendar-connections" data-od-id="calendar-connections"><summary><Icon name="globe"/><span>{pt?'Agendamentos externos':'External schedules'}</span><small>Publora · Zernio</small><Icon name="chevron"/></summary><ProviderCalendar key={workspaceId} workspaceId={workspaceId} zone={zone} month={month}/></details>
    {preview&&<FlowDialog title={title(preview)} description={preview.platform} onClose={()=>setPreviewId(undefined)}><div className="publication-preview" data-od-id="publication-preview"><figure className="publication-preview-cover"><PostCover src={coverOf(preview)} title={title(preview)} pt={pt}/><NetworkLogo platform={preview.platform}/></figure><div className="publication-preview-meta"><span className="post-status" data-status={preview.status}><i/>{publicationLabel(preview.status,pt)}</span><span>{preview.plannedAt?`${dateLabel(dateOf(preview),{day:'numeric',month:'long'})} · ${timeOf(preview)}`:(pt?'Sem data definida':'Date not set')}</span></div><p className="publication-preview-text">{preview.text|| (pt?'O texto deste post ainda não foi escrito.':'The post text has not been written yet.')}</p><input ref={coverInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event=>{addCover(event.target.files?.[0]);event.target.value=''}}/><button type="button" className="text-link" onClick={()=>coverInput.current?.click()}><Icon name="image"/>{pt?'Trocar capa de visualização':'Change preview cover'}</button>{covers[preview.id]&&<small className="cover-local-note">{pt?'Capa desta sessão. O arquivo da entrega permanece na biblioteca.':'Session cover. The delivery file remains in the library.'}</small>}{coverError&&<p className="delivery-error" role="alert">{coverError}</p>}<button className="primary-button" data-od-id="edit-calendar-post" onClick={()=>{setEditingId(preview.id);setPreviewId(undefined)}}><Icon name="edit"/>{pt?'Editar entrega':'Edit delivery'}</button></div></FlowDialog>}
    {editing&&<PublicationEditor delivery={editing} onClose={()=>setEditingId(undefined)}/>}
  </section>;
}
