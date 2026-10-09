import test from 'node:test';
import assert from 'node:assert/strict';
import {createProductionFlow,flowExecutionSemantics,linkFlow,validateProductionFlows,executionStageLabels} from '../src/features/flows/flowModel.ts';

const agents=[
 {id:'content',name:'Editor de Conteúdo',role:'Conteúdo',workspaceId:'w'},
 {id:'video',name:'Editor de Vídeo',role:'Vídeo',workspaceId:'w',providerId:'codex'},
 {id:'claude',name:'Revisor Claude',role:'Revisão',workspaceId:'w',providerId:'claude'},
 {id:'far',name:'Outro espaço',role:'Conteúdo',workspaceId:'other'},
];
const base=()=>createProductionFlow('w','Fluxo',agents);
const codes=result=>result.issues.map(issue=>issue.code);
const clone=value=>structuredClone(value);

test('the default flow is supported, uses the content agent as publisher and keeps the fixed stage order',()=>{
 const flow=base(),before=clone(flow),result=flowExecutionSemantics(flow,agents);
 assert.equal(result.status,'supported');assert.deepEqual(codes(result),[]);
 assert.deepEqual(result.roles.map(r=>[r.kind,r.agentId]),[['content-agent','content'],['video-agent','video'],['publishing-agent','content']]);
 assert.deepEqual(result.stages,executionStageLabels(true));assert.equal(result.stages.length,5);
 assert.deepEqual(flow,before,'diagnosis never changes the diagram');
});

test('missing boxes, missing or foreign agents are reported as missing with a concrete fix',()=>{
 const noEditor={...base()};noEditor.nodes=noEditor.nodes.filter(n=>n.kind!=='video-agent');noEditor.edges=[];
 const missing=flowExecutionSemantics(noEditor,agents);assert.equal(missing.status,'missing');assert(codes(missing).includes('missing-box'));assert.match(missing.issues.find(i=>i.code==='missing-box').fix,/Adicionar caixa/);
 const foreign=base();foreign.nodes=foreign.nodes.map(n=>n.kind==='content-agent'?{...n,agentId:'far'}:n);
 const result=flowExecutionSemantics(foreign,agents);assert.equal(result.status,'missing');assert.deepEqual(result.issues.find(i=>i.code==='missing-agent').boxIds,[foreign.nodes[0].id]);
 const deleted=flowExecutionSemantics(base(),agents.filter(a=>a.id!=='video'));assert.equal(deleted.status,'missing');
 const noPublisher=base();noPublisher.nodes=noPublisher.nodes.filter(n=>n.kind!=='publishing-agent');noPublisher.edges=noPublisher.edges.filter(e=>noPublisher.nodes.some(n=>n.id===e.target));
 const fallback=flowExecutionSemantics(noPublisher,agents);assert.equal(fallback.status,'supported');assert.deepEqual(codes(fallback),['publisher-fallback']);assert.equal(fallback.roles[2].fallback,true);assert.equal(fallback.roles[2].agentId,'content');
});

test('a non-Codex agent is unsupported for production but explained, not hidden',()=>{
 const flow=base();flow.nodes=flow.nodes.map(n=>n.kind==='video-agent'?{...n,agentId:'claude'}:n);
 const result=flowExecutionSemantics(flow,agents);assert.equal(result.status,'unsupported');
 const issue=result.issues.find(i=>i.code==='unsupported-provider');assert.match(issue.message,/Claude.*somente agentes Codex.*chat/);
 assert.match(flowExecutionSemantics(flow,agents,false).issues.find(i=>i.code==='unsupported-provider').message,/only runs Codex agents/);
});

test('duplicated roles are ambiguous and name the box production really uses (first saved, not the connected one)',()=>{
 const flow=base(),extra={id:'box-extra',kind:'video-agent',title:'Editor alternativo',position:{x:0,y:400},agentId:'claude'};
 const linked=linkFlow({...flow,nodes:[...flow.nodes,extra]},flow.nodes[0].id,extra.id);
 const result=flowExecutionSemantics(linked,agents);assert.equal(result.status,'ambiguous');
 const issue=result.issues.find(i=>i.code==='ambiguous-role');assert.equal(issue.level,'warning');assert.equal(issue.boxIds.length,2);assert.match(issue.message,/usa somente “Editor de vídeo” \(a primeira na lista salva deste fluxo\)/);
 assert.equal(result.roles[1].agentId,'video','the extra Claude box connected first is still not used');
 assert(!codes(result).includes('unsupported-provider'),'an unused box never blocks a previously valid configuration');
});

test('custom drawings and context links are explained as non-executing, without blocking',()=>{
 const flow=base(),[content,input,editor,publisher]=flow.nodes;
 const reordered={...flow,edges:[{id:'e1',source:content.id,target:publisher.id,kind:'sequence'},{id:'e2',source:publisher.id,target:editor.id,kind:'sequence'},{id:'e3',source:input.id,target:editor.id,kind:'context'}]};
 assert.equal(validateProductionFlows({schemaVersion:1,flows:[reordered],activeByWorkspace:{w:reordered.id}}),true,'existing drawings stay valid');
 const result=flowExecutionSemantics(reordered,agents);assert.equal(result.status,'custom-layout');assert.deepEqual(codes(result),['custom-layout','context-links']);
 assert(result.issues.every(i=>i.level==='info'));assert.match(result.issues[0].message,/produção semiautomática, as conexões não mudam a execução.*roteiro\/Notion → gravação → edição → pacote → agendamento.*envio manual de briefing.*Próxima etapa/);
 assert.match(flowExecutionSemantics(reordered,agents,false).issues[0].message,/do not change execution/);
 assert.deepEqual(result.roles.map(r=>r.agentId),['content','video','content']);
 const unlinked={...flow,edges:[]};assert.equal(flowExecutionSemantics(unlinked,agents).status,'custom-layout','removing links never stops production');
});

test('every issue has PT and EN text with a fix, and the helper is deterministic',()=>{
 const flow=base();flow.nodes=[...flow.nodes,{id:'dup',kind:'content-agent',title:'Outro',position:{x:1,y:1}}];flow.nodes[2]={...flow.nodes[2],agentId:undefined};
 for(const pt of [true,false]){const result=flowExecutionSemantics(flow,agents,pt);assert(result.issues.length>=2);for(const issue of result.issues){assert(issue.message.length>10&&issue.fix.length>10);}assert.deepEqual(flowExecutionSemantics(flow,agents,pt),result);}
});

test('the used box follows the saved list order (as the coordinator reads it), not creation time or links',()=>{
 const flow=base(),extra={id:'box-imported',kind:'video-agent',title:'Editor importado',position:{x:0,y:400},agentId:'claude'};
 const imported={...flow,nodes:[extra,...flow.nodes]};
 const result=flowExecutionSemantics(imported,agents);
 assert.equal(result.roles[1].boxId,'box-imported');assert.equal(result.status,'unsupported','the first saved video box is the Claude one, so production cannot use it');
 assert.match(result.issues.find(i=>i.code==='ambiguous-role').message,/usa somente “Editor importado”/);
});
