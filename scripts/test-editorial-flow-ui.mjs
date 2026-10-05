// Hidden, isolated Electron fixture. No user data, AI inference or remote writes.
import {app,BrowserWindow,ipcMain} from 'electron';
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';

const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.mainsagents-workspaces/editorial-flow-ui-test');mkdirSync(out,{recursive:true});
app.setPath('userData',resolve(out,`profile-${Date.now()}`));
app.on('window-all-closed',()=>{});
const dbPath=resolve(out,`test-${Date.now()}.sqlite`),workspaceId='my-workspace',profile='handoff-test',source='12345678-1234-1234-1234-123456789abc';
const now=new Date().toISOString(),original='This is the complete script originally proposed by the specialist. It explains the project and its practical value with a concrete example and a closing reminder.';
const changed=original+' EDITED_SCRIPT_PRESERVED';
const editorial={schemaVersion:1,topics:[{id:'topic',workspaceId,requestId:'topic',inputKind:'text',input:'Personal project',category:'Tech',priority:'normal',status:'approved',title:'Personal project',summary:'A practical explanation of my project',whyItMatters:'It demonstrates useful technology',angles:['Example','How it works'],sources:[{title:'Reference',url:'https://example.com'}],factualQuestions:[],contentId:'content',createdAt:now,updatedAt:now}],contents:[{id:'content',workspaceId,topicId:'topic',title:'Personal project',format:'short-video',platforms:['LinkedIn'],status:'script-review',taskId:'task',scriptOptionsArtifactId:'options',createdAt:now,updatedAt:now}],runs:[],artifacts:[{id:'options',workspaceId,topicId:'topic',contentId:'content',type:'script-options',version:1,createdAt:now,data:{hooks:['Here is my project','A useful example','What I learned'],ctas:['Save it','Try it'],paths:[{title:'Explain',outline:'Show a practical example'}, {title:'Story',outline:'Describe the project journey'}],improvisationTopics:['Context','Demo'],thumbnailDirection:'Project screenshot',draftScript:original}}],approvals:[]};
const base={workspaceId,role:'Editor',description:'Test specialist',instructions:'Follow the user request',tools:['web-search'],status:'idle',createdAt:now,updatedAt:now};
const state={agents:[{...base,id:'content-agent',name:'Content Editor'}],workspaces:[{id:workspaceId,name:'Test workspace',createdAt:now,updatedAt:now}],sessions:[],'active-sessions':{},language:'pt-BR','focus-mode':false,'welcome-dismissed':true};
ipcMain.handle('test:read',(_event,key)=>state[key]);ipcMain.handle('test:write',(_event,key,value)=>{state[key]=value});ipcMain.handle('test:all',()=>state);
let calls=0,fail=true,blockProfileCache=false;
const connector={upsert:async(payload,context)=>{calls++;context.authorize();if(fail)throw new Error('TEST_CONNECTION_UNAVAILABLE');return {pageId:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',url:'https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',verifiedAt:new Date().toISOString(),artifactVersion:payload.artifact.version}}};
let bridge=createContentWorkflowBridge({dbPath,getConnector:()=>connector,suggestConnection:()=>source});
const seed=new DatabaseSync(dbPath);seed.prepare('INSERT INTO editorial_state VALUES (?,?,?,?)').run(profile,1,JSON.stringify(editorial),now);seed.close();
const json=(res,value)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value))};
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');if(await bridge.handle(req,res,url))return;
  if(url.pathname.startsWith('/api/'))return json(res,url.pathname.endsWith('/models')?{models:[]}:url.pathname.endsWith('/usage')?{rateLimits:null}:{ready:false,status:'disconnected'});
  try{const file=resolve(root,'dist',url.pathname==='/'?'app.html':url.pathname.slice(1));assert(file.startsWith(resolve(root,'dist')+sep));const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'}[extname(file)];if(mime)res.setHeader('content-type',mime);let content=readFileSync(file);if(blockProfileCache&&extname(file)==='.html')content=Buffer.from(content.toString().replace('<head>',`<head><script>Object.defineProperty(window,'localStorage',{get(){throw new Error('Profile cache unavailable')}});</script>`));res.end(content);}catch{res.statusCode=404;res.end()}
});
const errors=[];let window;
const evaluate=code=>window.webContents.executeJavaScript(code);
async function until(check){const deadline=Date.now()+15000;while(Date.now()<deadline){if(await check())return;await new Promise(resolve=>setTimeout(resolve,70))}throw new Error('Editorial UI assertion timed out');}
async function clickText(text){await until(()=>evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(text)});return Boolean(button&&!button.disabled)})()`));await evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(text)});button.scrollIntoView({block:'center'});button.click()})()`);}
async function open(){window=new BrowserWindow({show:false,width:1440,height:940,webPreferences:{preload:resolve(root,'tests/fixtures/handoff-ui-preload.cjs'),contextIsolation:true,sandbox:true,backgroundThrottling:false,offscreen:true}});window.webContents.on('console-message',event=>{if(/Uncaught|Maximum update depth|Cannot update a component/.test(event.message))errors.push(event.message)});await window.loadURL(`http://127.0.0.1:${server.address().port}/app.html#content`);await until(()=>evaluate("Boolean(document.querySelector('.editorial-script'))"));}
app.whenReady().then(async()=>{
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));await open();
    assert.equal(calls,0);assert.equal(await evaluate("document.querySelector('#editorial-notion-source').value"),source);
    await evaluate(`(()=>{const input=document.querySelector('.editorial-script');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(changed)});input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.editorial-notion-toggle input').click()})()`);
    await clickText('Aprovar roteiro e enviar ao Notion');
    await until(()=>evaluate("document.body.textContent.includes('TEST_CONNECTION_UNAVAILABLE')"));
    assert.equal(calls,1);fail=false;await clickText('Verificar e tentar novamente');
    await until(()=>evaluate("document.body.textContent.includes('Card confirmado no Notion')"));
    assert.equal(bridge.jobs.list(profile).length,1);assert.equal(calls,2);
    assert.equal(await evaluate("document.querySelector('.editorial-script').value"),changed);
    await clickText('Aprovar roteiro e enviar ao Notion');await until(()=>evaluate("Boolean(document.querySelector('.editorial-approved'))"));assert.equal(calls,2);
    await evaluate("window.mainsAgentsSaveNow()");window.destroy();await bridge.close();
    blockProfileCache=true;
    bridge=createContentWorkflowBridge({dbPath,getConnector:()=>connector,suggestConnection:()=>source});await open();
    await until(()=>evaluate("document.body.textContent.includes('Card confirmado no Notion')"));
    assert.equal(await evaluate("document.querySelector('.editorial-script').value"),changed);assert.equal(calls,2);
    await evaluate("document.querySelector('[aria-label=\"Etapa de produção\"]').click()");
    await clickText('Em edição');await until(()=>evaluate("document.querySelector('[aria-label=\"Etapa de produção\"]').textContent.includes('Em edição')"));
    await clickText('Abrir roteiro no Canvas');await until(()=>evaluate("Boolean(document.querySelector('.flow-node.script'))"));
    await clickText('↗ Abrir conteúdo');await until(()=>evaluate("Boolean(document.querySelector('.editorial-script'))"));
    assert.equal(await evaluate("document.querySelector('.editorial-script').value"),changed);
    await evaluate("window.mainsAgentsSaveNow()");
    const db=new DatabaseSync(dbPath);const saved=JSON.parse(db.prepare('SELECT state_json FROM editorial_state WHERE profile_id=?').get(profile).state_json);db.close();
    assert.equal(saved.contents[0].productionStage,'editing');assert.equal(saved.artifacts.filter(item=>item.type==='script').length,1);
    assert.equal(state['canvas-workspaces'][workspaceId].nodes[0].data.contentId,'content');assert.deepEqual(errors,[]);
    writeFileSync(resolve(out,'content-studio.png'),(await window.webContents.capturePage()).toPNG());
    console.log('PASS: approval, failed connection, explicit retry, deduplication, restart, edited script, production stage and linked Canvas. No AI tokens or remote writes.');
    writeFileSync(resolve(out,'result.json'),JSON.stringify({passed:true,calls,duplicateJobs:false,restart:true,linkedCanvas:true}));
    window.destroy();await bridge.close();server.close();app.exit(0);
  }catch(error){console.error(error);try{if(window&&!window.isDestroyed()){console.log('UI:',await evaluate('document.body.innerText'));writeFileSync(resolve(out,'failure.png'),(await window.webContents.capturePage()).toPNG());}}catch{}writeFileSync(resolve(out,'result.json'),JSON.stringify({passed:false,error:error.stack,errors}));if(window&&!window.isDestroyed())window.destroy();await bridge.close();server.close();app.exit(1)}
});
