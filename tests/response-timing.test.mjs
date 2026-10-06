import test from 'node:test';
import assert from 'node:assert/strict';
import {responseElapsedMs,formatResponseDuration,finishResponseTiming,recoverResponseTiming} from '../src/features/chat/responseTiming.ts';

test('elapsed time includes approval waits, freezes on completion and handles hours',()=>{
 const startedAt='2026-10-06T02:00:00Z',timing={id:'run',startedAt};
 assert.equal(formatResponseDuration(responseElapsedMs(timing,Date.parse('2026-10-06T02:02:13Z'))),'02:13');
 assert.equal(formatResponseDuration(responseElapsedMs({...timing,endedAt:'2026-10-06T02:02:13Z'},Date.parse('2026-10-06T03:00:00Z'))),'02:13');
 assert.equal(formatResponseDuration(3661000),'1:01:01');assert.equal(responseElapsedMs({id:'bad',startedAt:'invalid'}),0);assert.equal(formatResponseDuration(-200), '00:00');
});
test('each response retains its own duration; late or repeated completion cannot finish a newer request',()=>{
 const session={id:'session',agentId:'agent',title:'Chat',createdAt:'2026-10-06T02:00:00Z',updatedAt:'2026-10-06T02:00:00Z',responseTiming:{id:'second',startedAt:'2026-10-06T02:00:00Z'},messages:[{id:'codex-first',type:'message',role:'agent',content:'old',responseDurationMs:1000},{id:'codex-second',type:'message',role:'agent',content:'new'}]};
 assert.equal(finishResponseTiming(session,'first','completed','2026-10-06T02:01:00Z','first'),session);
 const finished=finishResponseTiming(session,'second','completed','2026-10-06T02:02:00Z','second');assert.equal(finished.messages[0].responseDurationMs,1000);assert.equal(finished.messages[1].responseDurationMs,120000);assert.equal(finished.responseTiming.outcome,'completed');assert.equal(finishResponseTiming(finished,'second','error','2026-10-06T03:00:00Z','second'),finished);
 assert.equal(finishResponseTiming(session,'second','interrupted','2026-10-06T02:00:04Z','second').responseTiming.outcome,'interrupted');
 const recovered=recoverResponseTiming({...session,updatedAt:'2026-10-06T02:00:09Z'});assert.equal(recovered.responseTiming.outcome,'interrupted');assert.equal(responseElapsedMs(recovered.responseTiming,Date.parse('2026-10-07T02:00:00Z')),9000);assert.equal(recoverResponseTiming(recovered),recovered);
});
