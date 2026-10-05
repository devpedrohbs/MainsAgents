import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,renameSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {inspectLocalAsset,localAssetPath} from '../editorial-local-files.mjs';
import {registerEditorialFilesIpc} from '../editorial-files-ipc.mjs';
import {validateEditorialAssets} from '../editorial-assets-validation.mjs';
import {attachAssetFiles,reviseAssetFile,verifyAssetFiles,changeAssetMetadata,removeAsset} from '../src/features/content/assetModel.ts';
import {backupFileReferences,parseBackup} from '../src/data/backupFormat.ts';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {createDesktopStateStore} from '../desktop-state-store.mjs';
const empty=()=>({schemaVersion:1,topics:[],contents:[{id:'one',workspaceId:'w1'},{id:'two',workspaceId:'w2'}],runs:[],artifacts:[],approvals:[]});
const fixture=()=>{const root=mkdtempSync(join(tmpdir(),'mains-assets-'));const path=join(root,'raw.mp4');writeFileSync(path,'original-video');return {root,path};};
const inspect=path=>inspectLocalAsset(path,{stabilityMs:1});
async function call(bridge,method,body){const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);req.method=method;const res={status:0,data:null,writeHead(status){this.status=status;},end(value){this.data=JSON.parse(value);}};await bridge.handle(req,res,new URL('http://localhost/api/content/state?profile=owner'));return res;}

