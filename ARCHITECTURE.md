# MainsAgents architecture

The frontend is split into four boundaries so the Codex runtime can be added without coupling transport code to React.

| Boundary | Current location | Responsibility |
| --- | --- | --- |
| UI | `src/components`, `src/pages` | Render state and dispatch user intent. It does not import a Codex client. |
| Application state | React providers in `src/app` and `src/features` | Own workspaces, agents, tasks, sessions, messages and canvas state. |
| Persistence | `src/data/StateStore.ts`, `IndexedDbStateStore.ts`, `localPersistence.ts` | Store serializable application state independently of the runtime. |
| Codex runtime | `src/features/chat/CodexService.ts`, `HttpCodexService.ts`, `codex-bridge.mjs` | Define runtime operations and connect the browser to the local Codex App Server without exposing runtime access to React components. |

`CodexSessionApplication.ts` is the application boundary between session state and the runtime. It can create or resume a Codex thread, send a message, cancel an execution and expose its event stream. It receives `CodexService` through constructor injection and has no React dependency.

When the real integration is added, the intended flow is:

1. A UI action updates or invokes the application state layer.
2. The state layer calls `CodexSessionApplication`, never a transport SDK directly.
3. The application layer creates or resumes the thread and returns `codexThreadId` for the MainsAgents session.
4. Streamed runtime events are translated into the existing message, activity and run-state models.
5. IndexedDB persists the updated session and messages.

`HttpCodexService` is injected at the composition root. It talks only to the same-origin local bridge. The bridge owns the Codex App Server `stdio` process, JSON-RPC lifecycle, thread resume, turn cancellation and streamed event translation. `UnconfiguredCodexService` remains available as a safe fallback for environments where the runtime is intentionally disabled.
