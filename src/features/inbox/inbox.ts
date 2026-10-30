import type { Task } from '../../app/types';
import type { Agent } from '../agents/model/Agent';
import type { AgentSession } from '../chat/model/Chat';
import type { ChatInboxItem } from '../chat/chatInbox';
import { editorialInbox, type EditorialInboxItem } from '../content/editorialInbox';
import type { EditorialJob, EditorialState } from '../content/model';
import { editorialInboxLabel } from '../../components/content/EditorialInbox';
import type { RunState } from '../../components/common/StatusIcon';
import type { ExecutionOverviewItem, ExecutionState } from '../../components/production/ExecutionOverviewProjection';

export type InboxTone = 'blocked' | 'approval' | 'review' | 'reply' | 'next';
/** One thing that waits on the user, whatever produced it (editorial record, chat turn or board task). */
export interface InboxItem {
  id: string; tone: InboxTone; source: 'editorial' | 'chat' | 'task';
  title: string; context: string; body?: string; at: string; agent?: Agent;
  icon: 'script' | 'note' | 'history' | 'message' | 'board'; action: string; open: () => void;
  data: Record<string, string>; contentId?: string;
}
export const inboxToneState: Record<InboxTone, RunState> = { blocked: 'failed', approval: 'waiting', review: 'waiting', reply: 'paused', next: 'queued' };
export const inboxToneRank: Record<InboxTone, number> = { blocked: 0, approval: 1, review: 2, reply: 3, next: 4 };
export const inboxToneLabel = (tone: InboxTone, pt: boolean) => (pt
  ? { blocked: 'Bloqueado', approval: 'Autorização', review: 'Revisão', reply: 'Resposta', next: 'Próximo passo' }
  : { blocked: 'Blocked', approval: 'Approval', review: 'Review', reply: 'Reply', next: 'Next step' })[tone];

interface InboxInput {
  state: EditorialState; jobs: readonly EditorialJob[]; workspaceId: string; chatInbox: readonly ChatInboxItem[]; tasks: readonly Task[];
  sessions: readonly AgentSession[]; getAgentById: (id: string) => Agent | undefined; pt: boolean;
  onOpenEditorial: (item: EditorialInboxItem) => void; onOpenChat: (item: ChatInboxItem) => void; onOpenTask: (task: Task) => void;
}

/** Everything waiting on the user, ordered by what blocks the most work, then newest first. */
export function inboxItems({ state, jobs, workspaceId, chatInbox, tasks, sessions, getAgentById, pt, onOpenEditorial, onOpenChat, onOpenTask }: InboxInput): InboxItem[] {
  // The agent that worked on a content most recently (editorial items carry no agent of their own).
  const agentForContent = (contentId?: string) => {
    if (!contentId) return undefined;
    const session = sessions.filter((item) => item.contentId === contentId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).find((item) => getAgentById(item.agentId)?.workspaceId === workspaceId);
    return session ? getAgentById(session.agentId) : undefined;
  };
  return [
    ...editorialInbox(state, jobs, workspaceId).map((item): InboxItem => ({
      id: 'editorial:' + item.id, source: 'editorial',
      tone: item.urgency === 'blocked' ? 'blocked' : item.urgency === 'review' ? 'review' : 'next',
      title: editorialInboxLabel(item.kind, pt) + (item.artifactVersion ? ` · v${item.artifactVersion}` : ''),
      context: item.title, body: item.detail, at: item.updatedAt, agent: agentForContent(item.contentId), contentId: item.contentId,
      icon: item.urgency === 'blocked' ? 'history' : item.kind.includes('script') ? 'script' : 'note',
      action: item.urgency === 'blocked' ? (pt ? 'Retomar' : 'Resume') : item.urgency === 'review' ? (pt ? 'Revisar' : 'Review') : (pt ? 'Continuar' : 'Continue'),
      open: () => onOpenEditorial(item), data: { 'data-inbox-id': item.id },
    })),
    ...chatInbox.map((item): InboxItem => ({
      id: 'chat:' + item.id, source: 'chat',
      tone: item.kind === 'approval' ? 'approval' : item.kind === 'blocked' ? 'blocked' : 'reply',
      title: item.detail.split('\n')[0] || item.title, context: item.title, body: item.detail,
      at: item.at, agent: getAgentById(item.agentId), icon: 'message',
      action: item.kind === 'approval' ? (pt ? 'Autorizar' : 'Approve') : item.kind === 'blocked' ? (pt ? 'Verificar' : 'Check') : (pt ? 'Abrir' : 'Open'),
      open: () => onOpenChat(item), data: { 'data-chat-inbox-id': item.id },
    })),
    ...tasks.filter((task) => task.status === 'review').map((task): InboxItem => ({
      id: 'task:' + task.id, source: 'task', tone: 'review', title: task.title, context: pt ? 'Tarefa' : 'Task', body: task.description, at: task.createdAt,
      agent: getAgentById(task.agentId), icon: 'board', action: pt ? 'Revisar' : 'Review', contentId: task.contentId,
      open: () => onOpenTask(task), data: { 'data-od-id': 'overview-task-' + task.id },
    })),
  ].sort((a, b) => inboxToneRank[a.tone] - inboxToneRank[b.tone] || b.at.localeCompare(a.at));
}

/** Archive and snooze are local view choices keyed by item and its last change, so a new event shows again. */
export interface InboxDismissals { [key: string]: { archivedAt?: string; snoozedUntil?: string } }
export const inboxDismissKey = (item: Pick<InboxItem, 'id' | 'at'>) => `${item.id}@${item.at}`;
export function visibleInbox(items: readonly InboxItem[], dismissed: InboxDismissals, now = Date.now()) {
  return items.filter((item) => {
    const entry = dismissed[inboxDismissKey(item)];
    return !entry || (!entry.archivedAt && !(entry.snoozedUntil && Date.parse(entry.snoozedUntil) > now));
  });
}

export const executionRunState: Record<ExecutionState, RunState> = { active: 'running', waiting: 'waiting', paused: 'paused', blocked: 'failed', complete: 'done', canceled: 'queued', unknown: 'queued' };
/** Short, stable label for a production id (ids are UUID-like and too long for a column). */
export const runLabel = (id: string) => 'RUN-' + id.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase();
export const isOpenExecution = (item: ExecutionOverviewItem) => !['complete', 'canceled'].includes(item.state);

/** Relative time in the V2 tables: "8 min", "2 h", "ontem", then a short date. */
export function shortAgo(at: string | undefined, locale: string, now = Date.now()) {
  const time = at ? Date.parse(at) : NaN;
  if (!Number.isFinite(time)) return '—';
  const pt = locale === 'pt-BR', minutes = Math.max(0, Math.round((now - time) / 60000));
  if (minutes < 1) return pt ? 'agora' : 'now';
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h`;
  if (minutes < 2880) return pt ? 'ontem' : 'yesterday';
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(new Date(time));
}
/** Day group used by the inbox list: Hoje, Ontem, Esta semana, Antes. */
export function dayGroup(at: string, pt: boolean, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), time = Date.parse(at);
  if (time >= start) return pt ? 'Hoje' : 'Today';
  if (time >= start - 86_400_000) return pt ? 'Ontem' : 'Yesterday';
  if (time >= start - 6 * 86_400_000) return pt ? 'Esta semana' : 'This week';
  return pt ? 'Antes' : 'Earlier';
}
