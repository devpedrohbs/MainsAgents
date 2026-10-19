// SRT separado para o CapCut no Estúdio: Electron real, SQLite, FFmpeg e a ponte de conteúdo; Whisper simulado.
// Sem dados do usuário, IA, rede ou contas. Prova: importar SRT → blocos curtos → editar → salvar → baixar (arquivo real
// verificado por sha256), gerar do vídeo, nenhum vídeo alterado/renderizado, tema claro/escuro e tela estreita.
import {app,BrowserWindow,ipcMain} from 'electron';
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,extname,sep,join} from 'node:path';
import assert from 'node:assert/strict';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {registerEditorialFilesIpc} from '../editorial-files-ipc.mjs';
import {inspectLocalAsset} from '../editorial-local-files.mjs';
import {runMediaProcess} from '../editorial-media.mjs';
import {captureReadyPng} from './ui-capture-ready.mjs';

const root=resolve(import.meta.dirname,'..'),dist=resolve(root,process.env.MAINSAGENTS_UI_DIST??'dist'),out=resolve(root,'.mainsagents-workspaces/srt-workbench-ui',String(Date.now()));mkdirSync(out,{recursive:true});
app.setPath('userData',resolve(out,'electron'));app.on('window-all-closed',()=>{});
const dbPath=join(out,'state.sqlite'),workspaceId='my-workspace',profile='handoff-test',now=new Date().toISOString(),original='Script for the SRT fixture.';
const inspect=path=>inspectLocalAsset(path,{stabilityMs:1});
const editorial={schemaVersion:1,topics:[{id:'topic',workspaceId,requestId:'topic',inputKind:'text',input:'Personal project',category:'Tech',priority:'normal',status:'approved',title:'Personal project',summary:'A practical explanation of my project',whyItMatters:'It demonstrates useful technology',angles:['Example','How it works'],sources:[{title:'Reference',url:'https://example.com'}],factualQuestions:[],contentId:'content',createdAt:now,updatedAt:now}],contents:[{id:'content',workspaceId,topicId:'topic',title:'Personal project',format:'short-video',platforms:['LinkedIn'],status:'script-review',taskId:'task',scriptOptionsArtifactId:'options',createdAt:now,updatedAt:now}],runs:[],artifacts:[{id:'options',workspaceId,topicId:'topic',contentId:'content',type:'script-options',version:1,createdAt:now,data:{hooks:['Here is my project','A useful example','What I learned'],ctas:['Save it','Try it'],paths:[{title:'Explain',outline:'Show a practical example'},{title:'Story',outline:'Describe the project journey'}],improvisationTopics:['Context','Demo'],thumbnailDirection:'Project screenshot',draftScript:original}}],approvals:[]};
const base={workspaceId,role:'Editor',description:'Test specialist',instructions:'Follow the user request',tools:['web-search'],status:'idle',createdAt:now,updatedAt:now};
const state={agents:[{...base,id:'content-agent',name:'Content Editor'}],workspaces:[{id:workspaceId,name:'Test workspace',createdAt:now,updatedAt:now}],sessions:[],'active-sessions':{},language:'pt-BR','focus-mode':false,'welcome-dismissed':true};
ipcMain.handle('test:read',(_event,key)=>state[key]);ipcMain.handle('test:write',(_event,key,value)=>{state[key]=value});ipcMain.handle('test:all',()=>state);
// Whisper simulado com palavras (o motor real é coberto por tests/editorial-captions.test.mjs).
let transcriptions=0;const w=(start,end,text)=>({start,end,text});
const transcriber={capabilities:async()=>({available:true}),transcribe:async()=>{transcriptions++;return {engine:'whisper.cpp',model:'fixture',language:'pt',segments:[{start:0.2,end:2.6,text:'Eu hoje entrei pela porta do carro'}],speech:[{start:0.2,end:2.6}],words:[w(0.2,0.4,'Eu'),w(0.45,0.7,'hoje'),w(0.75,1.1,'entrei'),w(1.5,1.7,'pela'),w(1.72,2.0,'porta'),w(2.05,2.2,'do'),w(2.25,2.6,'carro')]};}};
let bridge=createContentWorkflowBridge({dbPath,getCurrentProfile:()=>profile,inspect,mediaOptions:{inspect,transcriber}});
const seed=new DatabaseSync(dbPath);seed.prepare('INSERT INTO editorial_state VALUES (?,?,?,?)').run(profile,1,JSON.stringify(editorial),now);seed.close();
const readState=()=>{const db=new DatabaseSync(dbPath);try{return JSON.parse(db.prepare('SELECT state_json FROM editorial_state WHERE profile_id=?').get(profile).state_json);}finally{db.close();}};
const json=(res,value)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value))};
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');if(await bridge.handle(req,res,url))return;
  if(url.pathname.startsWith('/api/'))return json(res,url.pathname.endsWith('/models')?{models:[]}:url.pathname.endsWith('/usage')?{rateLimits:null}:{ready:false,status:'disconnected'});
  try{const file=resolve(dist,url.pathname==='/'?'app.html':url.pathname.slice(1));assert(file.startsWith(dist+sep));const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'}[extname(file)];if(mime)res.setHeader('content-type',mime);res.end(readFileSync(file));}catch{res.statusCode=404;res.end()}
});
const errors=[],downloads=[];let win;
const js=code=>win.webContents.executeJavaScript(code);
async function until(check,label='SRT UI assertion timed out'){const deadline=Date.now()+20000;while(Date.now()<deadline){if(await check())return;await new Promise(r=>setTimeout(r,60))}throw new Error(label);}
async function clickText(text){await until(()=>js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});return Boolean(b&&!b.disabled)})()`),`button ${text}`);await js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});b.scrollIntoView({block:'center'});b.click()})()`);}
async function setValue(selector,value){await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`);}
async function shot(name){await js('document.querySelector(".srt-workbench").scrollIntoView({block:"start"})');await new Promise(r=>setTimeout(r,200));writeFileSync(join(out,`${name}.png`),await captureReadyPng(win.webContents));}
const rows=()=>js('[...document.querySelectorAll(".srt-workbench-row textarea")].map(t=>t.value)');
async function choose(aria,label){await js(`document.querySelector('[aria-label=${JSON.stringify(aria)}]').click()`);const find=`[...document.querySelectorAll("button")].find(b=>(b.querySelector(".select-menu-option-copy b")?.textContent??b.textContent).trim()===${JSON.stringify(label)})`;await until(()=>js(`Boolean(${find})`),`option ${label}`);await js(`${find}.click()`);}
const capcut=['1','00:00:01,000 --> 00:00:03,500','Eu hoje entrei pela porta do carro','','2','00:00:04,000 --> 00:00:06,500','E aí, você viu? Ação incrível!',''].join('\r\n');

app.whenReady().then(async()=>{try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const videoPath=join(out,'editado.mp4');
  await runMediaProcess('ffmpeg',['-nostdin','-v','error','-n','-f','lavfi','-i','testsrc2=size=192x108:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','3','-c:v','libx264','-c:a','aac',videoPath]);
  const videoSha=createHash('sha256').update(readFileSync(videoPath)).digest('hex');
  win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{preload:resolve(root,'tests/fixtures/assets-ui-preload.cjs'),contextIsolation:true,sandbox:true,backgroundThrottling:false,offscreen:true}});
  win.webContents.on('console-message',event=>{if(/Uncaught|Maximum update depth|Cannot update a component/.test(event.message))errors.push(event.message)});
  win.webContents.session.on('will-download',(_event,item)=>{const path=join(out,`download-${downloads.length+1}-${item.getFilename()}`);item.setSavePath(path);item.once('done',(_e,status)=>downloads.push({path,status,name:item.getFilename()}));});
  registerEditorialFilesIpc({ipcMain,dialog:{showOpenDialog:async()=>({canceled:false,filePaths:[videoPath]})},shell:{showItemInFolder:()=>{},openPath:async()=>''},getWindow:()=>win,getStore:()=>({currentProfile:()=>profile,workspaceSnapshot:()=>({editorial:{state:readState()}})}),inspect});
  await win.loadURL(`http://127.0.0.1:${server.address().port}/app.html#content`);
  await until(()=>js("Boolean(document.querySelector('.srt-workbench'))"),'SRT tool visible in the Studio even without any video');
  assert.match(await js('document.querySelector(".srt-workbench").textContent'),/Sem vídeo neste conteúdo: importe o SRT/);
  assert.equal(await js('document.querySelector(".srt-workbench").textContent.includes("Gravar legendas")'),false,'no burn option in the main SRT flow');
  // 1. Importar o SRT do CapCut (sem vídeo).
  await js(`(()=>{const input=document.querySelector('.srt-workbench-file input');const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(capcut)}],'capcut.srt',{type:'application/x-subrip'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await until(async()=>(await rows()).length>0,'imported rows');
  const imported=await rows();
  assert.deepEqual(imported.slice(0,3),['Eu hoje entrei','pela porta','do carro'],JSON.stringify(imported));
  assert.equal(imported.join(' '),'Eu hoje entrei pela porta do carro E aí, você viu? Ação incrível!','every word, accent and punctuation preserved in order');
  assert.match(await js('document.querySelector(".srt-workbench-warnings").textContent'),/Tempos ESTIMADOS/);
  assert.match(await js('document.querySelector(".srt-workbench-row .srt-workbench-timing").textContent'),/tempo estimado/);
  await shot('srt-imported-light');
  // 2. Corrigir uma palavra e baixar DIRETO: "Salvar e baixar SRT" salva, exporta e baixa numa ação (sem aprovar nada).
  await setValue('.srt-workbench-row textarea','Eu hoje entrei,');
  await setValue('.srt-workbench-row:nth-child(3) textarea','do carrão!');
  await until(()=>js('[...document.querySelectorAll(".srt-workbench-actions button")].some(b=>b.textContent==="Salvar e baixar SRT")'));
  await setValue('.srt-workbench-row:nth-child(2) .srt-workbench-times input','x');
  await until(()=>js('Boolean(document.querySelector(".srt-workbench-row:nth-child(2) [role=alert]")?.textContent.includes("Início ilegível"))'));
  assert.equal(await js('[...document.querySelectorAll(".srt-workbench-actions button")].find(b=>b.textContent==="Salvar e baixar SRT").disabled'),true,'invalid time cannot be downloaded');
  await setValue('.srt-workbench-row:nth-child(1) .srt-workbench-times input:nth-of-type(2)','0:01.900');await setValue('.srt-workbench-row:nth-child(2) .srt-workbench-times input','0:01.900');
  assert.equal(await js('[...document.querySelectorAll(".srt-workbench button")].every(b=>b.type==="button")'),true,'every button is type=button (Enter never submits)');
  const videosBefore=JSON.stringify(readState().assets??[]);
  await clickText('Salvar e baixar SRT');await until(()=>js('Boolean(document.querySelector(".srt-workbench-receipt"))'),'receipt');await until(()=>downloads.length===1,'download');
  await until(()=>js('document.querySelector(".srt-workbench-version")?.textContent.includes("v2 · editado por você")'));
  const receiptPath=await js('document.querySelector(".srt-workbench-receipt code").textContent');
  const fileBytes=readFileSync(receiptPath),downloaded=readFileSync(downloads[0].path),text=fileBytes.toString('utf8');
  assert.equal(downloads[0].status,'completed');assert.deepEqual(downloaded,fileBytes,'download = verified file on disk');
  assert.notDeepEqual([...fileBytes.subarray(0,3)],[0xef,0xbb,0xbf],'UTF-8 without BOM');assert.ok(!/[^\r]\n/.test(text),'CRLF only');
  assert.ok(text.startsWith('1\r\n00:00:01,000 --> 00:00:01,900\r\nEu hoje entrei,\r\n\r\n2\r\n00:00:01,900 --> '),JSON.stringify(text.slice(0,90)));
  assert.match(text,/\r\ndo carrão!\r\n/);
  assert.match(await js('document.querySelector(".srt-workbench-receipt").textContent'),new RegExp(`sha256 ${createHash('sha256').update(fileBytes).digest('hex').slice(0,12)}`));
  await until(()=>readState().assets?.some(a=>a.kind==='document'&&a.name.endsWith('.srt')),'SRT registered in the content library');
  assert.equal(bridge.media.list(profile).length,0,'no media export/render job');assert.equal(transcriptions,0);
  await clickText('Baixar SRT (v2)');await until(()=>js('document.querySelector(".srt-workbench-receipt strong").textContent.includes("sem duplicar")'));await until(()=>downloads.length===2,'second download');
  assert.equal(readState().assets.filter(a=>a.kind==='document').length,1,'idempotent export: one document');
  // 3. Trocar 3 → 2 palavras e redividir: as correções continuam; baixar de novo ainda corrigido.
  await js('document.querySelector("[aria-label=\\"Palavras por bloco\\"]").click()');
  await until(()=>js('[...document.querySelectorAll("button")].some(b=>(b.querySelector(".select-menu-option-copy b")?.textContent??b.textContent).trim()==="2 palavras por bloco")'),'word menu');
  await js('[...document.querySelectorAll("button")].find(b=>(b.querySelector(".select-menu-option-copy b")?.textContent??b.textContent).trim()==="2 palavras por bloco").click()');
  await clickText('Dividir de novo em blocos de 2 palavras (mantém suas correções)');
  await until(()=>js('document.querySelector(".srt-workbench-version")?.textContent.includes("blocos de até 2 palavras")'),'re-split to 2');
  const resplit=await rows();
  assert.deepEqual(resplit.slice(0,4),['Eu hoje','entrei,','pela porta','do carrão!'],JSON.stringify(resplit));
  await clickText('Baixar SRT (v3)');await until(()=>downloads.length===3,'third download');
  const third=readFileSync(downloads[2].path,'utf8');assert.match(third,/\r\nentrei,\r\n/);assert.match(third,/\r\ndo carrão!\r\n/);assert.doesNotMatch(third,/\bcarro\b/);
  await shot('srt-exported-light');
  await js('document.documentElement.dataset.appearance="dark"');await shot('srt-exported-dark');
  // 4. Gerar do vídeo já editado (Whisper local simulado), sem gravar nada no vídeo.
  await js('document.documentElement.dataset.appearance="light"');
  await clickText('Adicionar arquivos');await until(()=>readState().assets.some(a=>a.kind==='video')&&js('[...document.querySelectorAll(".content-asset")].some(e=>e.textContent.includes("editado.mp4"))'),'video linked');
  await clickText('Gerar do vídeo (Whisper local)');
  await until(()=>js('document.querySelector(".srt-workbench-version")?.textContent.includes("gerado do vídeo")'),'generated from video');
  assert.deepEqual(await rows(),['Eu hoje','entrei','pela porta','do carro'],'generated with the selected 2 words per block');
  assert.match(await js('document.querySelector(".srt-workbench-row .srt-workbench-timing").textContent'),/tempo do Whisper/);
  assert.equal(await js('Boolean(document.querySelector(".srt-workbench-player video"))&&!document.querySelector(".caption-review-overlay")'),true,'player to check timing without text over the speech');
  const video=readState().assets.find(a=>a.kind==='video');assert.equal(video.versions[0].sha256,videoSha);assert.equal(createHash('sha256').update(readFileSync(videoPath)).digest('hex'),videoSha,'source video bytes untouched');
  assert.equal(JSON.parse(videosBefore).filter(a=>a.kind==='video').length,0);
  await shot('srt-generated-light');
  // 5. Rascunhos isolados por SRT: rascunho em A sobrevive a salvar+baixar B no mesmo conteúdo.
  await choose('SRT deste conteúdo','capcut.srt · v3');await until(async()=>(await rows())[0]==='Eu hoje','doc A selected');
  await setValue('.srt-workbench-row textarea','RASCUNHO A');await until(()=>js('[...document.querySelectorAll(".srt-workbench-actions button")].some(b=>b.textContent==="Salvar e baixar SRT")'));
  await choose('SRT deste conteúdo','editado.srt · v1');await until(async()=>(await rows())[0]==='Eu hoje'&&(await rows()).length===4,'doc B selected');
  await setValue('.srt-workbench-row textarea','Eu, hoje');await clickText('Salvar e baixar SRT');await until(()=>downloads.length===4,'download B');
  assert.match(readFileSync(downloads[3].path,'utf8'),/\r\nEu, hoje\r\n/);
  await choose('SRT deste conteúdo','capcut.srt · v3');await until(async()=>(await rows())[0]==='RASCUNHO A','draft of A kept after saving B');
  // 5. Tela estreita: sem rolagem horizontal.
  win.setSize(420,860);await new Promise(r=>setTimeout(r,300));
  assert(await js('document.documentElement.scrollWidth<=innerWidth+1'),'no horizontal scroll at narrow width');
  await shot('srt-narrow-light');await js('document.documentElement.dataset.appearance="dark"');await shot('srt-narrow-dark');
  assert.ok(existsSync(receiptPath));assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,out,receiptPath,downloads:downloads.length,transcriptions}));
  win.destroy();await bridge.close();server.close();app.exit(0);
}catch(error){console.error(error);console.error(errors);if(win&&!win.isDestroyed()){console.log(await js('document.querySelector(".srt-workbench")?.innerText??document.body.innerText'));writeFileSync(join(out,'failure.png'),(await win.webContents.capturePage()).toPNG());win.destroy()}await bridge.close();server.close();app.exit(1)}});
