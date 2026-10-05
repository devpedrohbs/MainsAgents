import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createCalendarConnector} from '../publication-calendar-connector.mjs';
import {createPublicationCalendar} from '../editorial-publication-calendar.mjs';
import {createCalendarCredentials} from '../publication-calendar-credentials.mjs';
import {createZernioCalendarApi} from '../publication-calendar-api.mjs';

const time='2026-10-10T15:00:00Z';
const pub=(id='p',status='scheduled')=>({postGroupId:id,content:'My project',status,scheduledTime:time,platforms:[{platformId:'linkedin-a',platform:'linkedin',status}]});
const zer=(id='z',status='scheduled')=>({_id:id,content:'My project',status,scheduledFor:time,platforms:[{accountId:{_id:'ig-a'},platform:'instagram',status:'pending'},{accountId:'tk-a',platform:'tiktok',status:'failed',customContent:'Other caption'}]});
const result=data=>({structuredContent:data});
test('Publora calendar follows every page, verifies identities and makes only read calls',async()=>{
 const calls=[];const connector=createCalendarConnector(()=>({call:async(tool,args,provider)=>{calls.push({tool,args,provider});if(tool==='list_connections')return result({connections:[{platformId:'linkedin-a',platform:'linkedin',displayName:'Me',tokenStatus:'valid',connectionStatus:'active'}]});return result({posts:[pub(`p${args.page}`)],pagination:{page:args.page,totalPages:2,hasNextPage:args.page===1}})}}),'publora');
 assert.equal((await connector.accounts())[0].id,'linkedin-a');const feed=await connector.list(['linkedin-a']);assert.equal(feed.items.length,2);assert.equal(feed.complete,true);assert.deepEqual(calls.map(x=>x.tool),['list_connections','list_posts','list_posts']);assert(calls.every(x=>x.provider==='publora'));
});
test('Zernio uses the paginated generated tool and preserves per-account status and custom caption',async()=>{
 const connector=createCalendarConnector(()=>({call:async(tool,args,provider)=>{assert.equal(provider,'zernio');assert.equal(tool,'posts_list_posts');assert.equal(args.sort_by,'scheduled-asc');return result({posts:[zer()],pagination:{page:1,pages:1}})}}),'zernio');
 const feed=await connector.list(['ig-a','tk-a']);assert.equal(feed.items[0].status,'scheduled');assert.equal(feed.items[1].status,'failed');assert.equal(feed.items[1].text,'Other caption');assert.equal(feed.items[0].scheduledAt,'2026-10-10T15:00:00.000Z');
});
test('real MCP envelope strings and Publora account prefixes normalize without parsing prose',async()=>{
 const p=createCalendarConnector(()=>({call:async()=>result({connections:[{platformId:'linkedin-a',tokenStatus:'valid',connectionStatus:'active'}]})}),'publora');assert.equal((await p.accounts())[0].platform,'linkedin');
 const z=createCalendarConnector(()=>({call:async tool=>{assert.equal(tool,'accounts_list_accounts');return result({result:JSON.stringify({accounts:[{_id:'ig-a',platform:'instagram',username:'me',isActive:true}]})})}}),'zernio');assert.equal((await z.accounts())[0].id,'ig-a');
 const prose=createCalendarConnector(()=>({call:async()=>result({result:'Found 2 accounts: Instagram, TikTok'})}),'zernio');await assert.rejects(prose.accounts(),/structured/);
});
test('prose, ambiguous dates, malformed pagination and overlapping pages cannot fabricate schedules',async()=>{
 const fixture=payload=>createCalendarConnector(()=>({call:async()=>payload}),'publora');
 await assert.rejects(fixture({content:[{type:'text',text:'All posts scheduled!'}]}).list(['linkedin-a']),/structured/);
 await assert.rejects(fixture(result({posts:[{...pub(),scheduledTime:'2026-10-10T15:00'}],pagination:{page:1,totalPages:1,hasNextPage:false}})).list(['linkedin-a']),/ambiguous/);
 await assert.rejects(fixture(result({posts:[],pagination:{page:1,totalPages:2,hasNextPage:true}})).list(['linkedin-a']),/inconsistent/);
 const repeated=createCalendarConnector(()=>({call:async(_tool,args)=>result({posts:[pub()],pagination:{page:args.page,totalPages:2,hasNextPage:args.page===1}})}),'publora');await assert.rejects(repeated.list(['linkedin-a']),/overlap/);
});
test('bounded feeds announce truncation instead of claiming the full provider history',async()=>{
 const connector=createCalendarConnector(()=>({call:async(_tool,args)=>result({posts:[pub(`p${args.page}`)],pagination:{page:args.page,totalPages:21,hasNextPage:true}})}),'publora');const feed=await connector.list(['linkedin-a']);assert.equal(feed.complete,false);assert.equal(feed.items.length,20);
});
function fixture(){
 const db=new DatabaseSync(':memory:');let profile='owner',now=Date.parse(time),failure=false,complete=true,items=[{key:'one',postId:'p',accountId:'a',provider:'publora',platform:'linkedin',text:'Before',status:'scheduled',scheduledAt:time}];
 const options={getCurrentProfile:()=>profile,clock:()=>now,getConnector:()=>({accounts:async()=>[{id:'a',name:'Me',platform:'linkedin'}],list:async()=>{if(failure)throw Error('secret upstream error');return {items,complete}}})};
 let service=createPublicationCalendar(db,options);
 return {db,get service(){return service},sync:()=>service.sync('owner',{workspaceId:'w',provider:'publora',accountIds:['a']}),get:()=>service.snapshot('owner','w').sources[0],failure:()=>failure=true,profile:value=>profile=value,set:(value,full=true)=>{items=value;complete=full;now+=1000},restart:async()=>{await service.close();service=createPublicationCalendar(db,options)},close:async()=>{await service.close();db.close()}};
}
test('calendar cache persists across restart, isolates workspaces/profiles and keeps data on failure',async()=>{
 const f=fixture();try{await f.sync();await f.restart();assert.equal(f.get().items[0].text,'Before');assert.equal(f.service.snapshot('owner','other').sources[0].items.length,0);f.failure();await assert.rejects(f.sync());assert.equal(f.get().items.length,1);assert(f.get().error);assert(!JSON.stringify(f.get()).includes('secret'));f.profile('other');assert.throws(()=>f.get(),/profile/);assert.equal(f.service.snapshot('other','w').sources[0].items.length,0);}finally{await f.close()}
});
test('complete sync removes remote deleted posts; limited sync preserves old entries with old timestamps',async()=>{
 const f=fixture();try{await f.sync();const old=f.get().items[0].checkedAt;f.set([{key:'two',accountId:'a',text:'New'}],false);await f.sync();assert.equal(f.get().items.length,2);assert.equal(f.get().items[0].checkedAt,old);assert.equal(f.get().complete,false);f.set([]);await f.sync();assert.equal(f.get().items.length,0);}finally{await f.close()}
});
test('unknown accounts and profile changes during reads cannot save cross-profile results',async()=>{
 const db=new DatabaseSync(':memory:');let profile='owner',unblock;const gate=new Promise(resolve=>unblock=resolve);const service=createPublicationCalendar(db,{getCurrentProfile:()=>profile,getConnector:()=>({accounts:async()=>[{id:'a'}],list:async()=>{await gate;return {items:[],complete:true}}})});
 try{await assert.rejects(service.sync('owner',{workspaceId:'w',provider:'publora',accountIds:['unknown']}),/unavailable/);const pending=service.sync('owner',{workspaceId:'w',provider:'publora',accountIds:['a']});await new Promise(resolve=>setImmediate(resolve));await assert.rejects(service.sync('owner',{workspaceId:'w',provider:'publora',accountIds:['a']}),/already running/);profile='other';unblock();await assert.rejects(pending,/profile/);assert.equal(service.snapshot('other','w').sources[0].items.length,0);}finally{unblock();await service.close();db.close()}
});
test('desktop credential storage isolates profiles, encrypts the key and refuses plaintext fallback',()=>{
 const db=new DatabaseSync(':memory:'),key='sk_'+'a'.repeat(64);let available=true;
 const secure={isEncryptionAvailable:()=>available,encryptString:x=>Buffer.from([...Buffer.from(x)].map(x=>x^91)),decryptString:x=>Buffer.from([...x].map(x=>x^91)).toString()};
 const keys=createCalendarCredentials(db,secure);try{assert.throws(()=>keys.save('owner','not-a-key'),/Invalid/);keys.save('owner',key);assert.equal(keys.key('owner'),key);assert.equal(keys.status('other').configured,false);assert(!db.prepare('SELECT encrypted_key FROM publication_calendar_credentials').get().encrypted_key.includes(key));assert.deepEqual(Object.keys(keys.status('owner')).sort(),['configured','secureStorage']);available=false;assert.throws(()=>keys.key('owner'),/unavailable/);assert.throws(()=>keys.save('other',key),/unavailable/);keys.remove('owner');assert.equal(keys.status('owner').configured,false);}finally{db.close()}
});
test('Zernio API fallback uses only fixed GET endpoints, native credentials, bounded JSON and safe errors',async()=>{
 const key='sk_'+'b'.repeat(64),calls=[];
 const connector=createZernioCalendarApi(()=>key,{fetchImpl:async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify(url.pathname.endsWith('accounts')?{accounts:[{_id:'ig-a',platform:'instagram',isActive:true}]}:{posts:[zer()],pagination:{page:1,pages:1}}),{status:200})}});
 assert.equal((await connector.accounts())[0].id,'ig-a');assert.equal((await connector.list(['ig-a'])).items.length,1);assert.equal(connector.transport,'api');assert(calls.every(x=>x.url.origin==='https://zernio.com'&&x.init.method==='GET'&&x.init.redirect==='error'&&x.init.headers.authorization===`Bearer ${key}`));assert.equal(calls[1].url.searchParams.get('page'),'1');assert.equal(calls[1].url.searchParams.get('sortBy'),'scheduled-asc');
 const failed=createZernioCalendarApi(()=>key,{fetchImpl:async()=>{throw Error(key)}});await assert.rejects(failed.accounts(),e=>!e.message.includes(key)&&e.message.includes('query failed'));
 let changed=key;const race=createZernioCalendarApi(()=>changed,{fetchImpl:async()=>{changed='different';return new Response(JSON.stringify({accounts:[]}))}});await assert.rejects(race.accounts(),/credentials changed/);
});

