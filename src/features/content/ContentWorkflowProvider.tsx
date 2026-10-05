import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { useAgents } from '../agents/AgentsProvider';
import { useChat } from '../chat/ChatProvider';
import { useLanguage } from '../../app/LanguageProvider';
import type { ProviderId } from '../chat/AiProvider';
import { EditorialStateClient } from './EditorialStateClient';
import { saveCoordinator } from '../../data/SaveCoordinator';
import {storageProfile} from '../../data/IndexedDbStateStore';
import {updatePersistentValue} from '../../data/localPersistence';
import type {AgentSession} from '../chat/model/Chat';
import {attachAssetFiles,reviseAssetFile,verifyAssetFiles,changeAssetMetadata,removeAsset,type AssetRole,type LocalAssetInspection} from './assetModel';
import { emptyEditorialState, newEditorialId, type ApprovedScript, type ContentFormat, type EditorialArtifact, type EditorialContent, type EditorialState, type EditorialTopic, type Platform, type Priority, type ResearchProposal, type WorkflowRun, type WorkflowJob, type EditorialJob, type NotionConnection, type ProductionStage } from './model';
import type {MediaJob,VideoMetadata} from './model';
import type {CalendarAccount,CalendarProvider,CalendarSource} from './publicationCalendar';

type TopicInput = {workspaceId:string;inputKind:'text'|'url'|'ideas';input:string;category:string;priority:Priority};
interface ContentContextValue {
  state:EditorialState; ready:boolean; storageError:string;
  jobs:EditorialJob[]; jobsError:string;
  workJobs:WorkflowJob[];workError:string;
  transferWork:(contentId:string,sourceAgentId:string,targetAgentId:string,instructions:string,assetIds:string[],newSession:boolean,expectedArtifactId?:string)=>Promise<void>;
  retryWork:(id:string,resend?:boolean)=>Promise<void>;
  cancelWork:(id:string)=>Promise<void>;
  workDetail:(id:string)=>Promise<WorkflowJob>;
  getNotionConnection:(workspaceId:string)=>Promise<NotionConnection & {suggestedDataSourceId?:string}>;
  configureNotion:(workspaceId:string,config:NotionConnection)=>Promise<void>;
  retryJob:(id:string)=>Promise<void>;
  setProductionStage:(contentId:string,stage:ProductionStage)=>Promise<void>;
  attachFiles:(contentId:string,files:LocalAssetInspection[],role:AssetRole)=>Promise<void>;
  reviseFile:(assetId:string,versionId:string,file:LocalAssetInspection,relink:boolean)=>Promise<void>;
  verifyFiles:(checks:Array<{id:string;versionId:string;inspection:LocalAssetInspection}>)=>Promise<void>;
  changeFile:(assetId:string,role:AssetRole,sourceAssetId?:string)=>Promise<void>;
  removeFile:(assetId:string)=>Promise<void>;
  createTopic:(input:TopicInput)=>Promise<EditorialTopic>;
  runResearch:(topicId:string,agentId:string)=>Promise<void>;
  reviseTopic:(topicId:string,changes:Pick<ResearchProposal,'title'|'summary'|'whyItMatters'|'angles'>)=>Promise<void>;
  decideTopic:(topicId:string,decision:'approved'|'rejected',notes:string,format?:ContentFormat,platforms?:Platform[],plannedAt?:string)=>Promise<EditorialContent|undefined>;
  runScript:(contentId:string,agentId:string)=>Promise<void>;
  approveScript:(contentId:string,script:ApprovedScript,notes:string,syncNotion?:boolean,review?:{artifact:EditorialArtifact;destination?:string})=>Promise<void>;
  captureChatDelivery:(sessionId:string,messageId:string,expectedContent:string,contentId?:string)=>Promise<void>;
  reviewScript:(artifact:EditorialArtifact,decision:'rejected'|'revision-requested',notes:string)=>Promise<void>;
  reviewFiles:(artifact:EditorialArtifact,decision:'approved'|'rejected'|'revision-requested',notes:string)=>Promise<void>;
  publicationCommand:(input:Record<string,unknown>)=>Promise<void>;
  publicationAccounts:()=>Promise<{accounts:Array<{id:string;name:string}>}>;
  preparePublicationChange:(input:Record<string,unknown>)=>Promise<{preview:{id:string;externalId:string;accountId:string;mode:'draft'|'schedule';text:string;timeZone:string;plannedAt?:string;expiresAt:string}}>;
  publicationTransport:(action:'prepare'|'execute'|'reconcile'|'cancel'|'change',input:Record<string,unknown>)=>Promise<void>;
  configureCalendarRefresh:(workspaceId:string,provider:CalendarProvider,enabled:boolean,intervalMinutes:number)=>Promise<CalendarSource>;
  publicationCalendar:(workspaceId:string)=>Promise<{sources:CalendarSource[]}>;
  calendarAccounts:(workspaceId:string,provider:CalendarProvider)=>Promise<{accounts:CalendarAccount[]}>;
  syncCalendar:(workspaceId:string,provider:CalendarProvider,accountIds:string[])=>Promise<CalendarSource>;
  mediaJobs:MediaJob[];
  mediaCapabilities:()=>Promise<{available:boolean;ffmpeg:boolean;ffprobe:boolean;error:string}>;
  inspectVideo:(contentId:string,assetId:string)=>Promise<{metadata:VideoMetadata;versionId:string;sha256:string}>;
  exportVideo:(input:Record<string,unknown>)=>Promise<void>;
  mediaAction:(id:string,action:'retry'|'cancel')=>Promise<void>;
}
const Context=createContext<ContentContextValue|null>(null);
const profile=()=>{if(window.mainsAgentsDesktop?.state)return storageProfile();try{return localStorage.getItem('mainsagents-profile')||'default'}catch{return 'default'}};
const url=()=>`/api/content/state?profile=${encodeURIComponent(profile())}`;
const now=()=>new Date().toISOString();

