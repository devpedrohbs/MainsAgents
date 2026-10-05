import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {createCodexWorkflowRuntime} from '../codex-workflow-runtime.mjs';
import {workflowExecutionSnapshot,restoreWorkflowExecution} from '../workflow-execution-backup.mjs';
import {inspectLocalAsset} from '../editorial-local-files.mjs';

const research=JSON.stringify({topics:[{title:'Useful research',category:'AI',summary:'An actual research summary with verified references.',whyItMatters:'A practical reason that matters to creators.',angles:['Explain','Demonstrate'],sources:[{title:'Source',url:'https://example.com/news'}],factualQuestions:[]}]});
const script=JSON.stringify({hooks:['One','Two','Three'],ctas:['Save','Try'],paths:[{title:'First',outline:'Show a detailed practical example in clear steps.'},{title:'Second',outline:'Start with the problem and explain the solution.'}],improvisationTopics:['Context','Demo'],thumbnailDirection:'Simple title',draftScript:'This is a complete spoken script describing a practical technology project with a clear example, an explanation of the implementation and a closing call to action.'});
const handoff=JSON.stringify({summary:'I received the approved script and prepared editing instructions.',outputFiles:[],blockers:['No video editing tool is available in this read-only session.']});
const seed=()=>({schemaVersion:1,topics:[{id:'topic',workspaceId:'space',inputKind:'text',input:'My practical project',priority:'normal',title:'My project',status:'approved',contentId:'content',summary:'Why it helps',angles:[],sources:[],factualQuestions:[]}],contents:[{id:'content',workspaceId:'space',topicId:'topic',title:'My project',format:'short-video',platforms:['Instagram'],status:'script-approved',approvedScriptArtifactId:'approved',assetIds:[]}],runs:[],artifacts:[{id:'approved',workspaceId:'space',contentId:'content',type:'script',version:1,data:{text:'The approved script'}}],approvals:[{id:'approval',artifactId:'approved',artifactVersion:1,decision:'approved'}],assets:[]});
const agents=()=>[{id:'source',name:'Content Editor',role:'Content',workspaceId:'space',providerId:'codex',instructions:'My editorial instructions',tools:['web-search','files','subagents'],skills:['my-skill'],skillFiles:{'my-skill':'C:/skills/my-skill.md'}},{id:'video',name:'Video Editor',role:'Video',workspaceId:'space',providerId:'codex',instructions:'Honest editing specialist; no computer control',tools:['files','web-search']}];
async function until(predicate){const limit=Date.now()+5000;while(Date.now()<limit){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5))}throw new Error('Local work timed out');}
function runtime(){
  const threads=new Map(),sent=[],resumed=[],canceled=[];let output=handoff,mode='complete',resolveSend;
  return {threads,sent,resumed,canceled,setOutput:value=>{output=value},setMode:value=>{mode=value},releaseSend:()=>resolveSend?.(),
    createSession:async()=>{const id=`thread-${threads.size+1}`;threads.set(id,{id,status:{type:'idle'},turns:[]});return id},
    resumeSession:async id=>{resumed.push(id)},readThread:async id=>structuredClone(threads.get(id)),
    send:async(threadId,content)=>{const id=`turn-${sent.length+1}`,turn={id,status:'inProgress',items:[{type:'userMessage',content:[{type:'text',text:content}]}]};sent.push({threadId,content,id});threads.get(threadId).turns.push(turn);threads.get(threadId).status={type:'active'};
      if(mode==='lost'){turn.status='completed';turn.items.push({type:'agentMessage',text:output});threads.get(threadId).status={type:'idle'};throw new Error('Reply receipt lost')}
      if(mode==='slow-send')await new Promise(resolve=>{resolveSend=resolve});
      return {executionId:id};},
    events:async function*(id,signal){const thread=[...threads.values()].find(thread=>thread.turns.some(turn=>turn.id===id)),turn=thread.turns.find(turn=>turn.id===id);yield {type:'message.delta',delta:output.slice(0,20)};
      if(mode==='hold'||mode==='slow-send')await new Promise((resolve,reject)=>{if(signal.aborted)reject(new Error('Interrupted'));else signal.addEventListener('abort',()=>reject(new Error('Interrupted')),{once:true})});
      turn.status='completed';turn.items.push({type:'agentMessage',text:output});thread.status={type:'idle'};yield {type:'message.completed',content:output};yield {type:'execution.completed'};},
    cancel:async(threadId,id)=>{canceled.push(id);const thread=threads.get(threadId);thread.status={type:'idle'};const turn=thread.turns.find(turn=>turn.id===id);if(turn)turn.status='interrupted'},
  };
}
function fixture({online=true,state=seed()}={}){
  const root=mkdtempSync(join(tmpdir(),'persistent-work-')),path=join(root,'state.sqlite'),rt=runtime(),configured=agents();let available=online,profile='owner';
  const options={dbPath:path,getRuntime:()=>available?rt:null,getAgents:()=>configured,getCurrentProfile:()=>profile};
  let bridge=createContentWorkflowBridge(options);const db=new DatabaseSync(path);db.prepare('INSERT INTO editorial_state VALUES (?,?,?,?)').run('owner',1,JSON.stringify(state),'today');
  return {root,path,db,rt,configured,get bridge(){return bridge},online:value=>{available=value},profile:value=>{profile=value},state:()=>JSON.parse(db.prepare('SELECT state_json FROM editorial_state WHERE profile_id=?').get('owner').state_json),
    revise:fn=>{const state=JSON.parse(db.prepare('SELECT state_json FROM editorial_state WHERE profile_id=?').get('owner').state_json);fn(state);db.prepare('UPDATE editorial_state SET state_json=?,revision=revision+1').run(JSON.stringify(state));},
    enqueue:(changes={})=>bridge.work.enqueue('owner',{kind:'handoff',targetId:'content',agentId:'video',sourceAgentId:'source',instructions:'Prepare an honest editing plan',requestKey:`request-${bridge.work.list('owner').length}`,revision:db.prepare('SELECT revision FROM editorial_state WHERE profile_id=?').get('owner').revision,...changes}),
    reopen:async()=>{await bridge.close();bridge=createContentWorkflowBridge(options);bridge.work.kick()},close:async()=>{await bridge.close();db.close()},
  };
}

