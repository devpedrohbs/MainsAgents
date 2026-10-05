// Isolated hidden Electron test: deterministic chat, SQLite, mock Notion, no user account.
import {app,BrowserWindow,ipcMain} from 'electron';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';

const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.mainsagents-workspaces/chat-deliveries-ui-test');mkdirSync(out,{recursive:true});
app.setPath('userData',resolve(out,`profile-${Date.now()}`));app.on('window-all-closed',()=>{});
const profile='handoff-test',workspaceId='my-workspace',at=new Date().toISOString(),dbPath=resolve(out,`test-${Date.now()}.sqlite`);
const source='12345678-1234-1234-1234-123456789abc';
const proposal={title:'Personal automation project',category:'Tech',summary:'An automation project solves a concrete daily problem.',whyItMatters:'It explains technology with a real example.',angles:['Show a demo','Explain the solution'],sources:[{title:'Reference',url:'https://example.com'}],factualQuestions:[]};
const options={hooks:['A practical project','See the automation','What I learned'],ctas:['Save it','Try it'],paths:[{title:'Explain',outline:'Explain the practical example and its value'},{title:'Story',outline:'Tell the story of building this automation'}],improvisationTopics:['Demo','Context'],thumbnailDirection:'Show the project',draftScript:'A practical project can explain how automation works. Start with the daily problem, demonstrate the solution and explain how viewers can apply the same idea to their own work.'};
const edited=options.draftScript+' EDITED_IN_CHAT';
const base={workspaceId,role:'Editor',description:'Test editor',instructions:'Follow the user request',tools:['files','subagents'],providerId:'codex',status:'idle',createdAt:at,updatedAt:at};
const state={agents:[{...base,id:'content-agent',name:'Content Editor'},{...base,id:'video-agent',name:'Video Editor',tools:['files']}],workspaces:[{id:workspaceId,name:'Test workspace',createdAt:at,updatedAt:at}],sessions:[{id:'chat-session',contentId:'content',topicId:'topic',agentId:'content-agent',title:'Project script',messages:[],createdAt:at,updatedAt:at}],'active-sessions':{'content-agent':'chat-session'},language:'pt-BR','focus-mode':false,'welcome-dismissed':true};
ipcMain.handle('test:read',(_event,key)=>state[key]);ipcMain.handle('test:write',(_event,key,value)=>{state[key]=value});ipcMain.handle('test:all',()=>state);
let writes=0,serial=0;
const bridgeOptions={dbPath,getAgents:()=>state.agents,getSessions:()=>state.sessions,getCurrentProfile:()=>profile,getConnector:()=>({upsert:async(payload,context)=>{context.authorize();writes++;return {pageId:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',url:'https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',verifiedAt:new Date().toISOString(),artifactVersion:payload.artifact.version}}})};
let bridge=createContentWorkflowBridge(bridgeOptions);
bridge.jobs.configure(profile,workspaceId,{dataSourceId:source,autoSync:true});
const seed=new DatabaseSync(dbPath);seed.prepare('INSERT INTO editorial_state VALUES (?,?,?,?)').run(profile,1,JSON.stringify({schemaVersion:1,topics:[{...proposal,id:'topic',workspaceId,status:'approved',contentId:'content',requestId:'topic',inputKind:'text',input:proposal.title,priority:'normal',createdAt:at,updatedAt:at}],contents:[{id:'content',workspaceId,topicId:'topic',title:proposal.title,format:'short-video',platforms:['LinkedIn'],status:'planning',taskId:'task',createdAt:at,updatedAt:at}],runs:[],artifacts:[],approvals:[]}),at);seed.close();
const runs=new Map(),json=(res,value)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value))};
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');if(await bridge.handle(req,res,url))return;
  let input={};if(req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;input=JSON.parse(raw||'{}')}
  if(url.pathname.endsWith('/health'))return json(res,{ready:true,status:'connected',accountType:'chatgpt'});
  if(url.pathname.endsWith('/models'))return json(res,{models:[{id:'test-model',name:'Test model'}]});
  if(url.pathname.endsWith('/usage'))return json(res,{rateLimits:null});
  if(url.pathname.endsWith('/images'))return json(res,{events:[]});
  if(url.pathname==='/api/codex/sessions')return json(res,{threadId:input.threadId??'mock-thread'});
  if(url.pathname==='/api/codex/executions'){const executionId=`turn-${++serial}`;runs.set(executionId,input);return json(res,{executionId,threadId:input.threadId})}
  const events=url.pathname.match(/\/executions\/([^/]+)\/events$/);
  if(events){const executionId=events[1];res.setHeader('content-type','application/x-ndjson');res.write(JSON.stringify({type:'message.completed',executionId,content:JSON.stringify(executionId==='turn-1'?options:{topics:[proposal]})})+'\n');setTimeout(()=>{res.end(JSON.stringify({type:'execution.completed',executionId})+'\n')},900);return}
  if(url.pathname.startsWith('/api/'))return json(res,{});
  try {const file=resolve(root,'dist',url.pathname==='/'?'app.html':url.pathname.slice(1));assert(file.startsWith(resolve(root,'dist')+sep));const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'}[extname(file)];if(mime)res.setHeader('content-type',mime);res.end(readFileSync(file))}catch{res.statusCode=404;res.end()}
});
let window;const errors=[];
const evaluate=code=>window.webContents.executeJavaScript(code);
async function until(check){const deadline=Date.now()+15000;while(Date.now()<deadline){if(await check())return;await new Promise(resolve=>setTimeout(resolve,50))}throw new Error('Chat delivery UI timed out')}
async function click(text){await until(()=>evaluate(`(()=>{const item=[...document.querySelectorAll('button,summary')].find(item=>item.textContent.trim()===${JSON.stringify(text)});return Boolean(item&&!item.disabled)})()`));await evaluate(`(()=>{const item=[...document.querySelectorAll('button,summary')].find(item=>item.textContent.trim()===${JSON.stringify(text)});item.scrollIntoView({block:'center'});item.click()})()`)}
const setText=async(selector,value)=>evaluate(`(()=>{const item=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(item,${JSON.stringify(value)});item.dispatchEvent(new Event('input',{bubbles:true}))})()`);
async function open(){window=new BrowserWindow({show:false,width:1440,height:940,webPreferences:{preload:resolve(root,'tests/fixtures/handoff-ui-preload.cjs'),contextIsolation:true,sandbox:true,backgroundThrottling:false,offscreen:true}});window.webContents.on('console-message',event=>{if(/Uncaught|Maximum update depth|Cannot update a component/.test(event.message))errors.push(event.message)});await window.loadURL(`http://127.0.0.1:${server.address().port}/app.html#agents`);await until(()=>evaluate('Boolean(document.querySelector(\'.agent-nav[title="Content Editor"]\'))'));await evaluate('document.querySelector(\'.agent-nav[title="Content Editor"]\').click()');await until(()=>evaluate('Boolean(document.querySelector(".composer textarea"))'))}
app.whenReady().then(async()=>{try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));await open();
  await setText('.composer textarea','Prepare script options for the project');await until(()=>evaluate('!document.querySelector(".send-button").disabled'));await evaluate('document.querySelector(".send-button").click()');
  await until(()=>state.sessions[0].messages.some(item=>item.deliveryState==='streaming'));
  assert.equal(await evaluate('Boolean(document.querySelector(".chat-delivery"))'),false,'Partial response must not be approvable');
  await until(()=>evaluate('Boolean(document.querySelector(".chat-delivery"))'));assert.equal(writes,0);
  await click('Salvar entrega');await click('Salvar nova versão');await until(()=>evaluate('document.querySelector(".chat-delivery").textContent.includes("Versão 1")'));
  assert.equal(writes,0);await click('Revisar e aprovar');await until(()=>evaluate('Boolean(document.querySelector(".delivery-notion-choice input:not(:disabled)"))'));
  await setText('.delivery-script',edited);await evaluate('document.querySelector(".delivery-notion-choice input").click()');
  await click('Aprovar e enviar ao Notion');await until(()=>evaluate('document.body.textContent.includes("Card confirmado no Notion.")'));assert.equal(writes,1);
  await click('Aprovar e enviar ao Notion');await until(()=>evaluate('!document.querySelector(".delivery-review-footer > .primary-button").disabled'));assert.equal(writes,1);assert.equal(bridge.jobs.list(profile).length,1);
  const reviewGeometry=await evaluate('(()=>{const dialog=document.querySelector(".flow-dialog").getBoundingClientRect(),button=document.querySelector(".delivery-review-footer button").getBoundingClientRect();return {bottom:button.bottom,dialogBottom:dialog.bottom,height:innerHeight}})()');assert(reviewGeometry.bottom<=reviewGeometry.dialogBottom&&reviewGeometry.bottom<=reviewGeometry.height);
  writeFileSync(resolve(out,'chat-review.png'),(await window.webContents.capturePage()).toPNG());
  await evaluate('document.querySelector(".flow-dialog header button").click()');await click('Trabalho persistente');await click('Enviar ao especialista');
  await setText('[aria-label="Briefing ao especialista"]','Review the approved script and explain which video inputs are missing.');await click('Enviar trabalho');
  await until(()=>bridge.work.list(profile).length===1);const jobId=bridge.work.list(profile)[0].id;assert.equal(bridge.work.list(profile)[0].agent.id,'video-agent');assert.equal(bridge.work.list(profile)[0].sourceAgent.id,'content-agent');
  await evaluate('window.mainsAgentsSaveNow()');window.destroy();await bridge.close();bridge=createContentWorkflowBridge(bridgeOptions);await open();
  await until(()=>evaluate('document.querySelector(".chat-delivery")?.textContent.includes("Aprovada")'));assert.equal(writes,1);assert.equal(bridge.work.list(profile)[0].id,jobId);
  await click('Ver aprovação');await until(()=>evaluate('document.querySelector(".delivery-script")?.value.includes("EDITED_IN_CHAT")'));await evaluate('document.querySelector(".flow-dialog header button").click()');
  await evaluate('document.querySelector(".conversation-expand").click()');window.setSize(880,720);await new Promise(resolve=>setTimeout(resolve,200));
  const geometry=await evaluate('(()=>{const input=document.querySelector(".composer textarea").getBoundingClientRect();const body=document.querySelector(".chat-body").getBoundingClientRect();return {inputBottom:input.bottom,bodyBottom:body.bottom,height:innerHeight,scroll:document.documentElement.scrollWidth-innerWidth}})()');assert(geometry.inputBottom<=geometry.height);assert(geometry.bodyBottom<=geometry.inputBottom);assert(geometry.scroll<=1);
  await evaluate('document.documentElement.dataset.appearance="dark"');await new Promise(resolve=>setTimeout(resolve,200));writeFileSync(resolve(out,'chat-delivery-dark-compact.png'),(await window.webContents.capturePage()).toPNG());
  await evaluate('document.documentElement.dataset.appearance="light"');await new Promise(resolve=>setTimeout(resolve,200));writeFileSync(resolve(out,'chat-delivery-light-compact.png'),(await window.webContents.capturePage()).toPNG());
  await setText('.composer textarea','Research a new project');await until(()=>evaluate('!document.querySelector(".send-button").disabled'));await evaluate('document.querySelector(".send-button").click()');await until(()=>evaluate('document.querySelectorAll(".chat-delivery").length===2'));await click('Salvar entrega');await until(()=>evaluate('document.querySelectorAll(".chat-delivery")[1].textContent.includes("Versão 1")'));await evaluate('[...document.querySelectorAll(".chat-delivery")[1].querySelectorAll("button")].find(button=>button.textContent.trim()==="Abrir no Estúdio").click()');await until(()=>evaluate('Boolean(document.querySelector(".editorial-workspace"))||document.body.textContent.includes("Decidir pauta")'));
  const verify=new DatabaseSync(dbPath,{readOnly:true});const editorial=JSON.parse(verify.prepare('SELECT state_json FROM editorial_state WHERE profile_id=?').get(profile).state_json);verify.close();assert.equal(editorial.topics.filter(item=>item.status==='review').length,1);
  assert.deepEqual(errors,[]);writeFileSync(resolve(out,'result.json'),JSON.stringify({passed:true,streamGuard:true,persistedDelivery:true,editedApproval:true,notionWrites:writes,deduplicated:true,durableHandoff:true,restart:true,responsive:true,researchCapture:true}));
  console.log('PASS chat deliveries: streaming guard, saved version, edited approval, one mock Notion card, durable transfer, restart, fixed composer at 880px. No AI tokens or remote writes.');
  window.destroy();await bridge.close();server.close();app.exit(0);
}catch(error){console.error(error);if(window&&!window.isDestroyed()){console.log(await evaluate('document.body.innerText'));writeFileSync(resolve(out,'failure.png'),(await window.webContents.capturePage()).toPNG());window.destroy()}await bridge.close();server.close();app.exit(1)}});
