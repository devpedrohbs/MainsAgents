import test from 'node:test';
import assert from 'node:assert/strict';
import {attachCanvasContext,duplicateCanvasNode,pendingCanvasNodeIds,pruneCanvasContext,reconcileCanvasGraph,resolveCanvasChat} from '../src/components/canvas/canvasState.ts';
import {canvasShortcutIntent,rememberCanvasGeometry,rememberCanvasRemoval,undoCanvasEntry} from '../src/components/canvas/canvasHistory.ts';
import {contextContent,getUpstreamNodes} from '../src/components/canvas/canvasContext.ts';

const note=(id='same',workspaceId='a',text='original')=>({id,type:'note',position:{x:20,y:40},width:280,height:240,data:{label:'Note',workspaceId,text}});
const agent=(id='agent',workspaceId='a')=>({id,workspaceId,name:id,role:'Research'});
const edge=(id,source,target)=>({id,source,target});

test('pending context uses workspace and agent identity, even with colliding node and agent IDs',()=>{
  const a=note('same','a'),b=note('same','b');
  let pending=attachCanvasContext({},'a',agent(),['same'],[a]);
  assert.deepEqual(pendingCanvasNodeIds(pending,'b',agent('agent','b'),[b]),[]);
  pending=attachCanvasContext(pending,'b',agent('agent','b'),['same'],[b]);
  assert.deepEqual(pending.a.agent,['same']);assert.deepEqual(pending.b.agent,['same']);
  assert.deepEqual(pendingCanvasNodeIds(pending,'b',agent(),[b]),[]);
  assert.deepEqual(pendingCanvasNodeIds(pending,'a',agent(),[a]),['same']);
});

test('context attachment rejects missing/foreign agents, stale nodes and mismatched embedded ownership',()=>{
  const nodes=[note(),note('foreign','b')];
  const pending={};
  assert.equal(attachCanvasContext(pending,'a',undefined,['same'],nodes),pending);
  assert.equal(attachCanvasContext(pending,'a',agent('foreign-agent','b'),['same'],nodes),pending);
  assert.deepEqual(attachCanvasContext(pending,'a',agent(),['same','same','gone','foreign'],nodes),{a:{agent:['same']}});
  const legacy=note();delete legacy.data.workspaceId;
  assert.deepEqual(attachCanvasContext({},'a',agent(),['same'],[legacy]),{a:{agent:['same']}});
});

test('deletion removes dangling edges and pending references in one workspace, and undo does not revive attachments',()=>{
  const a=note(),other=note('other');
  const before={nodes:[a,other],edges:[edge('incident','same','other'),edge('already-broken','missing','other')]};
  const entry=rememberCanvasRemoval(before,['same']);
  const pending={a:{agent:['same','other']},b:{agent:['same']}};
  const after=reconcileCanvasGraph({...before,nodes:[other]});
  assert.deepEqual(after.edges,[]);
  const cleaned=pruneCanvasContext(pending,'a',after.nodes);
  assert.deepEqual(cleaned,{a:{agent:['other']},b:{agent:['same']}});
  const restored=undoCanvasEntry(after,entry);
  assert.deepEqual(restored.nodes.map(n=>n.id),['other','same']);
  assert.deepEqual(restored.edges.map(e=>e.id),['incident']);
  assert.deepEqual(pendingCanvasNodeIds(cleaned,'a',agent(),restored.nodes),['other']);
  assert.deepEqual(pending.a.agent,['same','other']);
});

test('graph reconciliation is immutable, preserves extra state and leaves valid graphs unchanged',()=>{
  const graph={nodes:[note()],edges:[],view:{viewport:{x:100,y:200,zoom:.5}},extra:'old snapshot'};
  assert.equal(reconcileCanvasGraph(graph),graph);
  const broken={...graph,edges:[edge('bad','same','gone')]};
  const clean=reconcileCanvasGraph(broken);
  assert.equal(clean.view,graph.view);assert.equal(clean.extra,'old snapshot');assert.equal(broken.edges.length,1);
});

