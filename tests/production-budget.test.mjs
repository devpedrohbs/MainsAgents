import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_PRODUCTION_BUDGET,initialBudget,ensureBudget,reserveCall,markCall,budgetUsage,budgetStopApplies,sanitizeBudget,validateBudgetLimits,ProductionBudgetError} from '../production-budget.mjs';

const at='2026-10-06T12:00:00.000Z';

test('defaults are conservative and limits stay in a finite validated range',()=>{
 assert.deepEqual({...DEFAULT_PRODUCTION_BUDGET},{maxCalls:8,maxAttemptsPerStep:2});
 assert.deepEqual(initialBudget(undefined,at),{version:1,maxCalls:8,maxAttemptsPerStep:2,legacy:false,measuredSince:at,calls:[]});
 for(const bad of [null,{},{maxCalls:0,maxAttemptsPerStep:1},{maxCalls:41,maxAttemptsPerStep:1},{maxCalls:5,maxAttemptsPerStep:0},{maxCalls:5,maxAttemptsPerStep:6},{maxCalls:Infinity,maxAttemptsPerStep:1},{maxCalls:5.5,maxAttemptsPerStep:1}])assert.throws(()=>validateBudgetLimits(bad),/Escolha de/);
});

test('every reservation counts, failed and uncertain sends are never refunded',()=>{
 const p={budget:initialBudget({maxCalls:3,maxAttemptsPerStep:3},at)};
 const a=reserveCall(p,{key:'s1',stage:'writing',attempt:1},at);markCall(p,a.id,'sent',at);markCall(p,a.id,'failed',at);
 const b=reserveCall(p,{key:'s1',stage:'writing',attempt:2},at);markCall(p,b.id,'uncertain',at);
 const c=reserveCall(p,{key:'s1',stage:'writing',attempt:3},at);p.step={budgetKey:'s1',callId:c.id};
 let usage=budgetUsage(p);assert.deepEqual([usage.used,usage.remaining,usage.failed,usage.uncertain,usage.inFlight,usage.stepAttempts,usage.tokens],[3,0,1,1,1,3,'unavailable']);
 markCall(p,a.id,'completed',at);assert.equal(p.budget.calls[0].status,'failed','a failed call cannot be rewritten as completed');
 markCall(p,b.id,'completed',at);assert.equal(p.budget.calls[1].status,'completed','a recovered turn completes the same reservation');
 assert.throws(()=>reserveCall(p,{key:'s2',stage:'notion',attempt:1},at),error=>error instanceof ProductionBudgetError&&error.budgetStop.kind==='calls');
 delete p.step;usage=budgetUsage(p);assert.equal(usage.uncertain,1,'an open reservation without an active step is shown as uncertain');
});

test('per-step attempts stop independently of the total cap and a raised limit clears the stop',()=>{
 const p={budget:initialBudget({maxCalls:10,maxAttemptsPerStep:1},at)};reserveCall(p,{key:'cover-0',stage:'generating-cover',attempt:1},at);
 reserveCall(p,{key:'cover-1',stage:'generating-cover',attempt:1},at);
 try{reserveCall(p,{key:'cover-1',stage:'generating-cover',attempt:2},at);assert.fail('expected attempt limit');}catch(error){p.budgetStop=error.budgetStop;}
 assert.equal(p.budgetStop.kind,'attempts');assert.equal(budgetStopApplies(p),true);assert.equal(budgetUsage(p).stop.kind,'attempts');
 p.budget.maxAttemptsPerStep=2;assert.equal(budgetStopApplies(p),false);assert.equal(budgetUsage(p).stop,undefined);
});

test('legacy productions show unmeasured usage instead of invented totals',()=>{
 const usage=budgetUsage({});assert.deepEqual([usage.measured,usage.legacy,usage.used,usage.maxCalls],[false,true,0,8]);
 const p={};ensureBudget(p,at);assert.deepEqual([p.budget.legacy,p.budget.measuredSince,p.budget.calls.length],[true,at,0]);
 assert.equal(budgetUsage(p).measured,true);
});

test('backup restore keeps only a well-formed ledger',()=>{
 const p={budget:initialBudget(undefined,at)};reserveCall(p,{key:'k',stage:'writing',attempt:1},at);
 assert.deepEqual(sanitizeBudget(JSON.parse(JSON.stringify(p.budget))),p.budget);
 for(const bad of [{...p.budget,maxCalls:999},{...p.budget,calls:[{id:'x',key:'k',stage:'writing',status:'refunded',at}]},{...p.budget,version:2},'budget'])assert.equal(sanitizeBudget(bad),undefined);
});
