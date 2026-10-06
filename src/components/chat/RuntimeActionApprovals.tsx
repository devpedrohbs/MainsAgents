import {useEffect,useState} from 'react';
import {useLanguage} from '../../app/LanguageProvider';
import {storageProfile} from '../../data/IndexedDbStateStore';
import '../../styles/runtime-actions.css';

interface Action {id:string;hash:string;sessionId:string;agentName:string;server:string;tool:string;category?:string;arguments:unknown;status:string;error?:string}
const labels:Record<string,[string,string]>={pending:['Aguardando aprovação','Awaiting approval'],approved:['Aprovada · aguardando execução','Approved · waiting to run'],running:['Executando','Running'],succeeded:['Execução confirmada','Execution confirmed'],failed:['Falhou','Failed'],denied:['Recusada','Denied'],interrupted:['Interrompida · resultado não confirmado','Interrupted · outcome unconfirmed']};
export function RuntimeActionApprovals({sessionId,history=false}:{sessionId?:string;history?:boolean}){
 const {locale}=useLanguage(),pt=locale==='pt-BR';
 const [actions,setActions]=useState<Action[]>([]),[error,setError]=useState(''),[working,setWorking]=useState('');
 const url=`/api/content/actions?profile=${encodeURIComponent(storageProfile())}${sessionId?'&session='+encodeURIComponent(sessionId):''}`;
 useEffect(()=>{if(!window.mainsAgentsDesktop?.state)return;let active=true;
  const refresh=async()=>{try{const response=await fetch(url,{cache:'no-store'});if(!response.ok)return;const data=await response.json();if(active)setActions(data.actions??[]);}catch{/* Keep the last confirmed audit while offline. */}};
  void refresh();const timer=setInterval(()=>void refresh(),1200);return()=>{active=false;clearInterval(timer);};
 },[url]);
 const visible=actions.filter(action=>history||['pending','approved','running'].includes(action.status));
 async function decide(action:Action,decision:'approve'|'deny'){
  setWorking(action.id);setError('');try{const response=await fetch(`/api/content/actions/${encodeURIComponent(action.id)}?profile=${encodeURIComponent(storageProfile())}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({hash:action.hash,decision})});const data=await response.json();if(!response.ok)throw new Error(data.error);setActions(current=>current.map(item=>item.id===action.id?data:item));}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setWorking('');}
 }
 if(!visible.length&&!error)return null;
 return <section className="runtime-actions" aria-label={pt?'Aprovações de ferramentas':'Tool approvals'}>
 {actions.some(action=>action.status==='pending')&&<p className="runtime-approval-notice" role="status">{pt?'A IA está aguardando sua aprovação para usar ferramentas. Confira as chamadas abaixo para continuar.':'The AI is waiting for your approval to use tools. Review the calls below to continue.'}</p>}
 {visible.map(action=><article className="runtime-action" key={action.id} data-action-status={action.status}>
  <header><strong>{action.server} / {action.tool}</strong><span>{action.agentName}</span></header>
  <p role="status">{(labels[action.status]??[action.status,action.status])[pt?0:1]}</p>
  <p>{({read:pt?'Consulta de dados':'Read data',write:pt?'Alteração de dados':'Change data',schedule:pt?'Agendamento':'Schedule',publish:pt?'Publicação ou envio':'Publish or send',delete:pt?'Exclusão ou cancelamento':'Delete or cancel',unknown:pt?'Efeito não classificado: confira os argumentos':'Unclassified effect: review arguments'} as Record<string,string>)[action.category??'unknown']}</p>
  <details open={action.status==='pending'}><summary>{pt?'Dados exatos desta chamada':'Exact data for this call'}</summary><pre>{JSON.stringify(action.arguments,null,2)}</pre></details>
  {action.status==='pending'&&<><small>{pt?'A ferramenta aguarda sua decisão. A aprovação vale somente para estes dados, nesta chamada.':'The tool is waiting for your decision. Approval applies only to this call and these data.'}</small><footer><button className="soft-button" disabled={!!working} onClick={()=>void decide(action,'deny')}>{pt?'Recusar':'Deny'}</button><button className="primary-button" disabled={!!working} onClick={()=>void decide(action,'approve')}>{pt?'Aprovar uma vez':'Approve once'}</button></footer></>}
  {action.error&&<small>{action.error}</small>}
 </article>)}{error&&<p role="alert">{error}</p>}
 </section>;
}
