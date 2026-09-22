import { createContext, useContext, useMemo, type PropsWithChildren } from 'react';
import { usePersistentState } from '../data/localPersistence';

export interface Workspace {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface WorkspaceContextValue {
  workspaces: readonly Workspace[];
  currentWorkspaceId: string;
  currentWorkspace: Workspace;
  setCurrentWorkspaceId: (workspaceId: string) => void;
  createWorkspace: (name: string) => Workspace;
  renameWorkspace: (workspaceId: string, name: string) => void;
  getWorkspaceById: (workspaceId: string) => Workspace | undefined;
}

const now = new Date().toISOString();
const initialWorkspaces: Workspace[] = [
  { id: 'my-workspace', name: 'My Workspace', createdAt: now, updatedAt: now },
];

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function toSlug(name: string): string {
  return name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace';
}

export function WorkspaceProvider({ children }: PropsWithChildren) {
  const [workspaces, setWorkspaces] = usePersistentState<Workspace[]>('workspaces', initialWorkspaces);
  const [currentWorkspaceId, setCurrentId] = usePersistentState('current-workspace', 'my-workspace');
  const currentWorkspace = workspaces.find((workspace) => workspace.id === currentWorkspaceId) ?? workspaces[0];

  const value = useMemo<WorkspaceContextValue>(() => ({
    workspaces,
    currentWorkspaceId: currentWorkspace.id,
    currentWorkspace,
    setCurrentWorkspaceId: (workspaceId) => {
      if (workspaces.some((workspace) => workspace.id === workspaceId)) setCurrentId(workspaceId);
    },
    createWorkspace: (name) => {
      const cleanName = name.trim();
      const base = toSlug(cleanName);
      let id = base;
      let suffix = 2;
      while (workspaces.some((workspace) => workspace.id === id)) id = `${base}-${suffix++}`;
      const timestamp = new Date().toISOString();
      const workspace = { id, name: cleanName, createdAt: timestamp, updatedAt: timestamp };
      setWorkspaces((current) => [...current, workspace]);
      setCurrentId(id);
      return workspace;
    },
    renameWorkspace: (workspaceId, name) => {
      const cleanName = name.trim();
      if (!cleanName) return;
      setWorkspaces((current) => current.map((workspace) => workspace.id === workspaceId ? { ...workspace, name: cleanName, updatedAt: new Date().toISOString() } : workspace));
    },
    getWorkspaceById: (workspaceId) => workspaces.find((workspace) => workspace.id === workspaceId),
  }), [currentWorkspace, workspaces]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspaces(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('useWorkspaces must be used inside WorkspaceProvider');
  return context;
}
