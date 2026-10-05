import test from 'node:test';
import {inspectBackupFileLinks} from '../backup-file-links.mjs';
import assert from 'node:assert/strict';
test('backup file preflight reports missing local links and refuses network/device probes',()=>{
  const result=inspectBackupFileLinks(['C:/missing-mainsagents-skill/SKILL.md','\\\\untrusted-host\\share\\skill.md','\\\\?\\C:\\skill.md']);
  assert.equal(result.length,3);assert.ok(result.every(item=>item.available===false));assert.throws(()=>inspectBackupFileLinks([null]),/Invalid backup/);
});
import { composeImport, parseBackup, safeData } from '../src/data/backupFormat.ts';

const file=(data)=>parseBackup(JSON.stringify({format:'mainsagents-backup',version:1,exportedAt:'2026-09-22T00:00:00Z',data}));

test('rejects malformed sessions before any local data is replaced',()=>{
  assert.throws(()=>file({sessions:[{id:'s1',agentId:'a1',title:'Broken'}]}),/Invalid sessions/);
  assert.throws(()=>file({language:'unexpected'}),/Invalid language/);
});

test('backup allowlist excludes credentials and unknown internal keys',()=>{
  assert.deepEqual(safeData({agents:[],language:'pt-BR',secret:'should-not-export','api-key':'private'}),{agents:[],language:'pt-BR'});
});

test('export and restore preserve connected sessions and remote specialist history',()=>{
  const data={sessions:[
    {id:'source',agentId:'a1',title:'Source',messages:[],agentConnection:{enabled:true,targetAgentId:'a2',targetSessionId:'target'}},
    {id:'target',agentId:'a2',title:'Specialist',codexThreadId:'real-thread',messages:[{id:'reply',role:'agent',content:'Saved result'}]},
  ]};
  const restored=composeImport({},file(safeData(data)),'replace');
  assert.deepEqual(restored.sessions,data.sessions);
});

test('merge preserves local conflicts and adds distinct sessions and Canvas nodes',()=>{
  const current={sessions:[{id:'s1',agentId:'a1',title:'Local',messages:[]}],agents:[{id:'a1',name:'Local'}],'canvas-workspaces':{w1:{nodes:[{id:'n1',data:{text:'Local'}}],edges:[]}}};
  const incoming=file({sessions:[{id:'s1',agentId:'a1',title:'Remote',messages:[]},{id:'s2',agentId:'a1',title:'New',messages:[]}],agents:[{id:'a2',name:'New'}],'canvas-workspaces':{w1:{nodes:[{id:'n1',data:{text:'Remote'}},{id:'n2',data:{text:'New'}}],edges:[]}}});
  const merged=composeImport(current,incoming,'merge');
  assert.equal(merged.sessions[0].title,'Local');
  assert.equal(merged.sessions.length,2);
  assert.equal(merged.agents.length,2);
  assert.equal(merged['canvas-workspaces'].w1.nodes[0].data.text,'Local');
  assert.equal(merged['canvas-workspaces'].w1.nodes.length,2);
});

test('replace removes known local data but leaves unknown future keys untouched',()=>{
  const result=composeImport({agents:[{id:'a1'}],unknownFutureKey:{keep:true}},file({agents:[]}), 'replace');
  assert.deepEqual(result.agents,[]);
  assert.deepEqual(result.unknownFutureKey,{keep:true});
});

test('editorial backup is validated before restoring local data',()=>{
  const base={format:'mainsagents-backup',version:1,exportedAt:'2026-09-28T00:00:00Z',data:{}};
  assert.throws(()=>parseBackup(JSON.stringify({...base,editorial:{schemaVersion:1,topics:[{name:'missing ID'}],contents:[],runs:[],artifacts:[],approvals:[]}})),/Invalid editorial data/);
  const valid=parseBackup(JSON.stringify({...base,editorial:{schemaVersion:1,topics:[{id:'topic-1'}],contents:[],runs:[],artifacts:[],approvals:[]}}));
  assert.equal(valid.editorial.topics[0].id,'topic-1');
  assert.equal(file({}).editorial,undefined);
});

test('Inbox state survives backup and malformed receipt collections are refused',()=>{
 const data={'chat-inbox':{initialized:true,muted:true,seen:{session:['message:m']},notified:['message:m']}};
 const backup={format:'mainsagents-backup',version:1,data};assert.deepEqual(parseBackup(JSON.stringify(backup)).data['chat-inbox'],data['chat-inbox']);
 assert.throws(()=>parseBackup(JSON.stringify({...backup,data:{'chat-inbox':{...data['chat-inbox'],seen:{session:'invalid'}}}})),/Inbox|inbox/);
});
