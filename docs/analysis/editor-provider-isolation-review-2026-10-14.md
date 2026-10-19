# Revisão independente — provider da conversa × diretor da edição e retomada da produção .67 (14/10/2026)

Tarefa `task_1022e16554d4` / dispatch `ctx_879d984af644`. Esta revisão foi **somente leitura**. Nenhum arquivo de implementação, teste ou dado pessoal foi alterado. O único arquivo criado é este relatório. Também não houve retomada da produção real, chamada de API, publicação, empacotamento ou commit.

- Implementação revisada: runtime `ctx_c94e9c5ac029` → `ctx_d4f823a0446e` (`.mjs` da raiz: editor, runtime e coordinator) e UI `ctx_967a66e91b3b` → `ctx_1a5ac0d11993` (`src` de chat/provider/production e testes de UI).
- Baseline: arquivos extraídos (só no scratchpad) do `app.asar` instalado da 0.3.67, sha256 `61e1246815cb589d2a22fc0194e283298e21a72b0868f419ae6702a560f94952` (conferido).
- Alvo: `production-8314f2f5-0885-4416-a249-7b4c7f263f68`, lido em modo `readOnly` de `~/.mainsagents/storage/workspace-state.sqlite`.

## Estado real do alvo (antes de qualquer retomada)

| Campo | Valor |
|---|---|
| stage / resumeStage | `blocked` / `planning-edit` |
| erro | `The editor reached its turn limit…` (bridge 0.3.67, `--max-turns` fixo em 20) |
| step | `…-planning-edit-1`, attempt 1, phase `streaming`, provider `claude` |
| orçamento da produção | 1/8 chamadas (`call-1` `failed`, mesma `budgetKey`), tentativas 1/2 |
| checkpoint | epoch 1, rev 3, revisionsUsed 2/2, previewsUsed 3/3, calls 22/60, visionBytes 9,5 MB/24 MB, `finalized:false` |
| QA | `sourceObserved:true`, `inspectedRevision:2`, 10/11 cenas cobertas da rev 3 (falta `fechamento`) |
| preview rev 3 | `preview-d3e5039165b1dccf` renderizado às 12:03:20Z e não inspecionado. O arquivo existe em `media/<perfil>/authoring/production-8314…-e1/preview-1e868b1a-….mp4`, e o sha256 começa com `d3e5039165b1dccf`. |
| diretor | `editDirector:{providerId:'claude'}`; `production_edit_directors` vazio (nenhum padrão de espaço gravado) |
| luz | O briefing (4846 caracteres) traz “NÃO MEXER NO BALANCEAMENTO DE LUZ” no caractere 748. A rev 3 não tem `spotlight`/`dim` (os 14 `scrim` são fundos de texto). O pipeline não aplica filtro de cor (sem `eq`/`curves`/`lut`). |

## Verificado como correto (com evidência)

1. **Retomada mantém revisão, plano e orçamentos.** `planAuthoredEdit` reabre a mesma sessão de host a partir do checkpoint da mesma época/autoridade. O teste isolado, feito sobre o checkpoint real e o arquivo real (sem escrita), deu `prepare()` → `restored:["preview-d3e5039165b1dccf"]`, `missing:[]` e checkpoint com rev 3, calls 22, revisionsUsed 2 e previewsUsed 3 intactos. Já `editorContinuation` deu `continue:true`, com `callsLeft 38`, `revisionsLeft 0`, `previewsLeft 0`, `uncoveredScenes:["fechamento"]` e `previewInspected:false`. Na continuação, `--max-turns` passa a ser 40.
2. **QA não vira afirmação falsa.** No mesmo teste isolado, `finalize` da rev 3 foi recusado com `qa_required`: “Preview preview-d3e5039165b1dccf of revision 3 was rendered but not inspected…”. Quando o preview não pode ser restaurado, o finalize registra `previewBudgetExhausted` e não marca `previewInspected`. Antes, na 0.3.67, os previews não entravam no checkpoint, então a retomada perdia o preview da rev 3 e finalizava só com a limitação.
3. **Detecção legada da parada por turnos bate com os dados da .67.** `turnLimitStop` exige a mesma etapa (`…-planning-edit-1`), a chamada `failed` com a mesma `budgetKey`, o evento `blocked` com o texto exato do bridge (diferença de 1 ms) e um checkpoint da época. Os três conferem no registro real. A continuação roda numa etapa nova (`…-c1`), então não há conflito de `step.prompt` (“A entrada desta etapa mudou”) nem reuso de `budgetKey`.
4. **Hard limit controlado, sem loop.** Há no máximo 3 continuações por época. Cada continuação automática exige progresso medido no checkpoint, `callsLeft ≥ 3` e uma chamada reservada no orçamento da produção (8). Nada disso é reembolsado ou reiniciado. Uma falha que não é de limite de turnos continua exigindo reenvio explícito. Testes: `tests/editor-turn-limit.test.mjs` (12 casos, entre eles cap por época, sem progresso, legado e troca de diretor).
5. **Export final no máximo uma vez.** `finalExport` recusa uma segunda exportação (`p.videoJobId`). `planAuthoredEdit` segue o job existente. O laço de continuação também para se o finalize ocorreu no último turno (`editor-turn-limit-after-finalize`). A retomada em `editing` reaproveita o mesmo job (`media.retry`).
6. **Diretor por produção não altera o padrão.** O `INSERT OR REPLACE production_edit_directors` saiu de `set-edit-director` (estava na 0.3.67). A ação `video` aceita `input.director` só para a run, e o padrão do espaço muda apenas pelo endpoint próprio.
7. **Provider da conversa: escolha reversível e sem envio.** `providerSwitchPlan`/`bindingLock` (`src/features/chat/providerChoice.ts`) só permitem `in-place` numa conversa sem mensagens, thread (`remoteSessionId`/`codexThreadId`/`previousCodexThreadId`/`threadRecoveries`), comparação, handoff ou produção (`productionContext` ou sessão source/editor/publisher de qualquer run). Conversa ocupada, por resposta própria ou por job nativo `queued`/`running`, fica `blocked`. `ChatProvider.setSessionProvider` repete a checagem na sessão viva antes de trocar. O caminho `new-chat` cria a conversa no mesmo conteúdo com uma cópia do rascunho, e a conversa antiga fica intacta. O chip “Edição: …” vem de `run.editDirector` e nunca é inferido do provider do chat.
8. **Luz.** Com as revisões esgotadas (2/2), a continuação não pode escrever plano novo. O plano da rev 3 não tem controle que altere a iluminação. O requisito chega ao editor por `get_context`, porque o briefing é truncado em 8000 caracteres e o requisito está no 748.

