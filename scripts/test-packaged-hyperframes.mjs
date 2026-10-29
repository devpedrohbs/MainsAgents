// Packaged HyperFrames smoke: the editing-references backend is loaded FROM the packaged app.asar and the engine runs
// through the packaged MainsAgents.exe as its Node (exactly what process.execPath is inside the installed app).
// Isolated profile + isolated engine root; no repo node_modules, no .mainsagents-workspaces/round8-runtime, no personal data,
// no inference. Network is used only by engine.prepare (pinned npm packages and the HyperFrames Chrome).
//   npx electron scripts/test-packaged-hyperframes.mjs <release/rNN/win-unpacked> [engine root]
import {app,BrowserWindow} from 'electron';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import originalFs from 'original-fs';

const root=resolve(import.meta.dirname,'..'),packaged=resolve(root,process.argv.find(arg=>arg.includes('win-unpacked'))??'release/win-unpacked');
const exe=join(packaged,'MainsAgents.exe'),asar=join(packaged,'resources','app.asar');
const out=resolve(root,'.mainsagents-workspaces/packaged-hyperframes',String(Date.now()));mkdirSync(out,{recursive:true});
const engineHome=resolve(process.argv.slice(2).find(arg=>!arg.includes('win-unpacked')&&!arg.endsWith('.mjs'))??join(out,'engine'));
assert(!engineHome.includes('round8-runtime')&&!engineHome.startsWith(join(root,'node_modules')),'engine root must not reuse the repo runtime');
app.setPath('userData',join(out,'electron'));app.on('window-all-closed',()=>{});
const load=name=>import(pathToFileURL(join(asar,name)).href);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const until=async(check,ms,label)=>{const deadline=Date.now()+ms;while(Date.now()<deadline){const value=await check();if(value)return value;await new Promise(r=>setTimeout(r,250));}throw Error(`Timed out: ${label}`);};

