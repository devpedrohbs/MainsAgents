# Revisão de isolamento por conteúdo (espaços de conteúdo) — 2026-10-13

Tarefa `task_528ffd7c6634` / dispatch `ctx_e5207a998190`. Revisão **somente leitura**: nenhum código, teste ou dado foi alterado. A implementação pertence ao dispatch `ctx_f541f2951634`.

Objetivo do usuário: dois vídeos sendo feitos ao mesmo tempo, cada um com sua própria "caixa" de conteúdo, e os chats de cada conteúdo separados nos agentes Conteúdo / Editor de Vídeo / Carrossel.

## Resumo

O modelo de dados já tem a identidade certa: `AgentSession.contentId` (+ `topicId`, `contentTitle`), validada por `contentBinding()` (`src/features/chat/contentSessions.ts`), e o servidor de delegação nativa já recusa reaproveitar uma sessão de outro conteúdo (`native-agent-delegations.mjs:76-78`). O que falta é que **a seleção e a criação de sessões respeitem esse escopo**. Hoje:

1. **A seleção é global por agente** (`active-sessions: Record<agentId, sessionId>`). Dois conteúdos no mesmo Editor de Vídeo disputam um único slot, e vários fluxos em segundo plano escrevem nesse slot.
2. **A produção adota chats genéricos** (`mergeProductionSessions` grava `contentId` em sessões que não tinham). Assim um chat genérico vira silenciosamente um chat de conteúdo, e o vídeo seguinte enviado nele cai no conteúdo errado.
3. **O caminho de handoff no renderer e a UI de conexão** não fazem a verificação `sameContent` que o servidor já faz.
4. **Vários pontos de criação de sessão perdem o vínculo** (troca de provedor, comparação, `ensureSession`, workflow).

## Achados (ordenados por gravidade)

### C1 — Seleção cruzada / sequestro de chat em segundo plano (crítico)

`src/features/chat/ChatProvider.tsx:65` guarda `activeSessionIds` como `Record<AgentId,string>` persistido em `active-sessions`. O painel (`ChatPanel.tsx:147`) mostra `getActiveSession(agent.id)` quando não está fixado em uma `sessionId`. Com dois conteúdos (A e B) no mesmo agente editor, só existe um slot, e todos estes pontos o sobrescrevem sem ação do usuário naquele painel:

| Escritor | Local | Efeito |
|---|---|---|
| Início de produção | `src/features/production/ProductionProvider.tsx:25` (`start`) | Grava a sessão ativa do **source, editor e publisher**. Começar a produção de B tira o editor da conversa de A. |
| `createSession` com `activate=true` por padrão | `ChatProvider.tsx:96` | Toda criação troca a visão do agente, salvo quem passa `false` (só `performHandoff:257`). |
| Nova sessão conectada | `ChatProvider.tsx:125` (`newConnectedSession`) | Cria o filho no agente alvo com `activate=true` e muda o que o painel do alvo mostra. |
| Workflow | `ChatProvider.tsx:302` (`runWorkflowMessage`) | Cria sessão **genérica** e ativa. |
| Comparação | `ChatProvider.tsx:318` (`persist`) | Ativa o par nos dois agentes. |
| Nó de chat no Canvas | `src/components/canvas/nodes/CanvasNodes.tsx:110` (`chooseAgent`) e `:114` (`submit` chama `openSession`) | Enviar pelo canvas troca o painel lateral daquele agente. |
| Exclusão | `ChatProvider.tsx:102` | A "próxima" sessão é a mais recente do **agente**, sem considerar o conteúdo. Apagar um chat de A pode abrir um chat de B. |
| Envio sem `sessionId` | `ChatProvider.tsx:295` | Se o chamador não informar a sessão, usa o slot global, que pode ter mudado depois que o usuário viu a tela. O `ChatPanel:340` passa `activeSession?.id`, então está seguro. Os outros chamadores não estão. |

Também não existe um conceito de "conteúdo atual". `selectedContentId` do Estúdio (`src/app/App.tsx:80`) é estado local, e o evento `mainsagents:open-content` (`App.tsx:90-97`) muda o Estúdio mas **não** o chat. O Estúdio pode mostrar B enquanto o painel lateral conversa sobre A.

### C2 — Chat genérico adotado pela produção; segundo vídeo cai no mesmo conteúdo (crítico)

