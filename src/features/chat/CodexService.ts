import type { AgentTool } from '../agents/model/Agent';

export type CodexThreadId = string;
export type CodexExecutionId = string;

export interface CodexSessionConfig {
  agentId: string;
  agentName?: string;
  workspaceId: string;
  instructions: string;
  tools: readonly AgentTool[];
  skillsDirectory?: string;
  skills?: readonly string[];
  metadata?: Record<string, string>;
}

export interface CodexSessionHandle {
  threadId: CodexThreadId;
}

export interface CreateCodexSessionInput extends CodexSessionConfig {}

export interface ResumeCodexSessionInput {
  threadId: CodexThreadId;
}

export interface SendCodexMessageInput {
  threadId: CodexThreadId;
  content: string;
  context?: readonly CodexContextItem[];
  clientMessageId?: string;
}

export interface CodexContextItem {
  id: string;
  kind: string;
  label: string;
  content?: string;
}

export interface CodexExecutionHandle {
  executionId: CodexExecutionId;
  threadId: CodexThreadId;
}

export interface StreamCodexEventsInput {
  executionId: CodexExecutionId;
  signal?: AbortSignal;
}

export type CodexEvent =
  | { type:'execution.started'; executionId:CodexExecutionId; threadId:CodexThreadId }
  | { type:'message.delta'; executionId:CodexExecutionId; delta:string }
  | { type:'message.completed'; executionId:CodexExecutionId; content:string }
  | { type:'activity'; executionId:CodexExecutionId; label:string; status:'started'|'finished' }
  | { type:'search'; executionId:CodexExecutionId; label:string; status:'started'|'finished' }
  | { type:'tool.started'; executionId:CodexExecutionId; tool:string; callId:string; label?:string }
  | { type:'tool.finished'; executionId:CodexExecutionId; tool:string; callId:string; summary?:string }
  | { type:'execution.completed'; executionId:CodexExecutionId }
  | { type:'execution.cancelled'; executionId:CodexExecutionId }
  | { type:'execution.failed'; executionId:CodexExecutionId; code:string; message:string; retryable:boolean };

/** Runtime boundary. React components and persistence adapters must not depend on a concrete Codex client. */
export interface CodexService {
  createSession(input: CreateCodexSessionInput): Promise<CodexSessionHandle>;
  resumeSession(input: ResumeCodexSessionInput): Promise<CodexSessionHandle>;
  sendMessage(input: SendCodexMessageInput): Promise<CodexExecutionHandle>;
  cancelExecution(executionId: CodexExecutionId): Promise<void>;
  streamEvents(input: StreamCodexEventsInput): AsyncIterable<CodexEvent>;
}

export class CodexRuntimeUnavailableError extends Error {
  constructor(operation: string) {
    super(`Codex runtime is not configured. Cannot ${operation}.`);
    this.name = 'CodexRuntimeUnavailableError';
  }
}

/** Safe placeholder until a desktop/runtime adapter is implemented and injected. */
export class UnconfiguredCodexService implements CodexService {
  createSession(): Promise<CodexSessionHandle> { return Promise.reject(new CodexRuntimeUnavailableError('create a session')); }
  resumeSession(): Promise<CodexSessionHandle> { return Promise.reject(new CodexRuntimeUnavailableError('resume a session')); }
  sendMessage(): Promise<CodexExecutionHandle> { return Promise.reject(new CodexRuntimeUnavailableError('send a message')); }
  cancelExecution(): Promise<void> { return Promise.reject(new CodexRuntimeUnavailableError('cancel an execution')); }
  async *streamEvents(): AsyncIterable<CodexEvent> { throw new CodexRuntimeUnavailableError('stream events'); }
}
