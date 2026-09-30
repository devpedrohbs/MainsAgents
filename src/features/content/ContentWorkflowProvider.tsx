import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { useAgents } from '../agents/AgentsProvider';
import { useChat } from '../chat/ChatProvider';
import { useLanguage } from '../../app/LanguageProvider';
import type { ProviderId } from '../chat/AiProvider';
import { emptyEditorialState, newEditorialId, researchPrompt, scriptPrompt, validateResearch, validateScriptOptions, type ApprovedScript, type ContentFormat, type EditorialArtifact, type EditorialContent, type EditorialState, type EditorialTopic, type Platform, type Priority, type ResearchProposal, type WorkflowRun } from './model';

type TopicInput = {workspaceId:string;inputKind:'text'|'url'|'ideas';input:string;category:string;priority:Priority};
interface ContentContextValue {
  state:EditorialState; ready:boolean; storageError:string;
  createTopic:(input:TopicInput)=>Promise<EditorialTopic>;
  runResearch:(topicId:string,agentId:string)=>Promise<void>;
  reviseTopic:(topicId:string,changes:Pick<ResearchProposal,'title'|'summary'|'whyItMatters'|'angles'>)=>Promise<void>;
  decideTopic:(topicId:string,decision:'approved'|'rejected',notes:string,format?:ContentFormat,platforms?:Platform[],plannedAt?:string)=>Promise<EditorialContent|undefined>;
  runScript:(contentId:string,agentId:string)=>Promise<void>;
  approveScript:(contentId:string,script:ApprovedScript,notes:string)=>Promise<void>;
}
const Context=createContext<ContentContextValue|null>(null);
const profile=()=>{try{return localStorage.getItem('mainsagents-profile')||'default'}catch{return 'default'}};
const url=()=>`/api/content/state?profile=${encodeURIComponent(profile())}`;
const now=()=>new Date().toISOString();

