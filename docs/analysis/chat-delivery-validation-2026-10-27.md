# Validação do chat e das entregas — 27/10/2026

Rodada de fechamento do chat novo antes da instalação. O objetivo era reproduzir duas falhas ainda não classificadas, `scripts/test-chat-deliveries-ui.mjs` e `scripts/test-content-deletion-ui.mjs`, e corrigir só o que tivesse evidência. A nova interface do chat (ModelPicker, runSteps e chat-clean) foi mantida.

Todas as execuções usaram um build isolado do renderer, em `.mainsagents-workspaces/chat-delivery-build-2026-10-27` (`npx vite build --outDir … --emptyOutDir`), com a variável `MAINSAGENTS_UI_DIST`. O `dist/` não foi tocado, os perfis de teste foram isolados e nenhuma IA real foi usada.

## 1. `test-chat-deliveries-ui.mjs`: bug real, corrigido

**Sintoma.** Depois de "Salvar entrega" na segunda resposta ("Research a new project"), as duas entregas sumiam do chat. O painel passava a mostrar "Content Editor ainda não conversou sobre “Personal automation project”", e o teste estourava o tempo esperando `.chat-delivery[1]`.

**Evidência.** Estado da sessão `chat-session` lido do perfil de teste:

| Momento | `contentId` | `topicId` | Entregas no chat |
|---|---|---|---|
| Antes de salvar | `content` | `topic` | 2 |
| Depois de salvar | *(ausente)* | `topic-6d67f40e-…` (pauta nova) | 0 |

**Causa.** Em `captureChatDelivery` (`src/features/content/ContentWorkflowProvider.tsx`), a sessão era sempre religada ao artefato salvo. Uma entrega de pesquisa cria uma pauta nova, que ainda não tem conteúdo. Por isso, salvar uma pesquisa a partir de um chat de conteúdo apagava o `contentId`, e a conversa saía do próprio conteúdo. Isso acontece no app real, não só na fixture.

**Correção.** Feita com autorização do coordenador para esse arquivo. A sessão só é religada quando ainda não pertence a um conteúdo. O chat Geral continua sendo ligado ao que entregou, como antes.

**Teste.** Depois de salvar a pesquisa, o teste agora confere três coisas: o `contentId` continua `content`, o `topicId` continua `topic`, e o seletor de conteúdo segue em "Personal automation project". O teste também passou a aceitar `MAINSAGENTS_UI_DIST`, para rodar contra o build isolado.

**Resultado:** `PASS chat deliveries` contra o build isolado. Os testes vizinhos que também salvam entregas passaram: `test-completion-ui` (captura de arquivos e revisão), `test-publications-ui` e `tests/chat-deliveries.test.mjs`.

## 2. `test-content-deletion-ui.mjs`: sem bug de runtime encontrado

**Falha original** ("C deleted", o diálogo de excluir a legenda SRT não fechava): não se reproduziu em 11 execuções contra o build isolado. A exclusão de C, a contagem "1 documento SRT", a remoção no SQLite e o anúncio passaram em todas.

**Falha intermitente diferente:** `focus stays inside the dialog`, no passo de teclado a 420 px.
- Antes das teclas Tab, o foco está em "Cancelar", dentro do diálogo. O botão de excluir está habilitado, visível, com `tabIndex=0` e é o próximo elemento no DOM.
- Nenhum handler chama `preventDefault`: o evento foi registrado nas fases de captura e de bolha.
- Mesmo assim, o primeiro Tab real (`sendInputEvent`) leva o foco para `body` e, depois, para "Pular para o conteúdo".
- Em todas as execuções, inclusive nas que passam, a janela oculta e offscreen do teste informa `document.hasFocus() === false`.
- O resultado varia entre execuções iguais: 2 de 5 falharam numa série e 4 de 4 em outra.

**Conclusão:** a evidência aponta para a navegação por Tab do Chromium numa janela de teste sem foco, não para o `FlowDialog` nem para o `ContentDeletionDialog`. Não inventei correção. Nenhum código de runtime mudou por causa dessa falha.

Pendência: para que esse passo de teclado seja determinístico, o teste precisaria de uma janela focável, ou de uma verificação da armadilha de foco que não dependa do foco do sistema operacional. Essa decisão fica para o dono do teste.

## Regressão da rodada (build isolado)

- `npx tsc -b`: sem erros.
- `npm test`: 843 de 844. A única falha é `real Remotion overlays run after the FFmpeg multi-cut…`, de vídeo e fora do chat. Na rodada anterior, as falhas de vídeo foram outras três de render real, o que indica testes de mídia instáveis.
- `tests/run-steps.test.mjs` e `tests/chat-deliveries.test.mjs`: 10 de 10.
- UI que passou: chat-deliveries, chat-timing, chat-interaction, content-scopes, agent-comparison, provider-choice, agent-connection, mascot-attachments, scopes-usage, completion e publications.
- UI que falhou: content-deletion, apenas no passo intermitente de Tab descrito acima.

Fora do escopo, por serem responsabilidade do Codex: as fixtures antigas de content-sessions, session-recovery e provider-editor-choice.

## Arquivos desta rodada

- `src/features/content/ContentWorkflowProvider.tsx`: `captureChatDelivery` preserva o vínculo de um chat que já pertence a um conteúdo.
- `scripts/test-chat-deliveries-ui.mjs`: aceita `MAINSAGENTS_UI_DIST` e verifica que o chat continua no próprio conteúdo depois de salvar a pesquisa.
- `docs/analysis/chat-delivery-validation-2026-10-27.md`: este relatório.

Scripts temporários de diagnóstico foram criados em `scripts/tmp-*.mjs` e removidos ao final.
