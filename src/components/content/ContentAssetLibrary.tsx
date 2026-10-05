import {useRef,useState} from 'react';
import {useLanguage} from '../../app/LanguageProvider';
import {storageProfile} from '../../data/IndexedDbStateStore';
import {useContentWorkflow} from '../../features/content/ContentWorkflowProvider';
import {currentAssetVersion,type AssetRole,type EditorialAsset,type LocalAssetInspection} from '../../features/content/assetModel';
import type {EditorialContent} from '../../features/content/model';
import {SelectMenu} from '../common/SelectMenu';
import './content-assets.css';

export function ContentAssetLibrary({content}:{content:EditorialContent}){
  const {locale}=useLanguage(),pt=locale==='pt-BR';
  const {state,attachFiles,reviseFile,verifyFiles,changeFile,removeFile}=useContentWorkflow();
  const native=window.mainsAgentsDesktop?.files;
  const assets=(state.assets??[]).filter(asset=>asset.contentId===content.id&&asset.workspaceId===content.workspaceId);
  const [role,setRole]=useState<AssetRole>('source'),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState(''),[drag,setDrag]=useState(false),[removeId,setRemoveId]=useState<string>();
  const verified=useRef(new Map<string,string>());
  const roles=[{value:'source',label:pt?'Original':'Original'},{value:'reference',label:pt?'Referência':'Reference'},{value:'output',label:pt?'Resultado':'Output'}];
  const statuses={available:pt?'Verificado':'Verified',unchecked:pt?'A verificar':'Needs verification',missing:pt?'Não encontrado':'Missing',changed:pt?'Alterado':'Changed',unstable:pt?'Em alteração':'Still changing',error:pt?'Não foi possível ler':'Unreadable'};
  const run=async(action:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');setNotice('');try{await action()}catch(failure){setError(failure instanceof Error?failure.message:String(failure))}finally{setBusy(false)}};
  const attach=async(files:LocalAssetInspection[])=>{
    const valid=files.filter(file=>file.status==='available'),failed=files.filter(file=>file.status!=='available');
    if(valid.length){
      const seen=new Set(assets.flatMap(asset=>asset.versions.map(version=>version.sha256)));
      let duplicate=0;for(const file of valid){if(seen.has(file.sha256!))duplicate++;seen.add(file.sha256!);}
      await attachFiles(content.id,valid,role);
      for(const file of valid)verified.current.set(file.path,file.sha256!);
      setNotice(pt?`${valid.length-duplicate} arquivo(s) associado(s)${duplicate?` · ${duplicate} já existente(s)`:''}`:`${valid.length-duplicate} file(s) associated${duplicate?` · ${duplicate} already present`:''}`);
    }
    if(failed.length)setError(failed.map(file=>`${file.name||file.path}: ${file.error}`).join('\n'));
  };
  const select=()=>run(async()=>{if(native)await attach(await native.select(storageProfile(),content.id))});
  const revise=(asset:EditorialAsset,relink:boolean)=>run(async()=>{
    if(!native)return;
    const versionId=asset.currentVersionId;
    const [file]=await native.select(storageProfile(),content.id,false);if(!file)return;
    await reviseFile(asset.id,versionId,file,relink);verified.current.set(file.path,file.sha256!);
    setNotice(pt?(relink?'Arquivo religado.':'Versão salva.'):(relink?'File relinked.':'Version saved.'));
  });
  const verify=()=>run(async()=>{if(!native)return;const checks=await native.verify(storageProfile(),content.id);await verifyFiles(checks);for(const check of checks)if(check.inspection.status==='available')verified.current.set(check.inspection.path,check.inspection.sha256!);setNotice(pt?'Verificação concluída.':'Verification complete.')});
  return <section className={`editorial-card content-assets ${drag?'is-dragging':''}`} aria-label={pt?'Arquivos do conteúdo':'Content files'} onDragOver={event=>{if(!native||busy||!event.dataTransfer.types.includes('Files'))return;event.preventDefault();event.dataTransfer.dropEffect='link';setDrag(true)}} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setDrag(false)}} onDrop={event=>{
    event.preventDefault();setDrag(false);if(!native||busy)return;
    const files=Array.from(event.dataTransfer.files);
    void run(async()=>{const paths=files.map(file=>native.pathForFile(file));if(!paths.length||paths.some(path=>!path))throw new Error(pt?'Arraste arquivos locais do Explorador de Arquivos.':'Drag local files from File Explorer.');await attach(await native.inspect(storageProfile(),content.id,paths))});
  }}>
    <div className="editorial-section-head"><div><span className="editorial-kicker">{pt?'BIBLIOTECA':'LIBRARY'}</span><h2>{pt?'Arquivos do conteúdo':'Content files'}</h2><p className="editorial-meta">{pt?'Brutos, referências e entregas da mesma pauta.':'Originals, references and deliverables for this content.'}</p></div><span className="content-asset-count">{assets.length}</span></div>
    <div className="content-asset-toolbar"><SelectMenu value={role} options={roles} onChange={value=>setRole(value as AssetRole)} ariaLabel={pt?'Tipo de arquivo a adicionar':'File role to add'} disabled={busy||!native}/><button className="primary-button" disabled={busy||!native} onClick={select}>{pt?'Adicionar arquivos':'Add files'}</button><button className="soft-button" disabled={busy||!native||!assets.length} onClick={verify}>{pt?'Verificar arquivos':'Verify files'}</button></div>
    <p className="content-asset-hint">{native?(pt?'Arraste arquivos para cá ou selecione no PC. Os arquivos permanecem na pasta original; o backup guarda os vínculos, sem copiar ou enviar vídeos.':'Drop files here or select them on your PC. Files stay in their original folder; backups save references, without copying or uploading videos.'):(pt?'Use o app desktop para associar e verificar arquivos locais.':'Use the desktop app to associate and verify local files.')}</p>
    {busy&&<p role="status" className="content-asset-hint">{pt?'Verificando e salvando… Vídeos grandes podem levar mais tempo.':'Verifying and saving… Large videos may take longer.'}</p>}
    {notice&&<p role="status" className="content-asset-hint">{notice}</p>}{error&&<p role="alert" className="content-asset-error">{error}</p>}
    {!assets.length&&<div className="content-asset-empty">{pt?'Associe seu primeiro arquivo a esta pauta.':'Associate your first file with this content.'}</div>}
    <div className="content-asset-list">{assets.map(asset=>{
      const version=currentAssetVersion(asset),status=asset.status==='available'&&verified.current.get(version.path)!==version.sha256?'unchecked':asset.status;
      const size=version.size>=1024*1024?`${(version.size/1024/1024).toFixed(1)} MB`:`${Math.ceil(version.size/1024)} KB`;
      return <article className="content-asset" key={asset.id}>
        <div className="content-asset-heading"><strong title={asset.name}>{asset.name}</strong><span data-status={status} className="content-asset-status">{statuses[status]}</span></div>
        <div className="content-asset-info">{asset.kind} · {size} · v{asset.versions.findIndex(item=>item.id===version.id)+1}</div>
        <code className="content-asset-path" title={version.path}>{version.path}</code>
        {asset.lastError&&<p className="content-asset-error">{asset.lastError}</p>}
        <div className="content-asset-controls"><SelectMenu value={asset.role} options={roles} onChange={value=>void run(()=>changeFile(asset.id,value as AssetRole))} ariaLabel={`${pt?'Função':'Role'}: ${asset.name}`} disabled={busy}/>
          {asset.role==='output'&&<SelectMenu value={asset.sourceAssetId??''} options={[{value:'',label:pt?'Origem não vinculada':'No source linked'},...assets.filter(item=>item.id!==asset.id).map(item=>({value:item.id,label:item.name}))]} onChange={value=>void run(()=>changeFile(asset.id,'output',value||undefined))} ariaLabel={`${pt?'Arquivo de origem':'Source file'}: ${asset.name}`} disabled={busy}/>}
          <button className="soft-button" disabled={busy||!native} onClick={()=>void run(async()=>{await native?.reveal(storageProfile(),content.id,asset.id)})}>{pt?'Mostrar na pasta':'Show in folder'}</button>
          <button className="soft-button" disabled={busy||!native} onClick={()=>revise(asset,true)}>{pt?'Localizar':'Locate'}</button><button className="soft-button" disabled={busy||!native} onClick={()=>revise(asset,false)}>{pt?'Nova versão':'New version'}</button>
          <button className="soft-button" disabled={busy} onClick={()=>setRemoveId(asset.id)}>{pt?'Desassociar':'Unlink'}</button></div>
        {removeId===asset.id&&<div className="content-asset-confirm"><span>{pt?'Remover o vínculo? O arquivo no PC será mantido.':'Remove this association? The local file will remain.'}</span><button className="soft-button" disabled={busy} onClick={()=>void run(async()=>{await removeFile(asset.id);setRemoveId(undefined)})}>{pt?'Confirmar':'Confirm'}</button><button className="soft-button" onClick={()=>setRemoveId(undefined)}>{pt?'Cancelar':'Cancel'}</button></div>}
        <details className="content-asset-versions"><summary>{pt?'Histórico de versões':'Version history'} · {asset.versions.length}</summary>{[...asset.versions].reverse().map((item,index)=><div key={item.id}><b>v{asset.versions.length-index} · {item.name}</b><span>{new Date(item.createdAt).toLocaleString(locale)} · SHA-256 {item.sha256.slice(0,12)}</span><code>{item.path}</code></div>)}</details>
      </article>;
    })}</div>
  </section>;
}