export function ContentWorkflowProvider({children}:PropsWithChildren){
  const {getAgentById}=useAgents();
  const {getProviderStatus}=useChat();
  const {locale}=useLanguage();
  const [state,setState]=useState<EditorialState>(emptyEditorialState);
  const [ready,setReady]=useState(false);
  const [storageError,setStorageError]=useState('');
  const stateRef=useRef(state);
  const [storage]=useState(()=>new EditorialStateClient(url()));
  const [jobs,setJobs]=useState<EditorialJob[]>([]);
  const [jobsError,setJobsError]=useState('');
  const [workJobs,setWorkJobs]=useState<WorkflowJob[]>([]),[workError,setWorkError]=useState('');
  const [mediaJobs,setMediaJobs]=useState<MediaJob[]>([]);
  const requestKeys=useRef(new Map<string,string>());
  const request=useCallback(async(path:string,init?:RequestInit)=>{
    const response=await fetch(`/api/content/${path}${path.includes('?')?'&':'?'}profile=${encodeURIComponent(profile())}`,init);
    const payload=await response.json();if(!response.ok)throw new Error(payload.error??'Editorial operation failed.');return payload;
  },[]);
  const refreshJobs=useCallback(async()=>{try{const payload=await request('jobs');if(!Array.isArray(payload.jobs))throw new Error('Could not read the Notion delivery queue.');setJobs(payload.jobs);setJobsError('')}catch(error){setJobsError(error instanceof Error?error.message:String(error));throw error}},[request]);
  const getNotionConnection=useCallback((workspaceId:string)=>request(`connection?workspace=${encodeURIComponent(workspaceId)}`),[request]);
  const configureNotion=useCallback(async(workspaceId:string,config:NotionConnection)=>{await request(`connection?workspace=${encodeURIComponent(workspaceId)}`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(config)})},[request]);
  const retryJob=useCallback(async(id:string)=>{await request(`jobs/${encodeURIComponent(id)}/retry`,{method:'POST'});await refreshJobs()},[request,refreshJobs]);
  useEffect(()=>{let active=true;const refresh=()=>{if(active)void refreshJobs().catch(()=>{})};refresh();const timer=setInterval(refresh,2000);return()=>{active=false;clearInterval(timer)}},[refreshJobs]);

  useEffect(()=>{
    let active=true;
    const unregister=saveCoordinator.register('editorial',storage);
    const unsubscribe=storage.subscribe(()=>{
      saveCoordinator.changed();
      if(active){stateRef.current=storage.state;setState(storage.state);setStorageError(storage.lastError);setReady(storage.ready);}
    });
    void (async()=>{
      try{
        await storage.load();
        if(!active)return;
        const loaded=storage.state;
        const interrupted=loaded.runs.some((run)=>run.state==='running'&&!run.jobId);
        const restored:EditorialState=interrupted?{
          ...loaded,
          runs:loaded.runs.map((run)=>run.state==='running'&&!run.jobId?{...run,state:'interrupted',error:'The app closed before this step finished. Retry it safely.',finishedAt:now()} as WorkflowRun:run),
          topics:loaded.topics.map((topic)=>topic.status==='researching'&&loaded.runs.some(run=>run.topicId===topic.id&&run.state==='running'&&!run.jobId)?{...topic,status:'error',lastError:'Research was interrupted. Retry this topic.'} as EditorialTopic:topic),
          contents:loaded.contents.map((content)=>content.status==='generating'&&loaded.runs.some(run=>run.contentId===content.id&&run.state==='running'&&!run.jobId)?{...content,status:'error',lastError:'Script generation was interrupted. Retry this card.'} as EditorialContent:content),
        }:loaded;
        stateRef.current=restored;setState(restored);
        if(interrupted){
          await storage.update(()=>restored);
        }
        setReady(true);
      }catch(error){if(active)setStorageError(error instanceof Error?error.message:String(error))}
    })();
    return()=>{active=false;unsubscribe();unregister()};
  },[storage]);


  useEffect(()=>{
    let active=true,inFlight=false;
    const refresh=async()=>{if(!active||inFlight)return;inFlight=true;try{const payload=await request('work');if(!Array.isArray(payload.jobs))throw new Error('Invalid persistent work snapshot.');await storage.refresh();if(active){setWorkJobs(payload.jobs);setMediaJobs(payload.mediaJobs??[]);setWorkError(payload.worker?.error||(payload.worker?.runtimeAvailable===false&&payload.jobs.some((job:WorkflowJob)=>job.status==='queued')?'Codex CLI indisponível. Reconecte em Configurações para continuar a fila.':''));}}catch(error){if(active)setWorkError(error instanceof Error?error.message:String(error))}finally{inFlight=false;}};
    void refresh();const timer=setInterval(()=>void refresh(),1000);return()=>{active=false;clearInterval(timer)};
  },[request,storage]);
  const retryWork=useCallback(async(id:string,resend=false)=>{await storage.command('/api/content/work/'+encodeURIComponent(id)+'/retry?profile='+encodeURIComponent(profile()),{resend})},[storage]);
  const cancelWork=useCallback(async(id:string)=>{await storage.command('/api/content/work/'+encodeURIComponent(id)+'/cancel?profile='+encodeURIComponent(profile()),{})},[storage]);
  const workDetail=useCallback((id:string)=>request('work/'+encodeURIComponent(id)),[request]);
  const commit=useCallback((change:(current:EditorialState)=>EditorialState):Promise<void>=>{
    if(!ready)return Promise.reject(new Error(storageError||'Editorial storage is still loading.'));
    return storage.update(change);
  },[ready,storageError,storage]);

  const createTopic=useCallback(async(input:TopicInput)=>{
    const clean=input.input.trim();
    if(input.inputKind!=='ideas'&&!clean)throw new Error('Add a link or idea before creating a topic.');
    let originUrl:string|undefined;
    if(input.inputKind==='url'){
      try{const parsed=new URL(clean);if(!['http:','https:'].includes(parsed.protocol))throw new Error();originUrl=parsed.toString()}catch{throw new Error('Enter a valid http or https URL.')}
    }
    const stamp=now();
    const topic:EditorialTopic={id:newEditorialId('topic'),workspaceId:input.workspaceId,requestId:'',inputKind:input.inputKind,input:clean||'Propose current content ideas about AI, automation and technology',originUrl,category:input.category.trim()||'Tecnologia',priority:input.priority,status:'draft',title:clean.slice(0,90)||'Novas ideias',summary:'Aguardando pesquisa',whyItMatters:'Aguardando pesquisa',angles:[],sources:originUrl?[{title:'Link enviado',url:originUrl}]:[],factualQuestions:[],createdAt:stamp,updatedAt:stamp};
    topic.requestId=topic.id;
    await commit((current)=>({...current,topics:[topic,...current.topics]}));
    return topic;
  },[commit]);


  const enqueueWork=useCallback(async(kind:'research'|'script'|'handoff',targetId:string,agentId:string,extra:Record<string,unknown>={})=>{
    const key=JSON.stringify([kind,targetId,agentId,extra]);const requestKey=requestKeys.current.get(key)??crypto.randomUUID();requestKeys.current.set(key,requestKey);
    const agent=getAgentById(agentId),source=typeof extra.sourceAgentId==='string'?getAgentById(extra.sourceAgentId):undefined;
    if(!agent)throw new Error('Choose an existing agent.');
    if((agent.providerId??'codex')!=='codex')throw new Error(locale==='pt-BR'?'Este fluxo persistente requer um agente Codex. Os chats dos outros provedores continuam disponíveis.':'Persistent work requires a Codex agent. Other provider chats remain available.');
    const capability=await getProviderStatus('codex');if(capability.state!=='connected')throw new Error(locale==='pt-BR'?'Conecte o Codex em Configurações antes de iniciar.':'Connect Codex in Settings before starting.');
    const expectedArtifactId=kind==='handoff'?(extra.expectedArtifactId??stateRef.current.contents.find(content=>content.id===targetId)?.approvedScriptArtifactId):undefined;
    await storage.command('/api/content/work?profile='+encodeURIComponent(profile()),{kind,targetId,agentId,requestKey,language:locale,agents:source?[source,agent]:[agent],...extra,expectedArtifactId});
    requestKeys.current.delete(key);
  },[storage,getAgentById,getProviderStatus,locale]);
  const runResearch=useCallback((topicId:string,agentId:string)=>enqueueWork('research',topicId,agentId),[enqueueWork]);
  const reviseTopic=useCallback(async(topicId:string,changes:Pick<ResearchProposal,'title'|'summary'|'whyItMatters'|'angles'>)=>{
    const topic=stateRef.current.topics.find((item)=>item.id===topicId);
    if(!topic||!topic.researchArtifactId||topic.status!=='review')throw new Error('Research must be ready before editing.');
    const proposal:ResearchProposal={title:changes.title.trim(),category:topic.category,summary:changes.summary.trim(),whyItMatters:changes.whyItMatters.trim(),angles:changes.angles.map((item)=>item.trim()).filter(Boolean),sources:topic.sources,factualQuestions:topic.factualQuestions};
    if(!proposal.title||!proposal.summary||!proposal.whyItMatters||proposal.angles.length===0)throw new Error('Fill in the title, summary, reason and at least one angle.');
    const artifact:EditorialArtifact={id:newEditorialId('artifact'),workspaceId:topic.workspaceId,topicId,type:'research',version:stateRef.current.artifacts.filter((item)=>item.topicId===topicId&&item.type==='research').length+1,data:proposal,createdAt:now()};
    await commit((current)=>({...current,artifacts:[artifact,...current.artifacts],topics:current.topics.map((item)=>item.id===topicId?{...item,...proposal,researchArtifactId:artifact.id,updatedAt:now()}:item)}));
  },[commit]);

  const decideTopic=useCallback(async(topicId:string,decision:'approved'|'rejected',notes:string,format:ContentFormat='short-video',platforms:Platform[]=['Instagram','TikTok'],plannedAt='')=>{
    const topic=stateRef.current.topics.find((item)=>item.id===topicId);
    if(!topic||topic.status!=='review'||!topic.researchArtifactId)throw new Error('Research this topic before deciding.');
    const artifact=stateRef.current.artifacts.find((item)=>item.id===topic.researchArtifactId);
    if(!artifact)throw new Error('Research version could not be found.');
    if(decision==='approved'&&!platforms.length)throw new Error('Select at least one platform.');
    if(plannedAt&&!/^\d{4}-\d{2}-\d{2}$/.test(plannedAt))throw new Error('Choose a valid planned date.');
    const content:EditorialContent|undefined=decision==='approved'?{id:newEditorialId('content'),workspaceId:topic.workspaceId,topicId,title:topic.title,format,platforms,plannedAt:plannedAt||undefined,status:'planning',taskId:newEditorialId('task'),createdAt:now(),updatedAt:now()}:undefined;
    await commit((current)=>({...current,approvals:[{id:newEditorialId('approval'),workspaceId:topic.workspaceId,topicId,contentId:content?.id,artifactId:artifact.id,artifactVersion:artifact.version,decision,notes:notes.trim(),decidedAt:now()},...current.approvals],contents:content?[content,...current.contents]:current.contents,topics:current.topics.map((item)=>item.id===topicId?{...item,status:decision==='approved'?'approved':'rejected',contentId:content?.id,updatedAt:now()}:item)}));
    return content;
  },[commit]);

  const runScript=useCallback((contentId:string,agentId:string)=>enqueueWork('script',contentId,agentId),[enqueueWork]);
  const reviewScript=useCallback((artifact:EditorialArtifact,decision:'rejected'|'revision-requested',notes:string)=>storage.command(`/api/content/review?profile=${encodeURIComponent(profile())}`,{artifactId:artifact.id,expectedArtifact:artifact,decision,notes}),[storage]);
  const reviewFiles=useCallback((artifact:EditorialArtifact,decision:'approved'|'rejected'|'revision-requested',notes:string)=>storage.command(`/api/content/file-review?profile=${encodeURIComponent(profile())}`,{artifactId:artifact.id,expectedArtifact:artifact,decision,notes}),[storage]);
  const publicationCommand=useCallback((input:Record<string,unknown>)=>storage.command(`/api/content/publications?profile=${encodeURIComponent(profile())}`,input),[storage]);
  const preparePublicationChange=useCallback(async(input:Record<string,unknown>)=>{
    const owner=profile();await storage.flush();await storage.refresh();
    if(owner!==profile())throw new Error('The active profile changed.');
    return request('publishing/prepareChange',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...input,revision:storage.revision})});
  },[request,storage]);
  const publicationAccounts=useCallback(()=>request('publishing/accounts',{method:'POST'}),[request]);
  const configureCalendarRefresh=useCallback((workspaceId:string,provider:CalendarProvider,enabled:boolean,intervalMinutes:number)=>request('calendar/refresh',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({workspaceId,provider,enabled,intervalMinutes})}),[request]);
  const publicationCalendar=useCallback((workspaceId:string)=>request(`calendar?workspace=${encodeURIComponent(workspaceId)}`),[request]);
  const calendarAccounts=useCallback((workspaceId:string,provider:CalendarProvider)=>request('calendar/accounts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({workspaceId,provider})}),[request]);
  const syncCalendar=useCallback((workspaceId:string,provider:CalendarProvider,accountIds:string[])=>request('calendar/sync',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({workspaceId,provider,accountIds})}),[request]);
  const publicationTransport=useCallback((action:'prepare'|'execute'|'reconcile'|'cancel'|'change',input:Record<string,unknown>)=>storage.command(`/api/content/publishing/${action}?profile=${encodeURIComponent(profile())}`,input).then(()=>{window.dispatchEvent(new Event('mainsagents:provider-calendar-changed'))}),[storage]);
  const mediaCapabilities=useCallback(()=>request('media/capabilities'),[request]);
  const inspectVideo=useCallback((contentId:string,assetId:string)=>request('media/inspect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({contentId,assetId})}),[request]);
  const exportVideo=useCallback((input:Record<string,unknown>)=>storage.command(`/api/content/media?profile=${encodeURIComponent(profile())}`,input),[storage]);
  const mediaAction=useCallback((id:string,action:'retry'|'cancel')=>storage.command(`/api/content/media/${encodeURIComponent(id)}/${action}?profile=${encodeURIComponent(profile())}`,{}),[storage]);

  const captureChatDelivery=useCallback(async(sessionId:string,messageId:string,expectedContent:string,contentId?:string)=>{
    await saveCoordinator.flush();
    await storage.command(`/api/content/chat-deliveries?profile=${encodeURIComponent(profile())}`,{sessionId,messageId,expectedContent,contentId});
    const artifacts=storage.state.artifacts.filter(item=>item.source?.sessionId===sessionId&&item.source?.messageId===messageId);
    if(artifacts.length===1){const artifact=artifacts[0];updatePersistentValue<AgentSession[]>('sessions',[],sessions=>sessions.map(session=>session.id===sessionId?{...session,contentId:artifact.contentId,topicId:artifact.topicId}:session));}
  },[storage]);
  const approveScript=useCallback(async(contentId:string,script:ApprovedScript,notes:string,syncNotion=false,review?:{artifact:EditorialArtifact;destination?:string})=>{
    const content=stateRef.current.contents.find((item)=>item.id===contentId);
    if(!content?.scriptOptionsArtifactId)throw new Error('Generate script options first.');
    if(!script.hook.trim()||!script.cta.trim()||!script.path.title.trim()||script.text.trim().length<80)throw new Error('Choose a hook, CTA, path and complete the script before approving.');
    const artifact=review?.artifact??stateRef.current.artifacts.find(item=>item.id===content.scriptOptionsArtifactId);
    if(!artifact)throw new Error('The reviewed script version is unavailable.');
    await storage.command(`/api/content/approve?profile=${encodeURIComponent(profile())}`,{contentId,scriptOptionsArtifactId:artifact.id,expectedArtifact:{id:artifact.id,version:artifact.version,data:artifact.data},expectedDestination:review?.destination,script:{...script,hook:script.hook.trim(),cta:script.cta.trim(),text:script.text.trim()},notes:notes.trim(),syncNotion});
    await refreshJobs();
  },[storage,refreshJobs]);

  const setProductionStage=useCallback(async(contentId:string,stage:ProductionStage)=>{
    if(!['planning','ready-to-record','recording','editing','video-review','ready','archived'].includes(stage))throw new Error('Invalid production stage.');
    await commit(current=>({...current,contents:current.contents.map(item=>item.id===contentId?{...item,productionStage:stage,updatedAt:now()}:item)}));
  },[commit]);
  const attachFiles=useCallback((contentId:string,files:LocalAssetInspection[],role:AssetRole)=>commit(current=>attachAssetFiles(current,contentId,files,role)),[commit]);
  const reviseFile=useCallback((assetId:string,versionId:string,file:LocalAssetInspection,relink:boolean)=>commit(current=>reviseAssetFile(current,assetId,versionId,file,relink)),[commit]);
  const verifyFiles=useCallback((checks:Array<{id:string;versionId:string;inspection:LocalAssetInspection}>)=>commit(current=>verifyAssetFiles(current,checks)),[commit]);
  const changeFile=useCallback((assetId:string,role:AssetRole,sourceAssetId?:string)=>commit(current=>changeAssetMetadata(current,assetId,role,sourceAssetId)),[commit]);
  const removeFile=useCallback((assetId:string)=>commit(current=>removeAsset(current,assetId)),[commit]);
  const transferWork=useCallback((contentId:string,sourceAgentId:string,targetAgentId:string,instructions:string,assetIds:string[],newSession:boolean,expectedArtifactId?:string)=>enqueueWork('handoff',contentId,targetAgentId,{sourceAgentId,instructions,assetIds,newSession,expectedArtifactId}),[enqueueWork]);
  return <Context.Provider value={{state,ready,storageError,jobs,jobsError,workJobs,workError,mediaJobs,mediaCapabilities,inspectVideo,exportVideo,mediaAction,transferWork,retryWork,cancelWork,workDetail,getNotionConnection,configureNotion,retryJob,setProductionStage,createTopic,runResearch,reviseTopic,decideTopic,runScript,approveScript,reviewScript,reviewFiles,publicationCommand,publicationAccounts,preparePublicationChange,publicationTransport,configureCalendarRefresh,publicationCalendar,calendarAccounts,syncCalendar,captureChatDelivery,attachFiles,reviseFile,verifyFiles,changeFile,removeFile}}>{children}</Context.Provider>;
}
export function useContentWorkflow(){const context=useContext(Context);if(!context)throw new Error('useContentWorkflow requires ContentWorkflowProvider');return context}
