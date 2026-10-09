import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {productionPreflight} from '../production-preflight.mjs';
import {createProductionCoordinator} from '../production-coordinator.mjs';

const at='2026-10-07T12:00:00.000Z',destination='12345678-1234-1234-1234-123456789abc';
const agent=(id,name,extra={})=>({id,name,role:name,workspaceId:'space',instructions:'',tools:[],providerId:'codex',...extra});
const baseAgents=()=>[agent('source','Editor de Conteúdo'),agent('editor','Editor de Vídeo'),agent('editor-2','Outro Editor de Vídeo')];
const flow={id:'flow',workspaceId:'space',name:'Fluxo',nodes:[{kind:'content-agent',agentId:'source'},{kind:'video-agent',agentId:'editor'},{kind:'publishing-agent',agentId:'source'}]};
const topic={id:'topic',workspaceId:'space',status:'review',title:'Uma ideia',summary:'Resumo',createdAt:at,updatedAt:at};
const snapshot=(change={})=>({flow,agents:baseAgents(),topic,notion:{autoSync:true,dataSourceId:destination},notionDestination:destination,...change});
const level=(report,id)=>report.checks.find(c=>c.id===id)?.level;

test('a complete snapshot is ready, separates per-stage checks and never requires a recording for the script stage',()=>{
 const report=productionPreflight(snapshot());
 assert.equal(report.ready,true);assert.deepEqual(report.blockers,[]);
 assert.equal(level(report,'recording'),'ok');assert.equal(report.checks.find(c=>c.id==='recording').stage,'recording');
 assert.deepEqual([level(report,'runtime'),level(report,'ffmpeg'),level(report,'notion-access'),level(report,'cover-generation'),level(report,'publishing-accounts')],['unverified','unverified','unverified','unverified','unverified'],'unchecked facts are never reported as ok or blocking');
 assert.deepEqual(new Set(report.checks.map(c=>c.stage)),new Set(['script','notion','recording','edit','package','schedule']));
 assert.equal(productionPreflight(snapshot()).fingerprint,report.fingerprint,'fingerprint is deterministic');
 assert.equal(productionPreflight(snapshot(),{locale:'en-US'}).checks.find(c=>c.id==='recording').message,'No recording is needed now: add the video after the card.');
});

test('incapable providers are verified blockers at the stage that needs them',()=>{
 const editorOther=productionPreflight(snapshot({agents:[agent('source','Editor de Conteúdo'),agent('editor','Editor de Vídeo',{providerId:'gemini'})]}));
 assert.equal(editorOther.ready,false);assert.deepEqual(editorOther.blockers.map(c=>[c.id,c.stage]),[['editor-agent','edit']]);assert.match(editorOther.blockers[0].message,/gemini.*Codex ou Claude Code/);
 const publisher=productionPreflight(snapshot({flow:{...flow,nodes:[...flow.nodes.slice(0,2),{kind:'publishing-agent',agentId:'pub'}]},agents:[...baseAgents(),agent('pub','Publicador',{providerId:'gemini'})]}));
 assert.deepEqual(publisher.blockers.map(c=>[c.id,c.stage]),[['publisher-agent','package']]);
 const otherSpace=productionPreflight(snapshot({agents:[agent('source','Conteúdo',{workspaceId:'other'}),agent('editor','Vídeo')]}));
 assert.deepEqual(otherSpace.blockers.map(c=>c.id),['source-agent','publisher-agent'],'agents from another workspace never satisfy a flow');
});

