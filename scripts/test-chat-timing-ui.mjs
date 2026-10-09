// Isolated Electron chat, local streaming and approvals. No personal accounts or inference.
import {app,BrowserWindow,ipcMain} from 'electron';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {captureReadyPng} from './ui-capture-ready.mjs';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.mainsagents-workspaces/chat-timing-ui',String(Date.now()));mkdirSync(out,{recursive:true});app.setPath('userData',out);app.on('window-all-closed',()=>{});
const at=new Date().toISOString(),agent={id:'editor',name:'Timing Editor',role:'Editor',description:'Fixture',instructions:'Fixture only',workspaceId:'my-workspace',tools:[],skills:[],status:'idle',providerId:'codex',createdAt:at,updatedAt:at};
const state={agents:[agent],workspaces:[{id:'my-workspace',name:'Fixture',createdAt:at,updatedAt:at}],sessions:[],'active-sessions':{},language:'pt-BR','welcome-dismissed':true,'focus-mode':false};
const bridge=createContentWorkflowBridge({dbPath:resolve(out,'state.sqlite'),getCurrentProfile:()=> 'handoff-test',getAgents:()=>state.agents,getSessions:()=>state.sessions});
ipcMain.handle('test:read',(_e,key)=>state[key]);ipcMain.handle('test:write',(_e,key,value)=>state[key]=value);ipcMain.handle('test:all',()=>state);
let window,stream,approved=false,executing=false,turns=0;
const send=(event)=>stream?.writable&&stream.write(JSON.stringify(event)+'\n');
const json=(res,value)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value));};
const server=createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/api/codex/health')return json(res,{ready:true,status:'connected',accountType:'chatgpt'});
 if(url.pathname==='/api/codex/models')return json(res,{models:[]});
 if(url.pathname.endsWith('/images'))return json(res,{events:[]});
 if(url.pathname==='/api/codex/sessions')return json(res,{threadId:'fixture-thread'});
 if(url.pathname==='/api/codex/executions'){executing=true;turns++;return json(res,{executionId:`fixture-turn-${turns}`,threadId:'fixture-thread'});}
 if(url.pathname.endsWith('/cancel')){json(res,{});send({type:'execution.cancelled',executionId:`fixture-turn-${turns}`});stream?.end();return;}
 if(url.pathname.endsWith('/events')){res.setHeader('content-type','application/x-ndjson');stream=res;const id=`fixture-turn-${turns}`;
  if(turns===1){send({type:'tool.started',executionId:id,tool:'mcpToolCall',callId:'fetch',label:'Using notion · notion-fetch...'});
   // Many successive tool events (the noise from the screenshot) while the approval is pending.
   for(let i=0;i<12;i++)setTimeout(()=>{send({type:i%3?'tool.started':'activity',executionId:id,tool:i%2?'fileChange':'commandExecution',callId:`c${i}`,label:'Thinking…',status:'started'});send({type:i%3?'tool.finished':'activity',executionId:id,tool:i%2?'fileChange':'commandExecution',callId:`c${i}`,label:'Thinking…',status:'finished'});},80*i);}
  if(turns===2){send({type:'tool.started',executionId:id,tool:'commandExecution',callId:'x'});send({type:'message.delta',executionId:id,delta:'Parcial'});setTimeout(()=>{send({type:'execution.failed',executionId:id,code:'fixture',message:'FIXTURE_FAILURE',retryable:true});stream.end();},1300);}
  if(turns===3)send({type:'tool.started',executionId:id,tool:'commandExecution',callId:'y'});
  return;}
 if(url.pathname==='/api/content/actions')return json(res,{actions:executing?[{id:'approval',hash:'exact',sessionId:state.sessions[0]?.id,agentName:agent.name,server:'notion',tool:'notion-fetch',category:'read',arguments:{id:'collection://fixture'},status:approved?'succeeded':'pending'}]:[]});
 if(url.pathname==='/api/content/actions/approval'){approved=true;json(res,{id:'approval',status:'succeeded'});setTimeout(()=>{send({type:'tool.finished',executionId:'fixture-turn-1',tool:'mcpToolCall',callId:'fetch'});send({type:'message.completed',executionId:'fixture-turn-1',content:'FIXTURE_RESPONSE'});send({type:'execution.completed',executionId:'fixture-turn-1'});stream.end();},100);return;}
 if(await bridge.handle(req,res,url))return;
 if(url.pathname.startsWith('/api/'))return json(res,{actions:[],sessions:[],jobs:[],runs:[],handoffs:[]});
 try{const p=resolve(root,'dist',url.pathname==='/'?'app.html':url.pathname.slice(1));assert(p.startsWith(resolve(root,'dist')+sep));res.setHeader('content-type',({'.html':'text/html','.css':'text/css','.js':'application/javascript','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(p)]??'application/octet-stream');res.end(readFileSync(p));}catch{res.statusCode=404;res.end();}
});
const js=code=>window.webContents.executeJavaScript(code),errors=[];
async function until(check){const deadline=Date.now()+15000;while(Date.now()<deadline){if(await check())return;await new Promise(r=>setTimeout(r,50));}throw Error('Timing UI timed out');}
async function open(){window=new BrowserWindow({show:false,width:880,height:720,webPreferences:{preload:resolve(root,'tests/fixtures/assets-ui-preload.cjs'),contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});window.webContents.on('console-message',event=>{if(/Uncaught|Maximum update depth/.test(event.message))errors.push(event.message);});await window.loadURL(`http://127.0.0.1:${server.address().port}/app.html#agents`);await until(()=>js('Boolean(document.querySelector(\'.agent-nav[title="Timing Editor"]\'))'));await js('document.querySelector(\'.agent-nav[title="Timing Editor"]\').click()');await until(()=>js('Boolean(document.querySelector(".chat-compose textarea"))'));}
app.whenReady().then(async()=>{try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));await open();
 const ask=async text=>{await js(`(()=>{const el=document.querySelector(".chat-compose textarea");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event("input",{bubbles:true}));})()`);
  await until(()=>js('Boolean(document.querySelector(".chat-compose button[aria-label=Enviar]:not(:disabled)"))'));await js('document.querySelector(".chat-compose button[aria-label=Enviar]").click()');};
 const lines=()=>js('[...document.querySelectorAll(".chat-run-status")].map(el=>({state:el.dataset.state,text:el.querySelector(".run-status-label").textContent,time:el.querySelector("time")?.textContent}))');
 await ask('Test elapsed response');
 await until(()=>js('Boolean(document.querySelector(".chat-run-status[data-state=running]"))'));await until(()=>js('Boolean(document.querySelector(".runtime-action[data-action-status=pending]"))'));
 // While successive tool events stream in: always one line, always "Trabalhando", never a per-tool row, never a premature final state.
 const seen=new Set();for(let i=0;i<30;i++){const now=await lines();assert.equal(now.length,1);seen.add(now[0].state+':'+now[0].text);assert.equal(await js('document.querySelectorAll(".tool-activity").length'),0);await new Promise(r=>setTimeout(r,40));}
 assert.deepEqual([...seen],['running:Trabalhando']);
 assert(!/Used |commandExecution|fileChange/.test(await js('document.querySelector(".chat-body").innerText')),'tool noise must not reach the feed');
 await until(async()=>(await lines())[0].time!=='00:00');assert(!approved);
 const bounds=await js('(()=>{const dock=document.querySelector(".chat-approval-dock"),notice=document.querySelector(".runtime-approval-notice"),button=dock.querySelector(".primary-button");dock.scrollTop=dock.scrollHeight;const b=button.getBoundingClientRect(),d=dock.getBoundingClientRect();return {outside:!dock.closest(".chat-body"),notice:notice.textContent,visible:b.bottom<=d.bottom+1&&b.top>=d.top,height:innerHeight,bottom:d.bottom};})()');assert(bounds.outside);assert(bounds.visible);assert(bounds.bottom<=bounds.height);assert(bounds.notice.includes('aguardando sua aprovação'));
 await js('document.querySelector(".chat-approval-dock .primary-button").click()');await until(()=>state.sessions[0]?.responseTiming?.outcome==='completed');
 await until(async()=>(await lines())[0].text==='Finalizado');
 const final=(await lines())[0].time;await new Promise(r=>setTimeout(r,1200));assert.equal((await lines())[0].time,final,'final duration frozen');
 assert(state.sessions[0].messages.find(m=>m.content==='FIXTURE_RESPONSE').responseDurationMs>=1000);
 assert(await js('document.body.innerText.includes("FIXTURE_RESPONSE")'));
 assert(Number((await js('document.querySelector(".run-status-steps summary").textContent')).match(/\d+/)[0])>=12,'steps kept as diagnostics');
 // Failure: true status, partial reply kept, real error visible, earlier line untouched.
 await ask('Second request');await until(async()=>(await lines()).length===2&&(await lines())[1].state==='running');
 await until(async()=>(await lines())[1].state==='error');let now=await lines();assert.equal(now[1].text,'Falhou');assert.equal(now[0].time,final);
 assert(await js('document.body.innerText.includes("FIXTURE_FAILURE")'));const failedTime=now[1].time;await new Promise(r=>setTimeout(r,1100));assert.equal((await lines())[1].time,failedTime);
 // Cancellation: "Interrompido", frozen.
 await ask('Third request');await until(async()=>(await lines()).length===3&&(await lines())[2].state==='running');await new Promise(r=>setTimeout(r,1100));
 await js('document.querySelector(".send-button.stop").click()');await until(async()=>(await lines())[2].state==='interrupted');now=await lines();assert.equal(now[2].text,'Interrompido');
 const cancelledTime=now[2].time;await new Promise(r=>setTimeout(r,1100));assert.equal((await lines())[2].time,cancelledTime);
 // Reopen: same three lines, same frozen durations.
 const before=await lines();await js('window.mainsAgentsSaveNow()');window.destroy();await open();await until(async()=>(await lines()).length===3);assert.deepEqual(await lines(),before);assert.deepEqual(errors,[]);
 if(process.env.CHAT_TIMING_SHOT){await js('document.querySelector(".run-status-steps")?.removeAttribute("open")');await new Promise(r=>setTimeout(r,300));writeFileSync(process.env.CHAT_TIMING_SHOT,await captureReadyPng(window.webContents));}
 console.log('PASS: one status line per execution (no per-tool rows) through 12 successive tool events + approval wait; Finalizado/Falhou/Interrompido with frozen time; steps kept as folded diagnostics; durations restored after reopening. Local fixtures only.');window.destroy();await bridge.close();server.close();app.exit(0);
}catch(error){console.error(error);if(window&&!window.isDestroyed()){console.log(await js('document.body.innerText'));window.destroy();}stream?.end();await bridge.close();server.close();app.exit(1);}});
