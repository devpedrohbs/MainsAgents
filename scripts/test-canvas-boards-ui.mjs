// Canvas spaces UI on the production renderer: legacy single canvas opens as the main space, spaces are created, switched,
// renamed and deleted with confirmation, and switching resets undo/selection/panels. Isolated fixtures, no personal data.
// Run after `npm run build`: npx electron scripts/test-canvas-boards-ui.mjs   (MAINSAGENTS_UI_DIST=<dir> serves another build)
import {app,BrowserWindow,ipcMain} from 'electron';
import {createServer} from 'node:http';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,sep,extname} from 'node:path';
import assert from 'node:assert/strict';
import {captureReadyPng} from './ui-capture-ready.mjs';
const root=resolve(import.meta.dirname,'..'),dist=resolve(process.env.MAINSAGENTS_UI_DIST||resolve(root,'dist')),out=resolve(root,'.mainsagents-workspaces/canvas-boards-ui-test',String(Date.now()));
mkdirSync(out,{recursive:true});app.setPath('userData',resolve(out,'profile'));
const at=new Date().toISOString(),space='my-workspace';
const legacyNote={id:'node-note-legacy',type:'note',position:{x:120,y:120},data:{label:'Note',text:'Nota legada do canvas único',meta:'You · now'}};
const state={workspaces:[{id:space,name:'Conteúdo',createdAt:at,updatedAt:at}],'current-workspace':space,agents:[],sessions:[],'active-sessions':{},tasks:[],language:'pt-BR','welcome-dismissed':true,'focus-mode':false,
 // Pre-spaces shape: one graph per workspace. It must open untouched as the main space.
 'canvas-workspaces':{[space]:{nodes:[legacyNote],edges:[],view:{viewport:{x:0,y:0,zoom:1},width:1200,height:800,ready:true}}}};