test('Notion destination, runtime and budget are blockers only when verified; missing FFmpeg is a later-stage warning',()=>{
 assert.equal(level(productionPreflight(snapshot({notion:{autoSync:false,dataSourceId:''}})),'notion-destination'),'blocker');
 assert.equal(level(productionPreflight(snapshot({notionDestination:'another'})),'notion-destination'),'blocker');
 const unread=productionPreflight(snapshot({notion:undefined}));assert.equal(level(unread,'notion-destination'),'unverified');assert.equal(unread.ready,true);
 assert.equal(level(productionPreflight(snapshot({runtime:{connected:false}})),'runtime'),'blocker');
 assert.equal(level(productionPreflight(snapshot({runtime:{connected:true,imageFile:false}})),'cover-file'),undefined,'covers are local: no runtime image file is needed');
 assert.equal(level(productionPreflight(snapshot({media:{ffmpeg:true,ffprobe:true,thumbnails:true}})),'cover-generation'),'ok');
 assert.equal(level(productionPreflight(snapshot({media:{ffmpeg:true,ffprobe:true,thumbnails:false,thumbnailReasons:['drawtext ausente']}})),'cover-generation'),'warning');
 const media=productionPreflight(snapshot({media:{ffmpeg:false,ffprobe:true}}));assert.equal(level(media,'ffmpeg'),'warning');assert.equal(media.ready,true,'editing tools are not needed to write the script');
 assert.equal(level(productionPreflight(snapshot({media:{ffmpeg:true,ffprobe:true}})),'ffmpeg'),'ok');
 assert.match(productionPreflight(snapshot({budget:{maxCalls:0,maxAttemptsPerStep:2}})).blockers[0].message,/chamadas de IA/);
 assert.equal(level(productionPreflight(snapshot({topic:{...topic,status:'archived'}})),'topic'),'blocker');
 assert.equal(level(productionPreflight(snapshot({topicCurrent:false})),'topic'),'blocker');
});

function fixture(){
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE editorial_state(profile_id TEXT PRIMARY KEY,revision INTEGER,state_json TEXT,updated_at TEXT)');
 db.prepare('INSERT INTO editorial_state VALUES(?,?,?,?)').run('owner',1,JSON.stringify({schemaVersion:1,topics:[topic],contents:[],artifacts:[],approvals:[],runs:[],assets:[],publications:[]}),at);
 const calls={runtime:0,queueDraft:0,capabilities:0,notion:0,accounts:0};let agents=baseAgents(),connection={autoSync:true,dataSourceId:destination},runtimeOn=true;
 const touch=key=>()=>{calls[key]++;throw Error(`unexpected ${key}`)};
 const runtime=new Proxy({},{get:(_,key)=>key==='then'?undefined:key==='imageFile'?()=>'':touch('runtime')});
 const coordinator=createProductionCoordinator(db,{getCurrentProfile:()=>'owner',getAgents:()=>agents,getFlows:()=>({flows:[flow]}),getSessions:()=>[],getRuntime:()=>runtimeOn?runtime:null,getNotion:touch('notion'),
  jobs:{connection:()=>connection,queueDraft:touch('queueDraft'),list:()=>[],kick(){}},media:{capabilities:async()=>{calls.capabilities++;return {available:true,ffmpeg:true,ffprobe:true,error:''}},list:()=>[]},publications:{},publishing:{accounts:touch('accounts')},directory:'unused'});
 const count=()=>db.prepare('SELECT COUNT(*) AS n FROM production_runs').get().n+db.prepare('SELECT COUNT(*) AS n FROM production_commands').get().n;
 const input=(extra={})=>({requestId:`start-${Math.random()}`,flowId:flow.id,topicId:topic.id,expectedTopic:topic,notionDestination:destination,authorize:true,...extra});
 return {db,coordinator,calls,count,input,setAgents:value=>agents=value,setConnection:value=>connection=value,setRuntime:value=>runtimeOn=value,close:async()=>{await coordinator.close();db.close()}};
}

test('coordinator preflight is read-only: no run, command, turn, Notion read, job or account lookup; FFmpeg only on request',async()=>{
 const f=fixture();try{
  const before=f.db.prepare('SELECT revision,state_json FROM editorial_state').get();
  const report=await f.coordinator.preflight('owner',f.input());assert.equal(report.ready,true,JSON.stringify(report.blockers));assert.equal(level(report,'runtime'),'ok');assert.equal(level(report,'ffmpeg'),'unverified');
  assert.deepEqual(f.calls,{runtime:0,queueDraft:0,capabilities:0,notion:0,accounts:0});assert.equal(f.count(),0);assert.deepEqual(f.db.prepare('SELECT revision,state_json FROM editorial_state').get(),before);
  const probed=await f.coordinator.preflight('owner',f.input(),{probeMedia:true});assert.equal(level(probed,'ffmpeg'),'ok');assert.equal(f.calls.capabilities,1);assert.equal(probed.fingerprint,report.fingerprint);
  assert.equal(f.coordinator.list('owner').length,0);
 }finally{await f.close()}
});

