# Provedor da conversa × diretor da edição (14/10/2026)

## Problema

O usuário pediu para trocar Codex/Claude na hora, por agente, e estranhou ver o chat do editor em Codex enquanto a edição era dirigida por Claude. As duas escolhas são distintas e corretas: o chat roda no provedor ligado àquela conversa, e a edição roda no diretor escolhido na produção (`run.editDirector`). A interface, porém, não deixava isso claro:

- O botão “Gerar com” só aparecia no composer e sempre abria uma conversa nova, mesmo quando a conversa ainda estava vazia.
- O diálogo dizia “Produção semiautomática continua usando Codex”, o que já não era verdade.
- A produção mostrava o diretor no lugar do provedor do papel de edição, misturando as duas informações.
- Na etapa de gravação, mudar o diretor gravava o padrão do espaço, e não a escolha desta produção.

## O que mudou

### Chat (header de cada agente)

- O header mostra chips curtos: **`Conversa: Codex`**. Quando a conversa acompanha uma produção, aparece também **`Edição: Claude`**. O modelo fica no tooltip.
- O chip de edição vem de `run.editDirector`. Antes do envio do vídeo, mostra o padrão do espaço como `Edição: Claude (padrão)`. Na edição básica, mostra `Edição: básica`. Ele nunca é inferido do provedor do chat e abre a produção quando clicado.
- Clicar em `Conversa: …` abre o `ProviderChoice` existente, agora com um plano calculado por `providerSwitchPlan` (em `src/features/chat/providerChoice.ts`):
  - **`in-place`**: a conversa nunca falou com um provedor. Isso exige que ela não tenha mensagens, thread (`remoteSessionId`, `codexThreadId`, `previousCodexThreadId` ou `threadRecoveries`), comparação, handoff nem produção. Nesse caso, o botão “Usar Claude nesta conversa” troca o provedor da própria conversa. O rascunho continua no mesmo slot e nada é enviado.
  - **`new-chat`**: a conversa tem histórico ou vínculo. O botão “Abrir nova conversa com Claude sem enviar” cria uma conversa no mesmo conteúdo, com uma cópia do rascunho. A conversa antiga mantém o histórico, a thread e o provedor.
  - **`blocked`**: a conversa está respondendo ou tem trabalho nativo `queued`/`running`. O chip fica desabilitado e nada muda.
- `ChatProvider.setSessionProvider` repete a verificação sobre a sessão viva (`inFlightSessions` + `delegationBusy`) e recusa com erro qualquer rebinding incompatível. Sessões de produção (origem, editor e publicador) entram pela lista `productionSessionIds(runs)`.
- Em views embutidas (`sessionId`), o chip é somente leitura. Nenhuma troca mexe no perfil do agente nem em conversas em background.

### Produção

- “Quem executa cada papel” virou duas linhas:
  - **Conversa de cada papel**: provedor e modelo da sessão de cada papel.
  - **Direção de cortes/motion**: o que está em `run.editDirector`, a escolha pendente desta produção ou “padrão do espaço, definido ao enviar o vídeo”.
- `EditDirectorField` agora tem modelo:
  - Um seletor de modelo usa o catálogo do provedor escolhido. A opção padrão é o modelo do agente editor quando o provedor é o mesmo, ou o padrão do CLI quando não é.
  - Trocar de provedor zera o modelo, então um modelo Codex nunca segue para Claude.
  - Três modos, cada um dizendo o que muda:
    - `workspace`: entrada gravada sem run, define o padrão do espaço.
    - `production`: etapa de gravação. A escolha vale só para esta produção e vai junto com a ação `video` como `director`.
    - `run`: `planning-edit`, ou `blocked`/`paused` com retomada em edição. Usa `set-edit-director` com `{providerId, modelId?}`.
  - Em todos os modos, a direção usa o papel, as instruções e as skills do agente editor.
- As restrições de produção persistente/`sourceCodex` e o botão de retomar não mudaram.

## Contrato com o runtime (worker `ctx_c94e9c5ac029`, aprovado pelo coordinator, opção b)

O runtime já aplicou os dois itens, conferido em `production-coordinator.mjs`:

1. A ação `video` aceita `input.director` opcional. Quando presente, vale só para esta run; quando ausente, usa o padrão do espaço.
2. `set-edit-director` não grava mais `production_edit_directors`. Só `POST /api/content/productions/edit-director` muda o padrão do espaço.

## Follow-up: execução efetiva do diretor (task_1bc9d013d63b)

O runtime publica, via `list()` (que espalha a run inteira), três campos:

- `run.authoring.executions[]`: um registro por turno, com provedor, modelo pedido, modelo reportado, resultado, turnos, revisão e chamadas.
- `run.authoring.lastStop`: a última parada por limite de turnos, com os números do checkpoint, o motivo e se dá para continuar.
- `run.authoring.continuations`.

A UI lê só esses campos. Os nomes foram combinados com o runtime por mensagem e nenhum resumo novo em `list()` foi necessário.

- **Configurado × efetivo.**
  - A linha "Direção de cortes/motion" mostra a escolha configurada.
  - A linha "Última execução da edição" mostra quem rodou de fato, por exemplo `Claude Code · claude-reported-model · parou no limite de turnos (20/20 turnos)`.
  - O modelo só aparece quando o provedor o reportou. Um modelo apenas pedido vira "`cl-model` (pedido; não confirmado pelo provedor)". Sem nenhum dos dois, aparece "modelo não informado pelo provedor".
  - A lista completa (inicial e continuações, com revisão e chamadas antes→depois) fica num `<details>` fechado.
  - Os helpers puros estão em `src/features/production/editorExecutions.ts`, com tipos `EditorExecution`/`EditorStop` em `model.ts`.
