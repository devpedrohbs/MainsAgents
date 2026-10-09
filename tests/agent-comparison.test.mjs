import test from 'node:test';
import assert from 'node:assert/strict';
import {validateComparison,comparisonSessions,deriveComparisons,createComparisonLauncher} from '../src/features/chat/agentComparison.ts';
import {composeImport,parseBackup,safeData} from '../src/data/backupFormat.ts';

const now='2026-10-06T12:00:00.000Z';
const agents=[
 {id:'cx',name:'Codex writer',role:'Writer',workspaceId:'w1',instructions:'Codex own rules',skills:['hooks'],modelId:'gpt-codex-x'},
 {id:'cl',name:'Claude writer',role:'Writer',workspaceId:'w1',providerId:'claude',instructions:'Claude own rules',skills:['tone'],modelId:'sonnet'},
 {id:'cl2',name:'Other Claude',role:'Writer',workspaceId:'w2',providerId:'claude'},
 {id:'gm',name:'Gemini',role:'Writer',workspaceId:'w1',providerId:'gemini'},
 {id:'cx2',name:'Codex default model',role:'Writer',workspaceId:'w1',providerId:'codex'},
];
const providers=['codex','claude','gemini'];
const context=[{nodeId:'n1',label:'Note',kind:'note',content:'Shared context'}];

test('validation requires one Codex and one Claude agent in the same workspace with registered providers',()=>{
 const ok=validateComparison({codexAgentId:'cx',claudeAgentId:'cl',briefing:'  Write a hook  ',context},agents,providers);
 assert.equal(ok.briefing,'Write a hook');assert.equal(ok.codex.instructions,'Codex own rules');assert.equal(ok.claude.instructions,'Claude own rules');
 const bad=[[{codexAgentId:'cx',claudeAgentId:'cx',briefing:'x'},/different/],[{codexAgentId:'cx',claudeAgentId:'cl2',briefing:'x'},/same workspace/],[{codexAgentId:'cl',claudeAgentId:'cx',briefing:'x'},/one Codex agent and one Claude/],[{codexAgentId:'cx',claudeAgentId:'gm',briefing:'x'},/one Codex agent and one Claude/],[{codexAgentId:'cx',claudeAgentId:'missing',briefing:'x'},/existing agents/],[{codexAgentId:'cx',claudeAgentId:'cl',briefing:'   '},/briefing/],[{codexAgentId:'cx',claudeAgentId:'cl',briefing:'x'.repeat(20001)},/at most/],[{codexAgentId:'cx',claudeAgentId:'cl',briefing:'x',context:[{nodeId:1}]},/context/]];
 for(const [input,error] of bad)assert.throws(()=>validateComparison(input,agents,providers),error);
 assert.throws(()=>validateComparison({codexAgentId:'cx',claudeAgentId:'cl',briefing:'x'},agents,['codex']),/Claude provider is not available/);
});

test('fresh sessions keep each agent model and carry pairing metadata without any automatic connection',()=>{
 const {comparison,sessions:[codex,claude]}=comparisonSessions(validateComparison({codexAgentId:'cx2',claudeAgentId:'cl',briefing:'Compare this'},agents,providers),{id:'cmp',codexSessionId:'s1',claudeSessionId:'s2',now,defaultCodexModelId:'default-codex'});
 assert.deepEqual([codex.providerId,codex.modelId,claude.providerId,claude.modelId],['codex','default-codex','claude','sonnet']);
 assert.equal(codex.agentConnection,undefined);assert.equal(claude.agentConnection,undefined);
 assert.deepEqual(codex.comparison,{...comparison,role:'codex'});assert.deepEqual(claude.comparison,{...comparison,role:'claude'});
 assert.deepEqual(comparison,{id:'cmp',workspaceId:'w1',title:'Compare this',briefing:'Compare this',codexAgentId:'cx2',claudeAgentId:'cl',codexSessionId:'s1',claudeSessionId:'s2',createdAt:now});
});

