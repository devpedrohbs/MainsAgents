import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {subscriptionOnlyEnv} from '../subscription-env.mjs';
import {synthesisInput,parseSynthesis,SYNTHESIS_LIMITS} from '../radar-synthesis.mjs';
import {createRadar,radarBackupSnapshot,restoreRadarBackup} from '../radar-runtime.mjs';
import {createProviderWaits} from '../provider-limits.mjs';
import {standaloneCodexEnvironment} from '../codex-runtime-home.mjs';

const DAY=86_400_000,CHANNEL='UC'+'a'.repeat(22);
const at=(d,h=8,m=0)=>new Date(2026,9,d,h,m).getTime();
const vid=i=>`vid${String(i).padStart(8,'0')}`;
// One outlier (i=0) and 14 regular mature videos: a highlight to synthesize.
function feed(){
 const views=[90_000,...Array.from({length:14},(_,i)=>1000+i*10)];
 return `<feed><title>Canal</title>${views.map((v,i)=>`<entry><yt:videoId>${vid(i)}</yt:videoId><yt:channelId>${CHANNEL}</yt:channelId><title>Vídeo ${i}</title><author><name>Canal</name></author><published>${new Date(at(10)-i*DAY).toISOString()}</published><media:statistics views="${v}"/></entry>`).join('')}</feed>`;
}
const fetchFeed=async()=>({status:200,ok:true,text:async()=>feed(),headers:{get:()=>null}});

/** Fake Claude chat runtime: records every send; replies with `reply(prompt)` or fails with `fail`. */
function fakeClaude({reply,fail}={}){
 const sends=[];
 return {sends,send:async(threadId,content)=>{sends.push(content);return {executionId:`e${sends.length}`};},
  async *events(){if(fail){yield {type:'execution.failed',...fail};return;}yield {type:'message.completed',content:reply(sends.at(-1))};yield {type:'execution.completed'};},
  cancel:async()=>{}};
}
const goodReply=prompt=>{const ids=[...prompt.matchAll(/"itemId": "([^"]+)"/g)].map(m=>m[1]);return JSON.stringify({recommendations:[
 {itemId:ids[0],observation:'Título com pergunta direta e 90x a mediana do canal.',hypothesis:{text:'O tema estava em alta.',alternatives:['Colaboração ou divulgação externa.']},idea:'Vídeo curto respondendo a mesma pergunta para o seu público.',limitations:['Sem retenção.']},
 {itemId:'invented-id',observation:'x',hypothesis:{text:'y',alternatives:['z']},idea:'w'}]});};

function setup({chat,usage,status={state:'connected'},start=at(20,6)}={}){
 const db=new DatabaseSync(':memory:'),clock={t:start},waits=createProviderWaits(db,{now:()=>new Date(clock.t).toISOString()});
 const agents=[{id:'a-claude',name:'Analista',providerId:'claude',workspaceId:'ws1'},{id:'a-other',name:'Outro',providerId:'claude',workspaceId:'ws2'}];
 const radar=createRadar(db,{getCurrentProfile:()=>'default',fetch:fetchFeed,clock:()=>clock.t,autoTick:false,
  synthesis:{getAgents:()=>agents,getChatRuntime:id=>id==='claude'?chat:null,getProviderStatus:async()=>status,readClaudeUsage:async()=>usage,providerWaits:waits}});
 const scope={profile:'default',workspaceId:'ws1'};
 const configure=(synthesis={enabled:true,agentId:'a-claude'},schedule={enabled:true,time:'07:00'})=>radar.configure(scope,{schedule,synthesis,sources:[{kind:'youtube-channel',channelId:CHANNEL,enabled:true}]});
 const collect=async()=>{radar.collect(scope,{});await radar.pending(scope);};
 const synthesize=async()=>{const out=await radar.synthesize(scope);await radar.synthesisPending(scope);return out;};
 return {db,clock,radar,scope,waits,configure,collect,synthesize};
}

