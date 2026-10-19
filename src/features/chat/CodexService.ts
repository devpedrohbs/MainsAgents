import type { AgentTool } from '../agents/model/Agent';
import type { ReasoningEffort, ChatImageAttachment } from './model/Chat';
import type { AgentHandoffRequest } from './agentHandoff';

export interface DelegationRuntimeConfig {
  sourceAgentId: string;
  workspaceId: string;
  targets: readonly {id: string; name: string; role: string}[];
  connectedAgentId?: string;
}

export type CodexThreadId = string;
export type CodexExecutionId = string;

export interface CodexSessionConfig {localSessionId?:string;
  agentId: string;
  agentName?: string;
  workspaceId: string;
  instructions: string;
  modelId?: string;
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
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
  context?: readonly CodexContextItem[];
  clientMessageId?: string;
  delegation?: DelegationRuntimeConfig;
  instructions?: string;
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

/** Final export receipt of a Claude editor session (contract mainsagents.editor-authoring/1), verified by the host
 * against the real file (stat + sha256) before the event is emitted. The path comes from the host, never from the model. */
export interface EditorFileReceipt {
  assetId: string;
  versionId: string;
  sha256: string;
  bytes: number;
  path: string;
  planHash: string;
  requestKey: string;
  duration?: number;
  verifiedAt: string;
}

/** Persisted by the host per run+epoch; passed back to openEditorSession({checkpoint}) after a restart. */
export interface EditorCheckpoint {
  sessionId: string;
  contract: 'mainsagents.editor-authoring/1';
  runId: string;
  epoch: number;
  sourceSha256: string;
  state: 'open'|'closed'|'cancelled';
  /** What Claude actually received as images; a review is the model's interpretation, never a measured signal. */
  qa: {sourceObserved: boolean; inspectedRevision: number; coveredScenes: string[]};
  revision: number;
  planHash: string|null;
  /** Scenes of the current revision as reported by the plan validator (edited timeline, seconds). */
  scenes: {id: string; start: number; end: number}[];
  revisionsUsed: number;
  previewsUsed: number;
  visionBytes: number;
  calls: number;
  finalized: boolean;
  final?: {revision: number; planHash: string; requestKey: string; status: 'requested'|'pending'|'succeeded'|'failed'|'uncertain'|'cancelled'; jobId?: string; qa?: {kind: 'model-interpretation'; sourceObserved: boolean; previewInspected: boolean; scenes: number; scenesInspected: number; uncoveredScenes?: string[]; limitations: string[]}};
  receipt?: EditorFileReceipt;
  actions: readonly Record<string, unknown>[];
}

export type CodexEvent =
  | { type:'file.completed'; executionId:CodexExecutionId; receipt:EditorFileReceipt }
  | { type:'editor.checkpoint'; executionId:CodexExecutionId; checkpoint:EditorCheckpoint }
  /** The model's final structured report, compared with the checkpoint; never a source of truth by itself. */
  | { type:'editor.report'; executionId:CodexExecutionId; valid:boolean; consistent:boolean; report?:{status:'finalized'|'not-finalized'; finalRevision:number; summary:string; limitations:string[]} }
  | { type:'agent.delegation-queued';executionId:CodexExecutionId;callId:string }
  | { type:'image.completed'; executionId:CodexExecutionId; image:ChatImageAttachment }
  | { type:'image.failed'; executionId:CodexExecutionId; callId:string; message:string }
  | { type:'agent.delegate'; executionId:CodexExecutionId; callId:string; request:AgentHandoffRequest }
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
  listSessionImages?(threadId:string):Promise<CodexEvent[]>;
  createSession(input: CreateCodexSessionInput): Promise<CodexSessionHandle>;
  resumeSession(input: ResumeCodexSessionInput): Promise<CodexSessionHandle>;
  sendMessage(input: SendCodexMessageInput): Promise<CodexExecutionHandle>;
  cancelExecution(executionId: CodexExecutionId): Promise<void>;
  streamEvents(input: StreamCodexEventsInput): AsyncIterable<CodexEvent>;
  resolveDelegation?(executionId:string,callId:string,result:{success:boolean;content:string}):Promise<void>;
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
