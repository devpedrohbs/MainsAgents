export interface DraftContext { workspaceId: string; nodeId: string; label: string }
export interface ChatDraft { text: string; skill: string | null; context?: DraftContext[] }
export type ChatDraftMap = Record<string, ChatDraft>;
export const emptyChatDraft: ChatDraft = { text: '', skill: null, context: [] };
export const chatDraftKey = (agentId: string, sessionId?: string) => JSON.stringify([agentId, sessionId ?? null]);

export function normalizeChatDraft(value: unknown): ChatDraft {
  const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const context = Array.isArray(item.context) ? item.context.filter((ref): ref is DraftContext =>
    !!ref && typeof ref === 'object' && typeof ref.workspaceId === 'string' && typeof ref.nodeId === 'string' && typeof ref.label === 'string',
  ).map(({ workspaceId, nodeId, label }) => ({ workspaceId, nodeId, label })) : [];
  return { text: typeof item.text === 'string' ? item.text : '', skill: typeof item.skill === 'string' ? item.skill : null, context };
}

export function putChatDraft(current: ChatDraftMap, agentId: string, sessionId: string | undefined, value: ChatDraft): ChatDraftMap {
  const next = { ...current }, key = chatDraftKey(agentId, sessionId), draft = normalizeChatDraft(value);
  if (draft.text || draft.skill || draft.context?.length) next[key] = draft;
  else delete next[key];
  return next;
}
