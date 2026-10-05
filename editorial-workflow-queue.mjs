import {randomUUID} from 'node:crypto';
import {artifactHash} from './editorial-jobs.mjs';
import {researchPrompt,scriptPrompt,validateResearch,validateScriptOptions,parseProviderJson} from './editorial-protocol.mjs';
import {inspectLocalAsset} from './editorial-local-files.mjs';
const stamp=()=>new Date().toISOString();
const activeStatuses=['queued','running'];
const fail=message=>{throw new Error(message)};
const currentVersion=asset=>asset.versions.find(version=>version.id===asset.currentVersionId);
const marker=job=>`[MainsAgents work ${job.id} attempt ${job.attempt}]`;
const answer=turn=>(turn.items??[]).filter(item=>item.type==='agentMessage').at(-1)?.text??'';
export function matchingWorkflowTurn(job,thread){
  if(job.executionId)return thread.turns?.find(turn=>turn.id===job.executionId);
  const matches=(thread.turns??[]).filter(turn=>(turn.items??[]).some(item=>item.type==='userMessage'&&(item.content??[]).some(part=>part.type==='text'&&part.text?.startsWith(`${marker(job)}\n`))));
  if(matches.length>1)throw new Error('More than one matching turn exists. Review the saved session before retrying.');
  return matches[0];
}

