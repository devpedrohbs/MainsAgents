import test from 'node:test';
import assert from 'node:assert/strict';
import {canvasBoard,canvasScopeKey,createCanvasBoard,findCanvasNodeBoard,mergeCanvasWorkspaces,readCanvasWorkspace,removeCanvasBoard,renameCanvasBoard,resolveCanvasReference,updateCanvasBoard} from '../src/components/canvas/canvasBoards.ts';
import {normalizeChatDraft} from '../src/features/chat/chatDraftModel.ts';
import {attachCanvasContext,pendingCanvasNodeIds,pruneCanvasContext} from '../src/components/canvas/canvasState.ts';
import {addCollaborationChats} from '../src/components/canvas/collaborationCanvas.ts';
import {composeImport,parseBackup} from '../src/data/backupFormat.ts';
import {embedChatImages} from '../src/data/chatImageBackup.ts';
const node=(id,text=id)=>({id,type:'note',position:{x:20,y:40},data:{label:'Note',text,workspaceId:'w'}});
const view={viewport:{x:70,y:-45,zoom:.6},width:1000,height:700,ready:true};
const legacy=()=>({nodes:[node('one'),node('two')],edges:[{id:'link',source:'one',target:'two'}],view});
const backup=data=>parseBackup(JSON.stringify({format:'mainsagents-backup',version:1,exportedAt:'2026-10-29T00:00:00Z',data}));

test('legacy canvas migration is lossless, lazy and preserves every node, edge and viewport',()=>{
 const old=legacy(),before=structuredClone(old),state=readCanvasWorkspace(old);
 assert.equal(state.activeBoardId,'main');assert.equal(state.boards.length,1);assert.equal(state.boards[0].nodes,old.nodes);assert.equal(state.boards[0].edges,old.edges);assert.deepEqual(state.boards[0].view,view);assert.deepEqual(old,before);
 const next=createCanvasBoard(state,'news','Notícias');assert.equal(next.activeBoardId,'news');assert.equal(canvasBoard(next).nodes.length,0);assert.equal(canvasBoard(next,'main').nodes,old.nodes);assert.deepEqual(old,before);
});

test('spaces keep independent graphs and viewports, preserve inactive late updates and reject unknown ownership',()=>{
 const a=readCanvasWorkspace(legacy());let state=createCanvasBoard(a,'edit','Edição');
 state=updateCanvasBoard(state,'edit',board=>({...board,nodes:[node('edit-node')],view:{...view,viewport:{x:100,y:80,zoom:1.4}}}));
 state=updateCanvasBoard(state,'main',board=>({...board,nodes:board.nodes.map(n=>n.id==='one'?{...n,data:{...n.data,text:'late terminal output'}}:n)}));
 assert.equal(state.activeBoardId,'edit');assert.equal(canvasBoard(state,'main').nodes[0].data.text,'late terminal output');assert.equal(canvasBoard(state).view.viewport.zoom,1.4);assert.equal(canvasBoard(state,'main').view.viewport.zoom,.6);
 assert.equal(findCanvasNodeBoard(state,'one').id,'main');assert.equal(findCanvasNodeBoard(state,'one','edit'),undefined);
 const ambiguous=updateCanvasBoard(state,'edit',board=>({...board,nodes:[node('one')]}));assert.equal(findCanvasNodeBoard(ambiguous,'one'),undefined);assert.equal(findCanvasNodeBoard(ambiguous,'one','main').id,'main');
});

test('rename and delete preserve the other spaces; last space and running terminals are protected',()=>{
 const a=readCanvasWorkspace(legacy()),b=createCanvasBoard(a,'news','Notícias');
 assert.throws(()=>renameCanvasBoard(b,'news',' main CANVAS '),/already exists/);assert.throws(()=>createCanvasBoard(b,'another','   '),/between/);assert.throws(()=>renameCanvasBoard(b,'news','x'.repeat(81)),/between/);
 const c=renameCanvasBoard(b,'news','Pesquisa de notícias');assert.equal(canvasBoard(c).name,'Pesquisa de notícias');assert.equal(canvasBoard(b).name,'Notícias');
 const running=updateCanvasBoard(c,'news',board=>({...board,nodes:[{...node('terminal'),type:'terminal',data:{label:'Terminal',terminalStatus:'running'}}]}));assert.throws(()=>removeCanvasBoard(running,'news'),/Stop running/);
 const removed=removeCanvasBoard(c,'news');assert.equal(removed.activeBoardId,'main');assert.deepEqual(canvasBoard(removed).nodes,a.boards[0].nodes);assert.throws(()=>removeCanvasBoard(removed,'main'),/at least one/);
});

