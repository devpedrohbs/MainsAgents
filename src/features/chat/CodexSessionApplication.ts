import type { AgentSession } from './model/Chat';
import type { Agent } from '../agents/model/Agent';
import type { CodexContextItem, CodexEvent, CodexExecutionHandle, CodexExecutionId, CodexService } from './CodexService';

export interface CodexLinkedSession extends AgentSession {
  codexThreadId: string;
}

export interface CodexSessionPatch {
  sessionId: string;
  codexThreadId: string;
}

/** Application boundary consumed by state providers once the real runtime is enabled. */
export interface CodexSessionApplication {
  ensureSession(session: AgentSession, agent: Agent): Promise<CodexSessionPatch>;
  sendMessage(session: CodexLinkedSession, content: string, context?: readonly CodexContextItem[]): Promise<CodexExecutionHandle>;
  cancelExecution(executionId: CodexExecutionId): Promise<void>;
  streamEvents(executionId: CodexExecutionId, signal?: AbortSignal): AsyncIterable<CodexEvent>;
}

/** Framework-agnostic coordinator. It owns runtime orchestration, never UI state. */
export class DefaultCodexSessionApplication implements CodexSessionApplication {
  constructor(private readonly codex: CodexService) {}

  async ensureSession(session: AgentSession, agent: Agent): Promise<CodexSessionPatch> {
    const handle = session.codexThreadId
      ? await this.codex.resumeSession({ threadId: session.codexThreadId })
      : await this.codex.createSession({ agentId: agent.id, agentName: agent.name, workspaceId: agent.workspaceId, instructions: agent.instructions, tools: agent.tools });
    return { sessionId: session.id, codexThreadId: handle.threadId };
  }

  sendMessage(session: CodexLinkedSession, content: string, context:readonly CodexContextItem[] = []): Promise<CodexExecutionHandle> {
    return this.codex.sendMessage({ threadId: session.codexThreadId, content, context });
  }

  cancelExecution(executionId: CodexExecutionId): Promise<void> {
    return this.codex.cancelExecution(executionId);
  }

  streamEvents(executionId: CodexExecutionId, signal?: AbortSignal): AsyncIterable<CodexEvent> {
    return this.codex.streamEvents({ executionId, signal });
  }
}
