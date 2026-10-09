import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {runMediaProcess} from '../editorial-media.mjs';
import {inspectLocalAsset} from '../editorial-local-files.mjs';
import {createProductionFlow} from '../src/features/flows/flowModel.ts';
import {notionPageId,validateRecordedEntry,recordedContextPrompt} from '../production-import.mjs';
import {productionPreflight} from '../production-preflight.mjs';

// Two contents (A/B) in the SAME entry agent, each in its own chat session; simulated CLI, Notion and FFmpeg-made media.
const inspect=path=>inspectLocalAsset(path,{stabilityMs:0});
const CARD='12345678123412341234123456789abc',BASE='abcdefabcdefabcdefabcdefabcdefab';
async function until(check){const end=Date.now()+30000;while(Date.now()<end){if(check())return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Timed out');}
async function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'content-sessions-')),dbPath=join(directory,'state.sqlite'),files={};
 for(const [key,freq] of [['a',440],['b',660]]){files[key]=join(directory,`recorded-${key}.mp4`);await runMediaProcess('ffmpeg',['-nostdin','-v','error','-n','-f','lavfi','-i','testsrc2=size=160x90:rate=24','-f','lavfi','-i',`sine=frequency=${freq}:sample_rate=48000`,'-t','1.2','-c:v','libx264','-c:a','aac',files[key]]);}
 const at=new Date().toISOString(),base={workspaceId:'space',instructions:'Keep my role and own skills',tools:['files'],skills:['own-skill'],providerId:'codex',createdAt:at,updatedAt:at};
 const agents=[{...base,id:'source',name:'Editor de Conteúdo',role:'Conteúdo'},{...base,id:'editor',name:'Editor de Vídeo',role:'Vídeo'}],flow=createProductionFlow('space','Content creation',agents);
 const prompts=[],threads=new Map(),executions=new Map();let serial=0,notionWrites=0,cardReads=0,cardFails=false;
 const output=prompt=>prompt.includes('"removeSilences"')?JSON.stringify({removeSilences:true,silence:{thresholdDb:-35,minDuration:0.5,padding:0.15},normalizeAudio:false,animations:{},summary:'Cortar pausas'}):prompt.includes('Retorne SOMENTE JSON: {"start"')?JSON.stringify({start:0,duration:1.2,format:'original',normalizeAudio:true,fadeSeconds:.1,summary:'Acabamento'}):prompt.includes('Prepare legendas')?JSON.stringify({deliveries:[{platform:'Instagram',caption:'Legenda',coverPrompt:'Capa'}]}):'{}';
 const runtime={createSession:async()=>{const id=`thread-${++serial}`;threads.set(id,{turns:[]});return id},resumeSession:async()=>{},readThread:async id=>threads.get(id),cancel:async()=>{},
  send:async(thread,prompt,agent)=>{prompts.push({prompt,agent});const id=`execution-${++serial}`;executions.set(id,{thread,prompt,output:output(prompt)});return {executionId:id}},
  events:async function*(id){const e=executions.get(id);yield {type:'message.completed',content:e.output};threads.get(e.thread).turns.push({id,status:'completed',items:[{type:'userMessage',content:[{type:'text',text:e.prompt}]},{type:'agentMessage',text:e.output}]});yield {type:'execution.completed'}}};
 const sessions=[{id:'session-a',agentId:'source',contentId:'content-a',topicId:'topic-a',title:'Vídeo A',messages:[],createdAt:at,updatedAt:at},{id:'session-b',agentId:'source',contentId:'content-b',topicId:'topic-b',title:'Vídeo B',messages:[],createdAt:at,updatedAt:at},{id:'generic',agentId:'source',title:'Chat livre',messages:[],createdAt:at,updatedAt:at}];
 const options={dbPath,getCurrentProfile:()=> 'owner',getAgents:()=>agents,getFlows:()=>({flows:[flow]}),getSessions:()=>sessions,getRuntime:()=>runtime,inspect,mediaOptions:{inspect},
  getConnector:()=>({upsert:async()=>{notionWrites++;throw Error('No card may be written')},readCard:async(pageId,dataSourceId,contentId)=>{cardReads++;if(cardFails)throw Error('Página não compartilhada com a integração.');assert.equal(dataSourceId.replaceAll('-',''),BASE);return {pageId,contentId,text:`CARD_B_CONTEXT ${pageId}`,fetchedAt:new Date().toISOString()}}})};
 let bridge=createContentWorkflowBridge(options);const db=new DatabaseSync(dbPath);
 const topic=(id,title)=>({id,workspaceId:'space',requestId:id,inputKind:'text',input:title,priority:'normal',status:'draft',title,category:'Gravação',summary:'Gravação adicionada',whyItMatters:'Local',angles:[],sources:[],factualQuestions:[],contentId:id.replace('topic','content'),createdAt:at,updatedAt:at});
 const content=(id,topicId,title)=>({id,workspaceId:'space',topicId,title,format:'short-video',platforms:[],status:'planning',productionStage:'recording',taskId:`task-${id}`,createdAt:at,updatedAt:at});
 const assets=[];for(const key of ['a','b']){const file=await inspect(files[key]);assets.push({id:`video-${key}`,workspaceId:'space',contentId:`content-${key}`,kind:'video',role:'source',status:'available',name:file.name,currentVersionId:`v-${key}`,versions:[{id:`v-${key}`,path:file.path,name:file.name,size:file.size,sha256:file.sha256,modifiedAt:file.modifiedAt,createdAt:at}],createdAt:at,updatedAt:at});}
 db.prepare('INSERT INTO editorial_state VALUES(?,?,?,?)').run('owner',1,JSON.stringify({schemaVersion:1,topics:[topic('topic-a','Vídeo A'),topic('topic-b','Vídeo B')],contents:[content('content-a','topic-a','Vídeo A'),content('content-b','topic-b','Vídeo B')],artifacts:[],approvals:[],runs:[],assets,publications:[]}),at);
 bridge.jobs.configure('owner','space',{dataSourceId:BASE,autoSync:false});
 const run=id=>bridge.production.list('owner').find(p=>p.id===id);
 const command=(id,action,data={})=>bridge.production.command('owner',{id,revision:run(id).revision,requestId:`command-${++serial}`,action,...data});
 const recorded=(contentKey,context,extra={})=>bridge.production.start('owner',{requestId:`recorded-${contentKey}`,entry:'recorded',flowId:flow.id,contentId:`content-${contentKey}`,sourceSessionId:`session-${contentKey}`,assetId:`video-${contentKey}`,context,format:'original',editMode:'basic',authorize:true,...extra});
 return {bridge,get production(){return bridge.production},db,flow,sessions,prompts,run,command,recorded,counts:()=>({notionWrites,cardReads,sends:prompts.length,jobs:bridge.jobs.list('owner').length}),failCards:value=>cardFails=value,reopen:async()=>{await bridge.close();bridge=createContentWorkflowBridge(options)},close:async()=>{await bridge.close();db.close()}};
}

