# Tarefa 07 — Estado da comparação Codex × Claude (2026-10-06)

## API pública (`useChat()`)
- `comparisons: readonly AgentComparison[]`: só pares completos e consistentes, do mais recente para o mais antigo.
- `comparisonId: string | null`: vira `null` se a seleção não existir mais.
- `showComparison(id: string | null)`
- `startComparison({codexAgentId, claudeAgentId, briefing, context?}) => Promise<AgentComparison>`: resolve depois que as duas sessões foram salvas e as duas execuções iniciadas. Não espera as respostas finais e já seleciona a comparação.
- `AgentComparison` (exportado de `src/features/chat/agentComparison.ts`): `{id, workspaceId, title, briefing, codexAgentId, claudeAgentId, codexSessionId, claudeSessionId, createdAt}`.

## Implementação
- `agentComparison.ts` (novo, puro):
  - `validateComparison`: briefing não vazio com até 20 000 caracteres, até 20 itens de contexto válidos, dois agentes distintos e existentes no mesmo workspace, provedores exatos `codex` (ou ausente) e `claude`, os dois registrados no app.
  - `comparisonSessions`: sessões novas com o provedor e o modelo de cada agente (Codex usa o modelo do agente ou o padrão do Codex) e sem `agentConnection`.
  - `deriveComparisons`: exige o par completo, metadados idênticos dos dois lados, papéis e provedores corretos e os dois agentes ainda no workspace gravado.
  - `createComparisonLauncher`: valida → `persist` (salva o par) → chama `execute` duas vezes de forma independente (`Promise.allSettled`). Pedidos idênticos repetidos reaproveitam o mesmo lançamento até as duas execuções terminarem.
- `model/Chat.ts`: novo `AgentSession.comparison?: SessionComparison` (a comparação + `role`), salvo nas duas sessões. O backup atual já preserva as sessões inteiras; o restore não dispara nada.
- `ChatProvider.tsx`:
  - `persist` registra o par em `pendingSessions`, `sessions` (store síncrono), sessões ativas e `runStates`, e depois chama `await saveNow()`.
  - `execute` é o `executeMessage` existente, com o agente e o modelo de cada lado (instruções e skills próprias preservadas).
  - Falhas aparecem no chat de cada sessão e o irmão continua. Cancelar, continuar e `getRunState` não mudaram. Não há troca de thread nem fusão de respostas.
  - Sessões de comparação não delegam automaticamente para outros agentes, a menos que o usuário ative uma conexão explicitamente (`targets=[]`).

## Validação
- `node --experimental-strip-types --test tests/agent-comparison.test.mjs tests/backup.test.mjs tests/agent-handoff.test.mjs`: 21/21 passaram. São 6 testes novos, com provedores simulados:
  - padrões e regras de validação;
  - modelos de cada agente preservados, sem conexão automática;
  - persistência antes do envio, entradas idênticas (cópias separadas) e resolução sem esperar as respostas;
  - duplo clique gera uma única persistência e um envio por provedor, e a falha síncrona do Codex não cancela o Claude;
  - falha ao salvar não envia nada;
  - backup ida e volta reabre o par sem reenviar; irmão apagado, agente movido ou apagado e metadados adulterados ficam ocultos.
- `npx tsc -b --pretty false`: exit 0.
- Não testei o `ChatProvider` renderizado (sem harness React neste escopo). A ligação ficou fina: só `persist` e `execute`.
- Não houve chamadas pagas nem mudanças em ChatPanel, App, produção, carrosséis ou políticas de runtime.
