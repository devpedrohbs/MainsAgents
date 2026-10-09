// Real renderer (dist) + real coordinator/SQLite/bridge. Simulated Codex runtime and Notion connector; no personal accounts, AI, Notion or publishing.
import {app,BrowserWindow,ipcMain} from 'electron';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,extname,sep,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {createDesktopStateStore} from '../desktop-state-store.mjs';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {registerEditorialFilesIpc} from '../editorial-files-ipc.mjs';
import {inspectLocalAsset} from '../editorial-local-files.mjs';
import {captureReadyPng} from './ui-capture-ready.mjs';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.mainsagents-workspaces/production-preflight-ui',String(Date.now()));mkdirSync(out,{recursive:true});app.setPath('userData',resolve(out,'electron'));app.on('window-all-closed',()=>{});
const profile='handoff-test',workspaceId='space',at=new Date().toISOString(),dbPath=join(out,'workspace-state.sqlite'),inspect=path=>inspectLocalAsset(path,{stabilityMs:0});
const base={description:'Fixture',skills:[],workspaceId,tools:['files'],status:'idle',createdAt:at,updatedAt:at};
const source={...base,id:'source',name:'Editor de Conteúdo',role:'Conteúdo',instructions:'Fixture',providerId:'codex'},editor={...base,id:'editor',name:'Editor de Vídeo',role:'Vídeo',instructions:'Fixture',providerId:'codex'},claude={...base,id:'claude-editor',name:'Editor Claude',role:'Vídeo',instructions:'Fixture',providerId:'claude'};
const makeFlow=(id,name,videoAgent)=>({id,workspaceId,name,nodes:[{id:`${id}-content`,kind:'content-agent',title:'Agente de conteúdo',agentId:'source',position:{x:80,y:140}},{id:`${id}-input`,kind:'video-input',title:'Vídeos da gravação',position:{x:430,y:140}},{id:`${id}-editor`,kind:'video-agent',title:'Editor de vídeo',agentId:videoAgent,position:{x:780,y:140}},{id:`${id}-publish`,kind:'publishing-agent',title:'Preparar publicação',agentId:'source',position:{x:1130,y:140}}],edges:[],createdAt:at,updatedAt:at});
const okFlow=makeFlow('ok-flow','Fluxo Codex completo','editor'),claudeFlow=makeFlow('claude-flow','Fluxo com vídeo no Claude','claude-editor');
const topic={id:'topic',workspaceId,requestId:'idea',inputKind:'text',input:'Automation',priority:'normal',status:'review',title:'Minha ideia de automação',category:'Tech',summary:'Uma demonstração prática de automação.',whyItMatters:'Explica como economizar tempo no dia a dia.',angles:['Demo'],sources:[{title:'Referência',url:'https://example.com'}],factualQuestions:[],createdAt:at,updatedAt:at};
const store=createDesktopStateStore(out,'test');store.initialize(profile,{agents:[source,editor,claude],workspaces:[{id:workspaceId,name:'Content',createdAt:at,updatedAt:at}],sessions:[],'current-workspace':workspaceId,'active-sessions':{},language:'pt-BR','welcome-dismissed':true,'focus-mode':false,'production-flows':{schemaVersion:1,flows:[okFlow,claudeFlow],activeByWorkspace:{[workspaceId]:okFlow.id}}});
ipcMain.handle('test:read',(_e,key)=>store.read(profile,key));ipcMain.handle('test:write',(_e,key,value)=>store.write(profile,key,value));ipcMain.handle('test:all',()=>store.readAll(profile));
// Any call below means the preflight started AI, Notion or publishing: counted and asserted to stay at zero.
const effects={ai:0,notion:0,publish:0},preflightCalls=[];let win;
const runtime={createSession:async()=>{effects.ai++;return 'thread'},resumeSession:async()=>{effects.ai++},readThread:async()=>{effects.ai++;return {turns:[]}},cancel:async()=>{},imageFile:()=>null,send:async()=>{effects.ai++;throw Error('AI must not run in this test')}};
const bridge=createContentWorkflowBridge({getChatRuntime:()=>null,getProviderStatus:async()=>({state:'not-installed'}),dbPath,getCurrentProfile:()=>profile,getAgents:()=>store.read(profile,'agents'),getFlows:()=>store.read(profile,'production-flows'),getSessions:()=>store.read(profile,'sessions'),getRuntime:()=>runtime,inspect,mediaOptions:{inspect},getPublicationConnector:()=>{effects.publish++;throw Error('Publishing must not run in this test')},getConnector:()=>({upsert:async()=>{effects.notion++;throw Error('Notion must not run in this test')},readCard:async()=>{effects.notion++;throw Error('Notion must not run in this test')}})});
const realPreflight=bridge.production.preflight.bind(bridge.production);let hold=null;bridge.production.preflight=async(profileId,input,options)=>{preflightCalls.push({probeMedia:Boolean(options?.probeMedia)});if(hold)await hold.promise;return realPreflight(profileId,input,options)};
const seed=new DatabaseSync(dbPath);seed.prepare('INSERT INTO editorial_state VALUES(?,?,?,?)').run(profile,1,JSON.stringify({schemaVersion:1,topics:[topic],contents:[],artifacts:[],approvals:[],runs:[],assets:[],publications:[]}),at);seed.close();bridge.jobs.configure(profile,workspaceId,{dataSourceId:'12345678-1234-1234-1234-123456789abc',autoSync:true});
registerEditorialFilesIpc({ipcMain,dialog:{showOpenDialog:async()=>({canceled:true,filePaths:[]})},shell:{openPath:async()=>''},getWindow:()=>win,getStore:()=>store});
const json=(response,value)=>{response.setHeader('content-type','application/json');response.end(JSON.stringify(value))};
const server=createServer(async(request,response)=>{const url=new URL(request.url,'http://localhost');
 if(await bridge.handle(request,response,url))return;
 if(url.pathname.endsWith('/health'))return json(response,{ready:true,accountType:'chatgpt'});if(url.pathname.endsWith('/models'))return json(response,{models:[]});if(url.pathname.startsWith('/api/'))return json(response,{});
 try{const file=resolve(root,'dist',url.pathname==='/'?'app.html':url.pathname.slice(1));assert(file.startsWith(resolve(root,'dist')+sep));response.setHeader('content-type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(file)]??'application/octet-stream');response.end(readFileSync(file))}catch{response.statusCode=404;response.end()}});
const errors=[],js=code=>win.webContents.executeJavaScript(code);
async function until(check,label='condition'){const end=Date.now()+20000;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,40))}throw Error(`Preflight UI timed out: ${label}`)}
const q=selector=>JSON.stringify(selector);
async function click(selector){await until(()=>js(`Boolean(document.querySelector(${q(selector)})&&!document.querySelector(${q(selector)}).disabled)`),selector);await js(`document.querySelector(${q(selector)}).click()`)}
const labelOf=`el=>(el.querySelector('.select-menu-option-copy b')?.textContent??el.textContent).trim()`;
async function button(text){await until(()=>js(`Array.from(document.querySelectorAll('button')).some(el=>(${labelOf})(el)===${JSON.stringify(text)}&&!el.disabled)`),`button ${text}`);await js(`Array.from(document.querySelectorAll('button')).find(el=>(${labelOf})(el)===${JSON.stringify(text)}&&!el.disabled).click()`)}
const shot=async name=>{writeFileSync(join(out,`${name}.png`),await captureReadyPng(win.webContents))};
const text=()=>js('document.querySelector(".flow-dialog")?.innerText??document.body.innerText');
async function open(){if(win&&!win.isDestroyed())win.destroy();win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{preload:resolve(root,'tests/fixtures/assets-ui-preload.cjs'),contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});win.webContents.on('console-message',event=>{if(/Uncaught|Maximum update depth|Cannot update a component/.test(event.message))errors.push(event.message)});await win.loadURL(`http://127.0.0.1:${server.address().port}/app.html#flow`);await until(()=>js('Boolean(document.querySelector(".production-flow-page"))'),'flow page')}
const countRuns=()=>bridge.production.list(profile).length;
const startButton=()=>js('(()=>{const el=Array.from(document.querySelectorAll(".flow-dialog button")).find(el=>el.textContent.includes("Aprovar ideia e iniciar produção"));return el?{disabled:el.disabled}:null})()');
app.whenReady().then(async()=>{try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));await open();
 // 1) Opening the start dialog shows the pre-start check; no recording video exists and the script stage is still not blocked.
 await button('Iniciar produção');await until(()=>js('Boolean(document.querySelector(".production-preflight .production-preflight-stage"))'),'preflight report');
 // Consent cannot be given while the report is pending: hold the next preflight response and observe the checkbox.
 let release;hold={promise:new Promise(resolve=>{release=resolve})};
 await click('[aria-label="Ideia da produção"]');await button(topic.title);
 await until(()=>js('!document.querySelector(".production-preflight")&&document.querySelector(".production-panel-body .production-check input[type=checkbox]").disabled'),'checkbox disabled while preflight pending');
 await js('document.querySelector(".production-panel-body .production-check input[type=checkbox]").click()');assert.equal(await js('document.querySelector(".production-panel-body .production-check input[type=checkbox]").checked'),false);
 assert.equal(await js('document.querySelector(".production-panel-body .production-check input[type=checkbox]").title.length>0'),true);
 hold=null;release();
 await until(()=>js('document.querySelector(".production-preflight [role=status]")?.textContent.includes("Nenhum bloqueio")'),'no verified blocker for the Codex flow');await until(()=>js('document.querySelector(".production-panel-body .production-check input[type=checkbox]").disabled===false'),'checkbox enabled once the report is ready');
 let body=await text();assert(body.includes('Verificação antes de iniciar'));assert(body.includes('Nenhum bloqueio verificado'),body);
 assert.equal(await js('document.querySelectorAll(".production-preflight [data-level=blocker]").length'),0);
 assert.equal(await js('document.querySelector(".production-preflight [data-level]:not([data-level=blocker])") !== null'),true);
 assert(preflightCalls.length>0&&preflightCalls.every(call=>!call.probeMedia),'FFmpeg must not be probed before the explicit click');
 await shot('01-start-light');
 // 2) FFmpeg is verified only by the explicit button.
 const before=preflightCalls.length;await button('Verificar FFmpeg neste PC');await until(()=>preflightCalls.some(call=>call.probeMedia===true),'explicit FFmpeg probe');
 assert(preflightCalls.slice(0,before).every(call=>!call.probeMedia));
 // 3) Authorization is consent for this exact configuration: switching to a flow that changes the video agent clears it.
 await click('.production-panel-body .production-check input[type=checkbox]');assert.equal(await js('document.querySelector(".production-panel-body .production-check input[type=checkbox]").checked'),true);
 await click('[aria-label="Fluxo da produção"]');await button(claudeFlow.name);
 await until(()=>js('document.querySelector(".production-panel-body .production-check input[type=checkbox]")?.checked===false'),'consent cleared after configuration change');
 // Switching flow also clears the chosen idea; choose it again so only the Claude blocker remains.
 await click('[aria-label="Ideia da produção"]');await button(topic.title);
 // 4) Claude video agent: blocked with a visible reason, start disabled, nothing started.
 await until(()=>js('document.querySelectorAll(".production-preflight [data-level=blocker]").length>0'),'Claude blocker');await until(()=>js('Array.from(document.querySelectorAll(".production-preflight [data-level=blocker]")).some(el=>el.textContent.includes("Claude Code"))'),'video-agent Claude blocker');assert.equal(await js('document.querySelector(".production-panel-body .production-check input[type=checkbox]").disabled'),true,'checkbox must stay disabled while a verified blocker exists');
 body=await text();assert(/bloqueio\(s\) verificado\(s\) impedem/.test(body),body);
 const reason=await js('Array.from(document.querySelectorAll(".production-preflight [data-level=blocker]")).map(el=>el.textContent).find(t=>t.includes("Claude Code"))??""');assert(reason.includes('Claude Code'),reason);
 const blocked=await startButton();assert(blocked&&blocked.disabled===true,JSON.stringify(blocked));
 const reveal=()=>js('document.querySelector(".production-preflight [data-level=blocker]").scrollIntoView({block:"center"})');await reveal();await shot('02-blocked-light');
 await js('document.documentElement.dataset.appearance="dark"');await reveal();await shot('03-blocked-dark');
 // Prerequisite link must use a theme colour (not native #0000ee), keep its underline and show a keyboard focus ring.
 const linkProbe=`(()=>{const link=document.querySelector('.production-panel-body .editorial-hint a');if(!link)return null;link.scrollIntoView({block:'center'});const parse=c=>{const m=c.match(/[\\d.]+/g).map(Number);return {r:m[0],g:m[1],b:m[2],a:m[3]??1}};const lum=({r,g,b})=>{const f=v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4};return .2126*f(r)+.7152*f(g)+.0722*f(b)};const ratio=(x,y)=>{const a=lum(x),b=lum(y);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)};let back={r:255,g:255,b:255,a:1};for(let el=link;el;el=el.parentElement){const c=parse(getComputedStyle(el).backgroundColor);if(c.a>=.99){back=c;break}}const style=getComputedStyle(link);const color=parse(style.color);const focus=getComputedStyle(link);return {color:style.color,underline:style.textDecorationLine,ratio:ratio(color,back),back:'rgb('+back.r+','+back.g+','+back.b+')',focusVisible:link.matches(':focus-visible'),outlineStyle:focus.outlineStyle,outlineWidth:focus.outlineWidth,outlineRatio:ratio(parse(focus.outlineColor),back)}})()`;
 const checkLink=async theme=>{win.webContents.focus();await js('document.querySelector(".flow-dialog header button").focus()');for(let step=0;step<80&&!await js('document.activeElement?.matches(".production-panel-body .editorial-hint a")');step++){win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});await new Promise(resolve=>setTimeout(resolve,30))}assert(await js('document.activeElement?.matches(".production-panel-body .editorial-hint a")'),theme+' link not reachable with Tab');// Offscreen windows never report :focus-visible, so force that pseudo-state through DevTools to read the real computed ring.
 const dbg=win.webContents.debugger;if(!dbg.isAttached())dbg.attach('1.3');await dbg.sendCommand('DOM.enable');await dbg.sendCommand('CSS.enable');const {root:doc}=await dbg.sendCommand('DOM.getDocument');const {nodeId}=await dbg.sendCommand('DOM.querySelector',{nodeId:doc.nodeId,selector:'.production-panel-body .editorial-hint a'});await dbg.sendCommand('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:['focus','focus-visible']});const probe=await js(linkProbe);assert(probe,'prerequisite link missing');assert.notEqual(probe.color,'rgb(0, 0, 238)',theme+' native link colour '+JSON.stringify(probe));assert(probe.ratio>=4.5,theme+' contrast '+JSON.stringify(probe));assert(probe.underline.includes('underline'),theme+' underline '+JSON.stringify(probe));assert.equal(probe.focusVisible,true,theme+' focus-visible '+JSON.stringify(probe));await dbg.sendCommand('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:['focus','focus-visible']});assert(probe.outlineStyle!=='none'&&parseFloat(probe.outlineWidth)>=2&&probe.outlineRatio>=3,theme+' focus ring '+JSON.stringify(probe));return probe};
 const hasLink=await js('Boolean(document.querySelector(".production-panel-body .editorial-hint a"))');// Preflight blockers are plain text now (the old agent prerequisite link is gone); the contrast/focus probe only applies if a link exists.
 const linkResults=hasLink?{dark:await checkLink('dark')}:{linkPresent:false};if(hasLink)await shot('05-link-focus-dark');
 win.setSize(880,900);await until(()=>js('document.documentElement.scrollWidth<=innerWidth+1'),'no horizontal overflow at 880px');await reveal();await shot('04-blocked-880');
 win.setSize(1440,1000);await js('document.documentElement.dataset.appearance="light"');if(hasLink){linkResults.light=await checkLink('light');await shot('06-link-focus-light');}
 // 5) None of this started AI, Notion, publishing, or a production run. The Claude chat agent stays valid on its own.
 assert.deepEqual(effects,{ai:0,notion:0,publish:0});assert.equal(countRuns(),0);
 await click('.flow-dialog header button');
 await js(`document.querySelector('.agent-nav[title="Editor Claude"]').click()`);await until(()=>js('Boolean(document.querySelector(".composer textarea"))&&!document.querySelector(".flow-dialog")'),'Claude chat composer');
 assert.deepEqual(effects,{ai:0,notion:0,publish:0});assert.deepEqual(errors,[]);
 writeFileSync(join(out,'result.json'),JSON.stringify({passed:true,preflightCalls:preflightCalls.length,linkResults,ffmpegProbes:preflightCalls.filter(c=>c.probeMedia).length,effects},null,1));
 console.log(`PRODUCTION_PREFLIGHT_UI_OK: start check, Claude video agent blocked with reason, missing video not blocking, explicit FFmpeg probe only, consent cleared on configuration change, zero AI/Notion/publish/runs; captures ${out}`);
 win.destroy();await new Promise(resolve=>setTimeout(resolve,300));await bridge.close();store.close();server.close();app.exit(0);
}catch(error){console.error(error);console.error(errors,effects);if(win&&!win.isDestroyed()){try{console.log('PANEL:',await js('document.querySelector(".production-panel-body")?.innerText'),'CALLS',JSON.stringify(preflightCalls));writeFileSync(join(out,'failure.png'),(await win.webContents.capturePage()).toPNG())}catch{}win.destroy()}await bridge.close();store.close();server.close();app.exit(1)}
});
