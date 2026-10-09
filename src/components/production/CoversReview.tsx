import {useCallback,useMemo,useState} from 'react';
import {ThumbnailGallery} from './ThumbnailGallery';
import {CoverFramePicker,useConceptFrames} from './CoverFramePicker';
import {SelectMenu} from '../common/SelectMenu';
import {useContentWorkflow} from '../../features/content/ContentWorkflowProvider';
import {useStudioDraftField} from '../../features/content/studioDrafts';
import {runDraftScope} from '../../features/production/productionDrafts';
import {canApprove,conceptSignature,sourceKey,updateConcept,type ThumbnailArtifact,type ThumbnailConceptId,type ThumbnailGalleryState} from '../../features/production/thumbnailGallery';
import {storageProfile} from '../../data/IndexedDbStateStore';
import type {CoverBrand,CoverConcept,ProductionRun} from '../../features/production/model';

/** Networks with a cover preset made for them; the others start from an approximate format the user must confirm. */
const presetPlatforms=['Instagram','TikTok'];
interface Draft {concepts:CoverConcept[];brand:CoverBrand;destinations:Array<{platform:string;format:string;confirmed?:boolean}>;selected:Record<string,ThumbnailConceptId>;approved:Record<string,ThumbnailConceptId>}
const parseDraft=(value:string):Partial<Draft>=>{try{const parsed=JSON.parse(value);return parsed&&typeof parsed==='object'?parsed:{}}catch{return {}}};
const sameBrand=(a:CoverBrand,b:CoverBrand)=>a.theme===b.theme&&a.accent.toLowerCase()===b.accent.toLowerCase()&&(a.logoAssetId??'')===(b.logoAssetId??'');

/**
 * Local cover gate: three concepts per format rendered by the local engine (FFmpeg, no AI) only on an explicit export.
 * Typing never renders; any change after an export makes it stale and blocks approval until exported again.
 */
