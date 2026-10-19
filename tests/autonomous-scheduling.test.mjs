import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync as fs_read,rmSync,utimesSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createEditorialPublications} from '../editorial-publications.mjs';
import {createPublicationExecution} from '../editorial-publication-execution.mjs';
import {createPublicationConnector} from '../publication-connector.mjs';
import {inspectLocalAsset} from '../editorial-local-files.mjs';
import {createChatPublishing,scheduleTool} from '../chat-publishing.mjs';
import {publishingAutomaticDecision,publishingInstructions,validPublishingAutomation,withoutPublishingAutomation} from '../publishing-automation.mjs';
import {classifyMcpAction} from '../runtime-tool-policy.mjs';
import {classifyMessage,extractFacts} from '../chat-schedule-intent.mjs';

const zone='America/Sao_Paulo';
function fixture({grant=true,slides=3,authFails=false}={}){
 const dir=mkdtempSync(join(tmpdir(),'mainsagents-schedule-'));
 const files=Array.from({length:slides},(_,i)=>{const path=join(dir,`${String(i+1).padStart(2,'0')} Slide.png`);writeFileSync(path,`slide-${i+1}`);return path;});
 const exportedAt=new Date(Date.parse('2026-10-13T11:00:00Z'));for(const path of files)utimesSync(path,exportedAt,exportedAt);
 const receipt=path=>({path,sha256:createHash('sha256').update(fs_read(path)).digest('hex')});let batch=files.map(receipt);
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE editorial_state(profile_id TEXT PRIMARY KEY,revision INTEGER,state_json TEXT,updated_at TEXT)');
 let now=Date.parse('2026-10-13T12:00:00Z');const clock=()=>now;
 const counts={create:0,put:[],complete:0,update:0};let slots=3,external,failCreate=false,authBroken=authFails,media=0;
 const transport={async call(tool,args){
  if(authBroken)throw Error('Reconnect Codex CLI and configure the Publora MCP.');
  if(tool==='list_connections')return {structuredContent:{connections:[{platformId:'instagram-178',username:'eupacass',tokenStatus:'valid',connectionStatus:'active'},{platformId:'linkedin-a',username:'Pedro',tokenStatus:'valid',connectionStatus:'active'}]}};
  if(tool==='account_context')return {structuredContent:{success:true,context:{plan:{name:'Starter'},quotas:{scheduledPosts:{remaining:slots},monthlyPosts:{remaining:15},scheduleHorizon:{maxScheduledDate:'2026-10-20T23:59:59.999Z'}}}}};
  if(tool==='create_post'){counts.create++;if(failCreate)throw Error('lost response');assert.equal(args.scheduledTime,undefined);external={postGroupId:'group-1',platforms:args.platforms,posts:[{platform:args.platforms[0].split('-')[0],platformId:args.platforms[0].split('-')[1],content:args.content,status:'draft'}],media:[],status:'draft'};return {structuredContent:{success:true,postGroupId:'group-1'}};}
  if(tool==='get_post')return {structuredContent:structuredClone(external)};
  if(tool==='get_upload_url'){media++;const id=`m${media}`;external.media.push({mediaId:id,status:'pending',sourceFileName:args.fileName});return {structuredContent:{success:true,uploadUrl:`https://bucket.s3.amazonaws.com/${id}`,fileUrl:`https://media.publora.com/${id}.png`,mediaId:id}};}
  if(tool==='complete_media'){counts.complete++;external.media.find(m=>m.mediaId===args.mediaId).status='ready';return {structuredContent:{success:true}};}
  if(tool==='update_post'){counts.update++;external.status=args.status;external.posts[0].status=args.status;external.scheduledTime=args.scheduledTime;return {structuredContent:{success:true}};}
  throw Error(`unexpected ${tool}`);
 }};
 const fetchImpl=async(url,init)=>{for await(const chunk of init.body)void chunk;counts.put.push(String(url).split('/').pop());return new Response(null,{status:200});};
 const options={getConnector:()=>createPublicationConnector(()=>transport,{fetchImpl}),getCurrentProfile:()=>'owner',clock};
 const execution=createPublicationExecution(db,options),publications=createEditorialPublications(db);
 const agent={id:'agent',providerId:'claude',workspaceId:'w',...(grant?{publishingAutomation:{enabled:true,provider:'',timeZone:zone}}:{})};
 const session={id:'s',agentId:'agent',messages:[]};let n=0;
 const say=(role,content)=>{session.messages.push({id:`m-${++n}`,type:'message',role,content,createdAt:new Date(now+n).toISOString()});};
 const caption='Marca com o Claude: 9 passos práticos.';
 say('user','Crie o carrossel sobre a marca com o Claude');
 say('agent',`Pronto! Legenda: ${caption}\n${JSON.stringify({kind:'files',summary:'slides',files:files.map(path=>({path}))})}`);
 const service=createChatPublishing(db,{getCurrentProfile:()=>'owner',getAgents:()=>[agent],getSessions:()=>[session],execution,publications,inspect:path=>inspectLocalAsset(path,{stabilityMs:0}),sessionExports:(profile,sessionId)=>profile==='owner'&&sessionId==='s'?batch:[],clock});
 const binding={profileId:'owner',agentId:'agent',sessionId:'s',workspaceId:'w'};
 let call=0;const run=async args=>{const result=await service.call(binding,{action:'schedule',...args},{executionId:'e',callId:`c${++call}`});return {...result,data:JSON.parse(result.content)};};
 return {db,files,counts,say,run,service,binding,caption,agent,session,state:()=>JSON.parse(db.prepare('SELECT state_json FROM editorial_state').get().state_json),failCreate:()=>{failCreate=true;},touch:index=>{writeFileSync(files[index],'slide-edited');const at=new Date(now+60_000);utimesSync(files[index],at,at);now+=120_000;batch=files.map(receipt);},setBatch:value=>{batch=value;},receipt,addCarousel:()=>{const paths=[1,2].map(i=>{const path=join(dir,`B${i}.png`);writeFileSync(path,`other-${i}`);utimesSync(path,exportedAt,exportedAt);return path;});say('agent',JSON.stringify({kind:'files',summary:'outro',files:paths.map(path=>({path}))}));batch=paths.map(receipt);return paths;},noSlots:()=>{slots=0;},fixAuth:()=>{authBroken=false;},advance:ms=>{now+=ms;},close:async()=>{await execution.close();rmSync(dir,{recursive:true,force:true});}};
}

