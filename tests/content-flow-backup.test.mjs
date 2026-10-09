import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBackup} from '../src/data/backupFormat.ts';

const at='2026-10-01T00:00:00.000Z';
const reference={id:'r1',workspaceId:'space',sourceUrl:'https://www.tiktok.com/@a/video/1',sourceHost:'www.tiktok.com',platform:'tiktok',notes:'Bom ritmo',tags:['ritmo'],metadataStatus:'not_collected',revision:2,createdAt:at,updatedAt:at,asset:{assetId:'video-1',name:'ref.mp4'}};
const backup=(inspiration,data={})=>JSON.stringify({format:'mainsagents-backup',version:1,exportedAt:at,data,editorial:{schemaVersion:1,topics:[],contents:[{id:'c',workspaceId:'space',title:'Conteúdo',assetIds:['video-1']}],runs:[],artifacts:[],approvals:[],assets:[{id:'video-1',workspaceId:'space',contentId:'c',kind:'video',role:'reference',name:'ref.mp4',status:'available',currentVersionId:'v1',versions:[{id:'v1',path:'C:/videos/ref.mp4',name:'ref.mp4',size:1,sha256:'a'.repeat(64),modifiedAt:at,createdAt:at}],createdAt:at,updatedAt:at}],publications:[],inspiration}});

test('reference library survives a backup round trip and the Studio references view is a valid saved view',()=>{
 const file=parseBackup(backup({schemaVersion:1,references:[reference]},{'studio-view':'references'}));
 assert.deepEqual(file.editorial.inspiration.references[0],reference,'references keep link, notes, tags and the asset id only');
 assert.equal(JSON.stringify(file.editorial.inspiration).includes('C:/videos'),false,'no private path inside the library');
});

test('a backup cannot smuggle paths, execution fields or cross-workspace assets into the library',()=>{
 assert.throws(()=>parseBackup(backup({schemaVersion:1,references:[{...reference,asset:{...reference.asset,path:'C:/Users/me/private.mp4'}}]})),/reference library/);
 assert.throws(()=>parseBackup(backup({schemaVersion:1,references:[{...reference,autorun:true}]})),/reference library/);
 assert.throws(()=>parseBackup(backup({schemaVersion:1,references:[{...reference,workspaceId:'other'}]})),/reference library/,'asset of another workspace');
 assert.throws(()=>parseBackup(backup({schemaVersion:2,references:[]})),/reference library/);
});
