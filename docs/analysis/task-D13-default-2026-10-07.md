# D13 — Padrão explícito do provedor na comparação do mesmo agente (07/10/2026)

Complementa [task-D13-core-2026-10-07.md](task-D13-core-2026-10-07.md). Mudei apenas `src/features/chat/agentComparison.ts` (`chooseModel` e um comentário do tipo) e `tests/agent-comparison.test.mjs`.

## Problema

A UI orienta escolher “padrão” quando o modelo salvo do agente não está confirmado. Mas `codexModelId`/`claudeModelId` omitidos herdavam `agent.modelId` no provedor do próprio agente. Por isso, escolher o padrão reenviava o modelo salvo e possivelmente obsoleto.

## Contrato (modo `same-agent`, por lado)

| Valor enviado | Significado | Codex | Claude |
| --- | --- | --- | --- |
| `'model-id'` (válido, `^[a-zA-Z0-9_.:[\]-]{1,120}$`) | esse modelo exato (o catálogo opcional ainda valida) | `model-id` | `model-id` |
| `''` | **padrão explícito do provedor**; nunca usa `agent.modelId` | `defaultCodexModelId` configurado no app, se houver; senão padrão da CLI | padrão da CLI |
| omitido | compatibilidade: o modelo salvo do agente só no provedor dele; no outro, o padrão | `agent.modelId` se o agente for Codex | `agent.modelId` se o agente for Claude |

- `''` passa pelo catálogo sem rejeição. Qualquer outro valor inválido (`' '`, `'bad model!'`, `null`, números) continua rejeitado.
- No Codex, `''` usa o `defaultCodexModelId` global do app. É a configuração padrão do Codex escolhida pela pessoa, não o modelo salvo do agente. Se o app não tiver um, a sessão vai sem modelo e a CLI decide.
- **Metadados:** `codexModelId` e `claudeModelId` gravam o modelo resolvido, ou `''` quando é o padrão da CLI. O `modelId` da sessão é o mesmo valor, ou `undefined`. `deriveComparisons` compara `(session.modelId ?? '')` com os metadados, então pares no padrão reabrem, inclusive após backup.
- **Fingerprint:** usa os modelos resolvidos. `''` e o modelo salvo geram comparações distintas quando o efeito difere. Valores com o mesmo efeito, como Claude omitido ou `''` num agente Codex, reaproveitam o mesmo lançamento.
- A API legada de dois agentes não mudou.

## Para a UI (Codex)

No modo `same-agent`, enviar `codexModelId`/`claudeModelId` sempre como string: `''` para “Padrão do provedor” e o ID escolhido para os demais. Omitir só se quiser o comportamento antigo.

## Validação

- `tests/agent-comparison.test.mjs`: 11/11. O teste novo cobre:
  - modelo salvo obsoleto com `''` usando o padrão;
  - omissão mantendo o fallback;
  - catálogo e IDs inválidos;
  - sessões e metadados com e sem padrão Codex configurado;
  - reabertura, inclusive após backup;
  - fingerprints e no máximo duas chamadas por comparação distinta.
- `npm test`: 298/298. `npx tsc -b`: exit 0.
