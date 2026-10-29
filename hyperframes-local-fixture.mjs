// Standalone isolated Electron proof: real local render, scoped HTTP artifact streaming and video playback.
// npx electron hyperframes-local-fixture.mjs [absolute engine root]
import {app,BrowserWindow} from 'electron';
import {DatabaseSync} from 'node:sqlite';
import {createServer} from 'node:http';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {createEditingReferences} from './editing-reference-runtime.mjs';
import {createHyperframesEngine,digest} from './hyperframes-engine.mjs';
import {captureReadyPng} from './scripts/ui-capture-ready.mjs';
const out=resolve('.mainsagents-workspaces/round8-runtime',`proof-${Date.now()}`);mkdirSync(out,{recursive:true});app.setPath('userData',join(out,'electron'));app.on('window-all-closed',()=>{});
const scope={profile:'synthetic-proof',workspaceId:'fixture'},engineRoot=resolve(process.argv[2]||'.mainsagents-workspaces/round8-runtime/engine');
let db,service,server,win;
const until=async(check,ms=60000)=>{const deadline=Date.now()+ms;while(Date.now()<deadline){const result=await check();if(result)return result;await new Promise(r=>setTimeout(r,100));}throw Error('Proof timed out');};
app.whenReady().then(async()=>{try{
 db=new DatabaseSync(join(out,'fixture.sqlite'));db.exec('CREATE TABLE editorial_state(profile_id TEXT PRIMARY KEY,revision INTEGER,state_json TEXT,updated_at TEXT)');
 service=createEditingReferences(db,{directory:join(out,'managed'),engine:createHyperframesEngine({root:engineRoot})});
 const spec={title:'Motion dentro do app',text:'Referencia | Estudo | Video',kind:'diagram',accent:'#22bbaa',background:'#121820',duration:3,width:640,height:360,fps:24};
 const created=await service.command(scope,{type:'study.create',title:'Synthetic runtime proof',spec});await service.command(scope,{type:'study.render',id:created.entityId,expectedRevision:1});
 const study=await until(async()=>{const s=await service.snapshot(scope),study=s.studies[0];if(study.status==='failed')throw Error(study.error);return study.status==='completed'?study:null;});const artifact=study.artifacts.find(a=>a.kind==='video');
 server=createServer((request,response)=>{const url=new URL(request.url,'http://localhost');if(url.pathname==='/video')void service.stream(scope,'study',study.id,artifact.id,request,response).catch(error=>{response.statusCode=500;response.end(error.message);});else{response.writeHead(200,{'content-type':'text/html','content-security-policy':"default-src 'none'; media-src 'self'; style-src 'unsafe-inline'"});response.end('<!doctype html><html><body style="margin:0;background:#121820"><video style="width:100%" muted controls preload="auto" src="/video"></video><p style="color:white">HyperFrames local playback proof</p></body></html>');}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 win=new BrowserWindow({show:false,width:800,height:500,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
 await until(()=>win.webContents.executeJavaScript('document.querySelector("video").readyState>=2'));
 const metadata=await win.webContents.executeJavaScript('(()=>{const v=document.querySelector("video");return {width:v.videoWidth,height:v.videoHeight,duration:v.duration}})()');assert.equal(metadata.width,640);assert.equal(metadata.height,360);assert.ok(Math.abs(metadata.duration-3)<.15);
 await win.webContents.executeJavaScript('document.querySelector("video").play()');await until(()=>win.webContents.executeJavaScript('document.querySelector("video").currentTime>.7'));
 await win.webContents.executeJavaScript('new Promise(resolve=>{const v=document.querySelector("video");v.pause();v.addEventListener("seeked",()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)),{once:true});v.currentTime=1.2;})');
 await writeFile(join(out,'playback.png'),await captureReadyPng(win.webContents));const file=await service.mediaFile(scope,'study',study.id,artifact.id);
 const proof={ok:true,engine:'hyperframes',version:(await service.snapshot(scope)).engine.version,studyId:study.id,revision:study.revision,artifactId:artifact.id,mp4Sha256:digest(await readFile(file.path)),mp4Bytes:file.size,metadata,played:true,renderReport:await service.mediaFile(scope,'study',study.id,study.artifacts.find(a=>a.kind==='report').id).then(f=>readFile(f.path,'utf8')).then(JSON.parse)};
 await writeFile(join(out,'proof.json'),JSON.stringify(proof,null,2));console.log(`HYPERFRAMES_REAL_RENDER_PLAYBACK_OK ${out}`);
 win.destroy();await new Promise(r=>server.close(r));await service.close();db.close();app.exit(0);
}catch(error){console.error(error);win?.destroy();server?.close();await service?.close();db?.close();app.exit(1);}});
