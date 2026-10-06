import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDesktopStateStore} from '../desktop-state-store.mjs';
import {putStudioField} from '../src/features/content/studioDraftModel.ts';
import {safeData,parseBackup} from '../src/data/backupFormat.ts';
import {startDraftScope,runDraftScope,scheduleDraftScope,validSelection,validNetworks,videoDraftValue,restoreVideo,targetsDraftValue,restoreTargets,validTimeZone,validLocalDate,scheduleFingerprint} from '../src/features/production/productionDrafts.ts';

const run=(changes={})=>({id:'r1',workspaceId:'w1',reviewHash:'hash-1',reviewDeliveries:[{id:'d1',version:1,platform:'TikTok'}],approvedVideo:{assetId:'video',versionId:'v1',sha256:'abc'},...changes});
const target={platform:'TikTok',provider:'zernio',accountId:'account',networkSettings:{tiktokSettings:{privacy_level:'PUBLIC_TO_EVERYONE',commercialContentType:'none',allow_comment:true,allow_duet:false,allow_stitch:false,video_made_with_ai:true,content_preview_confirmed:true,express_consent_given:true}},authorize:true,resend:true,reviewed:true,error:'transient'};

test('start, notes and schedule drafts separate workspaces, flows, sessions, runs and reviewed versions',()=>{
 const keys=[startDraftScope('w','f','s'),startDraftScope('w2','f','s'),startDraftScope('w','f2','s'),startDraftScope('w','f','s2'),runDraftScope('w','r','notes'),runDraftScope('w','r2','notes'),runDraftScope('w2','r','notes')];
 assert.equal(new Set(keys).size,keys.length);
 const base=scheduleDraftScope(run());
 for(const changed of [{workspaceId:'w2'},{id:'r2'},{reviewHash:'hash-2'},{reviewDeliveries:[{id:'d1',version:2,platform:'TikTok'}]},{approvedVideo:{assetId:'video',versionId:'v2',sha256:'def'}}])assert.notEqual(scheduleDraftScope(run(changed)),base);
 assert.equal(scheduleDraftScope(run({revision:90,updatedAt:'later'})),base,'polling revisions must not discard user fields');
});

test('restored targets retain preferences but never restore authorization, resend or media consent',()=>{
 const value=targetsDraftValue([target]);
 for(const field of ['authorize','resend','reviewed','error','content_preview_confirmed','express_consent_given'])assert.equal(value.includes(field),false);
 const restored=restoreTargets(value,run())[0];
 assert.equal(restored.accountId,'account');assert.equal(restored.networkSettings.tiktokSettings.allow_comment,true);
 assert.equal(restored.networkSettings.tiktokSettings.content_preview_confirmed,false);assert.equal(restored.networkSettings.tiktokSettings.express_consent_given,false);
 const injected=restoreTargets(JSON.stringify([target]),run())[0];assert.equal(injected.networkSettings.tiktokSettings.express_consent_given,false);
 assert.deepEqual(restoreTargets(value,run({reviewDeliveries:[]})),[]);
 assert.equal(restoreTargets(JSON.stringify([{...target,provider:'publora'}]),run())[0].accountId,'');
 assert.equal(restoreTargets('{broken',run())[0].accountId,'');
});

test('restored video selections require the exact available source version and hash',()=>{
 const asset={id:'a',kind:'video',role:'source',status:'available',currentVersionId:'v1',versions:[{id:'v1',sha256:'abc'}]};
 const value=videoDraftValue(asset);assert.equal(restoreVideo(value,[asset]),'a');
 for(const changed of [{status:'missing'},{role:'output'},{kind:'image'},{currentVersionId:'v2'},{versions:[{id:'v1',sha256:'changed'}]}])assert.equal(restoreVideo(value,[{...asset,...changed}]),'');
 assert.equal(restoreVideo('',[{...asset,versions:[]}]),'');
 assert.equal(validSelection('old',[{id:'new'}]),'');assert.equal(validSelection('new',[{id:'new'}]),'new');
 assert.deepEqual(validNetworks(['Instagram','Unknown','TikTok','Instagram']),['Instagram','TikTok']);
 assert.equal(validTimeZone('invalid-zone'),'UTC');
 assert.equal(validLocalDate('2026-10-09T18:00'),'2026-10-09T18:00');
 for(const invalid of ['not a date','2026-02-30T18:00','2026-10-09T28:00'])assert.equal(validLocalDate(invalid),'');
});

test('review fingerprint invalidates time, zone, account, provider, settings and package changes',()=>{
 const scope=scheduleDraftScope(run()),base=scheduleFingerprint(scope,'tomorrow','','UTC',[target]);
 for(const args of [[scope,'today','','UTC',[target]],[scope,'tomorrow','2026-10-09T18:00','UTC',[target]],[scope,'tomorrow','','America/Sao_Paulo',[target]],[scope,'tomorrow','','UTC',[{...target,accountId:'other'}]],[scope,'tomorrow','','UTC',[{...target,provider:'publora'}]],[scope,'tomorrow','','UTC',[{...target,networkSettings:{}}]],[scheduleDraftScope(run({reviewHash:'changed'})),'tomorrow','','UTC',[target]]])assert.notEqual(scheduleFingerprint(...args),base);
});

test('production drafts survive profile-store restart and existing backup import without approval fields',()=>{
 const dir=mkdtempSync(join(tmpdir(),'production-drafts-'));let db=createDesktopStateStore(dir,'test');
 try{
  db.initialize('owner',{});db.initialize('other',{});
  const notes=runDraftScope('w1','r1','notes'),other=runDraftScope('w1','r2','notes'),schedule=scheduleDraftScope(run());
  let drafts=putStudioField({},notes,'notes','Keep the ending');drafts=putStudioField(drafts,other,'notes','Another run');drafts=putStudioField(drafts,schedule,'targets',targetsDraftValue([target]));drafts=putStudioField(drafts,schedule,'date','2026-10-09T18:00');
  db.write('owner','studio-drafts',drafts);db.close();db=createDesktopStateStore(dir,'test');
  const saved=db.read('owner','studio-drafts');assert.equal(saved[notes].fields.notes,'Keep the ending');assert.equal(saved[other].fields.notes,'Another run');assert.equal(db.read('other','studio-drafts'),undefined);
  const backup=parseBackup(JSON.stringify({format:'mainsagents-backup',version:1,exportedAt:new Date().toISOString(),data:safeData({'studio-drafts':saved})}));
  assert.equal(backup.data['studio-drafts'][schedule].fields.date,'2026-10-09T18:00');assert.equal(restoreTargets(backup.data['studio-drafts'][schedule].fields.targets,run())[0].networkSettings.tiktokSettings.express_consent_given,false);
 }finally{db.close();rmSync(dir,{recursive:true,force:true})}
});
