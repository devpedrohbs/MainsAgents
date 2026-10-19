export interface DraftContext { workspaceId: string; nodeId: string; label: string }
export interface ChatDraft { text: string; skill: string | null; context?: DraftContext[] }
export type ChatDraftMap = Record<string, ChatDraft>;
export const emptyChatDraft: ChatDraft = { text: '', skill: null, context: [] };
/**
 * Where an unsent draft lives: a chat (its id), the agent's General "no chat yet" slot (undefined: the legacy `[agent,null]` key,
 * so older drafts stay in General), or the "no chat yet" slot of one content/recovery scope of a workspace.
 */
export type DraftSlot = string | undefined | { workspaceId: string; scope: string };
/** Collision-free JSON tuple: [agent, chat] or [agent, null, workspace, scope]. */
export const chatDraftKey = (agentId: string, slot?: DraftSlot) => typeof slot === 'object'
  ? JSON.stringify([agentId, null, slot.workspaceId, slot.scope])
  : JSON.stringify([agentId, slot ?? null]);
/** Draft slot of the composer: the shown chat, else the selected scope's own "no chat yet" slot (General keeps the legacy one). */
export const draftSlot = (sessionId: string | undefined, workspaceId: string, scope: string): DraftSlot =>
  sessionId ?? (scope === 'general' ? undefined : { workspaceId, scope });
/** Saved draft key shape: [agent, chat|null] or [agent, null, workspace, scope]. */
export function validDraftKey(key: string): boolean {
  let identity: unknown;
  try { identity = JSON.parse(key); } catch { return false; }
  if (!Array.isArray(identity) || typeof identity[0] !== 'string') return false;
  if (identity.length === 2) return identity[1] === null || typeof identity[1] === 'string';
  return identity.length === 4 && identity[1] === null && typeof identity[2] === 'string' && typeof identity[3] === 'string' && !!identity[2] && !!identity[3];
}

export function normalizeChatDraft(value: unknown): ChatDraft {
  const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const context = Array.isArray(item.context) ? item.context.filter((ref): ref is DraftContext =>
    !!ref && typeof ref === 'object' && typeof ref.workspaceId === 'string' && typeof ref.nodeId === 'string' && typeof ref.label === 'string',
  ).map(({ workspaceId, nodeId, label }) => ({ workspaceId, nodeId, label })) : [];
  return { text: typeof item.text === 'string' ? item.text : '', skill: typeof item.skill === 'string' ? item.skill : null, context };
}

export function putChatDraft(current: ChatDraftMap, agentId: string, slot: DraftSlot, value: ChatDraft): ChatDraftMap {
  const next = { ...current }, key = chatDraftKey(agentId, slot), draft = normalizeChatDraft(value);
  if (draft.text || draft.skill || draft.context?.length) next[key] = draft;
  else delete next[key];
  return next;
}