test('start revalidates on submit: incapable provider, altered config, missing destination or runtime are refused before any effect',async()=>{
 const f=fixture();try{
  const reviewed=await f.coordinator.preflight('owner',f.input());
  f.setAgents([agent('source','Editor de Conteúdo'),agent('editor','Editor de Vídeo',{providerId:'gemini'})]);
  assert.throws(()=>f.coordinator.start('owner',f.input({preflightFingerprint:reviewed.fingerprint})),/Codex ou Claude Code/);
  f.setAgents(baseAgents().map(a=>a.id==='editor'?{...a,modelId:'gpt-other'}:a));
  assert.throws(()=>f.coordinator.start('owner',f.input({preflightFingerprint:reviewed.fingerprint})),/mudou desde a verificação/,'a reviewed check is stale after a capable-but-different configuration');
  f.setAgents(baseAgents());f.setConnection({autoSync:false,dataSourceId:''});
  assert.throws(()=>f.coordinator.start('owner',f.input({preflightFingerprint:reviewed.fingerprint})),/destino Notion/);
  f.setConnection({autoSync:true,dataSourceId:destination});f.setRuntime(false);
  assert.throws(()=>f.coordinator.start('owner',f.input()),/Conecte o Codex CLI/);
  assert.throws(()=>f.coordinator.start('owner',f.input({authorize:false})),/Confirme a ideia/,'authorization is still required first');
  assert.equal(f.count(),0);assert.deepEqual({...f.calls,capabilities:0},{runtime:0,queueDraft:0,capabilities:0,notion:0,accounts:0});
 }finally{await f.close()}
});

test('fingerprint covers every execution field and known Notion config, ignores key order and stays stable otherwise',()=>{
 const base=productionPreflight(snapshot()).fingerprint;
 const reordered=baseAgents().map(a=>Object.fromEntries(Object.entries(a).reverse()));assert.equal(productionPreflight(snapshot({agents:reordered})).fingerprint,base,'key order is canonicalized');
 const changes={instructions:'Outra instrução',tools:['files','web-search'],skills:['nova-skill'],skillFiles:{'nova-skill':'C:/skills/nova/SKILL.md'},disabledSkills:['own-skill'],mcpPermissions:{notion:['notion-fetch']},notionAutomation:{enabled:true,dataSourceId:destination},modelId:'gpt-other',skillsDirectory:'C:/skills'};
 for(const [key,value] of Object.entries(changes))for(const id of ['source','editor']){const agents=baseAgents().map(a=>a.id===id?{...a,[key]:value}:a);assert.notEqual(productionPreflight(snapshot({agents})).fingerprint,base,`${id}.${key}`);}
 assert.notEqual(productionPreflight(snapshot({notion:undefined})).fingerprint,base,'unread Notion config differs from a verified one');
 assert.notEqual(productionPreflight(snapshot({notion:{autoSync:true,dataSourceId:destination,extra:1},notionDestination:'x'})).fingerprint,base);
 const unrelated=baseAgents().map(a=>({...a,updatedAt:'2030-01-01T00:00:00.000Z',secretLikeField:'never-hashed'}));assert.equal(productionPreflight(snapshot({agents:unrelated})).fingerprint,base,'only the declared execution fields are read');
});

test('runtime presence is not reported as sign-in; account access stays unverified',()=>{
 const live=productionPreflight(snapshot({runtime:{connected:true,imageFile:true}}));
 assert.equal(level(live,'runtime'),'ok');assert.doesNotMatch(live.checks.find(c=>c.id==='runtime').message,/conectado|login/i);assert.equal(level(live,'runtime-account'),'unverified');
 assert.match(productionPreflight(snapshot({runtime:{connected:false}})).blockers[0].message,/indisponível/);
});

test('start rejects any execution-field change after review, before any effect; backend checks do not depend on the optional fingerprint',async()=>{
 const f=fixture();try{
  const reviewed=await f.coordinator.preflight('owner',f.input());
  for(const [key,value] of Object.entries({instructions:'Mudou',tools:['files'],skills:['x'],skillFiles:{x:'C:/x.md'},disabledSkills:['x'],mcpPermissions:{notion:['notion-fetch']},notionAutomation:{enabled:true,dataSourceId:destination}})){
   f.setAgents(baseAgents().map(a=>a.id==='source'?{...a,[key]:value}:a));
   assert.throws(()=>f.coordinator.start('owner',f.input({preflightFingerprint:reviewed.fingerprint})),/mudou desde a verificação/,key);
  }
  f.setAgents(baseAgents());f.setConnection({autoSync:true,dataSourceId:'other-destination'});
  assert.throws(()=>f.coordinator.start('owner',f.input({preflightFingerprint:reviewed.fingerprint})),/destino Notion/);
  assert.throws(()=>f.coordinator.start('owner',f.input()),/destino Notion/,'blockers apply without a client fingerprint');
  assert.equal(f.count(),0);assert.deepEqual(f.calls,{runtime:0,queueDraft:0,capabilities:0,notion:0,accounts:0});
 }finally{await f.close()}
});

