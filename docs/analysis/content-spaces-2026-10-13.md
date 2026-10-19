# Espaços de conteúdo — relatório de implementação (2026-10-13)

Implementado por Claude Code (dono da implementação). Sem commit, push, tag, instalação, alteração de versão/pacote ou chamada a IA/rede social real. Arquivos já modificados por outros trabalhos foram preservados; as mudanças aqui são pontuais.

## O que o usuário vê

- **Seletor de conteúdo no chat.** Abaixo do cabeçalho de cada agente há a linha **Conteúdo: [Vídeo X ▾] [+ Novo]**. As opções são:
  - **Geral**: ideias soltas, sem conteúdo;
  - cada conteúdo do espaço, com a etapa real e o número de conversas;
  - **Precisa de atenção**: vínculos inválidos.
- **Navegação entre agentes do mesmo conteúdo.** Quando um conteúdo está selecionado, aparecem a etapa real e uma pílula por agente com o número de conversas dele nesse conteúdo. Clicar troca de agente e mantém o conteúdo.
- **Aba Sessões do agente.** Mostra só as conversas daquele agente no espaço selecionado. Os chats genéricos têm a ação **Organizar**.
- **Agente sem conversa no conteúdo selecionado.** Aparece o estado vazio "Editor de Vídeo ainda não conversou sobre “Vídeo Beta”", com o botão **Começar conversa sobre “Vídeo Beta”**. Nunca abre a última conversa desse agente sobre outro assunto.
- **Página Sessões.** Mostra caixas de **Espaços de conteúdo**. Cada caixa tem título, etapa real (ou "Sem produção"), número de conversas, agentes, última atividade e o aviso "Em execução". Abaixo fica a lista só do espaço escolhido. A escolha é a mesma do chat, então escolher um conteúdo na página também o seleciona no chat. Os conteúdos sem conversa ficam atrás do botão "Mostrar N conteúdos sem conversa".
- **Novo conteúdo.** Basta o nome, sem precisar de ideia aprovada. Cria o `EditorialContent` (via `createSessionContent`, com a ideia em revisão) e uma conversa nova do mesmo agente, sem rascunho nem thread herdados.
- **Herança na conversa nova.** Uma conversa nova herda o conteúdo selecionado. Isso vale para o "+", "Novo", envio sem conversa, "Gerar com" (troca de provedor), "Nova sessão" global e Criar → sessão. Em Geral, ela continua genérica. Em "Precisa de atenção", ela vai para Geral.
- **Organizar em conteúdo** (diálogo explícito). O usuário escolhe o conteúdo e, opcionalmente, marca "Levar junto as N conversas conectadas" (conexão, envio entre agentes ou comparação, só entre chats do mesmo escopo).
  - O app recusa mover, mostrando o motivo, quando a conversa:
    - ainda está respondendo ou tem um envio em andamento;
    - já pertence a outro conteúdo;
    - é de outro espaço;
    - conduz a produção de outro conteúdo;
    - tem arquivos, entregas ou recibos de outro conteúdo;
    - divide a thread do provedor com um chat que fica de fora.
  - Quando recusa, oferece **Começar conversa nova aqui**, e a conversa antiga continua em Geral, sem mudança.
  - O histórico e a thread do provedor são mantidos.
  - Nada é agrupado por título.

## Contrato

