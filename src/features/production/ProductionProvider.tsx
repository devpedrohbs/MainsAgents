import {createContext,useContext,useEffect,useRef,useState,type PropsWithChildren} from 'react';
import {useAgents} from '../agents/AgentsProvider';
import {useWorkspaces} from '../../app/WorkspaceProvider';
import {useLanguage} from '../../app/LanguageProvider';
import {usePersistentState,updatePersistentValue,saveNow} from '../../data/localPersistence';
import {storageProfile} from '../../data/IndexedDbStateStore';
import type {AgentSession} from '../chat/model/Chat';
import {initialProductionFlows,type ProductionFlows} from '../flows/flowModel';
import {mergeProductionSessions,type ProductionRun} from './model';
import {contentScopesKey,normalizeContentScopes,withActive,contentScopeKey,type ContentScopeState} from '../chat/contentScopes';
import type {PreflightReport} from '../../../production-preflight.mjs';
import {contentDeletedEvent,deletedLocally} from '../content/contentDeletion';
interface ProductionContext {runs:ProductionRun[];ready:boolean;error:string;flows:ProductionFlows;refresh:()=>Promise<void>;start:(input:Record<string,unknown>)=>Promise<ProductionRun>;command:(run:ProductionRun,action:string,data?:Record<string,unknown>)=>Promise<ProductionRun>;preflight:(input:Record<string,unknown>)=>Promise<PreflightReport>;editDirector:(workspaceId:string)=>Promise<EditDirector>;setEditDirector:(workspaceId:string,director:EditDirector)=>Promise<EditDirector>}
/** Who directs edits/motion in a workspace: a function choice (default Claude Code), not an agent change. */
export interface EditDirector {providerId:'claude'|'codex'|'agent';modelId?:string;source?:string}
const Context=createContext<ProductionContext|null>(null);
const profile=()=>window.mainsAgentsDesktop?.state?storageProfile():localStorage.getItem('mainsagents-profile')||'default';
export function ProductionProvider({children}:PropsWithChildren){
 const {agents}=useAgents(),{currentWorkspaceId}=useWorkspaces(),{locale}=useLanguage();
 const [flows]=usePersistentState<ProductionFlows>('production-flows',()=>initialProductionFlows(currentWorkspaceId,agents,locale==='pt-BR'));
 const [runs,setRuns]=useState<ProductionRun[]>([]),[ready,setReady]=useState(false),[error,setError]=useState('');
 const latestAgents=useRef(agents);latestAgents.current=agents;const requests=useRef(new Map<string,string>()),inFlight=useRef(false),live=useRef(true),generation=useRef(0);
 async function request(path:string,body?:Record<string,unknown>){const response=await fetch(`/api/content/productions${path}?profile=${encodeURIComponent(profile())}`,{cache:'no-store',...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});const result=await response.json();if(!response.ok)throw Error(result.error??'Produção indisponível.');return result;}
 async function refresh(){if(inFlight.current)return;inFlight.current=true;const started=generation.current;try{const result=await request('');if(!Array.isArray(result.productions))throw Error('O serviço não confirmou o histórico de produções.');
  // A response that started before a local deletion is dropped: its runs/chats were already removed by the host.
  if(started!==generation.current)return;const productions=(result.productions as ProductionRun[]).filter(run=>!deletedLocally.runs.has(run.id)&&!deletedLocally.contents.has(run.contentId));
  if(live.current){setRuns(productions);setReady(true);setError('');updatePersistentValue<AgentSession[]>('sessions',[],current=>mergeProductionSessions(current,productions,latestAgents.current));}}catch(failure){if(live.current)setError(failure instanceof Error?failure.message:String(failure));}finally{inFlight.current=false;}}
 useEffect(()=>{live.current=true;void refresh();const timer=setInterval(()=>void refresh(),1000);
  const deleted=()=>{generation.current++;inFlight.current=false;setRuns(current=>current.filter(run=>!deletedLocally.runs.has(run.id)&&!deletedLocally.contents.has(run.contentId)));void refresh();};
  window.addEventListener(contentDeletedEvent,deleted);return()=>{live.current=false;clearInterval(timer);window.removeEventListener(contentDeletedEvent,deleted);}},[]);
 async function submit(path:string,input:Record<string,unknown>){await saveNow();const fingerprint=JSON.stringify({path,input}),requestId=requests.current.get(fingerprint)??crypto.randomUUID();requests.current.set(fingerprint,requestId);const result=await request(path,{...input,requestId});requests.current.delete(fingerprint);await refresh();return result.production as ProductionRun;}
 async function start(input:Record<string,unknown>){const run=await submit('',input);updatePersistentValue<Record<string,string>>('active-sessions',{},current=>({...current,[run.sourceSession.agentId]:run.sourceSession.id,[run.editorSession.agentId]:run.editorSession.id,...(run.publisherSession?{[run.publisherSession.agentId]:run.publisherSession.id}:{})}));
  // The source chat becomes the shown chat of ITS content scope; editor/publisher chats never replace a shown chat, and the
  // selected scope (what the user is looking at) never changes.
  updatePersistentValue<ContentScopeState>(contentScopesKey,normalizeContentScopes(undefined),current=>withActive(normalizeContentScopes(current),run.workspaceId,run.sourceSession.agentId,contentScopeKey(run.contentId),run.sourceSession.id));
  updatePersistentValue<ProductionFlows>('production-flows',flows,current=>({...current,activeByWorkspace:{...current.activeByWorkspace,[run.workspaceId]:run.flowId},flows:current.flows.map(flow=>flow.id===run.flowId?{...flow,contentId:run.contentId,nodes:flow.nodes.map(node=>({...node,sessionId:node.kind==='content-agent'?run.sourceSession.id:node.kind==='video-agent'?run.editorSession.id:node.kind==='publishing-agent'?(run.publisherSession??run.sourceSession).id:node.sessionId}))}:flow)}));return run;}
 /** Read-only server check; never creates a run. */
 async function preflight(input:Record<string,unknown>){await saveNow();const result=await request('/preflight',input);if(!result.preflight)throw Error('O serviço não confirmou a verificação.');return result.preflight as PreflightReport;}
 async function directorRequest(workspaceId:string,director?:EditDirector){const response=await fetch(`/api/content/productions/edit-director?profile=${encodeURIComponent(profile())}&workspace=${encodeURIComponent(workspaceId)}`,{cache:'no-store',...(director?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({workspaceId,director})}:{})});const result=await response.json();if(!response.ok)throw Error(result.error??'Preferência de edição indisponível.');return result.director as EditDirector;}
 return <Context.Provider value={{runs,ready,error,flows,refresh,start,preflight,editDirector:workspaceId=>directorRequest(workspaceId),setEditDirector:(workspaceId,director)=>directorRequest(workspaceId,director),command:(run,action,data={})=>submit(`/${encodeURIComponent(run.id)}`,{revision:run.revision,action,...data})}}>{children}</Context.Provider>;
}
export function useProduction(){const context=useContext(Context);if(!context)throw Error('ProductionProvider unavailable');return context;}
