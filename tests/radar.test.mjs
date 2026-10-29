import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {parseYoutubeFeed,parseNewsFeed,isoDuration,nextPacificMidnight,decode} from '../radar-sources.mjs';
import {videoMetrics,median,RADAR_THRESHOLDS} from '../radar-metrics.mjs';
import {createRadar,validateRadarConfig,daysBetween,dayKey} from '../radar-runtime.mjs';

const DAY=86_400_000,CHANNEL='UC'+'a'.repeat(22),KEY='AIza'+'b'.repeat(35);
const at=(d,h=8,m=0)=>new Date(2026,9,d,h,m).getTime();
const vid=i=>`vid${String(i).padStart(8,'0')}`;

function feed(views,{publishedBase=at(1)}={}){
 const entries=views.map((v,i)=>`<entry><id>yt:video:${vid(i)}</id><yt:videoId>${vid(i)}</yt:videoId><yt:channelId>${CHANNEL}</yt:channelId><title>Vídeo ${i} &amp; IA</title><author><name>Canal Teste</name></author><published>${new Date(publishedBase-i*DAY).toISOString()}</published><media:group><media:community><media:statistics views="${v}"/></media:community></media:group></entry>`).join('');
 return `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><title>Canal Teste</title>${entries}</feed>`;
}
const response=(status,body,headers={})=>({status,ok:status>=200&&status<300,text:async()=>typeof body==='string'?body:JSON.stringify(body),headers:{get:name=>headers[name.toLowerCase()]??null}});
function fakeFetch(routes){
 const calls=[];
 const fn=async url=>{calls.push(url);for(const [pattern,handler] of routes)if(url.includes(pattern))return typeof handler==='function'?handler(url):handler;throw TypeError('fetch failed');};
 fn.calls=calls;return fn;
}
const secureStorage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(`enc:${s}`),decryptString:b=>b.toString().slice(4)};
function setup({routes=[],start=at(20)}={}){
 const db=new DatabaseSync(':memory:'),clock={t:start},fetch=fakeFetch(routes);
 const radar=createRadar(db,{secureStorage,getCurrentProfile:()=>'default',fetch,clock:()=>clock.t,autoTick:false});
 return {db,clock,fetch,radar,scope:{profile:'default',workspaceId:'ws1'}};
}
const config=(sources,schedule={enabled:true,time:'07:00'})=>({schedule,sources});
const run=async(radar,scope,input)=>{const out=radar.collect(scope,input);await radar.pending(scope);return out;};

test('parsers read YouTube and news feeds without inventing counters',()=>{
 const videos=parseYoutubeFeed(feed([100,200]));
 assert.equal(videos.length,2);assert.equal(videos[0].title,'Vídeo 0 & IA');assert.equal(videos[0].views,100);
 assert.equal(videos[0].likes,null);assert.equal(videos[0].durationSeconds,null);
 const rss=parseNewsFeed('<rss><channel><item><title><![CDATA[IA &amp; chips]]></title><link>https://www.site.com/a#x</link><pubDate>Mon, 26 Oct 2026 10:00:00 GMT</pubDate></item><item><title>sem link</title></item></channel></rss>','https://www.site.com/feed');
 assert.deepEqual(rss.map(i=>[i.title,i.url,i.author]),[['IA & chips','https://www.site.com/a','site.com']]);
 const atom=parseNewsFeed('<feed><entry><title>Atom</title><link href="https://b.dev/post"/><updated>2026-10-26T10:00:00Z</updated></entry></feed>','https://b.dev/atom');
 assert.equal(atom[0].url,'https://b.dev/post');assert.equal(atom[0].publishedAt,'2026-10-26T10:00:00.000Z');
 assert.equal(decode('&#233;&#x41;'),'éA');
 assert.throws(()=>parseNewsFeed('<html></html>','https://x.com/'),/RSS\/Atom/);
});

test('durations and the YouTube quota reset',()=>{
 assert.equal(isoDuration('PT1H2M3S'),3723);assert.equal(isoDuration('PT59S'),59);assert.equal(isoDuration('P1DT1S'),86401);assert.equal(isoDuration('bad'),null);
 const t=Date.parse('2026-10-28T15:00:00Z'),reset=Date.parse(nextPacificMidnight(t));
 assert.ok(reset>t&&reset-t<=25*3_600_000);
});