export function CoversReview({run,pt,busy,act}:{run:ProductionRun;pt:boolean;busy:boolean;act:(action:string,data?:Record<string,unknown>)=>Promise<ProductionRun|undefined>}){
 const editorial=useContentWorkflow(),covers=run.covers!,formats=run.coverFormats??[];
 const scope=runDraftScope(run.workspaceId,run.id,`covers-${sourceKey(covers.source)}`);
 const [saved,setSaved]=useStudioDraftField(scope,'draft','');
 const draft=parseDraft(saved);
 const concepts=draft.concepts?.length===3?draft.concepts:covers.concepts,brand=draft.brand??covers.brand;
 const destinations=covers.destinations.map(d=>{const saved=draft.destinations?.find(x=>x.platform===d.platform&&formats.some(f=>f.id===x.format));return {platform:d.platform,format:saved?.format??d.format,confirmed:presetPlatforms.includes(d.platform)||saved?.confirmed===true||!saved&&d.confirmed===true};});
 const unconfirmed=destinations.filter(d=>!d.confirmed);
 const selected=draft.selected??{},approved=draft.approved??{};
 const neededFormats=[...new Set(destinations.map(d=>d.format))];
 const [format,setFormat]=useState(neededFormats[0]??formats[0]?.id??'');
 const [confirm,setConfirm]=useState(false),[error,setError]=useState('');
 const write=(change:Partial<Draft>)=>{setConfirm(false);setSaved(JSON.stringify({concepts,brand,destinations,selected,approved,...change}));};
 const render=covers.render,running=render?.status==='running';
 const logos=(editorial.state.assets??[]).filter(a=>a.contentId===run.contentId&&a.workspaceId===run.workspaceId&&a.kind==='image'&&a.status==='available'&&!Object.values(covers.batches).some(b=>b.items.some(i=>i.assetId===a.id)));

 /** Gallery state for one format, built from the server batch; brand changes after the export make every item stale. */
 const galleryFor=useCallback((id:string):ThumbnailGalleryState=>{
  const batch=covers.batches[id],artifacts:Record<string,ThumbnailArtifact>={};
  if(batch)for(const item of batch.items){const used=batch.concepts.find(c=>c.id===item.concept);if(!used)continue;artifacts[`${item.concept}:${id}`]={conceptId:item.concept,format:id,assetId:item.assetId,sha256:item.sha256,width:item.width,height:item.height,sourceVersionId:batch.source.versionId,sourceSha256:batch.source.sha256,inputsSignature:sameBrand(batch.brand,brand)?conceptSignature(used,id,batch.source):'brand-changed'};}
  return {sourceKey:sourceKey(covers.source),concepts,selectedId:selected[id]??null,approvedId:approved[id]??null,artifacts};
 },[covers,concepts,brand,selected,approved]);
 const gallery=galleryFor(format);
 const ready=neededFormats.every(id=>approved[id]&&canApprove({...galleryFor(id),selectedId:approved[id]},covers.source,id,false));
 const versionOf=(artifact:ThumbnailArtifact)=>covers.batches[artifact.format]?.items.find(i=>i.assetId===artifact.assetId)?.versionId??'';
 const resolveAsset=useCallback(async(artifact:ThumbnailArtifact)=>new URL(`/api/content/productions/${encodeURIComponent(run.id)}/cover?profile=${encodeURIComponent(storageProfile())}&assetId=${encodeURIComponent(artifact.assetId)}&versionId=${encodeURIComponent(versionOf(artifact))}`,window.location.href).href,[run.id,covers.batches]); // eslint-disable-line react-hooks/exhaustive-deps
 const status=useMemo(()=>{const value:Partial<Record<ThumbnailConceptId,{state:'loading'}|{state:'error';message:string}>>={};for(const c of concepts){if(running&&render?.format===format)value[c.id]={state:'loading'};else if(render?.format===format&&render.status==='failed')value[c.id]={state:'error',message:render.error??''};}return value;},[running,render,format,concepts]);
 const run_=async(action:string,data:Record<string,unknown>)=>{setError('');const result=await act(action,data);if(!result)setError(pt?'Confira a mensagem acima e tente novamente.':'Check the message above and try again.');return result;};
 const say=(a:string,b:string)=>pt?a:b;
 const frames=useConceptFrames(run.id,covers.source,concepts,covers.durationSeconds);
 /** Picking an instant is an edit of that concept: its approval (in every format) is withdrawn and the export goes stale. */
 const pickFrame=(id:ThumbnailConceptId,timestampSeconds:number)=>{const next=updateConcept(gallery,id,{timestampSeconds});write({concepts:next.concepts,approved:Object.fromEntries(Object.entries(approved).filter(([,concept])=>concept!==id))});};

 return <div className="production-section production-covers">
  <h3>{say('Capas locais por rede','Local covers per network')}</h3>
  <p className="editorial-hint">{say('Três alternativas por formato (produto, pessoa, benefício) feitas neste PC com quadros do vídeo aprovado. Nenhuma IA é usada e nada é publicado aqui.','Three alternatives per format (product, person, benefit) made on this PC from frames of the approved video. No AI is used and nothing is published here.')}</p>
  <fieldset className="production-cover-destinations" disabled={busy||running}><legend>{say('Formato por rede','Format per network')}</legend>
   {destinations.map(d=>presetPlatforms.includes(d.platform)?<label key={d.platform}>{d.platform}<SelectMenu ariaLabel={`Formato da capa ${d.platform}`} value={d.format} onChange={value=>write({destinations:destinations.map(x=>x.platform===d.platform?{...x,format:value}:x)})} options={formats.map(f=>({value:f.id,label:f.label,description:`${f.width}×${f.height}`}))}/></label>
    :<div key={d.platform} className="production-cover-unverified"><label>{d.platform}<SelectMenu ariaLabel={`Formato da capa ${d.platform}`} value={d.format} onChange={value=>write({destinations:destinations.map(x=>x.platform===d.platform?{...x,format:value,confirmed:true}:x)})} options={formats.map(f=>({value:f.id,label:f.label,description:`${f.width}×${f.height}`}))}/></label>
     <p className="production-cover-format-note">{say(`${d.platform} não tem um modelo de capa próprio aqui. O formato acima é só um ponto de partida aproximado, não uma regra da rede: confira no próprio ${d.platform} e escolha o que vai usar.`,`${d.platform} has no cover preset of its own here. The format above is only an approximate starting point, not a network rule: check ${d.platform} itself and choose what you will use.`)}</p>
     <label className="production-check"><input type="checkbox" checked={d.confirmed} onChange={event=>write({destinations:destinations.map(x=>x.platform===d.platform?{...x,confirmed:event.target.checked}:x)})}/>{say(`Escolhi este formato para ${d.platform}.`,`I chose this format for ${d.platform}.`)}</label></div>)}
   <p className="production-cover-format-note">{say('Tamanhos de referência por formato. Áreas seguras e guias são aproximações, não regras verificadas das redes.','Reference sizes per format. Safe areas and guides are approximations, not verified network rules.')}</p>
  </fieldset>
  <fieldset className="production-cover-brand" disabled={busy||running}><legend>{say('Marca','Brand')}</legend>
   <label>{say('Tema','Theme')}<SelectMenu ariaLabel="Tema da capa" value={brand.theme} onChange={value=>write({brand:{...brand,theme:value==='light'?'light':'dark'}})} options={[{value:'dark',label:say('Escuro','Dark')},{value:'light',label:say('Claro','Light')}]}/></label>
   <label>{say('Cor de destaque','Accent color')}<input aria-label="Cor de destaque da capa" type="color" value={brand.accent} onChange={event=>write({brand:{...brand,accent:event.target.value}})}/></label>
   <label>Logo<SelectMenu ariaLabel="Logo da capa" value={brand.logoAssetId??''} onChange={value=>write({brand:{...brand,...(value?{logoAssetId:value}:{logoAssetId:undefined})}})} options={[{value:'',label:say('Sem logo','No logo')},...logos.map(a=>({value:a.id,label:a.name}))]}/></label>
   {!logos.length&&<p className="editorial-hint">{say('Para usar um logo, adicione a imagem (PNG/JPG/WebP) na biblioteca deste conteúdo.','To use a logo, add the image (PNG/JPG/WebP) to this content library.')}</p>}
  </fieldset>
  <CoverFramePicker runId={run.id} contentId={run.contentId} source={covers.source} concepts={concepts} durationSeconds={covers.durationSeconds} busy={busy||running} pt={pt} onPick={pickFrame}/>
  {formats.length>0&&<ThumbnailGallery frames={frames} state={gallery} source={covers.source} formats={formats.filter(f=>neededFormats.includes(f.id))} format={format} pt={pt} busy={busy||running} sourceDurationSeconds={covers.durationSeconds} status={status}
   resolveAsset={resolveAsset} onFormatChange={setFormat}
   onAdjust={(id,patch)=>{const next=updateConcept(gallery,id,patch);write({concepts:next.concepts,approved:Object.fromEntries(Object.entries(approved).filter(([,concept])=>concept!==id))});}}
   onSelect={id=>write({selected:{...selected,[format]:id},approved:Object.fromEntries(Object.entries(approved).filter(([key])=>key!==format))})}
   onGenerate={()=>void run_('cover-render',{format,concepts,brand})}
   onCancel={()=>void run_('cover-cancel',{})}
   onApprove={id=>{if(canApprove({...gallery,selectedId:id},covers.source,format,false))write({approved:{...approved,[format]:id}});}}/>}
  {running&&<p role="status">{say(`Exportando as três capas em ${formats.find(f=>f.id===render.format)?.label??render.format}…`,`Exporting the three covers in ${formats.find(f=>f.id===render.format)?.label??render.format}…`)}</p>}
  {render?.status==='interrupted'&&<p className="editorial-hint" role="status">{say('A exportação anterior foi interrompida (o app fechou). Exporte de novo; nada parcial foi usado.','The previous export was interrupted (the app closed). Export again; nothing partial was used.')}</p>}
  {render?.status==='canceled'&&<p className="editorial-hint" role="status">{say('Exportação cancelada; nenhuma capa parcial foi registrada.','Export canceled; no partial cover was registered.')}</p>}
  {render?.status==='failed'&&<p className="delivery-error" role="alert">{render.error}</p>}
  {unconfirmed.length>0&&<p className="editorial-hint" role="status">{say(`Antes de aprovar, escolha e confirme o formato de: ${unconfirmed.map(d=>d.platform).join(', ')}.`,`Before approving, choose and confirm the format for: ${unconfirmed.map(d=>d.platform).join(', ')}.`)}</p>}
  <ul className="editorial-hint">{neededFormats.map(id=><li key={id}>{formats.find(f=>f.id===id)?.label??id}: {approved[id]?say(`aprovada (${approved[id]})`,`approved (${approved[id]})`):covers.batches[id]?say('exportada, escolha e aprove uma','exported, choose and approve one'):say('ainda não exportada','not exported yet')}</li>)}</ul>
  <label className="production-check"><input type="checkbox" checked={confirm} disabled={busy||running||!ready||unconfirmed.length>0} onChange={event=>setConfirm(event.target.checked)}/>{say('Aprovo estas capas exportadas para cada rede e autorizo montar o pacote com elas.','I approve these exported covers for each network and authorize building the package with them.')}</label>
  <button className="primary-button" disabled={busy||running||!ready||!confirm||unconfirmed.length>0} onClick={()=>void run_('approve-covers',{authorize:true,destinations,brand,concepts,selections:neededFormats.map(id=>({format:id,concept:approved[id],batchId:covers.batches[id]?.batchId}))})}>{say('Aprovar capas e revisar pacote','Approve covers and review package')}</button>
  {error&&<p className="delivery-error" role="alert">{error}</p>}
 </div>;
}