test('subscription-only env strips every paid-API variable, in any casing',()=>{
 const env=subscriptionOnlyEnv({PATH:'p',ANTHROPIC_API_KEY:'a',anthropic_base_url:'b',OPENAI_API_KEY:'o',CODEX_API_KEY:'c',CLAUDE_CODE_USE_BEDROCK:'1',HOME:'h'});
 assert.deepEqual(env,{PATH:'p',HOME:'h'});
 assert.equal(standaloneCodexEnvironment({PATH:'p',OPENAI_API_KEY:'o',CODEX_API_KEY:'c'}).OPENAI_API_KEY,undefined);
});

test('parsed recommendations keep backend evidence and drop items the model was not given',()=>{
 const items=[{id:'i1',kind:'youtube',highlight:true,title:'T',author:'C',url:'https://youtu.be/x',publishedAt:null,durationSeconds:600,lastSeenAt:'2026-10-20T10:00:00.000Z',
  metrics:{latest:{id:'s2',collectedAt:'2026-10-20T10:00:00.000Z',views:9000,likes:null,comments:null},baselineMedian:1000,baselineCount:12,ratio:9,logScore:0.95,growth:{viewsPerHour:100,fromSnapshotId:'s1',toSnapshotId:'s2',hours:2},format:'video',maturity:'mature',limitations:['L1']}},
  {id:'i2',kind:'youtube',highlight:false,metrics:{}}];
 const input=synthesisInput(items);
 assert.deepEqual(input.map(i=>i.itemId),['i1']);assert.deepEqual(input[0].snapshotIds,['s1','s2']);assert.equal(input[0].numbers.likes,null);
 const out=parseSynthesis('ok:\n'+JSON.stringify({recommendations:[{itemId:'i1',observation:'o',hypothesis:{text:'h',alternatives:['a']},idea:'i'},{itemId:'i9',observation:'o',hypothesis:{text:'h',alternatives:['a']},idea:'i'},{itemId:'i1',observation:'dup',hypothesis:{text:'h',alternatives:['a']},idea:'i'}]}),input);
 assert.equal(out.length,1);assert.equal(out[0].evidence[0].numbers.views,9000);assert.deepEqual(out[0].evidence[0].snapshotIds,['s1','s2']);
 assert.ok(out[0].limitations.includes('L1'));assert.match(out[0].limitations[0],/não assistiu/);
 assert.throws(()=>parseSynthesis(JSON.stringify({recommendations:[{itemId:'i1',observation:'o',hypothesis:{text:'h',alternatives:[]},idea:'i'}]}),input),/nenhuma recomendação/);
 assert.throws(()=>parseSynthesis('sem json',input),/JSON/);
});

test('manual synthesis: one turn of the chosen agent, prompt forbids visual claims, evidence comes from the store',async()=>{
 const chat=fakeClaude({reply:goodReply});const {radar,scope,configure,collect,synthesize}=setup({chat,usage:{fiveHours:{usedPercent:20,resetsAt:null}}});
 assert.throws(()=>configure({enabled:true,agentId:'a-other'}),e=>e.code==='unknown_agent');
 configure();await collect();
 assert.equal((await synthesize()).status,'running');
 assert.equal(chat.sends.length,1);assert.match(chat.sends[0],/NÃO assistiu/);assert.match(chat.sends[0],/alternativa/);
 const snap=radar.snapshot(scope);
 assert.deepEqual(snap.agents.map(a=>a.id),['a-claude']);
 assert.equal(snap.synthesis.status,'ready');assert.equal(snap.synthesis.providerId,'claude');
 assert.equal(snap.synthesis.recommendations.length,1,'invented item dropped');
 const rec=snap.synthesis.recommendations[0],item=snap.items.find(i=>i.id===rec.itemId);
 assert.equal(item.externalId,vid(0));assert.equal(rec.evidence[0].numbers.views,90_000);assert.equal(rec.evidence[0].url,item.url);
});