test('pending agent context is isolated by profile, workspace and space, even when imported IDs repeat',()=>{
 const agent={id:'agent',workspaceId:'w'},nodes=[node('one')];
 const scope=canvasScopeKey('w','news','alice'),otherBoard=canvasScopeKey('w','edit','alice'),otherProfile=canvasScopeKey('w','news','bob');
 let pending=attachCanvasContext({},scope,agent,['one'],nodes,'w');
 assert.deepEqual(pendingCanvasNodeIds(pending,scope,agent,nodes,'w'),['one']);assert.deepEqual(pendingCanvasNodeIds(pending,otherBoard,agent,nodes,'w'),[]);assert.deepEqual(pendingCanvasNodeIds(pending,otherProfile,agent,nodes,'w'),[]);
 assert.deepEqual(pendingCanvasNodeIds(pending,scope,{...agent,workspaceId:'foreign'},nodes,'w'),[]);
 pending=attachCanvasContext(pending,otherBoard,agent,['one'],nodes,'w');const cleaned=pruneCanvasContext(pending,scope,[],'w');assert.deepEqual(pendingCanvasNodeIds(cleaned,otherBoard,agent,nodes,'w'),['one']);assert.deepEqual(pendingCanvasNodeIds(cleaned,scope,agent,nodes,'w'),[]);
});

test('backup merge and replace carry every space, combine legacy nodes and refuse malformed v2 before restore',()=>{
 const old=legacy(),local=createCanvasBoard(readCanvasWorkspace(old),'news','Notícias'),remote=createCanvasBoard(readCanvasWorkspace({nodes:[node('three')],edges:[],view}),'edit','Edição');
 const merged=composeImport({'canvas-workspaces':{w:local}},backup({'canvas-workspaces':{w:remote}}),'merge')['canvas-workspaces'].w;
 assert.deepEqual(merged.boards.map(b=>b.id),['main','news','edit']);assert.deepEqual(canvasBoard(merged,'main').nodes.map(n=>n.id),['three','one','two']);assert.equal(merged.activeBoardId,'news');
 const mixed=mergeCanvasWorkspaces(local,{nodes:[node('four')],edges:[]});assert.equal(mixed.boards.length,2);assert(canvasBoard(mixed,'main').nodes.some(n=>n.id==='four'));
 const replaced=composeImport({},backup({'canvas-workspaces':{w:local}}),'replace');assert.deepEqual(replaced['canvas-workspaces'].w,local);
 assert.throws(()=>backup({'canvas-workspaces':{w:{schemaVersion:2,activeBoardId:'main',boards:[]}}}),/Invalid Canvas/);
 assert.throws(()=>readCanvasWorkspace({...local,boards:[local.boards[0],local.boards[0]]}),/Invalid canvas/);
 assert.deepEqual(old,legacy());
});

test('backup embeds generated images from inactive spaces as well as legacy canvases, without mutating storage',async()=>{
 const url=`/api/codex/images/${'a'.repeat(64)}.png`,dataUrl='data:image/png;base64,AA==';
 const graph={nodes:[{...node('image'),type:'image',data:{label:'Image',imageUrl:url}}],edges:[],view};const state=createCanvasBoard(readCanvasWorkspace(graph),'active','Active');
 const original={'canvas-workspaces':{w:state,old:graph}};let calls=0;
 const exported=await embedChatImages(original,async value=>{assert.equal(value,url);calls++;return dataUrl;});assert.equal(calls,1);assert.equal(exported['canvas-workspaces'].w.boards[0].nodes[0].data.imageUrl,dataUrl);assert.equal(exported['canvas-workspaces'].old.nodes[0].data.imageUrl,dataUrl);assert.equal(original['canvas-workspaces'].w.boards[0].nodes[0].data.imageUrl,url);
});

test('collaboration nodes have distinct IDs in different spaces and still reuse chats within their own space',()=>{
 const source={agent:{id:'a',workspaceId:'w'},session:{id:'s',agentId:'a'}},target={agent:{id:'b',workspaceId:'w'},session:{id:'t',agentId:'b'}};
 const input={workspaceId:'w',handoffId:'handoff',source,target};
 const a=addCollaborationChats([],[],view,{...input,boardId:'news'}),b=addCollaborationChats([],[],view,{...input,boardId:'edit'});
 assert.equal(a.nodes.some(n=>b.nodes.some(other=>n.id===other.id)),false);
 assert.equal(addCollaborationChats(a.nodes,a.edges,view,{...input,boardId:'news'}).nodes.length,2);
});

test('explicit draft attachments pin their space; legacy ambiguous IDs never select another space silently',()=>{
 const entries=[{workspaceId:'w',boardId:'news',boardName:'Notícias',node:node('same','news evidence')},{workspaceId:'w',boardId:'edit',boardName:'Edição',node:node('same','editing context')}];
 const ref={workspaceId:'w',boardId:'edit',nodeId:'same',label:'Context'};
 assert.equal(resolveCanvasReference(entries,'w',ref).node.data.text,'editing context');assert.equal(resolveCanvasReference(entries,'other',ref),undefined);
 assert.equal(resolveCanvasReference(entries,'w',{workspaceId:'w',nodeId:'same'}),undefined);
 assert.equal(resolveCanvasReference([entries[0]],'w',{workspaceId:'w',nodeId:'same'}).boardId,'news');
 const draft=normalizeChatDraft({text:'draft',skill:null,context:[ref]});assert.deepEqual(draft.context,[ref]);
 const restored=composeImport({},backup({'chat-drafts':{'["agent","session"]':draft}}),'replace');assert.equal(restored['chat-drafts']['["agent","session"]'].context[0].boardId,'edit');
});
