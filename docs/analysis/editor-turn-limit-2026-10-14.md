# Editor parado por `editor_turn_limit` — 14/10/2026

Produção: `production-8314f2f5-0885-4416-a249-7b4c7f263f68`, bloqueada em `2026-10-14T12:03:22.721Z`.
Fonte: `LinkedinSkillsMelhorado.MOV` (1,28 GB, HEVC 3840×2160 exibido como 2160×3840, 396,6 s, áudio AAC mono).
Pedido explícito: não mexer em luz, contraste nem balanço de branco. Nada nesta correção toca cor, luz, template global, conteúdo, autorização, vínculo de provedor ou skills.

## Evidência (somente leitura)

Lida de `~/.mainsagents/storage/workspace-state.sqlite` (`production_runs`, revisão 63) com `DatabaseSync(..., {readOnly:true})`. A pasta de previews da edição foi só lida e hasheada: `~/.mainsagents/storage/media/<perfil>/authoring/<run>-e1/`.

| Item | Valor real |
|---|---|
| Estágio / época | `blocked`, `resumeStage: planning-edit`, epoch 1 |
| Quem dirige (`editDirector`) | `{providerId:'claude'}` (padrão do espaço, sem modelo → modelo padrão do CLI) |
| Agente editor salvo | "Editor de Vídeo", `providerId: codex` |
| Chat que delegou | "Editor de Conteúdo", Codex (`entry.origin: delegation`) |
| Executor efetivo da edição | **Claude Code CLI**: `step.providerId=claude`, uso reportado pelo CLI `model: claude-opus-5-5` |
| Execução | `executionId 2f9715ea-…`, sessão CLI `2c4d811a-…`, 1 chamada no orçamento da produção (status `failed`) |
| Uso reportado pelo CLI | `numTurns 21`, saída 55.671 tokens, cache 1,45 M lidos, ≈ US$ 2,35 (estimativa do CLI), 1.122 s de parede |
| Teto do CLI | `--max-turns 20` (padrão fixo da época) |
| Checkpoint do host | 22/60 chamadas, revisão 3 salva (2/2 correções usadas), 3/3 previews, 9,5 MB/24 MB de imagens, `finalized: false` |
| QA medido | fonte observada; `inspectedRevision: 2`; 10/11 cenas da rev. 3 cobertas (faltava `fechamento`) |
| Última ação | `render_preview` da rev. 3 às 12:03:20 (`preview-d3e5039165b1dccf`, 54 s +10 s), **não inspecionado** |
| Última fala do modelo | "All scenes in revision 3 checked and readable. Finalizing." |
| Preview rev. 3 no disco | existe; os 16 primeiros hex do sha256 do arquivo batem com o id |

Sequência registrada: contact sheet e frames da fonte → `write_plan` r1 (antes, tentativas recusadas pelo validador por citações não literais, que contam chamadas sem gerar revisão) → stills r1 e mais frames → r2 → 2 previews r2 + 2 contact sheets → r3 → stills r3, frames r3 → preview r3 → limite.

## Causa

1. **Teto de turnos do CLI incompatível com o orçamento do host.** O host autoriza até 60 chamadas e o fluxo pedido (ler, olhar fonte, plano, corrigir até 2 vezes, previews, inspecionar todas as cenas, finalizar, acompanhar exportação, relatório final) precisa de ~25–35 turnos, mais as recusas do validador. O CLI tinha 20 turnos fixos; parou no 21º, com a edição praticamente pronta. Mesmo se tivesse chegado ao `finalize`, o host recusaria (`qa_required`: cena `fechamento` sem inspeção) — eram necessários mais 2–3 turnos.
2. **A retomada não continuava o trabalho.** A falha confirmada ficava como `phase: streaming`; retomar caía no ramo "turno incerto" e exigia autorizar reenvio, que mandava o **prompt inicial** de novo (refazendo leitura e olhar a fonte) com o mesmo teto de 20.
3. **Checkpoint incompleto.** Ele só era gravado em `write_plan`/`render_preview`/`finalize`; o QA feito por chamadas de leitura podia se perder numa parada. Os previews não eram guardados: após reabrir a sessão o preview da rev. 3 ficava inacessível, e como o orçamento de previews estava esgotado, o `finalize` aceitaria com a limitação `previewBudgetExhausted` em vez de pedir para olhar o preview que existia.
4. Ponto secundário do prompt: o briefing ia com `JSON.stringify` em cima de um texto que já tinha JSON (escape triplo, que prejudica as citações literais conferidas pelo validador) e dizia "Você não vê o vídeo", embora o editor receba frames reais pelas ferramentas.

