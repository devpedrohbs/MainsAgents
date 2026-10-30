import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import { Icon } from '../common/Icon';
import { FlowDialog } from '../common/FlowDialog';
import { useCanvas } from './CanvasProvider';
import { useWorkspaces } from '../../app/WorkspaceProvider';
import { useLanguage } from '../../app/LanguageProvider';

import '../../styles/canvas-boards.css';

type BoardDialog = { kind:'create' } | { kind:'rename'|'remove'; boardId:string };

/** The migrated default space keeps its stored English name; only that one is shown translated. */
export function canvasBoardName(board:{id:string;name:string}, pt:boolean) {
  return board.id==='main'&&board.name==='Main canvas'?(pt?'Canvas principal':'Main canvas'):board.name;
}

const boardErrors:Record<string,string>={
  'A canvas space with this name already exists.':'Já existe um espaço com esse nome.',
  'Canvas space no longer exists.':'Esse espaço não existe mais.',
  'Keep at least one canvas space.':'Mantenha pelo menos um espaço no Canvas.',
  'Stop running terminals before deleting this canvas space.':'Pare os terminais em execução antes de excluir este espaço.',
  'Use a canvas space name between 1 and 80 characters.':'Use um nome de 1 a 80 caracteres.',
};
const message=(failure:unknown,pt:boolean)=>{const text=failure instanceof Error?failure.message:String(failure);return pt?boardErrors[text]??text:text};

const objects=(count:number,pt:boolean)=>`${count} ${pt?(count===1?'objeto':'objetos'):(count===1?'object':'objects')}`;

/**
 * Canvas spaces of the current workspace (e.g. News, Editing): same agents, separate graphs, viewports and context.
 * Shows where the user is (workspace › space) and lets them switch, create, rename and remove spaces.
 */
