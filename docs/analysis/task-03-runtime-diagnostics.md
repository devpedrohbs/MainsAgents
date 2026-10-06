# Tarefa 03 — Diagnóstico de capacidades (2026-10-06)

## Entregue
- `src/features/chat/runtimeDiagnosticsView.ts` (novo, puro): `codexRow`, `claudeRow`, `mcpRows`, `mediaRow` e `diagnosticsSummary`. Cada linha separa fatos em `yes/no/unknown/unchecked/restricted` e recebe um nível: Pronto, Leitura não verificada, Precisa de atenção, Restrito pelo app ou Ainda não verificado.
- `src/components/chat/RuntimeDiagnostics.tsx` (reescrito): cartões por Codex, Claude, cada servidor MCP e FFmpeg, com resumo `role="status"`, erro `role="alert"` e "Próxima ação" concreta.
- `src/components/chat/runtime-diagnostics.css` (novo): tokens atuais, grade `auto-fill` que vira uma coluna em telas estreitas, `focus-visible` nos `summary`. A classe nova evita os estilos densos de `runtime-actions.css`, que continua importado para aprovações e teste de leitura.
- `tests/runtime-diagnostics-view.test.mjs` (novo): 7 casos.

## Regras
- O cartão de cada MCP mostra Configurado → Conexão → Catálogo → Leitura real. Catálogo encontrado sem recibo fica "Leitura não verificada"; só `readEvidence` marca "Leitura real ✓", com data e agente.
- Antes do clique manual, tudo aparece como "Ainda não verificado". Não há verificação automática nem nova sonda.
- O Claude sempre mostra "MCP: Bloqueado pelo MainsAgents neste provedor". Conectado fica "Restrito pelo app", nunca "Pronto". Resposta malformada fica como "Não foi possível verificar".
- Próximas ações:
  - Codex: botões existentes "Entrar", "Verificar novamente" e "Reconectar", da seção logo abaixo.
  - Claude: `installCommand`/`loginCommand` vindos do próprio diagnóstico.
  - MCP com login pendente: `codex mcp login <nome>`.
  - Zernio/Publora: o "Preparar teste de leitura" existente.
  - Outros servidores: explica que não há teste sem IA.
- Preservados: aprovações e teste de leitura (`/api/codex/diagnostics/read-test`), histórico de aprovações, skills e dependências, e a lista de ferramentas brutas atrás de `<details>`.
- Status nunca depende só de cor: texto, ícone `aria-hidden` (✓ ✕ ? – ⊘) e estilo da borda.

## Validação
- `node --experimental-strip-types --test tests/runtime-diagnostics-view.test.mjs tests/runtime-capabilities.test.mjs tests/desktop-diagnostics.test.mjs`: 12/12 passaram.
- `npx tsc -b --pretty false`: exit 0.
- `npx vite build` e `npx electron scripts/test-runtime-controls-ui.mjs`: PASS. Esse script roda numa janela isolada, sem perfil pessoal, MCP externo ou inferência. Captura revisada em 880px: `.mainsagents-workspaces/runtime-controls-ui-test/diagnostics.png`.
- Limite: o fixture devolve o payload Codex também para o diagnóstico Claude, então o cartão Claude aparece corretamente como "Não foi possível verificar". Os demais estados foram cobertos só pelos testes puros, não por captura.
- Correção da revisão (tarefa 01): `productionProgress.ts` não usa mais ordem linear como evidência quando faltam eventos; fases anteriores ficam `unconfirmed`. Novo caso legado em `tests/production-progress.test.mjs` (7/7 passaram).
- Não editei `Settings.tsx`, `runtime-actions.css`, `runtime-capabilities.mjs` nem o backend.