test('geometry undo preserves later text, terminal output, chat binding, style and unrelated additions',()=>{
  const terminal={...note('terminal'),type:'terminal',data:{label:'Terminal',terminalOutput:'before',terminalStatus:'running',terminalExecutionId:'run-1'}};
  const chat={...note('chat'),type:'chat',data:{label:'Chat',chatSessionId:'old'}};
  const entry=rememberCanvasGeometry([note(),terminal,chat]);
  const late=note('created-by-agent');
  const nodes=[{...note(),position:{x:300,y:400},width:500,height:400,style:{background:'red'},data:{...note().data,text:'edited after the drag'}},{...terminal,data:{...terminal.data,terminalOutput:'new streamed output',terminalExitCode:0,terminalStatus:'finished'}},{...chat,data:{...chat.data,chatSessionId:'new-session'}},late];
  const connection=edge('new-edge','chat','created-by-agent');
  const result=undoCanvasEntry({nodes,edges:[connection]},entry);
  assert.deepEqual(result.nodes[0].position,{x:20,y:40});assert.equal(result.nodes[0].width,280);
  assert.equal(result.nodes[0].data.text,'edited after the drag');assert.equal(result.nodes[0].style.background,'red');
  assert.equal(result.nodes[1].data,nodes[1].data);assert.equal(result.nodes[1].data.terminalOutput,'new streamed output');
  assert.equal(result.nodes[2].data.chatSessionId,'new-session');assert.equal(result.nodes[3],late);assert.equal(result.edges[0],connection);
});

test('undoing creation and connection affects only the corresponding IDs',()=>{
  const graph={nodes:[note(),note('manual'),note('automatic')],edges:[edge('manual-edge','manual','same'),edge('automatic-edge','automatic','same')]};
  const creation=undoCanvasEntry(graph,{kind:'create',nodeIds:['manual']});
  assert.deepEqual(creation.nodes.map(n=>n.id),['same','automatic']);assert.deepEqual(creation.edges.map(e=>e.id),['automatic-edge']);
  const connection=undoCanvasEntry(graph,{kind:'connect',edgeIds:['manual-edge']});
  assert.equal(connection.nodes,graph.nodes);assert.deepEqual(connection.edges.map(e=>e.id),['automatic-edge']);
});

test('undoing removal does not replace a newer node with the same ID, or restore dangling edges',()=>{
  const old=note(),other=note('other');
  const entry=rememberCanvasRemoval({nodes:[old,other],edges:[edge('old','same','other')]},['same']);
  const newer={...old,data:{...old.data,text:'newer version'}};
  const result=undoCanvasEntry({nodes:[newer],edges:[]},entry);
  assert.equal(result.nodes[0],newer);assert.equal(result.nodes.length,1);assert.deepEqual(result.edges,[]);
});

test('group undo restores only membership and keeps concurrent content edits',()=>{
  const entry={kind:'group',nodes:[{id:'same',groupId:'before',groupLabel:'Before'}]};
  const changed={...note(),data:{...note().data,text:'updated',groupId:'after',groupLabel:'After'}};
  const result=undoCanvasEntry({nodes:[changed],edges:[]},entry);
  assert.equal(result.nodes[0].data.groupId,'before');assert.equal(result.nodes[0].data.groupLabel,'Before');assert.equal(result.nodes[0].data.text,'updated');
});

test('duplicating a terminal never inherits a running execution, cursor or source-message identity',()=>{
  const source={...note('terminal'),type:'terminal',data:{label:'Terminal',command:'echo manual only',terminalCwd:'C:/project',terminalExecutionId:'active-run',terminalEventCursor:17,terminalExitCode:0,terminalOutput:'secret output',terminalStatus:'running',sourceMessageId:'message',meta:'Running'}};
  const copy=duplicateCanvasNode(source,'copy');
  assert.equal(copy.id,'copy');assert.equal(copy.data.command,'echo manual only');assert.equal(copy.data.terminalCwd,'C:/project');
  assert.equal(copy.data.terminalExecutionId,undefined);assert.equal(copy.data.terminalEventCursor,undefined);assert.equal(copy.data.terminalExitCode,undefined);
  assert.equal(copy.data.terminalOutput,'');assert.equal(copy.data.terminalStatus,'idle');assert.equal(copy.data.sourceMessageId,undefined);
  assert.equal(source.data.terminalExecutionId,'active-run');assert.equal(source.data.terminalStatus,'running');
});

