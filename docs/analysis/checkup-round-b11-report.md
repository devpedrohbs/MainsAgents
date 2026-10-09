# Checkup — B11: uso reportado pelo CLI (Sonnet)

Status: **código e testes do lado do bridge/orçamento/UI prontos; NÃO ligado de ponta a ponta.** Falta uma linha no `production-coordinator.mjs` (dono: Opus ctx_c0a6e0739fac). Até lá a UI mostra “indisponível”, nunca 0. Sem commit, sem dependências, sem IA real, sem ler históricos privados.

## Contrato para o dono do coordenador (necessário para fechar B11)
- `claude-code-bridge.mjs` publica **exatamente um** evento `{type:'usage.reported',executionId,usage}` por execução, **antes** do evento terminal (completed/failed/cancelled). `usage` já passou pela allowlist.
- `production-budget.mjs` exporta `recordUsage(p,callId,usage,at)`: idempotente (a primeira leitura vence), não altera contagem, limites, tentativas nem status da chamada.
- **Ligação pendente** em `production-coordinator.mjs`, no laço `for await (const event of rt.events(...))` (~linha 102): importar `recordUsage` e adicionar
  `if(event.type==='usage.reported')recordUsage(p,call.id,event.usage,stamp());`
  (o `put(p)` já existente persiste). Codex não emite o evento: fica “indisponível”, como deve.
- Nenhuma mudança em `content-workflow-bridge`, `desktop-main`, modelo global ou rotas. O tipo `ProductionBudgetCall.usage` está em `production-budget.d.mts`.

## O que o CLI informa (verificado)
Fontes: docs oficiais atuais (Agent SDK `SDKResultMessage`, “Track cost and usage”, “Run Claude Code programmatically”), consultadas em 08/10/2026; CLI local 2.1.294 (`--help` apenas, sem executar inferência). Campos usados da mensagem `result` do `stream-json`: `subtype`, `is_error`, `duration_ms`, `duration_api_ms`, `num_turns`, `total_cost_usd`, `usage{input_tokens,output_tokens,cache_creation_input_tokens,cache_read_input_tokens}`, `modelUsage{<modelo>:{inputTokens,outputTokens,cacheReadInputTokens,cacheCreationInputTokens,costUSD}}`; modelo de `system/init.model`. Avisos da doc incorporados: `output_tokens` por mensagem do assistente é placeholder (não é lido); `usage` exclui subagentes, `modelUsage` inclui (preferido); `total_cost_usd`/`costUSD` são **estimativas locais do cliente, não fatura**; resultado de erro após falha pode vir zerado.
Não consultei trace real: os testes usam fixtures sintéticas no formato documentado. Origem real do dado = só o stream do próprio CLI iniciado pelo app.

## Regras implementadas
- Estados: `reported` / `partial` (resultado de erro, pode estar incompleto) / `unavailable` (sem resultado, cancelado, timeout, não informado, erro zerado). Campo ausente fica ausente (nunca 0); sem número válido → `unavailable`.
- USD só se o CLI informar; rotulado “Custo reportado pelo CLI … estimativa local; não é fatura nem saldo”. Nenhuma tabela de preços.
- Dados por produção (perfil) → chamada (etapa/tentativa já existentes) → `usage`; histórico limitado às 200 chamadas do ledger e 10 linhas na UI; 4 modelos por chamada; allowlist e limites numéricos; `sanitizeBudget` preserva só uso bem formado com `recordedAt`.
- Preservado: contagem de chamadas, limites por tentativa, idempotência, cancelamento e autenticação nativa (nenhuma mudança nos argumentos/spawn do CLI nem em login).

## UI (`ProductionBudget.tsx`)
Tokens reportados (entrada/saída/cache), quantas chamadas informaram, quantas ficaram sem relatório/possivelmente incompletas, custo reportado quando existe, e “Uso por etapa e tentativa” com provedor configurado, **modelo real** quando informado e motivo de indisponibilidade. Quando nada foi informado: “Indisponível … nada é estimado”. Papéis, agentes e modelo padrão não foram tocados.

## Verificação
- `tsc -b` limpo; 70 testes focados passam (novos: `claude-usage` 8, `production-usage` 9; mais budget, bridge, mcp-approvals, teleprompter, recording-package, coordinator, backup).
- Harness Electron real e isolado (`scripts/test-checkup-b01-b02-b08-ui.mjs`, estendido): modal com uso reportado/parcial/indisponível e produção sem uso; 0 mutações, 0 requisições externas, 0 erros.
- Limites: sem ensaio com CLI real (B06 pendente); o evento só chega ao ledger depois da ligação no coordenador; `usage` ignora subagentes (por isso `modelUsage` é preferido).

## Arquivos
Novos: `claude-usage.mjs`, `tests/claude-usage.test.mjs`, `tests/production-usage.test.mjs`. Editados: `claude-code-bridge.mjs`, `production-budget.mjs`, `production-budget.d.mts`, `ProductionBudget.tsx`, `production-budget.css`. `production-runtime.mjs` não precisou mudar (os eventos passam por `chat.events`).
