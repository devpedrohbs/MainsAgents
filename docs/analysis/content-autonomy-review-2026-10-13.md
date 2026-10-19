# Content autonomy review — scheduling + GPT/Paper (reviewer C, 2026-10-13)

Read-only review of `chat-publishing.mjs` (mtime 16:46), `publishing-automation.mjs`, `paper-image-assets.mjs`,
`publication-connector.mjs`, `editorial-publication-execution.mjs`, `runtime-action-approvals.mjs`, the bindings in
`content-workflow-bridge.mjs`, and the call sites in `codex-bridge.mjs` and `claude-code-bridge.mjs`. Repros used an
isolated in-memory copy of the `tests/autonomous-scheduling.test.mjs` fixture (scratchpad only, no app state, no live
provider). Fixture results do not prove live scheduling; no live post was made.

## Confirmed bugs

All of these ran with the saved preference enabled. "Scheduled" means the provider stub got `create_post` and the
request ended as `scheduled`.

| # | Owner | Scenario → result | Where |
|---|---|---|---|
| 1 | A | The user says "Não agende ainda, só quero revisar", "Você consegue agendar posts no Instagram?" or "cancela o agendamento", and the model calls schedule. Each one is **scheduled**. The word match is taken as authority, with no negation, question or cancellation handling. Root flagged this earlier and it is **still unfixed**. | `chat-publishing.mjs:32,67` |
| 2 | A | The user says only "agende no Instagram" and the model passes `scheduledAt: 2026-10-19T09:00`. It is **scheduled**. The date, `timeZone` (which overrides the saved zone) and `accountId` (when there is more than one account) are free model input, not tied to the user's words. **Still unfixed.** | `chat-publishing.mjs:76-92` |
| 3 | A | Stale intent. "agende no Instagram amanhã 18h" is scheduled. Then the user says "Agora crie outra versão para o LinkedIn" with no scheduling word. The model's LinkedIn call is **scheduled** on the old intent (creates=2). The same happens after a failed, denied or superseded request. The intent does not have to come after the material was shown. | `chat-publishing.mjs:67,182-184` |
| 4 | A | Confirmation parsing. "pode cancelar, mudei de ideia" confirms the pending summary, and it is **scheduled**. "isso não" and "ok, mas mude a hora" also match. | `chat-publishing.mjs:33,207` |
| 5 | A/B | File provenance and order. Any path that appears in an **agent** message counts as "shown", so an unrelated `old.png` that the model mentioned was scheduled. Order follows the model's args, so a reversed list was scheduled. `sessionExports` is never wired, so Paper export receipts (`paperAssets.exports(...).latest`) authorize or order nothing in production. | `chat-publishing.mjs:39,105-106`, `content-workflow-bridge.mjs:99` |
| 6 | B | Auth path. Writes use the Codex CLI `publora` MCP (`codex-bridge.mjs:434`, `desktop-main.mjs:349`). Native reads auto-approved for Claude include `claude_ai_Publora` (claude.ai connector OAuth), which can be a different Publora account. The test at `tests/autonomous-scheduling.test.mjs:120` codifies this. Writes stay safe because `accountId` is validated against the executor list, but the accounts and posts the model reports can come from another account. Zernio has the same issue (native MCP versus the API key). | `publishing-automation.mjs:17-25` |

## Corrected or covered

- **Duplicates:** a lost response, a repeated call or a restart does not duplicate the post. `byKey` blocks running, scheduled and uncertain requests, `save('running')` runs synchronously after the plan, and on boot running becomes uncertain. The executor marks the `requesting` phase as uncertain and never replays it. Two parallel identical calls gave scheduled/running with creates=1.
- **Changed files:** files are re-hashed before assets are built (`perform`) and again on confirmation (`execute`). An asset that matches an older version is refused.
- **Time and plan limits:** past times and times under 15 minutes away are refused. Plan horizon and quota are checked before any write. Instagram enforces 1–10 slides, so a nine-slide carousel fits.
- **No step approvals:** with the preference on, there are no per-step approvals; the schedule tool is allowed by the Claude permission gate without a second prompt.
- **Generated images:** Paper `paper-asset://` references are auto-approved only for host-verified, content-addressed images (`createVerifiedImageIndex`). Export receipts come only from structured `exports[]` in a successful export call on the agent's own `fileId`.
- **Codex session under a Claude-default agent:** `binding()` uses `effectiveSessionAgent`, so `providerId` becomes codex, `paperDesign` is kept and `paperImageInstructions` applies. Claude turns read Paper and publishing settings from the bound saved agent, never from request copies.

## Open, low severity or untested

- `thread/resume` drops `dynamicTools` (`codex-bridge.mjs:328`). A resumed older thread may lack `mainsagents_schedule_post` while the instructions still name it. App-server resume semantics were not verified.
- `/api/codex/sessions` takes `modelId` from the request. When a new thread is started with `localSessionId`, the owned-thread check is skipped. The renderer is trusted, so this is low severity.
- External constraints not tested: real Publora or Zernio carousel ordering, media processing time versus `ready`, `scheduledTime` handling by the provider, and the account-context horizon on the user's plan. The Paper export result shape is documented as verified on 2026-10-13 but was not re-run here.