test('work and its immutable inputs commit atomically; a lost enqueue receipt cannot duplicate inference',async()=>{
  const f=fixture({online:false});try{
    const receipt=f.enqueue({requestKey:'same'});assert.equal(receipt.state.runs[0].jobId,receipt.job.id);assert.equal(receipt.revision,2);
    assert.equal(f.enqueue({requestKey:'same'}).job.id,receipt.job.id);assert.throws(()=>f.enqueue({requestKey:'same',instructions:'Different'}),/different instructions/);assert.throws(()=>f.enqueue(),/already queued/);
    assert.equal(f.bridge.work.list('another-profile').length,0);assert.throws(()=>f.bridge.work.detail('another-profile',receipt.job.id),/not found/);
    f.online(true);f.bridge.work.kick();await until(()=>f.bridge.work.list('owner')[0].status==='succeeded');assert.equal(f.rt.sent.length,1);assert.equal(f.state().artifacts[0].type,'specialist-result');assert.equal(f.state().contents[0].status,'script-approved');assert.equal(f.state().assets.length,0);
  }finally{await f.close()}
});

test('research and script finish in the local worker even without any frontend subscriber',async()=>{
  const state=seed();state.topics[0].status='draft';delete state.topics[0].contentId;state.contents[0].status='draft';
  const f=fixture({state});try{
    f.rt.setOutput(research);f.enqueue({kind:'research',targetId:'topic',agentId:'source'});await until(()=>f.state().topics[0].status==='review');assert.equal(f.state().artifacts[0].type,'research');
    f.revise(state=>{state.topics[0].status='approved';state.topics[0].contentId='content'});
    f.rt.setOutput(script);f.enqueue({kind:'script',agentId:'source'});await until(()=>f.state().contents[0].status==='script-review');assert.equal(f.state().artifacts[0].type,'script-options');assert.equal(f.rt.sent.length,2);
  }finally{await f.close()}
});

