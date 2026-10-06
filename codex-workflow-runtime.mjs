/** Host-only adapter. It never writes account config or starts inference while reconciling. */
export function createCodexWorkflowRuntime({client,cwd,request,events,imageFile,imageFromItem}) {
  const omitNulls=value=>Array.isArray(value)?value.filter(item=>item!=null).map(omitNulls):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,item])=>item!=null).map(([key,item])=>[key,omitNulls(item)])):value;
  async function policy(agent){
    const {config}=await client.request('config/read',{includeLayers:false});
    const overrides={'features.apps':false,'features.plugins':false,'features.multi_agent':false};
    if(agent)overrides.web_search=agent.tools?.includes('web-search')?'live':'disabled';
    // App Server config paths are split on dots, not parsed as quoted TOML keys.
    // Replace this session's whole map so dotted server names stay literal and
    // each disabled entry retains its required transport configuration.
    overrides.mcp_servers=Object.fromEntries(Object.entries(config?.mcp_servers??{}).map(([name,server])=>[name,{...omitNulls(server),enabled:false}]));
    return overrides;
  }
  async function verify(threadId){
    let cursor;
    do{const result=await client.request('mcpServerStatus/list',{threadId,detail:'toolsAndAuthOnly',limit:100,...(cursor?{cursor}:{})});
      if((result.data??[]).some(server=>Object.keys(server.tools??{}).length))throw new Error('External tools are still enabled in this work session. Execution was blocked.');
      cursor=result.nextCursor;
    }while(cursor);
  }
  return {
    imageFile,imageFromItem,
    async createSession(agent){
      const enabled=(agent.skills??[]).filter(name=>!agent.disabledSkills?.includes(name));
      const skills=enabled.map(name=>`${name}: ${agent.skillFiles?.[name]??agent.skillsDirectory??'path not configured'}`).join('\n');
      const result=await client.request('thread/start',{cwd,historyMode:'legacy',model:agent.modelId||undefined,approvalPolicy:'never',sandbox:'read-only',serviceName:'mainsagents-workflow',config:await policy(agent),developerInstructions:`You are ${agent.name} (${agent.role}).\n${agent.instructions}\nAssociated skills only (read the relevant Markdown file):\n${skills}\nThis work permits research and reading local files only. Do not publish, change external services, edit source files, or delegate. If an editing tool is unavailable, report a blocker. Do not claim an edited video without a real output file.`});
      await verify(result.thread.id);return result.thread.id;
    },
    async resumeSession(threadId,agent){await client.request('thread/resume',{threadId,config:await policy(agent),approvalPolicy:'never',sandbox:'read-only'});await verify(threadId);},
    async readThread(threadId){
      try{return (await client.request('thread/read',{threadId,includeTurns:true})).thread;}
      catch(error){
        // The CLI hasn't written a rollout before a fresh thread's first input.
        // Never turn missing/unsupported persisted history into an empty result.
        if(!/not materialized yet.*before first user message/i.test(error.message))throw error;
        return {...(await client.request('thread/read',{threadId,includeTurns:false})).thread,turns:[]};
      }
    },
    async send(threadId,content,agent){await verify(threadId);return request('/api/codex/executions',{threadId,content,modelId:agent.modelId,reasoningEffort:'medium',delegation:{sourceAgentId:agent.id,workspaceId:agent.workspaceId,targets:[]}});},
    events,
    cancel:(threadId,executionId)=>client.request('turn/interrupt',{threadId,turnId:executionId}),
  };
}
