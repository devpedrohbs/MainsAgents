import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { addEdge, Background, BackgroundVariant, Controls, ReactFlow, type Connection, type Edge, type NodeTypes } from '@xyflow/react';
import { Icon } from '../common/Icon';
import type { CanvasFlowNode, CanvasNodeData, CanvasNodeKind } from './canvasTypes';
import { ContentIdeaNode, HookNode, ImageNode, NoteNode, ResearchNode, ScriptNode } from './nodes/CanvasNodes';
import { useCanvas } from './CanvasProvider';
import { useWorkspaces } from '../../app/WorkspaceProvider';
import { useLanguage } from '../../app/LanguageProvider';

const nodeTypes = { note:NoteNode, research:ResearchNode, image:ImageNode, contentIdea:ContentIdeaNode, hook:HookNode, script:ScriptNode } satisfies NodeTypes;
const nodeLabels:Record<CanvasNodeKind,string>={note:'Note',research:'Research',image:'Image',contentIdea:'Content idea',hook:'Hook',script:'Script'};
const nodeDefaults:Record<CanvasNodeKind,Partial<Omit<CanvasNodeData,'label'>>>={
  note:{text:'Capture an observation or decision here.',meta:'You · now'},
  research:{source:'Source',title:'New research',summary:'Add a source-backed finding to the workspace.',url:'https://example.com',meta:'Just now'},
  image:{imageUrl:'/canvas-reference.svg',caption:'Visual reference',meta:'Just now'},
  contentIdea:{platform:'Instagram',title:'New content idea',description:'Shape this signal into a useful content direction.',meta:'Draft idea'},
  hook:{hook:'Write a concise opening that earns the next second.',meta:'New option'},
  script:{title:'New script',preview:'Develop the approved idea into a clear narrative.',wordCount:0,meta:'Draft 01'},
};

interface ContextMenuState { nodeId:string; x:number; y:number }

interface CanvasProps { onToast:(message:string)=>void; onAskAgent:(nodeIds:string[])=>void; onSendToAgent:(nodeIds:string[])=>void }