/** Serial local worker with durable inputs, sessions, partial output and explicit recovery. */
export function createEditorialWorkflowQueue(db,{getRuntime=()=>null,getAgents,getCurrentProfile,inspect=inspectLocalAsset,timeoutMs=29*60*1000}={}){
  db.exec(`CREATE TABLE IF NOT EXISTS workflow_work(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,workspace_id TEXT NOT NULL,target_id TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,request_key TEXT NOT NULL,data_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(profile_id,request_key));
    CREATE TABLE IF NOT EXISTS workflow_sessions(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,scope TEXT NOT NULL,agent_id TEXT NOT NULL,thread_id TEXT NOT NULL,config_hash TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(profile_id,scope,agent_id,config_hash));
    CREATE TABLE IF NOT EXISTS workflow_events(id INTEGER PRIMARY KEY AUTOINCREMENT,job_id TEXT NOT NULL,event_json TEXT NOT NULL,at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workflow_worker_lease(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL,expires INTEGER NOT NULL);`);
  const owner=randomUUID();let closed=false,active,controller,activeId,lastWorkerError='';
  const locks=new Set();
  const read=(profile,id)=>{const row=db.prepare('SELECT data_json FROM workflow_work WHERE profile_id=? AND id=?').get(profile,id);return row?JSON.parse(row.data_json):null;};
  const readState=profile=>{const row=db.prepare('SELECT revision,state_json FROM editorial_state WHERE profile_id=?').get(profile);return row?{revision:row.revision,state:JSON.parse(row.state_json)}:null;};
  const record=(job,type,detail='')=>db.prepare('INSERT INTO workflow_events(job_id,event_json,at) VALUES (?,?,?)').run(job.id,JSON.stringify({type,detail:String(detail).slice(0,4000)}),stamp());
  const put=job=>{if(job.status!=='canceled'&&db.prepare('SELECT status FROM workflow_work WHERE id=?').get(job.id)?.status==='canceled')fail('Execution canceled.');job.updatedAt=stamp();db.prepare('UPDATE workflow_work SET status=?,data_json=?,updated_at=? WHERE id=? AND profile_id=?').run(job.status,JSON.stringify(job),job.updatedAt,job.id,job.profileId);};
  const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};
  const writeState=(profile,current)=>db.prepare('UPDATE editorial_state SET revision=?,state_json=?,updated_at=? WHERE profile_id=?').run(current.revision+1,JSON.stringify(current.state),stamp(),profile);
  const coreAgents=(profile,supplied)=>getAgents?getAgents(profile):supplied;
  const chooseAgent=(profile,id,workspaceId,supplied)=>{
    const agent=coreAgents(profile,supplied)?.find(item=>item.id===id&&item.workspaceId===workspaceId);
    if(!agent||typeof agent.instructions!=='string'||!Array.isArray(agent.tools))fail('Choose an existing agent in this workspace.');
    if((agent.providerId??'codex')!=='codex')fail('Persistent editorial work currently requires a Codex agent. Other provider chats remain available.');
    return structuredClone(Object.fromEntries(['id','name','role','instructions','workspaceId','tools','providerId','modelId','skillsDirectory','skills','skillFiles','disabledSkills'].filter(key=>agent[key]!==undefined).map(key=>[key,agent[key]])));
  };
  const inputFingerprint=(kind,topic,content,artifact)=>artifactHash(kind==='research'?{input:topic.input,inputKind:topic.inputKind,priority:topic.priority}:kind==='script'?{researchArtifactId:topic.researchArtifactId,title:topic.title,summary:topic.summary,whyItMatters:topic.whyItMatters,angles:topic.angles,sources:topic.sources,factualQuestions:topic.factualQuestions,format:content.format,platforms:content.platforms}:{artifactId:artifact?.id,data:artifact?.data});
  function authorize(job){
    if(closed)fail('The local executor is stopping.');
    if(db.prepare('SELECT status FROM workflow_work WHERE id=?').get(job.id)?.status==='canceled')fail('Execution canceled.');
    if(getCurrentProfile&&getCurrentProfile()!==job.profileId)fail('This work belongs to another active profile. Switch back before resuming.');
    const current=readState(job.profileId),state=current?.state,topic=state?.topics.find(item=>item.id===job.topicId),content=job.contentId&&state?.contents.find(item=>item.id===job.contentId),artifact=state?.artifacts.find(item=>item.id===content?.approvedScriptArtifactId);
    if(!topic||topic.workspaceId!==job.workspaceId||job.kind!=='research'&&(!content||content.workspaceId!==job.workspaceId))fail('The linked topic or content no longer exists.');
    if(inputFingerprint(job.kind,topic,content,artifact)!==job.inputHash)fail('The input or approved version changed. Start new work with the current version.');
    if(getAgents){const agent=chooseAgent(job.profileId,job.agent.id,job.workspaceId);if(artifactHash(agent)!==artifactHash(job.agent))fail('The agent configuration changed. Start new work to use its current instructions and skills.');}
    if(job.kind==='handoff'){
      if(content.status!=='script-approved')fail('Review and approve the current script before transferring work.');
      if(!state.approvals.some(item=>item.artifactId===artifact?.id&&item.artifactVersion===artifact.version&&item.decision==='approved'))fail('Approve the current script before sending work to a specialist.');
      if(getAgents){const source=coreAgents(job.profileId)?.find(item=>item.id===job.sourceAgent.id&&item.workspaceId===job.workspaceId);if(!source?.tools?.includes('subagents'))fail('Agent collaboration was disabled or the source agent was removed.');}
      for(const saved of job.files){const asset=state.assets?.find(item=>item.id===saved.assetId&&item.contentId===job.contentId&&item.workspaceId===job.workspaceId),version=asset&&currentVersion(asset);if(version?.id!==saved.versionId||version.sha256!==saved.sha256||version.path!==saved.path)fail('A linked file version changed. Prepare a new briefing.');}
    }
    return current;
  }
  async function checkFiles(job){
    if(job.files.length&&!job.agent.tools.includes('files'))fail('Enable Files for the receiving specialist before transferring local files.');
    for(const file of job.files){const actual=await inspect(file.path);if(actual.status!=='available')fail(actual.error);if(actual.sha256!==file.sha256)fail('A local file changed. Save its new version before transferring work.');}
    authorize(job);
  }
  function runStatus(job,state,error){
    const current=readState(job.profileId);if(!current)return;
    const run=current.state.runs.find(item=>item.id===job.id);if(run)Object.assign(run,{state,error,finishedAt:state==='running'?undefined:stamp(),codexThreadId:job.threadId});
    if(job.kind==='research'){const topic=current.state.topics.find(item=>item.id===job.topicId);if(topic&&!['approved','rejected'].includes(topic.status))Object.assign(topic,{status:state==='running'?'researching':'error',lastError:error,updatedAt:stamp()});}
    if(job.kind==='script'){const content=current.state.contents.find(item=>item.id===job.contentId);if(content&&content.status!=='script-approved')Object.assign(content,{status:state==='running'?'generating':'error',lastError:error,updatedAt:stamp()});}
    writeState(job.profileId,current);
  }
  function terminal(job,status,error){transaction(()=>{job.status=status;job.error=error;put(job);record(job,status,error);runStatus(job,status==='canceled'?'canceled':status==='interrupted'?'interrupted':'failed',error);});}
  async function finish(job,output){
    job.output=output;job.phase='response-complete';put(job);
    if(!output.trim())fail('The runtime returned no response.');
    let result;
    if(job.kind==='research')result=validateResearch(output,job.topic.inputKind==='ideas'?3:1);
    if(job.kind==='script')result=validateScriptOptions(output);
    if(job.kind==='handoff'){
      const value=parseProviderJson(output);
      if(typeof value.summary!=='string'||!value.summary.trim()||!Array.isArray(value.outputFiles)||value.outputFiles.length>20||!value.outputFiles.every(path=>typeof path==='string')||!Array.isArray(value.blockers)||!value.blockers.every(item=>typeof item==='string'))fail('The specialist did not return a structured result with summary, outputFiles and blockers.');
      const files=[];for(const path of [...new Set(value.outputFiles)]){if(job.files.some(input=>input.path===path))fail('The specialist returned an input file as an edited output. Review it manually.');const file=await inspect(path);if(file.status!=='available')fail(`Output unavailable: ${file.error}`);if(job.files.some(input=>input.sha256===file.sha256))fail('The specialist returned unchanged input bytes as an edited output. Review it manually.');files.push(file);}
      result={summary:value.summary.slice(0,64000),outputFiles:files,blockers:value.blockers.slice(0,20)};
    }
    transaction(()=>{
      const current=authorize(job),state=current.state,at=stamp();
      const run=state.runs.find(item=>item.id===job.id);if(!run)fail('Work record no longer exists.');
      if(job.kind==='research'){
        const replacements=result.map((proposal,index)=>{
          const id=index?`${job.topicId}-proposal-${index+1}`:job.topicId,prior=state.topics.find(item=>item.id===id);
          if(prior?.contentId||['approved','rejected'].includes(prior?.status))fail('This topic was already decided. The new answer was preserved for review.');
          const artifact={id:`${job.id}-research-${index}`,workspaceId:job.workspaceId,topicId:id,runId:job.id,type:'research',version:state.artifacts.filter(item=>item.topicId===id&&item.type==='research').length+1,data:proposal,createdAt:at};state.artifacts.unshift(artifact);run.outputArtifactIds.push(artifact.id);
          return {...job.topic,...proposal,id,status:'review',researchArtifactId:artifact.id,updatedAt:at,lastError:undefined};
        });const ids=new Set(replacements.map(item=>item.id));state.topics=[...replacements,...state.topics.filter(item=>!ids.has(item.id))];
      }else{
        const content=state.contents.find(item=>item.id===job.contentId),type=job.kind==='script'?'script-options':'specialist-result';
        const artifact={id:`${job.id}-result`,workspaceId:job.workspaceId,topicId:job.topicId,contentId:job.contentId,runId:job.id,type,version:state.artifacts.filter(item=>item.contentId===job.contentId&&item.type===type).length+1,data:result,createdAt:at};state.artifacts.unshift(artifact);run.outputArtifactIds=[artifact.id];
        if(job.kind==='script')Object.assign(content,{status:'script-review',scriptOptionsArtifactId:artifact.id,updatedAt:at,lastError:undefined});
        if(job.kind==='handoff'){
          state.assets??=[];
          for(const file of result.outputFiles){
            if(state.assets.some(asset=>asset.contentId===content.id&&asset.versions.some(version=>version.sha256===file.sha256)))continue;
            const version={id:randomUUID(),path:file.path,name:file.name,size:file.size,sha256:file.sha256,modifiedAt:file.modifiedAt,createdAt:at};
            state.assets.push({id:`asset-${randomUUID()}`,workspaceId:job.workspaceId,contentId:content.id,name:file.name,kind:file.kind,role:'output',sourceAssetId:job.files[0]?.assetId,currentVersionId:version.id,versions:[version],status:'available',checkedAt:file.checkedAt,createdAt:at,updatedAt:at});
          }
          content.assetIds=state.assets.filter(asset=>asset.contentId===content.id&&asset.workspaceId===job.workspaceId).map(asset=>asset.id);
        }
        // A specialist answer is not evidence of an edited or published video.
      }
      Object.assign(run,{state:'completed',finishedAt:at,codexThreadId:job.threadId});
      job.status='succeeded';job.result=result;job.error=undefined;job.phase='committed';put(job);record(job,'result-saved');writeState(job.profileId,current);
    });
  }
  async function reconcile(job,runtime){
    if(!job.threadId)return {resend:true};
    const thread=await runtime.readThread(job.threadId),turn=matchingWorkflowTurn(job,thread);
    if(turn?.status==='completed'){await finish(job,answer(turn));record(job,'reconciled-without-resend');return {completed:true};}
    if(thread.status?.type==='active'||turn?.status==='inProgress')return {blocked:true};
    return {resend:true};
  }
  async function execute(job){
    const runtime=getRuntime();if(!runtime)fail('Codex CLI is unavailable. Reconnect it and resume this work.');
    authorize(job);await checkFiles(job);
    if(job.phase==='sending'||job.phase==='streaming'){const recovered=await reconcile(job,runtime);if(recovered.completed)return;fail(recovered.blocked?'This session is still active. Verify again after it finishes.':'This work was interrupted. Verify the saved session before explicitly resending.');}
    const scope=`${job.kind}:${job.targetId}${job.newSession?`:${job.id}`:''}`,configHash=artifactHash(job.agent);
    const existing=db.prepare('SELECT * FROM workflow_sessions WHERE profile_id=? AND scope=? AND agent_id=? AND config_hash=?').get(job.profileId,scope,job.agent.id,configHash);
    if(existing){
      const emptyUnsent=job.threadId===existing.thread_id&&['queued','thread-ready'].includes(job.phase)&&!job.executionId&&!job.history.some(attempt=>attempt.executionId);
      job.sessionId=existing.id;job.threadId=existing.thread_id;
      try{await runtime.resumeSession(job.threadId,job.agent);}
      catch(error){
        if(!emptyUnsent||!/no rollout found for thread id/i.test(error.message))throw error;
        // A failed pre-send attempt can leave a never-materialized empty thread.
        // Only replace that known-unsent session, never a saved/uncertain turn.
        job.threadId=await runtime.createSession(job.agent);
        db.prepare('UPDATE workflow_sessions SET thread_id=? WHERE id=? AND profile_id=?').run(job.threadId,job.sessionId,job.profileId);
      }
    }
    else{
      job.threadId=await runtime.createSession(job.agent);job.sessionId=`workflow-session-${randomUUID()}`;
      db.prepare('INSERT INTO workflow_sessions VALUES (?,?,?,?,?,?,?)').run(job.sessionId,job.profileId,scope,job.agent.id,job.threadId,configHash,stamp());
    }
    job.phase='thread-ready';put(job);record(job,'session-linked',job.threadId);
    const stored=await runtime.readThread(job.threadId);if(stored.status?.type==='active')fail('This session already has an active response. Wait before resuming.');
    authorize(job);await checkFiles(job);if(controller.signal.aborted)fail('Execution canceled.');
    job.phase='sending';put(job);record(job,'send-requested');
    const execution=await runtime.send(job.threadId,`${marker(job)}\n${job.prompt}`,job.agent);
    job.executionId=execution.executionId;job.phase='streaming';
    if(controller.signal.aborted||read(job.profileId,job.id)?.status==='canceled'){await runtime.cancel(job.threadId,job.executionId).catch(()=>{});fail('Execution canceled.');}
    put(job);record(job,'response-started');
    let completed=false,lastSaved=0;
    for await(const event of runtime.events(job.executionId,controller.signal)){
      if(controller.signal.aborted)fail('Execution canceled.');
      if(event.type==='message.delta')job.output=(job.output??'')+event.delta;
      if(event.type==='message.completed')job.output=event.content;
      if((job.output??'').length>500000)fail('This response exceeds the local work size limit.');
      if(event.type==='agent.delegate')fail('Nested delegation is not enabled for persistent work. Select the specialist explicitly.');
      if(['search','activity','tool.started','tool.finished'].includes(event.type)){job.activity=event.label??event.tool;record(job,event.type,job.activity);}
      if(Date.now()-lastSaved>150){put(job);lastSaved=Date.now();}
      if(event.type==='execution.failed')fail(event.message);
      if(event.type==='execution.cancelled')fail('Execution canceled.');
      if(event.type==='execution.completed')completed=true;
    }
    put(job);if(!completed)fail('The stream ended before completion. Verify the saved session before resending.');
    await finish(job,job.output??'');
  }
  function lease(){
    return transaction(()=>{
      const row=db.prepare('SELECT * FROM workflow_worker_lease WHERE id=1').get();
      if(row&&row.owner!==owner&&row.expires>Date.now())return false;
      if(row?.owner!==owner){
        for(const item of db.prepare("SELECT data_json FROM workflow_work WHERE status='running'").all()){const job=JSON.parse(item.data_json);job.status='interrupted';job.error='The app stopped during this work. Verify the saved session before resuming.';put(job);record(job,'interrupted');runStatus(job,'interrupted',job.error);}
      }
      db.prepare('INSERT OR REPLACE INTO workflow_worker_lease VALUES (1,?,?)').run(owner,Date.now()+15000);return true;
    });
  }
  async function drain(){
    while(!closed&&lease()){
      if(!getRuntime())return;
      const profile=getCurrentProfile?.();const row=profile?db.prepare("SELECT data_json FROM workflow_work WHERE status='queued' AND profile_id=? ORDER BY created_at LIMIT 1").get(profile):db.prepare("SELECT data_json FROM workflow_work WHERE status='queued' ORDER BY created_at LIMIT 1").get();if(!row)return;
      const job=JSON.parse(row.data_json);controller=new AbortController();activeId=job.id;job.status='running';put(job);record(job,'started');
      const timer=setTimeout(()=>{controller?.abort();},timeoutMs);timer.unref?.();
      try{await execute(job);}catch(error){
        const latest=read(job.profileId,job.id);if(latest?.status==='canceled')continue;
        const status=closed?'interrupted':controller.signal.aborted?'interrupted':job.phase==='sending'||job.phase==='streaming'?'interrupted':'failed';
        terminal(job,status,error instanceof Error?error.message:String(error));
        if(controller.signal.aborted&&job.executionId)await getRuntime()?.cancel(job.threadId,job.executionId).catch(()=>{});
      }finally{clearTimeout(timer);activeId=undefined;controller=undefined;}
    }
  }
  const kick=()=>{if(closed||active)return;active=drain().then(()=>{lastWorkerError='';}).catch(error=>{lastWorkerError=String(error.message??error);}).finally(()=>{active=undefined;});};
  const timer=setInterval(()=>{if(!closed){try{if(active)db.prepare('UPDATE workflow_worker_lease SET expires=? WHERE id=1 AND owner=?').run(Date.now()+15000,owner);else kick();}catch(error){lastWorkerError=String(error.message??error);controller?.abort();}}},2000);timer.unref?.();
  return {
    status:()=>({error:lastWorkerError,runtimeAvailable:Boolean(getRuntime())}),
    enqueue(profile,input){
      const {kind,targetId,agentId,requestKey,language='pt-BR',sourceAgentId,assetIds=[],instructions='',newSession=false}=input;
      if(!['research','script','handoff'].includes(kind)||typeof targetId!=='string'||typeof requestKey!=='string'||requestKey.length>160||!requestKey||!['pt-BR','en-US'].includes(language)||typeof newSession!=='boolean')fail('Invalid work request.');
      const signature=artifactHash({kind,targetId,agentId,language,sourceAgentId,assetIds,instructions,newSession});
      const old=db.prepare('SELECT data_json FROM workflow_work WHERE profile_id=? AND request_key=?').get(profile,requestKey);if(old){const job=JSON.parse(old.data_json);if(job.requestSignature!==signature)fail('This request key was already used with different instructions. Start a new request.');return {...readState(profile),job};}
      const receipt=transaction(()=>{
        const current=readState(profile);if(!current||current.revision!==input.revision)fail('Editorial data changed. Refresh before starting work.');
        const state=current.state,content=kind==='research'?null:state.contents.find(item=>item.id===targetId),topic=state.topics.find(item=>item.id===(content?.topicId??targetId));if(!topic||kind!=='research'&&!content)fail('Choose an existing topic or content.');
        if(kind==='research'&&['approved','rejected'].includes(topic.status))fail('Create a new topic instead of replacing a decided topic.');
        const workspaceId=topic.workspaceId,agent=chooseAgent(profile,agentId,workspaceId,input.agents);
        if(kind==='research'&&!agent.tools.includes('web-search'))fail('Select an agent with Web Search enabled.');
        if(db.prepare("SELECT id FROM workflow_work WHERE profile_id=? AND target_id=? AND kind=? AND status IN ('queued','running')").get(profile,targetId,kind))fail('Work for this item is already queued or running.');
        const artifact=state.artifacts.find(item=>item.id===content?.approvedScriptArtifactId);let sourceAgent,files=[];
        if(kind==='handoff'){
          if(input.expectedArtifactId!==undefined&&input.expectedArtifactId!==artifact?.id)fail('The approved version changed. Review it before transferring work.');
          sourceAgent=chooseAgent(profile,sourceAgentId,workspaceId,input.agents);
          if(sourceAgent.id===agent.id||!sourceAgent.tools.includes('subagents'))fail('Enable collaboration on the source agent and select another specialist.');
          if(content.status!=='script-approved'||!artifact||!state.approvals.some(item=>item.artifactId===artifact.id&&item.artifactVersion===artifact.version&&item.decision==='approved'))fail('Approve the current script first.');
          if(typeof instructions!=='string'||!instructions.trim()||instructions.length>32000||!Array.isArray(assetIds)||assetIds.length>20)fail('Add a briefing and up to 20 associated files.');
          files=[...new Set(assetIds)].map(id=>{const asset=state.assets?.find(item=>item.id===id&&item.contentId===content.id&&item.workspaceId===workspaceId);if(!asset)fail('Choose files from this content library.');const version=currentVersion(asset);return {assetId:id,versionId:version.id,path:version.path,sha256:version.sha256,name:version.name};});
        }
        const id=`work-${randomUUID()}`,at=stamp();
        const review=state.approvals.find(item=>item.artifactId===content?.scriptOptionsArtifactId&&item.action==='script-review');
        const previousOptions=state.artifacts.find(item=>item.id===content?.scriptOptionsArtifactId);
        const feedback=review?.decision==='revision-requested'?`\nUser requested changes to options version ${previousOptions?.version}: ${JSON.stringify(review.notes)}\nPrevious options, for revision only: ${JSON.stringify(previousOptions?.data)}\nCreate a new version. Do not claim the user approved it.`:'';
        const prompt=kind==='research'?researchPrompt(topic,language):kind==='script'?scriptPrompt(topic,content,language)+feedback:`Task from ${sourceAgent.name} (${sourceAgent.role}) for ${agent.name}: ${content.title}\nUser-approved briefing: ${instructions.trim()}\nApproved script version ${artifact.version}: ${JSON.stringify(artifact.data)}\nLocal file references, not uploads: ${JSON.stringify(files)}\nUse only your configured skills. Report unavailable files or editing tools honestly. Do not publish, schedule or change external services. Return ONLY JSON: {"summary":"your actual result","outputFiles":["absolute paths to actual new output files, or empty"],"blockers":["missing tools or inputs, or empty"]}. Language: ${language}.`;
        const job={id,requestSignature:signature,profileId:profile,workspaceId,targetId,topicId:topic.id,contentId:content?.id,kind,agent,sourceAgent,files,prompt,newSession,inputHash:inputFingerprint(kind,topic,content,artifact),topic:structuredClone(topic),status:'queued',phase:'queued',attempt:1,output:'',history:[],createdAt:at,updatedAt:at};
        db.prepare('INSERT INTO workflow_work VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,profile,workspaceId,targetId,kind,'queued',requestKey,JSON.stringify(job),at,at);
        state.runs.unshift({id,jobId:id,workspaceId,topicId:topic.id,contentId:content?.id,stage:kind,agentId:agent.id,providerId:'codex',modelId:agent.modelId,input:prompt,outputArtifactIds:[],state:'running',startedAt:at});
        if(kind==='research')Object.assign(topic,{status:'researching',lastError:undefined,updatedAt:at});if(kind==='script')Object.assign(content,{status:'generating',lastError:undefined,updatedAt:at});
        writeState(profile,current);record(job,'queued');return {revision:current.revision+1,state,job};
      });kick();return receipt;
    },
    list(profile){return db.prepare('SELECT data_json FROM workflow_work WHERE profile_id=? ORDER BY created_at DESC').all(profile).map(row=>{const job=JSON.parse(row.data_json);return {...job,prompt:undefined,topic:undefined,agent:{id:job.agent.id,name:job.agent.name},sourceAgent:job.sourceAgent?{id:job.sourceAgent.id,name:job.sourceAgent.name}:undefined};});},
    detail(profile,id){const job=read(profile,id);if(!job)fail('Work not found.');return {...job,events:db.prepare('SELECT event_json,at FROM workflow_events WHERE job_id=? ORDER BY id DESC LIMIT 500').all(id).reverse().map(row=>({...JSON.parse(row.event_json),at:row.at}))};},
    async retry(profile,id,{resend=false}={}){
      if(typeof resend!=='boolean')fail('Invalid retry confirmation.');
      if(locks.has(id))fail('Verification is already in progress.');locks.add(id);
      try{
        const job=read(profile,id);if(!job||!['failed','interrupted','blocked'].includes(job.status))fail('This work is not available to resume.');
        const runtime=getRuntime();if(!runtime)fail('Reconnect Codex before resuming.');authorize(job);await checkFiles(job);
        if(['sending','streaming'].includes(job.phase)){const recovered=await reconcile(job,runtime);if(recovered.completed)return readState(profile);if(recovered.blocked)fail('This session is still active. Verify again after it finishes.');if(!resend)fail('No completed response was found. Explicitly confirm resending the instruction.');}
        if(job.phase==='response-complete'){try{await finish(job,job.output);return readState(profile);}catch(error){if(!resend)throw error;}}
        if(job.attempt>=3)fail('This work reached three attempts. Review its inputs before creating new work.');
        transaction(()=>{if(!['failed','interrupted','blocked'].includes(read(profile,id)?.status))fail('This work changed during verification.');job.history.push({attempt:job.attempt,executionId:job.executionId,output:job.output,error:job.error});job.attempt++;job.status='queued';job.phase='queued';job.executionId=undefined;job.output='';job.error=undefined;put(job);record(job,resend?'resend-confirmed':'resume-requested');runStatus(job,'running');});kick();return readState(profile);
      }finally{locks.delete(id);}
    },
    async cancel(profile,id){
      const job=read(profile,id);if(!job||!activeStatuses.includes(job.status))fail('This work is not active.');
      if(job.status==='queued'){terminal(job,'canceled','Canceled before execution.');return readState(profile);}
      if(activeId!==id)fail('This work belongs to another executor. Wait before canceling.');
      // Persist intent first, so late completion cannot become success.
      job.status='canceled';job.error='Canceled by the user.';put(job);record(job,'cancel-requested');controller?.abort();
      try{if(job.executionId)await getRuntime()?.cancel(job.threadId,job.executionId);}
      catch(error){job.error=`Cancel requested, but the CLI did not confirm interruption: ${error.message}`;put(job);record(job,'cancel-unconfirmed',job.error);}
      finally{transaction(()=>runStatus(job,'canceled',job.error));}
      return readState(profile);
    },
    kick,
    async close(){closed=true;clearInterval(timer);controller?.abort();await active;db.prepare('DELETE FROM workflow_worker_lease WHERE owner=?').run(owner);},
  };
}
