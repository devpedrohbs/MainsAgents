import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react';

import { addEdge, applyEdgeChanges, applyNodeChanges, Background, BackgroundVariant, MarkerType, ReactFlow, ViewportPortal, type Connection, type Edge, type NodeTypes, type ReactFlowInstance } from '@xyflow/react';

import { FlowDialog } from '../common/FlowDialog';

import { Icon, type IconName } from '../common/Icon';

import type { CanvasFlowNode, CanvasNodeData, CanvasNodeKind } from './canvasTypes';

import { BrowserNode, ChatNode, ContentIdeaNode, HookNode, ImageNode, NoteNode, ResearchNode, ScriptNode, TerminalNode } from './nodes/CanvasNodes';

import { useCanvas } from './CanvasProvider';

import { useWorkspaces } from '../../app/WorkspaceProvider';

import { useLanguage } from '../../app/LanguageProvider';



const nodeTypes = { note:NoteNode, research:ResearchNode, image:ImageNode, contentIdea:ContentIdeaNode, hook:HookNode, script:ScriptNode, terminal:TerminalNode, browser:BrowserNode, chat:ChatNode } satisfies NodeTypes;

const nodeLabels:Record<CanvasNodeKind,string>={note:'Note',research:'Research',image:'Image',contentIdea:'Content idea',hook:'Hook',script:'Script',terminal:'Terminal',browser:'Browser',chat:'Chat'};

const nodeIcons:Record<CanvasNodeKind,IconName>={note:'note',research:'search',image:'image',contentIdea:'spark',hook:'link',script:'script',terminal:'terminal',browser:'globe',chat:'message'};

const quickTools:CanvasNodeKind[]=['note','research','chat'];

const nodeDefaults:Record<CanvasNodeKind,Partial<Omit<CanvasNodeData,'label'>>>={

  note:{text:'Capture an observation or decision here.',meta:'You · now'},

  research:{source:'Source',title:'New research',summary:'Add a source-backed finding to the workspace.',url:'https://example.com',meta:'Just now'},

  image:{imageUrl:'/canvas-reference.svg',caption:'Visual reference',meta:'Just now'},

  contentIdea:{platform:'Instagram',title:'New content idea',description:'Shape this signal into a useful content direction.',meta:'Draft idea'},

  hook:{hook:'Write a concise opening that earns the next second.',meta:'New option'},

  script:{title:'New script',preview:'Develop the approved idea into a clear narrative.',wordCount:0,meta:'Draft 01'},

  terminal:{command:'',terminalOutput:'',terminalStatus:'idle',meta:'Local terminal'},

  browser:{browserUrl:'',meta:'Embedded browser'},

  chat:{meta:'Connected to Canvas'},

};

const arrowMarker={type:MarkerType.ArrowClosed,color:'var(--muted)',width:14,height:14};



interface ContextMenuState { nodeId:string; x:number; y:number }



interface CanvasProps { onToast:(message:string)=>void; onAskAgent:(nodeIds:string[])=>void; onSendToAgent:(nodeIds:string[])=>void }