test('Notion card link parsing accepts only a card link or id, never a title or foreign host',()=>{
 assert.equal(notionPageId(`https://www.notion.so/Meu-video-${CARD}`),CARD);
 assert.equal(notionPageId('12345678-1234-1234-1234-123456789abc'),CARD);
 assert.equal(notionPageId('https://evil.example.com/12345678123412341234123456789abc'),null);
 assert.equal(notionPageId('Meu vídeo sobre automação'),null);
 assert.throws(()=>validateRecordedEntry({assetId:'x',context:{kind:'text',text:'curto'}}),/20 a 20.000/);
 assert.throws(()=>validateRecordedEntry({assetId:'x',context:{}}),/card do Notion existente ou cole/);
 const prompt=recordedContextPrompt({entry:{origin:'text',context:{text:'Contexto colado'}}});
 assert.match(prompt,/não gerou nem aprovou roteiro/);assert.match(prompt,/Você não vê o vídeo/);assert.match(prompt,/Contexto colado/);
});

test('recorded preflight never asks for an idea or a Notion write and blocks a missing video or base',()=>{
 const flow={id:'f',workspaceId:'space',nodes:[]},topic={id:'t',workspaceId:'space',status:'draft',title:'Vídeo'};
 const report=productionPreflight({flow,topic,scriptMode:'local',entry:{kind:'recorded',context:'notion',video:false},notion:{dataSourceId:''}});
 assert(report.blockers.some(c=>c.id==='recording'));assert(report.blockers.some(c=>c.id==='notion-destination'));assert(!report.blockers.some(c=>c.id==='topic'));
 assert(!report.checks.some(c=>c.id==='notion-access'));
});

