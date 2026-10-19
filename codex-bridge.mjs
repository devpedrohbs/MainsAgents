import { spawn } from 'node:child_process';
import { classifyCodexTurnError, limitFailure } from './provider-limits.mjs';
import { createServer } from 'node:http';
import {probeMcpAccounts} from './runtime-read-probe.mjs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { delegateTool, DelegationCalls } from './agent-delegation-runtime.mjs';
import {createCodexWorkflowRuntime} from './codex-workflow-runtime.mjs';
import {chatApprovalPolicy,chatActionConfig} from './codex-action-policy.mjs';
import {diagnoseCodex} from './runtime-capabilities.mjs';
import { prepareCodexRuntimeHome, importLegacyCodexThread, threadDynamicToolNames } from './codex-runtime-home.mjs';
import { createChatImageArtifacts, isImageGenerationItem, imageGenerationInstructions } from './chat-image-artifacts.mjs';
import {notionAutomationInstructions} from './notion-automation-policy.mjs';
import {paperDesignInstructions} from './paper-design.mjs';
import {paperImageInstructions} from './paper-image-assets.mjs';
import {scheduleTool} from './chat-publishing.mjs';
import {publishingInstructions} from './publishing-automation.mjs';
import {permittedMcpAction} from './runtime-tool-policy.mjs';
import {agentFileAccess} from './agent-file-access.mjs';
import {probeCodexExecutor,skillMarkdownFile,hostSkillContext,executorUnavailableInstructions,classifyThreadError,threadErrorStatus} from './codex-executor-readiness.mjs';

export function codexLaunch({platform=process.platform,cliPath=process.env.CODEX_CLI_PATH,nodePath=process.execPath,appData=process.env.APPDATA??''}={}) {
  const cli=cliPath??(platform==='win32'?join(appData,'npm','node_modules','@openai','codex','bin','codex.js'):'codex');
  const javascript=/\.(?:mjs|cjs|js)$/i.test(cli);
  return {command:javascript?nodePath:cli,args:[...(javascript?[cli]:[]),'app-server','--stdio'],cli,javascript};
}

class AppServerClient {
  constructor(cwd, runtime) {
    this.cwd = cwd;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.closed=false;
    const {command,args,cli,javascript}=codexLaunch({cliPath:process.env.MAINSAGENTS_CODEX_CLI_PATH || runtime.env.CODEX_CLI_PATH || null});
    if(process.platform==='win32'&&!existsSync(cli))throw new Error('Codex CLI not found. Install @openai/codex or set CODEX_CLI_PATH.');
    const env=process.versions.electron&&javascript?{...runtime.env,ELECTRON_RUN_AS_NODE:'1'}:runtime.env;
    this.process=spawn(command,[...args,...runtime.args],{cwd,stdio:['pipe','pipe','pipe'],windowsHide:true,env});
    createInterface({ input: this.process.stdout }).on('line', (line) => this.handleLine(line));
    this.process.stderr.on('data', (chunk) => process.stderr.write(`[codex] ${chunk}`));
    this.process.on('exit', (code) => {
      this.closed=true;
      const error = new Error(`Codex app-server stopped with exit code ${code ?? 'unknown'}`);
      for (const { reject } of this.pending.values()) reject(error);
      this.pending.clear();
      for (const listener of this.listeners) listener({ method: 'bridge/error', params: { message: error.message } });
    });
    this.process.on('error',(error)=>{this.closed=true;for(const pending of this.pending.values())pending.reject(error);this.pending.clear()});
    this.ready = this.initialize();
  }

  async initialize() {
    await this.request('initialize', { clientInfo: { name: 'mainsagents', title: 'MainsAgents', version: '0.3.21' }, capabilities:{experimentalApi:true} });
    this.notify('initialized', {});
  }

  handleLine(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      message.error ? pending.reject(new Error(message.error.message ?? 'Codex request failed')) : pending.resolve(message.result);
      return;
    }
    for (const listener of this.listeners) listener(message);
  }

  request(method, params, timeoutMs = 30000) {
    if(this.closed)return Promise.reject(new Error('Codex app-server is not running'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`Codex ${method} timed out`))},timeoutMs);
      this.pending.set(id, { resolve:(value)=>{clearTimeout(timer);resolve(value)}, reject:(error)=>{clearTimeout(timer);reject(error)} });
      this.process.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
    });
  }

  notify(method, params) { this.process.stdin.write(`${JSON.stringify({ method, params })}\n`); }
  reply(id,result) { if(!this.closed)this.process.stdin.write(`${JSON.stringify({id,result})}\n`); }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  close() {
    if(this.closed)return Promise.resolve();
    return new Promise(resolve=>{
      const timer=setTimeout(resolve,2000);
      this.process.once('exit',()=>{clearTimeout(timer);resolve();});
      this.process.kill();
    });
  }
}