function harness({failCodex=false,persistFails=false}={}){
 const log=[],saved=[],calls=[],pending=[];let n=0;
 const start=createComparisonLauncher({agents:()=>agents,registeredProviders:()=>providers,now:()=>now,makeId:prefix=>`${prefix}-${++n}`,defaultCodexModelId:()=>undefined,
  persist:async pair=>{log.push('persist');if(persistFails)throw new Error('disk full');saved.push(...pair.map(s=>structuredClone(s)));log.push('saved');},
  execute:(agent,content,ctx,session)=>{log.push(`execute:${session.providerId}`);calls.push({agent,content,ctx,session});if(failCodex&&session.providerId==='codex')throw new Error('Codex offline');let resolve;const promise=new Promise(r=>resolve=r);pending.push(resolve);return promise;}});
 return {start,log,saved,calls,finish:()=>pending.forEach(resolve=>resolve())};
}

test('both sessions are saved before identical, independent dispatches and the launch resolves without waiting for replies',async()=>{
 const h=harness(),comparison=await h.start({codexAgentId:'cx',claudeAgentId:'cl',briefing:'Same brief',context});
 assert.deepEqual(h.log,['persist','saved','execute:codex','execute:claude']);
 assert.equal(h.saved.length,2);assert.ok(h.saved.every(session=>session.messages.length===0&&session.comparison.id===comparison.id));
 const [codex,claude]=h.calls;assert.equal(codex.content,claude.content);assert.deepEqual(codex.ctx,claude.ctx);assert.notEqual(codex.ctx,claude.ctx,'each execution gets its own copy');
 assert.deepEqual([codex.agent.id,claude.agent.id,codex.session.id,claude.session.id],['cx','cl',comparison.codexSessionId,comparison.claudeSessionId]);
 assert.notEqual(codex.session.remoteSessionId??'a',claude.session.remoteSessionId??'b');
 h.finish();
});

test('double click reuses the same launch, and a sibling failure never cancels the other execution',async()=>{
 const h=harness({failCodex:true}),input={codexAgentId:'cx',claudeAgentId:'cl',briefing:'Twice',context};
 const [a,b]=await Promise.all([h.start(input),h.start(input)]);assert.equal(a,b);
 assert.deepEqual(h.log,['persist','saved','execute:codex','execute:claude'],'one persistence and one dispatch per provider');
 h.finish();await new Promise(resolve=>setTimeout(resolve,0));
 const again=await h.start(input);assert.notEqual(again.id,a.id,'a new explicit request after both settle is a new comparison');
 h.finish();
});

test('a persistence failure dispatches nothing',async()=>{
 const h=harness({persistFails:true});await assert.rejects(()=>h.start({codexAgentId:'cx',claudeAgentId:'cl',briefing:'x'}),/disk full/);assert.equal(h.calls.length,0);
 await assert.rejects(()=>harness().start({codexAgentId:'cx',claudeAgentId:'cx',briefing:'x'}),/different/);
});

test('backup round trip reopens the pair without replay; broken, deleted or moved pairs are hidden',()=>{
 const {sessions}=comparisonSessions(validateComparison({codexAgentId:'cx',claudeAgentId:'cl',briefing:'Persist me'},agents,providers),{id:'cmp',codexSessionId:'s1',claudeSessionId:'s2',now});
 const other={id:'plain',agentId:'cx',providerId:'codex',title:'Plain',messages:[],createdAt:now,updatedAt:now};
 const backup=parseBackup(JSON.stringify({format:'mainsagents-backup',version:1,exportedAt:now,data:safeData({sessions:[...sessions,other]})}));
 const restored=composeImport({},backup,'replace').sessions;
 assert.deepEqual(deriveComparisons(restored,agents).map(item=>item.id),['cmp']);
 assert.ok(restored.every(session=>session.messages.length===0),'restore does not add or resend messages');
 assert.deepEqual(deriveComparisons([restored[0]],agents),[],'deleted sibling');
 assert.deepEqual(deriveComparisons(restored,agents.map(agent=>agent.id==='cl'?{...agent,workspaceId:'w2'}:agent)),[],'agent moved to another workspace');
 assert.deepEqual(deriveComparisons(restored,agents.filter(agent=>agent.id!=='cx')),[],'deleted agent');
 const tampered=structuredClone(restored);tampered[1].comparison.workspaceId='w2';assert.deepEqual(deriveComparisons(tampered,agents),[]);
 const swapped=structuredClone(restored);swapped[1].providerId='codex';assert.deepEqual(deriveComparisons(swapped,agents),[]);
});

