export interface ChatDraft {
  text: string;
  skill: string | null;
}
function key(agentId: string, sessionId?: string) {
  return `mainsagents:chat-draft:${agentId}:${sessionId ?? 'new'}`;
}
export function readChatDraft(agentId: string, sessionId?: string): ChatDraft {
  try {
    const value = JSON.parse(sessionStorage.getItem(key(agentId, sessionId)) ?? '{}');
    return {
      text: typeof value.text === 'string' ? value.text : '',
      skill: typeof value.skill === 'string' ? value.skill : null,
    };
  } catch {
    return { text: '', skill: null };
  }
}
export function writeChatDraft(agentId: string, sessionId: string | undefined, draft: ChatDraft) {
  try {
    if (draft.text || draft.skill) sessionStorage.setItem(key(agentId, sessionId), JSON.stringify(draft));
    else sessionStorage.removeItem(key(agentId, sessionId));
  } catch {
    /* History still persists independently if draft storage is unavailable. */
  }
}