const executions = new Map();
const pendingEvents = new Map();
const activeThreadWriters = new Map();
const activeWriterMessage = 'This session already has a Codex response in progress. Wait for it to finish before sending another message.';

async function waitForExternalWriter(client, threadId, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const stored = await client.request('thread/read', { threadId, includeTurns: false });
    if (stored.thread?.status?.type !== 'active') return true;
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  return false;
}

function recordFor(executionId, threadId = '') {
  let record = executions.get(executionId);
  if (!record) {
    const events = pendingEvents.get(executionId) ?? [];
    record = { executionId, threadId, events, listeners: new Set(), done: events.some((event) => ['execution.completed','execution.cancelled','execution.failed'].includes(event.type)) };
    pendingEvents.delete(executionId);
    executions.set(executionId, record);
  }
  if (threadId) record.threadId = threadId;
  return record;
}

function publish(executionId, event) {
  if (!executionId) return;
  const record = executions.get(executionId);
  if (!record) { pendingEvents.set(executionId, [...(pendingEvents.get(executionId) ?? []), event]); return; }
  const terminal = ['execution.completed','execution.cancelled','execution.failed'].includes(event.type);
  if (record.done && terminal) return;
  record.events.push(event);
  for (const listener of record.listeners) listener(event);
  if (terminal) {
    record.done = true;
    if (record.threadId && activeThreadWriters.get(record.threadId) === executionId) activeThreadWriters.delete(record.threadId);
  }
}

function itemLabel(item) {
  if (isImageGenerationItem(item)) return {kind:'tool',label:'Generating image...'};
  if (item.type === 'webSearch') return { kind: 'search', label: item.query ? `Searching: ${item.query}` : 'Searching web...' };
  if (item.type === 'commandExecution') return { kind: 'tool', label: 'Using terminal...' };
  if (item.type === 'mcpToolCall') return { kind: 'tool', label: `Using ${item.server} · ${item.tool}...` };
  if (item.type === 'dynamicToolCall') return { kind: 'tool', label: `Using ${item.tool}...` };
  if (item.type === 'imageView') return { kind: 'tool', label: 'Reading image...' };
  if (item.type === 'fileChange') return { kind: 'tool', label: 'Preparing file changes...' };
  if (item.type === 'reasoning') return { kind: 'thinking', label: 'Thinking...' };
  return null;
}

/** Host records from actual tool results: native images and Paper exports become verified receipts of the session. */
export function recordToolResults(message,{imageArtifacts,resolveBinding,paperAssets}){
  if(!paperAssets||message.method!=='item/completed')return;
  const params=message.params??{},item=params.item??{},threadId=params.threadId,turnId=params.turnId??params.turn?.id;
  const binding=threadId?resolveBinding(threadId):null;if(!binding)return;
  const failed=error=>console.error(`[MainsAgents] Receipt not recorded: ${error.message}`);
  if(isImageGenerationItem(item)&&item.status==='completed'&&typeof item.id==='string'){
    let path;try{path=imageArtifacts.pathForImage({url:imageArtifacts.fromItem(item,turnId)?.image?.url});}catch{return;}
    paperAssets.recordGeneratedImage({binding,callId:`${threadId}:${item.id}`,path}).catch(failed);
  }
  if(item.type==='mcpToolCall'&&item.server==='paper'&&item.tool==='export'&&item.status==='completed'&&!item.error&&item.result&&!item.result.isError)
    paperAssets.captureExport({binding,callId:`${threadId}:${turnId}:${item.id}`,arguments:item.arguments,result:item.result}).catch(failed);
}