- **Identidade.** A identidade é `workspace + contentId + sessionId`. Título ou agente nunca contam. O conteúdo é o `EditorialContent` que já existe. Não foi criada nenhuma entidade paralela.
- **Estado persistido `content-scopes`.** É isolado por perfil pelo `PersistentState`, entra em `dataKeys` do backup e é validado e mesclado no import (a escolha local vence). O formato é `{schemaVersion:1, selected:{[workspaceId]:ScopeKey}, active:{['ws|agent|scope']:sessionId}}`, com `ScopeKey = 'general' | 'content:<id>' | 'recovery'`.
- **Compatibilidade.** O `active-sessions` legado continua sendo escrito. Ele só define o escopo inicial enquanto o usuário ainda não escolheu nenhum.
- **Resolução** (`resolveScopeSession`): ponteiro salvo válido do mesmo agente e escopo → a conversa mais recente do mesmo escopo → nenhuma (estado vazio).
- **Escopo validado** (`scopeOfSession` via `contentBinding`). Um conteúdo apagado, de outro espaço ou com run de outro conteúdo vai para **Precisa de atenção**, nunca fica oculto. Uma seleção salva que aponta para um conteúdo apagado também cai nesse grupo. Enquanto os conteúdos carregam, o vínculo salvo é mantido ("Carregando conteúdo…") e não aparece como inválido.
- **Seleção** (`ChatProvider`):
  - `openSession` seleciona o escopo da conversa aberta. O Canvas usa `{select:false}`.
  - `createSession(..., activate)`: com `'select'`, seleciona o escopo; com `true`, ativa a conversa no escopo dela sem trocar a seleção; com `false`, ela fica em segundo plano e só preenche um espaço vazio.
  - Ficam em segundo plano: `runWorkflowMessage`, filhos de handoff, comparação e o chat de nó do Canvas.
- **Exclusão.** Ao apagar uma conversa, o painel cai na conversa mais recente do **mesmo** escopo.
- **Produção.** `ProductionProvider.start` grava o source como ativo no escopo do conteúdo. Editor e publicador só ocupam um espaço vazio. A seleção nunca muda.
- **Alvo de continuação.** `continueTargetProblem` exige mesmo workspace, mesmo agente e mesmo conteúdo. Um chat genérico só continua em outro chat genérico. A regra vale em:
  - `performHandoff` (renderer), que antes checava só o agente;
  - `setAgentConnection`, que descarta um alvo desatualizado;
  - `AgentConnectionBar`, que deixa de mostrar "Continua em" um chat de outro conteúdo e explica que o próximo pedido abre uma conversa nova neste conteúdo.
  - O runtime nativo já fazia essa checagem (`sameContent`).
- **Sem roubo de tela.** A visão automática de colaboração (`showCollaboration`) só abre quando a origem é a conversa que está na tela (`reportFocusedSession`). Trabalho em segundo plano de outro conteúdo não troca o painel.
- **C2 (produção não adota chat Geral).** `mergeProductionSessions` não grava mais `contentId` num chat genérico com conversa própria. O chat entra no conteúdo só em dois casos:
  - está vazio ou tem apenas mensagens `production:`;
  - é o chat do especialista criado para o job de delegação do próprio run (`originHandoffId ∈ entry.delegationJobIds`).

  O chat Geral recebe as mensagens e o snapshot do run mais recente e continua Geral. Um segundo vídeo enviado nele gera outro conteúdo, sem se misturar com o primeiro.
- **Servidor.** `startDelegatedEdit` com `contentId` informado e inexistente é recusado com uma mensagem clara, em vez de criar um conteúdo substituto em silêncio.

## Arquivos

Novos:
- `src/features/chat/contentScopes.ts`
- `src/components/chat/ContentScopeBar.tsx`
- `src/components/chat/OrganizeChatDialog.tsx`
- `src/styles/content-scopes.css`
- `tests/content-scopes.test.mjs`
- `scripts/test-content-scopes-ui.mjs`
- este relatório

Alterados:
- `src/features/chat/ChatProvider.tsx`
- `src/components/chat/ChatPanel.tsx`
- `src/components/chat/AgentConnectionBar.tsx`
- `src/pages/Sessions.tsx`
- `src/app/App.tsx`
- `src/main.tsx` (import do CSS)
- `src/features/production/ProductionProvider.tsx`
- `src/features/production/model.ts` (`generalChatJoinsRun`)
- `src/components/canvas/nodes/CanvasNodes.tsx`
- `src/data/backupFormat.ts`
- `production-coordinator.mjs` (uma guarda em `startDelegatedEdit`)
- `scripts/test-content-sessions-ui.mjs` (o helper troca de espaço antes de abrir um chat de outro conteúdo, porque a aba agora é filtrada)

## Evidências

