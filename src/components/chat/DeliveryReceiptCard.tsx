import {useEffect,useState} from 'react';
import type {DeliveryReceiptView} from '../../features/chat/model/Chat';
import {useLanguage} from '../../app/LanguageProvider';
import {storageProfile} from '../../data/IndexedDbStateStore';

const openable=['video','image','audio'];
const size=(bytes:number)=>bytes>=1e9?`${(bytes/1e9).toFixed(2)} GB`:bytes>=1e6?`${(bytes/1e6).toFixed(1)} MB`:`${Math.max(1,Math.round(bytes/1e3))} KB`;
const providerName=(id?:string)=>id==='claude'?'Claude Code':id==='codex'?'Codex':id;

/**
 * Finished file as the HOST verified it: name, absolute path, size, sha256 and version, with copy/open/show actions.
 * The path comes from the host receipt (never from model text); open/show re-verify the bytes on the host first.
 */
export function DeliveryReceiptCard({receipts}:{receipts:readonly DeliveryReceiptView[]}){
 const {locale}=useLanguage(),pt=locale==='pt-BR',native=window.mainsAgentsDesktop?.receipts;
 const [status,setStatus]=useState<Record<string,string>>({}),[note,setNote]=useState<Record<string,string>>({});
 useEffect(()=>{let live=true;if(!native)return;for(const receipt of receipts)void native.check(storageProfile(),receipt.id).then(result=>{if(live)setStatus(current=>({...current,[receipt.id]:result.status}));}).catch(()=>{});return()=>{live=false;};},[native,receipts]);
 const act=async(receipt:DeliveryReceiptView,action:()=>Promise<unknown>,done:string)=>{try{await action();setNote(current=>({...current,[receipt.id]:done}));}catch(error){setNote(current=>({...current,[receipt.id]:error instanceof Error?error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/,''):String(error)}));}};
 return <div className="delivery-receipts">{receipts.map(receipt=>{
  const state=status[receipt.id],ok=state===undefined||state==='available';
  return <section key={receipt.id} className="chat-delivery delivery-receipt" aria-label={pt?`Arquivo entregue: ${receipt.name}`:`Delivered file: ${receipt.name}`}>
   <header><b>{receipt.name}</b><span>v{receipt.version} · {size(receipt.size)}</span></header>
   <code className="delivery-receipt-path" title={receipt.path}>{receipt.path}</code>
   <small>{pt?'Verificado pelo app':'Verified by the app'} · SHA-256 {receipt.sha256.slice(0,12)}…{receipt.producedBy?.providerId?` · ${pt?'direção':'directed by'} ${receipt.producedBy.agentName??''} (${providerName(receipt.producedBy.providerId)})`:''}</small>
   {state&&state!=='available'&&<p className="delivery-error" role="status">{state==='changed'?(pt?'O arquivo mudou depois da entrega.':'The file changed after delivery.'):state==='missing'?(pt?'O arquivo foi movido ou removido.':'The file was moved or removed.'):(pt?'O arquivo não pôde ser lido agora.':'The file cannot be read right now.')}</p>}
   <div className="delivery-actions">
    <button type="button" className="soft-button" onClick={()=>void act(receipt,()=>navigator.clipboard.writeText(receipt.path),pt?'Caminho copiado.':'Path copied.')}>{pt?'Copiar caminho':'Copy path'}</button>
    {openable.includes(receipt.fileKind)&&<button type="button" className="soft-button" disabled={!native||!ok} onClick={()=>void act(receipt,()=>native!.open(storageProfile(),receipt.id),pt?'Aberto no app padrão.':'Opened in the default app.')}>{pt?'Abrir':'Open'}</button>}
    <button type="button" className="soft-button" disabled={!native||!ok} onClick={()=>void act(receipt,()=>native!.reveal(storageProfile(),receipt.id),pt?'Pasta aberta.':'Folder opened.')}>{pt?'Mostrar na pasta':'Show in folder'}</button>
   </div>
   {note[receipt.id]&&<small role="status">{note[receipt.id]}</small>}
  </section>;})}</div>;
}