// Same-agent mode: one agent's own instructions/skills on both providers, model per side.
function sameHarness({failClaude=false}={}){
 const source=agents.map(a=>structuredClone(a)),before=structuredClone(source),log=[],saved=[],calls=[],pending=[];let n=0;
 const start=createComparisonLauncher({agents:()=>source,registeredProviders:()=>providers,now:()=>now,makeId:prefix=>`${prefix}-${++n}`,defaultCodexModelId:()=>'default-codex',
  persist:async pair=>{log.push('persist');saved.push(...pair.map(s=>structuredClone(s)));log.push('saved');},
  execute:(agent,content,ctx,session)=>{log.push(`execute:${session.providerId}`);calls.push({agent,content,ctx,session});agent.instructions='mutated by runtime';if(failClaude&&session.providerId==='claude')return Promise.reject(new Error('Claude login required'));let resolve;const promise=new Promise(r=>resolve=r);pending.push(resolve);return promise;}});
 return {start,log,saved,calls,source,before,finish:()=>pending.forEach(resolve=>resolve())};
}

test('same-agent validation: explicit mode, existing Codex/Claude agent, models per side and no ambiguous payloads',()=>{
 const ok=validateComparison({mode:'same-agent',agentId:'cx',claudeModelId:'opus',briefing:' Brief ',context},agents,providers);
 assert.deepEqual([ok.mode,ok.agent.id,ok.codexModelId,ok.claudeModelId,ok.briefing],['same-agent','cx','gpt-codex-x','opus','Brief'],'own provider keeps the agent model; the other side never inherits it');
 assert.equal(validateComparison({mode:'same-agent',agentId:'cl',briefing:'x'},agents,providers).codexModelId,undefined,'a Claude model is never sent to Codex');
 const bad=[
  [{mode:'same-agent',agentId:'cx',claudeAgentId:'cl',briefing:'x'},/ambiguous/],[{agentId:'cx',briefing:'x'},/ambiguous/],[{codexAgentId:'cx',claudeAgentId:'cl',claudeModelId:'opus',briefing:'x'},/ambiguous/],
  [{mode:'agents',agentId:'cx',codexAgentId:'cx',claudeAgentId:'cl',briefing:'x'},/ambiguous/],[{mode:'both',agentId:'cx',briefing:'x'},/mode/],
  [{mode:'same-agent',agentId:'missing',briefing:'x'},/existing agent/],[{mode:'same-agent',agentId:'gm',briefing:'x'},/Codex or Claude agent/],
  [{mode:'same-agent',agentId:'cx',claudeModelId:'bad model!',briefing:'x'},/valid Claude model/],[{mode:'same-agent',agentId:'cx',codexModelId:42,briefing:'x'},/valid Codex model/],
  [{mode:'same-agent',agentId:'cx',briefing:'  '},/briefing/],
 ];
 for(const [input,error] of bad)assert.throws(()=>validateComparison(input,agents,providers),error,JSON.stringify(input));
 assert.throws(()=>validateComparison({mode:'same-agent',agentId:'cx',briefing:'x'},agents,['codex']),/Claude provider is not available/);
 assert.throws(()=>validateComparison({mode:'same-agent',agentId:'cx',claudeModelId:'gpt-codex-x',briefing:'x'},agents,providers,{claude:['sonnet','opus']}),/not available for Claude/,'catalog rejects a model from the wrong provider');
});

