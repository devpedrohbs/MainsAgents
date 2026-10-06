# Carousel template audit — 2026-10-06

Scope: a focused local review of the agent template, onboarding/editor consumers, editorial content model/protocol, image artifact handling and runtime capability diagnostics. No full repository scan, external calls, image generation, subworkers, commits or releases. Existing uncommitted work was preserved; only the two files below were edited.

## Delivered

- `src/features/agents/agentTemplates.ts`: added `carousel` using the existing `AgentTemplate` API, fully localized in English and PT-BR, with the existing `web-search`, `files` and `canvas-context` tool flags.
- `docs/analysis/orchestration-2026-10-06.md`: this report.

The instructions cover briefing, numbered slide copy, a per-slide image brief, editable layout handoff, review and requested export. They require checking configured image generation tools/model/limits and Paper layout/export capabilities, explicitly avoid assuming GPT Image 2.5 or Paper integration exists, and provide a specification fallback. They introduce no mandatory product setup or approval step.

`src/components/onboarding/WelcomeGuide.tsx` maps all templates, localizes their labels/outcomes and passes the selected ID. `src/app/App.tsx` resolves that ID and supplies localized values to `src/components/agents/AgentEditorDrawer.tsx`. The new entry therefore uses the existing selection path without consumer changes; the picker retains its existing first-agent visibility rule.

## Priorities and acceptance

| Priority | Concrete files | Improvement and acceptance |
| --- | --- | --- |
| 1 — done | `src/features/agents/agentTemplates.ts` | Dedicated localized carousel template. Acceptance: selectable through the existing consumer; EN/PT-BR names, roles, descriptions, outcomes and instructions present; instructions cover all requested stages and capability checks. |
| 2 — future | `editorial-protocol.mjs`, `src/features/content/model.ts`, `tests/content-workflow.test.mjs` | `ContentFormat` includes carousel, but `scriptPrompt` still requests a video specialist and spoken-script JSON. Add carousel-specific ordered slide data only when structured editorial production is requested. Acceptance: carousel output preserves numbered copy/image briefs and validates without changing video behavior or adding a mandatory step. |
| 3 — future | `runtime-capabilities.mjs`, `chat-image-artifacts.mjs` | Native image result handling exists and already avoids unconfirmed model-version claims; MCP discovery reports server/tools/auth status, with `readVerified: false`. The reviewed files do not establish a working Paper connector or GPT Image 2.5 availability. Acceptance: the configured runtime confirms the actual image tool/model and Paper editable-layout/export tools before execution, or returns explicit limitations plus a usable handoff. |
| 4 — future | `src/features/content/assetModel.ts`, `src/features/content/model.ts` | Generic versioned assets and file deliveries exist, but the reviewed models provide no explicit slide-order/editable-source manifest. Acceptance: a requested carousel delivery preserves ordered slide filenames, dimensions and editable source references with verified versions; missing exports remain visibly incomplete. |

Future items are integration requirements, not work implemented in this increment. Actual image generation, Paper editing/export and visual output review require runtime capability evidence and a separate requested production run; this audit made no live capability claim.

## Validation

- `npm.cmd run typecheck` — passed.
- `node --experimental-strip-types --test tests/content-workflow.test.mjs` — 3 passed, 0 failed; local SQLite/validation tests, no external calls or images.
- In-memory Node assertions — passed for unique template IDs, all PT-BR entries, carousel EN/PT-BR fields/tool flags, six instruction stages, unchanged EN source, and the existing onboarding ID-to-localized-editor wiring. The first assertion run exposed PowerShell pipe encoding of an accented expected literal; rerunning with a Unicode escape passed without changing product code.
- `git diff --check -- src/features/agents/agentTemplates.ts` — passed. Consumer selection was checked through code and local assertions; no interactive UI or live provider/Paper run was performed.
