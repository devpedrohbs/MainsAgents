import {useEffect,useRef,useState} from 'react';
import {storageProfile} from '../../data/IndexedDbStateStore';
import type {ThumbnailConcept,ThumbnailConceptId,ThumbnailSource} from '../../features/production/thumbnailGallery';

interface Candidate {timestampSeconds:number;reason:'scene-change'|'evenly-spaced'}
const conceptName:Record<ThumbnailConceptId,[string,string]>={product:['Produto','Product'],person:['Pessoa','Person'],benefit:['Benefício','Benefit']};
const profileQuery=()=>`profile=${encodeURIComponent(storageProfile())}`;
/** Server route for one instant of the exact version (assetId/versionId/sha256); never a filesystem path. */
export const frameUrl=(runId:string,source:ThumbnailSource,t:number)=>`/api/content/productions/${encodeURIComponent(runId)}/frame?${profileQuery()}&t=${encodeURIComponent(String(Math.round(t*10)/10))}&versionId=${encodeURIComponent(source.versionId)}&sha256=${encodeURIComponent(source.sha256)}`;
const clock=(t:number)=>`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}.${Math.round((t%1)*10)}`;

/**
 * Real frame previews per concept (B03). One debounced request per concept timestamp; typing in the seconds field or
 * scrubbing never exports a cover. Stale requests are aborted and late answers for an older source are ignored.
 */
export function useConceptFrames(runId:string,source:ThumbnailSource,concepts:ThumbnailConcept[],durationSeconds:number){
 const [urls,setUrls]=useState<Partial<Record<ThumbnailConceptId,string>>>({});
 const owned=useRef(new Map<ThumbnailConceptId,string>()),loaded=useRef(new Map<ThumbnailConceptId,string>());
 const key=`${source.versionId}#${source.sha256}`,stamps=concepts.map(c=>`${c.id}:${Math.round(c.timestampSeconds*10)}`).join('|');
 useEffect(()=>{
  const controllers:AbortController[]=[],timers:number[]=[];
  for(const c of concepts){
   const t=c.timestampSeconds,want=`${key}@${Math.round(t*10)}`;if(!Number.isFinite(t)||t<0||durationSeconds>0&&t>durationSeconds||loaded.current.get(c.id)===want)continue;
   const controller=new AbortController();controllers.push(controller);
   timers.push(window.setTimeout(()=>{fetch(frameUrl(runId,source,t),{cache:'no-store',signal:controller.signal}).then(async response=>{if(!response.ok)throw Error(String(response.status));return URL.createObjectURL(await response.blob());}).then(url=>{
    if(controller.signal.aborted){URL.revokeObjectURL(url);return;}
    const old=owned.current.get(c.id);owned.current.set(c.id,url);loaded.current.set(c.id,want);setUrls(current=>({...current,[c.id]:url}));if(old)URL.revokeObjectURL(old);
   }).catch(()=>{});},350));
  }
  return()=>{for(const timer of timers)window.clearTimeout(timer);for(const controller of controllers)controller.abort();};
 },[runId,key,stamps,durationSeconds]);// eslint-disable-line react-hooks/exhaustive-deps
 // A new source drops every preview of the old one.
 useEffect(()=>()=>{for(const url of owned.current.values())URL.revokeObjectURL(url);owned.current.clear();loaded.current.clear();setUrls({});},[key]);
 return urls;
}