test('two contents in the same agent enter with recorded videos, stay isolated and resume without repeating work',async()=>{
 const f=await fixture();try{
  // Inaccessible card: honest error, nothing invented, nothing created.
  f.failCards(true);
  await assert.rejects(()=>f.production.readImportCard('owner',{workspaceId:'space',contentId:'content-b',card:`https://www.notion.so/Video-${CARD}`}),/Não foi possível ler este card.*Nada foi criado/);
  assert.throws(()=>f.recorded('b',{kind:'notion',pageId:CARD}),/Leia o card escolhido/);
  assert.equal(f.production.list('owner').length,0);
  f.failCards(false);
  await assert.rejects(()=>f.production.readImportCard('owner',{workspaceId:'space',contentId:'content-b',card:'título do card'}),/link ou o ID/);
  const card=await f.production.readImportCard('owner',{workspaceId:'space',contentId:'content-b',card:`https://www.notion.so/Video-${CARD}`});
  assert.equal(card.pageId,CARD);assert.match(card.excerpt,/CARD_B_CONTEXT/);
  // A card read for B cannot be used by A; a session of B cannot start A.
  assert.throws(()=>f.recorded('a',{kind:'notion',pageId:CARD}),/Leia o card escolhido/);
  assert.throws(()=>f.recorded('a',{kind:'text',text:'Contexto do vídeo A com detalhes suficientes.'},{requestId:'wrong-session',sourceSessionId:'session-b'}),/sessão deste conteúdo/);
  assert.throws(()=>f.recorded('a',{kind:'text',text:'Contexto do vídeo A com detalhes suficientes.'},{requestId:'not-authorized',authorize:false}),/autorize/);

  const a=f.recorded('a',{kind:'text',text:'TEXT_A_CONTEXT: demonstração de automação gravada ontem.'}),b=f.recorded('b',{kind:'notion',pageId:CARD});
  assert.equal(f.recorded('a',{kind:'text',text:'TEXT_A_CONTEXT: demonstração de automação gravada ontem.'}).id,a.id,'same decision is idempotent');
  assert.equal(f.recorded('a',{kind:'text',text:'Outro texto, mesmo vídeo e conteúdo, nova decisão.'},{requestId:'again'}).id,a.id,'same content+video never duplicates');
  for(const [p,session,key] of [[a,'session-a','a'],[b,'session-b','b']]){
   assert.equal(p.stage,'planning-edit');assert.equal(p.sourceSession.id,session);assert.equal(p.sourceSession.agentId,'source');assert.deepEqual(p.sourceAgent.skills,['own-skill']);
   assert.equal(p.entry.kind,'recorded');assert.equal(p.entry.video.assetId,`video-${key}`);assert.equal(p.scriptApproval,undefined);assert.deepEqual(p.scriptVersions,[]);assert(p.events.some(e=>e.action==='recorded-import'));
  }
  assert.equal(a.entry.origin,'text');assert.equal(a.scriptMode,'local');assert.equal(b.entry.origin,'notion');assert.equal(b.notion.pageId,CARD);
  await until(()=>['video-review','blocked'].includes(f.run(a.id).stage)&&['video-review','blocked'].includes(f.run(b.id).stage));
  assert.equal(f.run(a.id).stage,'video-review',f.run(a.id).error);assert.equal(f.run(b.id).stage,'video-review',f.run(b.id).error);
  // No idea/script generation, no Notion write, no editorial job; each prompt only carries its own context.
  assert(f.prompts.every(x=>!x.prompt.includes('hooks')&&x.agent.id==='editor'));assert.equal(f.counts().notionWrites,0);assert.equal(f.counts().jobs,0);assert.equal(f.counts().cardReads,2);
  const promptA=f.prompts.filter(x=>x.prompt.includes('TEXT_A_CONTEXT')),promptB=f.prompts.filter(x=>x.prompt.includes('CARD_B_CONTEXT'));
  assert.equal(promptA.length,1);assert.equal(promptB.length,1);assert(!promptA[0].prompt.includes('CARD_B_CONTEXT'));assert(!promptB[0].prompt.includes('TEXT_A_CONTEXT'));assert.match(promptA[0].prompt,/não gerou nem aprovou roteiro/);
  // Script/recording actions do not apply to a recorded entry.
  await assert.rejects(()=>f.command(a.id,'approve-script',{authorize:true,version:1,expectedHash:'x'}),/vídeo já gravado/);
  await assert.rejects(()=>f.command(a.id,'enable-notion',{authorize:true,notionDestination:BASE}),/vídeo já gravado/);
  // Approving A does not touch B.
  const beforeB=f.run(b.id);await f.command(a.id,'approve-video',{authorize:true,expectedVideo:f.run(a.id).outputVideo});
  assert.equal(f.run(a.id).stage,'platforms');assert.equal(f.run(b.id).stage,'video-review');assert.equal(f.run(b.id).revision,beforeB.revision);assert.deepEqual(f.run(b.id).approvedVideo,undefined);
  // Restart: same stages, no new AI call, no new card read.
  const counts=f.counts();await f.reopen();
  assert.equal(f.run(a.id).stage,'platforms');assert.equal(f.run(b.id).stage,'video-review');
  await new Promise(resolve=>setTimeout(resolve,1200));assert.deepEqual(f.counts(),counts);
  // A's package uses A's context only; B is still waiting for its own review.
  await f.command(a.id,'platforms',{platforms:['Instagram']});await until(()=>['covers-review','blocked'].includes(f.run(a.id).stage));
  assert.equal(f.run(a.id).stage,'covers-review',f.run(a.id).error);
  // Without an app script, cover texts default to the content's own title (never another content or invented text).
  assert(f.run(a.id).covers.concepts.length===3&&f.run(a.id).covers.concepts.every(c=>c.title==='Vídeo A'||c.kicker!==undefined));assert(f.run(a.id).covers.concepts.some(c=>c.title==='Vídeo A'));
  const pkg=f.prompts.at(-1).prompt;assert.match(pkg,/Prepare legendas/);assert.match(pkg,/TEXT_A_CONTEXT/);assert(!pkg.includes('CARD_B_CONTEXT'));
  assert.equal(f.run(b.id).stage,'video-review');assert.equal(f.counts().notionWrites,0);
 }finally{await f.close()}
});

