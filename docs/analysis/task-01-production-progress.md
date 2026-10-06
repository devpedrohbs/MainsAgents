# Tarefa 01 — Progresso da produção (2026-10-06)

## Entregue (somente arquivos novos)
- `src/features/production/productionProgress.ts`: mapeamento puro `productionProgress(run, pt)`. Agrupa as 13 etapas lineares de `production-protocol.mjs` em 6 fases: Roteiro, Gravação, Edição, Capas e legendas, Agendamento e Concluído.
- `src/components/production/ProductionProgress.tsx`: exporta `ProductionProgress({run, pt})` e importa o próprio CSS.
- `src/components/production/production-progress.css`: usa os tokens atuais (`--surface`, `--border`, `--accent`, `--success`, `--warn`, `--danger`, `--muted`). A grade se ajusta à largura e vira uma coluna abaixo de 520px.
- `tests/production-progress.test.mjs`: 7 casos (ativa, revisão, sem evidência, pausa, cancelamento/importada, interrompida sem local, desconhecida/concluída).

## Regras de honestidade
- Uma fase anterior só fica `completed` se o rastro de auditoria tiver um evento da etapa dela. O coordenador grava `audit(p, stage)` a cada `setStage`.
- Sem esse evento, a fase fica `unconfirmed` ("Sem registro de conclusão"). Isso vale também para runs sem nenhum evento (legados): a ordem linear sozinha não conta como evidência. Só o estágio `complete` marca todas as fases como concluídas (correção pedida na revisão do coordenador).
- Pausa e bloqueio usam `resumeStage`. Se ele faltar, usam o último evento de etapa.
- Cancelamento usa primeiro o rastro de auditoria, porque `cancel` não define `resumeStage` e o valor pode ser de uma pausa antiga.
- `idea-approved` conta como início em `writing`.
- Sem evidência do local da parada, nenhuma fase fica marcada e o texto diz "Não há registro confiável da etapa em que parou".
- `run.error` aparece como "Motivo registrado". Runs importados não oferecem retomada.
- Etapa desconhecida aparece como "Estado desconhecido", com o código da etapa e a orientação de abrir a conversa.
- Não há percentual de conclusão.

## Acessibilidade
- `<section aria-label>` com uma `<ol>` semântica e `aria-current="step"` na fase atual ou parada.
- Cada fase tem texto oculto "Etapa N de 6" para leitor de tela.
- O status nunca depende só da cor: há texto ("Concluída", "Etapa atual", "Parou aqui" etc.), ícone (✓ ● ‖ ? ○, com `aria-hidden`) e borda tracejada em parada ou sem registro.
- A próxima ação fica em `role="status"`, ou `role="alert"` quando bloqueada.

## Validação
- `node --experimental-strip-types --test tests/production-progress.test.mjs`: 7/7 passaram.
- `npx tsc -b --pretty false`: nenhum erro nos arquivos novos. Os 3 erros restantes estão em `ProductionDialog.tsx` (linhas 42, 43 e 70), que pertence à integração em andamento do outro agente e está fora deste escopo.
- Não testei o componente renderizado na interface (falta a integração no diálogo).

## Integração pendente (do agente dono do diálogo)
- `import {ProductionProgress} from './ProductionProgress'` e renderizar `<ProductionProgress run={run} pt={pt}/>` no topo de `production-panel-body` quando houver `run`.