test('requested script changes travel with the immutable next prompt and earlier versions stay saved',async()=>{
  const state=seed();state.contents[0].scriptOptionsArtifactId='options';state.artifacts.push({id:'options',workspaceId:'space',topicId:'topic',contentId:'content',type:'script-options',version:1,data:JSON.parse(script)});
  const f=fixture({state});try{
    const artifact=f.state().artifacts.find(item=>item.id==='options');
    f.bridge.deliveries.review('owner',{revision:1,artifactId:artifact.id,expectedArtifact:artifact,decision:'revision-requested',notes:'Shorten the introduction and keep the practical demo'});
    f.rt.setOutput(script);const result=f.enqueue({kind:'script',agentId:'source'});
    assert.match(result.job.prompt,/Shorten the introduction/);assert.match(result.job.prompt,/Previous options/);
    await until(()=>f.bridge.work.list('owner')[0].status==='succeeded');
    assert.equal(f.state().artifacts.find(item=>item.id==='options').version,1);
    assert.equal(f.state().artifacts.find(item=>item.id===f.state().contents[0].scriptOptionsArtifactId).version,2);
    assert.equal(f.state().contents[0].approvedScriptArtifactId,undefined);
  }finally{await f.close()}
});

test('approved work continues its specialist session; explicit new session keeps the configured instructions',async()=>{
  const f=fixture();try{
    f.enqueue();await until(()=>f.bridge.work.list('owner')[0].status==='succeeded');
    f.enqueue();await until(()=>f.rt.sent.length===2&&f.bridge.work.list('owner').every(job=>job.status==='succeeded'));
    assert.equal(f.rt.sent[0].threadId,f.rt.sent[1].threadId);assert.equal(f.rt.resumed.length,1);
    f.enqueue({newSession:true});await until(()=>f.rt.sent.length===3&&f.bridge.work.list('owner').every(job=>job.status==='succeeded'));assert.notEqual(f.rt.sent[2].threadId,f.rt.sent[0].threadId);
    f.configured[1].instructions='Updated specialist instructions';f.enqueue();await until(()=>f.rt.sent.length===4&&f.bridge.work.list('owner').every(job=>job.status==='succeeded'));assert.notEqual(f.rt.sent[3].threadId,f.rt.sent[0].threadId);
  }finally{await f.close()}
});

test('restart retains partial output; completed Codex turns reconcile without sending another message',async()=>{
  const f=fixture();try{
    f.rt.setMode('hold');const {job}=f.enqueue();await until(()=>f.bridge.work.detail('owner',job.id).output.length>0);await f.reopen();
    const saved=f.bridge.work.detail('owner',job.id);assert.equal(saved.status,'interrupted');assert(saved.output);assert.equal(f.rt.sent.length,1);
    const thread=f.rt.threads.get(saved.threadId),turn=thread.turns[0];turn.status='completed';turn.items.push({type:'agentMessage',text:handoff});thread.status={type:'idle'};
    await f.bridge.work.retry('owner',job.id);assert.equal(f.bridge.work.detail('owner',job.id).status,'succeeded');assert.equal(f.rt.sent.length,1);
  }finally{await f.close()}
});

test('lost turn-start receipt is found by its unique marker; active sessions never gain another writer',async()=>{
  const f=fixture();try{
    f.rt.setMode('lost');const {job}=f.enqueue();await until(()=>f.bridge.work.detail('owner',job.id).status==='interrupted');assert.equal(f.bridge.work.detail('owner',job.id).executionId,undefined);
    await f.bridge.work.retry('owner',job.id);assert.equal(f.bridge.work.detail('owner',job.id).status,'succeeded');assert.equal(f.rt.sent.length,1);
    f.rt.setMode('hold');const next=f.enqueue().job;await until(()=>f.rt.sent.length===2);await f.reopen();const saved=f.bridge.work.detail('owner',next.id),thread=f.rt.threads.get(saved.threadId);thread.status={type:'active'};thread.turns.at(-1).status='inProgress';
    await assert.rejects(f.bridge.work.retry('owner',next.id,{resend:true}),/still active/);assert.equal(f.rt.sent.length,2);
    thread.status={type:'idle'};thread.turns.at(-1).status='interrupted';await assert.rejects(f.bridge.work.retry('owner',next.id),/Explicitly confirm/);
    f.rt.setMode('complete');await f.bridge.work.retry('owner',next.id,{resend:true});await until(()=>f.bridge.work.detail('owner',next.id).status==='succeeded');assert.equal(f.rt.sent.length,3);assert(f.bridge.work.detail('owner',next.id).history[0].output);
  }finally{await f.close()}
});

