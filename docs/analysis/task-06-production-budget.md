# Tarefa 06 — Limite de chamadas de IA por produção (2026-10-06)

## Backend
- `production-budget.mjs` (+ `.d.mts`): padrão de **8 chamadas por produção e 2 tentativas por etapa**. Faixas validadas: 1–40 chamadas e 1–5 tentativas, só inteiros.
- **Livro de chamadas:** cada chamada passa por `reserved → sent → completed | failed | uncertain`, e um envio `uncertain` ainda pode virar `completed` se o turno for recuperado. Uma reserva nunca é devolvida.
- `production-coordinator.mjs`, função `ai()`:
  - **Reserva antes do envio:** `reserveCall` grava a chamada (`put`) *antes* de `rt.send`. Falha no envio ou fim sem confirmação → `uncertain`; `execution.failed` → `failed`. Os dois continuam contados.
  - **Turno recuperado:** se o turno salvo já terminou, a mesma reserva vira `completed`, sem nova chamada.
  - **Tentativas:** a chave da etapa é `step.id + hash do prompt`, então cada capa e cada nova revisão (`epoch`) é uma etapa própria. O total da produção vale para todas.
- **No limite:** `drain` pausa (`paused`) com `budgetStop {kind, limit, used}`, um motivo claro ("Nada foi enviado") e o evento `budget-limit`. Nada é reenviado automaticamente.
- **Retomar** é recusado enquanto o limite ainda impedir a continuação.
- **Novo comando `adjust-budget`:**
  - exige `authorize:true`, `reviewedCalls` igual ao uso atual e limites válidos;
  - só funciona com a produção pausada ou esperando você (nunca durante uma etapa automática nem depois de concluída ou cancelada);
  - grava o evento `budget-limits` (antes→depois);
  - não retoma: o usuário precisa clicar em "Retomar".
- **Ao iniciar:** `start` aceita `budget` opcional validado.
- **Produções antigas:** ganham um orçamento `legacy`, com `measuredSince` na primeira chamada nova. O uso anterior aparece como "não medido", sem totais inventados.
- **Backup:** `production-backup.mjs` passa o orçamento por `sanitizeBudget`. Se estiver malformado, é descartado e aparece como não medido. Importados continuam sem autorização.
- `package.json`: só `production-budget.mjs` foi adicionado em `build.files`, autorizado pelo coordenador.

## UI
- `ProductionBudget.tsx` e `production-budget.css` (novos), integrados abaixo do `ProductionProgress` no `ProductionDialog.tsx` (1 import e 1 elemento; rascunhos, consentimentos e progresso intactos). O tipo do orçamento foi adicionado ao `model.ts`.
- **O que mostra:**
  - chamadas usadas, limite e quantas restam (com `<meter>`);
  - concluídas, falhas (contadas), envios incertos (contados), em andamento e tentativas da etapa atual;
  - "Tokens e custo: indisponíveis", porque o runtime atual não informa esse uso;
  - aviso de uso legado não medido e alerta `role=alert` quando pausada no limite.
- **Ajustar limites:** campos numéricos com a faixa permitida e a confirmação "Revisei o uso atual". Salvar não retoma a produção.

## Validação
- `node --experimental-strip-types --test tests/production-*.test.mjs tests/backup.test.mjs`: 39/39 passaram.
- **Testes novos:** `production-budget.test.mjs` (5) e 2 integrações em `production-coordinator.test.mjs`:
  - limite de chamadas: nenhum envio extra, retomar recusado, faixas inválidas e uso desatualizado rejeitados, aumento sem retomar automaticamente, depois continua;
  - incerteza após reinício: o envio incerto é contado, o reenvio para no limite de tentativas e reabrir o app não zera nada.
- `npx tsc -b --pretty false`: exit 0.
- **UI isolada:** `npx electron scripts/test-semi-production-ui.mjs` falha em "Minha conta de teste" (escolha de conta Zernio). A falha **é anterior** a esta tarefa: reproduzi a mesma falha com o diálogo da task2 sem o componente. A captura `video-review.png` mostra o componente renderizado corretamente.
