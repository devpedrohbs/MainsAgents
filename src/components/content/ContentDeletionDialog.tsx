import {useCallback,useEffect,useRef,useState} from 'react';
import {useAgents} from '../../features/agents/AgentsProvider';
import {useChat} from '../../features/chat/ChatProvider';
import {DeletionRefused,deleteContentLocally,localDeletionAvailable,previewContentDeletion,type DeletionPreview,type DeletionWork} from '../../features/content/contentDeletion';
import {FlowDialog} from '../common/FlowDialog';
import '../../styles/content-deletion.css';

const plural=(count:number,one:string,many:string)=>`${count} ${count===1?one:many}`;

/**
 * The single, final confirmation of a LOCAL content deletion. It names the content, shows what leaves the app (counted by
 * real ids on the host) and what stays untouched. Busy local work is listed; confirming stops it through its own cancel
 * path and deletes only when the stop is confirmed. External operations and shared chats block with the reason.
 */
export function ContentDeletionDialog({contentId,workspaceId,fallbackTitle,pt,onClose,onDeleted}:{
 contentId:string;workspaceId:string;fallbackTitle:string;pt:boolean;onClose:()=>void;onDeleted:(summary:{title:string;chats:number})=>void;
}){
 const {agents}=useAgents(),{respondingSessions,stopSessions}=useChat();
 const [preview,setPreview]=useState<DeletionPreview|null>(null),[loading,setLoading]=useState(true),[deleting,setDeleting]=useState(false);
 const [error,setError]=useState(''),[remaining,setRemaining]=useState<DeletionWork[]>([]),[, setTick]=useState(0);
 const live=useRef(true);
 const load=useCallback(async()=>{
  setLoading(true);
  try{
   const result=await previewContentDeletion(contentId,workspaceId);if(!live.current)return;
   if('alreadyDeleted' in result){onDeleted({title:fallbackTitle,chats:0});return;}
   setPreview(result);
  }catch(reason){if(live.current)setError(reason instanceof Error?reason.message:String(reason));}
  finally{if(live.current)setLoading(false);}
 },[contentId,workspaceId,fallbackTitle,onDeleted]);
 useEffect(()=>{live.current=true;void load();return()=>{live.current=false;};},[load]);
 // Responding chats are read live (a reply can start or end while the dialog is open).
 useEffect(()=>{const timer=window.setInterval(()=>setTick(value=>value+1),800);return()=>window.clearInterval(timer);},[]);
 const title=preview?.title??fallbackTitle;
 const responding=preview?respondingSessions(preview.sessionIds):[];
 const busy=preview?[...preview.busy,...responding.map(id=>({kind:'chat',id,label:pt?'Conversa respondendo agora':'Chat responding now'}))]:[];
 const blockers=preview?.blockers??[];
 const agentName=(id:string)=>agents.find(agent=>agent.id===id)?.name??(pt?'Agente removido':'Deleted agent');
 const close=()=>{if(!deleting)onClose();};
 async function confirm(){
  if(!preview||blockers.length||deleting)return;
  setDeleting(true);setError('');setRemaining([]);
  try{
   const ids=preview.sessionIds,still=respondingSessions(ids).length?await stopSessions(ids):[];
   if(still.length){setError(pt?'Uma conversa deste conteúdo não confirmou a parada da resposta. Nada foi apagado; tente de novo em instantes.':'A chat of this content did not confirm that its reply stopped. Nothing was deleted; try again shortly.');return;}
   const result=await deleteContentLocally(preview,{stopLocalWork:preview.busy.length>0,rendererBusy:respondingSessions(ids)});
   onDeleted({title,chats:result.alreadyDeleted?0:preview.counts.chats});
  }catch(reason){
   if(!live.current)return;
   const refused=reason instanceof DeletionRefused?reason:undefined;
   setError(reason instanceof Error?reason.message:String(reason));
   if(refused?.busy)setRemaining(refused.busy);
   // The confirmed counts changed: show the current ones (still one confirmation, nothing deleted yet).
   if(refused?.code==='stale'||refused?.code==='blocked')void load();
  }finally{if(live.current)setDeleting(false);}
 }
 const counts=preview?.counts;
 const byAgent=counts?Object.entries(counts.chatsByAgent).filter(([id])=>id!=='unknown').map(([id,count])=>`${agentName(id)} · ${plural(count,pt?'conversa':'chat',pt?'conversas':'chats')}`):[];
 const records=counts?[
  counts.productions&&plural(counts.productions,pt?'produção':'production',pt?'produções':'productions'),
  counts.specialistWork&&plural(counts.specialistWork,pt?'trabalho de especialista':'specialist task',pt?'trabalhos de especialista':'specialist tasks'),
  counts.srtDocuments&&plural(counts.srtDocuments,pt?'documento SRT':'SRT document',pt?'documentos SRT':'SRT documents'),
  counts.artifacts&&plural(counts.artifacts,pt?'roteiro/registro':'script/record',pt?'roteiros e registros':'scripts and records'),
  counts.assets&&plural(counts.assets,pt?'referência de arquivo':'file reference',pt?'referências de arquivo':'file references'),
  counts.publications&&plural(counts.publications,pt?'rascunho de publicação':'publication draft',pt?'rascunhos de publicação':'publication drafts'),
  counts.jobs&&plural(counts.jobs,pt?'tarefa local':'local job',pt?'tarefas locais':'local jobs'),
  counts.receipts&&plural(counts.receipts,pt?'recibo local':'local receipt',pt?'recibos locais':'local receipts'),
 ].filter(Boolean) as string[]:[];
 const available=localDeletionAvailable();
 const action=busy.length?(pt?'Parar trabalhos locais e excluir':'Stop local work and delete'):(pt?`Excluir conteúdo e ${plural(counts?.chats??0,'conversa','conversas')}`:`Delete content and ${plural(counts?.chats??0,'chat','chats')}`);
 return <FlowDialog title={pt?`Excluir “${title}”?`:`Delete “${title}”?`} description={pt?'Remove este conteúdo e tudo o que o MainsAgents guarda dele neste computador. Não dá para desfazer.':'Removes this content and everything MainsAgents keeps for it on this computer. This cannot be undone.'} onClose={close}>
  <div className="content-deletion" aria-busy={loading||deleting}>
   {loading&&!preview&&<p role="status">{pt?'Contando o que será removido…':'Counting what will be removed…'}</p>}
   {!available&&<p role="alert">{pt?'A exclusão local de conteúdo está disponível no app desktop.':'Local content deletion is available in the desktop app.'}</p>}
   {preview&&counts&&<>
    <section aria-label={pt?'Sai do app':'Leaves the app'}>
     <h3>{pt?'Sai do MainsAgents':'Leaves MainsAgents'}</h3>
     <ul className="content-deletion-list">
      <li><b>{plural(counts.chats,pt?'conversa':'chat',pt?'conversas':'chats')}</b>{byAgent.length>0&&<span>{byAgent.join(', ')}</span>}</li>
      {records.length>0&&<li><b>{records.join(' · ')}</b></li>}
      <li><span>{pt?'Rascunhos de chat/estúdio/produção, ponteiros de conversa e caixas do Fluxo ligadas a este conteúdo.':'Chat/studio/production drafts, chat pointers and Flow boxes linked to this content.'}</span></li>
     </ul>
    </section>
    <p className="content-deletion-keeps">{pt?'Fica intacto: arquivos no disco (gravações brutas, vídeos exportados e renders), agentes, Paper, Notion, contas, backups e posts ou agendamentos já enviados. Nada é cancelado no provedor.':'Untouched: files on disk (raw recordings, exported videos and renders), agents, Paper, Notion, accounts, backups and posts or schedules already sent. Nothing is canceled at the provider.'}
     {counts.deliveryFactsKept>0&&(pt?` ${plural(counts.deliveryFactsKept,'entrega já enviada fica registrada','entregas já enviadas ficam registradas')} só com o mínimo (provedor, conta e identificadores), sem o texto.`:` ${plural(counts.deliveryFactsKept,'sent delivery keeps','sent deliveries keep')} only a minimal record (provider, account, ids), without the text.`)}</p>
    {busy.length>0&&<section className="content-deletion-busy" aria-label={pt?'Em andamento':'In progress'}>
     <h3>{pt?'Em andamento agora':'Running now'}</h3>
     <ul>{busy.map(item=><li key={`${item.kind}-${item.id}`}>{item.label}</li>)}</ul>
     <p>{pt?'Ao confirmar, o app pede a parada desses trabalhos locais e só exclui quando a parada for confirmada. Se algo não parar, nada é apagado.':'On confirm, the app asks these local tasks to stop and deletes only once the stop is confirmed. If anything does not stop, nothing is deleted.'}</p>
    </section>}
    {blockers.map(item=><p key={item.message} role="alert" className="content-deletion-blocker">{item.message}</p>)}
   </>}
   {error&&<div role="alert" className="content-deletion-error"><p>{error}</p>{remaining.length>0&&<ul>{remaining.map(item=><li key={`${item.kind}-${item.id}`}>{item.label}</li>)}</ul>}</div>}
   <footer>
    <button type="button" className="soft-button" data-autofocus disabled={deleting} onClick={close}>{pt?'Cancelar':'Cancel'}</button>
    {error&&!deleting&&!preview&&<button type="button" className="soft-button" onClick={()=>{setError('');void load();}}>{pt?'Tentar novamente':'Try again'}</button>}
    <button type="button" className="danger-button" disabled={!preview||!available||blockers.length>0||deleting||loading} aria-busy={deleting} onClick={()=>void confirm()}>
     {deleting?(pt?'Excluindo…':'Deleting…'):error&&preview&&!blockers.length?(pt?`Tentar novamente: ${action.toLowerCase()}`:`Try again: ${action.toLowerCase()}`):action}
    </button>
   </footer>
  </div>
 </FlowDialog>;
}