export function Canvas({onToast,onAskAgent,onSendToAgent}:CanvasProps) {

  const {currentWorkspaceId,currentWorkspace}=useWorkspaces();

  const {t,locale,reducedMotion}=useLanguage();

  const {nodes,edges,setNodes,setEdges,view,updateView,addNode:insertNode,updateNodeData,groupNodes,focusRequest,clearFocusRequest,registerVisibleChats}=useCanvas();
  const chatSessionIds=nodes.filter(node=>node.type==='chat'&&node.data.chatSessionId).map(node=>node.data.chatSessionId!);
  const visibleChatKey=JSON.stringify(chatSessionIds);
  useEffect(()=>{registerVisibleChats(JSON.parse(visibleChatKey));return()=>registerVisibleChats([])},[visibleChatKey,registerVisibleChats]);

  const flowRef=useRef<ReactFlowInstance<CanvasFlowNode,Edge>|null>(null);
  const [flowReady,setFlowReady]=useState(false);
  const focusing=useRef<string|null>(null);
  useEffect(()=>{
    if(!flowReady||!focusRequest||focusRequest.workspaceId!==currentWorkspaceId||focusing.current===focusRequest.requestId)return;
    const pair=[focusRequest.source,focusRequest.target].map(chat=>nodes.find(node=>node.type==='chat'&&node.data.chatAgentId===chat.agent.id&&node.data.chatSessionId===chat.session.id));
    if(pair.some(node=>!node?.measured?.width||!node?.measured?.height))return;
    focusing.current=focusRequest.requestId;
    void flowRef.current?.fitView({nodes:pair.map(node=>({id:node!.id})),padding:.18,maxZoom:1,minZoom:.2,duration:reducedMotion?0:220}).then(()=>clearFocusRequest(focusRequest.requestId));
  },[flowReady,focusRequest,currentWorkspaceId,nodes,reducedMotion,clearFocusRequest]);

  const [objectsOpen,setObjectsOpen]=useState(false);

  const [objectQuery,setObjectQuery]=useState('');

  const objectLabel=(node:CanvasFlowNode)=>node.data.title||node.data.caption||node.data.text||node.data.hook||node.data.browserUrl||node.data.label;

  const objectMatches=nodes.filter((node)=>`${objectLabel(node)} ${t(nodeLabels[node.type as CanvasNodeKind])}`.toLocaleLowerCase(locale).includes(objectQuery.trim().toLocaleLowerCase(locale)));

  const [addMenuOpen,setAddMenuOpen]=useState(false);

  const [contextMenu,setContextMenu]=useState<ContextMenuState|null>(null);

  const [connectFromId,setConnectFromId]=useState<string|null>(null);

  const layoutRef=useRef<HTMLElement>(null);

  const selectedNodes=nodes.filter((node)=>node.selected);

  const [tool,setTool]=useState<'pan'|'select'>('pan');
  const [undoStack,setUndoStack]=useState<Array<{nodes:CanvasFlowNode[];edges:Edge[]}>>([]);
  const remember=()=>setUndoStack(current=>[...current.slice(-19),{nodes:nodes.map(node=>({...node,position:{...node.position},data:{...node.data}})),edges:edges.map(edge=>({...edge}))}]);
  const undo=()=>{const previous=undoStack.at(-1);if(!previous)return;setNodes(previous.nodes);setEdges(previous.edges);setUndoStack(current=>current.slice(0,-1));setDetailsOpen(false);onToast(locale==='pt-BR'?'Ação desfeita':'Action undone')};
  useEffect(()=>{setUndoStack([]);setDetailsOpen(false)},[currentWorkspaceId]);

  const [detailsOpen,setDetailsOpen]=useState(false);

  const detail=detailsOpen&&selectedNodes.length===1?selectedNodes[0]:undefined;

  const areas=useMemo(()=>{

    const ids=Array.from(new Set(nodes.map(node=>node.data.groupId).filter(Boolean)));

    return ids.map(id=>{

      const members=nodes.filter(node=>node.data.groupId===id);

      const x=Math.min(...members.map(node=>node.position.x))-24;

      const y=Math.min(...members.map(node=>node.position.y))-65;

      const right=Math.max(...members.map(node=>node.position.x+(node.measured?.width??node.width??280)))+24;

      const bottom=Math.max(...members.map(node=>node.position.y+(node.measured?.height??node.height??240)))+24;

      return {id,label:members[0].data.groupLabel||t('Group'),x,y,width:right-x,height:bottom-y};

    });

  },[nodes,t]);

  const visibleEdges=edges.map((edge)=>edge.markerEnd?edge:{...edge,markerEnd:arrowMarker});



  useEffect(()=>{

    const onKeyDown=(event:KeyboardEvent)=>{if(event.key==='Escape'){setContextMenu(null);setConnectFromId(null)}};

    window.addEventListener('keydown',onKeyDown);

    return ()=>window.removeEventListener('keydown',onKeyDown);

  },[]);



  const createNode=(kind:CanvasNodeKind,position?:{x:number;y:number})=>{remember();insertNode(kind,position);setAddMenuOpen(false);onToast(`${t(nodeLabels[kind])} ${locale==='pt-BR'?'adicionado':'added'}`)};

  const onConnect=useCallback((connection:Connection)=>{remember();setEdges((current)=>addEdge({...connection,type:'smoothstep',markerEnd:arrowMarker},current));onToast(locale==='pt-BR'?'Objetos conectados':'Nodes connected')},[onToast,setEdges,nodes,edges,locale]);

  const deleteNodes=(ids:Set<string>)=>{remember();setNodes((current)=>current.filter((node)=>!ids.has(node.id)));setEdges((current)=>current.filter((edge)=>!ids.has(edge.source)&&!ids.has(edge.target)));setContextMenu(null);onToast(`${ids.size} ${locale==='pt-BR'?'objeto(s) removido(s)':'object(s) deleted'}`)};

  const openContextMenu=(event:ReactMouseEvent,node:CanvasFlowNode)=>{event.preventDefault();setNodes((current)=>current.map((item)=>({...item,selected:item.id===node.id})));setContextMenu({nodeId:node.id,x:Math.min(event.clientX,window.innerWidth-198),y:Math.min(event.clientY,window.innerHeight-190)});setAddMenuOpen(false)};

  const duplicateNode=(nodeId:string)=>{const source=nodes.find((node)=>node.id===nodeId);if(!source)return;remember();const clone:CanvasFlowNode={...source,id:`${source.id}-copy-${Date.now()}`,position:{x:source.position.x+34,y:source.position.y+34},selected:true,data:{...source.data}};setNodes((current)=>[...current.map((node)=>({...node,selected:false})),clone]);setContextMenu(null);onToast(`${source.data.label} ${locale==='pt-BR'?'duplicado':'duplicated'}`)};

  const beginConnection=(nodeId:string)=>{setConnectFromId(nodeId);setContextMenu(null);onToast('Select another node to connect')};

  const handleNodeClick=(_:ReactMouseEvent,node:CanvasFlowNode)=>{setContextMenu(null);if(!connectFromId||connectFromId===node.id)return;remember();setEdges((current)=>addEdge({id:`edge-${connectFromId}-${node.id}-${Date.now()}`,source:connectFromId,target:node.id,type:'smoothstep',markerEnd:arrowMarker},current));setConnectFromId(null);onToast(locale==='pt-BR'?'Objetos conectados':'Nodes connected')};

  const askAgent=()=>{if(!contextMenu)return;const nodeId=contextMenu.nodeId;setContextMenu(null);onAskAgent([nodeId])};

  const sendToAgent=()=>{if(!contextMenu)return;const nodeId=contextMenu.nodeId;setContextMenu(null);onSendToAgent([nodeId])};

  const groupSelected=()=>{const ids=selectedNodes.map((node)=>node.id);if(ids.length<2)return;remember();groupNodes(ids);onToast(`${ids.length} ${locale==='pt-BR'?'objetos agrupados':'nodes grouped'}`)};

  useEffect(()=>{
    const shortcuts=(event:KeyboardEvent)=>{
      if((event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable=true],[role=dialog]'))return;
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();undo();return}
      if(event.ctrlKey||event.metaKey||event.altKey)return;
      if(event.key.toLowerCase()==='n'){event.preventDefault();createNode('note')}
      if(event.key.toLowerCase()==='h')setTool('pan');
      if(event.key.toLowerCase()==='v')setTool('select');
    };
    window.addEventListener('keydown',shortcuts);return()=>window.removeEventListener('keydown',shortcuts);
  });

  const nodeFromDrag=(event:DragEvent<HTMLElement>)=>{

    const rect=layoutRef.current?.querySelector('.react-flow')?.getBoundingClientRect();

    const flowPosition=rect?{x:(event.clientX-rect.left-view.viewport.x)/view.viewport.zoom,y:(event.clientY-rect.top-view.viewport.y)/view.viewport.zoom}:undefined;

    const draggedKind=event.dataTransfer.getData('application/x-mainsagents-node') as CanvasNodeKind;

    if(Object.hasOwn(nodeLabels,draggedKind)){createNode(draggedKind,flowPosition);return}

    const raw=(event.dataTransfer.getData('text/uri-list').split('\n').find((line)=>line&&!line.startsWith('#'))??event.dataTransfer.getData('text/plain')).trim();

    if(!raw)return;

    remember();

    const position=flowPosition??undefined;

    const kind=/^https?:\/\//i.test(raw)?'browser':'note';

    const nodeId=insertNode(kind,position);

    const content:Partial<CanvasNodeData>=kind==='browser'?{browserUrl:raw.slice(0,2000)}:{text:raw.slice(0,12_000)};

    updateNodeData(currentWorkspaceId,nodeId,content);

    setAddMenuOpen(false);

    onToast(kind==='browser'?'Browser added from link':'Note added from text');

  };

  const handleDragOver=(event:DragEvent<HTMLElement>)=>{

    if(event.dataTransfer.types.includes('application/x-mainsagents-node')||event.dataTransfer.types.includes('text/uri-list')||event.dataTransfer.types.includes('text/plain')){

      if(event.target instanceof HTMLElement&&event.target.closest('.canvas-toolbar'))return;

      event.preventDefault();event.dataTransfer.dropEffect='copy';

    }

  };



  const startNodeDrag=(event:DragEvent<HTMLElement>,kind:CanvasNodeKind)=>{event.dataTransfer.setData('application/x-mainsagents-node',kind);event.dataTransfer.effectAllowed='copy'};



  return <section className="canvas-layout" data-od-id="creative-canvas" ref={layoutRef} onDragOver={handleDragOver} onDrop={(event)=>{if(event.target instanceof HTMLElement&&event.target.closest('.canvas-toolbar'))return;event.preventDefault();nodeFromDrag(event)}}>

    <div className="studio-canvas-heading"><strong>{locale==='pt-BR'?'Espaço de criação':'Creative space'}</strong><span>{locale==='pt-BR'?'Arraste para organizar. Conecte para relacionar.':'Drag to organize. Connect to relate.'}</span></div>
    <div className="canvas-toolbar"><div className="canvas-title"><Icon name="canvas"/><strong>{currentWorkspace.name} canvas</strong><span>· {nodes.length} {t(nodes.length===1?'object':'objects')}</span></div><div className="canvas-tools" role="toolbar" aria-label={t('Canvas tools')}>

      <button className="canvas-tool" data-od-id="canvas-select-tool" aria-pressed={tool==='select'} aria-label={locale==='pt-BR'?'Selecionar objetos':'Select objects'} title={locale==='pt-BR'?'Selecionar · V':'Select · V'} onClick={()=>setTool('select')}><Icon name="cursor"/></button>
      <button className="canvas-tool" data-od-id="canvas-pan-tool" aria-pressed={tool==='pan'} aria-label={locale==='pt-BR'?'Mover canvas':'Pan canvas'} title={locale==='pt-BR'?'Mover · H':'Pan · H'} onClick={()=>setTool('pan')}><Icon name="hand"/></button>
      <span className="canvas-tools-divider" aria-hidden="true"/>

      {quickTools.map((kind)=><button className={`canvas-tool canvas-tool-${kind}`} key={kind} draggable onDragStart={(event)=>startNodeDrag(event,kind)} onClick={()=>createNode(kind)} title={t(nodeLabels[kind])} aria-label={t(nodeLabels[kind])}><Icon name={nodeIcons[kind]}/><span>{t(nodeLabels[kind])}</span></button>)}

<button className="canvas-tool" onClick={()=>{setObjectsOpen(true);setAddMenuOpen(false)}} aria-label={locale==='pt-BR'?'Buscar objetos no Canvas':'Find Canvas objects'}><Icon name="search"/><span>{locale==='pt-BR'?'Objetos':'Objects'}</span></button>

      <span className="canvas-tools-divider" aria-hidden="true"/>

      <div className="canvas-add-wrap"><button className="canvas-tool canvas-add-trigger" aria-expanded={addMenuOpen} aria-haspopup="menu" onClick={()=>setAddMenuOpen((open)=>!open)}><Icon name="plus"/><span>{t('More')}</span></button>{addMenuOpen&&<div className="canvas-add-menu" role="menu"><p className="canvas-add-heading">{t('Drag a block or select one to add')}</p>{(Object.keys(nodeLabels) as CanvasNodeKind[]).map((kind)=><button key={kind} draggable onDragStart={(event)=>startNodeDrag(event,kind)} onClick={()=>createNode(kind)} role="menuitem"><Icon name={nodeIcons[kind]}/>{t(nodeLabels[kind])}<span>{t('Drag')}</span></button>)}</div>}</div>

    </div></div>

    <ReactFlow<CanvasFlowNode,Edge>

      onInit={(instance)=>{flowRef.current=instance;setFlowReady(true)}}

      nodes={nodes}

      edges={visibleEdges}

      nodeTypes={nodeTypes}

      onNodesChange={(changes)=>setNodes((current)=>applyNodeChanges(changes,current))}

      onEdgesChange={(changes)=>setEdges((current)=>applyEdgeChanges(changes,current))}

      onConnect={onConnect}

      onMoveEnd={(_,viewport)=>{const bounds=layoutRef.current?.querySelector('.react-flow')?.getBoundingClientRect();updateView(viewport,bounds?.width??view.width,bounds?.height??view.height)}}

      onNodeClick={handleNodeClick}

      onNodeDoubleClick={()=>setDetailsOpen(true)}
      onNodeDragStart={()=>remember()}
      onBeforeDelete={()=>{remember();return Promise.resolve(true)}}

      onNodeContextMenu={openContextMenu}

      onPaneClick={()=>{setAddMenuOpen(false);setContextMenu(null);setDetailsOpen(false)}}

      onNodesDelete={(deleted)=>onToast(`${deleted.length} node${deleted.length===1?'':'s'} deleted`)}

      onEdgesDelete={(deleted)=>deleted.length&&onToast(`${deleted.length} connection${deleted.length===1?'':'s'} deleted`)}

      deleteKeyCode={['Backspace','Delete']}

      fitView={!view.ready}

      {...(view.ready?{defaultViewport:view.viewport}:{})}

      fitViewOptions={{padding:.18,maxZoom:1}}

      minZoom={.2}

      maxZoom={1.7}

      selectionKeyCode={['Control','Meta']}

      panOnDrag={tool==='pan'?[0,1,2]:[1,2]}
      selectionOnDrag={tool==='select'}

      zoomOnDoubleClick={false}

      defaultEdgeOptions={{type:'smoothstep',markerEnd:arrowMarker}}

      connectionLineStyle={{stroke:'var(--muted)',strokeWidth:1.2}}

      proOptions={{hideAttribution:true}}

    >

      <ViewportPortal>{areas.map(area=><div key={area.id} className="canvas-group-area" style={{left:area.x,top:area.y,width:area.width,height:area.height}}><span>{area.label}</span></div>)}</ViewportPortal>

      <Background variant={BackgroundVariant.Dots} gap={28} size={.7} color="var(--border)"/>


    </ReactFlow>
    <div className="studio-canvas-footer"><span><i/>{currentWorkspace.name}<small>{nodes.length} {t(nodes.length===1?'object':'objects')}</small></span><div className="studio-zoom-controls"><button disabled={!undoStack.length} aria-label={locale==='pt-BR'?'Desfazer ação':'Undo action'} title="Ctrl Z" onClick={undo}><Icon name="undo"/></button><button aria-label={locale==='pt-BR'?'Reduzir zoom':'Zoom out'} onClick={()=>flowRef.current?.zoomOut({duration:reducedMotion?0:200})}>−</button><button title={locale==='pt-BR'?'Restaurar zoom 100%':'Reset zoom to 100%'} onClick={()=>flowRef.current?.zoomTo(1,{duration:reducedMotion?0:200})}>{Math.round(view.viewport.zoom*100)}%</button><button aria-label={locale==='pt-BR'?'Ampliar zoom':'Zoom in'} onClick={()=>flowRef.current?.zoomIn({duration:reducedMotion?0:200})}>+</button><button aria-label={locale==='pt-BR'?'Ajustar à tela':'Fit view'} onClick={()=>flowRef.current?.fitView({padding:.18,duration:reducedMotion?0:250})}><Icon name="panel"/></button></div></div>

    {nodes.length===0&&<div className="canvas-empty-state"><span className="first-use-mark"><Icon name="canvas"/></span><b>{t('A visual space for ideas and research')}</b><p>{t('Add a note, collect research, or turn an agent response into a Canvas object.')}</p><div><button className="soft-button" onClick={()=>createNode('note')}><Icon name="note"/>{t('Add a note')}</button><button className="soft-button" onClick={()=>createNode('chat')}><Icon name="message"/>{t('Add a chat')}</button><button className="soft-button" onClick={()=>createNode('terminal')}><Icon name="terminal"/>{t('Add a terminal')}</button></div></div>}

    <p className="canvas-usage-hint">{locale==='pt-BR'?'Arraste o fundo para mover · Ctrl + arrastar para selecionar vários · Arraste os pontos para conectar':'Drag the background to pan · Ctrl + drag to select several · Drag handles to connect'}</p>

    {detail&&<aside className="canvas-detail" aria-label={locale==='pt-BR'?'Detalhes do elemento':'Element details'}>

      <button className="icon-button" aria-label={t('Close')} onClick={()=>setDetailsOpen(false)}><Icon name="close"/></button>

      <span className="eyebrow">{t(nodeLabels[detail.type as CanvasNodeKind])}</span>

      <h3>{objectLabel(detail)}</h3>

      {detail.data.agentLabel&&<p>{detail.data.agentLabel}</p>}

      {!['terminal','browser','chat'].includes(detail.type??'')&&<>

      {detail.type!=='note'&&detail.type!=='hook'&&<label>{locale==='pt-BR'?'Título':'Title'}<input value={detail.data.title??detail.data.caption??''} onChange={event=>updateNodeData(currentWorkspaceId,detail.id,detail.type==='image'?{caption:event.target.value}:{title:event.target.value})}/></label>}

      <label>{locale==='pt-BR'?'Conteúdo':'Content'}<textarea value={String(detail.data.text??detail.data.summary??detail.data.description??detail.data.hook??detail.data.preview??detail.data.caption??'')} onChange={event=>{const field=detail.type==='research'?'summary':detail.type==='contentIdea'?'description':detail.type==='hook'?'hook':detail.type==='script'?'preview':detail.type==='image'?'caption':'text';updateNodeData(currentWorkspaceId,detail.id,{[field]:event.target.value})}}/></label>

      </>}

      {detail.data.groupId&&<label>{locale==='pt-BR'?'Área':'Area'}<input value={detail.data.groupLabel??''} onChange={event=>{const groupLabel=event.target.value;setNodes(current=>current.map(node=>node.data.groupId===detail.data.groupId?{...node,data:{...node.data,groupLabel}}:node))}}/></label>}

      <button className="soft-button" onClick={()=>onAskAgent([detail.id])}><Icon name="message"/>{t('Ask Agent')}</button>

      <button className="soft-button" onClick={()=>duplicateNode(detail.id)}><Icon name="copy"/>{t('Duplicate')}</button>

      <button className="soft-button detail-danger" onClick={()=>{deleteNodes(new Set([detail.id]));setDetailsOpen(false)}}><Icon name="trash"/>{t('Delete')}</button>

    </aside>}

    {objectsOpen&&<FlowDialog title={locale==='pt-BR'?'Objetos do Canvas':'Canvas objects'} description={locale==='pt-BR'?'Encontre um objeto e vá direto até ele.':'Find an object and jump straight to it.'} onClose={()=>setObjectsOpen(false)}><label className="search-field"><Icon name="search"/><input data-autofocus type="search" value={objectQuery} onChange={(event)=>setObjectQuery(event.target.value)} aria-label={locale==='pt-BR'?'Buscar objetos':'Search objects'} placeholder={locale==='pt-BR'?'Buscar por título ou texto…':'Search by title or text…'}/></label><div className="flow-options">{objectMatches.map((node)=><button className="flow-option" key={node.id} onClick={()=>{setNodes((current)=>current.map((item)=>({...item,selected:item.id===node.id})));void flowRef.current?.fitView({nodes:[{id:node.id}],padding:.3,maxZoom:1,duration:reducedMotion?0:220});setObjectsOpen(false)}}><span className="flow-option-icon"><Icon name={nodeIcons[node.type as CanvasNodeKind]}/></span><span><b>{objectLabel(node)}</b><small>{t(nodeLabels[node.type as CanvasNodeKind])}</small></span><Icon name="chevron"/></button>)}{!objectMatches.length&&<p className="flow-empty">{t('No results')}</p>}</div></FlowDialog>}

    {connectFromId&&<div className="connect-hint"><Icon name="link"/>{locale==='pt-BR'?'Selecione o objeto de destino':'Select a destination object'} <button onClick={()=>setConnectFromId(null)}>{t('Cancel')}</button></div>}

    {contextMenu&&<div className="context-menu canvas-context-menu" role="menu" aria-label="Node actions" style={{left:contextMenu.x,top:contextMenu.y}} onContextMenu={(event)=>event.preventDefault()}>

      <button role="menuitem" onClick={askAgent}><Icon name="message"/>{t('Ask Agent')}</button>

      <button role="menuitem" onClick={sendToAgent}><Icon name="users"/>{t('Send to Agent')}</button>

      <div className="context-separator"/>

      <button role="menuitem" onClick={()=>duplicateNode(contextMenu.nodeId)}><Icon name="copy"/>{t('Duplicate')}</button>

      <button role="menuitem" onClick={()=>beginConnection(contextMenu.nodeId)}><Icon name="link"/>{t('Connect')}</button>

      <div className="context-separator"/>

      <button role="menuitem" className="danger" onClick={()=>deleteNodes(new Set([contextMenu.nodeId]))}><Icon name="trash"/>{t('Delete')}</button>

    </div>}

    {selectedNodes.length>0&&<div className="selection-bar show"><span className="selection-label">{selectedNodes.length} {t('selected')}</span>{selectedNodes.length===1&&<button className="soft-button" aria-label={locale==='pt-BR'?'Editar objeto':'Edit object'} onClick={()=>setDetailsOpen(true)}><Icon name="edit"/>{locale==='pt-BR'?'Editar':'Edit'}</button>}<button className="soft-button" aria-label={t('Ask Agent')} onClick={()=>onAskAgent(selectedNodes.map((node)=>node.id))}><Icon name="message"/>{t('Ask Agent')}</button><button className="soft-button" aria-label={t('Send to Agent')} onClick={()=>onSendToAgent(selectedNodes.map((node)=>node.id))}><Icon name="users"/>{t('Send to Agent')}</button><button className="soft-button" aria-label={t('Group')} disabled={selectedNodes.length<2} onClick={groupSelected}><Icon name="folder"/>{t('Group')}</button></div>}

  </section>;

}

