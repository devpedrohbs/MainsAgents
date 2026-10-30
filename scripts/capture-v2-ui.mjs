// V2 visual check: renders every V2 page with synthetic data and saves screenshots. No personal storage, CLI or network.
// Run after `npm run build`: npx electron scripts/capture-v2-ui.mjs   (V2_DIST=<dir> serves another build; V2_PAGES=home,inbox limits pages)
import {app,BrowserWindow,ipcMain} from 'electron';
import {createServer} from 'node:http';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,sep,extname} from 'node:path';
import assert from 'node:assert/strict';
import {captureReadyPng} from './ui-capture-ready.mjs';
const root=resolve(import.meta.dirname,'..'),dist=resolve(process.env.V2_DIST||resolve(root,'dist')),out=resolve(root,'.mainsagents-workspaces/v2-ui',String(Date.now()));
mkdirSync(out,{recursive:true});app.setPath('userData',resolve(out,'profile'));
const now=Date.now(),iso=offset=>new Date(now-offset*60_000).toISOString(),space='ws-main';
const agent=(id,name,role,providerId='codex')=>({id,name,role,description:role,providerId,modelId:providerId==='claude'?'claude-sonnet-5-5':'gpt-5',workspaceId:space,status:'idle',skills:[],tools:[],createdAt:iso(9000),updatedAt:iso(60)});
const agents=[agent('a-ro','Roteirista','Roteiro e pauta','claude'),agent('a-ed','Editor de vídeo','Edição de vídeo'),agent('a-dc','Designer de capa','Capas e miniaturas'),agent('a-pb','Publicador','Publicação e agenda','claude')];
const msg=(id,role,content,ago)=>({id,type:'message',role,content,createdAt:iso(ago),deliveryState:'completed'});
const act=(id,label,start,end)=>({id,type:'activity',label,status:'done',startedAt:iso(start),endedAt:iso(end)});
const thread=id=>[msg(id+'m1','user','Corta as pausas longas do começo e deixa a legenda no estilo da última entrega.',40),msg(id+'m2','agent','Vou fazer em três passos: cortar as pausas acima de 1,2 s, aplicar o preset de legenda e gerar uma prévia 9:16 para você revisar.',38),act(id+'a1','whisper.transcribe',37,34),act(id+'a2','ffmpeg.silencedetect',34,33),act(id+'a3','plano de cortes',33,32),msg(id+'m3','agent','Encontrei 10 trechos para cortar. O vídeo cai de 12:48 para 10:56.',30)];
const session=(id,agentId,title,contentId,updated)=>({id,agentId,title,messages:thread(id),createdAt:iso(600),updatedAt:iso(updated),contentId,topicId:`t-${contentId}`});
const state={workspaces:[{id:space,name:'Mains Studio',createdAt:iso(9000),updatedAt:iso(9000)}],'current-workspace':space,agents,sessions:[session('s1','a-ro','Roteiro · Excel','c1',30),session('s2','a-ed','Edição · Excel','c1',8),session('s3','a-dc','Capas · Power BI','c2',120),session('s4','a-pb','Publicação · LinkedIn','c3',1500)],'active-sessions':{},language:process.env.V2_LANG||'pt-BR','welcome-dismissed':true,'focus-mode':false,
 'usage-ledger':Array.from({length:30},(_,i)=>({id:`u${i}`,at:iso(i*300+5),provider:i%2?'codex':'claude',agentId:agents[i%4].id,workspaceId:space,sessionId:'s1',tokens:{input:4000+i*120,output:900+i*30},costUsd:i%2?undefined:0.04+i*0.002}))};