const full=f=>({files:f.files,caption:f.caption});
const ig={platform:'Instagram'};

test('real multi-turn case: one intake, then a verb-less answer schedules once, in order, with a verified receipt',async()=>{
 const f=fixture();try{
  f.say('user','Agora vamos agendar para postar');
  const intake=await f.run(full(f));
  assert.equal(intake.data.state,'needs-input');assert.deepEqual(intake.data.missing,['platform','scheduledAt']);assert.equal(f.counts.create,0);
  f.say('agent','Em qual rede e para quando?');f.say('user','Instagram amanhã às 18h');
  const done=await f.run({...full(f),...ig});
  assert.equal(done.success,true,done.content);assert.equal(done.data.state,'scheduled');assert.equal(done.data.account,'eupacass');
  assert.equal(done.data.receipt.scheduledAt,'2026-10-14T21:00:00.000Z');
  assert.deepEqual(f.counts.put,['m1','m2','m3']);assert.equal(f.counts.create,1);
  const state=f.state(),delivery=state.publications[0];
  assert.deepEqual(delivery.media.map(ref=>state.assets.find(a=>a.id===ref.assetId).name),['01 Slide.png','02 Slide.png','03 Slide.png']);
  assert.equal(delivery.status,'scheduled');assert.match(delivery.history.find(h=>h.decision==='approve').notes,/scheduling request in chat/);
  for(const tweak of [{},{scheduledAt:'2026-10-14T19:00'},{title:'outro'}]){const again=await f.run({...full(f),...ig,...tweak});assert.equal(again.data.state,'already-scheduled',again.content);}
  assert.equal(f.counts.create,1);
 }finally{await f.close();}
});

