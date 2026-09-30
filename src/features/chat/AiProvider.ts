import type { AgentTool } from '../agents/model/Agent';
import type { CodexEvent } from './CodexService';
import type { ReasoningEffort } from './model/Chat';

export type ProviderId = 'codex' | 'claude' | 'gemini';
export type ProviderAuthMode = 'chatgpt' | 'cli' | 'api-key' | 'cloud' | 'unknown';
export type ProviderConnectionState = 'not-installed' | 'login-required' | 'connected' | 'limit-reached' | 'error';

export interface ProviderCapabilities {
  streaming: boolean;
  cancellation: boolean;
  remoteResume: boolean;
  webSearch: boolean;
  files: boolean;
  tools: readonly AgentTool[];
}

export interface ProviderStatus {
  providerId: ProviderId;
  state: ProviderConnectionState;
  authMode: ProviderAuthMode;
  billingDescription: string;
  capabilities: ProviderCapabilities;
  message?: string;
}

export interface ProviderSessionHandle { remoteSessionId: string }
export interface ProviderExecutionHandle { executionId: string; remoteSessionId: string }

/** Provider-neutral runtime boundary. Adapters own API, CLI and event translation. */
export interface AiProvider {
  readonly id: ProviderId;
  getStatus(): Promise<ProviderStatus>;
  listModels(): Promise<readonly {id:string; name:string}[]>;
  createSession(input:{agentId:string;agentName:string;workspaceId:string;instructions:string;modelId?:string;tools:readonly AgentTool[];skillsDirectory?:string;skills?:readonly string[]}):Promise<ProviderSessionHandle>;
  resumeSession(remoteSessionId:string):Promise<ProviderSessionHandle>;
  sendMessage(input:{remoteSessionId:string;content:string;modelId?:string;reasoningEffort?:ReasoningEffort;instructions?:string;agentId?:string;agentName?:string;role?:string;workspaceId?:string;tools?:readonly AgentTool[];skillsDirectory?:string;skills?:readonly string[];firstMessage?:boolean;history?:readonly {role:'user'|'agent';content:string}[];context?:readonly {id:string;kind:string;label:string;content?:string}[]}):Promise<ProviderExecutionHandle>;
  cancelExecution(executionId:string):Promise<void>;
  streamEvents(input:{executionId:string;signal?:AbortSignal}):AsyncIterable<CodexEvent>;
}

export const sessionProviderId=(session:{providerId?:ProviderId}):ProviderId=>session.providerId??'codex';
export const sessionRemoteId=(session:{remoteSessionId?:string;codexThreadId?:string}):string|undefined=>session.remoteSessionId??session.codexThreadId;
