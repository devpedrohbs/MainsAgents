import type { PageId } from './types';

export interface RouteDefinition {
  id: PageId;
  label: string;
  title: string;
  sidebarPage: Exclude<PageId, 'agent-settings'>;
  breadcrumbs: string[];
}

export const routes: Record<PageId, RouteDefinition> = {
  home: {
    id: 'home',
    label: 'Home',
    title: 'Mission Control',
    sidebarPage: 'home',
    breadcrumbs: ['Content', 'Home'],
  },
  content: {
    id: 'content',
    label: 'Content Studio',
    title: 'Content Studio',
    sidebarPage: 'content',
    breadcrumbs: ['Content', 'Content Studio'],
  },
  references: {
    id: 'references',
    label: 'Editing references',
    title: 'Editing references',
    sidebarPage: 'references',
    breadcrumbs: ['Content', 'Editing references'],
  },
  board: {
    id: 'board',
    label: 'Board',
    title: 'Board',
    sidebarPage: 'board',
    breadcrumbs: ['Content', 'Board'],
  },
  canvas: {
    id: 'canvas',
    label: 'Canvas',
    title: 'Canvas',
    sidebarPage: 'canvas',
    breadcrumbs: ['Content', 'Canvas'],
  },
  flow: { id: 'flow', label: 'Flow', title: 'Flow', sidebarPage: 'flow', breadcrumbs: ['Content', 'Flow'] },
  agents: {
    id: 'agents',
    label: 'Agents',
    title: 'Agents',
    sidebarPage: 'agents',
    breadcrumbs: ['Content', 'Agents'],
  },
  'agent-settings': {
    id: 'agent-settings',
    label: 'Agent settings',
    title: 'Agent settings',
    sidebarPage: 'agents',
    breadcrumbs: ['Content', 'Agents', 'Settings'],
  },
  sessions: {
    id: 'sessions',
    label: 'History',
    title: 'History',
    sidebarPage: 'sessions',
    breadcrumbs: ['Content', 'History'],
  },
  scopes: { id: 'scopes', label: 'Scopes', title: 'Scopes', sidebarPage: 'scopes', breadcrumbs: ['Content', 'Scopes'] },
  usage: { id: 'usage', label: 'Usage', title: 'Usage', sidebarPage: 'usage', breadcrumbs: ['Content', 'Usage'] },
  settings: {
    id: 'settings',
    label: 'Settings',
    title: 'Settings',
    sidebarPage: 'settings',
    breadcrumbs: ['Content', 'Settings'],
  },
};

export const isPageId = (value: string): value is PageId => value in routes;

export function pageFromLocation(): PageId {
  const value = window.location.hash.slice(1);
  return isPageId(value) ? value : 'home';
}