- **`npm run typecheck`:** OK.
- **`tests/content-scopes.test.mjs`:** 9/9. Cobre:
  - dois conteúdos com o mesmo título no mesmo agente e no mesmo editor, com atualização concorrente;
  - ponteiros por agente e escopo;
  - segundo plano sem troca de seleção;
  - grupo de recuperação e seleção apagada;
  - regras do alvo de continuação, incluindo genérico × vinculado;
  - organizar com cada conflito e família (inclusive um link desatualizado, que não conta como família);
  - merge de produção sem adoção e com segundo vídeo;
  - backup (validação e merge);
  - recusa no servidor de conteúdo apagado.
- **Regressões focadas:** `content-sessions-model`, `content-sessions`, `production-mirror`, `production-authored-edit`, `delegated-edit-engine`, `session-editing-recovery`, `backup` e `agent-drafts` passam.
- **Electron oculto `scripts/test-content-scopes-ui.mjs`:** `CONTENT_SCOPES_UI_OK`. Usa renderer real, SQLite isolado copiado do fixture e Codex simulado, sem contas de IA. O roteiro:
  1. o usuário legado cai em Geral, na conversa antiga;
  2. cria Alfa e Beta só pelo nome;
  3. a resposta tardia de Alfa não entra em Beta nem rouba a seleção;
  4. cada chat tem sua thread, e o snapshot leva só o próprio `contentId`;
  5. o editor em Beta aparece vazio e não mostra o chat Geral dele; a conversa começada ali herda Beta;
  6. o editor em Alfa também aparece vazio;
  7. abrir um conteúdo existente sincroniza a seleção, e o alvo desatualizado é explicado;
  8. "Precisa de atenção" mostra o vínculo quebrado;
  9. organizar a família conectada move os dois chats e restaura o alvo válido;
  10. o conflito de arquivo de outro conteúdo é recusado e oferece uma conversa nova;
  11. a página Sessões mostra as caixas e a lista só de Beta;
  12. ao reiniciar, a seleção e o chat ativo por agente e conteúdo são restaurados, e o outro perfil fica sem escopos;
  13. uma seleção inválida depois de reiniciar cai em recuperação, e o "+" herda Alfa;
  14. em largura estreita não há rolagem horizontal; o histórico legado e os agentes ficam intactos;
  15. nenhum erro de console.
- **Capturas** (claro/escuro, desktop e 760 px): `.mainsagents-workspaces/content-scopes-ui/<timestamp>/`. Os arquivos vão de `01-beta-writer-desktop-light.png` a `10-narrow-dark.png`.
- **Outros testes de UI de chat:** `agent-handoff`, `agent-connection`, `chat-interaction`, `drafts-inbox`, `desktop-persistence` e `agent-comparison` passam (OK).
- **`npm test`** completo: 672 testes, 669 passam. As 3 falhas são de `remotion-video.test.mjs` e acontecem só porque `vite build` apaga `dist/remotion`. Depois de `node scripts/build-remotion-video.mjs`, esse arquivo passa 15/15.

## Correções após a revisão (despacho ctx_2a9e994714c4)

Todos os itens do follow-up foram tratados. As seções acima continuam válidas, com estas mudanças.

- **B1 (crítico): rascunho sem conversa por escopo.**
  - O rascunho sem chat agora é guardado por agente, workspace e escopo. A chave é a tupla JSON `[agente, null, workspace, escopo]` (`chatDraftModel.draftSlot`/`chatDraftKey`).
  - Em Geral continua a chave antiga `[agente, null]`, então os rascunhos antigos ficam em Geral.
  - Todas as leituras e escritas do ChatPanel (texto, contexto do Canvas, remover referência, `ensureSession`, envio) usam o mesmo slot. Ao enviar, o texto vai para a conversa nova e só o slot daquele escopo é limpo.
  - O backup aceita as duas formas da chave e continua recusando chaves malformadas.
- **B2 (crítico): o chat mostrado não é mais trocado em segundo plano.**
  - O painel grava como ponteiro do slot o chat que está mostrando (`pinVisibleSession`/`withVisible`), sem mudar o escopo selecionado.
  - Chats em segundo plano nunca viram ponteiro: `withBackground` foi removido, e filhos de handoff, workflow e Canvas não escrevem ponteiro. Na produção, só o source vira ponteiro, porque iniciar a produção é ação explícita; editor e publicador, não.
  - Importações nativas ou de produção com um irmão mais novo não tomam o lugar do chat mostrado. Navegar continua permitido durante uma resposta.
