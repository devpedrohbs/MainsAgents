// Packaged regression for the 0.3.61 runtime/session fixes. Runs inside Electron against app.asar:
// 1. reviewed modules are byte-identical in the asar;
// 2. real Codex CLI (command/exec only, no model turn, no tokens) with a fixture shared home that copies the
//    user's real shape: [windows] sandbox="elevated" plus Codex Desktop's node_repl MCP/notify, and a fake
//    Desktop runtime whose node_repl.exe is locked. Without isolation the sandbox must fail exactly like the
//    user saw ("setup refresh had errors"); with the packaged prepareCodexRuntimeHome it must read skills
//    outside the workspace, cut a synthetic video with FFmpeg into the authorized folder and keep other writes blocked;
// 3. the real CLI's missing-session errors are recognized by the packaged production coordinator contract.
// No personal profile, account, video, network service or AI.  Usage: npx electron scripts/test-packaged-runtime-session.mjs [release/win-unpacked]
import {app} from 'electron';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline';
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {extractFile,listPackage} from '@electron/asar';

const root=resolve(import.meta.dirname,'..'),packaged=resolve(root,process.argv.find(arg=>arg.includes('win-unpacked'))??'release/win-unpacked'),asar=join(packaged,'resources','app.asar');
const work=mkdtempSync(join(tmpdir(),'mains-packaged-runtime-'));app.setPath('userData',join(work,'electron'));
// MAINSAGENTS_TEST_SOURCE=1 debugs the same flow against the working tree (no asar checks); never a release gate.
const fromSource=process.env.MAINSAGENTS_TEST_SOURCE==='1',base=fromSource?root:asar;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),load=name=>import(pathToFileURL(join(base,name)).href);
const raw=fn=>{const previous=process.noAsar;process.noAsar=true;try{return fn();}finally{process.noAsar=previous;}};
const modules=['codex-runtime-home.mjs','codex-bridge.mjs','codex-workflow-runtime.mjs','agent-file-access.mjs','runtime-capabilities.mjs','production-coordinator.mjs','content-workflow-bridge.mjs','native-agent-delegations.mjs','codex-session-errors.mjs','codex-executor-readiness.mjs','desktop-main.mjs',...(process.env.MAINSAGENTS_EXTRA_MODULES?.split(',').filter(Boolean)??[])];
const cli=process.env.MAINSAGENTS_CODEX_CLI_PATH??join(process.env.APPDATA,'npm','node_modules','@openai','codex','bin','codex.js');
const toml=value=>`'${value}'`;