Cadeia:
1. O usuário pede, num chat **genérico** do Agente de Conteúdo, para o Editor de Vídeo editar `video1.mp4`.
2. `native-agent-delegations.mjs:79` cria a sessão alvo com `contentId: sourceSession.contentId`, que é `undefined`.
3. `:138` chama `production.startDelegatedEdit` com `contentId: undefined`. `production-coordinator.mjs:499-502` cria um **conteúdo novo** e o run usa `sourceSession: plainSession(source, content, title, input.sourceSessionId)` (`:529`). `plainSession` (`:36`) grava `contentId: content.id` no shadow.
4. `src/features/production/model.ts:104` (`mergeProductionSessions`) aceita a sessão existente porque `old.contentId` está vazio e faz `{...old, contentId: run.contentId, topicId: run.topicId}`. **O chat genérico e o chat do editor passam a pertencer ao conteúdo 1.**
5. O usuário envia `video2.mp4` (outro sha) no mesmo chat. Agora `sourceSession.contentId` é o conteúdo 1, a sessão do editor passa no `sameContent` e é reaproveitada, e `startDelegatedEdit` encontra o run ativo com outro vídeo. Resultado: o erro "Este conteúdo já tem uma produção em andamento com outro vídeo" (`:524`), ou, depois de o run terminar, **um segundo vídeo dentro do mesmo conteúdo**.

O comentário em `production-coordinator.mjs:499` ("A chat without a content link that already handed THIS video … keeps using that content/run") mostra que a intenção era o chat genérico **continuar genérico** e casar por `entry.sessionId + sha256`. A adoção feita pelo merge anula essa intenção. É a causa principal de "dois vídeos simultâneos se misturam" e de "perda de sessões genéricas".

O teste atual `tests/production-mirror.test.mjs:7` cobre conteúdo **conflitante**, mas não cobre a adoção de `contentId` vazio.

### C3 — Conexão desatualizada reaproveita a sessão de outro conteúdo (alto)

- `ChatProvider.tsx:253` (`performHandoff`, renderer: caminho de `agent.delegate` e de `delegateToAgent` fora do desktop) reaproveita `agentConnection.targetSessionId` checando só `agentId`. O servidor já checa `sameContent` (`native-agent-delegations.mjs:76`). Os dois caminhos divergem.
- `ChatProvider.tsx:118` (`setAgentConnection`) preserva o `targetSessionId` quando o agente alvo é o mesmo, sem validar conteúdo.
- `mergeNativeDelegations` (`src/features/chat/nativeDelegations.ts`) grava `targetSessionId: handoff.targetSessionId` no primeiro snapshot de cada handoff. Hoje isso é correto porque o servidor só cria ou reusa uma sessão do mesmo conteúdo. Registro aqui como invariante a manter.
- `src/components/chat/AgentConnectionBar.tsx:20` mostra "Continua em: <título>" para qualquer `targetSessionId`, inclusive um apagado (vira o texto genérico), de outro conteúdo ou de outro agente. A UI promete continuidade que o servidor vai recusar ("belongs to another content").

### C4 — Criações que perdem o vínculo de conteúdo (alto)

- `ChatPanel.tsx:979` (`ProviderChoice.onCreate`): trocar Codex/Claude dentro de um chat de conteúdo cria uma sessão **genérica** e copia o rascunho. O usuário sai da caixa do conteúdo sem perceber.
- `ChatPanel.tsx:268` (`ensureSession`): genérica. É aceitável, porque só cria quando não há sessão ativa, mas com escopo por conteúdo deve herdar o conteúdo selecionado.
- `ChatProvider.tsx:302` (`runWorkflowMessage`) e `:297` (fallback do `sendMessage`): genéricas.
- Comparação (`src/features/chat/agentComparison.ts:81`, `base` sem `contentId`): uma comparação aberta dentro de um chat de conteúdo gera um par genérico.
- `src/pages/Flow.tsx:68` e `:110` criam sessões de conteúdo sem `contentTitle`. É menor: o snapshot cai em `title`.

### C5 — Conteúdo inválido ou apagado (médio)

