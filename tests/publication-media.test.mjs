import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createEditorialPublications} from '../editorial-publications.mjs';
import {createPublicationExecution} from '../editorial-publication-execution.mjs';
import {createZernioPublicationConnector,verifiedZernioPublication} from '../zernio-publication-connector.mjs';
import {createPublicationConnector} from '../publication-connector.mjs';
import {uploadDestination,uploadPublicationFile} from '../publication-media-upload.mjs';

async function fixture(platform='Instagram',provider='zernio'){
 const directory=await mkdtemp(join(tmpdir(),'publication-media-')),path=join(directory,'photo.png'),bytes=Buffer.from('synthetic isolated photo bytes'),sha256=createHash('sha256').update(bytes).digest('hex');await writeFile(path,bytes);
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE editorial_state(profile_id TEXT PRIMARY KEY,revision INTEGER,state_json TEXT,updated_at TEXT)');let now=Date.now(),profile='owner',failPut=false,failCreate=false,failUpdate=false,failRead=false,secret='sk_fixture';const counts={put:0,create:0,update:0,presign:0},requests=[];let post;
 const at=new Date(now).toISOString(),state={schemaVersion:1,contents:[{id:'c',workspaceId:'w'}],topics:[],runs:[],artifacts:[],approvals:[],assets:[{id:'a',contentId:'c',workspaceId:'w',status:'available',currentVersionId:'v',kind:'image',name:'photo.png',versions:[{id:'v',sha256,path,name:'photo.png',size:bytes.length}]}]};db.prepare('INSERT INTO editorial_state VALUES (?,?,?,?)').run('owner',0,JSON.stringify(state),at);
 const snap=()=>{const row=db.prepare('SELECT * FROM editorial_state').get();return {revision:row.revision,state:JSON.parse(row.state_json)};},local=createEditorialPublications(db),input=()=>({revision:snap().revision,id:snap().state.publications[0].id,expectedDelivery:snap().state.publications[0]});
 const command=(action,extra={})=>local.command('owner',{revision:snap().revision,contentId:'c',id:snap().state.publications?.[0]?.id,expectedDelivery:snap().state.publications?.[0],action,...extra});
 const networkSettings=platform==='TikTok'?{tiktokSettings:{privacy_level:'PUBLIC_TO_EVERYONE',commercialContentType:'none',allow_comment:false,allow_duet:false,allow_stitch:false,video_made_with_ai:false,content_preview_confirmed:true,express_consent_given:true}}:undefined;
 command('create',{platform,draft:{text:'Approved caption',assetIds:['a'],timeZone:'UTC',plannedAt:new Date(now+3600000).toISOString(),networkSettings}});command('submit');command('approve');
 const fetchImpl=async(url,options)=>{
  url=new URL(url);requests.push({url:url.href,method:options.method,headers:options.headers,body:typeof options.body==='string'?JSON.parse(options.body):undefined});
  if(options.method==='PUT'&&url.hostname.endsWith('amazonaws.com')){counts.put++;assert.equal(options.headers.authorization,undefined);const chunks=[];for await(const b of options.body)chunks.push(b);assert.deepEqual(Buffer.concat(chunks),bytes);if(failPut)throw Error('offline');return new Response('');}
  const body=typeof options.body==='string'?JSON.parse(options.body):undefined;let data;
  if(url.pathname==='/api/v1/accounts')data={accounts:[{_id:'account',platform:platform.toLowerCase(),isActive:true,username:'Fixture'}]};
  else if(url.pathname.includes('creator-info'))data={privacyLevels:[{value:'PUBLIC_TO_EVERYONE',label:'Public'}],commercialContentTypes:[{value:'none',label:'None'}],postingLimits:{interactionSettings:{allow_comment:{enabled:true},allow_duet:null,allow_stitch:null}},creator:{canPostMore:true}};
  else if(url.pathname.endsWith('/media/presign')){counts.presign++;data={uploadUrl:'https://fixture.s3.amazonaws.com/photo.png?signature=private',publicUrl:'https://media.zernio.com/temp/photo.png'};}
  else if(url.pathname==='/api/v1/posts'&&options.method==='POST'){counts.create++;post={...body,_id:'external',status:body.isDraft?'draft':'scheduled',platforms:body.platforms.map(p=>({...p,status:body.isDraft?'draft':'scheduled'}))};if(failCreate)throw Error('lost response');data={post};}
  else if(url.pathname==='/api/v1/posts/external'&&options.method==='GET'){if(failRead)throw Error('offline');data={post};}
  else if(url.pathname==='/api/v1/posts/external'&&options.method==='PUT'){counts.update++;post={...post,...body,status:body.isDraft?'draft':'scheduled',platforms:(body.platforms??post.platforms).map(p=>({...p,status:body.isDraft?'draft':'scheduled'}))};if(failUpdate)throw Error('lost response');data={post};}
  else throw Error('Unexpected URL '+url);return Response.json(data);
 };
 let media=0,createdKey;const transport={async call(tool,args){
  if(tool==='list_connections')return {structuredContent:{connections:[{platformId:'linkedin-account',displayName:'Fixture',tokenStatus:'valid',connectionStatus:'active'}]}};
  if(tool==='create_post'){counts.create++;createdKey=args.idempotencyKey;post={postGroupId:'external',platforms:args.platforms,posts:[{platform:'linkedin',platformId:'account',content:args.content,status:'draft'}],media:[],status:'draft'};return {structuredContent:{postGroupId:'external'}};}
  if(tool==='get_post'){if(failRead)throw Error('offline');return {structuredContent:structuredClone(post)}};
  if(tool==='get_upload_url'){counts.presign++;const mediaId='media'+(++media);post.media.push({_id:mediaId,status:'pending',sourceFileName:args.fileName});return {structuredContent:{success:true,mediaId,uploadUrl:'https://fixture.s3.amazonaws.com/photo.png?signature=private',fileUrl:'https://fixture.s3.amazonaws.com/photo.png'}};}
  if(tool==='complete_media'){post.media.find(m=>m._id===args.mediaId).status='ready';return {structuredContent:{success:true}};}
  if(tool==='delete_media'){post.media=post.media.filter(m=>m._id!==args.mediaId);return {structuredContent:{success:true}};}
  if(tool==='update_post'){counts.update++;assert.notEqual(args.idempotencyKey,createdKey);post.status=args.status;post.posts[0].status=args.status;post.scheduledTime=args.scheduledTime;if(args.content!==undefined)post.posts[0].content=args.content;return {structuredContent:{success:true}};}
  throw Error('Unexpected MCP tool');
 }};
 const settings={getCurrentProfile:()=>profile,clock:()=>now,getConnector:p=>p==='zernio'?createZernioPublicationConnector(()=>secret,{fetchImpl}):createPublicationConnector(()=>transport,{fetchImpl})};let service=createPublicationExecution(db,settings);
 return {path,db,snap,input,command,counts,requests,get service(){return service},get post(){return post},prepare:mode=>service.prepare('owner',{...input(),provider,accountId:provider==='zernio'?'account':'linkedin-account',mode:mode??'draft'}),execute:()=>service.execute('owner',{...input(),authorize:true}),resume:()=>service.continue('owner',{...input(),authorize:true}),reconcile:()=>service.reconcile('owner',{...input(),externalId:'external'}),reopen:async()=>{await service.close();service=createPublicationExecution(db,settings)},failPut:value=>{failPut=value},failCreate:()=>{failCreate=true},failUpdate:()=>{failUpdate=true},failRead:value=>{failRead=value},advance:ms=>{now+=ms},profile:value=>{profile=value},key:value=>{secret=value},close:async()=>{await service.close();db.close();await rm(directory,{recursive:true,force:true})}};
}