test('local files are fingerprinted read-only; missing, unsupported and changing files are explicit',async()=>{
  const {root,path}=fixture();try{
    const file=await inspect(path);assert.equal(file.status,'available');assert.equal(file.kind,'video');assert.equal(file.sha256,createHash('sha256').update(readFileSync(path)).digest('hex'));assert.equal(readFileSync(path,'utf8'),'original-video');
    assert.equal((await inspect(join(root,'gone.mp4'))).status,'missing');assert.throws(()=>localAssetPath('https://example.com/file.mp4'));assert.throws(()=>localAssetPath('\\\\server\\file.mp4'));assert.throws(()=>localAssetPath(join(root,'run.exe')));
    const pending=inspectLocalAsset(path,{stabilityMs:120});await new Promise(resolve=>setTimeout(resolve,50));writeFileSync(path,'copy-still-changing');assert.equal((await pending).status,'unstable');
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('duplicates are scoped to content; version history and moved file identity are preserved',async()=>{
  const {root,path}=fixture();try{
    const file=await inspect(path);let state=attachAssetFiles(empty(),'one',[file,file],'source');assert.equal(state.assets.length,1);state=attachAssetFiles(state,'two',[file],'source');assert.equal(state.assets.length,2);assert.ok(validateEditorialAssets(state));
    const asset=state.assets[0],originalVersion=asset.currentVersionId;const moved=join(root,'moved.mp4');renameSync(path,moved);
    state=verifyAssetFiles(state,[{id:asset.id,versionId:originalVersion,inspection:await inspect(file.path)}]);assert.equal(state.assets[0].status,'missing');
    const movedFile=await inspect(moved);state=reviseAssetFile(state,asset.id,originalVersion,movedFile,true);assert.equal(state.assets[0].versions.length,1);assert.equal(state.assets[0].versions[0].path,movedFile.path);
    writeFileSync(moved,'new-edit');const next=await inspect(moved);
    assert.throws(()=>reviseAssetFile(state,asset.id,originalVersion,next,true),/different file/);
    state=verifyAssetFiles(state,[{id:asset.id,versionId:originalVersion,inspection:next}]);assert.equal(state.assets[0].status,'changed');
    state=reviseAssetFile(state,asset.id,originalVersion,next,false);assert.equal(state.assets[0].versions.length,2);assert.equal(state.assets[0].versions[0].sha256,file.sha256);
    assert.throws(()=>reviseAssetFile(state,asset.id,originalVersion,next,false),/version changed/);
    const checked=verifyAssetFiles(state,[{id:asset.id,versionId:originalVersion,inspection:{...next,status:'missing'}}]);assert.equal(checked.assets[0].status,'available');
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('derived output links stay in the same content and unlink never deletes local files',async()=>{
  const {root,path}=fixture();try{
    let state=attachAssetFiles(empty(),'one',[await inspect(path)],'source');const output=join(root,'cut.mp4');writeFileSync(output,'edited');state=attachAssetFiles(state,'one',[await inspect(output)],'output');state=attachAssetFiles(state,'two',[await inspect(path)],'source');
    const [source,result,other]=state.assets;assert.throws(()=>changeAssetMetadata(state,result.id,'output',other.id),/original file/);state=changeAssetMetadata(state,result.id,'output',source.id);assert.ok(validateEditorialAssets(state));
    assert.throws(()=>changeAssetMetadata(state,source.id,'output',result.id),/itself/);
    const cyclic=structuredClone(state);cyclic.assets[0].sourceAssetId=result.id;assert.equal(validateEditorialAssets(cyclic),false);
    state=removeAsset(state,source.id);assert.equal(state.assets[0].sourceAssetId,undefined);assert.equal(state.contents[0].assetIds.length,1);assert.ok(existsSync(path));assert.ok(existsSync(output));
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('file metadata survives SQLite restart and atomic restore; malformed backups are rejected',async()=>{
  const {root,path}=fixture();const storage=join(root,'storage'),dbPath=join(storage,'workspace-state.sqlite');let store=createDesktopStateStore(storage,'test');store.initialize('owner',{agents:[{id:'keep'}]});let bridge=createContentWorkflowBridge({dbPath});
  try{
    const state=attachAssetFiles(empty(),'one',[await inspect(path)],'source');assert.equal((await call(bridge,'PUT',{revision:0,state})).status,200);await bridge.close();store.close();store=createDesktopStateStore(storage,'test');bridge=createContentWorkflowBridge({dbPath});assert.deepEqual((await call(bridge,'GET')).data.state,state);
    const backup={format:'mainsagents-backup',version:1,data:{agents:[{id:'keep'}]},editorial:state};assert.ok(backupFileReferences(parseBackup(JSON.stringify(backup))).includes(state.assets[0].versions[0].path));const invalid=structuredClone(backup);invalid.editorial.assets[0].currentVersionId='missing';assert.throws(()=>parseBackup(JSON.stringify(invalid)),/library/);
    assert.equal((await call(bridge,'PUT',{revision:1,state:invalid.editorial})).status,400);
    const snapshot=store.workspaceSnapshot('owner');store.restoreWorkspace('owner',snapshot.values,state,{revisions:snapshot.revisions,editorialRevision:snapshot.editorial.revision});assert.equal(store.workspaceSnapshot('owner').editorial.state.assets[0].status,'unchecked');assert.deepEqual(store.readAll('owner').agents,[{id:'keep'}]);
  }finally{await bridge.close();store.close();rmSync(root,{recursive:true,force:true});}
});

test('native file requests enforce profile/content ownership, trusted main frame and single writer',async()=>{
  const {root,path}=fixture();try{
    const state=attachAssetFiles(empty(),'one',[await inspect(path)],'source'),handlers=new Map(),sender={mainFrame:{}},event={sender,senderFrame:sender.mainFrame};let profile='owner',revealCount=0,openCount=0,release;
    const store={currentProfile:()=>profile,workspaceSnapshot:()=>({editorial:{state}})};
    registerEditorialFilesIpc({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},dialog:{showOpenDialog:async()=>({canceled:false,filePaths:[path]})},shell:{showItemInFolder:()=>revealCount++,openPath:async()=>{openCount++;return ''}},getWindow:()=>({webContents:sender}),getStore:()=>store,inspect});
    const verify=handlers.get('files:verify');await assert.rejects(verify({sender:{}},'owner','one'),/Untrusted/);await assert.rejects(verify({sender,senderFrame:{}},'owner','one'),/Untrusted/);await assert.rejects(verify(event,'other','one'),/profile/);await assert.rejects(verify(event,'owner','gone'),/content/);
    assert.equal((await verify(event,'owner','one')).length,1);await handlers.get('files:reveal')(event,'owner','one',state.assets[0].id);assert.equal(revealCount,1);
    const open=handlers.get('files:open');await assert.rejects(open({sender:{}},'owner','one',state.assets[0].id),/Untrusted/);await assert.rejects(open(event,'other','one',state.assets[0].id),/profile/);await open(event,'owner','one',state.assets[0].id);assert.equal(openCount,1);
    const document=join(root,'instructions.md');writeFileSync(document,'document');const inspection=await inspect(document),version=state.assets[0].versions[0],saved={...version};Object.assign(version,{path:document,sha256:inspection.sha256});await assert.rejects(open(event,'owner','one',state.assets[0].id),/verified linked media/);assert.equal(openCount,1);Object.assign(version,saved);
    writeFileSync(path,'modified');await assert.rejects(handlers.get('files:reveal')(event,'owner','one',state.assets[0].id),/changed/);assert.equal(revealCount,1);
    registerEditorialFilesIpc({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},dialog:{showOpenDialog:()=>new Promise(resolve=>release=resolve)},shell:{},getWindow:()=>({webContents:sender}),getStore:()=>store,inspect});
    const pending=handlers.get('files:select')(event,'owner','one',true);await assert.rejects(handlers.get('files:verify')(event,'owner','one'),/Wait/);profile='other';release({canceled:true});await assert.rejects(pending,/profile/);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('a changed delivered version revokes readiness without deleting its approval history',async()=>{
 const {root,path}=fixture();try{
  let state=attachAssetFiles(empty(),'one',[await inspect(path)],'output');const asset=state.assets[0],version=asset.versions[0];
  state.contents[0].productionStage='ready';state.contents[0].fileDeliveryArtifactId='files';
  state.artifacts=[{id:'files',type:'file-delivery',contentId:'one',data:{summary:'Result',files:[{assetId:asset.id,versionId:version.id,sha256:version.sha256}]}}];
  state.approvals=[{artifactId:'files',action:'file-review',decision:'approved'}];
  const removed=removeAsset(state,asset.id);assert.equal(removed.contents[0].productionStage,'video-review');assert.equal(removed.approvals.length,1);
  writeFileSync(path,'new edited bytes');const next=await inspect(path);
  const changed=verifyAssetFiles(state,[{id:asset.id,versionId:version.id,inspection:next}]);assert.equal(changed.contents[0].productionStage,'video-review');assert.equal(changed.approvals[0].decision,'approved');
  const revised=reviseAssetFile(state,asset.id,version.id,next,false);assert.equal(revised.contents[0].productionStage,'video-review');assert.equal(revised.assets[0].versions.length,2);
 }finally{rmSync(root,{recursive:true,force:true});}
});