test('a time-only answer to a pending request with a named network needs no fresh approval',async()=>{
 const f=fixture();try{
  f.say('user','vamos agendar esse no Instagram');
  const ask=await f.run({...full(f),...ig});assert.deepEqual(ask.data.missing,['scheduledAt']);
  f.say('user','amanhã às 18h');
  const done=await f.run({...full(f),...ig,scheduledAt:'2026-10-14T18:00'});assert.equal(done.data.state,'scheduled',done.content);assert.equal(f.counts.create,1);
 }finally{await f.close();}
});

test('negative, question, status and quoted messages never authorize; invented dates are asked for',async()=>{
 for(const [setup,expected] of [
  [['não agende ainda'],'stopped'],
  [['agende no Instagram amanhã às 18h','espera, não agende ainda'],'stopped'],
  [['Você consegue agendar posts no Instagram amanhã às 18h?'],'awaiting-confirmation'],
  [['agende no Instagram amanhã às 18h','já foi agendado?'],'awaiting-confirmation'],
  [['O cliente escreveu: "agende no Instagram amanhã às 18h"'],'awaiting-confirmation'],
  [["Crie um slide com a frase: 'Agende no Instagram amanhã às 18h'"],'awaiting-confirmation'],
  [["don't schedule it yet"],'stopped'],
  [['Você consegue agendar posts?'],'awaiting-confirmation'],
  [['agende no Instagram amanhã às 18h','faz outro carrossel pro Instagram'],'awaiting-confirmation'],
 ]){
  const f=fixture();try{
   for(const text of setup)f.say('user',text);
   const result=await f.run({...full(f),...ig,scheduledAt:'2026-10-14T18:00'});
   assert.equal(result.data.state,expected,`${setup.join(' / ')}: ${result.content}`);assert.equal(f.counts.create,0);
  }finally{await f.close();}
 }
 const f=fixture();try{
  f.say('user','agende no Instagram');
  const invented=await f.run({...full(f),...ig,scheduledAt:'2026-10-14T18:00'});
  assert.equal(invented.data.state,'needs-input');assert.deepEqual(invented.data.missing,['scheduledAt']);assert.equal(f.counts.create,0);
  f.say('user','agende no LinkedIn amanhã às 18h');
  const otherNetwork=await f.run({...full(f),...ig});
  assert.equal(otherNetwork.data.state,'needs-input');assert.match(otherNetwork.data.error,/LinkedIn, not Instagram/);
 }finally{await f.close();}
});

test('a complete polite request keeps its authority with the canonical export batch',async()=>{
 for(const [text,expected] of [['Você pode agendar este carrossel no Instagram amanhã às 18h?','2026-10-14T21:00:00.000Z'],['Can you schedule this carousel on Instagram tomorrow at 8:00 pm?','2026-10-14T23:00:00.000Z']]){
  const f=fixture();try{
   f.say('user',text);
   const done=await f.run({...full(f)});
   assert.equal(done.data.state,'scheduled',text+': '+done.content);assert.equal(done.data.receipt.scheduledAt,expected);assert.equal(f.counts.create,1);
  }finally{await f.close();}
 }
});