test('cancel intent beats a late turn-start receipt and late completion cannot save a result',async()=>{
  const f=fixture();try{
    f.rt.setMode('slow-send');const {job}=f.enqueue();await until(()=>f.rt.sent.length===1);await f.bridge.work.cancel('owner',job.id);f.rt.releaseSend();await until(()=>f.rt.canceled.length===1);
    assert.equal(f.bridge.work.detail('owner',job.id).status,'canceled');assert.equal(f.state().runs[0].state,'canceled');assert.equal(f.state().artifacts.filter(item=>item.type==='specialist-result').length,0);
  }finally{await f.close()}
});

test('file or approved-version changes block saved briefings before inference',async()=>{
  const f=fixture({online:false});try{
    const path=join(f.root,'source.mp4');writeFileSync(path,'original-video');const file=await inspectLocalAsset(path),version={id:'version',path,sha256:file.sha256,name:file.name};f.revise(state=>state.assets.push({id:'asset',workspaceId:'space',contentId:'content',currentVersionId:'version',versions:[version]}));
    const {job}=f.enqueue({assetIds:['asset']});writeFileSync(path,'changed-video');f.online(true);f.bridge.work.kick();await until(()=>f.bridge.work.detail('owner',job.id).status==='failed');assert.equal(f.rt.sent.length,0);assert.match(f.bridge.work.detail('owner',job.id).error,/file changed/);
    writeFileSync(path,'original-video');f.revise(state=>state.artifacts[0].data.text='Changed approved text');await assert.rejects(f.bridge.work.retry('owner',job.id),/approved version changed/);
  }finally{await f.close()}
});

test('provider, collaboration, workspace and profile changes cannot silently change a queued recipient',async()=>{
  const f=fixture({online:false});try{
    f.configured[1].providerId='claude-code';assert.throws(()=>f.enqueue(),/requires a Codex/);f.configured[1].providerId='codex';f.configured[0].tools=['files'];assert.throws(()=>f.enqueue(),/Enable collaboration/);f.configured[0].tools.push('subagents');
    const {job}=f.enqueue();f.configured[1].workspaceId='other';f.online(true);f.bridge.work.kick();await until(()=>f.bridge.work.detail('owner',job.id).status==='failed');assert.equal(f.rt.sent.length,0);f.configured[1].workspaceId='space';f.profile('other');await assert.rejects(f.bridge.work.retry('owner',job.id),/another active profile/);
  }finally{await f.close()}
});

test('specialist file results verify real bytes and never certify a missing or unchanged input as output',async()=>{
  const f=fixture();try{
    f.rt.setOutput(JSON.stringify({summary:'Edited',outputFiles:[join(f.root,'missing.mp4')],blockers:[]}));const first=f.enqueue().job;await until(()=>f.bridge.work.detail('owner',first.id).status==='failed');assert.match(f.bridge.work.detail('owner',first.id).error,/Output unavailable/);assert.equal(f.state().assets.length,0);
    const outputPath=join(f.root,'actual-result.txt');writeFileSync(outputPath,'An actual detailed editing plan.');f.rt.setOutput(JSON.stringify({summary:'A text plan, not an edited video',outputFiles:[outputPath],blockers:['Video editor unavailable']}));f.enqueue();await until(()=>f.state().assets.length===1);assert.equal(f.state().assets[0].role,'output');assert.equal(f.state().contents[0].status,'script-approved');
    const asset=f.state().assets[0],alias=join(f.root,'same-bytes.txt');writeFileSync(alias,'An actual detailed editing plan.');f.rt.setOutput(JSON.stringify({summary:'Edited',outputFiles:[alias],blockers:[]}));const next=f.enqueue({assetIds:[asset.id]}).job;await until(()=>f.bridge.work.detail('owner',next.id).status==='failed');assert.match(f.bridge.work.detail('owner',next.id).error,/unchanged input bytes/);
  }finally{await f.close()}
});

test('invalid output requires explicit resend and a changed approved artifact cannot be silently substituted',async()=>{
  const f=fixture();try{
    assert.throws(()=>f.enqueue({expectedArtifactId:'old-approved-version'}),/approved version changed/);
    f.rt.setOutput('I cannot produce a JSON result.');const {job}=f.enqueue();await until(()=>f.bridge.work.detail('owner',job.id).status==='failed');await assert.rejects(f.bridge.work.retry('owner',job.id),/valid JSON/);assert.equal(f.rt.sent.length,1);
    f.rt.setOutput(handoff);await f.bridge.work.retry('owner',job.id,{resend:true});await until(()=>f.bridge.work.detail('owner',job.id).status==='succeeded');assert.equal(f.rt.sent.length,2);assert.equal(f.bridge.work.detail('owner',job.id).history[0].output,'I cannot produce a JSON result.');
  }finally{await f.close()}
});