test('Zernio uploads exact approved bytes, schedules, edits same ID and cancels with verified receipts',async()=>{
 const f=await fixture();try{f.prepare('schedule');await f.execute();let d=f.snap().state.publications[0];assert.equal(d.status,'scheduled');assert.equal(d.receipt.provider,'zernio');assert.equal(f.counts.put,1);assert.equal(f.counts.create,1);assert.equal(f.post.publishNow,false);assert.equal(f.post.isDraft,false);assert.equal(JSON.stringify(f.snap()).includes('signature=private'),false);
 const {preview}=f.service.prepareChange('owner',{...f.input(),mode:'schedule',draft:{text:'Updated caption',timeZone:'UTC',plannedAt:new Date(Date.now()+7200000).toISOString()}});await f.service.change('owner',{...f.input(),changeId:preview.id,authorize:true});d=f.snap().state.publications[0];assert.equal(d.version,2);assert.equal(d.text,'Updated caption');assert.equal(d.operation.externalId,'external');assert.equal(f.counts.create,1);assert.equal(f.counts.put,1);
 await f.service.cancel('owner',{...f.input(),authorize:true});assert.equal(f.snap().state.publications[0].receipt.status,'draft');assert.equal(f.snap().state.publications[0].receipt.provider,'zernio');
 }finally{await f.close()}
});
test('Zernio interrupted uploads require explicit recovery and never resume uncertain creation',async()=>{
 const f=await fixture();try{f.prepare();f.failPut(true);await assert.rejects(f.execute(),/unconfirmed/);assert.equal(f.counts.create,0);await f.reopen();await assert.rejects(f.service.continue('owner',f.input()),/Only/);f.failPut(false);await f.resume();assert.equal(f.counts.create,1);assert.equal(f.snap().state.publications[0].receipt.status,'draft');}finally{await f.close()}
 const lost=await fixture();try{lost.prepare();lost.failCreate();await assert.rejects(lost.execute(),/unconfirmed/);await lost.reopen();await assert.rejects(lost.resume(),/Only/);await lost.reconcile();assert.equal(lost.counts.create,1);}finally{await lost.close()}
});
test('altered files, wrong accounts and unsafe upload destinations cannot produce a post',async()=>{
 const f=await fixture();try{f.prepare();await writeFile(f.path,'changed bytes');await assert.rejects(f.execute(),/unconfirmed/);assert.equal(f.counts.presign,0);assert.equal(f.counts.create,0);}finally{await f.close()}
 for(const url of ['http://fixture.s3.amazonaws.com/file','https://127.0.0.1/file','https://fixture.s3.amazonaws.com.evil.test/file','https://user:secret@media.zernio.com/file'])assert.throws(()=>uploadDestination(url));
});
test('Publora uploads only on its own draft, verifies ready media and schedules afterward; interrupted uploads recover without creating a second group',async()=>{
 const f=await fixture('LinkedIn','publora');try{f.prepare('schedule');f.failPut(true);await assert.rejects(f.execute(),/unconfirmed/);assert.equal(f.counts.create,1);assert.equal(f.counts.update,0);assert.equal(f.post.status,'draft');await f.reopen();f.failPut(false);await f.resume();assert.equal(f.counts.create,1);assert.equal(f.post.media.length,1);assert.equal(f.post.media[0].status,'ready');assert.equal(f.post.status,'scheduled');assert.equal(f.snap().state.publications[0].receipt.status,'scheduled');}finally{await f.close()}
});
test('a changed schedule time after upload is never converted into an immediate publication',async()=>{
 const f=await fixture();try{f.prepare('schedule');f.advance(3600000);await assert.rejects(f.execute(),/too close|expired/);assert.equal(f.counts.put,0);assert.equal(f.counts.create,0);}finally{await f.close()}
});
test('TikTok creator settings and both consent flags are checked against the exact approved delivery',async()=>{
 const f=await fixture('TikTok');try{f.prepare();await f.execute();assert.equal(f.snap().state.publications[0].receipt.status,'draft');assert.equal(f.post.platforms[0].platformSpecificData.tiktokSettings.express_consent_given,true);const op=f.snap().state.publications[0].operation;f.post.platforms[0].platformSpecificData.tiktokSettings.privacy_level='SELF_ONLY';assert.throws(()=>verifiedZernioPublication({post:f.post},op),/settings differ/);}finally{await f.close()}
});
test('readback failures retain uploaded media and post ID across restart, without repeating uploads or edits',async()=>{
 const f=await fixture();try{f.prepare();f.failRead(true);await assert.rejects(f.execute(),/unconfirmed/);assert.equal(f.snap().state.publications[0].operation.externalId,'external');await f.reopen();f.failRead(false);await f.reconcile();const {preview}=f.service.prepareChange('owner',{...f.input(),mode:'draft',draft:{text:'Changed',timeZone:'UTC'}});f.failUpdate();await assert.rejects(f.service.change('owner',{...f.input(),changeId:preview.id,authorize:true}),/unconfirmed/);await f.reopen();await f.reconcile();assert.equal(f.snap().state.publications[0].text,'Changed');assert.equal(f.counts.update,1);assert.equal(f.counts.put,1);assert.equal(f.counts.create,1);}finally{await f.close()}
});