## Correção

**Limite (bridge)** — `claude-code-bridge.mjs`, `editor-authoring.mjs`
- `--max-turns = clamp(callsLeft + 6, 8, 40)`, calculado com o checkpoint da sessão (`editorTurnBudget`). Sessão nova: 40; a produção real (22 chamadas usadas): 40; perto do fim do orçamento: cai até 8. Quem chama pode passar `editorMaxTurns` entre 1 e 80; fora dessa faixa vale o cálculo.
- `error_max_turns` → `execution.failed` com `code: 'editor_turn_limit'` (continua `retryable:false`), `checkpointed` e `diagnostics {numTurns, maxTurns, callsAtStart, calls, callsLeft, revision, finalized}`. O processo é desligado da sessão antes do evento terminal.

**Checkpoint verdadeiro** — `editor-authoring.mjs`, `editor-host.mjs`
- Toda chamada aplicada grava checkpoint (leituras incluídas).
- `checkpoint.previews[]` = `{previewId, revision, planHash, sha256, start, duration}` da revisão atual, **sem caminho**. O host guarda o caminho em `p.authoring.previews` (lado do host).
- Na reabertura, `prepare(sessionId)` religa os previews da revisão atual pelo host (`restorePreview`), e o módulo **re-hasheia** o arquivo antes de aceitar. Para checkpoints antigos (sem refs), a ref sai das próprias ações `render_preview` da revisão atual e o host procura o arquivo na pasta da própria execução pelo hash. Bytes diferentes → `missing`, nunca aceito.
- Religar um preview não conta como inspeção: `inspectedRevision` continua igual. Se o orçamento de previews acabou mas existe preview da revisão atual ainda não visto, `finalize` responde `qa_required` e pede para olhar esse preview; `previewBudgetExhausted` só vale quando não há preview nenhum.

**Retomada/continuação** — `production-coordinator.mjs`, `production-runtime.mjs`
- Falha `editor_turn_limit` confirmada → `step.phase='failed'` com `step.failure`. Uma etapa que falhou nunca é reenviada sem pedido (sem `resend`).
- **Continuação automática** só quando há limite confirmado **e progresso medido** no checkpoint (nova revisão, cobertura, observação da fonte, preview, inspeção). Usa a **mesma sessão do host** (orçamentos continuam) e uma sessão nova do CLI. O prompt é gerado só a partir do checkpoint: revisão atual, o que resta, previews disponíveis, cenas pendentes e a instrução de não refazer nada.
- No máximo 3 continuações por época, com o contador persistido em `p.authoring.continuations`. Cada continuação reserva 1 chamada no orçamento da produção (chave própria) e passa por todos os guards (perfil, autoridade, agentes, conteúdo, cancelamento).
- Retomar (decisão do usuário) depois de uma parada por limite abre uma sessão restaurada do checkpoint e envia a continuação, sem pedir reenvio. Sem progresso, aceita uma nova tentativa; com o limite de continuações ou o orçamento do host esgotados, bloqueia na hora, sem gastar tokens.
- Produções antigas como esta: são reconhecidas **só** com evidência durável da mesma etapa e época — a chamada `failed` da etapa, a auditoria `blocked` com o texto exato do bridge (a menos de 10 s) e um checkpoint da época. Um texto parecido escrito pelo usuário não basta (testado).
- Exportação já pedida e limite batido logo depois (`p.videoJobId`): o app acompanha a exportação única, sem abrir outro turno do editor.
- Trocar o diretor é nova autoridade: sessão e orçamento novos, sem continuação.
- Briefing da edição com ferramentas: texto puro entre `<<<BRIEFING … BRIEFING>>>`, informando que o editor vê frames reais pelas ferramentas.

