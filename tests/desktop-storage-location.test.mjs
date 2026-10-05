import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesktopStateStore } from '../desktop-state-store.mjs';
import { desktopStorageDirectory, openDesktopWorkspaceStore } from '../desktop-storage-location.mjs';

test('different AppData views restore the same team and later edits survive another launch', async () => {
  const root=mkdtempSync(join(tmpdir(),'mains-launcher-'));
  const home=join(root,'home'), packaged=join(root,'virtual-AppData'), windows=join(root,'physical-AppData');
  const virtual=createDesktopStateStore(packaged,'old');
  virtual.initialize('account',{agents:[{id:'content'},{id:'video',skills:['editing']},{id:'linkedin',skills:['linkedin']}],sessions:[{id:'history',messages:[{id:'message',content:'Saved'}]}]});virtual.selectProfile('account');
  const physical=createDesktopStateStore(windows,'old');physical.initialize('account',{agents:[{id:'content'}]});physical.selectProfile('account');physical.close();
  let store=await openDesktopWorkspaceStore(home,packaged,'new');
  // Migration includes WAL commits even with the source still open.
  assert.equal(store.read('account','agents').length,3);
  assert.deepEqual(store.read('account','sessions'),[{id:'history',messages:[{id:'message',content:'Saved'}]}]);
  store.write('account','agents',[{id:'content'},{id:'video',skills:['editing','new-skill']},{id:'linkedin',skills:['linkedin']}]);
  store.recoverySnapshot();store.close();virtual.close();
  store=await openDesktopWorkspaceStore(home,windows,'next');
  assert.equal(store.currentProfile(),'account');assert.equal(store.read('account','agents').length,3);
  assert.deepEqual(store.read('account','agents')[1].skills,['editing','new-skill']);
  // An intentional deletion must not be undone by legacy recovery on reopen.
  store.write('account','agents',[{id:'content'},{id:'linkedin'}]);store.close();
  store=await openDesktopWorkspaceStore(home,packaged,'next');
  assert.equal(store.read('account','agents').length,2);store.close();
  assert.equal(existsSync(join(desktopStorageDirectory(home),'backups','workspace-latest.json')),true);
});

test('a corrupt legacy database never silently migrates an empty workspace',async()=>{
  const root=mkdtempSync(join(tmpdir(),'mains-migration-error-')),legacy=join(root,'legacy'),home=join(root,'home');
  mkdirSync(legacy);const path=join(legacy,'workspace-state.sqlite');writeFileSync(path,'original corrupt bytes');
  await assert.rejects(openDesktopWorkspaceStore(home,legacy,'1'));
  assert.equal(readFileSync(path,'utf8'),'original corrupt bytes');
  assert.equal(existsSync(join(desktopStorageDirectory(home),'workspace-state.sqlite')),false);
});
