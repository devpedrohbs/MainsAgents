import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {SelectMenu} from '../common/SelectMenu';
import {useStudioDraftField,studioDraftKey} from '../../features/content/studioDrafts';
import {storageProfile} from '../../data/IndexedDbStateStore';
import {parseClock} from '../../features/production/captionReview';
import {blocksFromRows,formatClock,joinRows,listSrt,rowsFromBlocks,sameBlocks,splitRow,srtCommand,srtFileUrl,srtRowErrorText,srtRowErrors,srtTimingLabel,srtWarningText,touchTiming,type SrtDocument,type SrtExport,type SrtRow,type SrtVideoRef} from '../../features/content/srtWorkbench';
import './srt-workbench.css';

export interface SrtVideoOption extends SrtVideoRef {name:string}
const parseRows=(value:string):SrtRow[]|null=>{try{const rows=JSON.parse(value);return Array.isArray(rows)&&rows.every(r=>r&&typeof r.key==='string'&&typeof r.start==='string'&&typeof r.end==='string'&&typeof r.text==='string')?rows:null}catch{return null}};
const sameRef=(a?:SrtVideoRef|null,b?:SrtVideoRef|null)=>!!a&&!!b&&a.assetId===b.assetId&&a.versionId===b.versionId&&a.sha256===b.sha256;
const kb=(size:number)=>size<1024?`${size} B`:`${(size/1024).toFixed(1)} KB`;

/**
 * SRT separado do MP4, para importar no mesmo projeto do CapCut: importar o SRT do CapCut (ou gerar do Whisper local
 * de um vídeo do conteúdo) → dividir em blocos curtos → editar → baixar. Nada aqui renderiza, grava legenda na imagem
 * ou muda vídeos; a prévia não sobrepõe texto à fala.
 */