function connectNotifications(client, delegationCalls, threadDelegation, imageArtifacts,actions,resolveBinding,delegations,{paperAssets,chatPublishing}={}) {
  return client.subscribe((message) => {
    const params = message.params ?? {};
    const turnId = params.turnId ?? params.turn?.id;
    if(message.id!==undefined&&message.method==='mcpServer/elicitation/request'){
      if(actions)actions.receive(message,resolveBinding(params.threadId),result=>client.reply(message.id,result));
      else client.reply(message.id,{action:'decline',content:null});return;
    }
    if(message.id!==undefined&&message.method==='item/tool/requestUserInput'){client.reply(message.id,{answers:{}});return;}
    if(message.id!==undefined&&message.method==='item/permissions/requestApproval'){client.reply(message.id,{permissions:{},scope:'turn'});return;}
    if(message.id!==undefined&&/requestApproval$/.test(message.method)){client.reply(message.id,{decision:'decline'});return;}
    actions?.observe(message);
    delegations?.observeParent(message);
    if(message.method==='item/tool/call'&&message.id!==undefined&&params.tool===scheduleTool.name){
      // Authority comes from the saved session (user request + agent preference), resolved by the host here.
      const binding=chatPublishing?resolveBinding(params.threadId):null,answer=result=>client.reply(message.id,{success:result.success===true,contentItems:[{type:'inputText',text:String(result.content??'').slice(0,64000)}]});
      if(!binding)answer({success:false,content:'Scheduling is unavailable in this chat. Nothing was scheduled.'});
      else Promise.resolve().then(()=>chatPublishing.call(binding,params.arguments??{},{executionId:turnId,callId:params.callId})).then(answer,error=>answer({success:false,content:error.message}));
      return;
    }
    if(message.method==='item/tool/call'&&message.id!==undefined){delegationCalls.receive(message,threadDelegation.get(params.threadId));return;}
    recordToolResults(message,{imageArtifacts,resolveBinding,paperAssets});
    if (message.method === 'turn/started') publish(turnId, { type: 'execution.started', executionId: turnId, threadId: params.threadId ?? '' });
    if (message.method === 'item/agentMessage/delta') publish(turnId, { type: 'message.delta', executionId: turnId, delta: params.delta ?? '' });
    if (message.method === 'item/started' || message.method === 'item/completed') {
      const item = params.item ?? {};
      if (message.method === 'item/completed' && isImageGenerationItem(item)) {
        const event=imageArtifacts.fromItem(item,turnId);
        if(event)publish(turnId,event);
      }
      if (message.method === 'item/completed' && item.type === 'agentMessage') publish(turnId, { type: 'message.completed', executionId: turnId, content: item.text ?? '' });
      const detail = itemLabel(item);
      if (detail?.kind === 'search') publish(turnId, { type: 'search', executionId: turnId, label: detail.label, status: message.method === 'item/started' ? 'started' : 'finished' });
      if (detail?.kind === 'thinking') publish(turnId, { type: 'activity', executionId: turnId, label: detail.label, status: message.method === 'item/started' ? 'started' : 'finished' });
      if (detail?.kind === 'tool') publish(turnId, { type: message.method === 'item/started' ? 'tool.started' : 'tool.finished', executionId: turnId, tool: item.type, callId: item.id ?? '', ...(message.method === 'item/started' ? { label: detail.label } : {}) });
    }
    if (message.method === 'turn/completed') {
      actions?.interrupt(turnId);
      delegationCalls.cancel(turnId);
      const status = params.turn?.status;
      if (status === 'completed') publish(turnId, { type: 'execution.completed', executionId: turnId });
      else if (status === 'interrupted') publish(turnId, { type: 'execution.cancelled', executionId: turnId });
      else {
        // Usage limits only from the structured codexErrorInfo of the failed turn (never from the error prose).
        const classified = limitFailure(classifyCodexTurnError(params.turn?.error), 'Codex');
        publish(turnId, classified ? { type: 'execution.failed', executionId: turnId, ...classified } : { type: 'execution.failed', executionId: turnId, code: 'turn_failed', message: params.turn?.error?.message ?? 'Codex execution failed', retryable: true });
      }
    }
    if (message.method === 'error') publish(turnId, { type: 'execution.failed', executionId: turnId, code: 'runtime_error', message: params.error?.message ?? 'Codex runtime error', retryable: true });
    if (message.method === 'bridge/error') {actions?.close();for (const record of executions.values()) if (!record.done) publish(record.executionId, { type: 'execution.failed', executionId: record.executionId, code: 'bridge_error', message: params.message, retryable: true });}
  });
}

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

