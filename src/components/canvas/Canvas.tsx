import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react';

import { addEdge, applyEdgeChanges, applyNodeChanges, Background, BackgroundVariant, MarkerType, ReactFlow, ViewportPortal, type Connection, type Edge, type NodeTypes, type ReactFlowInstance } from '@xyflow/react';

import { canvasShortcutIntent, rememberCanvasGeometry, rememberCanvasRemoval, undoCanvasEntry, type CanvasHistoryEntry } from './canvasHistory';
import { duplicateCanvasNode } from './canvasState';
import { arrangeCanvasNodes, canvasNodeSize, canvasSizes } from './canvasGeometry';

import { Icon, type IconName } from '../common/Icon';

import type { CanvasFlowNode, CanvasNodeData, CanvasNodeKind } from './canvasTypes';

import { BrowserNode, ChatNode, ContentIdeaNode, HookNode, ImageNode, NoteNode, ResearchNode, ScriptNode, TerminalNode } from './nodes/CanvasNodes';

import { useCanvas } from './CanvasProvider';

import { CanvasBoardsBar, canvasBoardName } from './CanvasBoardsBar';

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

  const {nodes,edges,setNodes,setEdges,updateGraph,view,updateView,addNode:insertNode,updateNodeData,groupNodes,focusRequest,clearFocusRequest,registerVisibleChats,boards,activeBoardId}=useCanvas();
  const boardName=canvasBoardName(boards.find(board=>board.id===activeBoardId)??{id:activeBoardId,name:'Main canvas'},locale==='pt-BR');
  const chatSessionIds=nodes.filter(node=>node.type==='chat'&&node.data.chatSessionId).map(node=>node.data.chatSessionId!);
  const visibleChatKey=JSON.stringify(chatSessionIds);
  useEffect(()=>{registerVisibleChats(JSON.parse(visibleChatKey));return()=>registerVisibleChats([])},[visibleChatKey,registerVisibleChats]);

  const flowRef=useRef<ReactFlowInstance<CanvasFlowNode,Edge>|null>(null);
  const [flowReady,setFlowReady]=useState(false);
  const focusing=useRef<string|null>(null);
  useEffect(()=>{
    if(!flowReady||!focusRequest||focusRequest.workspaceId!==currentWorkspaceId||(focusRequest.boardId&&focusRequest.boardId!==activeBoardId)||focusing.current===focusRequest.requestId)return;
    const pair=[focusRequest.source,focusRequest.target].map(chat=>nodes.find(node=>node.type==='chat'&&node.data.chatAgentId===chat.agent.id&&node.data.chatSessionId===chat.session.id));
    if(pair.some(node=>!node?.measured?.width||!node?.measured?.height))return;
    focusing.current=focusRequest.requestId;
    void flowRef.current?.fitView({nodes:pair.map(node=>({id:node!.id})),padding:.18,maxZoom:1,minZoom:.2,duration:reducedMotion?0:220}).then(()=>clearFocusRequest(focusRequest.requestId));
  },[flowReady,focusRequest,currentWorkspaceId,activeBoardId,nodes,reducedMotion,clearFocusRequest]);

  const [objectsOpen,setObjectsOpen]=useState(false);

  const [objectQuery,setObjectQuery]=useState('');

  const objectLabel=(node:CanvasFlowNode)=>node.data.title||node.data.caption||node.data.text||node.data.hook||node.data.browserUrl||node.data.label;

  const objectMatches=nodes.filter((node)=>`${objectLabel(node)} ${t(nodeLabels[node.type as CanvasNodeKind])}`.toLocaleLowerCase(locale).includes(objectQuery.trim().toLocaleLowerCase(locale)));

  const [addMenuOpen,setAddMenuOpen]=useState(false);

  const [contextMenu,setContextMenu]=useState<ContextMenuState|null>(null);

  const [connectFromId,setConnectFromId]=useState<string|null>(null);

  const layoutRef=useRef<HTMLElement>(null);

  const selectedNodes=nodes.filter((node)=>node.selected);

  const [tool,setTool]=useState<'pan'|'select'>('select');
  const [spacePressed,setSpacePressed]=useState(false);
  const resizing=useRef(false);
  const [createdNodeId,setCreatedNodeId]=useState<string|null>(null);
  const floatingRef=useRef<HTMLDivElement>(null);
  const [undoStack,setUndoStack]=useState<CanvasHistoryEntry[]>([]);
  const remember=(entry:CanvasHistoryEntry)=>setUndoStack(current=>[...current.slice(-19),entry]);
  const rememberGeometry=(items:readonly CanvasFlowNode[])=>remember(rememberCanvasGeometry(items));
  const undo=()=>{
    const entry=undoStack.at(-1);if(!entry)return;
    updateGraph(current=>undoCanvasEntry(current,entry));setUndoStack(current=>current.slice(0,-1));setDetailsOpen(false);
    onToast(locale==='pt-BR'?'A\u00e7\u00e3o desfeita':'Action undone');
  };
  const shortcutScope=(target:EventTarget|null)=>{
    const element=target instanceof Element?target:document.activeElement;
    return {
      active:element===document.body||Boolean(element&&layoutRef.current?.contains(element)),
      editing:Boolean(element?.closest('input,textarea,select,[contenteditable=true],[role=dialog],[role=listbox],[role=menu]')),
      modal:Boolean(document.querySelector('[aria-modal=true]')),
      button:Boolean(element?.closest('button,a,[role=button],[role=combobox]')),
    };
  };
  useEffect(()=>{setUndoStack([]);setDetailsOpen(false);setObjectsOpen(false);setAddMenuOpen(false);setContextMenu(null);setConnectFromId(null);setSpacePressed(false);setCreatedNodeId(null);setObjectQuery('');resizing.current=false},[currentWorkspaceId,activeBoardId]);

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

    const onKeyDown=(event:KeyboardEvent)=>{if(event.key==='Escape'){setContextMenu(null);setConnectFromId(null);setAddMenuOpen(false);setObjectsOpen(false);setDetailsOpen(false)}};

    window.addEventListener('keydown',onKeyDown);

    return ()=>window.removeEventListener('keydown',onKeyDown);

  },[]);



  const createNode=(kind:CanvasNodeKind,position?:{x:number;y:number})=>{
    const id=insertNode(kind,position);remember({kind:'create',nodeIds:[id]});setCreatedNodeId(id);setDetailsOpen(false);setObjectsOpen(false);setAddMenuOpen(false);
    onToast(`${t(nodeLabels[kind])} ${locale==='pt-BR'?'adicionado':'added'}`);
  };

  const connectNodes=(connection:Connection)=>{
    if(!connection.source||!connection.target||connection.source===connection.target)return;
    if(edges.some(edge=>edge.source===connection.source&&edge.target===connection.target&&(edge.sourceHandle??null)===(connection.sourceHandle??null)&&(edge.targetHandle??null)===(connection.targetHandle??null))){onToast(locale==='pt-BR'?'Estes objetos j\u00e1 est\u00e3o conectados':'These objects are already connected');return}
    const id=`edge-${crypto.randomUUID()}`;
    remember({kind:'connect',edgeIds:[id]});
    setEdges(current=>addEdge({...connection,id,type:'smoothstep',markerEnd:arrowMarker},current));
    onToast(locale==='pt-BR'?'Objetos conectados':'Nodes connected');
  };

  const onConnect=useCallback((connection:Connection)=>connectNodes(connection),[onToast,setEdges,edges,locale]);

  const deleteNodes=(ids:Set<string>)=>{
    remember(rememberCanvasRemoval({nodes,edges},[...ids]));
    setNodes(current=>current.filter(node=>!ids.has(node.id)));setContextMenu(null);setDetailsOpen(false);setConnectFromId(current=>current&&ids.has(current)?null:current);
    onToast(`${ids.size} ${locale==='pt-BR'?'objeto(s) removido(s)':'object(s) deleted'}`);
  };

  const openContextMenu=(event:ReactMouseEvent,node:CanvasFlowNode)=>{event.preventDefault();setNodes((current)=>current.map((item)=>({...item,selected:item.id===node.id})));setContextMenu({nodeId:node.id,x:Math.min(event.clientX,window.innerWidth-198),y:Math.min(event.clientY,window.innerHeight-190)});setAddMenuOpen(false)};

  const duplicateNode=(nodeId:string)=>{
    const source=nodes.find(node=>node.id===nodeId);if(!source)return;
    const clone=duplicateCanvasNode(source,`node-${source.type}-${crypto.randomUUID()}`);
    setNodes(current=>[...current.map(node=>({...node,selected:false})),clone]);remember({kind:'create',nodeIds:[clone.id]});setCreatedNodeId(clone.id);setContextMenu(null);
    onToast(source.type==='chat'?(locale==='pt-BR'?'Novo chat criado. Escolha um agente para iniciar outra conversa.':'New chat created. Choose an agent to start a separate conversation.'):`${source.data.label} ${locale==='pt-BR'?'duplicado':'duplicated'}`);
  };

  const beginConnection=(nodeId:string)=>{setConnectFromId(nodeId);setContextMenu(null);onToast('Select another node to connect')};

  const handleNodeClick=(_:ReactMouseEvent,node:CanvasFlowNode)=>{setContextMenu(null);if(!connectFromId||connectFromId===node.id)return;connectNodes({source:connectFromId,target:node.id,sourceHandle:null,targetHandle:null});setConnectFromId(null)};

  const askAgent=()=>{if(!contextMenu)return;const nodeId=contextMenu.nodeId;setContextMenu(null);onAskAgent([nodeId])};

  const sendToAgent=()=>{if(!contextMenu)return;const nodeId=contextMenu.nodeId;setContextMenu(null);onSendToAgent([nodeId])};

  const groupSelected=()=>{const ids=selectedNodes.map((node)=>node.id);if(ids.length<2)return;remember({kind:'group',nodes:selectedNodes.map(node=>({id:node.id,groupId:node.data.groupId,groupLabel:node.data.groupLabel}))});groupNodes(ids);onToast(`${ids.length} ${locale==='pt-BR'?'objetos agrupados':'nodes grouped'}`)};

  useEffect(()=>{
    const shortcuts=(event:KeyboardEvent)=>{
      const intent=canvasShortcutIntent(event,shortcutScope(event.target));
      if(!intent)return;
      if(intent==='pan'){event.preventDefault();setSpacePressed(true);return}
      if(intent==='undo'){if(!resizing.current){event.preventDefault();undo()}return}
      if(intent==='note'){event.preventDefault();createNode('note')}
      if(intent==='hand')setTool('pan');
      if(intent==='select')setTool('select');
    };
    window.addEventListener('keydown',shortcuts);return()=>window.removeEventListener('keydown',shortcuts);
  });

  useEffect(()=>{
    const release=()=>setSpacePressed(false);
    const keyup=(event:KeyboardEvent)=>{if(event.code==='Space')release()};
    window.addEventListener('keyup',keyup);window.addEventListener('blur',release);
    return()=>{window.removeEventListener('keyup',keyup);window.removeEventListener('blur',release)};
  },[]);

  useEffect(()=>{
    if(!flowReady)return;
    const surface=layoutRef.current?.querySelector('.react-flow');if(!surface)return;
    const observer=new ResizeObserver(()=>{const rect=surface.getBoundingClientRect();updateView(flowRef.current!.getViewport(),rect.width,rect.height)});
    observer.observe(surface);return()=>observer.disconnect();
  },[flowReady,updateView,currentWorkspaceId,activeBoardId]);

  useEffect(()=>{
    const node=nodes.find(item=>item.id===createdNodeId);
    if(!node?.measured?.width||!node.measured.height||!flowRef.current)return;
    const {x,y,zoom}=flowRef.current.getViewport(),size=canvasNodeSize(node);
    const left=node.position.x*zoom+x,top=node.position.y*zoom+y;
    if(left<24||top<72||left+size.width*zoom>view.width-24||top+size.height*zoom>view.height-90){
      void flowRef.current.fitView({nodes:[{id:node.id}],padding:.25,maxZoom:Math.min(zoom,1),duration:reducedMotion?0:180});
    }
    setCreatedNodeId(null);
  },[nodes,createdNodeId,view.width,view.height,reducedMotion]);

  useEffect(()=>{
    if(!addMenuOpen&&!objectsOpen&&!contextMenu)return;
    const outside=(event:PointerEvent)=>{if(!(event.target instanceof Element))return;if(event.target.closest('.canvas-add-wrap,.canvas-objects-wrap,.canvas-context-menu'))return;setAddMenuOpen(false);setObjectsOpen(false);setContextMenu(null)};
    document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);
  },[addMenuOpen,objectsOpen,contextMenu]);

  useEffect(()=>{
    if(objectsOpen)floatingRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    else if(addMenuOpen)floatingRef.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus();
  },[objectsOpen,addMenuOpen]);

  const arrangeSelection=(mode:'left'|'top'|'grid')=>{rememberGeometry(selectedNodes);setNodes(current=>arrangeCanvasNodes(current,new Set(selectedNodes.map(node=>node.id)),mode))};
  const resizeDetail=(axis:'width'|'height',value:number)=>{
    if(!detail||!Number.isFinite(value))return;
    const limits=canvasSizes[detail.type??'note'];rememberGeometry([detail]);
    setNodes(current=>current.map(node=>node.id===detail.id?{...node,[axis]:Math.max(limits[axis==='width'?'minWidth':'minHeight'],Math.min(4000,value)),style:{...node.style,[axis]:undefined}}:node));
  };

  const nodeFromDrag=(event:DragEvent<HTMLElement>)=>{

    const rect=layoutRef.current?.querySelector('.react-flow')?.getBoundingClientRect();

    const flowPosition=rect?{x:(event.clientX-rect.left-view.viewport.x)/view.viewport.zoom,y:(event.clientY-rect.top-view.viewport.y)/view.viewport.zoom}:undefined;

    const draggedKind=event.dataTransfer.getData('application/x-mainsagents-node') as CanvasNodeKind;

    if(Object.hasOwn(nodeLabels,draggedKind)){createNode(draggedKind,flowPosition);return}

    const raw=(event.dataTransfer.getData('text/uri-list').split('\n').find((line)=>line&&!line.startsWith('#'))??event.dataTransfer.getData('text/plain')).trim();

    if(!raw)return;

    const position=flowPosition??undefined;

    const kind=/^https?:\/\//i.test(raw)?'browser':'note';

    const nodeId=insertNode(kind,position);
    remember({kind:'create',nodeIds:[nodeId]});setCreatedNodeId(nodeId);

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



  return <section className={`canvas-layout ${spacePressed||tool==='pan'?'canvas-space-pan':''}`} data-od-id="creative-canvas" ref={layoutRef} onDragOver={handleDragOver} onDrop={(event)=>{if(event.target instanceof HTMLElement&&event.target.closest('.canvas-toolbar'))return;event.preventDefault();nodeFromDrag(event)}}>

    <CanvasBoardsBar onToast={onToast}/>
    <div className="canvas-toolbar"><div className="canvas-tools" role="toolbar" aria-label={t('Canvas tools')}>

      <button className="canvas-tool" data-od-id="canvas-select-tool" aria-pressed={tool==='select'} aria-label={locale==='pt-BR'?'Selecionar objetos':'Select objects'} title={locale==='pt-BR'?'Selecionar · V':'Select · V'} onClick={()=>setTool('select')}><Icon name="cursor"/></button>
      <button className="canvas-tool" data-od-id="canvas-pan-tool" aria-pressed={tool==='pan'} aria-label={locale==='pt-BR'?'Mover canvas':'Pan canvas'} title={locale==='pt-BR'?'Mover · H':'Pan · H'} onClick={()=>setTool('pan')}><Icon name="hand"/></button>
      <span className="canvas-tools-divider" aria-hidden="true"/>

      {quickTools.map((kind)=><button className={`canvas-tool canvas-tool-${kind}`} key={kind} draggable onDragStart={(event)=>startNodeDrag(event,kind)} onClick={()=>createNode(kind)} title={t(nodeLabels[kind])} aria-label={t(nodeLabels[kind])}><Icon name={nodeIcons[kind]}/><span>{t(nodeLabels[kind])}</span></button>)}

<div className="canvas-objects-wrap"><button className="canvas-tool" aria-expanded={objectsOpen} aria-controls="canvas-object-list" onClick={()=>{setObjectsOpen(open=>!open);setAddMenuOpen(false)}} aria-label={locale==='pt-BR'?'Buscar objetos no Canvas':'Find Canvas objects'}><Icon name="search"/><span>{locale==='pt-BR'?'Objetos':'Objects'}</span></button>{objectsOpen&&<div className="canvas-objects-popover" ref={floatingRef} id="canvas-object-list" role="region" aria-label={locale==='pt-BR'?'Objetos do Canvas':'Canvas objects'}><label className="search-field"><Icon name="search"/><input type="search" value={objectQuery} onChange={event=>setObjectQuery(event.target.value)} aria-label={locale==='pt-BR'?'Buscar objetos':'Search objects'} placeholder={locale==='pt-BR'?'Buscar objetos…':'Search objects…'}/></label><div className="canvas-object-results">{objectMatches.map(node=><button key={node.id} className="canvas-object-result" onClick={()=>{setNodes(current=>current.map(item=>({...item,selected:item.id===node.id})));void flowRef.current?.fitView({nodes:[{id:node.id}],padding:.3,maxZoom:1,duration:reducedMotion?0:220});setObjectsOpen(false)}}><Icon name={nodeIcons[node.type as CanvasNodeKind]}/><span><b>{objectLabel(node)}</b><small>{t(nodeLabels[node.type as CanvasNodeKind])}</small></span></button>)}{!objectMatches.length&&<p className="flow-empty">{t('No results')}</p>}</div></div>}</div>

      <span className="canvas-tools-divider" aria-hidden="true"/>

      <div className="canvas-add-wrap"><button className="canvas-tool canvas-add-trigger" aria-expanded={addMenuOpen} aria-haspopup="menu" onClick={()=>{setAddMenuOpen(open=>!open);setObjectsOpen(false)}}><Icon name="plus"/><span>{t('More')}</span></button>{addMenuOpen&&<div className="canvas-add-menu" role="menu" ref={floatingRef} onKeyDown={event=>{if(event.key!=='ArrowDown'&&event.key!=='ArrowUp')return;event.preventDefault();const items=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=menuitem]'));const index=items.indexOf(document.activeElement as HTMLButtonElement);items[(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus()}}><p className="canvas-add-heading">{t('Drag a block or select one to add')}</p>{(Object.keys(nodeLabels) as CanvasNodeKind[]).map((kind)=><button key={kind} draggable onDragStart={(event)=>startNodeDrag(event,kind)} onClick={()=>createNode(kind)} role="menuitem"><Icon name={nodeIcons[kind]}/>{t(nodeLabels[kind])}<span>{t('Drag')}</span></button>)}</div>}</div>

    </div></div>

    <ReactFlow<CanvasFlowNode,Edge>

      onInit={(instance)=>{flowRef.current=instance;setFlowReady(true)}}

      key={`${currentWorkspaceId}:${activeBoardId}`}
      nodes={nodes.map(node=>({...node,dragHandle:'.canvas-node-drag-handle'}))}

      edges={visibleEdges}

      nodeTypes={nodeTypes}

      onNodesChange={changes=>{if(changes.some(change=>change.type==='dimensions'&&change.resizing===true)&&!resizing.current){const ids=new Set(changes.flatMap(change=>change.type==='dimensions'&&change.resizing===true?[change.id]:[]));rememberGeometry(nodes.filter(node=>ids.has(node.id)));resizing.current=true}if(changes.some(change=>change.type==='dimensions'&&change.resizing===false))resizing.current=false;setNodes(current=>applyNodeChanges(changes,current))}}

      onEdgesChange={(changes)=>setEdges((current)=>applyEdgeChanges(changes,current))}

      onConnect={onConnect}

      onMoveEnd={(_,viewport)=>{const bounds=layoutRef.current?.querySelector('.react-flow')?.getBoundingClientRect();updateView(viewport,bounds?.width??view.width,bounds?.height??view.height)}}

      onNodeClick={handleNodeClick}

      onNodeDoubleClick={(event)=>{if((event.target as Element).closest('.canvas-node-drag-handle')&&!(event.target as Element).closest('button,a,input,textarea'))setDetailsOpen(open=>!open)}}
      onNodeDragStart={(_,node,dragged)=>rememberGeometry(dragged.length?dragged:[node])}
      onBeforeDelete={({nodes:deletedNodes,edges:deletedEdges})=>{if(!deletedNodes.length&&!deletedEdges.length)return Promise.resolve(false);const scope=shortcutScope(document.activeElement);if(!scope.active||scope.editing||scope.modal)return Promise.resolve(false);remember(rememberCanvasRemoval({nodes,edges},deletedNodes.map(node=>node.id),deletedEdges.map(edge=>edge.id)));return Promise.resolve(true)}}

      onNodeContextMenu={openContextMenu}

      onPaneClick={()=>{setAddMenuOpen(false);setContextMenu(null);setDetailsOpen(false)}}

      onDelete={({nodes:deletedNodes,edges:deletedEdges})=>{setDetailsOpen(false);setContextMenu(null);setConnectFromId(null);onToast(deletedNodes.length?`${deletedNodes.length} ${locale==='pt-BR'?'objeto(s) removido(s)':'object(s) deleted'}`:`${deletedEdges.length} ${locale==='pt-BR'?'conex\u00e3o(\u00f5es) removida(s)':'connection(s) deleted'}`)}}

      deleteKeyCode={['Backspace','Delete']}

      fitView={!view.ready}

      {...(view.ready?{defaultViewport:view.viewport}:{})}

      fitViewOptions={{padding:.18,maxZoom:1}}

      minZoom={.2}

      maxZoom={1.7}

      selectionKeyCode={['Control','Meta']}

      panOnDrag={tool==='pan'||spacePressed?[0,1]:[1]}
      nodesDraggable={tool!=='pan'&&!spacePressed}
      nodesConnectable={tool!=='pan'&&!spacePressed}
      panActivationKeyCode="Space"
      selectionOnDrag={tool==='select'&&!spacePressed}

      zoomOnDoubleClick={false}

      defaultEdgeOptions={{type:'smoothstep',markerEnd:arrowMarker}}

      connectionLineStyle={{stroke:'var(--muted)',strokeWidth:1.2}}

      proOptions={{hideAttribution:true}}

    >

      <ViewportPortal>{areas.map(area=><div key={area.id} className="canvas-group-area" style={{left:area.x,top:area.y,width:area.width,height:area.height}}><span>{area.label}</span></div>)}</ViewportPortal>

      <Background variant={BackgroundVariant.Dots} gap={28} size={.7} color="var(--border)"/>


    </ReactFlow>
    <div className="studio-canvas-footer"><span><i/>{currentWorkspace.name} · {boardName}<small>{nodes.length} {t(nodes.length===1?'object':'objects')}</small></span><div className="studio-zoom-controls"><button disabled={!undoStack.length} aria-label={locale==='pt-BR'?'Desfazer ação':'Undo action'} title="Ctrl Z" onClick={undo}><Icon name="undo"/></button><button aria-label={locale==='pt-BR'?'Reduzir zoom':'Zoom out'} onClick={()=>flowRef.current?.zoomOut({duration:reducedMotion?0:200})}>−</button><button title={locale==='pt-BR'?'Restaurar zoom 100%':'Reset zoom to 100%'} onClick={()=>flowRef.current?.zoomTo(1,{duration:reducedMotion?0:200})}>{Math.round(view.viewport.zoom*100)}%</button><button aria-label={locale==='pt-BR'?'Ampliar zoom':'Zoom in'} onClick={()=>flowRef.current?.zoomIn({duration:reducedMotion?0:200})}>+</button><button aria-label={locale==='pt-BR'?'Ajustar à tela':'Fit view'} onClick={()=>flowRef.current?.fitView({padding:.18,duration:reducedMotion?0:250})}><Icon name="panel"/></button></div></div>

    {nodes.length===0&&<div className="canvas-empty-state"><span className="first-use-mark"><Icon name="canvas"/></span><b>{t('A visual space for ideas and research')}</b><p>{t('Add a note, collect research, or turn an agent response into a Canvas object.')}</p><div><button className="soft-button" onClick={()=>createNode('note')}><Icon name="note"/>{t('Add a note')}</button><button className="soft-button" onClick={()=>createNode('chat')}><Icon name="message"/>{t('Add a chat')}</button><button className="soft-button" onClick={()=>createNode('terminal')}><Icon name="terminal"/>{t('Add a terminal')}</button></div></div>}

    <p className="canvas-usage-hint">{locale==='pt-BR'?'V selecionar · Espaço + arrastar para mover · Arraste os cantos para redimensionar':'V select · Space + drag to pan · Drag corners to resize'}</p>

    {detail&&<aside className="canvas-detail" aria-label={locale==='pt-BR'?'Detalhes do elemento':'Element details'}>

      <button className="icon-button" aria-label={t('Close')} onClick={()=>setDetailsOpen(false)}><Icon name="close"/></button>

      <span className="eyebrow">{t(nodeLabels[detail.type as CanvasNodeKind])}</span>

      <h3>{t(nodeLabels[detail.type as CanvasNodeKind])}</h3>

      {detail.data.agentLabel&&<p>{detail.data.agentLabel}</p>}

      {!['terminal','browser','chat'].includes(detail.type??'')&&<>

      {detail.type!=='note'&&detail.type!=='hook'&&<label>{locale==='pt-BR'?'Título':'Title'}<input value={detail.data.title??detail.data.caption??''} onChange={event=>updateNodeData(currentWorkspaceId,detail.id,detail.type==='image'?{caption:event.target.value}:{title:event.target.value})}/></label>}

      <label>{locale==='pt-BR'?'Conteúdo':'Content'}<textarea value={String(detail.data.text??detail.data.summary??detail.data.description??detail.data.hook??detail.data.preview??detail.data.caption??'')} onChange={event=>{const field=detail.type==='research'?'summary':detail.type==='contentIdea'?'description':detail.type==='hook'?'hook':detail.type==='script'?'preview':detail.type==='image'?'caption':'text';updateNodeData(currentWorkspaceId,detail.id,{[field]:event.target.value})}}/></label>

      </>}

      <div className="canvas-size-fields">{(['width','height'] as const).map(axis=><label key={axis}>{locale==='pt-BR'?(axis==='width'?'Largura':'Altura'):(axis==='width'?'Width':'Height')}<input key={`${detail.id}-${canvasNodeSize(detail)[axis]}`} type="number" min={canvasSizes[detail.type??'note'][axis==='width'?'minWidth':'minHeight']} max={4000} step={10} defaultValue={Math.round(canvasNodeSize(detail)[axis])} onBlur={event=>{if(event.target.value&&Number(event.target.value)!==Math.round(canvasNodeSize(detail)[axis]))resizeDetail(axis,Number(event.target.value))}} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur()}}/></label>)}</div>

      {detail.data.groupId&&<label>{locale==='pt-BR'?'Área':'Area'}<input value={detail.data.groupLabel??''} onChange={event=>{const groupLabel=event.target.value;setNodes(current=>current.map(node=>node.data.groupId===detail.data.groupId?{...node,data:{...node.data,groupLabel}}:node))}}/></label>}

      <button className="soft-button" onClick={()=>onAskAgent([detail.id])}><Icon name="message"/>{t('Ask Agent')}</button>

      <button className="soft-button" onClick={()=>duplicateNode(detail.id)}><Icon name="copy"/>{t('Duplicate')}</button>

      <button className="soft-button detail-danger" onClick={()=>{deleteNodes(new Set([detail.id]));setDetailsOpen(false)}}><Icon name="trash"/>{t('Delete')}</button>

    </aside>}



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

    {selectedNodes.length>0&&<div className="selection-bar show" role="toolbar" aria-label={locale==='pt-BR'?'Ações da seleção':'Selection actions'}><span className="selection-label">{selectedNodes.length} {t('selected')}</span>{selectedNodes.length===1&&<span className="canvas-size-readout">{Math.round(canvasNodeSize(selectedNodes[0]).width)} × {Math.round(canvasNodeSize(selectedNodes[0]).height)}</span>}{selectedNodes.length>1&&<><button className="soft-button" onClick={()=>arrangeSelection('left')}>{locale==='pt-BR'?'Alinhar à esquerda':'Align left'}</button><button className="soft-button" onClick={()=>arrangeSelection('grid')}>{locale==='pt-BR'?'Organizar':'Tidy'}</button></>}{selectedNodes.length===1&&<button className="soft-button" aria-label={locale==='pt-BR'?'Editar objeto':'Edit object'} onClick={()=>setDetailsOpen(true)}><Icon name="edit"/>{locale==='pt-BR'?'Editar':'Edit'}</button>}<button className="soft-button" aria-label={t('Ask Agent')} onClick={()=>onAskAgent(selectedNodes.map((node)=>node.id))}><Icon name="message"/>{t('Ask Agent')}</button><button className="soft-button" aria-label={t('Send to Agent')} onClick={()=>onSendToAgent(selectedNodes.map((node)=>node.id))}><Icon name="users"/>{t('Send to Agent')}</button><button className="soft-button" aria-label={t('Group')} disabled={selectedNodes.length<2} onClick={groupSelected}><Icon name="folder"/>{t('Group')}</button><button className="icon-button" aria-label={locale==='pt-BR'?'Limpar seleção':'Clear selection'} onClick={()=>{setNodes(current=>current.map(node=>({...node,selected:false})));setEdges(current=>current.map(edge=>({...edge,selected:false})));}}><Icon name="close"/></button></div>}

  </section>;

}

