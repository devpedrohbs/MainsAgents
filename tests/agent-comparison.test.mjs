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