test('expired upload recovery can finish as a separately authorized draft with a durable decision',async()=>{
 const f=await fixture();try{f.prepare('schedule');f.failPut(true);await assert.rejects(f.execute());await f.reopen();f.advance(7200000);f.failPut(false);await f.service.continue('owner',{...f.input(),mode:'draft',authorize:true});const d=f.snap().state.publications[0];assert.equal(d.receipt.status,'draft');assert.equal(d.version,2);assert.equal(d.operation.mode,'draft');assert.equal(d.history.at(-1).notes,'Authorized upload recovery as an external draft');assert.equal(f.post.publishNow,false);assert.equal(f.post.scheduledFor,undefined);}finally{await f.close()}
});

test('upload snapshots only the approved bytes even if the source changes during the PUT',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'media-copy-test-')),path=join(directory,'photo.png'),bytes=Buffer.from('approved bytes');await writeFile(path,bytes);let received;
 try{await assert.rejects(uploadPublicationFile({path,sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length,contentType:'image/png'},'https://fixture.s3.amazonaws.com/photo.png',{fetchImpl:async(_url,options)=>{await writeFile(path,'new private unapproved bytes');const chunks=[];for await(const chunk of options.body)chunks.push(chunk);received=Buffer.concat(chunks);return new Response('');}}),/changed/);assert.deepEqual(received,bytes);}finally{await rm(directory,{recursive:true,force:true})}
});

