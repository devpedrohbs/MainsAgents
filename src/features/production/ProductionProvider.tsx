import {createContext,useContext,useEffect,useRef,useState,type PropsWithChildren} from 'react';
import {useAgents} from '../agents/AgentsProvider';
import {useWorkspaces} from '../../app/WorkspaceProvider';
import {useLanguage} from '../../app/LanguageProvider';
import {usePersistentState,updatePersistentValue,saveNow} from '../../data/localPersistence';
import {storageProfile} from '../../data/IndexedDbStateStore';
import type {AgentSession} from '../chat/model/Chat';
import {initialProductionFlows,type ProductionFlows} from '../flows/flowModel';
import {mergeProductionSessions,type ProductionRun} from './model';
interface ProductionContext {runs:ProductionRun[];ready:boolean;error:string;flows:ProductionFlows;refresh:()=>Promise<void>;start:(input:Record<string,unknown>)=>Promise<ProductionRun>;command:(run:ProductionRun,action:string,data?:Record<string,unknown>)=>Promise<ProductionRun>}
const Context=createContext<ProductionContext|null>(null);
const profile=()=>window.mainsAgentsDesktop?.state?storageProfile():localStorage.getItem('mainsagents-profile')||'default';
export function ProductionProvider({children}:PropsWithChildren){
 const {agents}=useAgents(),{currentWorkspaceId}=useWorkspaces(),{locale}=useLanguage();
 const [flows]=usePersistentState<ProductionFlows>('production-flows',()=>initialProductionFlows(currentWorkspaceId,agents,locale==='pt-BR'));
 const [runs,setRuns]=useState<ProductionRun[]>([]),[ready,setReady]=useState(false),[error,setError]=useState('');
 const latestAgents=useRef(agents);latestAgents.current=agents;const requests=useRef(new Map<string,string>()),inFlight=useRef(false),live=useRef(true);
 async function request(path:string,body?:Record<string,unknown>){const response=await fetch(`/api/content/productions${path}?profile=${encodeURIComponent(profile())}`,{cache:'no-store',...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});const result=await response.json();if(!response.ok)throw Error(result.error??'Produção indisponível.');return result;}
 async function refresh(){if(inFlight.current)return;inFlight.current=true;try{const result=await request('');if(!Array.isArray(result.productions))throw Error('O serviço não confirmou o histórico de produções.');if(live.current){setRuns(result.productions);setReady(true);setError('');updatePersistentValue<AgentSession[]>('sessions',[],current=>mergeProductionSessions(current,result.productions,latestAgents.current));}}catch(failure){if(live.current)setError(failure instanceof Error?failure.message:String(failure));}finally{inFlight.current=false;}}
 useEffect(()=>{live.current=true;void refresh();const timer=setInterval(()=>void refresh(),1000);return()=>{live.current=false;clearInterval(timer)}},[]);
 async function submit(path:string,input:Record<string,unknown>){await saveNow();const fingerprint=JSON.stringify({path,input}),requestId=requests.current.get(fingerprint)??crypto.randomUUID();requests.current.set(fingerprint,requestId);const result=await request(path,{...input,requestId});requests.current.delete(fingerprint);await refresh();return result.production as ProductionRun;}
 async function start(input:Record<string,unknown>){const run=await submit('',input);updatePersistentValue<Record<string,string>>('active-sessions',{},current=>({...current,[run.sourceSession.agentId]:run.sourceSession.id,[run.editorSession.agentId]:run.editorSession.id,...(run.publisherSession?{[run.publisherSession.agentId]:run.publisherSession.id}:{})}));updatePersistentValue<ProductionFlows>('production-flows',flows,current=>({...current,activeByWorkspace:{...current.activeByWorkspace,[run.workspaceId]:run.flowId},flows:current.flows.map(flow=>flow.id===run.flowId?{...flow,contentId:run.contentId,nodes:flow.nodes.map(node=>({...node,sessionId:node.kind==='content-agent'?run.sourceSession.id:node.kind==='video-agent'?run.editorSession.id:node.kind==='publishing-agent'?(run.publisherSession??run.sourceSession).id:node.sessionId}))}:flow)}));return run;}
 return <Context.Provider value={{runs,ready,error,flows,refresh,start,command:(run,action,data={})=>submit(`/${encodeURIComponent(run.id)}`,{revision:run.revision,action,...data})}}>{children}</Context.Provider>;
}
export function useProduction(){const context=useContext(Context);if(!context)throw Error('ProductionProvider unavailable');return context;}