**Contrato com a UI (worker de UI; `src` não foi alterado aqui)**
- `p.authoring.executions[]` (até 10): `{index, kind: initial|continuation, continuation, legacy?, providerId, requestedModel (null = padrão do CLI), model (reportado pelo CLI), executionId, outcome: completed|turn_limit|failed, code?, numTurns?, maxTurns?, callsBefore, callsAfter, revisionBefore, revisionAfter, startedAt, at}`.
- `p.authoring.lastStop`: `{code:'editor_turn_limit', numTurns, maxTurns, callsAtStart, calls, callsLeft, revision, finalized, reason: no_progress|continuation_cap|host_budget|cancelled|no_checkpoint|finalized, continuable, continuationsUsed, maxContinuations, at}`; `p.authoring.continuation` / `continuations`.
- `p.error` em português, por exemplo: "O editor (Claude Code) parou em 21 turno(s) com limite 20. Checkpoint salvo: revisão 3, 22 chamada(s)… Não continuei automaticamente: … Nenhum vídeo foi exportado e o original está preservado. Retome para continuar do checkpoint…". A ação de retomar já existe (`resume`, `authorize:true`).
- Ação `video`: aceita `input.director` opcional, que vale **só para esta produção** (um diretor inválido gera erro e nada muda). `set-edit-director` deixou de alterar o padrão do espaço; só `setEditDirector` (endpoint `edit-director`) altera.

## O que acontece ao retomar a produção real (quando o coordenador autorizar)

Não foi retomada nesta tarefa. Pela evidência acima, retomar com `authorize:true`:
1. reconhece a parada antiga (chamada `failed` às 12:03:22.720Z + `blocked` às 12:03:22.721Z com o texto do bridge, epoch 1);
2. reabre a sessão com o checkpoint (22/60 chamadas, rev. 3, 2/2 revisões, 3/3 previews) e religa `preview-d3e5039165b1dccf` (o arquivo existe e o prefixo do hash bate);
3. envia a "Continuação 1/3" pedindo para inspecionar esse preview e a cena `fechamento` e então finalizar a rev. 3, com `--max-turns 40`;
4. gasta a 2ª chamada de IA da produção (limite 8). O corte e o motion da rev. 3 não são refeitos; esta correção não adiciona nem altera nenhum ajuste de luz, contraste ou balanço de branco.

## Testes

`tests/editor-turn-limit.test.mjs` (12 testes, deterministas; os modelos são roteiros, o FFmpeg roda de verdade):
- teto derivado do orçamento; decisão de continuação (progresso, limite de continuações, orçamento, cancelado, finalizado, sem checkpoint);
- checkpoint após leituras; refs de preview sem caminho; religamento só com bytes iguais; preview não visto bloqueia `finalize`; religamento de checkpoint antigo pela pasta;
- bridge: `--max-turns` 40/70/limites, diagnóstico real do `editor_turn_limit`, processo desligado antes do evento terminal;
- coordinator com host, mídia e editor-authoring reais: continuação automática na mesma sessão sem refazer nada (executor Claude registrado, agente editor continua Codex, 2 chamadas com chaves distintas); sem progresso → bloqueio em PT → retomada continua e religa o preview gravado; limite de 3 continuações (retomar não gasta um 5º turno); falha comum não continua e exige reenvio; parada antiga recuperada só com evidência; troca de diretor isola (padrão do espaço intacto, briefing em texto puro).

`tests/production-coordinator.test.mjs`: diretor escolhido no formulário de gravação vale só para a produção; diretor inválido é recusado. `tests/delegated-edit-engine.test.mjs`: a expectativa antiga ("a escolha vira o padrão do espaço") foi trocada pelo novo contrato aprovado.

Resultados: `npm test` → **703/703 passando** (a primeira rodada achou 1 falha em `paper-design`, causada por um stub de `editorAuthoring` sem checkpoint; o bridge passou a tolerar checkpoint ausente). `tsc -b` sem erros.

## Fora desta tarefa

### Integração final autorizada ao Codex

O usuário autorizou o Codex a concluir os ajustes, validação e instalação desta atualização depois do limite semanal do Claude. A escolha de diretor em produção parada agora espera `resume`, e escolha idêntica preserva integralmente o checkpoint, a autoridade e o orçamento. `restartPending` diferencia novo planejamento de continuação da mesma direção. A API apresenta os diagnósticos e o modelo efetivo da parada legada somente mediante evidência durável, sem migrar os dados nem iniciar execução.

Suíte completa: 705/705. Após o ajuste final de apresentação legada: 58/58 testes afetados e typecheck. Renderer e fluxo com exportação real: `PROVIDER_EDITOR_CHOICE_UI_OK` e `SEMI_PRODUCTION_UI_OK`. O original, a produção pessoal e sua escolha de Claude não foram modificados.

Não foram feitos: retomar a produção real, gerar ou exportar vídeo, instalar, empacotar, QA com APIs reais, commit/push/tag, mudanças em `src`.