const topic=(id,title,status,contentId)=>({id,requestId:id,workspaceId:space,inputKind:'text',input:title,category:'Excel',priority:'normal',status,title,summary:'Resumo.',whyItMatters:'Contexto.',angles:[],sources:[],factualQuestions:[],contentId,createdAt:iso(3000),updatedAt:iso(200)});
const content=(id,title,productionStage,status,updated)=>({id,workspaceId:space,topicId:`t-${id}`,title,format:'short-video',platforms:['YouTube'],status,productionStage,taskId:'',assetIds:[],createdAt:iso(3000),updatedAt:iso(updated)});
const pub=(id,contentId,platform,status,plannedIn)=>({id,contentId,workspaceId:space,version:1,status,platform,text:'Texto',media:[],timeZone:'America/Sao_Paulo',plannedAt:new Date(now+plannedIn*3600_000).toISOString(),createdAt:iso(400),updatedAt:iso(90),history:[]});
let revision=1,editorial={schemaVersion:1,runs:[],artifacts:[],approvals:[],assets:[],
 topics:[topic('t-c1','Tutorial de automação no Excel','approved','c1'),topic('t-c2','Carrossel · 5 erros no Power BI','approved','c2'),topic('t-c3','LinkedIn · automação de relatórios','approved','c3'),topic('t-new','Copilot no Excel vale a pena?','review')],
 contents:[content('c1','Tutorial de automação no Excel','editing','planning',8),content('c2','Carrossel · 5 erros no Power BI','package','planning',120),content('c3','LinkedIn · automação de relatórios','ready','planning',1500),content('c4','Reels · atalhos do VS Code','recording','planning',300)],
 publications:[pub('p1','c3','LinkedIn','in-review',20),pub('p2','c2','Instagram','in-review',44),pub('p3','c1','YouTube','in-review',70)]};
