import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,realpath,stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {probeVideo,runMediaProcess} from './editorial-media.mjs';

export const HYPERFRAMES_VERSION='0.8.212';
export const GSAP_VERSION='3.14.2';
export const digest=value=>createHash('sha256').update(value).digest('hex');
export const engineRoot=()=>resolve(process.env.MAINSAGENTS_HYPERFRAMES_HOME||join(homedir(),'.mainsagents','engines',`hyperframes-${HYPERFRAMES_VERSION}`));
export async function safeFile(root,file){const base=await realpath(root),target=await realpath(resolve(root,file)),rel=relative(base,target);if(rel.startsWith('..')||isAbsolute(rel)||!rel)throw Error('File escaped its managed root');return target;}
export function engineProcess(command,args,{cwd,signal,timeoutMs=300_000,onOutput,env={}}={}){
 return new Promise((resolvePromise,reject)=>{
  if(signal?.aborted)return reject(Error('Operation cancelled'));
  let output='',settled=false;
  const child=spawn(command,args,{cwd,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,ELECTRON_RUN_AS_NODE:'1',DO_NOT_TRACK:'1',HF_TELEMETRY_DISABLED:'1',...env}});
  const stop=()=>{if(process.platform==='win32')spawn('taskkill.exe',['/pid',String(child.pid),'/t','/f'],{windowsHide:true,stdio:'ignore',shell:false});else child.kill('SIGTERM');};
  const timer=setTimeout(()=>{stop();finish(Error('Engine operation timed out'));},timeoutMs);
  const abort=()=>{stop();};signal?.addEventListener('abort',abort,{once:true});
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolvePromise(value);};
  for(const stream of [child.stdout,child.stderr]){stream?.on('data',data=>{output=(output+data.toString()).slice(-24000);onOutput?.(output);});stream?.on('error',error=>{stop();finish(Error(`Engine process I/O failed: ${error.code??'unknown'}`));});}
  child.on('error',()=>finish(Error('Engine executable unavailable')));
  child.on('close',code=>finish(signal?.aborted?Error('Operation cancelled'):code!==0?Error(`HyperFrames exited ${code}: ${output.slice(-2500)}`):null,output));
 });
}
const text=(v,max)=>{if(typeof v!=='string'||v.length>max)throw Error('Invalid motion text');return v;};
export function motionSpec(raw){
 const s={title:text(raw?.title,160),text:text(raw?.text,1200),kind:raw?.kind,accent:raw?.accent,background:raw?.background,duration:raw?.duration,width:raw?.width,height:raw?.height,fps:raw?.fps};
 if(!['title','diagram','callout','comparison'].includes(s.kind)||![s.accent,s.background].every(v=>/^#[0-9a-f]{6}$/i.test(v)))throw Error('Invalid motion kind or color');
 if(!Number.isFinite(s.duration)||s.duration<1||s.duration>30||![s.width,s.height].every(v=>Number.isInteger(v)&&v>=240&&v<=1920)||![24,25,30,60].includes(s.fps))throw Error('Motion duration/format outside supported range');
 return s;
}
const escape=value=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/** Only bounded data enters this trusted template. Arbitrary HTML/JS/URLs are never accepted. */
export function compositionHtml(spec,gsap){
 const s=motionSpec(spec),parts=s.text.split(/\n|\|/).filter(Boolean).slice(0,4);
 const boxes=s.kind==='diagram'||s.kind==='comparison'?parts.map((t,i)=>`<div class="item" id="item${i}">${escape(t)}</div>`).join(''):`<div class="subtitle">${escape(s.text)}</div>`;
 return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'"><style>*{box-sizing:border-box}html,body{margin:0;background:${s.background};overflow:hidden}#stage{position:relative;width:${s.width}px;height:${s.height}px;color:#ffffff;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center}#content{width:84%;text-align:center}h1{font-size:${Math.round(s.width/13)}px;margin:0 0 24px;color:${s.accent};line-height:1.1}.subtitle{font-size:${Math.round(s.width/24)}px;white-space:pre-wrap}.items{display:flex;gap:18px;justify-content:center}.item{font-size:${Math.round(s.width/28)}px;border:3px solid ${s.accent};padding:18px;border-radius:12px;flex:1}#line{height:6px;background:${s.accent};width:60%;margin:24px auto}</style></head><body><div id="stage" data-composition-id="motion" data-start="0" data-duration="${s.duration}" data-width="${s.width}" data-height="${s.height}" data-fps="${s.fps}"><div id="content" class="clip" data-start="0" data-duration="${s.duration}" data-track-index="0"><h1 id="title">${escape(s.title)}</h1><div id="line"></div><div class="items">${boxes}</div></div></div><script>${gsap}</script><script>const tl=gsap.timeline({paused:true});tl.from('#title',{y:30,opacity:0,duration:.6,ease:'power2.out'},0).from('#line',{scaleX:0,duration:.6,ease:'power2.out'},.2).from('.item,.subtitle',{y:24,opacity:0,duration:.5,stagger:.18,ease:'power2.out'},.6).to('#content',{opacity:0,duration:.3},${Math.max(1,s.duration-.3)});window.__timelines={motion:tl};</script></body></html>`;
}
// The run output interleaves stderr (e.g. "'docker' is not recognized" on machines without Docker); keep only the JSON report.
export const doctorReport=output=>JSON.parse(output.slice(output.indexOf('{'),output.lastIndexOf('}')+1));
export function createHyperframesEngine({root=engineRoot(),node=process.execPath,ffprobe='ffprobe',run=engineProcess}={}){
 const cli=join(root,'node_modules','hyperframes','bin','hyperframes.mjs');let preparing,checked,checking;
 const status=async()=>{
  if(preparing)return {status:'preparing',version:null,expectedVersion:HYPERFRAMES_VERSION};
  try{const p=JSON.parse(await readFile(join(root,'node_modules/hyperframes/package.json'),'utf8'));if(p.version!==HYPERFRAMES_VERSION)return {status:'incompatible',version:p.version,expectedVersion:HYPERFRAMES_VERSION};await stat(join(root,'node_modules/gsap/dist/gsap.min.js'));
   if(!checked||Date.now()-checked.at>30000){
    checking??=(async()=>{try{const doctor=doctorReport(await run(node,[cli,'doctor','--json'],{cwd:root,timeoutMs:30000}));checked={at:Date.now(),missing:['Node.js','FFmpeg','FFprobe','Chrome'].filter(name=>!doctor.checks?.some(c=>c.name===name&&c.ok))};}catch{checked={at:Date.now(),missing:['engine diagnostics unavailable']};}})().finally(()=>{checking=undefined;});
    await checking;
   }
   return {status:checked.missing.length?'error':'ready',version:p.version,expectedVersion:HYPERFRAMES_VERSION,...(checked.missing.length?{message:`Missing local dependencies: ${checked.missing.join(', ')}`}:{})};}catch{return {status:'not-configured',version:null,expectedVersion:HYPERFRAMES_VERSION};}
 };
 return {root,status,
  async prepare({signal,onProgress}={}){
   if(preparing)throw Error('Engine preparation already running');
   const job=(async()=>{await mkdir(root,{recursive:true});onProgress?.('Installing pinned local engine');
    // npm CLI resolved without a shell; do not launch .cmd or interpolate arguments.
    const candidates=[process.env.npm_execpath,join(process.env.ProgramFiles||'C:/Program Files','nodejs/node_modules/npm/bin/npm-cli.js'),join(process.env.APPDATA||'','npm/node_modules/npm/bin/npm-cli.js')];
    const npm=candidates.find(p=>p&&existsSync(p));if(!npm)throw Error('Node/npm is required to prepare the local engine');
    await run(node,[npm,'install','--prefix',root,'--save-exact',`hyperframes@${HYPERFRAMES_VERSION}`,`gsap@${GSAP_VERSION}`,'--ignore-scripts','--no-audit','--no-fund'],{signal,timeoutMs:600000});
    onProgress?.('Preparing local Chrome');await run(node,[cli,'browser','ensure'],{signal,cwd:root,timeoutMs:600000});
    onProgress?.('Verifying engine');await run(node,[cli,'--version'],{signal,cwd:root});checked=undefined;
   })();preparing=job;try{await job;}finally{preparing=undefined;}return status();
  },
  async render(directory,spec,{signal,onProgress}={}){
   if((await status()).status!=='ready')throw Error('Prepare the local HyperFrames engine first');
   const s=motionSpec(spec);await mkdir(directory,{recursive:true});
   const gsap=await readFile(await safeFile(root,'node_modules/gsap/dist/gsap.min.js'),'utf8');
   const html=compositionHtml(s,gsap);await writeFile(join(directory,'index.html'),html,{flag:'wx'});
   await writeFile(join(directory,'spec.json'),JSON.stringify(s,null,2),{flag:'wx'});
   onProgress?.('Rendering HyperFrames frames');
   await run(node,[cli,'render',directory,'--output',join(directory,'preview.mp4'),'--quality','draft','--workers','1','--no-browser-gpu','--json'],{cwd:directory,signal,timeoutMs:600000});
   onProgress?.('Verifying encoded video');const metadata=await probeVideo(join(directory,'preview.mp4'),{ffprobe,signal});
   if(Math.abs(metadata.duration-s.duration)>.15||metadata.width!==s.width||metadata.height!==s.height)throw Error('HyperFrames output does not match the requested composition');
   if(metadata.hasAudio)throw Error('Motion-only study unexpectedly contained audio');
   const report={engine:'hyperframes',version:HYPERFRAMES_VERSION,spec:s,metadata,sourceSha256:digest(html),verifiedAt:new Date().toISOString()};
   await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));
   return report;
  },
 };
}
