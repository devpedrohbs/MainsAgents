# Task 07 — Opt-in agent comparison UI

## Delivered
- `ChatPanel.tsx`: explicit “Consultar dois agentes” / “Consult two agents” entry from conversation options or a source response, and “Reabrir comparação” / “Reopen comparison” for paired sessions.
- `ComparisonLauncher.tsx`: same-workspace Codex/Claude selections, one editable shared brief/context and a two-execution consumption notice; opening/closing/reloading never sends.
- `AgentComparisonView.tsx` + `comparison.css`: existing independent ChatPanels side by side on desktop and tabbed below 900px, live statuses, existing per-session follow-up/cancel controls, contained focus, Escape and focus restoration.
- Response selection/copy/draft controls and explicit synthesis preparation use only draft storage. Both replies are marked untrusted; no synthesis execution starts automatically.
- Deleted or unavailable pairing is explained in the surviving paired chat. Comparison mode suppresses new comparison/handoff entries and automatic production/review intent dialogs; standard single-chat composer behavior remains intact.
- `App.tsx` mounts the view through Claude's existing comparison API. No ChatProvider, model or agentComparison changes.
- `scripts/test-semi-production-ui.mjs`: one-line selector wait now requires an enabled control, so the account selector is opened only after account inventory loading finishes; existing assertions retained.

## Modified files
- `src/components/chat/ChatPanel.tsx`, `src/app/App.tsx`, `scripts/test-semi-production-ui.mjs`.
- New `ComparisonLauncher.tsx`, `AgentComparisonView.tsx`, `comparisonDraft.ts`, `comparison.css` under `src/components/chat/`.
- New `scripts/test-agent-comparison-ui.mjs` and this report. Existing uncommitted work preserved.

## Validation
- `npm.cmd run typecheck`: passed.
- `node --experimental-strip-types --test tests/agent-comparison.test.mjs`: 6 passed.
- Actual ChatProvider/Electron renderer fixture passed with local mocked provider endpoints: equal initial brief/context, distinct identity/model/session/skills, first result while sibling works, sibling failure isolation, per-chat follow-up/cancel, synthesis draft without another request, renderer restart/reopen without resend and opt-out single mode.
- Fixture also passed Tab containment, Escape/focus restoration, deleted-pair explanation and viewport geometry at 1440px and 600px; desktop/narrow screenshots reviewed with no clipping after correcting inherited grid rows.
- Comparison artifacts: `C:/Users/pacas/AppData/Local/Temp/comparison-validation-b2070e1b3d924381987728bdedb9a91a/comparison-accepted/` (`comparison-desktop.png`, `comparison-narrow.png`, `result.json`).
- Production regression ran once against the temporary current build and passed; artifacts are under the same validation root's timestamped `production/` directories. A fixture-only preview trust warning occurred during window teardown; no assertion or renderer failure.
- Fixture development corrected quoted selectors and an Escape propagation issue before the final pass. Temporary build/runner files stayed outside the repository.

No real AI, configuration, account, publication or Notion calls, subworkers, commits or releases. Actual provider latency/billing/connectivity remains outside mocked verification; reopening a pair recovers history rather than resending interrupted work.