`contentBinding` já classifica `missing-content`, `other-workspace` e `run-mismatch`, e o `ContentSessionCard` explica cada caso. Lacunas:
- `startSession(true)` (`ChatPanel.tsx:301`) cai para **genérica** quando o vínculo é inválido. Isso é correto, mas não há uma ação "mover para…" explícita. O cartão só oferece `next:'repair'` sem nenhum fluxo de reparo.
- `native-agent-delegations.mjs:79` propaga um `contentId` inválido (conteúdo apagado) para a sessão do especialista. Em `production-coordinator.mjs`, a busca de `:499` não encontra o conteúdo, a heurística de `:500` não roda (exige `!input.contentId`) e o `if(!content)` de `:501` **cria um conteúdo novo**, enquanto as sessões continuam com o id antigo. O merge então recusa espelhar (`old.contentId !== run.contentId`, `model.ts:102`). O resultado é um run órfão, sem chat principal visível. Recomendo recusar com uma mensagem clara quando `input.contentId` for informado e não existir.

### C6 — Escopo de perfil/workspace (baixo, ok com ressalvas)

- Tudo é persistido por perfil (`storageProfile()`), e as rotas nativas recebem `profile`. Os `agentId` são únicos por workspace, então hoje o slot por agente é implicitamente por workspace.
- `src/data/backupFormat.ts:121` faz merge raso de `active-sessions`. Qualquer nova chave composta precisa continuar sendo `Record<string,string>` para passar a validação `isObject` e a restauração.
- `useChatInbox(sessions, allAgents, currentWorkspaceId)` e `ExecutionOverview` já filtram por workspace.

### Reconexão de thread (ok)

O thread remoto é por sessão local (`provider.createSession({localSessionId})`, `ChatProvider.tsx:190`). A recuperação (`sessionRecovery`) só substitui o thread **da mesma sessão** e leva apenas o histórico dessa sessão. Não encontrei caminho que reconecte a sessão ao thread de outra. O risco indireto está em C2: a sessão adotada mantém o thread antigo, cujo histórico do provedor contém o vídeo 1, e passa a ser "do conteúdo 1". Corrigir C2 resolve isso.

## Contrato mínimo sugerido (baseado no `contentId` existente)

1. **Escopo de seleção** = `(workspaceId, contentId | 'generic', agentId)`.
   - `active-sessions` passa a aceitar chaves compostas `"<agentId>"` (legado = escopo genérico/último usado) e `"<agentId>::<contentId>"`. Continua `Record<string,string>`, compatível com o backup.
   - Junto, um `selectedContent: Record<workspaceId, contentId | null>` persistido, que define qual caixa o painel lateral mostra. `mainsagents:open-content` atualiza esse valor, e abrir uma sessão de conteúdo também.
   - `getActiveSession(agentId, contentId?)` resolve primeiro a chave composta. Se a sessão salva não pertencer àquele conteúdo, retorna `undefined` em vez de cair em outra.
2. **Só ação explícita do usuário ativa uma sessão.** `createSession(..., activate)` passa a ter `false` como padrão para todo chamador em segundo plano (produção, handoff, conexão, workflow, comparação, canvas). `ProductionProvider.start` só ativa a sessão **source** e só no escopo do conteúdo do run, nunca a do editor ou do publisher.
3. **Escopo genérico é preservado.** `mergeProductionSessions` nunca grava `contentId` numa sessão que não tinha. Ela recebe as mensagens `production:<run>` e o snapshot, mas continua genérica. Associar um chat genérico a um conteúdo é uma ação explícita ("Mover para conteúdo…"), nunca um efeito colateral.
4. **Uma regra `sameContent` compartilhada** (`contentId` e `topicId` iguais, tratando ausente como `null`), exportada de `contentSessions.ts` e usada em `performHandoff`, `setAgentConnection`, `AgentConnectionBar` (rótulo "Continua em") e espelhada no servidor (`native-agent-delegations.mjs:76`, que já usa essa regra).
5. **Toda criação herda o escopo atual.** Troca de provedor, comparação, `ensureSession` e workflow recebem `childContentLink(activeSession)`, ou o conteúdo selecionado quando não há sessão.
6. **Mover explicitamente, com segurança de família.** "Mover para conteúdo X" vale para uma sessão genérica ou inválida e é recusado se a sessão estiver em execução (`inFlightSessions`/`nativeBusy`), se for papel de um run ativo de outro conteúdo, ou se tiver filhos conectados ou handoffs ativos. Quando é aceito, move a **família** de uma vez (a origem e os filhos que têm `originHandoffId` ou `agentConnection.targetSessionId` vindos dela) ou nenhum deles, para que pai e filho nunca fiquem em conteúdos diferentes. O thread remoto é mantido, e uma nota local registra a mudança.
7. **Conteúdo inexistente é recusado no servidor.** `startDelegatedEdit` com `input.contentId` informado e não encontrado deve recusar, em vez de criar conteúdo novo.

