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

## Sessões do provedor e prévia de legendas (0.3.61)

- **Contrato de sessão ausente** (`codex-session-errors.mjs`): só `error.code==='thread-missing'` ou os textos reais do Codex CLI (`no rollout found for thread id`, `no persisted rollout`, `not materialized yet`) provam que a sessão não existe. `thread not loaded` significa apenas fora da memória do app-server: `readThreadOrMissing` retoma e lê de novo. ID inválido, autenticação, rede e falha de setup do sandbox nunca viram expiração. O coordenador de produção e a fila de delegações só recriam uma sessão **antes** de qualquer envio; um turno enviado/em streaming exige reenvio explícito.
- **Delegação `sessionMode:'new'`** abre sempre uma sessão nova do especialista; `continue` reutiliza a última sessão do mesmo agente; um vínculo automático que aponta para sessão de outro agente (ou inexistente) é tratado como obsoleto e gera sessão nova com `job.notice`.
- **Prévia final de legendas** (`production-caption-preview.mjs`): mesmo documento ASS (`buildAss` da versão inteira), mesma fonte e o mesmo filtro libass do render final sobre até 6 s do vídeo-base; os quadros mantêm o tempo original enquanto o libass desenha (`setpts`), depois são rebaseados e reduzidos a no máximo 720 px. O sha256 da fonte é conferido antes e depois; o arquivo é temporário (cache por run, chave = fonte + hash da versão + estilo + janela + motor), nunca um asset da biblioteca, e o pedido HTTP cancelado encerra o FFmpeg. A aprovação registra `previewed` somente se a prévia foi da mesma hash e estilo.