test('a null or throwing runtime getter is reported unavailable without TypeError',async()=>{
 for(const getRuntime of [()=>null,()=>{throw Error('bridge down')}]){
  const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE editorial_state(profile_id TEXT PRIMARY KEY,revision INTEGER,state_json TEXT,updated_at TEXT)');db.prepare('INSERT INTO editorial_state VALUES(?,?,?,?)').run('owner',1,JSON.stringify({topics:[topic],contents:[]}),at);
  const c=createProductionCoordinator(db,{getCurrentProfile:()=>'owner',getAgents:()=>baseAgents(),getFlows:()=>({flows:[flow]}),getRuntime,jobs:{connection:()=>({autoSync:true,dataSourceId:destination}),list:()=>[]},media:{list:()=>[]}});
  try{const report=await c.preflight('owner',{flowId:flow.id,topicId:topic.id,notionDestination:destination});assert.equal(level(report,'runtime'),'blocker');assert.equal(level(report,'cover-file'),undefined);
   assert.throws(()=>c.start('owner',{requestId:'r',flowId:flow.id,topicId:topic.id,expectedTopic:topic,notionDestination:destination,authorize:true}),/Runtime Codex indisponível/);}finally{await c.close();db.close();}
 }
});

test('Claude roles are supported per stage: availability and sign-in are separate checks and a text-only publisher still gets local covers',()=>{
 const claude=(extra={})=>agent('editor','Editor de Vídeo',{providerId:'claude',...extra});
 const unread=productionPreflight(snapshot({agents:[agent('source','Editor de Conteúdo'),claude()]}));
 assert.equal(unread.ready,true,JSON.stringify(unread.blockers));assert.equal(level(unread,'editor-agent'),'ok');assert.equal(level(unread,'runtime-claude'),'unverified');assert.equal(level(unread,'auth-claude'),'unverified');assert.equal(level(unread,'reconcile-claude'),'unverified');
 const signedOut=productionPreflight(snapshot({agents:[agent('source','Editor de Conteúdo'),claude()],providers:{claude:{available:true,auth:'login-required',imageGeneration:false,reconcile:false}}}));
 assert.deepEqual(signedOut.blockers.map(c=>c.id),['auth-claude']);assert.match(signedOut.blockers[0].message,/claude auth login/);assert.equal(level(signedOut,'runtime-claude'),'ok','installed but signed out is not reported as unavailable');
 const missing=productionPreflight(snapshot({agents:[agent('source','Editor de Conteúdo'),claude()],providers:{claude:{available:false,auth:'not-installed',imageGeneration:false,reconcile:false}}}));
 assert.deepEqual(missing.blockers.map(c=>c.id),['runtime-claude']);assert.match(missing.blockers[0].message,/não encontrado.*outro provedor/);
 const connected=productionPreflight(snapshot({agents:[agent('source','Editor de Conteúdo'),claude()],providers:{claude:{available:true,auth:'connected',imageGeneration:false,reconcile:false}}}));
 assert.equal(connected.ready,true);assert.equal(level(connected,'auth-claude'),'ok');assert.notEqual(connected.fingerprint,signedOut.fingerprint,'a sign-in change invalidates a reviewed check');
 const allClaude=productionPreflight(snapshot({agents:[agent('source','Conteúdo',{providerId:'claude'}),claude()],providers:{claude:{available:true,auth:'connected',imageGeneration:false,reconcile:false}}}));
 assert.equal(allClaude.ready,true);assert.equal(level(allClaude,'cover-generation'),'unverified','covers are local for Claude too: no image capability is required');assert.match(allClaude.checks.find(c=>c.id==='cover-generation').message,/sem IA/);
 assert.equal(allClaude.checks.some(c=>c.id==='runtime'),false,'Codex is not checked when no stage uses it');
});