ipcMain.handle('test:read',(_event,key)=>state[key]);ipcMain.handle('test:write',(_event,key,value)=>{state[key]=value});ipcMain.handle('test:all',()=>state);
const json=(response,payload)=>{response.setHeader('content-type','application/json');response.end(JSON.stringify(payload))};
const server=createServer(async(request,response)=>{
 const url=new URL(request.url,'http://localhost');
 if(url.pathname==='/api/content/state')return json(response,{revision:1,state:{schemaVersion:1,topics:[],runs:[],artifacts:[],approvals:[],contents:[],assets:[],publications:[]}});
 if(url.pathname.startsWith('/api/'))return json(response,url.pathname.endsWith('/work')?{jobs:[],mediaJobs:[],worker:{running:false}}:url.pathname.endsWith('/jobs')?{jobs:[]}:url.pathname.endsWith('/models')?{models:[]}:url.pathname.endsWith('/calendar')?{sources:[]}:url.pathname.endsWith('/delegations')?{jobs:[],sessions:[],handoffs:[]}:url.pathname.endsWith('/actions')?{actions:[]}:{ready:false,events:[],version:'test'});
 try{const file=resolve(dist,url.pathname==='/'?'app.html':url.pathname.slice(1));assert(file.startsWith(dist+sep));response.setHeader('content-type',({'.html':'text/html','.css':'text/css','.js':'application/javascript','.png':'image/png','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream');response.end(readFileSync(file))}catch{response.statusCode=404;response.end()}
});
let win;const errors=[];
const js=code=>win.webContents.executeJavaScript(code);
async function until(check,label='condition'){const end=Date.now()+10000;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,40))}throw Error(`Canvas spaces UI timed out: ${label}`)}
async function click(selector){await until(()=>js(`Boolean(document.querySelector(${JSON.stringify(selector)}))`),selector);await js(`document.querySelector(${JSON.stringify(selector)}).click()`)}
async function buttonText(text){await until(()=>js(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled)`),text);await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled).click()`)}
async function screenshot(name){writeFileSync(resolve(out,`${name}.png`),await captureReadyPng(win.webContents))}
const key=(keyCode,modifiers=[])=>{win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers})};
const trigger='[data-od-id=canvas-boards-trigger]';
const active=()=>js(`document.querySelector('${trigger} strong')?.textContent??''`);
// Note text lives in a textarea, so it is read from .note-editor values (innerText never includes it).
const noteTexts=()=>js('Array.from(document.querySelectorAll(".note-editor")).map(el=>el.value)');
const hasLegacy=async()=>(await noteTexts()).includes(legacyNote.data.text);
const saved=()=>state['canvas-workspaces'][space];
const typeName=value=>js(`(()=>{const el=document.querySelector('.canvas-boards-form input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`);
const row=name=>`Array.from(document.querySelectorAll('.canvas-boards-row')).find(r=>r.querySelector('b')?.textContent===${JSON.stringify(name)})`;
async function openMenu(){if(!await js('Boolean(document.querySelector(".canvas-boards-menu"))'))await click(trigger);await until(()=>js('Boolean(document.querySelector(".canvas-boards-menu"))'),'spaces menu')}
async function create(name){await openMenu();await click('.canvas-boards-new');await until(()=>js('Boolean(document.querySelector(".canvas-boards-form input"))'),'create dialog');await typeName(name);await buttonText('Criar e abrir')}
app.whenReady().then(async()=>{try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{preload:resolve(root,'tests/fixtures/assets-ui-preload.cjs'),contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});
 win.webContents.session.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith(`http://127.0.0.1:${server.address().port}/`)}));
 win.webContents.on('console-message',event=>{if(/Uncaught|Maximum update depth|Cannot update a component/.test(event.message))errors.push(event.message)});
 await win.loadURL(`http://127.0.0.1:${server.address().port}/app.html#canvas`);
 // 1) Legacy canvas opens as the main space, with the location workspace › space.
 await until(()=>js(`Boolean(document.querySelector('${trigger}'))`),'spaces trigger');
 assert.equal(await active(),'Canvas principal');
 assert.equal(await js('document.querySelector(".canvas-boards-workspace").textContent'),'Conteúdo');
 assert.match(await js(`document.querySelector('${trigger}').textContent`),/1 objeto/);
 await until(hasLegacy,'legacy note visible');
 await screenshot('01-main-legacy-light');
 // 2) Menu semantics: one checked space, delete disabled while it is the only one, Escape returns focus to the trigger.
 await openMenu();
 assert.equal(await js('document.querySelectorAll(".canvas-boards-option[aria-checked=true]").length'),1);
 assert.equal(await js(`${row('Canvas principal')}.querySelector('[aria-label^="Excluir"]').disabled`),true);
 key('Escape');await until(()=>js('!document.querySelector(".canvas-boards-menu")'),'menu closes on Escape');
 assert.equal(await js(`document.activeElement===document.querySelector('${trigger}')`),true,'focus returns to the trigger');
 // Keyboard: ArrowDown on the trigger opens the menu with the active space focused.
 await js(`document.querySelector('${trigger}').focus()`);key('Down');await until(()=>js('document.activeElement?.getAttribute("aria-checked")==="true"'),'keyboard open');key('Escape');
 // 3) Create "Notícias": it opens empty, the main space's blocks are not shown, storage moves to the spaces shape.
 await create('Notícias');
 await until(async()=>(await active())==='Notícias','new space active');
 await until(()=>js('Boolean(document.querySelector(".canvas-empty-state"))'),'new space empty');
 assert.equal(await hasLegacy(),false,'main space blocks are not shown in the new space');
 await until(()=>saved()?.schemaVersion===2&&saved().boards.length===2,'spaces saved');
 assert.deepEqual(saved().boards.find(b=>b.id==='main').nodes.map(n=>n.id),[legacyNote.id],'main space content preserved');
 // 4) A block in Notícias, then switching back resets undo, selection and panels; each space keeps its own blocks.
 await click('.canvas-tool-note');await until(()=>js('document.querySelectorAll(".react-flow__node").length===1'),'note in Notícias');
 assert.equal(await js('document.querySelector(".studio-zoom-controls button").disabled'),false,'undo available after adding');
 await openMenu();await js(`${row('Canvas principal')}.querySelector('.canvas-boards-option').click()`);
 await until(async()=>(await active())==='Canvas principal','back to main');
 await until(hasLegacy,'main blocks back');
 assert.equal(await js('document.querySelector(".studio-zoom-controls button").disabled'),true,'undo history reset on switch');
 assert.equal(await js('document.querySelectorAll(".react-flow__node.selected").length'),0,'selection reset on switch');
 assert.equal(await js('Boolean(document.querySelector(".selection-bar,.canvas-detail"))'),false,'panels closed on switch');
 assert.equal(saved().boards.find(b=>b.name==='Notícias').nodes.length,1);
 // 5) Duplicate names are refused with a Portuguese message; rename works.
 await create('notícias');await until(()=>js('document.querySelector(".canvas-boards-form [role=alert]")?.textContent==="Já existe um espaço com esse nome."'),'duplicate refused');
 await buttonText('Cancelar');
 await openMenu();await js(`${row('Notícias')}.querySelector('[aria-label^="Renomear"]').click()`);
 await until(()=>js('document.querySelector(".canvas-boards-form input")?.value==="Notícias"'),'rename prefilled');await typeName('Edição');await buttonText('Salvar');
 await until(()=>saved().boards.some(b=>b.name==='Edição')&&!saved().boards.some(b=>b.name==='Notícias'),'renamed');
 // 6) Delete asks with the block count and keeps at least one space.
 await openMenu();await js(`${row('Edição')}.querySelector('[aria-label^="Excluir"]').click()`);
 await until(()=>js('document.querySelector(".flow-dialog")?.textContent.includes("1 objeto deste espaço")'),'delete confirmation with count');
 await screenshot('02-delete-confirm');
 await buttonText('Excluir espaço');await until(()=>saved().boards.length===1,'space deleted');
 assert.equal(await active(),'Canvas principal');assert.equal(saved().boards[0].nodes[0].data.text,legacyNote.data.text);
 // 7) Themes and narrow width.
 await create('Pesquisa');await until(async()=>(await active())==='Pesquisa','third space');await openMenu();
 // The appearance switch in the top bar (not only the dataset), so color-scheme and React state follow.
 await buttonText('Claro');await openMenu();await new Promise(resolve=>setTimeout(resolve,150));await screenshot('03-menu-light');
 await buttonText('Escuro');await openMenu();await new Promise(resolve=>setTimeout(resolve,150));await screenshot('04-menu-dark');
 win.setSize(360,800);await new Promise(resolve=>setTimeout(resolve,150));
 assert(await js('document.documentElement.scrollWidth<=innerWidth+1'),'no horizontal scroll at 360px');
 const menu=await js('(()=>{const r=document.querySelector(".canvas-boards-menu").getBoundingClientRect();return {left:r.left,right:r.right}})()');
 assert(menu.left>=0&&menu.right<=360,'menu fits at 360px');await screenshot('05-menu-360');
 assert.deepEqual(errors,[]);
 console.log(`CANVAS_BOARDS_UI_OK: legacy canvas as main space, workspace › space trail, menu/keyboard, create/switch/rename/delete with count, duplicate refused, reset on switch, separate blocks, light/dark/360px. Screenshots: ${out}`);
 win.destroy();server.close();app.exit(0);
}catch(error){console.error(error);console.error(errors);if(win&&!win.isDestroyed()){await screenshot('failure').catch(()=>{});win.destroy()}server.close();app.exit(1)}});
