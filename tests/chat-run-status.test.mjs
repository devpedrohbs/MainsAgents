import test from 'node:test';
import assert from 'node:assert/strict';
import {chatFeed,finishResponseTiming,recoverResponseTiming,startRunItem,runItemId,responseElapsedMs,formatResponseDuration} from '../src/features/chat/responseTiming.ts';

const base={id:'s',agentId:'a',title:'Chat',createdAt:'2026-10-08T10:00:00Z',updatedAt:'2026-10-08T10:00:00Z'};
const user=(id)=>({id,type:'message',role:'user',content:'pedido',createdAt:'2026-10-08T10:00:00Z'});
const step=(exec,call,status='done')=>({id:`codex-activity-${exec}-${call}`,type:'activity',label:`Used ${call}`,status});

test('dozens of tool events collapse into one status line per execution; replies and real errors stay visible',()=>{
  const steps=Array.from({length:30},(_,i)=>step('e1',`c${i}`));
  const messages=[user('u1'),startRunItem('t1','2026-10-08T10:00:00Z'),...steps.slice(0,10),{id:'codex-e1',type:'message',role:'agent',content:'resposta',createdAt:'2026-10-08T10:01:00Z'},...steps.slice(10),
    user('u2'),startRunItem('t2','2026-10-08T10:02:00Z'),step('e2','x','error'),{id:'activity-fail',type:'activity',label:'Login required',status:'error'}];
  const feed=chatFeed(messages);
  assert.deepEqual(feed.map(e=>e.kind==='run'?`run:${e.run.id}:${e.steps.length}`:e.item.id),['u1','run:run-t1:30','codex-e1','u2','run:run-t2:1','activity-fail']);
  assert(!feed.some(e=>e.kind==='item'&&e.item.id.startsWith('codex-activity-')),'tool rows never reach the main feed');
});

test('legacy sessions without run lines hide old tool rows instead of listing them',()=>{
  const feed=chatFeed([user('u'),step('old','a'),step('old','b'),{id:'codex-old',type:'message',role:'agent',content:'ok',createdAt:'x'}]);
  assert.deepEqual(feed.map(e=>e.kind==='item'?e.item.id:'run'),['u','codex-old']);
});

const running=(extra=[])=>({...base,responseTiming:{id:'t1',startedAt:'2026-10-08T10:00:00Z'},messages:[user('u'),startRunItem('t1','2026-10-08T10:00:00Z'),...extra]});

test('completion freezes the line with the true outcome and duration; repeated or stale finishes are ignored',()=>{
  const done=finishResponseTiming(running([{id:'codex-e1',type:'message',role:'agent',content:'r',createdAt:'x'}]),'t1','completed','2026-10-08T10:01:37Z','e1');
  const run=done.messages.find(m=>m.id===runItemId('t1'));
  assert.equal(run.outcome,'completed');assert.equal(run.status,'done');
  assert.equal(formatResponseDuration(responseElapsedMs(run,Date.parse('2026-10-09T00:00:00Z'))),'01:37','frozen, not app uptime');
  assert.equal(finishResponseTiming(done,'t1','error','2026-10-08T11:00:00Z','e1'),done);
  const live=running();assert.equal(finishResponseTiming(live,'other','completed','2026-10-08T10:00:05Z'),live,'a late event from another run cannot stop this one');
});

test('failure and cancellation are never labelled as success',()=>{
  const failed=finishResponseTiming(running(),'t1','error','2026-10-08T10:00:05Z').messages.find(m=>m.id==='run-t1');
  assert.equal(failed.outcome,'error');assert.equal(failed.status,'error');
  const cancelled=finishResponseTiming(running(),'t1','interrupted','2026-10-08T10:00:20Z').messages.find(m=>m.id==='run-t1');
  assert.equal(cancelled.outcome,'interrupted');assert.equal(formatResponseDuration(responseElapsedMs(cancelled)),'00:20');
});

test('reopening the app stops a line left running and keeps its elapsed time',()=>{
  const recovered=recoverResponseTiming({...running(),updatedAt:'2026-10-08T10:00:42Z'});
  const run=recovered.messages.find(m=>m.id==='run-t1');
  assert.equal(run.outcome,'interrupted');assert.equal(run.endedAt,'2026-10-08T10:00:42Z');
  // Orphan run line without session timing (older crash) is closed too.
  const orphan=recoverResponseTiming({...base,updatedAt:'2026-10-08T10:00:03Z',messages:[startRunItem('t0','2026-10-08T10:00:00Z')]});
  assert.equal(orphan.messages[0].outcome,'interrupted');assert.equal(recoverResponseTiming(recovered),recovered);
});

test('runs are isolated per execution: finishing one never touches another conversation or run',()=>{
  const other={...base,id:'s2',responseTiming:{id:'t9',startedAt:'2026-10-08T10:00:00Z'},messages:[startRunItem('t9','2026-10-08T10:00:00Z')]};
  const a=finishResponseTiming(running(),'t1','completed','2026-10-08T10:00:10Z');
  assert.equal(a.messages.filter(m=>m.type==='activity'&&m.kind==='run'&&m.endedAt).length,1);
  assert.equal(finishResponseTiming(other,'t1','completed','2026-10-08T10:00:10Z'),other);
});
