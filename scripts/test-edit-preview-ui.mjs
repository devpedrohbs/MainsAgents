// Editing upgrade (09/10) in real Electron: Remotion Player preview of the reviewed plan, transcript editing with undo,
// opt-in voice treatment, manual focus, user motion moments, word captions and export of exactly the previewed plan.
// Synthetic Windows-voice fixture, real whisper.cpp/FFmpeg/Remotion, simulated agents; no personal accounts, videos or paid calls.
// Run: npx electron scripts/test-edit-preview-ui.mjs
import {app,BrowserWindow,ipcMain} from 'electron';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,extname,sep,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {createDesktopStateStore} from '../desktop-state-store.mjs';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {registerEditorialFilesIpc} from '../editorial-files-ipc.mjs';
import {createChatImageArtifacts} from '../chat-image-artifacts.mjs';
import {runMediaProcess} from '../editorial-media.mjs';
import {inspectLocalAsset} from '../editorial-local-files.mjs';
import {createZernioPublicationConnector} from '../zernio-publication-connector.mjs';
import {captureReadyPng} from './ui-capture-ready.mjs';
import {probeVideo} from '../editorial-media.mjs';
import {createWhisperTranscriber} from '../editorial-transcribe.mjs';
import {createRemotionAnimator} from '../editorial-animate.mjs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.mainsagents-workspaces/edit-preview-ui',String(Date.now()));mkdirSync(out,{recursive:true});app.setPath('userData',resolve(out,'electron'));app.on('window-all-closed',()=>{});
const profile='handoff-test',workspaceId='space',at=new Date().toISOString(),dbPath=join(out,'workspace-state.sqlite'),input=join(out,'original.mp4'),png=join(out,'native-tool.png'),inspect=path=>inspectLocalAsset(path,{stabilityMs:0});
const source={id:'source',name:'Editor de Conteúdo',role:'Conteúdo',instructions:'Use my own role and skills',description:'Fixture',skills:['own-skill'],workspaceId,providerId:'codex',tools:['files'],status:'idle',createdAt:at,updatedAt:at},editor={...source,id:'editor',name:'Editor de Vídeo',role:'Vídeo'};
const flow={id:'flow',workspaceId,name:'Fluxo de criação de conteúdo',nodes:[{id:'content-box',kind:'content-agent',title:'Agente de conteúdo',agentId:'source',position:{x:80,y:140}},{id:'input-box',kind:'video-input',title:'Vídeos da gravação',position:{x:430,y:140}},{id:'editor-box',kind:'video-agent',title:'Editor de vídeo',agentId:'editor',position:{x:780,y:140}},{id:'publish-box',kind:'publishing-agent',title:'Preparar publicação',agentId:'source',position:{x:1130,y:140}}],edges:[],createdAt:at,updatedAt:at};
const topic={id:'topic',workspaceId,requestId:'idea',inputKind:'text',input:'Automation',priority:'normal',status:'review',title:'Minha ideia de automação',category:'Tech',summary:'Uma demonstração prática de automação.',whyItMatters:'Explica como economizar tempo no dia a dia.',angles:['Demo','Explicação'],sources:[{title:'Referência',url:'https://example.com'}],factualQuestions:[],createdAt:at,updatedAt:at};
const store=createDesktopStateStore(out,'test');store.initialize(profile,{agents:[source,editor],workspaces:[{id:workspaceId,name:'Content',createdAt:at,updatedAt:at}],sessions:[],'current-workspace':workspaceId,'active-sessions':{},language:'pt-BR','welcome-dismissed':true,'focus-mode':false,'production-flows':{schemaVersion:1,flows:[flow],activeByWorkspace:{[workspaceId]:flow.id}}});
ipcMain.handle('test:read',(_e,key)=>store.read(profile,key));ipcMain.handle('test:write',(_e,key,value)=>store.write(profile,key,value));ipcMain.handle('test:all',()=>store.readAll(profile));
const images=createChatImageArtifacts(join(out,'images')),executions=new Map(),threads=new Map();let serial=0,sends=0,posts=0,post,win;
const options={hooks:['Primeira opção','Segunda opção','Terceira opção'],ctas:['Salve','Experimente'],paths:[{title:'Demo',outline:'Mostre o problema e a solução em uma demonstração clara.'},{title:'História',outline:'Explique o contexto do problema e como chegou à solução.'}],improvisationTopics:['Demo','Contexto'],thumbnailDirection:'Capa profissional',draftScript:'Uma automação prática pode economizar tempo em uma tarefa repetitiva. Comece pelo problema, demonstre a solução funcionando e explique como o público pode aplicar a mesma ideia na própria rotina.'};
const runtime={createSession:async()=>{const id=`thread-${++serial}`;threads.set(id,{turns:[]});return id},resumeSession:async()=>{},readThread:async id=>threads.get(id),cancel:async()=>{},imageFile:image=>images.pathForImage(image),send:async(thread,text)=>{sends++;const id=`execution-${++serial}`,output=text.includes('Retorne SOMENTE JSON: {"start"')?JSON.stringify({start:0,duration:1.5,format:'original',normalizeAudio:true,fadeSeconds:.15,summary:'Áudio normalizado e acabamento'}):text.includes('"removeSilences"')?JSON.stringify({removeSilences:true,silence:{thresholdDb:-35,minDuration:0.6,padding:0.2},normalizeAudio:false,animations:{title:'Edição automática',cta:'Siga o canal'},summary:'Cortar pausas e animar abertura e CTA'}):text.includes('Prepare legendas')?JSON.stringify({deliveries:[{platform:'Instagram',caption:'Legenda aprovada da minha automação.',coverPrompt:'Capa profissional clara, vertical'}]}):text.includes('Gere uma imagem de capa')?'Imagem pronta':JSON.stringify(options);executions.set(id,{thread,text,output,image:text.includes('Gere uma imagem de capa')});return {executionId:id}},events:async function*(id){const e=executions.get(id);yield {type:'message.completed',content:e.output};if(e.image)yield images.fromItem({id:'native-image',type:'imageGeneration',status:'completed',result:readFileSync(png).toString('base64')},id);threads.get(e.thread).turns.push({id,status:'completed',items:[{type:'userMessage',content:[{type:'text',text:e.text}]},{type:'agentMessage',text:e.output}]});yield {type:'execution.completed'}}};
const fetchImpl=async(url,init={})=>{const path=new URL(url).pathname.split('/api/v1/')[1];if(init.method==='PUT'&&!path){for await(const _chunk of init.body){}return new Response('');}if(path==='accounts')return Response.json({accounts:[{_id:'ig-fixture',platform:'instagram',username:'Minha conta de teste',isActive:true}]});if(path==='media/presign'){const id=++serial;return Response.json({uploadUrl:`https://media.zernio.com/upload/${id}`,publicUrl:`https://media.zernio.com/temp/${id}.jpg`})}if(path==='posts'&&init.method==='POST'){posts++;const body=JSON.parse(init.body);post={...body,_id:'post-fixture',status:'scheduled',platforms:body.platforms.map(t=>({...t,status:'scheduled'}))};return Response.json({post});}if(path==='posts/post-fixture')return Response.json({post});throw Error('Unexpected provider request')};
const media={inspect,transcriber:createWhisperTranscriber(),...createRemotionAnimator()},makeBridge=()=>createContentWorkflowBridge({dbPath,getCurrentProfile:()=>profile,getAgents:()=>store.read(profile,'agents'),getFlows:()=>store.read(profile,'production-flows'),getSessions:()=>store.read(profile,'sessions'),getRuntime:()=>runtime,inspect,mediaOptions:media,getPublicationConnector:()=>createZernioPublicationConnector(()=> 'fixture',{fetchImpl}),getConnector:()=>({upsert:async(payload,ctx)=>{ctx.authorize();return {pageId:'12345678-1234-1234-1234-123456789abc',url:'https://www.notion.so/12345678123412341234123456789abc',artifactVersion:payload.artifact.version,verifiedAt:at}},readCard:async()=>({text:'Notas editadas pelo usuário no Notion',fetchedAt:at})})});
let bridge=makeBridge();
const seed=new DatabaseSync(dbPath);seed.prepare('INSERT INTO editorial_state VALUES(?,?,?,?)').run(profile,1,JSON.stringify({schemaVersion:1,topics:[topic],contents:[],artifacts:[],approvals:[],runs:[],assets:[],publications:[]}),at);seed.close();bridge.jobs.configure(profile,workspaceId,{dataSourceId:'12345678-1234-1234-1234-123456789abc',autoSync:true});
registerEditorialFilesIpc({ipcMain,dialog:{showOpenDialog:async()=>({canceled:false,filePaths:[input]})},shell:{openPath:async()=>''},getWindow:()=>win,getStore:()=>store});
const json=(response,value)=>{response.setHeader('content-type','application/json');response.end(JSON.stringify(value))};
const server=createServer(async(request,response)=>{const url=new URL(request.url,'http://localhost');if(images.handle(request,response,url))return;if(await bridge.handle(request,response,url))return;if(url.pathname.endsWith('/health'))return json(response,{ready:true,accountType:'chatgpt'});if(url.pathname.endsWith('/models'))return json(response,{models:[]});if(url.pathname.endsWith('/images'))return json(response,{events:[]});if(url.pathname.startsWith('/api/'))return json(response,{});try{const file=resolve(root,'dist',url.pathname==='/'?'app.html':url.pathname.slice(1));assert(file.startsWith(resolve(root,'dist')+sep));response.setHeader('content-type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream');response.end(readFileSync(file))}catch{response.statusCode=404;response.end()}});
const log=[],errors=[],js=code=>win.webContents.executeJavaScript(code);async function until(check,timeout=60000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,40))}throw Error('Semi-automatic UI timed out')}
async function click(selector){await until(()=>js(`Boolean(document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled)`));await js(`document.querySelector(${JSON.stringify(selector)}).click()`)}
async function button(text){await until(()=>js(`Array.from(document.querySelectorAll('button')).some(el=>(el.querySelector('.select-menu-option-copy b')?.textContent??el.textContent).trim()===${JSON.stringify(text)}&&!el.disabled)`));await js(`Array.from(document.querySelectorAll('button')).find(el=>(el.querySelector('.select-menu-option-copy b')?.textContent??el.textContent).trim()===${JSON.stringify(text)}&&!el.disabled).click()`)}
async function inputText(selector,value){await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`)}
async function shot(name){writeFileSync(join(out,`${name}.png`),await captureReadyPng(win.webContents))}
async function open(){win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{preload:resolve(root,'tests/fixtures/assets-ui-preload.cjs'),contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});win.webContents.on('console-message',event=>{if(/Uncaught|Maximum update depth|Cannot update a component/.test(event.message))errors.push(event.message)});await win.loadURL(`http://127.0.0.1:${server.address().port}/app.html#flow`);await until(()=>js('Boolean(document.querySelector(".production-flow-page"))'))}
app.whenReady().then(async()=>{try{
 const speech=join(out,'speech.wav'),voice=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Add-Type -AssemblyName System.Speech;$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;$v=$s.GetInstalledVoices()|Where-Object{$_.VoiceInfo.Culture.Name -eq 'pt-BR'}|Select-Object -First 1;if(-not $v){exit 3};$b=New-Object System.Speech.Synthesis.PromptBuilder([System.Globalization.CultureInfo]'pt-BR');$b.StartVoice($v.VoiceInfo);foreach($p in ($env:SPEECH_PARTS -split '\\|')){$b.AppendText($p);$b.AppendBreak([TimeSpan]::FromMilliseconds(1600))};$b.EndVoice();$s.SetOutputToWaveFile($env:SPEECH_OUT);$s.Speak($b);$s.Dispose()"],{env:{...process.env,SPEECH_PARTS:'Hoje vamos falar de edição|Hoje vamos falar de edição automática no computador|Obrigado por assistir',SPEECH_OUT:speech},windowsHide:true});if(voice.status!==0)throw Error('Windows pt-BR voice unavailable');
  await runMediaProcess('ffmpeg',['-nostdin','-v','error','-n','-f','lavfi','-i','testsrc2=size=320x180:rate=24','-i',speech,'-shortest','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-ar','48000',input]);const originalSha=createHash('sha256').update(readFileSync(input)).digest('hex');await runMediaProcess('ffmpeg',['-nostdin','-v','error','-n','-f','lavfi','-i','color=c=white:size=64x96','-frames:v','1',png]);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));await open();await button('Iniciar produção');await click('[aria-label="Ideia da produção"]');await button(topic.title);await until(()=>js('document.querySelector(".production-preflight [role=status]")?.textContent.includes("Nenhum bloqueio")'));assert.equal(await js('Array.from(document.querySelectorAll(".flow-dialog button")).find(el=>el.textContent.includes("Aprovar ideia e iniciar produção")).disabled'),true);assert.equal(bridge.production.list(profile).length,0);await click('.production-panel-body .production-check input[type=checkbox]');await until(()=>js('document.querySelector(".production-panel-body .production-check input[type=checkbox]").checked===true'));await button('Aprovar ideia e iniciar produção');await until(()=>js('document.body.textContent.includes("Aguardando aprovação do roteiro")'));await click('.production-script .production-check input');await button('Aprovar roteiro');await until(()=>js('document.body.textContent.includes("Aguardando gravação")'));assert.equal(posts,0);await button('Adicionar arquivos');await until(()=>js('document.querySelector(".production-panel-body").textContent.includes("original.mp4")'));await click('[aria-label="Vídeo da produção"]');await button('original.mp4');assert(await js(`document.querySelector('[aria-label="Movimento na edição"]')?.textContent.includes("Equilibrado")===true`),'motion intensity offered for the automatic edit');await button('Enviar vídeo e iniciar edição automática');await until(()=>js('document.body.textContent.includes("Aguardando aprovação do vídeo")'));const run1=bridge.production.list(profile)[0],job1=bridge.media.list(profile).find(job=>job.id===run1.videoJobId);
  assert.equal(run1.editPlan.mode,'smart');assert.equal(run1.editPlan.transcribed,true,'local whisper ran');assert(run1.editPlan.cuts>=2,`cuts ${run1.editPlan.cuts}`);
  assert.equal(job1.mode,'advanced');assert.deepEqual(job1.plan.animations.map(item=>item.kind),['title','cta'],'Remotion overlays planned');
  const raw=await probeVideo(input),edited=await probeVideo(job1.result.file.path);assert(edited.duration<raw.duration-1.5,`edited ${edited.duration} raw ${raw.duration}`);assert.equal(edited.hasAudio,true);
  log.push(`automatic: raw ${raw.duration.toFixed(2)}s -> edited ${edited.duration.toFixed(2)}s, ${run1.editPlan.cuts} cuts, retakes ${run1.editPlan.possibleRetakes.length}, animations ${job1.plan.animations.length}`);
  for(const [name,time] of [['frame-title',1],['frame-end',edited.duration-0.8]])await runMediaProcess('ffmpeg',['-nostdin','-v','error','-n','-ss',String(time),'-i',job1.result.file.path,'-frames:v','1',join(out,`${name}.png`)]);
  const state1=JSON.parse(new DatabaseSync(dbPath).prepare('SELECT state_json FROM editorial_state WHERE profile_id=?').get(profile).state_json),srt=state1.assets.find(item=>item.subtitlesForJobId===job1.id);
  assert(srt,'SRT attached to the automatic edit');const srtText=readFileSync(srt.versions[0].path,'utf8');assert.match(srtText,/-->/);assert.match(srtText,/assistir/i);writeFileSync(join(out,'captions.srt'),srtText);
  // ---- Preview, transcript editing, voice, focus and export (editing upgrade 09/10) ----
  const previews=[],originalPreview=bridge.media.preview.bind(bridge.media);bridge.media.preview=async(...args)=>{const result=await originalPreview(...args);previews.push(result);return result;};
  await button('Conferir edição (bruto × editado)');
  await until(()=>js('Boolean(document.querySelector(".edit-preview"))'));
  await until(()=>previews.length>=1,120000);
  await until(()=>js('(()=>{const v=document.querySelector(".edit-preview-stage video");return Boolean(v&&v.readyState>=1&&v.duration>0)})()'),60000);
  const p1=previews.at(-1),exported1=await probeVideo(job1.result.file.path);
  assert(Math.abs(p1.composition.durationSeconds-exported1.duration)<0.15,`preview ${p1.composition.durationSeconds}s vs exported ${exported1.duration}s`);
  assert.equal(p1.planHash,job1.planHash,'first preview = the plan of the exported edit');
  assert.deepEqual(p1.overlays.sort(),['cta','title'],'same overlays as the render');
  assert.equal(p1.preview.audio==='processed'||p1.preview.audio==='processed-sfx',true);
  log.push(`preview v1: ${p1.composition.width}x${p1.composition.height} ${p1.composition.fps}fps ${p1.composition.durationSeconds}s (export ${exported1.duration}s), proxy ${p1.preview.width}x${p1.preview.height}, audio ${p1.preview.audio}`);
  await js('document.querySelector(".edit-preview").scrollIntoView()');await shot('preview-ready');
  // Seek by clicking the compact timeline, then play a little: the Player really advances.
  await js('(()=>{const t=document.querySelector(".edit-preview-track");const b=t.getBoundingClientRect();t.dispatchEvent(new MouseEvent("click",{bubbles:true,clientX:b.left+b.width*0.5,clientY:b.top+4}))})()');
  await until(()=>js('document.querySelector(".edit-preview-timeline small").textContent.trim().startsWith("00:00.00")===false'));
  // Keep a pause: select the words on both sides of the first automatic cut and keep it.
  // (an internal cut between two kept segments, i.e. a pause between phrases)
  const reviewData=await bridge.media.review(profile,{jobId:job1.id}),allWords=(reviewData.transcript.words??[]).filter(word=>word.text.trim()),segs=job1.plan.segments;
  const gaps=segs.slice(1).map((item,index)=>({start:segs[index].end,end:item.start}));
  const pick=gaps.map(g=>({gap:g,before:allWords.reduce((found,word,index)=>word.end<=g.start+0.05?index:found,-1),after:allWords.findIndex(word=>word.start>=g.end-0.05)})).find(item=>item.before>=0&&item.after>item.before);
  assert(pick,`an internal cut with words on both sides: ${JSON.stringify(gaps)}`);const gap=pick.gap,cutIndex=reviewData.cuts.findIndex(item=>Math.abs(item.start-gap.start)<0.01);
  await js(`document.querySelectorAll(".edit-transcript-word")[${pick.before}].click()`);await js(`document.querySelectorAll(".edit-transcript-word")[${pick.after}].click()`);
  await button('Manter (desfazer corte/pausa)');await until(()=>js(`document.querySelectorAll(".edit-review-cuts li")[${cutIndex}]?.classList.contains("is-kept")`));
  log.push(`kept the pause ${gap.start.toFixed(2)}-${gap.end.toFixed(2)}s from the transcript`);
  // Transcript: select a phrase (two clicks) and cut it.
  const wordCount=await js('document.querySelectorAll(".edit-transcript-word").length');assert(wordCount>=8,`transcript words ${wordCount}`);
  // Words to cut: two kept words away from the pause kept above.
  const keptIdx=(await js('Array.from(document.querySelectorAll(".edit-transcript-word")).map((el,i)=>[i,el.classList.contains("is-cut")]).filter(([,cut])=>!cut).map(([i])=>i)')).filter(i=>i<pick.before-1||i>pick.after+1);
  const later=keptIdx.filter(i=>i>pick.after+1),[first,last]=later.length>=3?[later[0],later[1]]:[keptIdx[0],keptIdx[1]];
  const phrase=await js(`[${first},${last}].map(i=>document.querySelectorAll(".edit-transcript-word")[i].textContent).join(" … ")`);
  await js(`document.querySelectorAll(".edit-transcript-word")[${first}].click()`);await js(`document.querySelectorAll(".edit-transcript-word")[${last}].click()`);
  await until(()=>js('document.querySelector(".edit-transcript-actions b")?.textContent.length>0'));
  await button('Cortar trecho');
  await until(()=>js('Boolean(document.querySelector("[data-od-id=edit-preview-stale]"))'));
  await until(()=>js(`document.querySelectorAll(".edit-transcript-word")[${first}].classList.contains("is-cut")`));
  log.push(`transcript cut "${phrase}" -> preview marked out of date`);
  // Undo really restores, then cut again.
  const manualBefore=await js('document.querySelectorAll(".smart-manual-list li").length');
  await button('Desfazer último ajuste');await until(()=>js(`document.querySelectorAll(".smart-manual-list li").length===${manualBefore-1}`));
  await until(()=>js(`!document.querySelectorAll(".edit-transcript-word")[${first}].classList.contains("is-cut")`));
  await js(`document.querySelectorAll(".edit-transcript-word")[${first}].click()`);await js(`document.querySelectorAll(".edit-transcript-word")[${last}].click()`);await button('Cortar trecho');
  await until(()=>js('Boolean(document.querySelector("[data-od-id=edit-preview-stale]"))'));
  // Voice treatment (opt-in): level + smooth joins (after the server snapped the cut edges: controls are busy meanwhile).
  await until(()=>js('document.querySelectorAll(".smart-manual-list li").length>0&&!document.querySelector("[data-od-id=voice-treatment] input").disabled'));
  await js('Array.from(document.querySelectorAll("[data-od-id=voice-treatment] label")).find(l=>l.textContent.includes("Nivelar"))?.querySelector("input")?.click()');
  await js('Array.from(document.querySelectorAll("[data-od-id=voice-treatment] label")).find(l=>l.textContent.includes("Suavizar"))?.querySelector("input")?.click()');
  await until(()=>js('Array.from(document.querySelectorAll("[data-od-id=voice-treatment] input")).filter(i=>i.checked).length===2'));
  log.push(`voice: ${await js('Array.from(document.querySelectorAll("[data-od-id=voice-treatment] label, [data-od-id=voice-treatment] p")).map(el=>(el.querySelector("input")?.checked?"[x] ":el.querySelector("input")?"[ ] ":"")+el.textContent).join(" / ")')}`);
  // Focus: pick on the raw frame (upper-left third).
  await click('[data-od-id=edit-focus-pick]');await until(()=>js('Boolean(document.querySelector(".edit-focus-pick"))'));
  await js('(()=>{const v=document.querySelector(".edit-review-raw video");v.scrollIntoView();const b=v.getBoundingClientRect();const scale=Math.min(b.width/v.videoWidth,b.height/v.videoHeight),w=v.videoWidth*scale,h=v.videoHeight*scale;document.querySelector(".edit-focus-pick").dispatchEvent(new MouseEvent("click",{bubbles:true,clientX:b.left+(b.width-w)/2+w*0.3,clientY:b.top+(b.height-h)/2+h*0.35}))})()');
  await until(()=>js('document.querySelector("[data-od-id=edit-focus]").textContent.includes("Vídeo todo")'));
  const focusText=await js('document.querySelector("[data-od-id=edit-focus] ol").textContent');log.push(`focus picked: ${focusText}`);
  // Your own motion moments: push in on one kept phrase, highlight one word (literal text).
  const keptNow=await js('Array.from(document.querySelectorAll(".edit-transcript-word")).map((el,i)=>[i,el.classList.contains("is-cut")]).filter(([,cut])=>!cut).map(([i])=>i)');
  const [pa,pb]=[keptNow[1],keptNow[2]],hi=keptNow[4],hiText=await js(`document.querySelectorAll(".edit-transcript-word")[${hi}].textContent`);
  await js(`document.querySelectorAll(".edit-transcript-word")[${pa}].click()`);await js(`document.querySelectorAll(".edit-transcript-word")[${pb}].click()`);await button('Aproximar câmera');
  await until(()=>js('Array.from(document.querySelectorAll(".edit-review-motion-list li")).some(li=>li.textContent.includes("escolhido por você")&&li.textContent.includes("Aproximação"))'));
  await js(`document.querySelectorAll(".edit-transcript-word")[${hi}].click()`);await js(`document.querySelectorAll(".edit-transcript-word")[${hi}].click()`);
  await until(()=>js('document.querySelector(".edit-transcript-actions b")?.textContent.length>0'));await button('Destacar texto');
  await until(()=>js(`Array.from(document.querySelectorAll(".edit-review-motion-list li")).some(li=>li.textContent.includes("escolhido por você")&&li.textContent.includes(${JSON.stringify(hiText)}))`));
  log.push(`user motion: punch-in + highlight "${hiText}"`);
  // Cancel a running preview: no error, nothing stuck.
  await click('[data-od-id=edit-preview-prepare]');await until(()=>js('document.querySelector(".edit-preview").textContent.includes("Preparando prévia")'));
  await js('Array.from(document.querySelectorAll(".edit-preview button")).find(b=>b.textContent==="Cancelar").click()');
  await until(()=>js('!document.querySelector(".edit-preview").textContent.includes("Preparando prévia")'));
  assert.equal(await js('Boolean(document.querySelector(".edit-preview [role=alert]"))'),false,'cancel is not an error');
  log.push('preview cancel: idle, no error');
  // Update the preview with all adjustments.
  const before=previews.length;await click('[data-od-id=edit-preview-prepare]');await until(()=>previews.length>before&&js('!document.querySelector("[data-od-id=edit-preview-stale]")'),120000);
  const p2=previews.at(-1);
  await until(()=>js('(()=>{const v=document.querySelector(".edit-preview-stage video");return Boolean(v&&v.readyState>=1&&v.duration>0)})()'),60000);
  assert(Math.abs(p2.composition.durationSeconds-p2.outputDuration)<0.15&&Math.abs(p2.outputDuration-p1.outputDuration)>0.05,`preview follows the draft ${p1.outputDuration} -> ${p2.outputDuration} (${p2.composition.durationSeconds})`);
  assert(p2.props.motion?.reframe,'manual focus reaches the composition');assert.notEqual(p2.preview.id,p1.preview.id);
  assert(p2.props.motion.cues.filter(cue=>cue.id.startsWith('user-')).length>=2,'user cues in the composition: '+JSON.stringify(p2.props.motion.cues.map(cue=>cue.id)));
  log.push(`preview v2: ${p2.composition.durationSeconds}s, audio ${p2.preview.audio}, reframe ${JSON.stringify(p2.props.motion.reframe.points.map(({x,y})=>[x,y]))}`);
  await js('document.querySelector(".edit-preview").scrollIntoView()');await shot('preview-adjusted');
  // Context isolation: the proxy is only served for its own content/asset.
  const foreign=await js(`fetch('/api/content/media/preview-file?profile=${profile}&contentId=other&assetId=${job1.assetId}&id=${p2.preview.id}').then(r=>r.status)`);assert.equal(foreign,404);
  const traversal=await js(`fetch('/api/content/media/preview-file?profile=${profile}&contentId=${job1.contentId}&assetId=${job1.assetId}&id=..%2F..%2Fworkspace-state').then(r=>r.status)`);assert.equal(traversal,404);
  log.push('preview stream: foreign content 404, traversal 404');
  // Export the adjusted version: the final file is the previewed plan.
  await button('Exportar versão com meus ajustes');
  await until(()=>js('document.body.textContent.includes("Versão ajustada exportada e verificada.")'),240000);
  const adjusted=bridge.media.list(profile).filter(job=>job.mode==='advanced'&&job.status==='succeeded').sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
  assert.equal(adjusted.planHash,p2.planHash,'exported plan = previewed plan');
  const final=await probeVideo(adjusted.result.file.path);assert(Math.abs(final.duration-p2.composition.durationSeconds)<0.15,`final ${final.duration} vs preview ${p2.composition.durationSeconds}`);
  assert.equal(adjusted.plan.audio?.leveling,true);assert.equal(adjusted.plan.audio?.smoothCuts,true);assert(adjusted.plan.motion?.reframe,'reframe exported');
  assert.equal(adjusted.plan.motion.cues.filter(cue=>cue.source==='user').length,2,'user moments exported');assert(adjusted.plan.motion.cues.some(cue=>cue.text===hiText.trim()),'highlight text is the literal word');
  assert(adjusted.plan.segments.some(item=>item.start<=gap.start+0.01&&item.end>=gap.end-0.01),'kept pause is in the final edit');
  const cutWords={start:allWords[first].start,end:allWords[last].end},keptOfCut=adjusted.plan.segments.reduce((sum,item)=>sum+Math.max(0,Math.min(item.end,cutWords.end)-Math.max(item.start,cutWords.start)),0);
  assert(keptOfCut<0.1*(cutWords.end-cutWords.start),`transcript-cut words are out of the final edit (${keptOfCut}s kept of ${JSON.stringify(cutWords)} in ${JSON.stringify(adjusted.plan.segments)})`);
  for(const [name,time] of [['adjusted-frame-start',0.6],['adjusted-frame-end',final.duration-0.6]])await runMediaProcess('ffmpeg',['-nostdin','-v','error','-n','-ss',String(time),'-i',adjusted.result.file.path,'-frames:v','1',join(out,`${name}.png`)]);
  log.push(`exported adjusted: ${exported1.duration}s -> ${final.duration}s (preview ${p2.composition.durationSeconds}s), audio ${JSON.stringify(adjusted.plan.audio)}`);
  await shot('adjusted-exported');
  // Word-by-word captions on the adjusted video (production caption review), then the libass-compatible version exists.
  await button('Usar esta versão na produção');await until(()=>bridge.production.list(profile)[0].outputVideo?.assetId!==run1.outputVideo.assetId,60000);
  await until(()=>js('Boolean(document.querySelector(".caption-review"))'),60000);
  await click('[aria-label="Tipo de legenda"]');await button('Palavra a palavra (1–3 por vez)');
  await button('Transcrever fala (Whisper local)');
  await until(()=>bridge.production.list(profile)[0].captions?.transcription?.status&&bridge.production.list(profile)[0].captions.transcription.status!=='running',240000);
  const captionsRun=bridge.production.list(profile)[0].captions,wordVersion=captionsRun.versions.at(-1);
  assert.equal(captionsRun.transcription.status,'done',captionsRun.transcription.error);assert.equal(captionsRun.transcription.mode,'words');
  assert(wordVersion.warnings.includes('word-timing')||wordVersion.warnings.includes('no-word-timing'),JSON.stringify(wordVersion.warnings));
  if(wordVersion.warnings.includes('word-timing'))assert(wordVersion.segments.every(item=>item.text.split(' ').length<=3),JSON.stringify(wordVersion.segments));
  await until(()=>js('document.querySelector(".caption-review").textContent.includes("cada legenda usa o tempo reconhecido")&&!document.querySelector(".caption-review").textContent.includes("Transcrevendo localmente")'),60000);
  log.push(`word captions: ${wordVersion.segments.length} captions, timing ${wordVersion.timing}, warnings ${wordVersion.warnings.join(',')}, first "${wordVersion.segments.slice(0,3).map(item=>item.text).join(' | ')}"`);
  await js('document.querySelector(".caption-review").scrollIntoView()');await shot('word-captions');
  assert.equal(createHash('sha256').update(readFileSync(input)).digest('hex'),originalSha,'original untouched');
  assert.deepEqual(errors,[]);writeFileSync(join(out,'journey.log'),log.join('\n'));
  console.log(`EDIT_PREVIEW_UI_OK: ${log.join(' | ')} | artifacts ${out}`);
  win.destroy();await bridge.close();store.close();server.close();app.exit(0);

 }catch(error){console.error(error);console.error(errors);console.error(log.join(' | '));if(win&&!win.isDestroyed()){console.log(await js('document.body.innerText'));await shot('failure');win.destroy()}await bridge.close();store.close();server.close();app.exit(1)}
});