export async function startCodexBridge({ port = 8787, cwd = process.cwd(), runtimeHome = process.env.MAINSAGENTS_CODEX_HOME || join(process.env.APPDATA || join(homedir(), '.local', 'share'), 'mains-agents', 'codex-runtime'), sharedHome, imagesDirectory=join(homedir(),'.mainsagents','storage','images'),actions,getBinding,getAgents,delegations,paperAssets,chatPublishing } = {}) {
  const token=randomBytes(32).toString('hex');
  const runtime = prepareCodexRuntimeHome({home:runtimeHome,sharedHome,onError:error=>console.error(`[MainsAgents] Codex connection synchronization: ${error.message}`)});
  // Keep generated media in notifications. Do not change auth, billing or the text model.
  runtime.args.push('-c','features.image_generation=true','-c','features.omit_app_server_notification_media=false');
  const imageArtifacts=createChatImageArtifacts(imagesDirectory);
  let client;
  try { client = new AppServerClient(cwd, runtime); } catch (error) { runtime.close(); throw error; }
  const threadDelegation=new Map();
  actions?.open();
  const threadSessions=new Map();
  const managedThreads=new Set(),workflowThreads=new Set();
  let diagnostics;
  // A successful sandboxed read is reused briefly per policy; failures are re-probed so recovery is noticed.
  // Concurrent callers share one in-flight probe (the first sandboxed command can take over a minute).
  const executorReady=new Map(),executorProbes=new Map();
  const executorReadiness=(cwd,file,sandboxPolicy={type:'readOnly'})=>{
    const key=JSON.stringify([cwd,sandboxPolicy]);
    if(Date.now()-(executorReady.get(key)??0)<300000)return Promise.resolve({ready:true,state:'ready'});
    if(!executorProbes.has(key))executorProbes.set(key,probeCodexExecutor(client,{home:runtime.home,cwd,file,sandboxPolicy}).then(result=>{
      if(result.ready)executorReady.set(key,Date.now());else console.error(`[MainsAgents] Codex executor ${result.state==='slow'?'still preparing':'unavailable'}: ${result.diagnosis?.summary??result.error}`);
      return result;
    }).finally(()=>executorProbes.delete(key)));
    return executorProbes.get(key);
  };
  // Session start waits briefly; a probe still running is unknown, never reported to the agent as a failure.
  const executorAtSessionStart=(cwd,file,sandboxPolicy)=>Promise.race([executorReadiness(cwd,file,sandboxPolicy),new Promise(resolve=>setTimeout(resolve,8000,{ready:false,state:'pending'}).unref())]);
  const resolveBinding=threadId=>getBinding?.(threadId,threadSessions.get(threadId));
  // Application tools are fixed at thread/start (resume keeps the stored ones), so scheduling is offered to the model only
  // when this thread really has the tool; an older thread is told plainly that a new chat of the agent is needed.
  const scheduleThreads=new Set();
  const schedulingPrompt=(threadId,binding)=>{
    if(!chatPublishing||!binding||!permittedMcpAction(binding.agent,'schedule'))return '';
    if(scheduleThreads.has(threadId)||threadDynamicToolNames(runtime,threadId)?.includes(scheduleTool.name))return publishingInstructions(binding.agent);
    return '\n\nScheduling posts: this older chat was started before the MainsAgents scheduling tool existed, and a resumed chat cannot gain new app tools. If the user asks to schedule, do not claim to schedule; tell them to open a new chat of this same agent (same saved settings), which has the scheduling tool.';
  };
  // 'thread not loaded' alone never proves absence: a resume settles it ('no rollout found' => thread-missing).
  const readThread=async(threadId,includeTurns)=>{
    try{return await client.request('thread/read',{threadId,includeTurns});}
    catch(error){if(classifyThreadError(error)!=='thread-not-loaded')throw error;await client.request('thread/resume',{threadId});return client.request('thread/read',{threadId,includeTurns});}
  };
  const delegationCalls=new DelegationCalls({reply:(id,result)=>client.reply(id,result),publish,...(delegations?{dispatch:(params,config)=>delegations.dispatch(resolveBinding(params.threadId),params,config),onCancel:executionId=>delegations.cancelSource(executionId)}:{})});
  connectNotifications(client,delegationCalls,threadDelegation,imageArtifacts,actions,resolveBinding,delegations,{paperAssets,chatPublishing});
  // Warm-up: the first sandboxed command provisions the Windows sandbox; do it before the first agent needs it.
  client.ready.then(()=>executorReadiness(cwd)).catch(()=>{});
  try{await client.ready}catch(error){client.close();runtime.close();throw error}
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
    const supplied=String(request.headers['x-mainsagents-bridge-token']??'');
    if(supplied.length!==token.length||!timingSafeEqual(Buffer.from(supplied),Buffer.from(token)))return json(response,403,{error:'Local bridge access denied'});
    try {
      if(imageArtifacts.handle(request,response,url))return;
      if(request.method==='POST'&&url.pathname==='/api/codex/diagnostics/read-test'){
        const input=await body(request),source=(getAgents?.()??[]).find(agent=>agent.id===input.agentId),profileId=actions?.profile();
        if(!source||!profileId)return json(response,400,{error:'Choose an existing local Codex agent.'});
        return json(response,200,await probeMcpAccounts(client,{actions,getAgents:()=>getAgents?.()??[],getProfile:()=>actions.profile(),cwd,agentId:input.agentId,server:input.server}));
      }
      if(request.method==='GET'&&url.pathname==='/api/codex/executor'){
        // ?refresh=1 forces a new sandboxed probe ("test again"); otherwise a recent success is reused.
        if(url.searchParams.get('refresh')==='1')executorReady.clear();
        const result=await executorReadiness(cwd);
        return json(response,200,{...result,desktopIsolation:{localAppDataIsolated:Boolean(runtime.isolation?.env.LOCALAPPDATA),disabledDesktopMcpServers:runtime.isolation?.desktopServers??[]}});
      }
      if(request.method==='GET'&&url.pathname==='/api/codex/diagnostics'){

        diagnostics??=diagnoseCodex(client,{cwd,agents:getAgents?.()??[],evidence:actions?.evidence()??[]}).finally(()=>{diagnostics=undefined;});
        return json(response,200,await diagnostics);
      }
      const sessionImagesMatch=url.pathname.match(/^\/api\/codex\/sessions\/([^/]+)\/images$/);
      if(request.method==='GET'&&sessionImagesMatch){
        const threadId=decodeURIComponent(sessionImagesMatch[1]);
        if(!/^[a-f0-9-]{36}$/i.test(threadId))return json(response,400,{error:'Invalid Codex thread.'});
        importLegacyCodexThread(runtime,threadId);
        const result=await readThread(threadId,true);
        const events=[];
        for(const turn of result.thread?.turns??[])for(const item of turn.items??[]){const event=imageArtifacts.fromItem(item,turn.id);if(event)events.push(event);}
        return json(response,200,{events});
      }
      if (request.method === 'GET' && url.pathname === '/api/codex/health') {
        const result = await client.request('account/read', { refreshToken: false });
        const ready = Boolean(result.account) || result.requiresOpenaiAuth === false;
        return json(response, ready ? 200 : 401, { ready, status: ready ? 'connected' : 'login-required', accountType: result.account?.type ?? null, historyMode: 'isolated', connectionsMode: 'shared' });
      }
      if (request.method === 'GET' && url.pathname === '/api/codex/usage') {
        const result = await client.request('account/rateLimits/read', {});
        return json(response, 200, { rateLimits: result.rateLimits ?? null, rateLimitsByLimitId: result.rateLimitsByLimitId ?? null, fetchedAt: new Date().toISOString() });
      }
      if (request.method === 'POST' && url.pathname === '/api/codex/login') {
        const result = await client.request('account/login/start', { type: 'chatgpt', useHostedLoginSuccessPage: true, appBrand: 'chatgpt' });
        return json(response, 200, { authUrl: result.authUrl, loginId: result.loginId });
      }
      if (request.method === 'GET' && url.pathname === '/api/codex/models') {
        const result = await client.request('model/list', { limit: 100, includeHidden: false });
        return json(response, 200, { models: (result.data ?? []).map((item) => ({ id: item.model ?? item.id, name: item.displayName ?? item.model ?? item.id, isDefault: Boolean(item.isDefault) })) });
      }
      if (request.method === 'POST' && url.pathname === '/api/codex/sessions') {
        const input = await body(request);
        const binding=getBinding?.(input.threadId,input.config?.localSessionId);
        const config = binding?{...binding.agent,agentName:binding.agentName,skills:(binding.agent.skills??[]).filter(skill=>!binding.agent.disabledSkills?.includes(skill)),modelId:input.config?.modelId}:input.config ?? {};
        if(getBinding&&!binding)return json(response,409,{error:'Save the agent and session before connecting the CLI.'});
        // Resuming names a thread this saved session owns; it never adopts another session's thread.
        const ownedThreads=[binding?.session?.remoteSessionId,binding?.session?.codexThreadId].filter(Boolean);
        if(binding&&input.threadId&&ownedThreads.length&&!ownedThreads.includes(input.threadId))return json(response,409,{error:'This Codex thread belongs to another session. Reopen the session.'});
        const skillsContext = Array.isArray(config.skills) && config.skills.length
          ? `\n\nThis agent may use only these associated skills:\n${config.skills.map(name=>`${name}: ${config.skillFiles?.[name]??config.skillsDirectory??'path not configured'}`).join('\n')}. Read the relevant skill Markdown file before using it (a standalone .md or SKILL.md). Do not use unrelated skills.`
          : '';
        const fileAccess=agentFileAccess(config,cwd);
        const skillNames=Array.isArray(config.skills)?config.skills:[];
        const skillFile=skillNames.map(name=>{try{return skillMarkdownFile(name,config.skillFiles?.[name]??config.skillsDirectory)}catch{return null}}).find(Boolean);
        const executor=await executorAtSessionStart(fileAccess.cwd,skillFile,fileAccess.sandboxPolicy);
        const executorContext=executor.state!=='failed'?'':executorUnavailableInstructions(executor,hostSkillContext(skillNames,config));
        const params = { cwd:fileAccess.cwd,historyMode:'legacy',config:{...await chatActionConfig(client),...fileAccess.config}, ...(config.modelId||process.env.MAINSAGENTS_CODEX_MODEL?{model:config.modelId||process.env.MAINSAGENTS_CODEX_MODEL}:{}), approvalPolicy: chatApprovalPolicy, sandbox:fileAccess.sandbox, developerInstructions: `You are ${config.agentName ?? 'a MainsAgents specialist'}. ${config.instructions ?? ''}${skillsContext}\n\n${fileAccess.instructions}${executorContext}\n\n${imageGenerationInstructions}`.trim(), serviceName: 'mainsagents', dynamicTools:[delegateTool,...(chatPublishing&&binding&&permittedMcpAction(binding.agent,'schedule')?[scheduleTool]:[])] };
        if (input.threadId) {
          if (activeThreadWriters.has(input.threadId)) return json(response, 409, { error: activeWriterMessage });
          importLegacyCodexThread(runtime, input.threadId);
        }
        const {dynamicTools,historyMode,...resumeParams}=params;
        const result = input.threadId ? await client.request('thread/resume', { ...resumeParams,threadId: input.threadId }) : await client.request('thread/start', params);
        if(binding)threadSessions.set(result.thread.id,binding.sessionId);
        if(!input.threadId&&params.dynamicTools.includes(scheduleTool))scheduleThreads.add(result.thread.id);
        managedThreads.add(result.thread.id);
        if (result.thread?.status?.type === 'active') return json(response, 409, { error: activeWriterMessage });
        return json(response, 200, { threadId: result.thread.id });
      }
      if (request.method === 'POST' && url.pathname === '/api/codex/executions') {
        const input = await body(request);
        const threadId = input.threadId;
        if (!threadId) return json(response, 400, { error: 'A Codex thread is required to send a message.' });
        if(!managedThreads.has(threadId)&&!workflowThreads.has(threadId))return json(response,409,{error:'Resume this session in MainsAgents before sending a message so its tool policy can be verified.',code:'thread-not-loaded'});
        if (activeThreadWriters.has(threadId)) return json(response, 409, { error: activeWriterMessage });
        const context = (input.context ?? []).map((item) => `[${item.kind}] ${item.label}${item.content ? `\n${item.content}` : ''}`).join('\n\n');
        const binding=resolveBinding(threadId);
        if(getBinding&&managedThreads.has(threadId)&&!binding)return json(response,409,{error:'The agent or active profile changed. Reopen its session.'});
        const ancestry=binding?.session.delegationAncestors??[];
        const nativeTargets=binding?.agent.tools?.includes('subagents')&&ancestry.length<2?(getAgents?.()??[]).filter(agent=>agent.workspaceId===binding.workspaceId&&agent.id!==binding.agentId&&!ancestry.includes(agent.id)).map(agent=>({id:agent.id,name:agent.name,role:agent.role})):[];
        const connection=binding?.session.agentConnection;
        const delegation=binding?{sourceAgentId:binding.agentId,workspaceId:binding.workspaceId,targets:connection?(connection.enabled?nativeTargets.filter(agent=>agent.id===connection.targetAgentId):[]):nativeTargets,connectedAgentId:connection?.enabled?connection.targetAgentId:undefined}:input.delegation;
        threadDelegation.set(threadId,delegation);
        const catalog=delegation?.targets??[];
        const delegationPrompt=catalog.length?`\n\nMainsAgents agent catalog (current workspace): ${JSON.stringify(catalog)}. Use mainsagents_delegate when this requested workflow needs one of these specialists. Send a complete briefing, approved decisions, and absolute local file paths. The tool waits and returns the specialist result. Do not substitute a built-in temporary Codex subagent for these configured agents. Do not invent approval or publish. Respect scope and limit each response to at most 4 handoffs.`:'\n\nMainsAgents delegation is disabled for this turn. Do not call mainsagents_delegate.';
        const connected=catalog.find(agent=>agent.id===delegation?.connectedAgentId);
        const connectionPrompt=connected?`\n\nThe user enabled a persistent connection to ${connected.name} (${connected.id}). Delegate relevant parts of the user's requests to this agent with mainsagents_delegate; formulate useful instructions and include the relevant context. The application reuses the connected agent's existing session. Use sessionMode: "continue" by default. Only use sessionMode: "new" when the user explicitly asks to open another session for the connected agent. Its configured role, instructions and skills remain unchanged. Answer ordinary questions directly when they do not require that specialist. Wait for its actual result before reporting completion.`:'';
        const text = `${input.content}${context?`\n\nWorkspace context:\n${context}`:''}${delegationPrompt}${connectionPrompt}${notionAutomationInstructions(binding?.agent)}${paperDesignInstructions(binding?.agent)}${paperImageInstructions(binding?.agent)}${schedulingPrompt(threadId,binding)}\n${agentFileAccess(binding?.agent,cwd).instructions}\n\nMainsAgents image delivery policy: ${imageGenerationInstructions}`;
        const lockToken = `pending-${randomBytes(12).toString('hex')}`;
        activeThreadWriters.set(threadId, lockToken);
        try {
          const stored = await client.request('thread/read', { threadId, includeTurns: false });
          if (stored.thread?.status?.type === 'active') {
            const becameIdle = await waitForExternalWriter(client, threadId);
            if (!becameIdle) {
              activeThreadWriters.delete(threadId);
              return json(response, 409, { error: 'Another Codex window is still finishing a response in this session. Wait for it to finish, then send again.' });
            }
          }
          const turnFileAccess=agentFileAccess(binding?.agent,cwd);
          const turnConfig = { threadId, cwd:turnFileAccess.cwd,input: [{ type: 'text', text }], approvalPolicy: chatApprovalPolicy, sandboxPolicy:turnFileAccess.sandboxPolicy, ...(typeof input.modelId === 'string' && input.modelId ? { model: input.modelId } : {}), ...(['low','medium','high','xhigh'].includes(input.reasoningEffort) ? { effort: input.reasoningEffort } : {}) };
          let result;
          try {
            result = await client.request('turn/start', turnConfig);
          } catch (error) {
            if (!/already has an active writer/i.test(error instanceof Error ? error.message : String(error))) throw error;
            const becameIdle = await waitForExternalWriter(client, threadId);
            if (!becameIdle) throw new Error('Another Codex window is still finishing a response in this session. Wait for it to finish, then send again.');
            result = await client.request('turn/start', turnConfig);
          }
          const executionId = result.turn.id;
          const record = recordFor(executionId, threadId);
          activeThreadWriters.set(threadId, executionId);
          if (record.done && activeThreadWriters.get(threadId) === executionId) activeThreadWriters.delete(threadId);
          return json(response, 200, { executionId, threadId });
        } catch (error) {
          if (activeThreadWriters.get(threadId) === lockToken) activeThreadWriters.delete(threadId);
          if (/already has an active writer/i.test(error instanceof Error ? error.message : String(error))) return json(response, 409, { error: activeWriterMessage });
          throw error;
        }
      }
      const eventMatch = url.pathname.match(/^\/api\/codex\/executions\/([^/]+)\/events$/);
      if (request.method === 'GET' && eventMatch) {
        const record = recordFor(decodeURIComponent(eventMatch[1]));
        response.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
        const write = (event) => response.write(`${JSON.stringify(event)}\n`);
        record.events.forEach(write);
        if (record.done) return response.end();
        record.listeners.add(write);
        request.on('close', () => record.listeners.delete(write));
        const finish = (event) => { if (event.type.startsWith('execution.') && !['execution.started'].includes(event.type)) { record.listeners.delete(finish); response.end(); } };
        record.listeners.add(finish);
        return;
      }
      const cancelMatch = url.pathname.match(/^\/api\/codex\/executions\/([^/]+)\/cancel$/);
      const delegationMatch=url.pathname.match(/^\/api\/codex\/executions\/([^/]+)\/delegations\/([^/]+)$/);
      if(request.method==='POST'&&delegationMatch){
        const result=await body(request);
        if(typeof result.content!=='string'||typeof result.success!=='boolean')return json(response,400,{error:'Invalid specialist result'});
        const resolved=delegationCalls.resolve(decodeURIComponent(delegationMatch[1]),decodeURIComponent(delegationMatch[2]),result);
        return json(response,resolved?200:409,resolved?{}:{error:'This delegation request is no longer active.'});
      }
      if (request.method === 'POST' && cancelMatch) {
        const executionId = decodeURIComponent(cancelMatch[1]);
        const record = executions.get(executionId);
        if (!record?.threadId) return json(response, 404, { error: 'Execution not found' });
        await client.request('turn/interrupt', { threadId: record.threadId, turnId: executionId });
        actions?.interrupt(executionId,'Execution canceled by the user.');
        delegationCalls.cancel(executionId);
        return json(response, 200, {});
      }
      json(response, 404, { error: 'Not found' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const writerConflict = /already has an active writer|another Codex window is still finishing/i.test(message);
      const threadCode = writerConflict ? null : classifyThreadError(error);
      if (threadCode) return json(response, threadErrorStatus[threadCode], { error: message, code: threadCode });
      json(response, writerConflict ? 409 : 500, { error: /another Codex window is still finishing/i.test(message) ? message : writerConflict ? activeWriterMessage : message });
    }
  });
  await new Promise((resolve,reject) => {server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve()})});
  const address = server.address();
  const activePort = typeof address === 'object' && address ? address.port : port;
  console.log(`[MainsAgents] Codex bridge ready on http://127.0.0.1:${activePort}`);
  // Host-only MCP access: deliberately not exposed as an unrestricted HTTP API.
  const notionTools=new Set(['notion-search','notion-fetch','notion-create-pages','notion-update-page']);
  const publicationMcp={async call(tool,args,provider='publora'){
    const allowed=provider==='publora'?['account_context','list_connections','list_posts','create_post','get_post','update_post','get_upload_url','complete_media','delete_media']:provider==='zernio'?['accounts_list_accounts','posts_list_posts']:[];if(!allowed.includes(tool))throw Error('Unsupported publishing operation.');
    const {config={}}=await client.request('config/read',{includeLayers:false});
    if(!config.mcp_servers?.[provider]||config.mcp_servers[provider].enabled===false)throw Error(`Configure and authenticate the ${provider} MCP in Codex CLI first.`);
    const clean=value=>Array.isArray(value)?value.filter(item=>item!==null).map(clean):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,item])=>item!==null).map(([key,item])=>[key,clean(item)])):value;
    const servers=Object.fromEntries(Object.entries(config.mcp_servers).map(([name,value])=>[name,{...clean(value),enabled:name===provider,...(name===provider?{enabled_tools:allowed,default_tools_approval_mode:'auto',tools:{}}:{})}]));
    const threadId=(await client.request('thread/start',{cwd,ephemeral:true,approvalPolicy:'never',sandbox:'read-only',config:{mcp_servers:servers,features:{apps:false,plugins:false,multi_agent:false}},serviceName:'mainsagents-publishing'})).thread.id;
    try{return await client.request('mcpServer/tool/call',{threadId,server:provider,tool,arguments:args});}
    finally{await client.request('thread/archive',{threadId}).catch(()=>{});}
  }};
  const notionMcp={
    async thread(){const result=await client.request('thread/start',{cwd,ephemeral:true,approvalPolicy:'never',sandbox:'read-only',serviceName:'mainsagents-editorial'});return result.thread.id;},
    inventory:threadId=>client.request('mcpServerStatus/list',{serverName:'notion',threadId,detail:'toolsAndAuthOnly',limit:100}),
    call:({threadId,tool,arguments:args})=>{
      if(!notionTools.has(tool))throw new Error('This editorial connector only supports Notion search, fetch, create and update.');
      return client.request('mcpServer/tool/call',{threadId,server:'notion',tool,arguments:args});
    },
  };
  const workflowClient={request:async(method,params)=>{const result=await client.request(method,params);if(['thread/start','thread/resume'].includes(method))workflowThreads.add(result.thread.id);return result;}};
  const runtimeRequest=async(path,input)=>{const response=await fetch(`http://127.0.0.1:${activePort}${path}`,{method:'POST',headers:{'content-type':'application/json','x-mainsagents-bridge-token':token},body:JSON.stringify(input)});const value=await response.json();if(!response.ok)throw Object.assign(new Error(value.error??'Codex runtime request failed.'),{status:response.status,...(value.code?{code:value.code}:{})});return value;};
  const runtimeEvents=async function*(executionId,signal){
      const record=executions.get(executionId);if(!record)throw new Error('This execution is not loaded. Reconcile its saved thread.');
      const queue=[...record.events];let wake;
      const listener=event=>{queue.push(event);wake?.();},abort=()=>wake?.();record.listeners.add(listener);signal?.addEventListener('abort',abort);
      try{while(true){if(signal?.aborted)throw new Error('Execution canceled.');while(queue.length){const event=queue.shift();yield event;if(['execution.completed','execution.cancelled','execution.failed'].includes(event.type))return;}if(record.done)return;await new Promise(resolve=>{wake=resolve;});wake=undefined;}}
      finally{record.listeners.delete(listener);signal?.removeEventListener('abort',abort);}
    };
  const workflow=createCodexWorkflowRuntime({client:workflowClient,cwd,request:runtimeRequest,events:runtimeEvents,imageFile:image=>imageArtifacts.pathForImage(image),imageFromItem:(item,turnId)=>imageArtifacts.fromItem(item,turnId)});
  const chatRuntime={
    connect:async(session,agent)=>{const result=await runtimeRequest('/api/codex/sessions',{...(session.codexThreadId||session.remoteSessionId?{threadId:session.codexThreadId??session.remoteSessionId}:{}),config:{localSessionId:session.id,modelId:session.modelId??agent.modelId}});return result.threadId;},
    send:(threadId,content,agent)=>runtimeRequest('/api/codex/executions',{threadId,content,modelId:agent.modelId,reasoningEffort:agent.reasoningEffort??'medium'}),events:runtimeEvents,
    readThread:async threadId=>(await readThread(threadId,true)).thread,
    cancel:(threadId,executionId)=>client.request('turn/interrupt',{threadId,turnId:executionId}),
  };
  return { port: activePort, token, notionMcp, publicationMcp, workflow,chatRuntime, isAlive:()=>!client.closed, close: async () => { actions?.close();delegationCalls.close(); await new Promise((resolve) => server.close(resolve)); await client.close(); runtime.close(); } };
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll('\\','/')}`).href) startCodexBridge().catch((error) => { console.error(error); process.exitCode = 1; });