test('duplicating a chat starts unbound and leaves its original conversation intact',()=>{
  const source={...note('chat'),type:'chat',data:{label:'Chat',chatAgentId:'agent',chatSessionId:'session',chatHandoffId:'handoff',agentId:'agent',agentLabel:'Agent',sourceMessageId:'message'}};
  const copy=duplicateCanvasNode(source,'copy');
  for(const key of ['chatAgentId','chatSessionId','chatHandoffId','agentId','agentLabel','sourceMessageId'])assert.equal(copy.data[key],undefined,key);
  assert.equal(source.data.chatSessionId,'session');assert.notEqual(copy.data,source.data);
});

test('chat binding and transcript context cannot resolve another workspace or another agent session',()=>{
  const agents=[agent(),agent('foreign','b')];
  const sessions=[{id:'session-a',agentId:'agent',messages:[{type:'message',role:'agent',content:'LOCAL'}]},{id:'session-b',agentId:'foreign',messages:[{type:'message',role:'agent',content:'FOREIGN SECRET'}]}];
  const local={...note('chat'),type:'chat',data:{label:'Chat',chatAgentId:'agent',chatSessionId:'session-a'}};
  assert.equal(resolveCanvasChat(local,'a',agents,sessions).session.id,'session-a');assert.match(contextContent(local,'a',agents,sessions),/LOCAL/);
  const foreign={...local,data:{...local.data,chatAgentId:'foreign',chatSessionId:'session-b'}};
  assert.equal(resolveCanvasChat(foreign,'a',agents,sessions).agent,undefined);assert.doesNotMatch(contextContent(foreign,'a',agents,sessions),/FOREIGN SECRET/);
  const wrongSession={...local,data:{...local.data,chatSessionId:'session-b'}};
  assert.equal(resolveCanvasChat(wrongSession,'a',agents,sessions).session,undefined);assert.doesNotMatch(contextContent(wrongSession,'a',agents,sessions),/FOREIGN SECRET/);
  const wrongOwner={...local,data:{...local.data,workspaceId:'b'}};assert.equal(contextContent(wrongOwner,'a',agents,sessions),'');
});

test('upstream traversal ignores dangling and foreign nodes, and terminates on cyclic graphs',()=>{
  const nodes=[note('chat'),note('local'),note('foreign','b')];
  const edges=[edge('1','local','chat'),edge('2','chat','local'),edge('3','foreign','chat'),edge('4','missing','chat')];
  assert.deepEqual(getUpstreamNodes('chat',nodes,edges,'a').map(n=>n.id),['local']);
});

test('canvas shortcuts respect editors, dialogs, outside focus, native buttons and Shift+Ctrl+Z',()=>{
  const scope={active:true,editing:false,modal:false};
  assert.equal(canvasShortcutIntent({key:'z',ctrlKey:true},scope),'undo');
  assert.equal(canvasShortcutIntent({key:'Z',metaKey:true,shiftKey:true},scope),null);
  for(const flag of ['editing','modal'])assert.equal(canvasShortcutIntent({key:'z',ctrlKey:true},{...scope,[flag]:true}),null);
  assert.equal(canvasShortcutIntent({key:'n'},{...scope,active:false}),null);
  assert.equal(canvasShortcutIntent({key:' ',code:'Space'},scope),'pan');
  assert.equal(canvasShortcutIntent({key:' ',code:'Space'},{...scope,button:true}),null);
  assert.equal(canvasShortcutIntent({key:'n',repeat:true},scope),null);
  assert.equal(canvasShortcutIntent({key:'h'},scope),'hand');assert.equal(canvasShortcutIntent({key:'v'},scope),'select');
});