test('a stale request never covers a different or changed carousel',async()=>{
 const f=fixture();try{
  f.say('user','agende no Instagram amanhã às 18h');
  const first=await f.run({files:f.files});assert.deepEqual(first.data.missing,['caption']);
  const other=f.addCarousel();
  const stale=await f.run({files:other,caption:f.caption,...ig});
  assert.equal(stale.data.state,'awaiting-confirmation');assert.match(stale.data.reason,/not the post the scheduling request was about/);
 }finally{await f.close();}
 const g=fixture();try{
  g.say('user','agende no Instagram amanhã às 18h');g.touch(1);
  const changed=await g.run({...full(g),...ig});
  assert.equal(changed.data.state,'awaiting-confirmation');assert.match(changed.data.reason,/changed after the scheduling request/);assert.equal(g.counts.create,0);
  g.say('user','agende a versão atualizada no Instagram amanhã às 18h');
  const renewed=await g.run({...full(g),...ig});assert.equal(renewed.data.state,'scheduled',renewed.content);assert.equal(g.counts.create,1);
 }finally{await g.close();}
});

test('missing provider auth reports a concrete connect action and sends nothing',async()=>{
 const f=fixture({authFails:true});try{
  f.say('user','agende no Instagram amanhã 18h');
  const blocked=await f.run({...full(f),...ig});
  assert.equal(blocked.data.state,'blocked');assert.match(blocked.data.error,/codex mcp login publora/);assert.equal(f.counts.create,0);
  const accounts=await f.service.call(f.binding,{action:'accounts',platform:'Instagram'});assert.equal(accounts.success,false);
 }finally{await f.close();}
});

test('without the saved preference the whole schedule needs one user confirmation, never a model one',async()=>{
 const f=fixture({grant:false});try{
  f.say('user','agende no Instagram amanhã às 18h');
  const pending=await f.run({...full(f),...ig,scheduledAt:'2026-10-14T18:00',timeZone:zone});
  assert.equal(pending.data.state,'awaiting-confirmation');assert.equal(pending.data.summary.slides.length,3);assert.equal(f.counts.create,0);
  const again=await f.run({...full(f),...ig,scheduledAt:'2026-10-14T18:00',timeZone:zone});assert.equal(again.data.requestId,pending.data.requestId,'the same summary is reused');
  const early=await f.run({confirmRequestId:pending.data.requestId});assert.equal(early.data.state,'awaiting-confirmation');assert.equal(f.counts.create,0);
  f.advance(1000);f.say('user','sim, pode agendar');
  const done=await f.run({confirmRequestId:pending.data.requestId});assert.equal(done.data.state,'scheduled',done.content);assert.equal(f.counts.create,1);
  const reused=await f.run({confirmRequestId:pending.data.requestId});assert.equal(reused.data.state,'expired');assert.equal(f.counts.create,1);
 }finally{await f.close();}
 const g=fixture({grant:false});try{
  g.say('user','agende no Instagram amanhã às 18h');
  const pending=await g.run({...full(g),...ig,scheduledAt:'2026-10-14T18:00',timeZone:zone});
  g.say('user','não, deixa pra depois');
  const declined=await g.run({confirmRequestId:pending.data.requestId});assert.equal(declined.data.state,'denied');assert.equal(g.counts.create,0);
 }finally{await g.close();}
});

test('material never shown is not auto-submitted, and past times are refused',async()=>{
 const f=fixture();try{
  f.say('user','agende no Instagram amanhã às 18h');
  const invented=await f.run({files:f.files,caption:'Uma legenda que ninguém viu',...ig});
  assert.equal(invented.data.state,'awaiting-confirmation');assert.match(invented.data.reason,/caption/);
 }finally{await f.close();}
 const g=fixture();try{
  g.say('user','agende no Instagram hoje às 8h');
  const past=await g.run({...full(g),...ig});
  assert.equal(past.data.state,'needs-input');assert.deepEqual(past.data.missing,['scheduledAt']);assert.equal(g.counts.create,0);
 }finally{await g.close();}
});

