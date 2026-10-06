# Task 04 — Carousel editorial generation and review

## Delivered
- New optional `CarouselDraft` / `CarouselSlide` fields on script options and approvals; existing required video fields remain compatible.
- Carousel prompt requests 2–20 ordered slides, editable titles/copy, per-slide image briefs, caption and factual source references; it requests no spoken script or improvisation choices.
- Validator rejects missing fields, duplicate/out-of-order numbers, oversized fields/drafts, invalid/duplicate source URLs, unknown citations and sources absent from supplied research.
- Canonical text is derived from the reviewed slide order, copy, image briefs, caption and sources; server approval regenerates it instead of trusting stale derived text.
- New queued jobs preserve format context; older jobs without context keep the existing default validator path. Stored legacy carousel artifacts remain readable and approvable without migration.
- Research → generation → review → approval preserves carousel fields in artifacts, approval notes and immutable version history; identical approvals deduplicate.
- Dedicated EN/PT-BR review fields edit copy/briefs/caption and reorder slides, persist scoped drafts, and show approved/history versions; new suggestions take precedence during renewed review.
- Carousel approval keeps production in planning instead of requiring recording. Review clearly identifies these as briefs, not generated images or exported layouts.

## Modified files
- `editorial-protocol.mjs`, `editorial-protocol.d.mts`, `editorial-workflow-queue.mjs`, `editorial-jobs.mjs`.
- `src/features/content/model.ts`, `src/features/content/ContentWorkflowProvider.tsx`, `src/pages/ContentStudio.tsx`.
- New `src/components/content/CarouselReview.tsx`, `tests/carousel-editorial.test.mjs`, and this report.
- Coordinator explicitly approved the additional review-page, approval-writer and protocol-declaration ownership; existing uncommitted work was preserved. No production coordinator/dialog or bridge edits.

## Validation and limits
- `npm.cmd run typecheck`: passed.
- Four new carousel tests passed: valid/invalid/bounds/sources, video compatibility, research/generation/review/approval/history and legacy stored data.
- Existing `content-workflow`, `editorial-work` and `editorial-jobs` suites: 28 passed; the first combined run's sole failure was a missing `readThread` in the new test stub, corrected before the new suite passed.
- Isolated temporary Vite build and Electron DOM verification passed: edit copy/brief/caption, reorder, unsent restart, approval/history and approved restart; zero connector writes or AI calls.
- Fixture runner/build/result: `C:/Users/pacas/AppData/Local/Temp/carousel-editorial-ui-rkjeb9yp/`; `artifacts/result.json` records success. The offscreen screenshot capture was incomplete, so no full visual QA claim is made.
- Source checks establish valid supplied references, not factual truth of every edited claim. Real model behavior, Paper/image generation/export and live Notion formatting remain outside this increment.

No package installation, paid/external calls, subworkers, commits or releases.
## QA visual (Claude, 2026-10-06)
- Script: `.mainsagents-workspaces/carousel-qa/visual-qa.mjs`. É uma cópia do fixture Codex (mesma semente e mesmo `dist`) em janela Electron oculta nativa, sem `offscreen`, sem conta pessoal, sem IA (`calls:0`) e sem erros de console.
- Capturas em `.mainsagents-workspaces/carousel-qa/artifacts/`, nas larguras 1424 (`desktop-*`) e 404 (`narrow-*`) px: `1-slide-edit`, `2-reorder`, `3-caption`, `4-approval`, `5-approved`.
- Sem overflow horizontal nas duas larguras (`visual-report.json`). Campos, botões de reordenar, legenda e aprovação estão legíveis; no estreito, o texto quebra corretamente e os botões ficam lado a lado.
- **Problema 1:** cada slide usa um `<fieldset>` com o estilo padrão do navegador (borda groove, cantos retos, legenda cortando a borda). Isso destoa dos cards arredondados com tokens, e a borda inferior encosta no rótulo "Legenda do post", sem espaço.
- **Problema 2:** o link de fonte usa o azul padrão do navegador, `rgb(0,0,238)`, sem tokens.
- **Problema 3:** o bloco "Roteiro aprovado · versão 1" repete o título "Slides e briefings editáveis" com textareas e alças de redimensionar, mas os 7 campos são somente leitura. A tela dá a entender que dá para editar.
- **Problema 4 (menor):** o campo Título é uma textarea alta de três linhas para um texto curto.
- Correção (Claude): `CarouselReview.tsx` + `carousel-review.css`, com escopo em `.carousel-review`, sem sobrescrever `.editorial-review` globalmente.
  - Slides em cards com tokens (`--border`/`--surface`/`--radius-md`), legenda dentro do card e espaço antes de "Legenda do post".
  - Fontes em "Fontes:", com `--accent` e `focus-visible`. Título em 1 linha, sem alça de redimensionar.
  - Modo aprovado: "Slides e legenda aprovados · somente leitura", rótulo "Texto" e textareas sem alças. `readOnly`, `aria-label`s, DOM e dados ficam iguais.
- Verificação: `tsc` exit 0 e build novo. Capturas nas duas larguras (repo `dist`) inspecionadas, sem overflow horizontal, sem erros e `calls:0`. Não reexecutei as asserções do fluxo do fixture Codex.