test('gates: open provider wait, high Claude usage, missing login and API billing never send anything',async()=>{
 for(const [options,status,pattern] of [
  [{usage:{fiveHours:{usedPercent:85,resetsAt:Math.floor(at(20,11)/1000)}}},'waiting_limit',/85%/],
  [{usage:{weekly:{usedPercent:95,resetsAt:null}}},'waiting_limit',/semanal/],
  [{status:{state:'login-required'}},'blocked',/auth login/],
  [{usage:{error:'api-billing'}},'blocked',/API paga/],
 ]){
  const chat=fakeClaude({reply:goodReply}),{radar,scope,configure,collect,synthesize}=setup({chat,...options});
  configure();await collect();
  assert.equal((await synthesize()).status,status);assert.equal(chat.sends.length,0);
  const s=radar.snapshot(scope).synthesis;assert.equal(s.status,status);assert.match(s.message,pattern);
 }
 const chat=fakeClaude({reply:goodReply}),{radar,scope,configure,collect,synthesize,waits}=setup({chat});
 configure();await collect();waits.open('default','claude',{kind:'quota',resetsAt:null,evidence:{source:'t',value:'',at:''}});
 assert.equal((await synthesize()).status,'waiting_limit');assert.equal(chat.sends.length,0);assert.match(radar.snapshot(scope).synthesis.message,/Retomar/);
});

test('a provider limit during the turn opens the shared wait instead of retrying',async()=>{
 const chat=fakeClaude({fail:{code:'provider_limit',message:'limit',limit:{kind:'rate-limit',resetsAt:'2026-10-20T12:00:00.000Z',evidence:{source:'rate_limit_event',value:'rejected',at:'x'}}}});
 const {radar,scope,configure,collect,synthesize,waits}=setup({chat});
 configure();await collect();await synthesize();
 const s=radar.snapshot(scope).synthesis;
 assert.equal(s.status,'waiting_limit');assert.equal(s.waitingUntil,'2026-10-20T12:00:00.000Z');
 assert.equal(waits.get('default','claude').kind,'rate-limit');assert.equal(chat.sends.length,1);
});

test('daily automatic synthesis runs once after the scheduled collection and retries only after a usage reset',async()=>{
 const usage={fiveHours:{usedPercent:90,resetsAt:Math.floor(at(20,9)/1000)}};
 const chat=fakeClaude({reply:goodReply}),{radar,scope,clock,configure}=setup({chat,usage});
 configure();clock.t=at(20,7,1);
 const [run]=await radar.refreshDue({reason:'tick'});assert.equal(run.status,'succeeded');
 const [first]=await radar.refreshDue({reason:'tick'});assert.equal(first.kind,'synthesis');assert.equal(first.status,'waiting_limit');
 assert.deepEqual(await radar.refreshDue({reason:'tick'}),[],'waits for the reset');assert.equal(chat.sends.length,0);
 clock.t=at(20,9,1);usage.fiveHours={usedPercent:10,resetsAt:null};
 const [second]=await radar.refreshDue({reason:'tick'});assert.equal(second.status,'ready');assert.equal(chat.sends.length,1);
 assert.deepEqual(await radar.refreshDue({reason:'tick'}),[],'never twice a day');assert.equal(chat.sends.length,1);
 assert.equal(radar.snapshot(scope).synthesis.dayKey,'2026-10-20');
});

test('disabled synthesis or no highlight sends nothing; no agent is a clear 409',async()=>{
 const chat=fakeClaude({reply:goodReply}),{radar,scope,clock,configure}=setup({chat});
 configure({enabled:false,agentId:'a-claude'});clock.t=at(20,7,1);await radar.refreshDue({reason:'tick'});
 assert.deepEqual(await radar.refreshDue({reason:'tick'}),[]);assert.equal(chat.sends.length,0);
 configure({enabled:false,agentId:null});
 await assert.rejects(radar.synthesize(scope),e=>e.code==='no_agent'&&e.status===409);
 assert.throws(()=>configure({enabled:true,agentId:null}),e=>e.code==='no_agent');
});