test('an idea production never silently adopts a filled generic chat; an empty generic chat or the content session is reused',async()=>{
 const f=await fixture();try{
  const row=f.db.prepare('SELECT state_json FROM editorial_state').get(),value=JSON.parse(row.state_json),at=new Date().toISOString();
  for(const id of ['c','d'])value.topics.push({id:`topic-${id}`,workspaceId:'space',requestId:id,inputKind:'text',input:'Ideia',priority:'normal',status:'review',title:`Ideia ${id}`,category:'Tech',summary:'Resumo',whyItMatters:'Motivo',angles:[],sources:[],factualQuestions:[],createdAt:at,updatedAt:at});
  f.db.prepare('UPDATE editorial_state SET state_json=?,revision=revision+1').run(JSON.stringify(value));
  f.sessions.find(s=>s.id==='generic').messages.push({id:'m1',type:'message',role:'user',content:'conversa antiga sobre outro assunto',createdAt:at});
  f.sessions.push({id:'empty',agentId:'source',title:'Nova sessão',messages:[],createdAt:at,updatedAt:at});
  const filled=f.production.start('owner',{requestId:'idea-c',flowId:f.flow.id,topicId:'topic-c',scriptMode:'local',authorize:true,sourceSessionId:'generic'});
  assert.notEqual(filled.sourceSession.id,'generic');assert.equal(filled.sourceSession.agentId,'source');
  const empty=f.production.start('owner',{requestId:'idea-d',flowId:f.flow.id,topicId:'topic-d',scriptMode:'local',authorize:true,sourceSessionId:'empty'});
  assert.equal(empty.sourceSession.id,'empty');
 }finally{await f.close()}
});

test('recorded preflight checks only executors that will run: the entry agent is not required to write scripts',()=>{
 const agents=[{id:'chat',name:'Conversa',workspaceId:'space',providerId:'http-api'},{id:'editor',name:'Editor',workspaceId:'space',providerId:'codex'},{id:'pub',name:'Publicação',workspaceId:'space',providerId:'codex'}];
 const flow={id:'f',workspaceId:'space',nodes:[{kind:'content-agent',agentId:'chat'},{kind:'video-agent',agentId:'editor'},{kind:'publishing-agent',agentId:'pub'}]},topic={id:'t',workspaceId:'space',status:'draft',title:'Vídeo'};
 const recorded=productionPreflight({flow,agents,topic,entry:{kind:'recorded',context:'text',video:true},runtime:{connected:true}});
 assert(!recorded.blockers.some(c=>c.id==='source-agent'),JSON.stringify(recorded.blockers));assert.equal(recorded.checks.find(c=>c.id==='source-agent').level,'ok');
 const idea=productionPreflight({flow,agents,topic:{...topic,status:'review'},scriptMode:'local',runtime:{connected:true}});
 assert(idea.blockers.some(c=>c.id==='source-agent'),'the idea path still needs a script-capable entry agent');
});
