// Isolated Electron chat, local streaming and approvals. No personal accounts or inference.
import {app,BrowserWindow,ipcMain} from 'electron';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.mainsagents-workspaces/chat-timing-ui',String(Date.now()));mkdirSync(out,{recursive:true});app.setPath('userData',out);app.on('window-all-closed',()=>{});
const at=new Date().toISOString(),agent={id:'editor',name:'Timing Editor',role:'Editor',description:'Fixture',instructions:'Fixture only',workspaceId:'my-workspace',tools:[],skills:[],status:'idle',providerId:'codex',createdAt:at,updatedAt:at};
const state={agents:[agent],workspaces:[{id:'my-workspace',name:'Fixture',createdAt:at,updatedAt:at}],sessions:[],'active-sessions':{},language:'pt-BR','welcome-dismissed':true,'focus-mode':false};
const bridge=createContentWorkflowBridge({dbPath:resolve(out,'state.sqlite'),getCurrentProfile:()=> 'handoff-test',getAgents:()=>state.agents,getSessions:()=>state.sessions});
ipcMain.handle('test:read',(_e,key)=>state[key]);ipcMain.handle('test:write',(_e,key,value)=>state[key]=value);ipcMain.handle('test:all',()=>state);
let window,stream,approved=false,executing=false;
const json=(res,value)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value));};
const server=createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/api/codex/health')return json(res,{ready:true,status:'connected',accountType:'chatgpt'});
 if(url.pathname==='/api/codex/models')return json(res,{models:[]});
 if(url.pathname.endsWith('/images'))return json(res,{events:[]});
 if(url.pathname==='/api/codex/sessions')return json(res,{threadId:'fixture-thread'});
 if(url.pathname==='/api/codex/executions'){executing=true;return json(res,{executionId:'fixture-turn',threadId:'fixture-thread'});}
 if(url.pathname.endsWith('/events')){res.setHeader('content-type','application/x-ndjson');stream=res;res.write(JSON.stringify({type:'tool.started',executionId:'fixture-turn',tool:'mcpToolCall',callId:'fetch',label:'Using notion · notion-fetch...'})+'\n');return;}
 if(url.pathname==='/api/content/actions')return json(res,{actions:executing?[{id:'approval',hash:'exact',sessionId:state.sessions[0]?.id,agentName:agent.name,server:'notion',tool:'notion-fetch',category:'read',arguments:{id:'collection://fixture'},status:approved?'succeeded':'pending'}]:[]});
 if(url.pathname==='/api/content/actions/approval'){approved=true;json(res,{id:'approval',status:'succeeded'});setTimeout(()=>{stream.write(JSON.stringify({type:'tool.finished',executionId:'fixture-turn',tool:'mcpToolCall',callId:'fetch'})+'\n');stream.write(JSON.stringify({type:'message.completed',executionId:'fixture-turn',content:'FIXTURE_RESPONSE'})+'\n');stream.end(JSON.stringify({type:'execution.completed',executionId:'fixture-turn'})+'\n');},100);return;}
 if(await bridge.handle(req,res,url))return;
 if(url.pathname.startsWith('/api/'))return json(res,{actions:[],sessions:[],jobs:[],runs:[],handoffs:[]});
 try{const p=resolve(root,'dist',url.pathname==='/'?'app.html':url.pathname.slice(1));assert(p.startsWith(resolve(root,'dist')+sep));res.setHeader('content-type',({'.html':'text/html','.css':'text/css','.js':'application/javascript','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(p)]??'application/octet-stream');res.end(readFileSync(p));}catch{res.statusCode=404;res.end();}
});
const js=code=>window.webContents.executeJavaScript(code),errors=[];
async function until(check){const deadline=Date.now()+15000;while(Date.now()<deadline){if(await check())return;await new Promise(r=>setTimeout(r,50));}throw Error('Timing UI timed out');}
async function open(){window=new BrowserWindow({show:false,width:880,height:720,webPreferences:{preload:resolve(root,'tests/fixtures/assets-ui-preload.cjs'),contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});window.webContents.on('console-message',event=>{if(/Uncaught|Maximum update depth/.test(event.message))errors.push(event.message);});await window.loadURL(`http://127.0.0.1:${server.address().port}/app.html#agents`);await until(()=>js('Boolean(document.querySelector(\'.agent-nav[title="Timing Editor"]\'))'));await js('document.querySelector(\'.agent-nav[title="Timing Editor"]\').click()');await until(()=>js('Boolean(document.querySelector(".chat-compose textarea"))'));}
app.whenReady().then(async()=>{try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));await open();
 await js('(()=>{const el=document.querySelector(".chat-compose textarea");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(el,"Test elapsed response");el.dispatchEvent(new Event("input",{bubbles:true}));})()');
 await until(()=>js('Boolean(document.querySelector(".chat-compose button[aria-label=Enviar]:not(:disabled)"))'));await js('document.querySelector(".chat-compose button[aria-label=Enviar]").click()');
 await until(()=>js('Boolean(document.querySelector(".chat-response-timer[data-running=true]"))'));await until(()=>js('Boolean(document.querySelector(".runtime-action[data-action-status=pending]"))'));
 await until(()=>js('document.querySelector(".chat-response-timer time").textContent!=="00:00"'));assert(!approved);
 const bounds=await js('(()=>{const dock=document.querySelector(".chat-approval-dock"),notice=document.querySelector(".runtime-approval-notice"),button=dock.querySelector(".primary-button");dock.scrollTop=dock.scrollHeight;const b=button.getBoundingClientRect(),d=dock.getBoundingClientRect();return {outside:!dock.closest(".chat-body"),notice:notice.textContent,visible:b.bottom<=d.bottom+1&&b.top>=d.top,height:innerHeight,bottom:d.bottom};})()');assert(bounds.outside);assert(bounds.visible);assert(bounds.bottom<=bounds.height);assert(bounds.notice.includes('aguardando sua aprovação'));
 await js('document.querySelector(".chat-approval-dock .primary-button").click()');await until(()=>state.sessions[0]?.responseTiming?.outcome==='completed');await until(()=>js('document.querySelector(".chat-response-timer")?.textContent.includes("Concluído em")'));
 const final=await js('document.querySelector(".chat-response-timer time").textContent');await new Promise(r=>setTimeout(r,1200));assert.equal(await js('document.querySelector(".chat-response-timer time").textContent'),final);assert(state.sessions[0].messages.find(m=>m.content==='FIXTURE_RESPONSE').responseDurationMs>=1000);
 await js('window.mainsAgentsSaveNow()');window.destroy();await open();assert.equal(await js('document.querySelector(".chat-response-timer time").textContent'),final);assert.deepEqual(errors,[]);
 console.log('PASS: elapsed time while awaiting approval, visible dock at 880px, exact approval required, timer freezes, duration saved after reopening. Local fixtures only.');window.destroy();await bridge.close();server.close();app.exit(0);
}catch(error){console.error(error);if(window&&!window.isDestroyed()){console.log(await js('document.body.innerText'));window.destroy();}stream?.end();await bridge.close();server.close();app.exit(1);}});