test('same-agent launch persists first, sends exactly two calls with identical briefing/context/instructions/skills and distinct provider, model and session',async()=>{
 const h=sameHarness(),comparison=await h.start({mode:'same-agent',agentId:'cx',claudeModelId:'opus',briefing:'Same agent brief',context});
 assert.deepEqual(h.log,['persist','saved','execute:codex','execute:claude']);assert.equal(h.calls.length,2);
 const [codex,claude]=h.calls;
 assert.deepEqual([codex.session.providerId,codex.session.modelId,claude.session.providerId,claude.session.modelId],['codex','gpt-codex-x','claude','opus']);
 assert.notEqual(codex.session.id,claude.session.id);assert.equal(codex.session.agentId,'cx');assert.equal(claude.session.agentId,'cx');
 assert.equal(codex.content,claude.content);assert.deepEqual(codex.ctx,claude.ctx);assert.notEqual(codex.ctx,claude.ctx);
 assert.notEqual(codex.agent,claude.agent,'each side gets a detached snapshot');
 assert.deepEqual(h.source,h.before,'saved agents are never mutated, even if a runtime mutates its snapshot');
 for(const call of h.calls){assert.equal(call.agent.id,'cx');assert.deepEqual(call.agent.skills,['hooks']);}
 assert.deepEqual(comparison,{id:comparison.id,workspaceId:'w1',title:'Same agent brief',briefing:'Same agent brief',codexAgentId:'cx',claudeAgentId:'cx',codexSessionId:codex.session.id,claudeSessionId:claude.session.id,createdAt:now,mode:'same-agent',codexModelId:'gpt-codex-x',claudeModelId:'opus'});
 assert.ok(h.saved.every(s=>s.messages.length===0&&s.agentConnection===undefined&&s.comparison.mode==='same-agent'));
 h.finish();
});

test('same-agent fingerprint includes mode and models; a failure on one side leaves the other running',async()=>{
 const h=sameHarness({failClaude:true}),input={mode:'same-agent',agentId:'cx',claudeModelId:'opus',briefing:'Twice'};
 const [a,b]=await Promise.all([h.start(input),h.start(input)]);assert.equal(a,b);assert.equal(h.calls.length,2,'double click: still at most two calls');
 const other=await h.start({...input,claudeModelId:'sonnet'});assert.notEqual(other.id,a.id,'another model is another comparison');
 const legacy=await h.start({codexAgentId:'cx',claudeAgentId:'cl',briefing:'Twice'});assert.notEqual(legacy.id,a.id,'same briefing in two-agent mode is distinct');
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(h.calls.length,6);assert.equal(h.calls.filter(c=>c.session.providerId==='codex').length,3,'Codex sides still run after Claude failures');
 h.finish();
});

test('same-agent pairs derive, survive backup without replay and hide when tampered; legacy pairs are unaffected',()=>{
 const {sessions}=comparisonSessions(validateComparison({mode:'same-agent',agentId:'cl',codexModelId:'gpt-x',briefing:'Persist same'},agents,providers),{id:'same',codexSessionId:'s1',claudeSessionId:'s2',now:'2026-10-07T00:00:00.000Z'});
 const legacy=comparisonSessions(validateComparison({codexAgentId:'cx',claudeAgentId:'cl',briefing:'Old pair'},agents,providers),{id:'old',codexSessionId:'s3',claudeSessionId:'s4',now}).sessions;
 const backup=parseBackup(JSON.stringify({format:'mainsagents-backup',version:1,exportedAt:now,data:safeData({sessions:[...sessions,...legacy]})}));
 const restored=composeImport({},backup,'replace').sessions;
 const derived=deriveComparisons(restored,agents);assert.deepEqual(derived.map(item=>[item.id,item.mode,item.codexModelId,item.claudeModelId]),[['same','same-agent','gpt-x','sonnet'],['old',undefined,undefined,undefined]]);
 assert.deepEqual(Object.keys(derived[1]).sort(),['briefing','claudeAgentId','claudeSessionId','codexAgentId','codexSessionId','createdAt','id','title','workspaceId'],'legacy shape unchanged');
 assert.ok(restored.every(session=>session.messages.length===0),'reopen never sends');
 const tamper=fn=>{const copy=structuredClone(restored);fn(copy);return deriveComparisons(copy,agents).map(item=>item.id);};
 assert.deepEqual(tamper(c=>{c[1].modelId='haiku'}),['old'],'model changed on one side');
 assert.deepEqual(tamper(c=>{c[1].comparison.claudeModelId='haiku'}),['old'],'metadata mismatch');
 assert.deepEqual(tamper(c=>{delete c[0].comparison.mode;delete c[1].comparison.mode}),['old'],'same-agent ids without mode are not a legacy pair');
 assert.deepEqual(tamper(c=>{c[2].comparison.mode='same-agent';c[3].comparison.mode='same-agent'}),['same'],'a legacy pair cannot be relabeled');
 assert.deepEqual(tamper(c=>{c[0].comparison.mode='other';c[1].comparison.mode='other'}),['old']);
 assert.deepEqual(deriveComparisons(restored,agents.filter(agent=>agent.id!=='cl')).map(item=>item.id),[],'deleted source agent hides both');
});

