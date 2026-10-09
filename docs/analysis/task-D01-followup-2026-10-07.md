# D01 follow-up — migração das capturas UI (07/10/2026)

Helper: `scripts/ui-capture-ready.mjs` (`captureReadyPng`, `waitForCaptureReady`): splash ausente/invisível, fontes, conteúdo e layout estável, repaint antes de `capturePage`. Sem build; `dist` existente; um script por vez.

## Migrados (captura de sucesso)
Já na tarefa anterior: refined-workspace, semi-production, production-flows. Agora: agent-connection (1), agent-handoff (1), chat-deliveries (3), chat-interaction (1), completion (2), desktop-persistence (1), drafts-inbox (2), editorial-assets (2), editorial-flow (1), editorial-media (1), editorial-work (1), publications (4), runtime-controls (4). Sleeps fixos imediatamente antes da captura foram removidos; timeouts de negócio, fixtures e asserts não mudaram.
- `test-agent-comparison-ui.mjs`: usa `waitForCaptureReady` + `invalidate` e mantém o recorte `capturePage({x,y,width,height})` próprio.

## Não migrados / excluídos
- Capturas em blocos `catch` (`failure.png` etc.): continuam `capturePage` direto, para que uma falha nunca espere 10 s nem seja mascarada pelo helper.
- `export-brand-icons.mjs`: renderiza ícones, não o app (sem `#root`/splash).
- `test-chat-timing-ui.mjs`, `test-notion-automation-ui.mjs`: sem capturas.
- `test-ui-capture-ready.mjs`: fixture do helper.

## Testes (isolados, `npx electron`, sem IA real nem dados pessoais)
Passaram: agent-comparison, chat-deliveries, agent-connection, agent-handoff, chat-interaction, completion, desktop-persistence, editorial-assets, editorial-flow, editorial-media, editorial-work, publications, runtime-controls.
**Falha pré-existente:** `test-drafts-inbox-ui.mjs` expira em `until(...'.inbox-row' length === 3)` (linha ~56), antes de qualquer captura. Reproduzi com a versão original do HEAD (mesma falha, linha 55); não foi causada pela migração. Não corrigi (asserts preservados); possivelmente `dist` defasado em relação ao app. Suas duas capturas migradas não foram exercitadas.

## Limites
Não inspecionei visualmente todos os PNGs; a ausência de splash decorre da condição do helper (falharia por timeout). Suíte final/build ficam com o coordenador.
