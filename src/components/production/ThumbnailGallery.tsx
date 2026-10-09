import {useEffect,useState} from 'react';
import {
 artifactFor,artifactKey,canApprove,canGenerate,conceptErrors,isSafePreviewUrl,isStale,
 type ThumbnailArtifact,type ThumbnailConcept,type ThumbnailConceptId,type ThumbnailFormat,
 type ThumbnailGalleryState,type ThumbnailItemStatus,type ThumbnailSource,
} from '../../features/production/thumbnailGallery';
import './thumbnail-gallery.css';

export interface ThumbnailGalleryProps {
 state:ThumbnailGalleryState;
 source:ThumbnailSource;
 formats:ThumbnailFormat[];
 format:string;
 pt:boolean;
 /** Global busy (e.g. export running): disables every action except cancel. */
 busy?:boolean;
 sourceDurationSeconds?:number;
 /** Per-concept load/error state of the last explicit generate. */
 status?:Partial<Record<ThumbnailConceptId,ThumbnailItemStatus>>;
 /** Turns a generated artifact into a stream URL (never a filesystem path). Rejections show an error. */
 resolveAsset:(artifact:ThumbnailArtifact)=>Promise<string>;
 onFormatChange:(format:string)=>void;
 /** Adjust: any edit of frame/title/kicker/framing. Never triggers an export. */
 onAdjust:(id:ThumbnailConceptId,patch:Partial<Omit<ThumbnailConcept,'id'>>)=>void;
 onSelect:(id:ThumbnailConceptId)=>void;
 /** Explicit export of one concept in the current format (the only path that runs the engine). */
 onGenerate:(id:ThumbnailConceptId)=>void;
 onCancel:(id:ThumbnailConceptId)=>void;
 onApprove:(id:ThumbnailConceptId)=>void;
 /** B03: blob URL of the real decoded frame at each concept timestamp (preview only, not the exported cover). */
 frames?:Partial<Record<ThumbnailConceptId,string>>;
}

const conceptName:Record<ThumbnailConceptId,[string,string]>={product:['Produto','Product'],person:['Pessoa','Person'],benefit:['Benefício','Benefit']};

function ExportedPreview({artifact,resolveAsset,pt}:{artifact:ThumbnailArtifact;resolveAsset:ThumbnailGalleryProps['resolveAsset'];pt:boolean}){
 const [res,setRes]=useState<{url:string}|{error:true}|null>(null);
 useEffect(()=>{
  let alive=true;setRes(null);
  resolveAsset(artifact).then(u=>{if(alive)setRes(isSafePreviewUrl(u)?{url:u}:{error:true})},()=>{if(alive)setRes({error:true})});
  return ()=>{alive=false};
 },[artifact.assetId,artifact.sha256,resolveAsset]);
 if(!res)return <p className="thumbnail-gallery-note" role="status">{pt?'Carregando capa exportada…':'Loading exported cover…'}</p>;
 if('error' in res)return <p className="thumbnail-gallery-error" role="alert">{pt?'Não foi possível carregar a capa exportada.':'Could not load the exported cover.'}</p>;
 return <img className="thumbnail-gallery-img" src={res.url} width={artifact.width} height={artifact.height} alt={pt?'Capa exportada':'Exported cover'}/>;
}

