import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sandboxSetupDiagnosis,probeCodexExecutor,hostSkillContext,skillMarkdownFile,executorUnavailableInstructions} from '../codex-executor-readiness.mjs';
import {startCodexBridge} from '../codex-bridge.mjs';

const locked='C:\\Users\\me\\AppData\\Local\\OpenAI\\Codex\\runtimes\\cua_node\\abc\\bin\\node_repl.exe';
const incidentLog=[
 '[2026-10-10 14:59:40.957 codex.exe] setup refresh: spawning codex-windows-sandbox-setup.exe',
 `[2026-10-10T17:59:41.369109600+00:00] runtime read/execute validation failed: validate runtime read/execute access on ${locked}: open ACL target for root-only update: The process cannot access the file because it is being used by another process. (os error 32)`,
 `[2026-10-10T17:59:41.370948500+00:00] setup refresh: processed 0 write roots (read roots delegated); errors=["runtime read/execute validation failed: validate runtime read/execute access on ${locked.replaceAll('\\','\\\\')}: open ACL target (os error 32)"]`,
 '[2026-10-10T17:59:41.522662100+00:00] setup error: setup refresh had errors',
].join('\r\n');
const fixture=t=>{const root=mkdtempSync(join(tmpdir(),'mains-executor-'));t.after(()=>rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100}));return root;};
const recordIncident=home=>{mkdirSync(join(home,'.sandbox'),{recursive:true});writeFileSync(join(home,'.sandbox','setup_error.json'),JSON.stringify({code:'helper_unknown_error',message:'setup refresh had errors'}));writeFileSync(join(home,'.sandbox','sandbox.2026-10-10.log'),incidentLog);};

test('the recorded sandbox setup failure is explained with the locked runtime file, not a generic helper error',t=>{
 const home=fixture(t);
 assert.equal(sandboxSetupDiagnosis(home),null);
 recordIncident(home);
 const diagnosis=sandboxSetupDiagnosis(home);
 assert.equal(diagnosis.code,'helper_unknown_error');
 assert.equal(diagnosis.path,locked);
 assert.equal(diagnosis.osError,32);
 assert.match(diagnosis.summary,/in use by another process \(os error 32\)/);
});

test('executor probe uses one read-only command/exec with the file path in the environment, never a thread or turn',async t=>{
 const home=fixture(t),calls=[];
 const ok={request:async(method,params)=>{calls.push({method,params});return {exitCode:0,stdout:'12',stderr:''};}};
 assert.deepEqual(Object.keys(await probeCodexExecutor(ok,{home,cwd:home,file:"C:\\Skills\\a'b\\SKILL.md",platform:'win32'})).sort(),['checkedAt','ready','state']);
 assert.deepEqual(calls.map(call=>call.method),['command/exec']);
 assert.deepEqual(calls[0].params.sandboxPolicy,{type:'readOnly'});
 assert.equal(calls[0].params.env.MAINSAGENTS_PROBE_FILE,"C:\\Skills\\a'b\\SKILL.md");
 assert(!calls[0].params.command.join(' ').includes("a'b"));
 recordIncident(home);
 const failing={request:async()=>{throw new Error('exec failed: windows sandbox: helper_unknown_error: setup refresh had errors');}};
 const result=await probeCodexExecutor(failing,{home,cwd:home,platform:'win32'});
 assert.equal(result.ready,false);
 assert.match(result.error,/setup refresh had errors/);
 assert.equal(result.diagnosis.path,locked);
});

test('skill fallback reads only host-configured Markdown, bounded, and lists what it could not attach',t=>{
 const root=fixture(t),folder=join(root,'mainsagent-edicao-video'),standalone=join(root,'contexto.md');
 mkdirSync(folder);writeFileSync(join(folder,'SKILL.md'),'# Edicao\nPasso 1');writeFileSync(standalone,'x'.repeat(100));writeFileSync(join(root,'notes.txt'),'not a skill');
 assert.equal(skillMarkdownFile('mainsagent-edicao-video',folder),join(folder,'SKILL.md'));
 assert.equal(skillMarkdownFile('notes',join(root,'notes.txt')),null);
 assert.equal(skillMarkdownFile('relative','skills/x.md'),null);
 const context=hostSkillContext(['mainsagent-edicao-video','contexto','missing'],{skillFiles:{'mainsagent-edicao-video':folder,contexto:standalone}},{maxBytes:40});
 assert.match(context.text,/# Edicao\nPasso 1/);
 assert.match(context.text,/Truncated by MainsAgents: 60 more characters/);
 assert.deepEqual(context.missing,['missing']);
 const instructions=executorUnavailableInstructions({ready:false,error:'raw',diagnosis:{summary:'locked node_repl.exe'}},context);
 assert.match(instructions,/locked node_repl\.exe/);
 assert.match(instructions,/Do not substitute node_repl/);
 assert.match(instructions,/Unavailable skill files: missing/);
});

test('a broken executor is reported at session start and the agent receives its skill from the host',async t=>{
 const root=fixture(t),shared=join(root,'shared'),runtimeHome=join(root,'runtime'),cli=join(root,'fake-codex.mjs'),log=join(root,'requests.jsonl'),skill=join(root,'skill');
 mkdirSync(shared);mkdirSync(skill);writeFileSync(join(skill,'SKILL.md'),'# Editor skill\nUse ffprobe first.');recordIncident(runtimeHome);
 writeFileSync(cli,`import{createInterface}from'node:readline';import{appendFileSync}from'node:fs';const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;appendFileSync(${JSON.stringify(log)},JSON.stringify({method:m.method,params:m.params})+'\\n');if(m.method==='command/exec')return send({id:m.id,error:{message:'exec failed: windows sandbox: helper_unknown_error: setup refresh had errors'}});let result={};if(m.method==='thread/start')result={thread:{id:'00000000-0000-0000-0000-0000000000aa',status:{type:'idle'}}};if(m.method==='config/read')result={config:{}};send({id:m.id,result});});`);
 const previous=process.env.MAINSAGENTS_CODEX_CLI_PATH;process.env.MAINSAGENTS_CODEX_CLI_PATH=cli;
 let bridge;
 try{
  bridge=await startCodexBridge({port:0,cwd:root,runtimeHome,sharedHome:shared});
  const base=`http://127.0.0.1:${bridge.port}`,headers={'x-mainsagents-bridge-token':bridge.token,'content-type':'application/json'};
  const started=await fetch(`${base}/api/codex/sessions`,{method:'POST',headers,body:JSON.stringify({config:{agentName:'Editor',skills:['editor'],skillFiles:{editor:skill}}})});
  assert.equal(started.status,200);
  const requests=readFileSync(log,'utf8').trim().split('\n').map(JSON.parse);
  const thread=requests.find(request=>request.method==='thread/start');
  assert.match(thread.params.developerInstructions,/node_repl\.exe is in use by another process \(os error 32\)/);
  assert.match(thread.params.developerInstructions,/# Editor skill\nUse ffprobe first\./);
  assert(!requests.some(request=>request.method==='turn/start'));
  const status=await (await fetch(`${base}/api/codex/executor?refresh=1`,{headers})).json();
  assert.equal(status.ready,false);
  assert.equal(status.diagnosis.osError,32);
 }finally{if(bridge)await bridge.close();if(previous===undefined)delete process.env.MAINSAGENTS_CODEX_CLI_PATH;else process.env.MAINSAGENTS_CODEX_CLI_PATH=previous;}
});
