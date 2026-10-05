import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {validatePublications} from '../editorial-publications.mjs';
import {localTimeToInstant,zonedDateTime} from '../publication-time.mjs';
import {editorialReviewCommand} from '../src/features/content/reviewCommands.ts';
import {parseBackup} from '../src/data/backupFormat.ts';

function fixture(){
  const path=join(mkdtempSync(join(tmpdir(),'publications-')),'state.sqlite'),settings={dbPath:path,getCurrentProfile:()=> 'owner'};
  let bridge=createContentWorkflowBridge(settings);const db=new DatabaseSync(path),at=new Date().toISOString();
  db.prepare('INSERT INTO editorial_state VALUES (?,?,?,?)').run('owner',1,JSON.stringify({schemaVersion:1,topics:[],contents:[{id:'content',workspaceId:'workspace',title:'My project'}],runs:[],artifacts:[],approvals:[],assets:[{id:'video',workspaceId:'workspace',contentId:'content',status:'available',currentVersionId:'v1',versions:[{id:'v1',sha256:'a'.repeat(64)}]}]}),at);
  const state=()=>JSON.parse(db.prepare('SELECT state_json FROM editorial_state').get().state_json);
  const command=(input={})=>bridge.publications.command('owner',{revision:db.prepare('SELECT revision FROM editorial_state').get().revision,contentId:'content',...input});
  const create=platform=>command({action:'create',platform,draft:{text:'A professional post',assetIds:[],timeZone:'America/Sao_Paulo',plannedAt:'2026-10-05T18:00:00Z'}}).state.publications.at(-1);
  const decide=(delivery,action,extra={})=>command({id:delivery.id,expectedDelivery:delivery,action,...extra}).state.publications.find(item=>item.id===delivery.id);
  return {state,command,create,decide,db,get bridge(){return bridge},reopen:async()=>{await bridge.close();bridge=createContentWorkflowBridge(settings)},close:async()=>{await bridge.close();db.close()}};
}
test('network delivery reviews remain independent, durable, version bound and never a confirmed schedule',async()=>{
  const f=fixture();try{
    const instagram=f.create('Instagram'),linkedin=f.create('LinkedIn');
    const reviewed=f.decide(instagram,'submit'),approved=f.decide(reviewed,'approve');
    assert.equal(approved.status,'approved');assert.equal(approved.receipt,undefined);
    assert.equal(f.state().publications.find(item=>item.id===linkedin.id).status,'draft');
    await f.reopen();assert.equal(f.state().publications[0].history[1].payload.text,'A professional post');
    assert.throws(()=>f.create('Instagram'),/already/);
    assert.throws(()=>f.decide(approved,'scheduled'),/connector/);
    assert.throws(()=>f.decide(instagram,'approve'),/changed/);
    const changed=f.decide(approved,'edit',{draft:{text:'Changed after approval',assetIds:[],timeZone:'UTC',plannedAt:'2026-10-06T12:00:00Z'}});
    assert.equal(changed.version,2);assert.equal(changed.status,'draft');assert.equal(changed.history[1].payload.text,'A professional post');
    assert.throws(()=>f.decide(changed,'approve'),/Submit/);
  }finally{await f.close()}
});
test('missing or changed media and stale payloads cannot approve, and failed edits roll back',async()=>{
  const f=fixture();try{
    let delivery=f.create('YouTube');
    const before=f.state();assert.throws(()=>f.decide(delivery,'edit',{draft:{text:'x',assetIds:['missing'],timeZone:'UTC'}}),/Check/);assert.deepEqual(f.state(),before);
    delivery=f.decide(delivery,'edit',{draft:{text:'video post',assetIds:['video'],timeZone:'UTC'}});
    delivery=f.decide(delivery,'submit');
    const state=f.state();state.assets[0].currentVersionId='v2';state.assets[0].versions.push({id:'v2',sha256:'b'.repeat(64)});f.db.prepare('UPDATE editorial_state SET state_json=?').run(JSON.stringify(state));
    assert.throws(()=>f.decide(delivery,'approve'),/file changed/);assert.equal(f.state().publications[0].status,'in-review');
    assert.throws(()=>f.decide({...delivery,text:'not reviewed'},'approve'),/delivery changed/);
  }finally{await f.close()}
});
test('publication validation rejects fabricated external success and supports old snapshots and backups',async()=>{
  const f=fixture();try{
    f.create('LinkedIn');const state=f.state();delete state.assets;
    assert(validatePublications(state));assert(validatePublications({contents:[]}));
    const backup={format:'mainsagents-backup',version:1,exportedAt:new Date().toISOString(),data:{},editorial:state};
    assert.equal(parseBackup(JSON.stringify(backup)).editorial.publications.length,1);
    state.publications[0].status='scheduled';assert.equal(validatePublications(state),false);assert.throws(()=>parseBackup(JSON.stringify(backup)),/publication/);
  }finally{await f.close()}
});
test('planned wall times use the selected zone and refuse DST gaps and ambiguous hours',()=>{
  assert.equal(localTimeToInstant('2026-10-05T15:00','America/Sao_Paulo'),'2026-10-05T18:00:00.000Z');
  assert.equal(zonedDateTime('2026-10-05T18:00:00Z','America/Sao_Paulo'),'2026-10-05T15:00');
  assert.throws(()=>localTimeToInstant('2026-03-08T02:30','America/New_York'),/does not exist/);
  assert.throws(()=>localTimeToInstant('2026-11-01T01:30','America/New_York'),/twice/);
  assert.throws(()=>localTimeToInstant('2026-02-30T12:00','UTC'),/does not exist/);
});
test('review commands are explicit requests for a version review, never authorization hidden in prose',()=>{
  assert.equal(editorialReviewCommand('aprovo esse roteiro').decision,'approve');
  assert.equal(editorialReviewCommand('Approve this script').decision,'approve');
  assert.deepEqual(editorialReviewCommand('ajuste: encurte a introdução'),{decision:'revision-requested',notes:'encurte a introdução'});
  assert.equal(editorialReviewCommand('O agente disse "aprovo esse roteiro"'),null);
  assert.equal(editorialReviewCommand('aprovo e publique tudo'),null);
  assert.equal(editorialReviewCommand('ajuste:'),null);
});