/** Same launch shape as the installed app: Electron as Node running codex.js app-server. */
function appServer({env,args=[],cwd}){
 const child=spawn(process.execPath,[cli,'app-server','--stdio',...args],{cwd,env:{...env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,stdio:['pipe','pipe','pipe']}),pending=new Map();let id=0;
 child.stderr.on('data',()=>{});
 createInterface({input:child.stdout}).on('line',line=>{let message;try{message=JSON.parse(line)}catch{return}const p=pending.get(message.id);if(p&&(message.result!==undefined||message.error)){pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(Object.assign(Error(message.error.message),{rpc:message.error})):p.resolve(message.result);}});
 const request=(method,params,timeout=60000)=>new Promise((resolve,reject)=>{const next=++id,timer=setTimeout(()=>reject(Error(`${method} timeout`)),timeout);pending.set(next,{resolve,reject,timer});child.stdin.write(JSON.stringify({id:next,method,params})+'\n');});
 return {request,async init(){await request('initialize',{clientInfo:{name:'mains-packaged-runtime',version:'test'},capabilities:{experimentalApi:true}});child.stdin.write('{"method":"initialized"}\n');},close(){child.kill();for(const p of pending.values())clearTimeout(p.timer);}};
}
// The first command of a fresh app-server may wait for sandbox provisioning (observed up to ~80 s), so the RPC waits 180 s.
const exec=(server,command,policy)=>server.request('command/exec',{command,cwd:policy.cwd,sandboxPolicy:policy.sandboxPolicy,timeoutMs:30000},180000);

app.whenReady().then(async()=>{const evidence={asar,modules:{},cli:null,steps:[]};const cleanup=[];try{
 if(fromSource)evidence.asar='SOURCE MODE (not a package check)';else{evidence.asarSha256=raw(()=>sha(readFileSync(asar)));
 const listed=new Set(raw(()=>listPackage(asar)).map(entry=>entry.replaceAll('\\','/').replace(/^\//,'')));
 for(const name of modules){assert(listed.has(name),`${name} missing from app.asar`);const hash=sha(raw(()=>extractFile(asar,name)));evidence.modules[name]=hash.slice(0,12);assert.equal(hash,sha(readFileSync(join(root,name))),`${name} differs from source`);}}
 evidence.cli=execFileSync(process.execPath,[cli,'--version'],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true}).toString().trim();

 // Fixture: shared Codex home, fake Desktop runtime (locked node_repl.exe), skills outside the workspace, output folder.
 const shared=join(work,'shared-codex'),home=join(work,'mainsagents-runtime'),fakeLocal=join(work,'fake-localappdata'),desktopBin=join(fakeLocal,'OpenAI','Codex','runtimes','cua_node','fixture','bin'),workspace=join(work,'workspace'),output=join(work,'video-output'),agentSkills=join(work,'agent-skills','editor');
 for(const dir of [shared,join(shared,'skills','shared-skill'),desktopBin,workspace,output,agentSkills])mkdirSync(dir,{recursive:true});
 const nodeExe=execFileSync('where.exe',['node'],{windowsHide:true}).toString().split(/\r?\n/)[0].trim(),repl=join(desktopBin,'node_repl.exe');copyFileSync(nodeExe,repl);
 const lock=spawn(repl,['-e','setInterval(()=>{},1e9)'],{windowsHide:true,stdio:'ignore'});cleanup.push(()=>lock.kill());
 writeFileSync(join(shared,'config.toml'),`notify = [${toml(join(desktopBin,'codex-computer-use.exe'))}, "turn-ended"]\n\n[mcp_servers.node_repl]\ncommand = ${toml(repl)}\nargs = []\n\n[mcp_servers.node_repl.env]\nNODE_REPL_NODE_PATH = ${toml(repl)}\n\n[windows]\nsandbox = "elevated"\n`);
 writeFileSync(join(shared,'skills','shared-skill','SKILL.md'),'---\nname: shared-skill\ndescription: Fixture skill\n---\n# Shared skill\nSHARED_SKILL_READ_OK\n');
 const agentSkill=join(agentSkills,'SKILL.md');writeFileSync(agentSkill,'# Editor de Vídeo\nAGENT_SKILL_READ_OK\n');
 const source=join(work,'synthetic.mp4');execFileSync('ffmpeg',['-nostdin','-v','error','-n','-f','lavfi','-i','testsrc2=size=160x90:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1.2','-c:v','libx264','-c:a','aac',source],{windowsHide:true});
 const readSkills=['powershell.exe','-NoProfile','-Command',`Get-Content -LiteralPath '${agentSkill}'; Get-Content -LiteralPath '${join(home,'skills','shared-skill','SKILL.md')}'`];

 const {prepareCodexRuntimeHome}=await load('codex-runtime-home.mjs'),{agentFileAccess}=await load('agent-file-access.mjs');
 const previousLocal=process.env.LOCALAPPDATA;process.env.LOCALAPPDATA=fakeLocal;let runtime;
 try{runtime=prepareCodexRuntimeHome({home,sharedHome:shared});}finally{process.env.LOCALAPPDATA=previousLocal;}
 cleanup.push(()=>runtime.close());
 assert(runtime.isolation,'packaged runtime home exposes no Desktop isolation');
 evidence.isolation={desktopServers:runtime.isolation.desktopServers,args:runtime.args.filter(arg=>arg!=='-c').map(arg=>arg.replace(/=.*/,'=…')),isolatedLocalAppData:runtime.env.LOCALAPPDATA!==fakeLocal};
 assert(runtime.isolation.desktopServers.includes('node_repl'),'Desktop node_repl MCP not neutralized');
 const readOnly=agentFileAccess({providerId:'codex',tools:['files']},workspace),writer=agentFileAccess({providerId:'codex',tools:['files'],fileAccess:{enabled:true,outputDirectory:output}},workspace);

 // Baseline proves the fixture reproduces the user's failure (otherwise a pass would be false readiness).
 const baseEnv={...runtime.env,LOCALAPPDATA:fakeLocal},baseline=appServer({env:baseEnv,args:['-c',`sqlite_home=${JSON.stringify(home)}`],cwd:workspace});
 try{await baseline.init();let failure='';try{const result=await exec(baseline,readSkills,readOnly);failure=JSON.stringify(result);}catch(error){failure=error.message;}
  assert.match(failure,/setup refresh had errors/,`fixture did not reproduce the locked Desktop runtime failure: ${failure.slice(0,300)}`);evidence.steps.push('baseline-reproduced:setup refresh had errors');}
 finally{baseline.close();}

 const fixed=appServer({env:runtime.env,args:runtime.args,cwd:workspace});
 try{await fixed.init();
  const {config={}}=await fixed.request('config/read',{includeLayers:false});assert.equal(config.mcp_servers?.node_repl?.enabled,false,'node_repl still enabled in the effective config');assert.deepEqual(config.notify??[],[],'Desktop notify hook still active');evidence.steps.push('effective-config:node_repl disabled, notify cleared');
  const skills=await exec(fixed,readSkills,readOnly);assert.equal(skills.exitCode,0,JSON.stringify(skills).slice(0,400));assert(skills.stdout.includes('AGENT_SKILL_READ_OK')&&skills.stdout.includes('SHARED_SKILL_READ_OK'),'skills not readable');evidence.steps.push('skills-readable:agent+shared');
  const edited=join(output,'edited.mp4'),outside=join(work,'outside.txt');
  const cut=await exec(fixed,['ffmpeg','-nostdin','-v','error','-n','-i',source,'-t','0.6','-c','copy',edited],writer);assert.equal(cut.exitCode,0,JSON.stringify(cut).slice(0,400));
  const duration=Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',edited],{windowsHide:true}).toString());assert(duration>0&&duration<1.2,`unexpected cut duration ${duration}`);
  await exec(fixed,['powershell.exe','-NoProfile','-Command',`Set-Content -LiteralPath '${outside}' -Value NOT_ALLOWED`],writer).catch(()=>{});assert(!existsSync(outside),'write outside the authorized folder was allowed');
  evidence.steps.push(`ffmpeg-cut:${duration.toFixed(2)}s inside output; outside write blocked`);
  // Real CLI texts for a session that no longer exists must hit the packaged coordinator's recovery contract.
  const {readThreadOrMissing,isMissingThreadError}=await load('codex-session-errors.mjs'),ghost='01a00000-0000-7000-8000-000000000000';
  const coordinator=fromSource?readFileSync(join(root,'production-coordinator.mjs'),'utf8'):raw(()=>extractFile(asar,'production-coordinator.mjs')).toString('utf8');
  assert(coordinator.includes("from './codex-session-errors.mjs'")&&!/invalid session id/.test(coordinator),'packaged coordinator does not use the narrow missing-session contract');
  // Real CLI: a never-persisted thread is proved missing (read -> not loaded -> resume -> no rollout); an invalid id is not.
  const read=id=>fixed.request('thread/read',{threadId:id,includeTurns:true}),resume=id=>fixed.request('thread/resume',{threadId:id,approvalPolicy:'never',sandbox:'read-only'});
  assert.deepEqual(await readThreadOrMissing(read,resume,ghost),{missing:true},'real CLI absence not recognized');
  let invalid;try{await resume('not-a-thread-id');}catch(error){invalid=error;}assert(invalid&&!isMissingThreadError(invalid),`invalid id treated as missing: ${invalid?.message}`);
  evidence.steps.push(`missing-session:real CLI absence proved; invalid id kept as error (${invalid.message.slice(0,60)})`);
 }finally{fixed.close();}

 // Real specialist handoff through the packaged bridge and delegation queue. Sessions are created/resumed by the real CLI
 // (thread/start, thread/resume: no model turn); only `send` is replaced, so no inference or tokens are used.
 {const {startCodexBridge}=await load('codex-bridge.mjs'),{createNativeAgentDelegations}=await load('native-agent-delegations.mjs'),{DatabaseSync}=await import('node:sqlite');
  const before=process.env.LOCALAPPDATA;process.env.LOCALAPPDATA=fakeLocal;let bridge;
  try{bridge=await startCodexBridge({port:0,cwd:workspace,runtimeHome:join(work,'bridge-runtime'),sharedHome:shared,imagesDirectory:join(work,'images')});}finally{process.env.LOCALAPPDATA=before;}
  const db=new DatabaseSync(':memory:'),connects=[];let sends=0,queue;
  try{
   const base={workspaceId:'space',instructions:'Fixture',skills:[],tools:['subagents','files']},source={...base,id:'content',name:'Conteúdo',role:'Writer',providerId:'codex'},editor={...base,id:'editor',name:'Editor de Vídeo',role:'Video',providerId:'codex'},claudeEditor={...editor,id:'claude-editor',name:'Editor Claude',providerId:'claude'};
   const sessions=[{id:'source-session',agentId:'content',title:'Fonte',messages:[],createdAt:'2026',updatedAt:'2026'}];
   const stub=runtime=>({...runtime,connect:async(session,agent)=>{const previous=session.codexThreadId??session.remoteSessionId,entry={agent:agent.id,previous};connects.push(entry);try{entry.id=await runtime.connect(session,agent);return entry.id;}catch(error){entry.error=error.message;throw error;}},send:async()=>({executionId:`stub-${++sends}`}),events:async function*(){yield {type:'message.completed',content:'STUB_RESULT'};yield {type:'execution.completed'};},readThread:async()=>({status:{type:'idle'},turns:[]})});
   const claudeRuntime={connect:async session=>session.remoteSessionId??randomUUID()};
   queue=createNativeAgentDelegations(db,{getCurrentProfile:()=> 'owner',getAgents:()=>[source,editor,claudeEditor],getSessions:()=>sessions,getRuntime:provider=>stub(provider==='claude'?claudeRuntime:bridge.chatRuntime)});
   const binding={profileId:'owner',sessionId:'source-session',agentId:'content'},config={targets:[{id:'editor'},{id:'claude-editor'}]};
   const ask=(target,callId,sessionMode)=>queue.dispatch(binding,{threadId:'parent',turnId:`turn-${target}-${callId==='stale'?'stale':''}`,callId,arguments:{targetAgentId:target,title:'Cortar vídeo',instructions:'Fixture handoff',files:[],...(sessionMode?{sessionMode}:{})}},config);
   for(const target of ['editor','claude-editor']){
    {const first=await ask(target,`${target}-1`);assert.equal(first.success,true,`${target}: ${first.content}`);}assert.equal((await ask(target,`${target}-2`)).success,true);assert.equal((await ask(target,`${target}-3`,'new')).success,true);
    const jobs=queue.snapshot('owner').jobs.filter(job=>job.targetAgentId===target),mine=connects.filter(item=>item.agent===target);
    assert.equal(jobs[1].targetSessionId,jobs[0].targetSessionId,`${target}: continue reuses the specialist session`);assert.notEqual(jobs[2].targetSessionId,jobs[0].targetSessionId,`${target}: new opens another session`);
    // continue asks the CLI for the SAME session; new never does. A Codex thread with no turn yet (sends are stubbed) has no
    // rollout, so the real CLI proves it absent and the queue opens a replacement BEFORE sending (one send, no duplicate).
    const resumeTry=mine.find(item=>item.previous),newTry=mine.filter(item=>!item.previous).at(-1);
    assert.equal(resumeTry?.previous,mine[0].id,`${target}: continue reuses the first CLI session ${JSON.stringify(mine)}`);assert.notEqual(newTry.id,mine[0].id,`${target}: new gets a new CLI session`);
    if(target==='editor'){assert.match(resumeTry.error??'',/no rollout found|not materialized|no persisted rollout/i,'real CLI absence text');}else assert.equal(resumeTry.id,mine[0].id,'claude keeps its remote session id');
    evidence.steps.push(`${target}:continue->${resumeTry.error?'proved absent, replaced before send':'resumed'}; new->fresh`);
   }
   // Automatic link that now points at another agent's session: a new specialist session, never a failure or a foreign reuse.
   sessions[0].agentConnection={enabled:true,targetAgentId:'editor',targetSessionId:'source-session'};
   assert.equal((await ask('editor','stale')).success,true);const stale=queue.snapshot('owner').jobs.at(-1);assert.notEqual(stale.targetSessionId,'source-session');assert.match(stale.notice??'',/new session/);
   assert.equal(sends,7,'one send per handoff, no duplicates');
   evidence.steps.push(`delegation:codex thread/start+resume real (${connects.filter(item=>item.agent==='editor').length} connects), claude ids, new/continue/stale ok, ${sends} stubbed sends`);
  }finally{await queue?.close?.().catch(()=>{});db.close();await bridge.close();}}
 console.log('PACKAGED_RUNTIME_SESSION_OK'+JSON.stringify(evidence));app.exit(0);
}catch(error){console.error(error,evidence);app.exit(1);}finally{for(const step of cleanup.reverse())try{step();}catch{}}});