- **I1: ocupação e organização revalidada.**
  - `delegationBusy` considera os dois lados do job (origem e alvo) quando ele está na fila ou rodando. Vale para organizar e para apagar. O envio na origem continua permitido, porque um handoff manual libera a origem de propósito.
  - `assignSessionsToContent` roda `organizeSessions` na hora de aplicar, com o estado editorial e de produção atual e as conversas vivas. Isso refaz a guarda completa: workspace, conteúdo ainda existente, runs, artefatos e recibos, thread compartilhada, ocupação e família ainda igual à confirmada.
  - A aplicação é tudo ou nada (`OrganizeRefused` com os motivos). Thread e mensagens não mudam.
- **I2: família sem truncamento silencioso.**
  - `chatFamily` informa `truncated` (acima de 24) e `crossScope`.
  - Família truncada ou alterada é recusada como um todo.
  - Links históricos com conversas de outro conteúdo aparecem num aviso no diálogo e não são movidos.
- **I3: arquivados.**
  - Um conteúdo arquivado que tem conversas salvas aparece no seletor e nas caixas como "Arquivado".
  - A conversa dele abre na mesma thread, sem criar uma nova.
  - Arquivado sem conversas continua fora da lista.
- **I4: mesma identidade no renderer e no nativo.** `continueTargetProblem` agora usa igualdade com null para conteúdo e tópico, igual a `sameDelegationContent`, que foi exportado de `native-agent-delegations.mjs` e é usado pelo runtime nativo. A tabela de casos é testada nos dois.
- **Chave de slot.**
  - `activeScopeKey` agora é `JSON.stringify([workspace, agente, escopo])`.
  - As chaves pré-release `ws|agente|escopo` são aceitas e migradas na leitura e no merge (`normalizeContentScopes`), sem apagar entradas válidas.
  - A validação ficou mais estrita (formato e tamanhos). Um import inválido continua recusado.
- **Visual.**
  - O título do conteúdo ocupa a linha do seletor (o título completo fica no tooltip e no menu). "+ Novo conteúdo" virou um botão de ícone com rótulo acessível.
  - Etapa e pílulas de agente ficam na linha de baixo.
  - Capturas: `11-long-name-desktop-light.png`, `09`/`10` (760 px).
- **Navegação explícita.** `openEditorialItem`, `openTask(contentId)` e o evento `mainsagents:open-content` selecionam o escopo do conteúdo aberto. Atualizações do Estúdio em segundo plano não mexem na seleção.
- **Comparação e "Gerar com".** A partir de um chat de conteúdo, as duas sessões da comparação (`AgentComparisonInput.link`) e a conversa nova da troca de provedor herdam o mesmo `contentId`, `topicId` e `contentTitle` salvos. Cada uma tem thread nova e separada. Em Geral, continuam em Geral.
- **Hidratação.**
  - Enquanto os conteúdos e as produções carregam, o escopo salvo é mantido ("Carregando conteúdo…"). Nada é classificado como inválido nem cria chat em Geral.
  - Envio, "+", Novo conteúdo e Organizar ficam bloqueados até o escopo real resolver.
- **Servidor.** A recusa de `startDelegatedEdit` com `contentId` apagado ou de outro workspace (`production-coordinator.mjs`) continua coberta por teste.
- **Regressões antigas investigadas e corrigidas** (`test-content-sessions-ui` e `test-session-recovery-ui`). Não era ambiente. Os fixtures foram escritos antes de três mudanças:
  - **A produção passou a exigir motion.** A ponte do fixture não tinha motor de animação; foi injetado o mesmo stub declarado de `production-authored-edit`.
  - **A direção da edição passou a ser "Claude Code" por padrão.** O fixture não tem Claude CLI; agora escolhe explicitamente o próprio agente editor simulado.
  - **A mídia sintética não tem fala**, então não há nada para animar. O fixture escolhe a opção "Sem motion", que já existe na interface.

  Além disso, os helpers que abrem uma conversa trocam de espaço antes, porque a aba Sessões agora é filtrada por escopo.

