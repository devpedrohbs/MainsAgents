import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useWorkspaces } from '../../app/WorkspaceProvider';
import { Icon } from '../common/Icon';
import { useLanguage } from '../../app/LanguageProvider';

export function WorkspaceSwitcher() {
  const { workspaces, currentWorkspace, setCurrentWorkspaceId, createWorkspace, renameWorkspace } = useWorkspaces();
  const {t}=useLanguage();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'create' | 'rename' | null>(null);
  const [value, setValue] = useState('');
  const [renameId, setRenameId] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) { setOpen(false); setMode(null); } };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  const beginRename = (workspaceId: string, name: string) => { setMode('rename'); setRenameId(workspaceId); setValue(name); };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim()) return;
    if (mode === 'create') createWorkspace(value);
    if (mode === 'rename') renameWorkspace(renameId, value);
    setMode(null);
    setValue('');
  };

  return <div className="workspace-switcher-wrap" ref={rootRef}>
    <button className="workspace-switcher" aria-expanded={open} onClick={() => setOpen((current) => !current)}><Icon name="folder"/><span>{currentWorkspace.name}</span><span className="chevron">⌄</span></button>
    {open && <div className="workspace-menu">
      <div className="workspace-menu-head"><span>{t('Workspaces')}</span><small>{workspaces.length}</small></div>
      <div className="workspace-options">{workspaces.map((workspace) => <div className={`workspace-option-row ${workspace.id === currentWorkspace.id ? 'active' : ''}`} key={workspace.id}>
        <button className="workspace-option" onClick={() => { setCurrentWorkspaceId(workspace.id); setOpen(false); setMode(null); }}><i/>{workspace.name}</button>
        <button className="workspace-rename" aria-label={`${t('Rename')} ${workspace.name}`} onClick={() => beginRename(workspace.id, workspace.name)}>{t('Rename')}</button>
      </div>)}</div>
      {mode ? <form className="workspace-form" onSubmit={submit}><input autoFocus value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setMode(null); }} aria-label={mode === 'create' ? 'Workspace name' : 'New workspace name'}/><button type="submit">{t('Save')}</button></form> : <button className="workspace-create" onClick={() => { setMode('create'); setValue(''); }}><Icon name="plus"/>{t('New workspace')}</button>}
    </div>}
  </div>;
}