test('metrics compare with the channel median and keep unknowns unknown',()=>{
 assert.equal(median([3,1,2]),2);assert.equal(median([1,2,3,4]),2.5);assert.equal(median([]),null);
 const collectedAt=new Date(at(20)).toISOString(),old=new Date(at(1)).toISOString();
 const base=Array.from({length:12},(_,i)=>({videoId:vid(i+1),views:1000+i,publishedAt:old,durationSeconds:600,live:false}));
 const snaps=[{id:'s1',collectedAt:new Date(at(20)-2*3_600_000).toISOString(),views:4000,source:'youtube-api'},{id:'s2',collectedAt,views:5000,source:'youtube-api'}];
 const m=videoMetrics({externalId:vid(0),publishedAt:new Date(at(18)).toISOString(),durationSeconds:600,live:false},snaps,{collectedAt,videos:base});
 assert.equal(m.baselineStatus,'ok');assert.equal(m.baselineCount,12);assert.equal(m.baselineMedian,1005.5);
 assert.ok(Math.abs(m.ratio-5000/1005.5)<1e-9);assert.equal(m.maturity,'immature');
 assert.deepEqual(m.growth,{viewsPerHour:500,fromSnapshotId:'s1',toSnapshotId:'s2',hours:2});
 assert.ok(m.limitations.some(l=>/menos de 7 dias/.test(l)));assert.ok(m.limitations.some(l=>/não provam a causa/.test(l)));
 const few=videoMetrics({externalId:vid(0),publishedAt:old,durationSeconds:null,live:false},[{id:'s',collectedAt,views:null,source:'youtube-rss'}],{collectedAt,videos:base.slice(0,RADAR_THRESHOLDS.minBaseline-1)});
 assert.equal(few.baselineStatus,'insufficient');assert.equal(few.ratio,null);assert.equal(few.baselineMedian,null);assert.equal(few.latest.views,null);assert.equal(few.growth,null);
 const live=videoMetrics({externalId:vid(0),publishedAt:old,durationSeconds:0,live:true},[],{collectedAt,videos:base});
 assert.equal(live.baselineStatus,'not_applicable');assert.equal(live.format,'live');
});

test('config validation rejects malformed sources and duplicates',()=>{
 assert.throws(()=>validateRadarConfig(config([],{enabled:true,time:'7h'})),/HH:MM/);
 assert.throws(()=>validateRadarConfig(config([{kind:'youtube-channel',channelId:'abc',enabled:true}])),/UC/);
 assert.throws(()=>validateRadarConfig(config([{kind:'news-rss',url:'http://x.com/feed',enabled:true}])),/https/);
 assert.throws(()=>validateRadarConfig(config([{kind:'hackernews',enabled:true},{kind:'hackernews',enabled:false}])),/já está/);
 assert.throws(()=>validateRadarConfig(config([{id:'forged',kind:'hackernews',enabled:true}])),/desconhecida/);
 const ok=validateRadarConfig(config([{kind:'youtube-search',query:' IA ',regionCode:'BR',enabled:true}]));
 assert.equal(ok.sources[0].query,'IA');assert.ok(ok.sources[0].id);
});

test('a followed channel collects via RSS without a key, then measures real growth and highlights outliers',async()=>{
 const views=[50_000,...Array.from({length:14},(_,i)=>1000+i*10)];let bump=0;
 const {radar,scope,clock}=setup({routes:[['feeds/videos.xml',()=>response(200,feed(views.map((v,i)=>i===0?v+bump:v),{publishedBase:at(17)}))]]});
 radar.configure(scope,config([{kind:'youtube-channel',channelId:CHANNEL,label:'Canal',enabled:true}]));
 const first=await run(radar,scope,{});
 let snap=radar.snapshot(scope,{kind:'youtube'});
 assert.equal(snap.runs[0].id,first.runId);assert.equal(snap.runs[0].status,'succeeded');assert.equal(snap.sources[0].status,'ok');
 assert.equal(snap.items.length,15);
 const top=snap.items.find(i=>i.externalId===vid(0));
 assert.equal(top.metrics.latest.source,'youtube-rss');assert.equal(top.metrics.latest.likes,null);assert.equal(top.metrics.growth,null);
 assert.equal(top.metrics.baselineStatus,'ok');assert.ok(top.highlight);assert.ok(top.metrics.ratio>40);
 assert.deepEqual(radar.snapshot(scope,{kind:'youtube',highlight:true}).items.map(i=>i.externalId),[vid(0)]);
 clock.t+=3*3_600_000;bump=3000;await run(radar,scope,{});
 const {snapshots,item}=radar.history(scope,top.id);
 assert.equal(snapshots.length,2);assert.equal(item.metrics.growth.viewsPerHour,1000);
 snap=radar.snapshot(scope);assert.equal(snap.credentials.youtubeApiKey,false);assert.equal(JSON.stringify(snap).includes('AIza'),false);
});