test('partial remote media cannot be reconciled as an approval of the full media set',async()=>{
 const f=await fixture();try{f.prepare();await f.execute();const op=f.snap().state.publications[0].operation;assert.throws(()=>verifiedZernioPublication({post:f.post},{...op,files:[...op.files,{...op.files[0],assetId:'another-file'}]}),/differs/);f.post.platforms[0].accountId='foreign-account';await assert.rejects(f.reconcile(),/differs/);assert.equal(f.snap().state.publications[0].status,'sending');assert.equal(f.counts.create,1);}finally{await f.close()}
});

test('restored interrupted uploads cannot inherit an external write authorization',async()=>{
 const f=await fixture();try{f.prepare();f.failPut(true);await assert.rejects(f.execute());f.db.prepare('DELETE FROM publication_intents').run();await f.reopen();f.failPut(false);await assert.rejects(f.resume(),/restored or changed/);assert.equal(f.counts.create,0);assert.equal(f.counts.put,1);}finally{await f.close()}
});

test('a cancelled media post may be explicitly rescheduled and cancelled again without reusing the prior cancellation',async()=>{
 for(const provider of ['publora','zernio']){const f=await fixture('LinkedIn',provider);try{f.prepare('schedule');await f.execute();await f.service.cancel('owner',{...f.input(),authorize:true});const old=f.snap().state.publications[0].operation.cancelRequestId;const {preview}=f.service.prepareChange('owner',{...f.input(),mode:'schedule',draft:{text:'Rescheduled post',timeZone:'UTC',plannedAt:new Date(Date.now()+7200000).toISOString()}});await f.service.change('owner',{...f.input(),changeId:preview.id,authorize:true});assert.equal(f.snap().state.publications[0].operation.cancelRequestId,undefined);await f.service.cancel('owner',{...f.input(),authorize:true});assert.notEqual(f.snap().state.publications[0].operation.cancelRequestId,old);assert.equal(f.snap().state.publications[0].receipt.status,'draft');assert.equal(f.counts.create,1);assert.equal(f.counts.put,1);}finally{await f.close()}}
});
