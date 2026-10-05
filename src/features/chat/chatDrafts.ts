import { useEffect } from 'react';
import { readPersistentValue, updatePersistentValue, usePersistentState } from '../../data/localPersistence';
import { chatDraftKey, emptyChatDraft, normalizeChatDraft, putChatDraft, type ChatDraft, type ChatDraftMap } from './chatDraftModel';
export type { ChatDraft } from './chatDraftModel';
const storageKey = 'chat-drafts';
const legacyKey = (agentId: string, sessionId?: string) => `mainsagents:chat-draft:${agentId}:${sessionId ?? 'new'}`;

export function readChatDraft(agentId: string, sessionId?: string): ChatDraft {
  const drafts = readPersistentValue<ChatDraftMap>(storageKey, {});
  const saved = drafts[chatDraftKey(agentId, sessionId)];
  if (saved) return normalizeChatDraft(saved);
  let legacy: string | null = null;
  try { legacy = sessionStorage.getItem(legacyKey(agentId, sessionId)); } catch { /* Native storage works even with blocked browser storage. */ }
  if (legacy) {
    let draft: ChatDraft;
    try { draft = normalizeChatDraft(JSON.parse(legacy)); } catch { return emptyChatDraft; }
    writeChatDraft(agentId, sessionId, draft);
    return draft;
  }
  return emptyChatDraft;
}

export function writeChatDraft(agentId: string, sessionId: string | undefined, draft: ChatDraft) {
  updatePersistentValue<ChatDraftMap>(storageKey, {}, current => putChatDraft(current, agentId, sessionId, draft));
  try { sessionStorage.removeItem(legacyKey(agentId, sessionId)); } catch { /* Legacy cleanup is optional. */ }
}

export function useChatDraft(agentId: string, sessionId?: string): ChatDraft {
  const [drafts] = usePersistentState<ChatDraftMap>(storageKey, {});
  useEffect(() => { if (agentId) readChatDraft(agentId, sessionId); }, [agentId, sessionId]);
  return drafts[chatDraftKey(agentId, sessionId)] ?? emptyChatDraft;
}

export function deleteAgentDrafts(agentId: string) {
  updatePersistentValue<ChatDraftMap>(storageKey, {}, current => Object.fromEntries(Object.entries(current).filter(([key]) => {
    try { return JSON.parse(key)[0] !== agentId; } catch { return false; }
  })));
}