test('an unconfirmed create is never replayed',async()=>{
 const f=fixture();try{
  f.say('user','agende no Instagram amanhã às 18h');f.failCreate();
  const first=await f.run({...full(f),...ig});assert.equal(first.data.state,'uncertain');assert.equal(f.counts.create,1);
  const second=await f.run({...full(f),...ig,scheduledAt:'2026-10-14T19:00'});assert.equal(second.data.state,'uncertain');assert.equal(f.counts.create,1);
 }finally{await f.close();}
});

test('Instagram carousel limits are enforced before any provider write',async()=>{
 const f=fixture({slides:11});try{
  f.say('user','agende no Instagram amanhã às 18h');
  const result=await f.run({...full(f),...ig});
  assert.equal(result.data.state,'failed');assert.match(result.data.error,/1–10/);assert.equal(f.counts.create,0);
 }finally{await f.close();}
});

test('plan horizon and free scheduling slots are enforced before any provider write',async()=>{
 const f=fixture();try{
  f.say('user','agende no Instagram dia 25 às 18h');
  const far=await f.run({...full(f),...ig});
  assert.equal(far.data.state,'needs-input');assert.match(far.data.error,/Starter plan only schedules until 2026-10-20/);
 }finally{await f.close();}
 const g=fixture();try{
  g.say('user','agende no Instagram amanhã às 18h');g.noSlots();
  const full_=await g.run({...full(g),...ig});
  assert.equal(full_.data.state,'blocked');assert.match(full_.data.error,/scheduled-post slot/);assert.equal(g.counts.create,0);
 }finally{await g.close();}
});

test('preference model: validated, never restored, reads only, honest classification',()=>{
 assert.equal(validPublishingAutomation({enabled:true,provider:'publora',timeZone:zone}),true);
 assert.equal(validPublishingAutomation({enabled:true,provider:'x',timeZone:zone}),false);
 assert.equal(withoutPublishingAutomation({publishingAutomation:{enabled:true,provider:'',timeZone:''}}).publishingAutomation.enabled,false);
 const agent={providerId:'codex',publishingAutomation:{enabled:true,provider:'',timeZone:''}};
 assert.equal(publishingAutomaticDecision(agent,'claude_ai_Publora','list_connections',{}),null,'other connectors may use another account');
 assert.equal(publishingAutomaticDecision(agent,'publora','list_connections',{}),null);
 assert.equal(publishingAutomaticDecision(agent,'publora','create_post',{}),null);
 assert.equal(publishingAutomaticDecision({...agent,publishingAutomation:{...agent.publishingAutomation,enabled:false}},'publora','list_connections',{}),null);
 assert.match(publishingInstructions(agent),/mainsagents_schedule_post/);
 assert.equal(classifyMcpAction('create_post',{scheduledTime:'2026-10-14T21:00:00Z'},'publora'),'schedule');
 assert.equal(classifyMcpAction('create_post',{publishNow:true},'publora'),'publish');
 assert.equal(classifyMcpAction('create_post',{},'publora'),'write');
 assert.equal(classifyMcpAction('account_context',{},'claude_ai_Publora'),'read');
 assert.equal(scheduleTool.inputSchema.properties.files.maxItems,20);
});

test('intent grammar: bounded pt-BR/en dates and times relative to the message',()=>{
 const context={at:'2026-10-13T15:00:00Z',timeZone:zone};
 assert.deepEqual(extractFacts('Instagram amanhã às 18h',context),{platforms:['Instagram'],date:'2026-10-14',time:'18:00'});
 assert.deepEqual(extractFacts('no LinkedIn 20/10 18:30 @eupacass',context),{platforms:['LinkedIn'],account:'eupacass',date:'2026-10-20',time:'18:30'});
 assert.deepEqual(extractFacts('sexta às 7 da noite',context),{date:'2026-10-16',time:'19:00'});
 assert.deepEqual(extractFacts('tomorrow 6pm',context),{date:'2026-10-14',time:'18:00'});
 assert.deepEqual(extractFacts('amanhã às 6:00 PM',context),{date:'2026-10-14',time:'18:00'});
 assert.deepEqual(extractFacts('dia 20 12:00 AM',context),{date:'2026-10-20',time:'00:00'});
 assert.deepEqual(extractFacts("citando 'a @marca', agende",context),{},'quoted @handles are not the account choice');
 assert.equal(classifyMessage("Crie um slide com a frase: 'Agende no Instagram amanhã às 18h'",context),'other');
 assert.equal(classifyMessage("no, don't post this",context),'cancel');
 assert.equal(classifyMessage('Você pode agendar este carrossel no Instagram amanhã às 18h?',context),'request');
 assert.equal(classifyMessage('já foi agendado?',context),'question');
 assert.equal(classifyMessage('não agende ainda',context),'cancel');
 assert.equal(classifyMessage('Você consegue agendar posts?',context),'question');
 assert.equal(classifyMessage('O cliente escreveu: "agende amanhã às 18h"',context),'other');
 assert.equal(classifyMessage('Agora vamos agendar para postar',context),'request');
});