## Cenários de teste (aceitação)

Unitários (`tests/*.test.mjs`, `node --test`), nos mesmos estilos de `content-sessions-model.test.mjs`, `production-mirror.test.mjs` e `native-delegations.test.mjs`:

1. **Dois conteúdos no mesmo editor.** Runs A e B com o mesmo `editorAgent`. Iniciar B não altera a sessão ativa de A (`active-sessions["editor::A"]` permanece). O espelho entrega as mensagens de B só nas sessões de B.
2. **Início de produção.** `ProductionProvider.start` grava só a chave do source no escopo do conteúdo. As chaves do editor e do publisher não mudam.
3. **Chat genérico com dois vídeos.** O merge de um run cujo `sourceSession.id` é um chat genérico mantém `contentId` indefinido. Um segundo vídeo (outro sha) no mesmo chat cria um conteúdo ou run próprio, e o mesmo sha volta ao run existente (`production-coordinator.mjs:500`).
4. **Conexão desatualizada.** `agentConnection.targetSessionId` apontando para uma sessão de outro conteúdo, apagada ou de outro agente: `performHandoff` (renderer) cria uma sessão nova com o vínculo da origem, e `AgentConnectionBar` não mostra "Continua em" para ela. Paridade com `native-agent-delegations` na mesma tabela de casos.
5. **Background não sequestra.** `newConnectedSession`, `runWorkflowMessage`, comparação e envio pelo nó do canvas não mudam a sessão ativa do painel lateral daquele agente/conteúdo.
6. **Exclusão.** Apagar a sessão ativa de A seleciona outra de A, ou nada. Nunca seleciona uma de B nem uma genérica.
7. **Escopo por perfil/workspace.** Uma sessão cujo conteúdo é de outro workspace resulta em `invalid/other-workspace`, sem ações de produção. A troca de perfil isola `active-sessions` e as delegações (`?profile=`). Backup com chaves compostas faz ida e volta pelo `backupFormat` sem perda.
8. **Legado sem vínculo.** As sessões antigas sem `contentId` continuam listadas como genéricas, o envio continua no mesmo thread, e nenhum merge (produção ou nativo) as converte.
9. **Conteúdo inválido/apagado.** O cartão `missing-content` aparece, "+" cria uma sessão genérica, `startDelegatedEdit` com um `contentId` apagado é recusado, e o histórico continua intacto.
10. **Mover explicitamente.** Mover uma sessão genérica com um filho conectado leva os dois, ou nenhum. Recusa durante uma execução, com handoff `running` ou quando a sessão é papel de um run ativo. Depois de mover, `contentBinding` resulta em `content` e o servidor aceita reaproveitar o filho.
11. **Troca de provedor no chat de conteúdo.** A nova sessão herda `contentId`, `topicId` e `contentTitle`.

UI (Playwright/Electron em `scripts/test-*-ui.mjs`, no estilo de `test-content-sessions-ui.mjs`): dois conteúdos lado a lado, com a conversa do editor em A enquanto B inicia produção. O painel de A não pode mudar e o seletor de conteúdo deve indicar qual caixa está aberta.

## Notas de UI (para a revisão de UI separada)

As referências HIG locais de navegação/fundamentos **não foram encontradas** nesta máquina (busquei em `~/.claude/skills`, `~/.codex/skills`, `~/.agents/skills` e `docs/`). Por isso só registro princípios transferíveis para Windows/Electron e deixo a auditoria para a revisão de UI pós-implementação:
- **Contexto visível sempre.** O cabeçalho do chat deve mostrar a caixa atual ("Conteúdo: X" ou "Conversa geral") como seletor, e não só o título da sessão.
- **Ações em segundo plano não mudam o foco.** Eventos de produção ou delegação devem gerar indicador ou badge na outra caixa, nunca troca de painel.
- **Ações destrutivas ou de escopo são explícitas e reversíveis.** "Mover para conteúdo" fica num menu da sessão, com confirmação que lista a família afetada.
- **Lista de sessões agrupada por conteúdo**, com a seção "Geral" para legado, em vez de uma lista plana por agente (`ChatPanel.tsx:622`).