test('with a key: quota on a channel degrades to RSS; a search waits for the quota reset without new requests',async()=>{
 const quota=response(403,{error:{errors:[{reason:'quotaExceeded'}]}});
 const {radar,scope,fetch,clock}=setup({routes:[['googleapis.com/youtube/v3/',quota],['feeds/videos.xml',response(200,feed([10,20]))]]});
 radar.credentials.save('default',KEY);
 radar.configure(scope,config([{kind:'youtube-channel',channelId:CHANNEL,enabled:true},{kind:'youtube-search',query:'IA',enabled:true}]));
 await run(radar,scope,{kind:'youtube'});
 let snap=radar.snapshot(scope);
 const [channel,search]=snap.sources;
 assert.equal(channel.status,'partial');assert.match(channel.errorMessage,/RSS/);
 assert.equal(search.status,'limit_reached');assert.equal(search.errorCode,'quota_exceeded');assert.ok(Date.parse(search.retryAt)>clock.t);
 assert.equal(snap.runs[0].status,'partial');
 const before=fetch.calls.filter(u=>u.includes('/search')).length;
 clock.t+=3_600_000;await run(radar,scope,{kind:'youtube'});
 assert.equal(fetch.calls.filter(u=>u.includes('/search')).length,before,'no new search request before retryAt');
 snap=radar.snapshot(scope);assert.equal(snap.runs[0].sources.find(s=>s.sourceId===search.id).status,'limit_reached');
});

test('search without a key fails only that source; invalid keys are rejected and never stored',async()=>{
 const {radar,scope}=setup({routes:[['hacker-news.firebaseio.com/v0/topstories',response(200,[1,2])],['item/1.json',response(200,{id:1,type:'story',title:'Chip novo',url:'https://www.chips.dev/x',score:250,descendants:40,time:1_790_000_000})],['item/2.json',response(200,{id:2,type:'story',title:'Ask HN',score:20,time:1_790_000_000})]]});
 assert.throws(()=>radar.credentials.save('default','sk-123'),/AIza/);
 assert.equal(radar.credentials.status('default').configured,false);
 radar.configure(scope,config([{kind:'youtube-search',query:'IA',enabled:true},{kind:'hackernews',minScore:100,enabled:true}]));
 await run(radar,scope,{});
 const snap=radar.snapshot(scope);
 assert.equal(snap.sources[0].errorCode,'missing_api_key');assert.equal(snap.sources[1].status,'ok');assert.equal(snap.runs[0].status,'partial');
 const news=radar.snapshot(scope,{kind:'news'}).items;
 assert.equal(news.length,2);assert.deepEqual(news.filter(i=>i.highlight).map(i=>i.title),['Chip novo']);
 assert.equal(news.find(i=>i.title==='Ask HN').url,'https://news.ycombinator.com/item?id=2');
});

test('one collection per scope at a time',async()=>{
 let release;const gate=new Promise(r=>{release=r;});
 const {radar,scope}=setup({routes:[['feeds/videos.xml',async()=>{await gate;return response(200,feed([1]));}]]});
 radar.configure(scope,config([{kind:'youtube-channel',channelId:CHANNEL,enabled:true}]));
 radar.collect(scope,{});
 assert.throws(()=>radar.collect(scope,{}),e=>e.code==='already_running'&&e.status===409);
 assert.throws(()=>radar.configure(scope,config([])),e=>e.code==='already_running');
 assert.ok(radar.snapshot(scope).running);
 release();await radar.pending(scope);assert.equal(radar.snapshot(scope).running,null);
});

