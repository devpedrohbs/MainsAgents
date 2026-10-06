import test from 'node:test';
import assert from 'node:assert/strict';
import {createProductionFlow,initialProductionFlows,duplicateProductionFlow,bindFlowContent,canConnectFlow,linkFlow,upstreamFlowBox,validateProductionFlows,mergeProductionFlows} from '../src/features/flows/flowModel.ts';
import {safeData,parseBackup,composeImport} from '../src/data/backupFormat.ts';
const agents=[{id:'content',name:'Editor de Conteúdo',role:'Conteúdo',workspaceId:'a'},{id:'video',name:'Editor de Vídeo',role:'Vídeo',workspaceId:'a'},{id:'foreign',name:'Editor de Vídeo',role:'Vídeo',workspaceId:'b'}];
test('named content flow has four grouped boxes and chooses only workspace agents',()=>{
 const state=initialProductionFlows('a',agents),flow=state.flows[0];assert(validateProductionFlows(state));assert.equal(flow.nodes.length,4);assert.equal(flow.edges.length,3);assert.equal(flow.name,'Fluxo de criação de conteúdo');assert.deepEqual(flow.nodes.map(node=>node.agentId),['content',undefined,'video','content']);assert.equal(upstreamFlowBox(flow,flow.nodes[1].id,'content-agent').id,flow.nodes[0].id);
 const foreign=createProductionFlow('c','Other workspace',agents);assert(foreign.nodes.every(node=>node.agentId===undefined));
});
test('stage links reject cycles and broken targets; context cannot select a requesting agent',()=>{
 const flow=createProductionFlow('a','Flow',agents),[a,b,c,d]=flow.nodes;assert.equal(canConnectFlow(flow,d.id,a.id),false);assert.equal(canConnectFlow(flow,a.id,a.id),false);assert.equal(canConnectFlow(flow,a.id,'missing'),false);assert.throws(()=>linkFlow(flow,d.id,a.id));
 const context=linkFlow({...flow,edges:[]},a.id,b.id,'context');assert.equal(upstreamFlowBox(context,b.id,'content-agent'),undefined);assert.equal(canConnectFlow(flow,d.id,a.id,'context'),true);
});
test('duplicating and rebinding preserve earlier chats but never inherit production/session links',()=>{
 const flow=createProductionFlow('a','Production',agents);flow.contentId='content-a';flow.nodes[0].sessionId='saved-chat';const copy=duplicateProductionFlow(flow);assert.equal(copy.contentId,undefined);assert(copy.nodes.every(node=>!node.sessionId));assert(copy.nodes.every(node=>!flow.nodes.some(old=>old.id===node.id)));assert.equal(flow.nodes[0].sessionId,'saved-chat');
 const changed=bindFlowContent(flow,'content-b');assert(changed.nodes.every(node=>!node.sessionId));assert.equal(changed.contentId,'content-b');assert.equal(bindFlowContent(flow,'content-a'),flow);
 const unbound={...flow,contentId:undefined};assert.equal(bindFlowContent(unbound,'content-a',[{id:'saved-chat',agentId:'content',contentId:'content-a'}]).nodes[0].sessionId,'saved-chat');assert.equal(bindFlowContent(unbound,'content-a',[{id:'saved-chat',agentId:'foreign',contentId:'content-a'}]).nodes[0].sessionId,undefined);
});
test('named flows round-trip through backup and merge preserves local layout and selected workspace',()=>{
 const current=initialProductionFlows('a',agents),incoming=structuredClone(current);incoming.flows[0].name='Older name';incoming.flows.push(createProductionFlow('b','Other',agents));incoming.activeByWorkspace.b=incoming.flows[1].id;
 const merged=mergeProductionFlows(current,incoming);assert.equal(merged.flows[0].name,current.flows[0].name);assert.equal(merged.flows.length,2);assert(validateProductionFlows(merged));
 const backup=parseBackup(JSON.stringify({format:'mainsagents-backup',version:1,exportedAt:new Date().toISOString(),data:safeData({'production-flows':incoming})}));assert.deepEqual(composeImport({'production-flows':current},backup,'merge')['production-flows'],merged);assert.deepEqual(composeImport({},backup,'replace')['production-flows'],incoming);
});
test('malformed flow backups reject duplicated identities, cycles and cross-workspace selection',()=>{
 for(const corrupt of [state=>state.flows.push(structuredClone(state.flows[0])),state=>state.activeByWorkspace.b=state.flows[0].id,state=>state.flows[0].nodes[0].position.x=Infinity,state=>state.flows[0].edges.push({id:'cycle',source:state.flows[0].nodes[3].id,target:state.flows[0].nodes[0].id,kind:'sequence'})]){const state=initialProductionFlows('a',agents);corrupt(state);assert.equal(validateProductionFlows(state),false);assert.throws(()=>parseBackup(JSON.stringify({format:'mainsagents-backup',version:1,data:{'production-flows':state}})),/Invalid production flows/);}
});