test('pre-send failure leaves a known-unsent thread recoverable when its empty rollout was never materialized',async()=>{
  const f=fixture();try{
    const read=f.rt.readThread;let fail=true;f.rt.readThread=async id=>{if(fail)throw new Error('Pre-send connection unavailable');return read(id)};
    const {job}=f.enqueue();await until(()=>f.bridge.work.detail('owner',job.id).status==='failed');assert.equal(f.rt.sent.length,0);const first=f.bridge.work.detail('owner',job.id).threadId;
    fail=false;f.rt.resumeSession=async()=>{throw new Error('no rollout found for thread id '+first)};await f.bridge.work.retry('owner',job.id);await until(()=>f.bridge.work.detail('owner',job.id).status==='succeeded');assert.notEqual(f.bridge.work.detail('owner',job.id).threadId,first);assert.equal(f.rt.sent.length,1);
  }finally{await f.close()}
});

test('a running worker lease prevents another local worker from marking it interrupted or resending it',async()=>{
  const f=fixture();let second;try{
    f.rt.setMode('hold');const {job}=f.enqueue();await until(()=>f.rt.sent.length===1);second=createContentWorkflowBridge({dbPath:f.path,getRuntime:()=>f.rt,getAgents:()=>f.configured});second.work.kick();await new Promise(resolve=>setTimeout(resolve,50));assert.equal(second.work.detail('owner',job.id).status,'running');assert.equal(f.rt.sent.length,1);
    await second.close();second=undefined;await f.bridge.work.cancel('owner',job.id);
  }finally{await second?.close();await f.close()}
});

test('restored work includes sessions and events, requires explicit recovery, and rejects profile collisions',async()=>{
  const f=fixture({online:false});try{
    const {job}=f.enqueue();const saved=workflowExecutionSnapshot(f.db,'owner');assert.equal(saved.work.length,1);assert.equal(saved.workEvents.length,1);
    restoreWorkflowExecution(f.db,'owner',saved,'replace');assert.equal(f.bridge.work.detail('owner',job.id).status,'interrupted');f.online(true);f.bridge.work.kick();await new Promise(resolve=>setTimeout(resolve,30));assert.equal(f.rt.sent.length,0);
    assert.throws(()=>restoreWorkflowExecution(f.db,'other',saved,'merge'),/another profile/);
    await f.bridge.work.retry('owner',job.id);await until(()=>f.bridge.work.detail('owner',job.id).status==='succeeded');const done=workflowExecutionSnapshot(f.db,'owner');assert.equal(done.workSessions[0].thread_id,f.rt.sent[0].threadId);assert(done.workEvents.length>3);
  }finally{await f.close()}
});

test('workflow adapter applies read-only policy and associated skills, and inventory checks block external MCP inference',async()=>{
  const calls=[],requests=[];let tools={};const client={request:async(method,params)=>{calls.push({method,params});if(method==='config/read')return {config:{mcp_servers:{notion:{},'server.with.dots':{}}}};if(method==='thread/start')return {thread:{id:'own-thread'}};if(method==='thread/read')return {thread:{turns:[]}};if(method==='mcpServerStatus/list')return {data:[{tools}],nextCursor:null};return {}}};
  const rt=createCodexWorkflowRuntime({client,cwd:'fixture',request:async(...args)=>{requests.push(args);return {executionId:'turn'}},events:async function*(){}}),agent=agents()[0];
  await rt.createSession(agent);const params=calls.find(call=>call.method==='thread/start').params;assert.equal(params.sandbox,'read-only');assert.equal(params.config.mcp_servers.notion.enabled,false);assert.equal(params.config.mcp_servers['server.with.dots'].enabled,false);assert.equal(params.config['features.multi_agent'],false);assert.match(params.developerInstructions,/C:\/skills\/my-skill.md/);
  await rt.resumeSession('own-thread');assert.equal(calls.find(call=>call.method==='thread/resume').params.config['features.apps'],false);await rt.readThread('own-thread');assert.equal(requests.length,0);await rt.send('own-thread','Test',agent);assert.deepEqual(requests[0][1].delegation.targets,[]);
  tools={'publish':{}};await assert.rejects(rt.send('own-thread','Blocked',agent),/External tools/);assert.equal(requests.length,1);
});