export function Canvas({onToast,onAskAgent,onSendToAgent}:CanvasProps) {
  const {currentWorkspace}=useWorkspaces();
  const {t}=useLanguage();
  const {nodes,edges,setNodes,setEdges,onNodesChange,onEdgesChange,view,updateView,groupNodes}=useCanvas();
  const [addMenuOpen,setAddMenuOpen]=useState(false);
  const [contextMenu,setContextMenu]=useState<ContextMenuState|null>(null);
  const [connectFromId,setConnectFromId]=useState<string|null>(null);
  const layoutRef=useRef<HTMLElement>(null);
  const selectedNodes=nodes.filter((node)=>node.selected);

  useEffect(()=>{
    const onKeyDown=(event:KeyboardEvent)=>{if(event.key==='Escape'){setContextMenu(null);setConnectFromId(null)}};
    window.addEventListener('keydown',onKeyDown);
    return ()=>window.removeEventListener('keydown',onKeyDown);
  },[]);

  const onConnect=useCallback((connection:Connection)=>{setEdges((current)=>addEdge({...connection,type:'smoothstep'},current));onToast('Nodes connected')},[onToast,setEdges]);
  const deleteNodes=(ids:Set<string>)=>{setNodes((current)=>current.filter((node)=>!ids.has(node.id)));setEdges((current)=>current.filter((edge)=>!ids.has(edge.source)&&!ids.has(edge.target)));setContextMenu(null);onToast(`${ids.size} node${ids.size===1?'':'s'} deleted`)};
  const addNode=(kind:CanvasNodeKind)=>{const offset=nodes.length*28;const node:CanvasFlowNode={id:`node-${Date.now()}`,type:kind,position:{x:260+(offset%420),y:150+(offset%260)},data:{label:nodeLabels[kind],...nodeDefaults[kind]}};setNodes((current)=>[...current,node]);setAddMenuOpen(false);onToast(`${nodeLabels[kind]} added`)};
  const openContextMenu=(event:ReactMouseEvent,node:CanvasFlowNode)=>{event.preventDefault();setNodes((current)=>current.map((item)=>({...item,selected:item.id===node.id})));setContextMenu({nodeId:node.id,x:Math.min(event.clientX,window.innerWidth-198),y:Math.min(event.clientY,window.innerHeight-190)});setAddMenuOpen(false)};
  const duplicateNode=(nodeId:string)=>{const source=nodes.find((node)=>node.id===nodeId);if(!source)return;const clone:CanvasFlowNode={...source,id:`${source.id}-copy-${Date.now()}`,position:{x:source.position.x+34,y:source.position.y+34},selected:true,data:{...source.data}};setNodes((current)=>[...current.map((node)=>({...node,selected:false})),clone]);setContextMenu(null);onToast(`${source.data.label} duplicated`)};
  const beginConnection=(nodeId:string)=>{setConnectFromId(nodeId);setContextMenu(null);onToast('Select another node to connect')};
  const handleNodeClick=(_:ReactMouseEvent,node:CanvasFlowNode)=>{setContextMenu(null);if(!connectFromId||connectFromId===node.id)return;setEdges((current)=>addEdge({id:`edge-${connectFromId}-${node.id}-${Date.now()}`,source:connectFromId,target:node.id,type:'smoothstep'},current));setConnectFromId(null);onToast('Nodes connected')};
  const askAgent=()=>{if(!contextMenu)return;const nodeId=contextMenu.nodeId;setContextMenu(null);onAskAgent([nodeId])};
  const sendToAgent=()=>{if(!contextMenu)return;const nodeId=contextMenu.nodeId;setContextMenu(null);onSendToAgent([nodeId])};
  const groupSelected=()=>{const ids=selectedNodes.map((node)=>node.id);if(ids.length<2)return;groupNodes(ids);onToast(`${ids.length} nodes grouped`)};

  return <section className="canvas-layout" ref={layoutRef}>
    <div className="canvas-toolbar"><div className="canvas-title"><Icon name="canvas"/><strong>{currentWorkspace.name} canvas</strong><span>· {nodes.length} objects</span></div><div className="canvas-tools"><button className="soft-button" onClick={()=>addNode('note')}><Icon name="note"/>{t('Note')}</button><div className="canvas-add-wrap"><button className="soft-button" aria-expanded={addMenuOpen} onClick={()=>setAddMenuOpen((open)=>!open)}><Icon name="plus"/>{t('Add')}</button>{addMenuOpen&&<div className="canvas-add-menu">{(Object.keys(nodeLabels) as CanvasNodeKind[]).map((kind)=><button key={kind} onClick={()=>addNode(kind)}><i/>{t(nodeLabels[kind])}</button>)}</div>}</div></div></div>
    <ReactFlow<CanvasFlowNode,Edge>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onMoveEnd={(_,viewport)=>{const bounds=layoutRef.current?.getBoundingClientRect();updateView(viewport,bounds?.width??view.width,bounds?.height??view.height)}}
      onNodeClick={handleNodeClick}
      onNodeContextMenu={openContextMenu}
      onPaneClick={()=>{setAddMenuOpen(false);setContextMenu(null)}}
      onNodesDelete={(deleted)=>onToast(`${deleted.length} node${deleted.length===1?'':'s'} deleted`)}
      onEdgesDelete={(deleted)=>deleted.length&&onToast(`${deleted.length} connection${deleted.length===1?'':'s'} deleted`)}
      deleteKeyCode={['Backspace','Delete']}
      fitView={!view.ready}
      {...(view.ready?{defaultViewport:view.viewport}:{})}
      fitViewOptions={{padding:.18}}
      minZoom={.4}
      maxZoom={1.7}
      panOnDrag
      zoomOnDoubleClick={false}
      defaultEdgeOptions={{type:'smoothstep'}}
      connectionLineStyle={{stroke:'#74747c',strokeWidth:1.2}}
      proOptions={{hideAttribution:true}}
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={.7} color="#2a2a2e"/>
      <Controls position="bottom-right" showInteractive={false}/>
    </ReactFlow>
    {connectFromId&&<div className="connect-hint"><Icon name="link"/>Select a destination node <button onClick={()=>setConnectFromId(null)}>Cancel</button></div>}
    {contextMenu&&<div className="context-menu canvas-context-menu" role="menu" aria-label="Node actions" style={{left:contextMenu.x,top:contextMenu.y}} onContextMenu={(event)=>event.preventDefault()}>
      <button role="menuitem" onClick={askAgent}><Icon name="message"/>{t('Ask Agent')}</button>
      <button role="menuitem" onClick={sendToAgent}><Icon name="users"/>{t('Send to Agent')}</button>
      <div className="context-separator"/>
      <button role="menuitem" onClick={()=>duplicateNode(contextMenu.nodeId)}><Icon name="copy"/>{t('Duplicate')}</button>
      <button role="menuitem" onClick={()=>beginConnection(contextMenu.nodeId)}><Icon name="link"/>{t('Connect')}</button>
      <div className="context-separator"/>
      <button role="menuitem" className="danger" onClick={()=>deleteNodes(new Set([contextMenu.nodeId]))}><Icon name="trash"/>{t('Delete')}</button>
    </div>}
    {selectedNodes.length>0&&<div className="selection-bar show"><span className="selection-label">{selectedNodes.length} {t('selected')}</span><button className="soft-button" onClick={()=>onAskAgent(selectedNodes.map((node)=>node.id))}><Icon name="message"/>{t('Ask Agent')}</button><button className="soft-button" onClick={()=>onSendToAgent(selectedNodes.map((node)=>node.id))}><Icon name="users"/>{t('Send to Agent')}</button><button className="soft-button" disabled={selectedNodes.length<2} onClick={groupSelected}><Icon name="folder"/>{t('Group')}</button></div>}
  </section>;
}