test('schedule: catch-up once per day, no duplicates, bounded retries after failures, gaps recorded',async()=>{
 let online=true;
 const {radar,scope,clock,fetch}=setup({start:at(20,6,0),routes:[['feeds/videos.xml',()=>{if(!online)throw TypeError('offline');return response(200,feed([1,2]));}]]});
 radar.configure(scope,config([{kind:'youtube-channel',channelId:CHANNEL,enabled:true}],{enabled:true,time:'07:00'}));
 assert.deepEqual(await radar.refreshDue({reason:'startup'}),[]);
 assert.equal(radar.snapshot(scope).nextRunAt,new Date(at(20,7,0)).toISOString());
 clock.t=at(20,7,5);
 const [first]=await radar.refreshDue({reason:'tick'});assert.equal(first.status,'succeeded');
 assert.equal(radar.snapshot(scope).runs[0].reason,'schedule');
 assert.deepEqual(await radar.refreshDue({reason:'resume'}),[],'same day never runs twice');
 assert.equal(radar.snapshot(scope).nextRunAt,new Date(at(21,7,0)).toISOString());
 // PC off for two days; on day 23 it wakes up offline after the scheduled time.
 clock.t=at(23,9,0);online=false;
 const [failed]=await radar.refreshDue({reason:'resume'});assert.equal(failed.status,'failed');
 assert.deepEqual(radar.snapshot(scope).runs[0].gapDays,['2026-10-21','2026-10-22']);
 assert.equal(radar.snapshot(scope).runs[0].reason,'catch-up');
 assert.deepEqual(await radar.refreshDue({reason:'tick'}),[],'waits 30 min before retrying');
 clock.t+=31*60_000;assert.equal((await radar.refreshDue({reason:'tick'}))[0].status,'failed');
 clock.t+=31*60_000;assert.equal((await radar.refreshDue({reason:'tick'}))[0].status,'failed');
 const calls=fetch.calls.length;clock.t+=31*60_000;
 assert.deepEqual(await radar.refreshDue({reason:'tick'}),[],'at most 3 attempts per day');assert.equal(fetch.calls.length,calls);
 online=true;clock.t=at(24,7,1);
 const [ok]=await radar.refreshDue({reason:'tick'});assert.equal(ok.status,'succeeded');
 assert.deepEqual(radar.snapshot(scope).runs[0].gapDays,['2026-10-21','2026-10-22','2026-10-23']);
 assert.deepEqual(daysBetween('2026-10-30','2026-11-02'),['2026-10-31','2026-11-01']);assert.equal(dayKey(at(5)),'2026-10-05');
});

test('a run interrupted by a crash is marked and its day can be retried',()=>{
 const db=new DatabaseSync(':memory:');
 createRadar(db,{autoTick:false});
 db.prepare("INSERT INTO radar_runs VALUES('r1','default','ws1','2026-10-20','schedule','running','2026-10-20T10:00:00.000Z',NULL,'[]','[]')").run();
 db.prepare("INSERT INTO radar_day_claims VALUES('default','ws1','2026-10-20',1,'running',NULL)").run();
 createRadar(db,{autoTick:false});
 assert.equal(db.prepare("SELECT status FROM radar_runs WHERE id='r1'").get().status,'interrupted');
 assert.equal(db.prepare('SELECT status FROM radar_day_claims').get().status,'failed');
});

test('scope guard: other profile and invalid workspace are refused',()=>{
 const db=new DatabaseSync(':memory:');
 const radar=createRadar(db,{getCurrentProfile:()=>'other',autoTick:false});
 assert.throws(()=>radar.snapshot({profile:'default',workspaceId:'ws1'}),e=>e.code==='profile_changed');
 assert.throws(()=>createRadar(db,{autoTick:false}).snapshot({profile:'default',workspaceId:''}),e=>e.code==='invalid_scope');
});

test('the YouTube feed retries its intermittent 404/5xx before failing',async()=>{
 const {youtubeFeed}=await import('../radar-sources.mjs');
 let n=0;const flaky=fakeFetch([['feeds/videos.xml',()=>++n<3?response(n===1?404:500,''):response(200,feed([7]))]]);
 assert.equal((await youtubeFeed(CHANNEL,{fetch:flaky,retryDelayMs:1}))[0].views,7);assert.equal(n,3);
 await assert.rejects(youtubeFeed(CHANNEL,{fetch:fakeFetch([['feeds/videos.xml',response(404,'')]]),retryDelayMs:1}),e=>e.code==='feed_unavailable');
});