export function SrtWorkbench({contentId,workspaceId,videos,defaultVideo,pt,embedded=false}:{contentId:string;workspaceId:string;videos:SrtVideoOption[];defaultVideo?:SrtVideoRef;pt:boolean;embedded?:boolean}){
 const say=(a:string,b:string)=>pt?a:b;
 const [docs,setDocs]=useState<SrtDocument[]|null>(null),[docId,setDocId]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [maxWords,setMaxWords]=useState(3),[videoKey,setVideoKey]=useState('');
 const [receipt,setReceipt]=useState<{export:SrtExport;reused:boolean}|null>(null),[time,setTime]=useState(0);
 const player=useRef<HTMLVideoElement>(null);
 const doc=docs?.find(item=>item.id===docId)??docs?.[0];
 const latest=doc?.versions.at(-1),running=doc?.job?.status==='running';
 // Escopo: a montagem é por perfil/workspace/conteúdo (key no pai); além disso, respostas que chegam depois de trocar
 // de conteúdo (ou desmontar) são descartadas e as requisições em voo são canceladas.
 const scopeId=`${storageProfile()}:${workspaceId}:${contentId}`,currentScope=useRef(scopeId),inflight=useRef(new Set<AbortController>());
 currentScope.current=scopeId;
 useEffect(()=>{const pending=inflight.current;return()=>{for(const abort of pending)abort.abort();pending.clear();};},[scopeId]);
 const scoped=useCallback(async<T,>(work:(signal:AbortSignal)=>Promise<T>):Promise<T|undefined>=>{
  const mine=scopeId,abort=new AbortController();inflight.current.add(abort);
  try{const value=await work(abort.signal);return currentScope.current===mine&&!abort.signal.aborted?value:undefined;}
  finally{inflight.current.delete(abort);}
 },[scopeId]);
 const refresh=useCallback(async()=>{try{const list=await scoped(signal=>listSrt(contentId,signal));if(list)setDocs(list);}catch(failure){if(!(failure instanceof DOMException&&failure.name==='AbortError'))setError(failure instanceof Error?failure.message:String(failure));}},[contentId,scoped]);
 useEffect(()=>{void refresh();},[refresh]);
 useEffect(()=>{if(!running)return;const timer=setInterval(()=>void refresh(),1500);return()=>clearInterval(timer);},[running,refresh]);
 useEffect(()=>{if(latest)setMaxWords(latest.maxWords);},[latest?.hash]);// eslint-disable-line react-hooks/exhaustive-deps

 const scope=studioDraftKey('srt',workspaceId,contentId);
 const field=`${doc?.id??'none'}-v${latest?.version??0}`,[saved,setSaved]=useStudioDraftField(scope,field,'');
 // SRT muito longo pode passar do limite de rascunho do Estúdio: aí a edição fica só na memória até salvar.
 const [memory,setMemory]=useState<{field:string;rows:SrtRow[]}|null>(null);
 const rows=useMemo(()=>memory?.field===field?memory.rows:parseRows(saved)??(latest?rowsFromBlocks(latest.blocks):[]),[memory,field,saved,latest]);
 const setRows=(next:SrtRow[])=>{setReceipt(null);try{setSaved(JSON.stringify(next));setMemory(null);}catch{setMemory({field,rows:next});}};
 // Limpa só o rascunho deste SRT/versão: outros SRTs do mesmo conteúdo mantêm os seus.
 const discard=()=>{setMemory(null);try{setSaved('');}catch{/* rascunho só em memória */}};
 const errors=srtRowErrors(rows),valid=rows.length>0&&!Object.keys(errors).length,dirty=!!latest&&!sameBlocks(rows,latest.blocks);
 const video=videos.find(item=>item.assetId===videoKey)??videos.find(item=>sameRef(item,defaultVideo))??videos[0]??null;
 const sourceVideo:SrtVideoRef|null=doc?.source.kind==='video'?doc.source:doc?.alignment??null;
 const listenVideo=sourceVideo?videos.find(item=>sameRef(item,sourceVideo))??null:defaultVideo?videos.find(item=>sameRef(item,defaultVideo))??null:null;
 const playerSrc=listenVideo?`/api/content/media/file?profile=${encodeURIComponent(storageProfile())}&contentId=${encodeURIComponent(contentId)}&assetId=${encodeURIComponent(listenVideo.assetId)}&versionId=${encodeURIComponent(listenVideo.versionId)}`:'';
 const live=rows.findIndex(row=>{const start=parseClock(row.start),end=parseClock(row.end);return time>=start&&time<end;});
 // Tempos ligados a um vídeo (gerado ou sincronizado) que não está mais na versão atual: não exporta nem redivide.
 const stale=!!sourceVideo&&!videos.some(item=>sameRef(item,sourceVideo)),staleAlignment=stale&&doc?.source.kind==='srt';

 const act=async<T,>(work:(signal:AbortSignal)=>Promise<T>)=>{setBusy(true);setError('');try{return await scoped(work);}catch(failure){if(currentScope.current===scopeId&&!(failure instanceof DOMException&&failure.name==='AbortError'))setError(failure instanceof Error?failure.message:String(failure));return undefined;}finally{setBusy(false);}};
 const adopt=(next:SrtDocument)=>{setDocs(current=>[next,...(current??[]).filter(item=>item.id!==next.id)]);setDocId(next.id);setReceipt(null);};
 const importSrt=async(file:File|undefined)=>{if(!file)return;if(file.size>2_000_000){setError(say('Arquivo SRT grande demais (máximo 2 MB).','SRT file too large (max 2 MB).'));return;}const text=await file.text();const next=await act(signal=>srtCommand({action:'import',contentId,name:file.name,srt:text,maxWords},signal));if(next)adopt(next);};
 const generate=async()=>{if(!video)return;const next=await act(signal=>srtCommand({action:'generate',contentId,assetId:video.assetId,versionId:video.versionId,sha256:video.sha256,maxWords},signal));if(next)adopt(next);};
 // Toda ação parte da versão atual (CAS) e leva junto o rascunho válido, que o servidor salva antes (sem etapa de aprovação).
 const base=()=>({contentId,docId:doc!.id,baseVersion:latest!.version,baseHash:latest!.hash,...(dirty?{blocks:blocksFromRows(rows)}:{})});
 const resplit=async()=>{const next=await act(signal=>srtCommand({action:'split',...base(),maxWords},signal));if(next){discard();adopt(next);}};
 const align=async()=>{if(!video)return;const next=await act(signal=>srtCommand({action:'align',...base(),assetId:video.assetId,versionId:video.versionId,sha256:video.sha256,maxWords},signal));if(next){discard();adopt(next);}};
 const unalign=async()=>{const next=await act(signal=>srtCommand({action:'unalign',contentId,docId:doc!.id,baseVersion:latest!.version,baseHash:latest!.hash},signal));if(next)adopt(next);};
 const cancel=async()=>{const next=await act(signal=>srtCommand({action:'cancel',contentId,docId:doc!.id},signal));if(next)adopt(next);};
 const save=async()=>{const next=await act(signal=>srtCommand({action:'save',...base()},signal));if(next){discard();adopt(next);}};
 const download=(entry:SrtExport)=>{const link=document.createElement('a');link.href=srtFileUrl(contentId,doc!.id,entry.sha256);link.download=entry.name;document.body.append(link);link.click();link.remove();};
 // Uma ação: salva as edições válidas (se houver), exporta e baixa.
 const exportSrt=async()=>{const result=await act(signal=>srtCommand<{document:SrtDocument;export:SrtExport;reused:boolean}>({action:'export',...base()},signal));if(result){discard();adopt(result.document);setReceipt({export:result.export,reused:result.reused});download(result.export);}};
 const reveal=(entry:SrtExport)=>{if(entry.assetId&&window.mainsAgentsDesktop?.files)void act(async()=>window.mainsAgentsDesktop!.files!.reveal(storageProfile(),contentId,entry.assetId!));};
 const patch=(key:string,change:Partial<SrtRow>)=>setRows(rows.map(row=>row.key===key?touchTiming(row,change):row));
 const listen=(row:SrtRow)=>{const at=parseClock(row.start);if(player.current&&Number.isFinite(at)){player.current.currentTime=at;void player.current.play().catch(()=>{});}};
 const now=()=>formatClock(player.current?.currentTime??0);
 const estimated=rows.some(row=>row.timing==='estimated');
 const wordOptions=[{value:'2',label:say('2 palavras por bloco','2 words per block')},{value:'3',label:say('3 palavras por bloco (recomendado)','3 words per block (recommended)')},{value:'4',label:say('4 palavras por bloco','4 words per block')}];

 return <section className={`srt-workbench${embedded?' srt-workbench--embedded':''}`} aria-label={say('Legendas SRT para o CapCut','SRT captions for CapCut')}>
  <div className="srt-workbench-head">
   <div>
    <h3>{say('Legendas SRT para o CapCut','SRT captions for CapCut')}</h3>
    <p className="editorial-hint">{say('Um arquivo .srt separado e editável, para importar no mesmo projeto do CapCut. Nada é gravado na imagem do vídeo e nenhum vídeo é alterado.','A separate, editable .srt file to import into the same CapCut project. Nothing is burned into the video image and no video is changed.')}</p>
   </div>
  </div>

  <ol className="srt-workbench-steps" aria-label={say('Etapas','Steps')}>
   <li data-done={!!doc}>{say('Importar SRT ou gerar do vídeo','Import SRT or generate from video')}</li>
   <li data-done={!!latest}>{say('Dividir em blocos curtos','Split into short blocks')}</li>
   <li data-done={!!latest&&!dirty&&!!doc?.exports.length}>{say('Revisar e baixar o SRT','Review and download the SRT')}</li>
  </ol>

  <div className="srt-workbench-start">
   <SelectMenu ariaLabel={say('Palavras por bloco','Words per block')} value={String(maxWords)} disabled={busy||running} onChange={value=>setMaxWords(Number(value))} options={wordOptions}/>
   <label className="primary-button srt-workbench-file">{say('Importar SRT do CapCut','Import SRT from CapCut')}<input type="file" accept=".srt,application/x-subrip,text/plain" disabled={busy||running} onChange={event=>{void importSrt(event.target.files?.[0]);event.target.value='';}}/></label>
   {videos.length>0&&<>
    <SelectMenu ariaLabel={say('Vídeo do conteúdo','Content video')} value={video?.assetId??''} disabled={busy||running} onChange={setVideoKey} options={videos.map(item=>({value:item.assetId,label:item.name}))}/>
    <button type="button" className="soft-button" disabled={busy||running||!video} onClick={()=>void generate()}>{say('Gerar do vídeo (Whisper local)','Generate from video (local Whisper)')}</button>
   </>}
  </div>
  {!videos.length&&<p className="editorial-hint">{say('Sem vídeo neste conteúdo: importe o SRT exportado pelo CapCut. Os blocos curtos terão tempos estimados.','No video in this content: import the SRT exported by CapCut. Short blocks will have estimated times.')}</p>}

  {docs&&docs.length>1&&<label className="srt-workbench-doc">{say('Arquivo','File')}<SelectMenu ariaLabel={say('SRT deste conteúdo','SRT of this content')} value={doc?.id??''} disabled={busy} onChange={value=>{setDocId(value);setReceipt(null);}} options={docs.map(item=>({value:item.id,label:`${item.title} · v${item.versions.at(-1)?.version??0}`}))}/></label>}

  {running&&<p role="status" className="srt-workbench-status">{say('Transcrevendo localmente com o Whisper… pode levar alguns minutos.','Transcribing locally with Whisper… this can take a few minutes.')} <button type="button" className="text-link" disabled={busy} onClick={()=>void cancel()}>{say('Cancelar','Cancel')}</button></p>}
  {doc?.job?.status==='failed'&&<p className="delivery-error" role="alert">{doc.job.error}</p>}
  {doc?.job?.status==='interrupted'&&<p className="editorial-hint" role="status">{say('A transcrição foi interrompida (o app fechou). Inicie de novo se quiser.','Transcription was interrupted (the app closed). Start again if you want.')}</p>}

  {doc&&latest&&<>
   <p className="srt-workbench-version">{doc.title} · v{latest.version} · {latest.origin==='edit'?say('editado por você','edited by you'):latest.origin==='generate'?say('gerado do vídeo','generated from video'):latest.origin==='align'?say('sincronizado com o áudio','synced to audio'):say(`blocos de até ${latest.maxWords} palavras`,`blocks of up to ${latest.maxWords} words`)} · {latest.blocks.length} {say('blocos','blocks')} · #{latest.hash.slice(0,8)}</p>
   {latest.warnings.length>0&&<ul className="caption-review-warnings srt-workbench-warnings" role="note">{latest.warnings.map(w=><li key={w} data-kind={w}>{srtWarningText(w,pt)}</li>)}</ul>}
   {stale&&!staleAlignment&&<p className="delivery-error" role="alert">{say('O vídeo de origem mudou depois da geração. Gere o SRT de novo da versão atual para os tempos baterem.','The source video changed after generation. Generate the SRT again from the current version so times match.')}</p>}
   {staleAlignment&&<p className="delivery-error" role="alert">{say('O vídeo usado para sincronizar os tempos mudou. Sincronize de novo com a versão atual ou desfaça a sincronização (os tempos passam a contar como estimados).','The video used to sync the times changed. Sync again with the current version or remove the sync (times then count as estimated).')} <button type="button" className="text-link" disabled={busy||running} onClick={()=>void unalign()}>{say('Desfazer sincronização','Remove sync')}</button></p>}
   <div className="srt-workbench-tools">
    {latest.maxWords!==maxWords&&<button type="button" className="soft-button" disabled={busy||running||!valid||stale} title={say('Mantém suas correções de texto e os limites de cada frase.','Keeps your text corrections and each sentence’s limits.')} onClick={()=>void resplit()}>{say(`Dividir de novo em blocos de ${maxWords} palavras (mantém suas correções)`,`Split again into ${maxWords}-word blocks (keeps your corrections)`)}</button>}
    {doc.source.kind==='srt'&&videos.length>0&&<button type="button" className="text-link" disabled={busy||running||!valid||!video} title={say('Usa o Whisper local do vídeo selecionado acima só para os tempos; o texto continua o seu, com as correções.','Uses local Whisper of the video selected above only for timing; the text stays yours, with corrections.')} onClick={()=>void align()}>{say('Sincronizar tempos com o áudio do vídeo selecionado','Sync times with the selected video’s audio')}</button>}
   </div>

   {playerSrc&&<div className="srt-workbench-player">
    <video ref={player} src={playerSrc} controls preload="metadata" onTimeUpdate={event=>setTime(event.currentTarget.currentTime)} aria-label={say('Vídeo para conferir os tempos (sem texto sobreposto)','Video to check timing (no overlaid text)')}/>
    <p className="srt-workbench-live" aria-live="polite">{live>=0?rows[live].text:' '}</p>
   </div>}

   <ol className="srt-workbench-rows">
    {rows.map((row,index)=>{const rowErrors=errors[row.key]??[],id=`srt-${row.key}`;return <li key={row.key} className="srt-workbench-row" data-live={index===live} data-invalid={rowErrors.length>0} data-timing={row.timing}>
     <div className="srt-workbench-times">
      <span className="srt-workbench-index">{index+1}</span>
      <label htmlFor={`${id}-start`}>{say('Início','Start')}</label><input id={`${id}-start`} value={row.start} disabled={busy||running} aria-invalid={rowErrors.some(e=>['start','overlap'].includes(e))} onChange={event=>patch(row.key,{start:event.target.value})}/>
      <label htmlFor={`${id}-end`}>{say('Fim','End')}</label><input id={`${id}-end`} value={row.end} disabled={busy||running} aria-invalid={rowErrors.some(e=>['end','order'].includes(e))} onChange={event=>patch(row.key,{end:event.target.value})}/>
      <span className="srt-workbench-timing">{srtTimingLabel(row.timing,pt)}</span>
      {playerSrc&&<><button type="button" className="text-link" onClick={()=>listen(row)}>{say('Ouvir','Play')}</button><button type="button" className="text-link" disabled={busy||running} onClick={()=>patch(row.key,{start:now()})}>{say('início = agora','start = now')}</button><button type="button" className="text-link" disabled={busy||running} onClick={()=>patch(row.key,{end:now()})}>{say('fim = agora','end = now')}</button></>}
     </div>
     <textarea aria-label={say(`Texto do bloco ${index+1}`,`Text of block ${index+1}`)} rows={1} value={row.text} disabled={busy||running} aria-invalid={rowErrors.includes('text')} onChange={event=>patch(row.key,{text:event.target.value})}/>
     {rowErrors.length>0&&<p className="thumbnail-gallery-error" role="alert">{rowErrors.map(e=>srtRowErrorText(e,pt)).join(' ')}</p>}
     <div className="srt-workbench-row-actions">
      <button type="button" className="text-link" disabled={busy||running||!splitRow(row)} onClick={()=>{const parts=splitRow(row);if(parts)setRows([...rows.slice(0,index),...parts,...rows.slice(index+1)]);}}>{say('Dividir','Split')}</button>
      {index<rows.length-1&&<button type="button" className="text-link" disabled={busy||running} onClick={()=>setRows([...rows.slice(0,index),joinRows(row,rows[index+1]),...rows.slice(index+2)])}>{say('Juntar com o próximo','Join with next')}</button>}
      <button type="button" className="text-link" disabled={busy||running||rows.length<2} onClick={()=>setRows(rows.filter(item=>item.key!==row.key))}>{say('Remover','Remove')}</button>
     </div>
    </li>;})}
   </ol>

   <div className="srt-workbench-actions">
    <button type="button" className="primary-button" disabled={busy||running||stale||!valid} onClick={()=>void exportSrt()}>{dirty?say('Salvar e baixar SRT','Save and download SRT'):say(`Baixar SRT (v${latest.version})`,`Download SRT (v${latest.version})`)}</button>
    {dirty&&<button type="button" className="soft-button" disabled={busy||running||!valid} onClick={()=>void save()}>{say(`Só salvar versão v${latest.version+1}`,`Only save version v${latest.version+1}`)}</button>}
    {dirty&&<button type="button" className="text-link" disabled={busy} onClick={discard}>{say('Descartar alterações','Discard changes')}</button>}
    {!valid&&<span className="editorial-hint">{say('Corrija os blocos marcados para baixar.','Fix the marked blocks to download.')}</span>}
    {valid&&estimated&&<span className="editorial-hint">{say('Contém tempos estimados: confira no CapCut.','Contains estimated times: check them in CapCut.')}</span>}
   </div>

   {receipt&&<div className="srt-workbench-receipt" role="status">
    <strong>{receipt.reused?say('SRT já exportado (mesmo conteúdo, sem duplicar)','SRT already exported (same content, not duplicated)'):say('SRT exportado e verificado','SRT exported and verified')}</strong>
    <p><code className="delivery-receipt-path">{receipt.export.path}</code></p>
    <p>{receipt.export.name} · {kb(receipt.export.size)} · sha256 {receipt.export.sha256.slice(0,12)}… · v{receipt.export.version}{receipt.export.estimated?say(' · tempos estimados',' · estimated times'):''}</p>
    <div className="srt-workbench-row-actions"><button type="button" className="text-link" onClick={()=>download(receipt.export)}>{say('Baixar de novo','Download again')}</button>{receipt.export.assetId&&window.mainsAgentsDesktop?.files&&<button type="button" className="text-link" onClick={()=>reveal(receipt.export)}>{say('Mostrar arquivo','Show file')}</button>}</div>
    <p className="editorial-hint">{say('No CapCut, abra o mesmo projeto e importe este .srt nas legendas (arquivo local). O visual/animação da legenda é escolhido no CapCut; este arquivo traz só texto e tempos. Modelos de legenda do CapCut podem tratar SRT de formas diferentes.','In CapCut, open the same project and import this .srt as captions (local file). The caption look/animation is chosen in CapCut; this file carries only text and times. CapCut caption templates may handle SRT differently.')}</p>
   </div>}
   {doc.exports.length>0&&<details className="srt-workbench-history"><summary>{say(`Exportações anteriores (${doc.exports.length})`,`Previous exports (${doc.exports.length})`)}</summary><ul>{[...doc.exports].reverse().map(entry=><li key={entry.sha256}><button type="button" className="text-link" onClick={()=>download(entry)}>{entry.name}</button> · {kb(entry.size)} · {new Date(entry.createdAt).toLocaleString(pt?'pt-BR':'en-US')}</li>)}</ul></details>}
  </>}
  {error&&<p className="delivery-error" role="alert">{error}</p>}
 </section>;
}