export function ThumbnailGallery(p:ThumbnailGalleryProps){
 const {state,source,formats,format,pt,busy=false,status={}}=p;
 const say=(a:string,b:string)=>pt?a:b;
 const fmt=formats.find(f=>f.id===format)??formats[0];
 const ratio=fmt?`${fmt.width} / ${fmt.height}`:'16 / 9';
 const num=(v:string,fallback:number)=>{const n=Number(v);return v.trim()===''||!Number.isFinite(n)?fallback:n};
 if(!state.concepts.length||!fmt)return <section className="thumbnail-gallery" aria-label={say('Galeria de capas','Cover gallery')}>
  <p className="thumbnail-gallery-note" role="status">{say('Nenhum conceito de capa ainda.','No cover concepts yet.')}</p></section>;
 return <section className="thumbnail-gallery" aria-label={say('Galeria de capas','Cover gallery')} aria-busy={busy}>
  <header className="thumbnail-gallery-head">
   <h3>{say('Galeria de capas','Cover gallery')}</h3>
   <fieldset className="thumbnail-gallery-formats"><legend>{say('Formato','Format')}</legend>
    {formats.map(f=><label key={f.id}><input type="radio" name="thumbnail-format" checked={f.id===fmt?.id} disabled={busy} onChange={()=>p.onFormatChange(f.id)}/><span>{f.label} · {f.width}×{f.height}</span></label>)}
   </fieldset>
  </header>
  <p className="thumbnail-gallery-note">{say('O quadro abaixo é só o conceito. A capa final só existe depois de exportar; mudar qualquer campo deixa a exportação desatualizada.','The frame below is only the concept. The final cover exists only after exporting; changing any field makes the export stale.')}</p>
  <ul className="thumbnail-gallery-list">
   {state.concepts.map(c=>{
    const id=c.id,fid=`tg-${id}`,st=status[id]??{state:'idle'},art=fmt?artifactFor(state,id,fmt.id):null;
    const stale=!!art&&isStale(state,source,id,fmt.id),errs=conceptErrors(c,p.sourceDurationSeconds);
    const selected=state.selectedId===id,approved=state.approvedId===id,loading=st.state==='loading';
    return <li key={id} className="thumbnail-gallery-card" data-selected={selected} data-approved={approved}>
     <div className="thumbnail-gallery-card-head">
      <h4>{say(...conceptName[id])}</h4>
      <span className="thumbnail-gallery-badge" data-kind={approved?'approved':art?(stale?'stale':'fresh'):'none'}>
       {approved?say('Aprovada','Approved'):art?(stale?say('Exportação desatualizada','Export is stale'):say('Exportada','Exported')):say('Só conceito','Concept only')}
      </span>
     </div>
     <div className="thumbnail-gallery-concept" style={{aspectRatio:ratio}} role="img"
      aria-label={say(`Conceito (prévia, não é a capa final): ${c.title||'sem título'}`,`Concept (preview, not the final cover): ${c.title||'untitled'}`)}>
      {p.frames?.[id]&&isSafePreviewUrl(p.frames[id])&&<img className="thumbnail-gallery-frame" src={p.frames[id]} alt="" aria-hidden="true" style={{objectPosition:`${c.framing.focusX*100}% ${c.framing.focusY*100}%`,transformOrigin:`${c.framing.focusX*100}% ${c.framing.focusY*100}%`,transform:`scale(${c.framing.zoom})`}}/>}
      <span className="thumbnail-gallery-focus" aria-hidden="true" style={{left:`${c.framing.focusX*100}%`,top:`${c.framing.focusY*100}%`,transform:`translate(-50%,-50%) scale(${c.framing.zoom})`}}/>
      <span className="thumbnail-gallery-kicker">{c.kicker}</span>
      <strong className="thumbnail-gallery-title">{c.title}</strong>
     </div>
     {art&&<div className="thumbnail-gallery-exported" style={{aspectRatio:ratio}} data-stale={stale}>
      <ExportedPreview artifact={art} resolveAsset={p.resolveAsset} pt={pt}/>
      {stale&&<span className="thumbnail-gallery-stale">{say('Desatualizada: exporte de novo','Stale: export again')}</span>}
     </div>}
     <div className="thumbnail-gallery-fields">
      <label htmlFor={`${fid}-title`}>{say('Título','Title')}</label>
      <input id={`${fid}-title`} value={c.title} disabled={busy} aria-invalid={errs.includes('title')} aria-describedby={errs.includes('title')?`${fid}-err`:undefined} onChange={e=>p.onAdjust(id,{title:e.target.value})}/>
      <label htmlFor={`${fid}-kicker`}>{say('Chamada (kicker)','Kicker')}</label>
      <input id={`${fid}-kicker`} value={c.kicker} disabled={busy} onChange={e=>p.onAdjust(id,{kicker:e.target.value})}/>
      <label htmlFor={`${fid}-ts`}>{say('Quadro (segundos)','Frame (seconds)')}</label>
      <input id={`${fid}-ts`} type="number" min={0} step={0.1} value={c.timestampSeconds} disabled={busy} aria-invalid={errs.includes('timestamp')} aria-describedby={errs.includes('timestamp')?`${fid}-err`:undefined} onChange={e=>p.onAdjust(id,{timestampSeconds:num(e.target.value,0)})}/>
      {(['focusX','focusY','zoom'] as const).map(k=>{
       const [lo,hi,step]=k==='zoom'?[1,3,0.1]:[0,1,0.05];
       const label=k==='focusX'?say('Foco horizontal','Horizontal focus'):k==='focusY'?say('Foco vertical','Vertical focus'):'Zoom';
       return <label key={k} className="thumbnail-gallery-range"><span>{label}: {c.framing[k].toFixed(2)}</span>
        <input type="range" min={lo} max={hi} step={step} value={c.framing[k]} disabled={busy} onChange={e=>p.onAdjust(id,{framing:{...c.framing,[k]:num(e.target.value,c.framing[k])}})}/></label>;})}
     </div>
     {errs.length>0&&<p id={`${fid}-err`} className="thumbnail-gallery-error" role="alert">
      {errs.includes('title')&&say('Informe um título. ','Enter a title. ')}{errs.includes('timestamp')&&say('O quadro precisa estar dentro do vídeo.','The frame must be inside the video.')}</p>}
     {st.state==='error'&&<p className="thumbnail-gallery-error" role="alert">{say('Falha ao exportar: ','Export failed: ')}{st.message}</p>}
     {loading&&<p className="thumbnail-gallery-note" role="status">{say('Exportando…','Exporting…')}</p>}
     <div className="thumbnail-gallery-actions">
      <button type="button" aria-pressed={selected} disabled={busy} onClick={()=>p.onSelect(id)}>{selected?say('Selecionada','Selected'):say('Selecionar','Select')}</button>
      <button type="button" disabled={!canGenerate(c,busy||loading,p.sourceDurationSeconds)} onClick={()=>p.onGenerate(id)}>{art?say('Exportar de novo','Export again'):say('Exportar capa','Export cover')}</button>
      {loading&&<button type="button" onClick={()=>p.onCancel(id)}>{say('Cancelar','Cancel')}</button>}
      {selected&&<button type="button" className="thumbnail-gallery-approve" disabled={!canApprove(state,source,fmt.id,busy||loading)} onClick={()=>p.onApprove(id)}>
       {approved?say('Aprovada','Approved'):say('Aprovar capa','Approve cover')}</button>}
     </div>
     {selected&&!approved&&!canApprove(state,source,fmt.id,false)&&<p className="thumbnail-gallery-note">{stale?say('Exporte de novo para aprovar.','Export again to approve.'):say('Exporte a capa para poder aprovar.','Export the cover to approve.')}</p>}
    </li>;})}
  </ul>
 </section>;
}
