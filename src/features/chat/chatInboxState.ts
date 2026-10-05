import {readPersistentValue,updatePersistentValue,usePersistentState} from '../../data/localPersistence';
import {emptyChatInbox,seenChatSession,type ChatInboxState} from './chatInbox';
import type {AgentSession} from './model/Chat';
export const useChatInboxState=()=>usePersistentState<ChatInboxState>('chat-inbox',emptyChatInbox);
export function markChatSessionSeen(session:AgentSession){updatePersistentValue<ChatInboxState>('chat-inbox',emptyChatInbox(),current=>seenChatSession(current,session));}
export const readChatInbox=()=>readPersistentValue<ChatInboxState>('chat-inbox',emptyChatInbox());