## Arquivos citados

`src/features/chat/ChatProvider.tsx`, `src/features/chat/contentSessions.ts`, `src/features/chat/nativeDelegations.ts`, `src/features/chat/agentComparison.ts`, `src/features/chat/model/Chat.ts`, `src/components/chat/ChatPanel.tsx`, `src/components/chat/AgentConnectionBar.tsx`, `src/components/canvas/nodes/CanvasNodes.tsx`, `src/features/production/ProductionProvider.tsx`, `src/features/production/model.ts`, `src/pages/Flow.tsx`, `src/app/App.tsx`, `src/data/backupFormat.ts`, `native-agent-delegations.mjs`, `production-coordinator.mjs`, `tests/content-sessions-model.test.mjs`, `tests/production-mirror.test.mjs`.

---

# Revisão final da implementação (task_8fdc19ba9154 / ctx_9c56e6fe0c08)

Revisão **somente leitura** do código congelado (implementadores `ctx_f541f2951634` → `ctx_2a9e994714c4` → `ctx_a1cbd22587bc` → `ctx_6658b083f7a3`). Nenhum código, teste ou script foi editado. Também não rodei build, empacotamento, inferência nem serviços sociais.

## Veredito

**Sem bloqueadores.** A implementação pode seguir para o empacotamento. Os dois bloqueadores e os quatro achados importantes que levantei durante a revisão foram corrigidos e cobertos por testes. Também foi corrigida a migração do chat ativo legado, levantada pelo root e confirmada aqui no código.

## Contrato entregue (conferido no código)

- `content-scopes` é persistido por perfil (store isolado por perfil) e normalizado por `normalizeContentScopes`. Guarda `selected[workspace]` e `active[JSON([workspace, agent, scope])]`. As chaves são tuplas JSON, e as chaves no formato antigo `a|b|c`, da pré-release, são migradas sem perda (`src/features/chat/contentScopes.ts`).
- Escopos possíveis: `general`, `content:<id>` e `recovery`. A identidade vem do `contentId`, validado por `contentBinding`. Um conteúdo arquivado que tem chats continua visível, com o rótulo "Arquivado".
- O chat mostrado é resolvido por `resolveScopeSession`, nesta ordem: ponteiro do escopo, depois o legado (só se pertencer ao mesmo escopo), depois o mais recente do escopo. O painel fixa o chat mostrado com `pinVisibleSession`/`withVisible`, que também grava a seleção inicial **apenas** quando ainda não há escolha salva.
- `createSession(…, activate:false)` (filhos de especialista, workflow, Canvas) não grava ponteiro nem muda a seleção. `ProductionProvider.start` só ajusta os ponteiros dentro do escopo do conteúdo do run.
- Rascunho sem chat: `DraftSlot` por workspace e escopo. Geral mantém a chave legada `[agent,null]`.
- A regra de continuidade (`continueTargetProblem`) é a mesma do runtime nativo: `contentId` e `topicId` comparados com `??null`. Ela vale no `performHandoff` do renderer, no `setAgentConnection` e na `AgentConnectionBar`.
- Organizar em conteúdo: `organizeSessions` reexecuta a verificação completa sobre o estado vivo, dentro do mesmo updater, em tudo-ou-nada. A ocupação considera as duas pontas dos jobs nativos (`delegationBusy`). Família acima de 24 é recusada inteira, e os links para outro escopo são reportados, não movidos.
- Merge de produção (`generalChatJoinsRun`): um chat Geral com conversa própria nunca é adotado. Só um chat vazio ou só de produção, ou o especialista criado para a delegação daquele run, entra no conteúdo.
- `production-coordinator.mjs:501` recusa uma edição delegada cujo `contentId` não existe mais, em vez de criar um conteúdo substituto.

## Status dos achados

