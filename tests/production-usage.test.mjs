import test from 'node:test';
import assert from 'node:assert/strict';
import {initialBudget,reserveCall,markCall,recordUsage,budgetUsage,sanitizeBudget,sanitizeUsage,ProductionBudgetError} from '../production-budget.mjs';

const at='2026-10-08T12:00:00.000Z';
const reported=(extra={})=>({provider:'claude',status:'reported',tokens:{input:100,output:200,cacheRead:300,cacheCreation:40},model:'claude-sonnet-5-5',reportedCostUsd:0.5,durationMs:4000,...extra});
const setup=(limits={maxCalls:6,maxAttemptsPerStep:3})=>({budget:initialBudget(limits,at)});
const settle=(p,key,stage,attempt,status='completed')=>{const call=reserveCall(p,{key,stage,attempt},at);markCall(p,call.id,'sent',at);markCall(p,call.id,status,at);return call;};

test('no usage reported: tokens stay unavailable and nothing is invented',()=>{
 const p=setup();settle(p,'w','writing',1);
 const usage=budgetUsage(p);
 assert.equal(usage.tokens,'unavailable');assert.equal(usage.usageTotals,undefined);assert.equal(usage.used,1);
 assert.equal(usage.usageRows[0].usage,undefined);
});

test('recording usage never changes counts, limits, attempts or statuses',()=>{
 const p=setup({maxCalls:2,maxAttemptsPerStep:2});
 const call=settle(p,'w','writing',1);
 const before=JSON.stringify({calls:p.budget.calls.map(({usage,...rest})=>rest),limits:[p.budget.maxCalls,p.budget.maxAttemptsPerStep]});
 recordUsage(p,call.id,reported(),at);
 assert.equal(JSON.stringify({calls:p.budget.calls.map(({usage,...rest})=>rest),limits:[p.budget.maxCalls,p.budget.maxAttemptsPerStep]}),before);
 settle(p,'w','writing',2);
 assert.throws(()=>reserveCall(p,{key:'x',stage:'editing',attempt:1},at),ProductionBudgetError,'the call limit still applies');
});

test('totals only add what calls really reported; unreported calls make the total partial',()=>{
 const p=setup();
 const a=settle(p,'w','writing',1),b=settle(p,'e','editing',1),c=settle(p,'e','editing',2);
 recordUsage(p,a.id,reported(),at);
 let usage=budgetUsage(p);
 assert.equal(usage.tokens,'partial','two settled calls have no report');assert.deepEqual([usage.usageTotals.input,usage.usageTotals.output,usage.usageTotals.cacheRead,usage.usageTotals.cacheCreation],[100,200,300,40]);
 recordUsage(p,b.id,reported({tokens:{input:1,output:2}}),at);
 usage=budgetUsage(p);
 assert.equal(usage.usageTotals.input,101);assert.equal(usage.usageTotals.cacheRead,300,'a call that did not report cache tokens adds nothing, not 0 per call');
 assert.equal(usage.usageTotals.callsUnavailable,1,'the third call has no report');assert.equal(usage.tokens,'partial');
 recordUsage(p,c.id,{provider:'claude',status:'unavailable',reason:'cancelled'},at);
 usage=budgetUsage(p);assert.equal(usage.usageTotals.callsUnavailable,1);assert.equal(usage.usageTotals.callsReported,2);
 assert.equal(usage.usageTotals.reportedCostUsd,1,'CLI-reported estimates are summed as reported; no price table is applied');
});

test('an in-flight call is not counted as unavailable yet',()=>{
 const p=setup();const a=settle(p,'w','writing',1);recordUsage(p,a.id,reported(),at);
 const live=reserveCall(p,{key:'e',stage:'editing',attempt:1},at);p.step={budgetKey:'e',callId:live.id};
 assert.equal(budgetUsage(p).tokens,'reported');
});

test('a call keeps its first report: a replayed or duplicated event cannot double-count',()=>{
 const p=setup();const a=settle(p,'w','writing',1);
 recordUsage(p,a.id,reported(),at);recordUsage(p,a.id,reported({tokens:{input:9999}}),'2026-10-08T13:00:00.000Z');recordUsage(p,'missing',reported(),at);
 assert.equal(budgetUsage(p).usageTotals.input,100);assert.equal(p.budget.calls[0].usage.recordedAt,at);
});

test('works for failed and uncertain calls, partial status is surfaced',()=>{
 const p=setup();const a=settle(p,'w','writing',1,'failed'),b=settle(p,'w','writing',2,'uncertain');
 recordUsage(p,a.id,reported({status:'partial',reason:'error-result'}),at);recordUsage(p,b.id,reported(),at);
 const usage=budgetUsage(p);assert.equal(usage.tokens,'partial');assert.equal(usage.usageTotals.callsPartial,1);assert.equal(usage.failed,1);assert.equal(usage.uncertain,1);
});

test('sanitizer: allowlist only, bounded, unknown or hostile input is dropped',()=>{
 assert.equal(sanitizeUsage(null),undefined);assert.equal(sanitizeUsage({status:'weird'}),undefined);
 const clean=sanitizeUsage({...reported(),prompt:'secret text',apiKey:'sk-ant-x',tokens:{input:5,output:-1,cacheRead:Infinity,extra:9},models:Array.from({length:9},(_,i)=>({model:`m${i}`,input:i,output:'x'})),reportedCostUsd:-3});
 assert.deepEqual(clean.tokens,{input:5});assert.equal(clean.models.length,4);assert.equal(clean.reportedCostUsd,undefined);
 const text=JSON.stringify(clean);assert.equal(text.includes('secret'),false);assert.equal(text.includes('sk-ant'),false);
 assert.equal(sanitizeUsage({status:'reported',tokens:{input:-1}}).status,'unavailable','nothing valid survives: unavailable, not 0');
 assert.equal(sanitizeUsage({status:'unavailable',reason:'cancelled',tokens:{input:5}}).tokens,undefined,'unavailable carries no numbers');
});

test('backup restore keeps well-formed usage and drops malformed usage without losing the ledger',()=>{
 const p=setup();const a=settle(p,'w','writing',1),b=settle(p,'e','editing',1);
 recordUsage(p,a.id,reported(),at);
 const restored=sanitizeBudget(JSON.parse(JSON.stringify(p.budget)));
 assert.deepEqual(restored.calls[0].usage.tokens,{input:100,output:200,cacheRead:300,cacheCreation:40});assert.equal(restored.calls[1].usage,undefined);
 const tampered=JSON.parse(JSON.stringify(p.budget));tampered.calls[0].usage={status:'reported',tokens:{input:'many'},recordedAt:at};tampered.calls[1].usage={status:'reported',tokens:{input:1}};
 const safe=sanitizeBudget(tampered);assert.equal(safe.calls.length,2);assert.equal(safe.calls[0].usage?.status,'unavailable');assert.equal(safe.calls[1].usage,undefined,'no recordedAt: not accepted');
});

test('history stays bounded: usage rows are the last ten calls',()=>{
 const p=setup({maxCalls:40,maxAttemptsPerStep:5});
 for(let i=0;i<14;i++){const call=settle(p,`k${i}`,'writing',1);recordUsage(p,call.id,reported(),at);}
 assert.equal(budgetUsage(p).usageRows.length,10);
});
