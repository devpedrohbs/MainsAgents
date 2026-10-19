// Real Codex CLI executor probe (A, 2026-10-11). Uses only app-server `command/exec`, `thread/read` and
// `thread/resume` on random ids: no thread is started, no model turn runs, no tokens are spent.
// Compares the CLI launched WITHOUT the Desktop runtime isolation (control) against the launch the app uses
// (prepareCodexRuntimeHome). Writes only uniquely named scratch files inside the authorized folder and removes them.
// Usage: node scripts/codex-executor-real-probe.mjs --skill <skill.md> --authorized <folder> [--home <runtime home>] [--mode control|isolated|both]
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {existsSync,rmSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {codexLaunch} from '../codex-bridge.mjs';
import {prepareCodexRuntimeHome,standaloneCodexEnvironment} from '../codex-runtime-home.mjs';
import {sandboxSetupDiagnosis,classifyThreadError} from '../codex-executor-readiness.mjs';

const arg=name=>{const index=process.argv.indexOf(`--${name}`);return index>0?process.argv[index+1]:undefined;};
const home=resolve(arg('home')??join(process.env.APPDATA,'mains-agents','codex-runtime'));
const skill=arg('skill'),authorized=arg('authorized')&&resolve(arg('authorized')),mode=arg('mode')??'both';
if(!skill||!existsSync(skill)||!authorized||!statSync(authorized).isDirectory())throw new Error('Pass an existing --skill file and --authorized folder.');
const tag=randomBytes(4).toString('hex'),outside=join(homedir(),'Documents',`mainsagents-probe-outside-${tag}.txt`);
const scratch=join(authorized,`.mainsagents-probe-${tag}.txt`),source=join(authorized,`.mainsagents-probe-${tag}-src.mp4`),cut=join(authorized,`.mainsagents-probe-${tag}-cut.mp4`);
const cli=process.env.MAINSAGENTS_CODEX_CLI_PATH??null;

function client(env,args){
  const launch=codexLaunch({cliPath:cli});
  const child=spawn(launch.command,[...launch.args,...args],{cwd:authorized,stdio:['pipe','pipe','pipe'],windowsHide:true,env});
  const pending=new Map();let next=1;
  createInterface({input:child.stdout}).on('line',line=>{let message;try{message=JSON.parse(line);}catch{return;}const entry=pending.get(message.id);if(!entry||(message.result===undefined&&message.error===undefined))return;pending.delete(message.id);message.error?entry.reject(Object.assign(new Error(message.error.message??'request failed'),{rpc:message.error})):entry.resolve(message.result);});
  child.stderr.on('data',()=>{});
  const request=(method,params,timeout=90000)=>new Promise((resolve,reject)=>{const id=next++;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`${method} timed out`));},timeout);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});child.stdin.write(`${JSON.stringify({method,id,params})}\n`);});
  return {launch,request,notify:(method,params)=>child.stdin.write(`${JSON.stringify({method,params})}\n`),close:()=>new Promise(r=>{child.once('exit',r);child.kill();setTimeout(r,3000);})};
}

const ps=script=>['powershell.exe','-NoProfile','-NonInteractive','-Command',script];
const readOnly={type:'readOnly'},write={type:'workspaceWrite',writableRoots:[authorized],networkAccess:false,excludeTmpdirEnvVar:true,excludeSlashTmp:true};
async function exec(c,command,sandboxPolicy,env={}){
  try{const r=await c.request('command/exec',{command,cwd:authorized,env,sandboxPolicy,timeoutMs:60000});return {exitCode:r.exitCode,stdout:String(r.stdout??'').trim().slice(0,300),stderr:String(r.stderr??'').trim().slice(0,300)};}
  catch(error){return {rejected:error.message};}
}