| ID | Achado | Status | Evidência |
|---|---|---|---|
| B1 | Rascunho sem chat compartilhado entre escopos | Corrigido | `chatDraftModel.ts` (`DraftSlot`, `draftSlot`); teste "B1: unsent text…" |
| B2 | Troca de chat por fallback ou filho em segundo plano | Corrigido | `pinVisibleSession`; `createSession` sem ponteiro quando `activate===false`; teste "the shown chat is pinned…" |
| I1 | Busy só no alvo; organizar revalidava parcialmente | Corrigido | `delegationBusy`, `organizeSessions` no updater; teste "I1" |
| I2 | Família truncada em 24 sem aviso | Corrigido (recusa inteira) | `chatFamily` `truncated`; teste "I2" |
| I3 | Chats de conteúdo arquivado escondidos | Corrigido | `contentSpaces` com `archived`; teste "I3"; screenshot 08 |
| I4 | Regra de `topicId` diferente da nativa | Corrigido | `continueTargetProblem` com `??null`; teste "I4" |
| C5 | `contentId` apagado gerava conteúdo e run órfãos | Corrigido | `production-coordinator.mjs:501`; teste "a delegated edit … deleted is refused" |
| Root | Migração do chat ativo legado e do escopo inicial | Corrigido | `resolveScopeSession(…, legacySessionId)`, `withVisible` só quando `selected` está ausente; teste "migration: …" |
| I5 | Import de backup com uma entrada ruim é rejeitado inteiro | Aceito pelo root (igual às outras validações de backup) | `backupFormat.ts` |

## Testado de fato × risco estático

**Executado por mim (somente leitura):** `node --experimental-strip-types --test tests/content-scopes.test.mjs tests/content-sessions-model.test.mjs tests/production-mirror.test.mjs tests/native-delegations.test.mjs` passou **46/46**. Cobre os seguintes casos:
- dois conteúdos no mesmo editor;
- ponteiros por escopo e chat fixado;
- recuperação e conteúdo apagado;
- regra de continuidade igual à nativa;
- organizar com família, limite e verificação ao aplicar;
- merge de produção sem adoção silenciosa;
- backup e migração de chaves;
- rascunho por escopo;
- arquivado;
- comparação herdando o vínculo;
- migração legada.

**Evidência lida (não executada por mim):**
- UI Electron oculta `scripts/test-content-scopes-ui.mjs` com `report.json ok:true`, em `.mainsagents-workspaces/content-scopes-ui/1791943206434` (12 screenshots, claro e escuro, estreito, nome longo, restauração após carregamento lento). Asserções relevantes:
  - a resposta atrasada de Alfa não troca a seleção de Beta;
  - os threads do provedor são distintos;
  - o snapshot do turno leva só o próprio `contentId`;
  - o escopo é restaurado após reiniciar;
  - os escopos são isolados por perfil;
  - não há rolagem horizontal.
- Os checkpoints do implementador relatados pelo root (16/16 e 51/51 de unidade, typecheck 18/18, `production-coordinator` 29/29) não foram reexecutados por mim.

**Riscos residuais estáticos, não bloqueantes:**
1. `normalizeContentScopes` devolve um estado vazio se o valor **local** salvo tiver uma entrada inválida. A próxima escrita então zera as escolhas salvas, mas nenhum chat ou histórico é perdido.
2. A família é opcional no diálogo (o root aceitou). Mover só a origem deixa os filhos em Geral, mas os links para outro escopo nunca são continuados.
3. Corrida rara: um segundo handoff nativo antes de o merge do renderer persistir a adoção do especialista pode reaproveitar o filho ainda Geral. Ele acabaria em Recuperação (`run-mismatch`) e nunca misturado em silêncio.
4. O `sendMessage` sem `targetSessionId` ainda usa o ponteiro legado, mas todos os chamadores atuais passam a sessão.

**Notas de UI (HIG: `sidebars.md`, `split-views.md`, `layout.md`; princípios transferidos para Electron no Windows):**
- O seletor de conteúdo fica no topo do painel, com o título legível e truncado com reticências. A caixa selecionada fica destacada nos cards de Sessões, o que segue `split-views.md › Best practices` ("persistently highlight the current selection").
- O estado vazio por agente explica a separação e tem uma ação primária clara.
- Pontos menores, sem bloqueio:
  - a lista de agentes nos cards é truncada ("Ed…");
  - um toast de uma ação anterior continua visível em outro escopo (artefato do teste).