export function CanvasBoardsBar({onToast}:{onToast:(message:string)=>void}) {
  const {boards,activeBoardId,activateBoard,createBoard,renameBoard,removeBoard}=useCanvas();
  const {currentWorkspace}=useWorkspaces();
  const {locale}=useLanguage(),pt=locale==='pt-BR';
  const [open,setOpen]=useState(false);
  const [dialog,setDialog]=useState<BoardDialog|null>(null);
  const [name,setName]=useState('');
  const [error,setError]=useState('');
  const wrapRef=useRef<HTMLDivElement>(null),triggerRef=useRef<HTMLButtonElement>(null),listRef=useRef<HTMLDivElement>(null);
  const active=boards.find(board=>board.id===activeBoardId)??boards[0];
  const target=dialog&&dialog.kind!=='create'?boards.find(board=>board.id===dialog.boardId):undefined;

  useEffect(()=>{
    if(!open)return;
    listRef.current?.querySelector<HTMLElement>('[aria-checked=true]')?.focus();
    const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!wrapRef.current?.contains(event.target))setOpen(false)};
    document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);
  },[open]);

  const close=(restore=true)=>{setOpen(false);if(restore)triggerRef.current?.focus()};
  const openDialog=(next:BoardDialog)=>{
    const board=next.kind==='create'?undefined:boards.find(item=>item.id===next.boardId);
    setName(next.kind==='rename'&&board?canvasBoardName(board,pt):'');setError('');setOpen(false);setDialog(next);
  };
  const switchTo=(boardId:string)=>{
    close();if(boardId===activeBoardId)return;
    try{activateBoard(boardId)}catch(failure){onToast(message(failure,pt))}
  };
  const submit=()=>{
    if(!dialog)return;
    try{
      if(dialog.kind==='create'){const created=name.trim();createBoard(created);onToast(pt?`Espaço “${created}” criado`:`Space “${created}” created`)}
      else if(dialog.kind==='rename')renameBoard(dialog.boardId,name);
      else{removeBoard(dialog.boardId);onToast(pt?'Espaço excluído':'Space deleted')}
      setDialog(null);
    }catch(failure){setError(message(failure,pt))}
  };
  const menuKeys=(event:ReactKeyboardEvent<HTMLDivElement>)=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return}
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    event.preventDefault();
    const items=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role=menuitemradio]:not(:disabled),[role=menuitem]:not(:disabled)'));
    const index=items.indexOf(document.activeElement as HTMLElement);
    const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;
    items[next]?.focus();
  };

  if(!active)return null;
  return <div className="canvas-boards" ref={wrapRef}>
    <nav className="canvas-boards-trail" aria-label={pt?'Local do Canvas':'Canvas location'}>
      <span className="canvas-boards-workspace" title={pt?'Workspace':'Workspace'}>{currentWorkspace.name}</span>
      <Icon name="chevron"/>
      <button ref={triggerRef} className="canvas-boards-trigger" data-od-id="canvas-boards-trigger" aria-haspopup="menu" aria-expanded={open} aria-controls="canvas-boards-menu"
        aria-label={pt?`Espaço do Canvas: ${canvasBoardName(active,pt)}. Trocar espaço`:`Canvas space: ${canvasBoardName(active,pt)}. Switch space`}
        onClick={()=>setOpen(value=>!value)} onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();setOpen(true)}}}>
        <Icon name="canvas"/><strong>{canvasBoardName(active,pt)}</strong><span>{objects(active.nodeCount,pt)}</span><Icon name="chevron"/>
      </button>
    </nav>
    {open&&<div className="canvas-boards-menu" id="canvas-boards-menu" role="menu" aria-label={pt?'Espaços do Canvas':'Canvas spaces'} ref={listRef} onKeyDown={menuKeys}>
      <p className="canvas-boards-heading">{pt?'Espaços do Canvas':'Canvas spaces'}<small>{pt?`em ${currentWorkspace.name} · mesmos agentes, blocos separados`:`in ${currentWorkspace.name} · same agents, separate blocks`}</small></p>
      <div className="canvas-boards-list">{boards.map(board=><div className="canvas-boards-row" key={board.id} data-active={board.id===activeBoardId||undefined}>
        <button role="menuitemradio" aria-checked={board.id===activeBoardId} className="canvas-boards-option" onClick={()=>switchTo(board.id)}>
          <Icon name="canvas"/><span><b>{canvasBoardName(board,pt)}</b><small>{objects(board.nodeCount,pt)}</small></span>
        </button>
        <button role="menuitem" className="icon-button" aria-label={pt?`Renomear ${canvasBoardName(board,pt)}`:`Rename ${canvasBoardName(board,pt)}`} title={pt?'Renomear':'Rename'} onClick={()=>openDialog({kind:'rename',boardId:board.id})}><Icon name="edit"/></button>
        <button role="menuitem" className="icon-button" aria-label={pt?`Excluir ${canvasBoardName(board,pt)}`:`Delete ${canvasBoardName(board,pt)}`} title={boards.length<2?(pt?'O workspace precisa de pelo menos um espaço':'The workspace needs at least one space'):(pt?'Excluir':'Delete')} disabled={boards.length<2} onClick={()=>openDialog({kind:'remove',boardId:board.id})}><Icon name="trash"/></button>
      </div>)}</div>
      <button role="menuitem" className="canvas-boards-new" onClick={()=>openDialog({kind:'create'})}><Icon name="plus"/>{pt?'Novo espaço':'New space'}</button>
    </div>}

    {dialog&&dialog.kind!=='remove'&&<FlowDialog title={dialog.kind==='create'?(pt?'Novo espaço do Canvas':'New Canvas space'):(pt?'Renomear espaço':'Rename space')}
      description={dialog.kind==='create'?(pt?`Um Canvas separado dentro de ${currentWorkspace.name}, com os mesmos agentes. Ex.: Notícias, Edição.`:`A separate Canvas inside ${currentWorkspace.name}, with the same agents. E.g. News, Editing.`):undefined}
      onClose={()=>setDialog(null)}>
      <form className="canvas-boards-form" onSubmit={event=>{event.preventDefault();submit()}}>
        <label>{pt?'Nome do espaço':'Space name'}<input data-autofocus value={name} maxLength={80} onChange={event=>{setName(event.target.value);setError('')}}/></label>
        {error&&<p role="alert">{error}</p>}
        <div className="canvas-boards-actions"><button type="button" className="soft-button" onClick={()=>setDialog(null)}>{pt?'Cancelar':'Cancel'}</button><button type="submit" className="primary-button" disabled={!name.trim()}>{dialog.kind==='create'?(pt?'Criar e abrir':'Create and open'):(pt?'Salvar':'Save')}</button></div>
      </form>
    </FlowDialog>}

    {dialog?.kind==='remove'&&target&&<FlowDialog title={pt?`Excluir “${canvasBoardName(target,pt)}”?`:`Delete “${canvasBoardName(target,pt)}”?`}
      description={target.nodeCount?(pt?`${objects(target.nodeCount,pt)} deste espaço ${target.nodeCount===1?'será removido':'serão removidos'} do Canvas. Agentes, conversas e arquivos continuam salvos.`:`${objects(target.nodeCount,pt)} in this space will be removed from the Canvas. Agents, chats and files stay saved.`):(pt?'Este espaço está vazio.':'This space is empty.')}
      onClose={()=>setDialog(null)}>
      <div className="canvas-boards-form">
        {error&&<p role="alert">{error}</p>}
        <div className="canvas-boards-actions"><button className="soft-button" data-autofocus onClick={()=>setDialog(null)}>{pt?'Cancelar':'Cancel'}</button><button className="danger-button" onClick={submit}>{pt?'Excluir espaço':'Delete space'}</button></div>
      </div>
    </FlowDialog>}
  </div>;
}