export function ContentWorkflowProvider({children}:PropsWithChildren){
  const {getAgentById}=useAgents();
  const {createSession,runWorkflowMessage,getProviderStatus}=useChat();
  const {locale}=useLanguage();
  const [state,setState]=useState<EditorialState>(emptyEditorialState);
  const [ready,setReady]=useState(false);
  const [storageError,setStorageError]=useState('');
  const stateRef=useRef(state);
  const revisionRef=useRef(0);
  const writeQueue=useRef<Promise<void>>(Promise.resolve());

  useEffect(()=>{
    let active=true;
    void (async()=>{
      try{
        const response=await fetch(url(),{cache:'no-store'});
        const payload=await response.json();
        if(!response.ok)throw new Error(payload.error??'Could not load editorial data.');
        if(!active)return;
        const loaded=payload.state as EditorialState;
        const interrupted=loaded.runs.some((run)=>run.state==='running');
        const restored:EditorialState=interrupted?{
          ...loaded,
          runs:loaded.runs.map((run)=>run.state==='running'?{...run,state:'interrupted',error:'The app closed before this step finished. Retry it safely.',finishedAt:now()} as WorkflowRun:run),
          topics:loaded.topics.map((topic)=>topic.status==='researching'?{...topic,status:'error',lastError:'Research was interrupted. Retry this topic.'} as EditorialTopic:topic),
          contents:loaded.contents.map((content)=>content.status==='generating'?{...content,status:'error',lastError:'Script generation was interrupted. Retry this card.'} as EditorialContent:content),
        }:loaded;
        stateRef.current=restored;setState(restored);revisionRef.current=payload.revision;
        if(interrupted){
          const saved=await fetch(url(),{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({revision:revisionRef.current,state:restored})});
          const savedPayload=await saved.json();
          if(!saved.ok)throw new Error(savedPayload.error??'Could not preserve interrupted runs.');
          revisionRef.current=savedPayload.revision;
        }
        setReady(true);
      }catch(error){if(active)setStorageError(error instanceof Error?error.message:String(error))}
    })();
    return()=>{active=false};
  },[]);

  const commit=useCallback((change:(current:EditorialState)=>EditorialState):Promise<void>=>{
    if(!ready)return Promise.reject(new Error(storageError||'Editorial storage is still loading.'));
    const next=change(stateRef.current);
    stateRef.current=next;setState(next);
    const queued=writeQueue.current.catch(()=>{}).then(async()=>{
      const response=await fetch(url(),{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({revision:revisionRef.current,state:next})});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(payload.error??'Could not save editorial data.');
      revisionRef.current=payload.revision;
      setStorageError('');
    });
    writeQueue.current=queued.catch((error)=>{setStorageError(error instanceof Error?error.message:String(error))});
    return queued;
  },[ready,storageError]);

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

  const runResearch=useCallback(async(topicId:string,agentId:string)=>{
    const topic=stateRef.current.topics.find((item)=>item.id===topicId);
    const agent=getAgentById(agentId);
    if(!topic||!agent)throw new Error('Choose a topic and research agent.');
    if(agent.workspaceId!==topic.workspaceId)throw new Error('The research agent must belong to this workspace.');
    if(!agent.tools.includes('web-search'))throw new Error('Select an agent with Web Search enabled.');
    const providerId=(agent.providerId??'codex') as ProviderId;
    const capability=await getProviderStatus(providerId);
    if(capability.state!=='connected')throw new Error(`Connect ${providerId} in Settings before researching.`);
    if(!capability.capabilities.webSearch)throw new Error(`${providerId} cannot search the web in MainsAgents. Choose a Codex or Claude research agent.`);
    const session=createSession(agent.id,`Pesquisa · ${topic.title}`,providerId,agent.modelId);
    const run:WorkflowRun={id:newEditorialId('run'),workspaceId:topic.workspaceId,topicId,stage:'research',agentId,providerId,modelId:session.modelId,sessionId:session.id,input:topic.input,outputArtifactIds:[],state:'running',startedAt:now()};
    await commit((current)=>({...current,runs:[run,...current.runs],topics:current.topics.map((item)=>item.id===topicId?{...item,status:'researching',lastError:undefined,updatedAt:now()}:item)}));
    try{
      const answer=await runWorkflowMessage(agent,researchPrompt(topic,locale),session.title,session.id);
      const proposals=validateResearch(answer.content,topic.inputKind==='ideas'?3:1);
      const stamp=now();
      await commit((current)=>{
        const artifacts:EditorialArtifact[]=[];
        const proposedTopics:EditorialTopic[]=proposals.map((proposal,index)=>{
          const id=index===0?topic.id:`${topic.id}-proposal-${index+1}`;
          const prior=current.topics.find((item)=>item.id===id);
          const version=current.artifacts.filter((artifact)=>artifact.topicId===id&&artifact.type==='research').length+1;
          const artifact:EditorialArtifact={id:newEditorialId('artifact'),workspaceId:topic.workspaceId,topicId:id,runId:run.id,type:'research',version,data:proposal,createdAt:stamp};
          artifacts.push(artifact);
          return {...topic,...proposal,id,requestId:topic.requestId,originUrl:topic.originUrl,status:'review',researchArtifactId:artifact.id,contentId:prior?.contentId,createdAt:prior?.createdAt??topic.createdAt,updatedAt:stamp,lastError:undefined};
        });
        const replacementIds=new Set(proposedTopics.map((item)=>item.id));
        return {...current,topics:[...proposedTopics,...current.topics.filter((item)=>!replacementIds.has(item.id))],artifacts:[...artifacts,...current.artifacts],runs:current.runs.map((item)=>item.id===run.id?{...item,state:'completed',outputArtifactIds:artifacts.map((artifact)=>artifact.id),finishedAt:stamp}:item)};
      });
    }catch(error){
      const message=error instanceof Error?error.message:String(error);
      await commit((current)=>({...current,runs:current.runs.map((item)=>item.id===run.id?{...item,state:'failed',error:message,finishedAt:now()}:item),topics:current.topics.map((item)=>item.id===topicId?{...item,status:'error',lastError:message,updatedAt:now()}:item)}));
      throw error;
    }
  },[commit,createSession,getAgentById,getProviderStatus,locale,runWorkflowMessage]);

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

  const runScript=useCallback(async(contentId:string,agentId:string)=>{
    const content=stateRef.current.contents.find((item)=>item.id===contentId);
    const topic=content&&stateRef.current.topics.find((item)=>item.id===content.topicId);
    const agent=getAgentById(agentId);
    if(!content||!topic||!agent)throw new Error('Choose a content card and script agent.');
    if(agent.workspaceId!==content.workspaceId)throw new Error('The script agent must belong to this workspace.');
    const providerId=(agent.providerId??'codex') as ProviderId;
    const capability=await getProviderStatus(providerId);
    if(capability.state!=='connected')throw new Error(`Connect ${providerId} in Settings before writing.`);
    const session=createSession(agent.id,`Roteiro · ${content.title}`,providerId,agent.modelId);
    const run:WorkflowRun={id:newEditorialId('run'),workspaceId:content.workspaceId,topicId:topic.id,contentId,stage:'script',agentId,providerId,modelId:session.modelId,sessionId:session.id,input:topic.title,outputArtifactIds:[],state:'running',startedAt:now()};
    await commit((current)=>({...current,runs:[run,...current.runs],contents:current.contents.map((item)=>item.id===contentId?{...item,status:'generating',lastError:undefined,updatedAt:now()}:item)}));
    try{
      const answer=await runWorkflowMessage(agent,scriptPrompt(topic,content,locale),session.title,session.id);
      const options=validateScriptOptions(answer.content);
      const artifact:EditorialArtifact={id:newEditorialId('artifact'),workspaceId:content.workspaceId,topicId:topic.id,contentId,runId:run.id,type:'script-options',version:stateRef.current.artifacts.filter((item)=>item.contentId===contentId&&item.type==='script-options').length+1,data:options,createdAt:now()};
      await commit((current)=>({...current,artifacts:[artifact,...current.artifacts],runs:current.runs.map((item)=>item.id===run.id?{...item,state:'completed',outputArtifactIds:[artifact.id],finishedAt:now()}:item),contents:current.contents.map((item)=>item.id===contentId?{...item,status:'script-review',scriptOptionsArtifactId:artifact.id,updatedAt:now()}:item)}));
    }catch(error){
      const message=error instanceof Error?error.message:String(error);
      await commit((current)=>({...current,runs:current.runs.map((item)=>item.id===run.id?{...item,state:'failed',error:message,finishedAt:now()}:item),contents:current.contents.map((item)=>item.id===contentId?{...item,status:'error',lastError:message,updatedAt:now()}:item)}));
      throw error;
    }
  },[commit,createSession,getAgentById,getProviderStatus,locale,runWorkflowMessage]);

  const approveScript=useCallback(async(contentId:string,script:ApprovedScript,notes:string)=>{
    const content=stateRef.current.contents.find((item)=>item.id===contentId);
    if(!content?.scriptOptionsArtifactId)throw new Error('Generate script options first.');
    if(!script.hook.trim()||!script.cta.trim()||!script.path.title.trim()||script.text.trim().length<80)throw new Error('Choose a hook, CTA, path and complete the script before approving.');
    const artifact:EditorialArtifact={id:newEditorialId('artifact'),workspaceId:content.workspaceId,topicId:content.topicId,contentId,type:'script',version:stateRef.current.artifacts.filter((item)=>item.contentId===contentId&&item.type==='script').length+1,data:{...script,hook:script.hook.trim(),cta:script.cta.trim(),text:script.text.trim()},createdAt:now()};
    await commit((current)=>({...current,artifacts:[artifact,...current.artifacts],approvals:[{id:newEditorialId('approval'),workspaceId:content.workspaceId,topicId:content.topicId,contentId,artifactId:artifact.id,artifactVersion:artifact.version,decision:'approved',notes:notes.trim(),decidedAt:now()},...current.approvals],contents:current.contents.map((item)=>item.id===contentId?{...item,status:'script-approved',approvedScriptArtifactId:artifact.id,updatedAt:now()}:item)}));
  },[commit]);

  return <Context.Provider value={{state,ready,storageError,createTopic,runResearch,reviseTopic,decideTopic,runScript,approveScript}}>{children}</Context.Provider>;
}
export function useContentWorkflow(){const context=useContext(Context);if(!context)throw new Error('useContentWorkflow requires ContentWorkflowProvider');return context}
