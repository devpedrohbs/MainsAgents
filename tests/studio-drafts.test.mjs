import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {PersistentState} from '../src/data/PersistentState.ts';
import {createDesktopStateStore} from '../desktop-state-store.mjs';
import {studioDraftKey,putStudioField,validateStudioDrafts,sameDraftShape} from '../src/features/content/studioDraftModel.ts';
import {composeImport,parseBackup,safeData} from '../src/data/backupFormat.ts';
test('Studio drafts persist immediately, separate workspace and artifact versions, and travel in backups',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'studio-draft-'));let db=createDesktopStateStore(dir,'test');
 try{db.initialize('owner',{});db.initialize('other',{});const store={readAll:async()=>db.readAll('owner'),writeSync:(key,value)=>db.write('owner',key,value)},state=new PersistentState(store,()=>{});await state.restore();state.get('studio-drafts',{});
 const first=studioDraftKey('script','w','c','v1'),next=studioDraftKey('script','w','c','v2');state.set('studio-drafts',current=>putStudioField(current,first,'text','Unsent final script'));state.set('studio-drafts',current=>putStudioField(current,next,'text','Other version'));db.close();db=createDesktopStateStore(dir,'test');
 const saved=db.read('owner','studio-drafts');assert.equal(saved[first].fields.text,'Unsent final script');assert.equal(saved[next].fields.text,'Other version');assert.equal(db.read('other','studio-drafts'),undefined);
 const file=parseBackup(JSON.stringify({format:'mainsagents-backup',version:1,exportedAt:new Date().toISOString(),data:safeData({'studio-drafts':saved,'api-key':'do not export'})}));assert.equal(file.data['api-key'],undefined);assert.equal(composeImport({},file,'replace')['studio-drafts'][first].fields.text,'Unsent final script');
 const local=putStudioField({},first,'text','Local conflict');assert.equal(composeImport({'studio-drafts':local},file,'merge')['studio-drafts'][first].fields.text,'Local conflict');
 }finally{db.close();rmSync(dir,{recursive:true,force:true})}
});
test('malformed imported form data cannot restore objects into text fields or accept invalid scopes',()=>{
 assert.equal(sameDraftShape({text:'bad'},''),false);assert.equal(sameDraftShape(['safe',{}],[]),false);assert.equal(validateStudioDrafts({'wrong':{fields:{text:'x'},updatedAt:new Date().toISOString()}}),false);
 assert.throws(()=>parseBackup(JSON.stringify({format:'mainsagents-backup',version:1,exportedAt:new Date().toISOString(),data:{'studio-drafts':{'wrong':{fields:{},updatedAt:'today'}}}})),/Studio drafts/);
});