### Evidências desta rodada

- **`npm run typecheck`:** OK.
- **`tests/content-scopes.test.mjs`:** 16/16, com os testes novos:
  - B1 (A e B digitados separadamente, voltar restaura, enviar em B preserva A, rascunho Geral antigo intacto, backup);
  - B2 (chat importado sem ponteiro, depois irmão nativo mais novo e conteúdo não relacionado);
  - chave sem colisão, migração e import estrito;
  - I1 (origem ocupada, recibo estrangeiro tardio, conteúdo, run ou família alterados, tudo recusado sem mexer em thread e mensagens);
  - I2 (família acima do limite recusada inteira; dentro do limite, todos movidos);
  - I3;
  - tabela I4 renderer × nativo;
  - comparação herdando o link com threads novas.
- **Unitários vizinhos:** `agent-comparison`, `backup`, `agent-drafts`, `chat-drafts`, `native-delegations`, `production-drafts`, `runtime-backup`, `studio-drafts` e `content-flow-backup` (51) passam.
- **`npm test` completo:** 679 testes, 678 passam. A única falha foi `EPERM` do Windows ao renomear uma pasta temporária de capas durante a rodada paralela (`production-coordinator.test.mjs`). Rodado sozinho, esse arquivo passa 29/29. O bundle Remotion foi gerado antes, e nenhum `vite build` rodou em paralelo.
- **Electron oculto `scripts/test-content-scopes-ui.mjs`:** `CONTENT_SCOPES_UI_OK`. Os cenários novos:
  - B1;
  - B2 com importação nativa simulada pela fila;
  - I3 arquivado;
  - aviso de link entre escopos (I2);
  - Sessões com a caixa do arquivado;
  - evento explícito `open-content` seleciona Alfa;
  - hidratação lenta: "Carregando conteúdo…", envio bloqueado e nenhum chat criado até restaurar Beta;
  - "Gerar com" herda Alfa com thread nova;
  - nome longo;
  - rascunho Geral antigo intacto.

  Capturas em `.mainsagents-workspaces/content-scopes-ui/1791942654887/`, arquivos `01`–`12`.
- **Regressões de UI:** `content-sessions`, `session-recovery`, `agent-handoff`, `agent-connection`, `chat-interaction`, `drafts-inbox`, `desktop-persistence` e `agent-comparison` passam (OK). A comparação mostrou uma regressão real desta rodada, já corrigida: iniciar uma comparação volta a tornar cada lado o chat mostrado do agente no escopo dele, sem mudar a seleção.

## Correção final: migração do chat ativo legado (despacho ctx_a1cbd22587bc)

- **Problema** (revisor, msg_edf330e6124e): quando ainda não existe `content-scopes`, o `active-sessions` legado podia apontar para o chat mais antigo de dois chats do mesmo conteúdo. A resolução ignorava esse ponteiro e fixava o mais recente, sobrescrevendo a escolha do usuário.
- **Correção:**
  - `resolveScopeSession(..., legacySessionId?)` escolhe, nesta ordem:
    1. o ponteiro salvo do escopo;
    2. o chat legado, só se for do mesmo agente, do mesmo escopo validado e do mesmo workspace (porque está na lista do escopo);
    3. o chat mais recente do escopo;
    4. nenhum.
  - O ChatPanel passa o legado. O painel fixo de comparação/colaboração (`sessionId`) não usa essa regra.
  - O getter `getActiveSession` do provider segue a mesma ordem e nunca devolve o legado de outro conteúdo.
  - Depois da hidratação, o `pinVisible` grava o chat legado resolvido. Thread, histórico e vínculo não mudam.
  - Os casos de recuperação, conteúdo estrangeiro e conteúdo apagado continuam coerentes: o legado inválido só aparece em "Precisa de atenção". A classificação durante o carregamento (pending) segue protegida.