- **Chips do header.** O texto continua curto e configurado: `Conversa: Codex` e `Edição: Claude`. O tooltip do chip de edição traz a última execução efetiva.
- **Parada por limite de turnos.** Com a produção `blocked`/`paused` e retomada em edição, aparece um cartão com os fatos, o motivo e o que "Retomar" fará:
  - fatos: turnos, revisão, chamadas, chamadas restantes e continuações usadas/máximo;
  - se `continuable`, Retomar continua do checkpoint; se não, a orientação é escolher outro diretor ou pedir ajuste.

  "Retomar" envia um único comando `resume` com `authorize:true` e `resend:false`, sem aprovações passo a passo. Abrir o diálogo não envia nada.

### Evidências do follow-up

- `tests/editor-executions.test.mjs` + `tests/provider-switch.test.mjs`: 9/9. `npm run typecheck`: ok.
- `scripts/test-provider-editor-choice-ui.mjs`: `PROVIDER_EDITOR_CHOICE_UI_OK`. O cenário novo 7 confere:
  - chip com tooltip da execução efetiva;
  - linhas "configurado" e "efetivo" distintas;
  - cartão de parada com `20/20 turnos · revisão 3 · 14 chamada(s) de ferramenta · 6 restante(s) · continuações 1/3`, motivo e próxima ação;
  - lista de execuções;
  - 0 envios, threads ou comandos ao abrir;
  - um único `resume` (chaves exatas `action`, `authorize`, `requestId`, `resend`, `revision`), com histórico e rascunho da conversa intactos.

  Há capturas em claro, escuro e 560 px.
- Revalidados após as mudanças de ChatPanel e ProductionDialog: `PROVIDER_CHOICE_UI_OK` e `CONTENT_SCOPES_UI_OK`.

## Ajuste final (task_8784848c4a5a)

- **U1 — contexto do chat.** `setSessionProvider` entrou nas dependências do `useMemo` do contexto em `ChatProvider`, para a troca in-place sempre usar o modelo Codex padrão atual.
  - Pela UI, o caso obsoleto não é reproduzível de forma confiável: outras dependências, como `sessions` e `runStates`, mudam no meio e recriam o memo. O cenário 2b da fixture (padrão mudado em Configurações e depois troca in-place → `modelId` igual ao novo padrão) passou mesmo com a dependência removida, então ele valida o comportamento, mas não discrimina a regressão.
  - A guarda que discrimina é `tests/chat-provider-context-deps.test.mjs`: todo `useCallback` exposto no `value` tem que estar nas dependências. Ela passa no código atual e falha numa cópia sem `setSessionProvider`.
- **R4 — UI.** O runtime mantém `blocked`/`paused` ao configurar diretor ou modelo até o usuário retomar. Na UI:
  - Com a produção bloqueada ou pausada, o campo diz: "Muda só esta produção. Nada roda agora: ao retomar, a edição usa este diretor e modelo, do checkpoint salvo quando possível."
  - Escolher a mesma opção (provedor igual, ou o mesmo modelo normalizado) não envia comando, então o checkpoint e os diagnósticos ficam como estão.
  - Não há modal nem aprovação nova.
- **Fixture.** O stub segue o R4: preserva `blocked`, trata a mesma escolha como no-op e o catálogo Codex tem dois modelos. A fixture confere:
  - a run continua `blocked` depois de trocar diretor e modelo, com o texto "ao retomar" e o botão Retomar;
  - abrir o seletor e repetir a escolha não envia comando;
  - repetir o diretor configurado na run parada por limite mantém o cartão de diagnóstico, com 0 envios, threads ou comandos.

  Resultado: `PROVIDER_EDITOR_CHOICE_UI_OK`. Capturas em `scratchpad/out-pec3` (por exemplo, `08-director-changed-dark` mostra configurado Codex · cx-model-2 e efetivo Claude).
- **Verificação:** `npm run typecheck` ok. Testes de modelo e guarda: 10/10.

## Pendências

- `scripts/test-semi-production-ui.mjs` falha mesmo com `dist/remotion` presente, porque a fixture não fornece engine de animação (`mediaOptions:{inspect}`, sem `animate`). O pedido padrão de motion `balanced` agora bloqueia por "Remotion indisponível". Esse bloqueio (`motionBlock`) é comportamento novo, ainda não commitado, de `production-coordinator.mjs`, e não existe no HEAD. Não é causado pela UI deste trabalho. A fixture não foi alterada para não mascarar a regressão; quem cuida do runtime e da fixture decide se ela deve fornecer `animate` ou pedir `motion:'off'`.
- Não houve migração de perfil pessoal, retomada de produção real, empacotamento ou commit.

### Validação final da integração (Codex autorizado pelo usuário)

Contrato `restartPending` concluído no runtime: trocar uma direção em produção parada conserva `blocked`/`paused`, aguarda `resume` e informa novo planejamento; a mesma escolha é no-op. O botão de parada confirmada usa um único `resume` com `authorize:true,resend:false`, sem checkbox de reenvio; o fluxo incerto conserva a opção específica. Typecheck, 58 testes afetados, `PROVIDER_EDITOR_CHOICE_UI_OK` e `SEMI_PRODUCTION_UI_OK` passaram no build completo. A fixture semiautomática agora fornece o motor real e um título animado explícito, e exige motion aplicado na exportação. Nenhum pedido real de IA, vídeo pessoal, publicação ou agendamento foi executado nessa validação.