export function CoverFramePicker({runId,contentId,source,concepts,durationSeconds,busy,pt,onPick}:{runId:string;contentId:string;source:ThumbnailSource;concepts:ThumbnailConcept[];durationSeconds:number;busy:boolean;pt:boolean;onPick:(id:ThumbnailConceptId,timestampSeconds:number)=>void}){
 const say=(a:string,b:string)=>pt?a:b;
 const [active,setActive]=useState<ThumbnailConceptId>('product');
 const [candidates,setCandidates]=useState<{state:'loading'}|{state:'error';message:string}|{state:'ready';items:Candidate[];note:string}>({state:'loading'});
 const video=useRef<HTMLVideoElement>(null),key=`${source.versionId}#${source.sha256}`;
 useEffect(()=>{
  const controller=new AbortController();setCandidates({state:'loading'});
  fetch(`/api/content/productions/${encodeURIComponent(runId)}/frames?${profileQuery()}`,{cache:'no-store',signal:controller.signal}).then(async response=>{const body=await response.json();if(!response.ok)throw Error(body.error??String(response.status));return body;})
   .then(body=>{if(controller.signal.aborted)return;if(body.source?.sha256!==source.sha256||body.source?.versionId!==source.versionId){setCandidates({state:'error',message:say('O vídeo mudou; recarregue as capas.','The video changed; reload the covers.')});return;}setCandidates({state:'ready',items:body.candidates,note:body.note});})
   .catch(error=>{if(!controller.signal.aborted)setCandidates({state:'error',message:(error as Error).message});});
  return()=>controller.abort();
 },[runId,key]);// eslint-disable-line react-hooks/exhaustive-deps
 const pick=(t:number)=>{const value=Math.min(Math.max(0,Math.round(t*10)/10),durationSeconds>0?durationSeconds:Infinity);onPick(active,value);if(video.current)video.current.currentTime=value;};
 const current=concepts.find(c=>c.id===active);
 const playerSrc=`/api/content/media/file?${profileQuery()}&contentId=${encodeURIComponent(contentId)}&assetId=${encodeURIComponent(source.assetId)}&versionId=${encodeURIComponent(source.versionId)}`;
 return <section className="cover-frame-picker" aria-label={say('Escolher o quadro vendo o vídeo','Choose the frame while watching the video')}>
  <h4>{say('Escolher o quadro vendo o vídeo','Choose the frame while watching the video')}</h4>
  <fieldset className="cover-frame-picker-concepts" disabled={busy}><legend>{say('Aplicar a','Apply to')}</legend>
   {concepts.map(c=><label key={c.id}><input type="radio" name={`frame-concept-${runId}`} checked={active===c.id} onChange={()=>{setActive(c.id);if(video.current)video.current.currentTime=c.timestampSeconds;}}/>{say(...conceptName[c.id])} <small>({clock(c.timestampSeconds)})</small></label>)}
  </fieldset>
  <div className="cover-frame-picker-player"><video ref={video} src={playerSrc} controls preload="metadata" aria-label={say('Vídeo aprovado (sem legendas gravadas)','Approved video (without burned captions)')}/></div>
  <button type="button" className="soft-button" disabled={busy} onClick={()=>pick(video.current?.currentTime??0)}>{say(`Usar o instante atual para ${conceptName[active][0]}`,`Use the current instant for ${conceptName[active][1]}`)}</button>
  {candidates.state==='loading'&&<p className="thumbnail-gallery-note" role="status">{say('Procurando instantes candidatos…','Looking for candidate instants…')}</p>}
  {candidates.state==='error'&&<p className="thumbnail-gallery-error" role="alert">{say('Não foi possível sugerir instantes: ','Could not suggest instants: ')}{candidates.message}</p>}
  {candidates.state==='ready'&&<>
   <ul className="cover-frame-picker-candidates">{candidates.items.map(item=><li key={item.timestampSeconds}>
    <button type="button" disabled={busy} aria-pressed={current?Math.abs(current.timestampSeconds-item.timestampSeconds)<0.05:false} aria-label={say(`Usar ${clock(item.timestampSeconds)} para ${conceptName[active][0]}`,`Use ${clock(item.timestampSeconds)} for ${conceptName[active][1]}`)} onClick={()=>pick(item.timestampSeconds)}>
     <img src={frameUrl(runId,source,item.timestampSeconds)} alt="" loading="lazy"/>
     <span>{clock(item.timestampSeconds)} · {item.reason==='scene-change'?say('mudança de cena','scene change'):say('espaçado','evenly spaced')}</span>
    </button></li>)}</ul>
   <p className="thumbnail-gallery-note">{say('Sugestões por mudança de cena ou espaçamento uniforme; nenhuma detecção de produto, rosto ou expressão. Trocar o instante retira a aprovação da capa e exige exportar de novo.','Suggestions from scene changes or even spacing; no product, face or expression detection. Changing the instant withdraws the cover approval and requires exporting again.')}</p>
  </>}
 </section>;
}