const ref=(a)=>({id:a.id,name:a.name,providerId:a.providerId,modelId:a.modelId});
const run=(id,contentId,name,stage,events,extra={})=>({id,revision:3,epoch:1,workspaceId:space,contentId,topicId:`t-${contentId}`,flowId:'flow-1',name,stage,sourceAgent:ref(agents[0]),editorAgent:ref(agents[1]),publisherAgent:ref(agents[3]),sourceSession:{id:'s1',agentId:'a-ro'},editorSession:{id:'s2',agentId:'a-ed'},topic:{title:name},timeZone:'America/Sao_Paulo',events,updatedAt:events.at(-1)?.at??iso(1),...extra});
const ev=(action,minutesAgo,detail='')=>({action,detail,at:iso(minutesAgo)});
const call=(id,stage,start,dur,status='completed',tokens=12000)=>({id,key:`${stage}:turn`,stage,attempt:1,status,at:iso(start),updatedAt:iso(start-dur),usage:{version:1,status:'reported',provider:'claude',model:'claude-sonnet-5-5',tokens:{input:tokens,output:Math.round(tokens/5)},reportedCostUsd:tokens/200000,durationMs:dur*60_000}});
const productions=[
 run('run-0284','c1','Tutorial de automação no Excel','video-review',[ev('idea-approved',58),ev('writing',58),ev('script-review',52),ev('notion',40),ev('recording',38),ev('planning-edit',30),ev('editing',26),ev('video-review',8)],{budget:{version:1,legacy:false,measuredSince:iso(60),maxCalls:40,maxAttemptsPerStep:3,calls:[call('k1','writing',58,5),call('k2','planning-edit',30,3),call('k3','editing',26,14,'completed',30000)]}}),
 run('run-0281','c2','Carrossel · 5 erros no Power BI','generating-cover',[ev('idea-approved',400),ev('writing',400),ev('script-review',380),ev('recording',300),ev('planning-edit',250),ev('editing',240),ev('video-review',200),ev('platforms',150),ev('preparing-package',140),ev('generating-cover',125)],{scriptMode:'local'}),
 run('run-0280','c4','YouTube · fórmulas dinâmicas','blocked',[ev('idea-approved',900),ev('writing',900),ev('script-review',880),ev('notion',860),ev('recording',850),ev('planning-edit',100),ev('editing',90),ev('blocked',41,'Sessão do YouTube expirou')],{error:'youtube.upload → 401 Unauthorized. A sessão expirou; o vídeo final está salvo.',resumeStage:'editing'}),
 run('run-0276','c3','LinkedIn · automação de relatórios','complete',[ev('idea-approved',3000),ev('writing',3000),ev('script-review',2900),ev('platforms',2000),ev('schedule',1600),ev('scheduling',1550),ev('complete',1500)]),
];
state['production-flows']={schemaVersion:1,flows:[{id:'flow-1',workspaceId:space,name:'Produção semanal',nodes:[{id:'b1',kind:'content-agent',title:'Agente de conteúdo',position:{x:0,y:0},agentId:'a-ro'},{id:'b2',kind:'video-input',title:'Vídeos',position:{x:1,y:0}},{id:'b3',kind:'video-agent',title:'Editor',position:{x:2,y:0},agentId:'a-ed'},{id:'b4',kind:'publishing-agent',title:'Publicar',position:{x:3,y:0},agentId:'a-pb'}],edges:[],createdAt:iso(9000),updatedAt:iso(4000)}],activeByWorkspace:{[space]:'flow-1'}};
ipcMain.handle('test:read',(_event,key)=>state[key]);ipcMain.handle('test:write',(_event,key,value)=>{state[key]=value});ipcMain.handle('test:all',()=>state);
const json=(response,payload)=>{response.setHeader('content-type','application/json');response.end(JSON.stringify(payload))};
const server=createServer(async(request,response)=>{
 const url=new URL(request.url,'http://localhost');
 if(url.pathname==='/api/content/state'){if(request.method==='PUT'){let text='';for await(const chunk of request)text+=chunk;editorial=JSON.parse(text).state;revision++;}return json(response,{revision,state:editorial});}
 if(url.pathname==='/api/content/productions')return json(response,{productions});
 if(url.pathname.startsWith('/api/'))return json(response,url.pathname.endsWith('/work')?{jobs:[],mediaJobs:[],worker:{running:false}}:url.pathname.endsWith('/jobs')?{jobs:[]}:url.pathname.endsWith('/models')?{models:[]}:url.pathname.endsWith('/calendar')?{sources:[]}:url.pathname.endsWith('/delegations')?{jobs:[],sessions:[],handoffs:[]}:url.pathname.endsWith('/actions')?{actions:[]}:{ready:false,events:[],version:'test'});
 try{const file=resolve(dist,url.pathname==='/'?'app.html':url.pathname.slice(1));assert(file.startsWith(dist+sep));response.setHeader('content-type',({'.html':'text/html','.css':'text/css','.js':'application/javascript','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(file)]??'application/octet-stream');response.end(readFileSync(file))}catch{response.statusCode=404;response.end()}
});
let win;const errors=[];
const js=code=>win.webContents.executeJavaScript(code);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label){const end=Date.now()+10000;while(Date.now()<end){if(await check())return;await wait(50)}throw Error(`timed out: ${label}`)}
async function shot(name){await wait(250);writeFileSync(resolve(out,`${name}.png`),await captureReadyPng(win.webContents));console.log('shot',name)}
const pages=(process.env.V2_PAGES||'home,inbox,runs,run,pipelines,content,calendar,radar,references,board,canvas,agents,sessions,scopes,usage,settings').split(',');
app.whenReady().then(async()=>{try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 win=new BrowserWindow({show:false,width:Number(process.env.V2_WIDTH||1440),height:900,webPreferences:{preload:resolve(root,'tests/fixtures/assets-ui-preload.cjs'),contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});
 win.webContents.on('console-message',event=>{if(/Uncaught|Maximum update depth|Cannot update a component|Error/.test(event.message))errors.push(event.message)});
 await win.loadURL(`http://127.0.0.1:${server.address().port}/app.html#home`);
 await until(()=>js('Boolean(document.querySelector(".v2-sidebar"))'),'shell');
 if(process.env.V2_THEME==='light')await js('document.documentElement.dataset.appearance="light"');
 for(const page of pages){
  if(page==='run'){await js('location.hash="runs"');await until(()=>js('Boolean(document.querySelector("[data-run-id]"))'),'runs list');await js('document.querySelector("button[data-run-id]")?.click()');await until(()=>js('Boolean(document.querySelector(".v2-run"))'),'run detail');await shot('run');await js('document.querySelector(".v2-crumbs a")?.click()');continue}
  if(page==='calendar'){await js('document.querySelector("[data-od-id=nav-calendar]").click()');await wait(500);await shot('calendar');continue}
  if(page==='scope'){await js('location.hash="scopes"');await wait(500);await js('document.querySelector(".scope-card:not(.scope-card-new)")?.click()');await wait(500);await shot('scope');continue}
  if(page==='agent'){await js('location.hash="agents"');await wait(500);await js('document.querySelector(".specialist-tile .specialist-open")?.click()');await wait(400);await js('[...document.querySelectorAll(".studio-detail-tabs button")].at(-1)?.click()');await wait(300);await shot('agent');continue}
  if(page==='content'){await js('document.querySelector("[data-od-id=nav-content]").click()');await wait(500);await shot('content');continue}
  await js(`location.hash=${JSON.stringify(page)}`);await wait(600);await shot(page);
 }
 console.log(JSON.stringify({out,errors:errors.slice(0,10)}));
}catch(error){console.error(error);try{await shot('failure')}catch{}process.exitCode=1}finally{server.close();app.quit()}});
