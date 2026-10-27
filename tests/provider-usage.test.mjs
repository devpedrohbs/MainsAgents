import test from 'node:test';
import assert from 'node:assert/strict';
import {createClaudeLimitSnapshot,createCodexTurnUsage} from '../provider-usage.mjs';
import {inPeriod,usageByDay,usageEntry,usageGroups,usageTotals,withUsageEntry} from '../src/features/usage/usageLedger.ts';

test('Claude limits come only from rate_limit_event, as 0-1 utilization, and keep windows not re-reported', () => {
 const snap=createClaudeLimitSnapshot(()=>'2026-10-26T15:00:00.000Z');
 assert.deepEqual(snap.read(),{fiveHours:null,weekly:null,plan:null,observedAt:null,fetchedAt:'2026-10-26T15:00:00.000Z'});
 snap.observe({type:'assistant',message:{content:[{type:'text',text:'you used 90% of your limit'}]}});
 assert.equal(snap.read().observedAt,null,'prose never sets a limit');
 snap.observe({type:'rate_limit_event',rate_limit_info:{status:'allowed',unifiedWindows:{five_hour:{utilization:0.18,resetsAt:1793050000},seven_day:{utilization:0.34,resetsAt:1793400000}}}});
 assert.deepEqual(snap.read().fiveHours,{usedPercent:18,resetsAt:1793050000});
 assert.deepEqual(snap.read().weekly,{usedPercent:34,resetsAt:1793400000});
 snap.observe({type:'rate_limit_event',rate_limit_info:{status:'allowed_warning',rateLimitType:'five_hour',utilization:0.91}});
 assert.deepEqual(snap.read().fiveHours,{usedPercent:91,resetsAt:null});
 assert.equal(snap.read().weekly.usedPercent,34);
 snap.observe({type:'rate_limit_event',rate_limit_info:{status:'allowed'}});
 assert.equal(snap.read().fiveHours.usedPercent,91,'an event without utilization changes nothing');
 snap.observe({type:'rate_limit_event',rate_limit_info:{status:'allowed',rateLimitType:'seven_day',utilization:3}});
 assert.equal(snap.read().weekly.usedPercent,100,'clamped');
});

test('Codex token usage is summed per turn from tokenUsage.last and reported once', () => {
 const usage=createCodexTurnUsage();
 usage.observe({threadId:'t',turnId:'turn-1',tokenUsage:{last:{inputTokens:1000,cachedInputTokens:600,outputTokens:50}}});
 usage.observe({threadId:'t',turnId:'turn-1',tokenUsage:{last:{inputTokens:1500,cachedInputTokens:1400,outputTokens:20}}});
 usage.observe({threadId:'t',turnId:'turn-2',tokenUsage:{last:{inputTokens:10,outputTokens:1}}});
 assert.deepEqual(usage.finish('turn-1'),{version:1,status:'reported',provider:'codex',tokens:{input:500,output:70,cacheRead:2000}});
 assert.equal(usage.finish('turn-1'),undefined,'only one report per turn');
 assert.equal(usage.finish('turn-3'),undefined,'no usage sent, nothing invented');
});

test('usage ledger keeps one entry per execution, drops old entries and aggregates by day and group', () => {
 const base={provider:'claude',agentId:'a',workspaceId:'w',sessionId:'s'};
 assert.equal(usageEntry({...base,executionId:'x',usage:{status:'unavailable'}}),undefined);
 assert.equal(usageEntry({...base,executionId:'x',usage:{status:'reported',tokens:{input:-1}}}),undefined);
 const now=new Date(2026,9,26,12);
 const one=usageEntry({...base,executionId:'e1',contentId:'c1',at:new Date(2026,9,26,9).toISOString(),usage:{status:'reported',model:'claude-opus-5-5',tokens:{input:100,output:20,cacheRead:1000},reportedCostUsd:0.12}});
 const two=usageEntry({...base,agentId:'b',executionId:'e2',at:new Date(2026,9,24,9).toISOString(),usage:{status:'partial',tokens:{output:5}}});
 const old=usageEntry({...base,executionId:'e0',at:new Date(2026,2,1).toISOString(),usage:{status:'reported',tokens:{input:1}}});
 let ledger=withUsageEntry([],old,now.getTime());
 ledger=withUsageEntry(ledger,one,now.getTime());
 ledger=withUsageEntry(ledger,one,now.getTime());
 ledger=withUsageEntry(ledger,two,now.getTime());
 assert.deepEqual(ledger.map(entry=>entry.id),['e1','e2'],'duplicate ignored, entries older than the window dropped');
 const totals=usageTotals(ledger);
 assert.equal(totals.turns,2);assert.equal(totals.total,1125);assert.equal(totals.cost,0.12);
 assert.equal(usageTotals([two]).cost,undefined,'no reported cost stays unknown, not zero');
 const days=usageByDay(ledger,7,now);
 assert.equal(days.length,7);assert.equal(days[6].turns,1);assert.equal(days[4].turns,1);assert.equal(days[5].turns,0);
 assert.equal(inPeriod(ledger,1,now).length,1);
 assert.deepEqual(usageGroups(ledger,entry=>entry.contentId??'').map(group=>[group.key,group.turns]),[['c1',1],['',1]]);
});
