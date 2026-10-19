import { useEffect } from 'react';
import { readPersistentValue, updatePersistentValue, usePersistentState } from '../../data/localPersistence';
import { chatDraftKey, emptyChatDraft, normalizeChatDraft, putChatDraft, type ChatDraft, type ChatDraftMap, type DraftSlot } from './chatDraftModel';
export type { ChatDraft, DraftSlot } from './chatDraftModel';
export { draftSlot } from './chatDraftModel';
const storageKey = 'chat-drafts';
// Browser-storage drafts of older builds existed only per chat or the agent's single "new" slot (now General).
const legacyKey = (agentId: string, slot?: DraftSlot) => typeof slot === 'object' ? null : `mainsagents:chat-draft:${agentId}:${slot ?? 'new'}`;

export function readChatDraft(agentId: string, sessionId?: DraftSlot): ChatDraft {
  const drafts = readPersistentValue<ChatDraftMap>(storageKey, {});
  const saved = drafts[chatDraftKey(agentId, sessionId)];
  if (saved) return normalizeChatDraft(saved);
  let legacy: string | null = null;
  const oldKey = legacyKey(agentId, sessionId);
  try { legacy = oldKey ? sessionStorage.getItem(oldKey) : null; } catch { /* Native storage works even with blocked browser storage. */ }
  if (legacy) {
    let draft: ChatDraft;
    try { draft = normalizeChatDraft(JSON.parse(legacy)); } catch { return emptyChatDraft; }
    writeChatDraft(agentId, sessionId, draft);
    return draft;
  }
  return emptyChatDraft;
}

export function writeChatDraft(agentId: string, sessionId: DraftSlot, draft: ChatDraft) {
  updatePersistentValue<ChatDraftMap>(storageKey, {}, current => putChatDraft(current, agentId, sessionId, draft));
  const oldKey = legacyKey(agentId, sessionId);
  try { if (oldKey) sessionStorage.removeItem(oldKey); } catch { /* Legacy cleanup is optional. */ }
}

export function useChatDraft(agentId: string, sessionId?: DraftSlot): ChatDraft {
  const [drafts] = usePersistentState<ChatDraftMap>(storageKey, {});
  const key = chatDraftKey(agentId, sessionId);
  useEffect(() => { if (agentId) readChatDraft(agentId, sessionId); }, [agentId, key]); // key carries the slot identity
  return drafts[key] ?? emptyChatDraft;
}

export function deleteAgentDrafts(agentId: string) {
  updatePersistentValue<ChatDraftMap>(storageKey, {}, current => Object.fromEntries(Object.entries(current).filter(([key]) => {
    try { return JSON.parse(key)[0] !== agentId; } catch { return false; }
  })));
}
