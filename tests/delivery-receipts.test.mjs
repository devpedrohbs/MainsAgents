import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,appendFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createDeliveryReceipts,validReceiptView} from '../delivery-receipts.mjs';
import {inspectLocalAsset} from '../editorial-local-files.mjs';
import {openableReceiptKinds,registerDeliveryReceiptsIpc} from '../delivery-receipts-ipc.mjs';

const inspect=path=>inspectLocalAsset(path,{stabilityMs:0});
const setup=()=>{const dir=mkdtempSync(join(tmpdir(),'receipts-')),db=new DatabaseSync(':memory:');let profile='owner';const receipts=createDeliveryReceipts(db,{inspect,getCurrentProfile:()=>profile});return {dir,db,receipts,switchTo:value=>profile=value};};

test('a receipt is issued only for a verified, final file and is idempotent per source and bytes',async()=>{
 const {dir,receipts}=setup(),file=join(dir,'video-final.mp4');writeFileSync(file,'final bytes');
 const verified=await inspect(file);
 const first=await receipts.issue('owner',{source:{kind:'production-video',id:'run-1',step:'epoch-1'},contentId:'c1',path:file,expectedSha256:verified.sha256,producedBy:{agentName:'Editor',providerId:'claude',secret:'x'}});
 assert(validReceiptView(first));assert.equal(first.path,verified.path);assert.equal(first.version,1);assert.equal(first.profileId,undefined);assert.deepEqual(first.producedBy,{agentName:'Editor',providerId:'claude'});
 assert.equal((await receipts.issue('owner',{source:{kind:'production-video',id:'run-1',step:'epoch-1'},contentId:'c1',path:file})).id,first.id,'retry/restart returns the same receipt');
 const other=await receipts.issue('owner',{source:{kind:'media-export',id:'job-1'},contentId:'c1',path:file});assert.equal(other.version,1,'same bytes from another source share the version');
 const partial=join(dir,'attempt-1.partial.mp4');writeFileSync(partial,'x');
 await assert.rejects(()=>receipts.issue('owner',{source:{kind:'media-export',id:'job-2'},path:partial}),/partial/);
 await assert.rejects(()=>receipts.issue('owner',{source:{kind:'media-export',id:'job-3'},path:file,expectedSha256:'0'.repeat(64)}),/differs/);
 await assert.rejects(()=>receipts.issue('owner',{source:{kind:'media-export',id:'job-4'},path:join(dir,'planned-but-never-written.mp4')}),/moved or removed|could not/);
 await assert.rejects(()=>receipts.issue('owner',{source:{kind:'made-up',id:'x'},path:file}),/Invalid/);
 await assert.rejects(()=>receipts.issue('owner',{source:{kind:'media-export',id:'job-5'},path:'relative/file.mp4'}),/./);
 const second=join(dir,'video-v2.mp4');writeFileSync(second,'second version');
 assert.equal((await receipts.issue('owner',{source:{kind:'production-video',id:'run-1',step:'epoch-2'},contentId:'c1',path:second})).version,2);
});

test('receipts stay in their profile and are re-verified before any action',async()=>{
 const {dir,receipts,switchTo}=setup(),file=join(dir,'out.mp4');writeFileSync(file,'bytes');
 const receipt=await receipts.issue('owner',{source:{kind:'delegation',id:'job'},sessionId:'chat-1',path:file});
 assert.equal((await receipts.check('owner',receipt.id)).status,'available');
 assert.throws(()=>receipts.get('other-profile-not-active',receipt.id),/profile changed/,'never resolved for a profile that is not active');
 switchTo('other');assert.throws(()=>receipts.get('owner',receipt.id),/profile changed/);await assert.rejects(()=>receipts.check('other',receipt.id),/not found/);switchTo('owner');
 appendFileSync(file,'changed');assert.equal((await receipts.check('owner',receipt.id)).status,'changed');
 rmSync(file);assert.equal((await receipts.check('owner',receipt.id)).status,'missing');
 assert.deepEqual(receipts.list('owner',{sessionId:'chat-1'}).map(r=>r.id),[receipt.id]);assert.deepEqual(receipts.list('owner',{sessionId:'chat-2'}),[]);
});

test('IPC opens or reveals only after the host re-verifies the bytes, from the trusted window and active profile',async()=>{
 const {dir,receipts}=setup(),video=join(dir,'clip.mp4'),doc=join(dir,'notes.srt');writeFileSync(video,'v');writeFileSync(doc,'1');
 const handlers=new Map(),opened=[],shown=[],window={webContents:{id:1}};
 registerDeliveryReceiptsIpc({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},shell:{openPath:async path=>{opened.push(path);return '';},showItemInFolder:path=>shown.push(path)},getWindow:()=>window,getReceipts:()=>receipts,getCurrentProfile:()=>'owner'});
 const event={sender:window.webContents};
 const v=await receipts.issue('owner',{source:{kind:'media-export',id:'a'},path:video}),d=await receipts.issue('owner',{source:{kind:'media-export',id:'b'},path:doc});
 assert.equal(await handlers.get('receipts:open')(event,'owner',v.id),true);assert.deepEqual(opened,[v.path]);
 await assert.rejects(()=>handlers.get('receipts:open')(event,'owner',d.id),/Show in folder/);assert(!openableReceiptKinds.includes(d.fileKind));
 assert.equal(await handlers.get('receipts:reveal')(event,'owner',d.id),true);assert.deepEqual(shown,[d.path]);
 await assert.rejects(()=>handlers.get('receipts:open')({sender:{id:2}},'owner',v.id),/Untrusted/);
 await assert.rejects(()=>handlers.get('receipts:reveal')(event,'someone-else',v.id),/profile changed/);
 appendFileSync(video,'tampered');await assert.rejects(()=>handlers.get('receipts:open')(event,'owner',v.id),/changed after delivery/);assert.equal(opened.length,1);
});