async function run(label,env,args){
  const c=client(env,args),results={label,cli:c.launch.cli};
  try{
    const init=await c.request('initialize',{clientInfo:{name:'mainsagents-probe',title:'MainsAgents probe',version:'0.3.61'},capabilities:{experimentalApi:true}});
    c.notify('initialized',{});results.userAgent=init.userAgent;
    const check=async(name,command,policy,expect,penv)=>{const started=Date.now();const r=await exec(c,command,policy,penv);const ok=expect(r);results[name]={ok,ms:Date.now()-started,...r};return ok;};
    await check('skillRead',ps('[Console]::Out.Write((Get-Content -Raw -LiteralPath $env:PROBE_SKILL).Length)'),readOnly,r=>r.exitCode===0&&Number(r.stdout)>0,{PROBE_SKILL:skill});
    await check('commandLocalAppData',ps('[Console]::Out.Write($env:LOCALAPPDATA)'),readOnly,r=>r.exitCode===0&&r.stdout.toLowerCase()===String(process.env.LOCALAPPDATA).toLowerCase());
    await check('scratchWriteRead',ps(`Set-Content -LiteralPath '${scratch}' -Value 'probe-${tag}' -NoNewline; [Console]::Out.Write((Get-Content -Raw -LiteralPath '${scratch}'))`),write,r=>r.exitCode===0&&r.stdout===`probe-${tag}`);
    await check('outsideWriteBlocked',ps(`Set-Content -LiteralPath '${outside}' -Value x`),write,r=>!existsSync(outside));
    await check('networkBlocked',ps("try{(Invoke-WebRequest -UseBasicParsing -TimeoutSec 8 https://example.com).StatusCode}catch{[Console]::Out.Write('blocked: '+$_.Exception.GetType().Name);exit 7}"),write,r=>r.exitCode!==0&&!/^200$/.test(r.stdout??''));
    await check('ffmpegSyntheticCut',ps(`ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc=size=160x120:rate=10 -f lavfi -i sine=frequency=440 -t 2 -shortest -y '${source}'; if($LASTEXITCODE){exit $LASTEXITCODE}; ffmpeg -hide_banner -loglevel error -ss 0.5 -i '${source}' -t 1 -c:v libx264 -c:a aac -y '${cut}'; if($LASTEXITCODE){exit $LASTEXITCODE}; [Console]::Out.Write((ffprobe -v error -show_entries format=duration -of csv=p=0 '${cut}'))`),write,r=>r.exitCode===0&&Math.abs(Number(r.stdout)-1)<0.2);
    // Real CLI wording for missing/invalid threads, classified by the bridge contract.
    for(const [name,method,threadId] of [['resumeUnknown','thread/resume',randomUUID()],['readUnknown','thread/read',randomUUID()],['resumeInvalidId','thread/resume','not-a-thread-id']]){
      try{await c.request(method,{threadId,...(method==='thread/read'?{includeTurns:false}:{})});results[name]={unexpected:'succeeded'};}
      catch(error){results[name]={message:error.message.slice(0,200),code:classifyThreadError(error)};}
    }
  }catch(error){results.fatal=error.message;}
  finally{await c.close();}
  const diagnosis=sandboxSetupDiagnosis(home);if(diagnosis)results.sandboxDiagnosis=diagnosis.summary;
  return results;
}

const output=[];
try{
  if(mode!=='isolated'){
    // Control: the 0.3.60 launch (environment cleanup only, no Desktop runtime isolation).
    const env={...standaloneCodexEnvironment(),CODEX_HOME:home,CODEX_SQLITE_HOME:home};
    output.push(await run('control-without-isolation',env,['-c',`sqlite_home=${JSON.stringify(home)}`]));
  }
  if(mode!=='control'){
    const runtime=prepareCodexRuntimeHome({home,sharedHome:join(homedir(),'.codex')});
    try{output.push({...(await run('isolated-app-launch',runtime.env,runtime.args)),isolation:{localAppDataIsolated:Boolean(runtime.isolation.env.LOCALAPPDATA),disabledDesktopMcpServers:runtime.isolation.desktopServers,args:runtime.isolation.args.filter(item=>item!=='-c').map(item=>item.replace(/=.*/,'=…'))}});}
    finally{runtime.close();}
  }
}finally{for(const file of [scratch,source,cut,outside])rmSync(file,{force:true});}
console.log(JSON.stringify(output,null,1));
