import test from 'node:test';
import assert from 'node:assert/strict';
import {addCollaborationChats} from '../src/components/canvas/collaborationCanvas.ts';
const view={viewport:{x:-800,y:100,zoom:.7},width:1200,height:800};
const chat=(agentId,sessionId)=>({agent:{id:agentId,name:agentId,workspaceId:'mine'},session:{id:sessionId,agentId,title:`Session ${sessionId}`,messages:[{content:'Original history'}]}});
const input={workspaceId:'mine',handoffId:'handoff',source:chat('content','source-session'),target:chat('video','target-session')};
test('collaboration creates two live session references and a directed Canvas arrow',()=>{
  const result=addCollaborationChats([],[],view,input);
  assert.equal(result.nodes.length,2);assert.equal(result.edges.length,1);
  assert.equal(result.nodes[0].data.chatSessionId,'source-session');assert.equal(result.nodes[1].data.chatSessionId,'target-session');
  assert.equal(result.edges[0].source,result.nodes[0].id);assert.equal(result.edges[0].target,result.nodes[1].id);assert.equal(result.edges[0].markerEnd.type,'arrowclosed');
  assert(result.nodes[1].position.x>result.nodes[0].position.x+420);assert.equal(result.nodes[0].position.y,result.nodes[1].position.y);
  assert.equal('messages' in result.nodes[0].data,false);assert.equal(input.source.session.messages.length,1);
});
test('repeated clicks and later handoffs reuse exactly the same sessions and positions',()=>{
  const first=addCollaborationChats([],[],view,input);first.nodes[0].position={x:-400,y:1200};
  const next=addCollaborationChats(first.nodes,first.edges,view,{...input,handoffId:'later'});
  assert.equal(next.nodes.length,2);assert.equal(next.edges.length,1);assert.deepEqual(next.nodeIds,first.nodeIds);assert.deepEqual(next.nodes[0].position,{x:-400,y:1200});
});
test('an explicitly new recipient session creates a new chat while retaining the source',()=>{
  const first=addCollaborationChats([],[],view,input);
  const next=addCollaborationChats(first.nodes,first.edges,view,{...input,target:chat('video','another-session')});
  assert.equal(next.nodes.length,3);assert.equal(next.edges.length,2);assert.equal(next.nodeIds[0],first.nodeIds[0]);assert.notEqual(next.nodeIds[1],first.nodeIds[1]);
});
test('placement avoids large existing windows and preserves unrelated nodes and edges',()=>{
  const note={id:'note',type:'note',position:{x:0,y:-800},width:3000,height:4000,data:{label:'Existing note'},selected:true};
  const edge={id:'existing',source:'note',target:'another'};
  const result=addCollaborationChats([note],[edge],view,input);
  assert.deepEqual(result.nodes[0].data,note.data);assert.deepEqual(result.nodes[0].position,note.position);assert.equal(result.nodes[0].selected,false);assert.equal(result.edges[0],edge);
  for(const node of result.nodes.slice(1))assert(node.position.y>=note.position.y+note.height+40);
});
test('partial or reconfigured Canvas chats are reused safely without duplicate IDs',()=>{
  const first=addCollaborationChats([],[],view,input);
  const partial=addCollaborationChats([first.nodes[1]],[],view,input);assert.equal(partial.nodes.length,2);assert.equal(partial.nodeIds[1],first.nodeIds[1]);
  const changed={...first.nodes[0],data:{...first.nodes[0].data,chatAgentId:'video',chatSessionId:'different'}};
  const result=addCollaborationChats([changed],[],view,input);assert.equal(new Set(result.nodes.map(node=>node.id)).size,3);assert.equal(result.nodes[0].data.chatSessionId,'different');
});
test('a pair cannot bind mismatched sessions or agents from another workspace',()=>{
  assert.throws(()=>addCollaborationChats([],[],view,{...input,workspaceId:'other'}));
  assert.throws(()=>addCollaborationChats([],[],view,{...input,target:{...input.target,session:{...input.target.session,agentId:'wrong'}}}));
});