let server,win,bridge;const log=[];
app.whenReady().then(async()=>{try{
 assert(existsSync(exe)&&existsSync(asar),`packaged app missing in ${packaged}`);
 const {createContentWorkflowBridge}=await load('content-workflow-bridge.mjs'),{createHyperframesEngine,engineProcess,HYPERFRAMES_VERSION}=await load('hyperframes-engine.mjs');
 // Inside the installed app the engine default is node=process.execPath (MainsAgents.exe + ELECTRON_RUN_AS_NODE).
 const engine=createHyperframesEngine({root:engineHome,node:exe});
 bridge=createContentWorkflowBridge({dbPath:join(out,'editorial.sqlite'),getCurrentProfile:()=>'packaged',editingReferenceOptions:{engine}});
 server=createServer((request,response)=>void bridge.handle(request,response,new URL(request.url,'http://127.0.0.1')).then(handled=>{if(!handled){response.writeHead(200,{'content-type':'text/html','content-security-policy':"default-src 'none'; media-src 'self'; style-src 'unsafe-inline'"});response.end(`<!doctype html><body style="margin:0;background:#121820"><video style="width:100%" muted preload="auto" src="${new URL(request.url,'http://x').searchParams.get('src')}"></video></body>`);}}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`,query='?profile=packaged&workspaceId=packaged-smoke';
 const snapshot=async()=>(await fetch(`${base}/api/content/editing-references${query}`)).json();
 const command=async body=>{const response=await fetch(`${base}/api/content/editing-references${query}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw Object.assign(Error(value.error??response.status),{status:response.status,value});return value;};

 // 1) Missing engine is reported as not-configured with the expected pinned version (never a false "ready").
 const first=await snapshot();assert.equal(first.schemaVersion,1);
 const before=first.engine.status;assert(['not-configured','ready'].includes(before),`unexpected initial engine state ${before}`);log.push(`initial engine ${before} expected ${first.engine.expectedVersion}`);
 if(before==='not-configured'){
  const blocked=await command({type:'study.create',title:'Blocked',spec:{title:'Sem motor',text:'Prepare antes',kind:'title',accent:'#22bbaa',background:'#121820',duration:2,width:640,height:360,fps:24}}).then(r=>command({type:'study.render',id:r.entityId,expectedRevision:1})).then(()=>null,error=>error);
  assert.equal(blocked?.status,422,'render must refuse before the engine is prepared');log.push('render refused before prepare (422)');
 }
 // 2) Real prepare through the packaged host: pinned npm install + Chrome ensure + version check.
 const started=Date.now();await command({type:'engine.prepare'});
 const ready=await until(async()=>{const s=await snapshot();if(s.engine.status==='error')throw Error(`prepare failed: ${s.engine.message}`);return s.engine.status==='ready'?s:null;},900000,'engine ready');
 assert.equal(ready.engine.version,HYPERFRAMES_VERSION);const installed=JSON.parse(readFileSync(join(engineHome,'node_modules/hyperframes/package.json'),'utf8')).version;assert.equal(installed,HYPERFRAMES_VERSION);
 log.push(`prepare -> ready ${ready.engine.version} in ${Math.round((Date.now()-started)/1000)}s`);
 // 3) Doctor through the packaged exe: Node, FFmpeg, FFprobe and Chrome all diagnosed.
 const doctor=JSON.parse(await engineProcess(exe,[join(engineHome,'node_modules/hyperframes/bin/hyperframes.mjs'),'doctor','--json'],{cwd:engineHome,timeoutMs:60000}));
 const checks=Object.fromEntries(['Node.js','FFmpeg','FFprobe','Chrome'].map(name=>[name,doctor.checks?.find(c=>c.name===name)?.ok===true]));
 assert(Object.values(checks).every(Boolean),`doctor: ${JSON.stringify(checks)}`);log.push(`doctor ${JSON.stringify(checks)}`);
 // 4) Missing local dependency is an actionable error, not ready (PATH without FFmpeg or Docker for the doctor only:
 //    the doctor then also writes a Docker warning to stderr, which must not hide the report).
 const systemRoot=process.env.SystemRoot??'C:/Windows',pathKey=Object.keys(process.env).find(key=>key.toLowerCase()==='path')??'Path';
 const degraded=createHyperframesEngine({root:engineHome,node:exe,run:(command,args,options)=>engineProcess(command,args,{...options,env:{[pathKey]:`${systemRoot}\\System32;${systemRoot}`}})});
 const degradedStatus=await degraded.status();assert.equal(degradedStatus.status,'error');assert.match(degradedStatus.message,/FFmpeg/);log.push(`without ffmpeg on PATH: ${degradedStatus.status} "${degradedStatus.message}"`);
 // 5) Real render of each of the four supported motion kinds through the bridge commands.
 const kinds={title:'Titulo empacotado',diagram:'Referencia | Estudo | Video',callout:'Destaque local',comparison:'Antes | Depois'},studies=[];
 for(const [kind,text] of Object.entries(kinds)){
  const created=await command({type:'study.create',title:`Packaged ${kind}`,spec:{title:`Motion ${kind}`,text,kind,accent:'#22bbaa',background:'#121820',duration:2,width:640,height:360,fps:24}});
  await command({type:'study.render',id:created.entityId,expectedRevision:1});
  const done=await until(async()=>{const study=(await snapshot()).studies.find(s=>s.id===created.entityId);if(['failed','cancelled'].includes(study.status))throw Error(`${kind}: ${study.error??study.status}`);return study.status==='completed'?study:null;},600000,`render ${kind}`);
  const video=done.artifacts.find(a=>a.kind==='video'),report=done.artifacts.find(a=>a.kind==='report');
  const reportJson=await (await fetch(`${base}/api/content/editing-references/media/study/${done.id}/${report.id}${query}`)).json();
  assert.equal(reportJson.engine,'hyperframes');assert.equal(reportJson.version,HYPERFRAMES_VERSION);assert.equal(reportJson.metadata.width,640);assert.equal(reportJson.metadata.hasAudio,false);
  studies.push({kind,id:done.id,video,report:reportJson});log.push(`render ${kind}: ${video.size} bytes sha ${video.sha256.slice(0,16)} ${reportJson.metadata.duration}s`);
 }
 // 6) Playback of the served artifact (HTTP range + Chromium decode) and a frame capture.
 const first4=studies[1],src=`/api/content/editing-references/media/study/${first4.id}/${first4.video.id}${query}`;
 const range=await fetch(`${base}${src}`,{headers:{range:'bytes=0-1023'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,1024);
 const full=Buffer.from(await (await fetch(`${base}${src}`)).arrayBuffer());assert.equal(sha(full),first4.video.sha256,'served bytes match the recorded artifact hash');
 win=new BrowserWindow({show:false,width:800,height:470,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 await win.loadURL(`${base}/player?src=${encodeURIComponent(src)}`);
 await until(()=>win.webContents.executeJavaScript('document.querySelector("video").readyState>=2'),30000,'video metadata');
 const metadata=await win.webContents.executeJavaScript('(()=>{const v=document.querySelector("video");return {width:v.videoWidth,height:v.videoHeight,duration:v.duration}})()');
 assert.equal(metadata.width,640);assert.equal(metadata.height,360);assert(Math.abs(metadata.duration-2)<.15);
 await win.webContents.executeJavaScript('document.querySelector("video").play()');await until(()=>win.webContents.executeJavaScript('document.querySelector("video").currentTime>.6'),20000,'playback progress');
 await win.webContents.executeJavaScript('new Promise(resolve=>{const v=document.querySelector("video");v.pause();v.addEventListener("seeked",()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)),{once:true});v.currentTime=1.2;})');
 writeFileSync(join(out,'playback.png'),(await win.webContents.capturePage()).toPNG());log.push(`playback ${JSON.stringify(metadata)} range 206, served sha matches`);
 writeFileSync(join(out,'proof.json'),JSON.stringify({ok:true,packaged,asarSha256:sha(originalFs.readFileSync(asar)),exe,engineHome,version:HYPERFRAMES_VERSION,doctor:checks,degraded:degradedStatus,studies:studies.map(({kind,id,video,report})=>({kind,id,mp4Sha256:video.sha256,bytes:video.size,metadata:report.metadata})),playback:metadata,log},null,1));
 console.log(log.join('\n'));console.log(`PACKAGED_HYPERFRAMES_OK ${out}`);
 win.destroy();await new Promise(r=>server.close(r));await bridge.editingReferences.close?.();app.exit(0);
}catch(error){console.error(log.join('\n'));console.error(error);win?.destroy();server?.close();await bridge?.editingReferences?.close?.();app.exit(1);}});