test('promotion links are idempotent and scoped',async()=>{
 const {radar,scope,configure,collect}=setup({chat:fakeClaude({reply:goodReply})});
 configure();await collect();const item=radar.snapshot(scope).items[0];
 const first=radar.promote(scope,item.id,{target:'topic',targetId:'topic-1'});
 assert.equal(first.created,true);assert.deepEqual(first.item.promoted.map(p=>[p.target,p.id]),[['topic','topic-1']]);
 const again=radar.promote(scope,item.id,{target:'topic',targetId:'topic-2'});
 assert.equal(again.created,false);assert.equal(again.item.promoted.length,1);
 radar.promote(scope,item.id,{target:'reference',targetId:'ref-1'});
 assert.equal(radar.snapshot(scope).items.find(i=>i.id===item.id).promoted.length,2);
 assert.throws(()=>radar.promote(scope,'missing',{target:'topic',targetId:'t'}),e=>e.status===404);
 assert.throws(()=>radar.promote({...scope,workspaceId:'ws2'},item.id,{target:'topic',targetId:'t'}),e=>e.status===404);
 assert.throws(()=>radar.promote(scope,item.id,{target:'notion',targetId:'t'}),e=>e.code==='invalid_promotion');
});

test('retention removes YouTube API rows after 30 days and keeps free-feed rows',async()=>{
 const {db,radar,scope,configure,collect,clock}=setup({chat:fakeClaude({reply:goodReply})});
 configure();await collect();
 const old=new Date(clock.t-31*DAY).toISOString(),item=db.prepare('SELECT id FROM radar_items LIMIT 1').get().id;
 db.prepare("INSERT INTO radar_snapshots VALUES('api-old','default','ws1',?,'r','"+old+"',5,1,1,NULL,'youtube-api')").run(item);
 db.prepare("INSERT INTO radar_snapshots VALUES('rss-old','default','ws1',?,'r','"+old+"',5,NULL,NULL,NULL,'youtube-rss')").run(item);
 await collect();
 const ids=db.prepare('SELECT id FROM radar_snapshots WHERE item_id=?').all(item).map(r=>r.id);
 assert.ok(!ids.includes('api-old'));assert.ok(ids.includes('rss-old'));
 void radar;void scope;
});

test('backup round-trip restores data without the key, as idle sources and finished runs',async()=>{
 const secureStorage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
 const {db,radar,scope,configure,collect,synthesize}=setup({chat:fakeClaude({reply:goodReply})});
 configure();await collect();await synthesize();
 db.prepare("UPDATE radar_sources SET status='limit_reached',retry_at='2099-01-01T00:00:00.000Z'").run();
 const backup=JSON.parse(JSON.stringify(radarBackupSnapshot(db,'default')));
 assert.equal(JSON.stringify(backup).includes('encrypted_key'),false);
 const target=new DatabaseSync(':memory:');
 restoreRadarBackup(target,'default',backup,'replace');
 const restored=createRadar(target,{secureStorage,getCurrentProfile:()=>'default',autoTick:false});
 const snap=restored.snapshot(scope);
 assert.equal(snap.items.length,radar.snapshot(scope).items.length);assert.equal(snap.sources[0].status,'idle');
 assert.equal(snap.synthesis.status,'ready');assert.equal(snap.credentials.youtubeApiKey,false);
 assert.throws(()=>restoreRadarBackup(target,'default',{radar_items:[{id:'x'}]}),/Invalid radar backup field/);
 const other=new DatabaseSync(':memory:');restoreRadarBackup(other,'someone',backup,'replace');
 assert.throws(()=>restoreRadarBackup(other,'default',backup,'merge'),/another profile/);
});

test('a synthesis left running by a crash is interrupted and not re-sent',()=>{
 const db=new DatabaseSync(':memory:');createRadar(db,{autoTick:false});
 db.prepare("INSERT INTO radar_syntheses VALUES('s1','default','ws1','2026-10-20','schedule','running','claude','a','{}','2026-10-20T10:00:00.000Z',NULL)").run();
 const radar=createRadar(db,{getCurrentProfile:()=>'default',autoTick:false});
 const s=radar.snapshot({profile:'default',workspaceId:'ws1'}).synthesis;
 assert.equal(s.status,'interrupted');assert.match(s.message,/não é reenviada/);
 assert.equal(SYNTHESIS_LIMITS.dayAttempts,3);
});
