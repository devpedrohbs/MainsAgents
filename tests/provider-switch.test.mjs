import test from 'node:test';
import assert from 'node:assert/strict';
import {providerSwitchPlan,bindingLock,productionSessionIds,editingLabel} from '../src/features/chat/providerChoice.ts';

const at='2026-10-14T00:00:00.000Z';
const empty={id:'s1',agentId:'a',providerId:'codex',title:'Nova sessão',messages:[],createdAt:at,updatedAt:at};

test('an empty chat that never talked to a provider switches in place', () => {
  assert.deepEqual(providerSwitchPlan(empty,{busy:false}),{kind:'in-place'});
  assert.deepEqual(providerSwitchPlan(undefined,{busy:false}),{kind:'in-place'});
});

test('history, threads, pairs, handoffs and productions keep their binding (new chat instead)', () => {
  const cases=[
    [{...empty,messages:[{id:'m',type:'message',role:'user',content:'oi',createdAt:at}]},'history'],
    [{...empty,remoteSessionId:'r'},'thread'],
    [{...empty,codexThreadId:'t'},'thread'],
    [{...empty,previousCodexThreadId:'old'},'thread'],
    [{...empty,threadRecoveries:[{previousRemoteSessionId:'a',remoteSessionId:'b',at}]},'thread'],
    [{...empty,comparison:{id:'c',mode:'same-agent'}},'comparison'],
    [{...empty,originHandoffId:'h'},'handoff'],
    [{...empty,pendingManualHandoff:{id:'h',fingerprint:'f'}},'handoff'],
    [{...empty,productionContext:{id:'p',stage:'recording'}},'production'],
  ];
  for(const [session,reason] of cases){
    assert.equal(bindingLock(session),reason);
    assert.deepEqual(providerSwitchPlan(session,{busy:false}),{kind:'new-chat',reason});
  }
});

test('a chat bound to a production run (source, editor or publisher) is never rebound in place', () => {
  const ids=productionSessionIds([{sourceSession:{id:'src'},editorSession:{id:'ed'},publisherSession:{id:'pub'}},{sourceSession:{id:'src2'},editorSession:{id:'ed2'}}]);
  assert.deepEqual([...ids].sort(),['ed','ed2','pub','src','src2']);
  for(const id of ids)assert.deepEqual(providerSwitchPlan({...empty,id},{busy:false,productionSessionIds:ids}),{kind:'new-chat',reason:'production'});
  assert.deepEqual(providerSwitchPlan({...empty,id:'other'},{busy:false,productionSessionIds:ids}),{kind:'in-place'});
});

test('busy chats (own reply or queued/running specialist work) are never touched', () => {
  assert.deepEqual(providerSwitchPlan(empty,{busy:true}),{kind:'blocked',reason:'busy'});
  assert.deepEqual(providerSwitchPlan({...empty,remoteSessionId:'r'},{busy:true}),{kind:'blocked',reason:'busy'});
});

test('editing label comes from the run, never from the chat provider', () => {
  assert.equal(editingLabel(undefined),undefined);
  assert.deepEqual(editingLabel({editDirector:{name:'Editor',provider:'claude',model:'opus',choice:'claude'}}),{provider:'claude',model:'opus',source:'run',agent:false});
  assert.deepEqual(editingLabel({editDirector:{name:'Editor',provider:'codex',choice:'agent'}}),{provider:'codex',model:undefined,source:'run',agent:true});
  // Before the video is sent: the workspace default, labelled as such.
  assert.deepEqual(editingLabel({},{providerId:'claude'}),{provider:'claude',model:undefined,source:'workspace',agent:false});
  assert.equal(editingLabel({}),undefined);
  assert.deepEqual(editingLabel({editPreferences:{mode:'basic'},editDirector:{name:'E',provider:'claude',choice:'claude'}}),{provider:'ffmpeg',source:'basic'});
});