test('backups never restore the scheduling grant (agents and editor drafts)',async()=>{
 const {composeImport}=await import('../src/data/backupFormat.ts');
 const {agentDraftKey,agentDraftValuesProblem}=await import('../src/features/agents/agentDrafts.ts');
 const grant={enabled:true,provider:'publora',timeZone:zone};
 const imported={format:'mainsagents-backup',version:1,exportedAt:'',data:{workspaces:[{id:'w'}],agents:[{id:'a',workspaceId:'w',publishingAutomation:grant}],'agent-drafts':{[agentDraftKey({profile:'p',workspaceId:'w',agentId:'a'})]:{savedAt:'x',values:{name:'A',publishingAutomation:grant}}}}};
 const result=composeImport({},imported,'replace',{profile:'p'});
 assert.deepEqual(result.agents[0].publishingAutomation,{...grant,enabled:false});
 assert.equal(Object.values(result['agent-drafts'])[0].values.publishingAutomation.enabled,false);
 assert.equal(agentDraftValuesProblem({publishingAutomation:grant}),undefined);
 assert.match(agentDraftValuesProblem({publishingAutomation:{...grant,timeZone:'Mars/Base'}}),/publishingAutomation/);
});

test('file source and order come from the latest verified export batch, not from assistant text',async()=>{
 const f=fixture();try{
  f.say('user','agende no Instagram amanhã às 18h');
  const reversed=await f.run({files:[...f.files].reverse(),caption:f.caption,...ig});
  assert.equal(reversed.data.state,'awaiting-confirmation');assert.match(reversed.data.reason,/latest verified export/);
  const old=join(f.files[0],'..','old.png');writeFileSync(old,'old');f.say('agent',`Também tenho ${old}`);
  const mixed=await f.run({files:[...f.files.slice(0,2),old],caption:f.caption,...ig});
  assert.equal(mixed.data.state,'awaiting-confirmation');assert.equal(f.counts.create,0);
  f.setBatch([]);
  const unverified=await f.run({...full(f),...ig});
  assert.equal(unverified.data.state,'awaiting-confirmation');assert.match(unverified.data.reason,/No verified export or user-supplied file/);assert.equal(f.counts.create,0);
 }finally{await f.close();}
});

test('a summary is confirmed only by a plain yes; cancellations and reservations never confirm it',async()=>{
 for(const [answer,expected] of [['pode cancelar, mudei de ideia','denied'],['isso não','awaiting-confirmation'],['ok, mas mude a hora','awaiting-confirmation']]){
  const f=fixture({grant:false});try{
   f.say('user','agende no Instagram amanhã às 18h');
   const pending=await f.run({...full(f),...ig,scheduledAt:'2026-10-14T18:00',timeZone:zone});
   f.say('user',answer);
   const result=await f.run({confirmRequestId:pending.data.requestId});
   assert.equal(result.data.state,expected,answer);assert.equal(f.counts.create,0);
  }finally{await f.close();}
 }
});