- **Evidências:**
  - `npm run typecheck`: OK.
  - `tests/content-scopes.test.mjs`: 17/17. O teste novo de migração cobre: chat mais antigo restaurado e fixado; resultado nativo mais novo depois disso não muda a tela; ponteiro com escopo vence o legado; legado de outro conteúdo, workspace ou apagado nunca é usado; Geral restaurado exatamente; pending.
  - `scripts/test-content-scopes-ui.mjs`: `CONTENT_SCOPES_UI_OK`.
    - Fixture real: o legado do editor aponta para "Edição antiga escolhida", que é mais antiga que "Edição importada" no mesmo conteúdo. Ela volta, fica fixada e continua na tela quando chegam resultados nativos mais novos. O Geral legado também é mais antigo que os irmãos e volta exatamente.
    - O renderer foi compilado num diretório isolado (`MAINSAGENTS_UI_DIST=.mainsagents-workspaces/ui-dist-scopes`) para não mexer no `dist/` do empacotamento.
    - Capturas em `.mainsagents-workspaces/content-scopes-ui/1791943033386/`.
  - Conforme a instrução, a suíte completa e as outras 8 UIs não foram rodadas de novo depois desta correção pequena. A última rodada completa é a da seção anterior.

## Complemento da migração: seleção inicial do workspace (despacho ctx_6658b083f7a3)

- **Problema** (root, msg_ff00d40eaeb8): depois que o primeiro painel do legado aparecia, a seleção do workspace continuava indefinida. Trocar de agente seguia então o chat legado do outro agente, de outro conteúdo.
- **Correção:**
  - `withVisible` (`contentScopes.ts`) grava o escopo mostrado como seleção do workspace somente quando ainda não existe seleção. Depois grava o ponteiro do slot. Uma seleção explícita existente nunca muda.
  - `pinVisibleSession` (`ChatProvider.tsx`) só deixa de agir quando já existe seleção E o ponteiro é o mesmo, então um ponteiro já existente não impede a inicialização.
  - Só o painel não fixo, depois da hidratação, chama isso. A comparação e o painel de colaboração fixos não chamam, e o segundo plano também não.
  - A correção do ID exato do legado continua.
- **Evidências:**
  - `npm run typecheck`: OK.
  - `tests/content-scopes.test.mjs`: 18/18. O teste novo cobre:
    - o legado do redator está em A (o chat mais antigo é mostrado e fixado), e a seleção vira A;
    - o editor, cujo legado está em B, fica em A e mostra o chat dele em A;
    - uma seleção explícita B não muda com um pin de A;
    - Geral inicializa só no próprio workspace.
  - `scripts/test-content-scopes-ui.mjs`: `CONTENT_SCOPES_UI_OK`. A asserção nova no renderer real:
    - o primeiro chat mostrado grava `selected=general`;
    - ao trocar para o Editor pelo seletor de agente, o app fica em Geral e mostra "Edição solta", e não o chat legado do editor em Vídeo Antigo. Sem a correção, essa asserção falharia.
  - O renderer foi compilado em diretório isolado (`.mainsagents-workspaces/ui-dist-scopes`), sem tocar em `dist/`.
  - Capturas em `.mainsagents-workspaces/content-scopes-ui/1791943206434/`.
  - Conforme a instrução, a suíte completa e as outras 8 UIs não foram rodadas de novo.

## Limites conhecidos

- **Sessões de agentes apagados.** Continuam fora da página Sessões (comportamento anterior). Não são atribuíveis a um espaço.
- **Organizar só funciona de Geral para um conteúdo.** Não há "mover de volta para Geral" nem mover entre conteúdos, para não misturar.
- **Snapshot do chat Geral com dois runs.** Ele leva só o run mais recente.
- **Nova conversa herda o conteúdo selecionado.** Esse é o comportamento definido (não há opção "sempre Geral").

## Próxima release recomendada

1. Revisão do coordenador e do revisor.
2. `npm run build` completo e `desktop:dist` num despacho separado. O estado pessoal já é compatível: sem `content-scopes`, cada agente abre no escopo do seu `active-sessions` atual, e os chats genéricos aparecem em Geral.
3. Smoke test com uma cópia do perfil pessoal: os 5 chats do HomeView no conteúdo dele, Apple Home e carrossel em Geral.