test('an empty model is an explicit provider default: a stale saved model is never inherited, omission keeps the saved model',async()=>{
 // cx is Codex with saved model gpt-codex-x (pretend stale); cl is Claude with saved model sonnet.
 const explicit=validateComparison({mode:'same-agent',agentId:'cx',codexModelId:'',claudeModelId:'',briefing:'x'},agents,providers);
 assert.deepEqual([explicit.codexModelId,explicit.claudeModelId],[undefined,undefined]);
 assert.equal(validateComparison({mode:'same-agent',agentId:'cx',briefing:'x'},agents,providers).codexModelId,'gpt-codex-x','omitted keeps backward-compatible fallback');
 assert.equal(validateComparison({mode:'same-agent',agentId:'cl',claudeModelId:'',briefing:'x'},agents,providers).claudeModelId,undefined);
 assert.equal(validateComparison({mode:'same-agent',agentId:'cx',codexModelId:'',briefing:'x'},agents,providers,{codex:['other']}).codexModelId,undefined,'catalog never rejects the provider default');
 for(const bad of [' ','bad model!',null,0])assert.throws(()=>validateComparison({mode:'same-agent',agentId:'cx',codexModelId:bad,briefing:'x'},agents,providers),/valid Codex model/,JSON.stringify(bad));
 // Sessions/metadata: Codex '' resolves to the app's configured default Codex model (or the CLI default), never the saved one.
 const withDefault=comparisonSessions(explicit,{id:'d1',codexSessionId:'a',claudeSessionId:'b',now,defaultCodexModelId:'configured-default'});
 assert.deepEqual([withDefault.sessions[0].modelId,withDefault.comparison.codexModelId,withDefault.sessions[1].modelId,withDefault.comparison.claudeModelId],['configured-default','configured-default',undefined,'']);
 const cliDefault=comparisonSessions(explicit,{id:'d2',codexSessionId:'c',claudeSessionId:'d',now});
 assert.deepEqual([cliDefault.sessions[0].modelId,cliDefault.comparison.codexModelId],[undefined,'']);
 for(const pair of [withDefault,cliDefault])assert.deepEqual(deriveComparisons(pair.sessions,agents).map(item=>item.id),[pair.comparison.id],'default pairs reopen');
 const restored=composeImport({},parseBackup(JSON.stringify({format:'mainsagents-backup',version:1,exportedAt:now,data:safeData({sessions:[...cliDefault.sessions]})})),'replace').sessions;
 assert.deepEqual(deriveComparisons(restored,agents).map(item=>item.id),['d2']);
 // Fingerprints: different effects launch separately; identical effects reuse the launch.
 const h=sameHarness(),saved=await h.start({mode:'same-agent',agentId:'cx',briefing:'Same'}),def=await h.start({mode:'same-agent',agentId:'cx',codexModelId:'',briefing:'Same'});
 assert.notEqual(saved.id,def.id);assert.deepEqual(h.calls.map(c=>c.session.modelId),['gpt-codex-x',undefined,'default-codex',undefined]);
 const sameEffect=await h.start({mode:'same-agent',agentId:'cx',codexModelId:'',claudeModelId:'',briefing:'Same'});assert.equal(sameEffect.id,def.id,'claude omitted and claude empty both mean the Claude default here');
 assert.equal(h.calls.length,4,'still two calls per distinct comparison');
 h.finish();
});