test('automatic calendar refresh is opt-in, persists intervals, isolates profiles and backs off after failure',async()=>{
 const db=new DatabaseSync(':memory:');let profile='owner',now=Date.now(),calls=0,offline=false;
 const options={clock:()=>now,getCurrentProfile:()=>profile,getConnector:()=>({accounts:async()=>[{id:'a',name:'A',platform:'linkedin'}],list:async()=>{calls++;if(offline)throw Error('secret upstream error');return {items:[],complete:true}}})};
 let calendar=createPublicationCalendar(db,options);
 try{
 assert.throws(()=>calendar.configureRefresh('owner',{workspaceId:'w',provider:'publora',enabled:true,intervalMinutes:5}),/Query/);
 await calendar.sync('owner',{workspaceId:'w',provider:'publora',accountIds:['a']});assert.equal(calls,1);now+=3600000;await calendar.refreshDue();assert.equal(calls,1);
 calendar.configureRefresh('owner',{workspaceId:'w',provider:'publora',enabled:true,intervalMinutes:5});assert.throws(()=>calendar.configureRefresh('owner',{workspaceId:'w',provider:'publora',enabled:true,intervalMinutes:1}),/supported/);
 await calendar.close();calendar=createPublicationCalendar(db,options);assert.equal(calendar.snapshot('owner','w').sources[0].autoRefresh.enabled,true);
 now+=300000;profile='other';await calendar.refreshDue();assert.equal(calls,1);profile='owner';offline=true;await calendar.refreshDue();assert.equal(calls,2);assert(calendar.snapshot('owner','w').sources[0].error);await calendar.refreshDue();assert.equal(calls,2);
 now+=300000;offline=false;await calendar.refreshDue();assert.equal(calls,3);assert.equal(calendar.snapshot('owner','w').sources[0].error,undefined);
 calendar.configureRefresh('owner',{workspaceId:'w',provider:'publora',enabled:false,intervalMinutes:5});now+=3600000;await calendar.refreshDue();assert.equal(calls,3);
 }finally{await calendar.close();db.close()}
});