## Achados

| # | Gravidade | Dono | Achado | Estado |
|---|---|---|---|---|
| R1 | alta (critério) | runtime | `set-edit-director` gravava o padrão do espaço (`production_edit_directors`), o que viola “diretor por produção não altera default”. | **corrigido** (diff atual) |
| R2 | alta (retomada .67) | runtime | A recuperação do preview legado dependia de `authoringRoot`, que o coordinator não passava. Sem isso, a .67 finalizaria com `previewBudgetExhausted`. | **corrigido**: `authoringRoot = storage/media/<perfil>/authoring` confere com o disco |
| R3 | média | runtime | `ai()` exige um prompt idêntico na mesma etapa, e `budgetKey` usa `maxAttemptsPerStep 2`. Uma continuação na mesma etapa quebraria ou esgotaria tentativas. | **corrigido**: etapa `-cN` própria, orçamento preservado |
| T1 | alta (testes) | runtime | Regressão: `claude-code-bridge.mjs:316` lia `.calls` de um checkpoint nulo, e `paper-design.test.mjs` falhava (701/702). | **corrigido** (`?.calls ?? 0`); suíte 703/703 |
| R4 | alta (retomada .67) | runtime + UI | Em run `blocked`/`paused`, escolher provider **ou modelo** no `EditDirectorField` chamava `set-edit-director` na hora. A ação tirava a run do bloqueio para `planning-edit` (etapa automática, `kick`), fazendo uma chamada real de IA sem passar pelas checagens do `resume`, e mudava o `authorityHash`. Com isso, o checkpoint rev 3/QA era descartado e o orçamento era reiniciado. | *ver revisão final* |
| U1 | baixa | UI | `ChatProvider.tsx:406`: as dependências do `useMemo` omitem `setSessionProvider`, então a troca in-place pode usar o modelo Codex padrão antigo. | *ver revisão final* |

## Revisão final

Concluída pelo Codex com autorização explícita do usuário para finalizar esta atualização após o limite semanal do Claude.

- R4 corrigido: uma escolha idêntica é no-op; mudar diretor/modelo em `blocked` ou `paused` conserva a parada até `resume`. `authoring.restartPending` explica que o próximo planejamento terá nova direção, sem prometer reutilizar QA de outra autoridade. O marcador é retirado ao retomar, e o plano anterior permanece como referência.
- U1 corrigido e verificado no renderer: a troca de uma conversa vazia usa o novo modelo padrão depois da mudança em Configurações.
- Produções antigas como a execução relatada recebem diagnóstico e execução efetiva na apresentação da API, somente com a prova durável de falha da mesma etapa/época/fonte/autoridade. Essa apresentação não grava produção nem envia IA; faltando prova, mantém o fluxo de interrupção incerta.
- Parada confirmada apresenta um único botão de retomada, sem checkbox de reenvio. Interrupções incertas conservam a autorização específica. Histórico, rascunho, conteúdo e provedor das conversas existentes ficam preservados.
- Validação: suíte completa 705/705; após a apresentação de diagnóstico legado, 58/58 testes afetados e typecheck; `PROVIDER_EDITOR_CHOICE_UI_OK` e `SEMI_PRODUCTION_UI_OK` com o build completo, SQLite/FFmpeg/Remotion reais e provedores simulados.
- A fixture semiautomática usa o motor de animação real e título animado declarado no retorno do editor simulado; fala sintética sem ênfase não garante cues dinâmicos. A verificação exige animação realmente aplicada, sem remover o bloqueio de motion do produto.

Sem bloqueadores de código identificados. A produção pessoal permanece bloqueada e não foi retomada, nem teve seu diretor alterado: o Claude está sem cota semanal. Instalação e prova de preservação ficam no relatório de release local.
