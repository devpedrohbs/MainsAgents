# Canvas com espaços e remoção da página Fluxo — 0.3.83 local

## Resultado

Implementação conjunta com Claude Code no mesmo checkout. Instalada localmente em 29/10/2026, às 15:13 BRT, sobre a 0.3.82; sem commit, push, tag ou publicação pública. As alterações anteriores de tutorial e exclusão de pautas foram preservadas.

O Canvas agora organiza **workspace → espaços**, por exemplo Notícias, Pesquisa e Edição. Os espaços compartilham os agentes do workspace e mantêm blocos, conexões e enquadramento separados. É possível criar, alternar, renomear e excluir com confirmação e contagem dos objetos. O último espaço e espaços com terminal em execução não podem ser excluídos. Excluir um espaço não exclui conversas nem arquivos.

A página Fluxo, sua navegação e a visão de relações saíram. `#flow` antigo é normalizado para `#canvas`. As configurações de produção e seu backend permanecem: **Criar → Nova produção** permite escolher/criar uma configuração e ajustar os agentes de conteúdo, edição e publicação. Mudar responsáveis não inicia uma produção automaticamente.

## Persistência e isolamento

- `canvas-workspaces` mantém a chave existente. O formato anterior `{nodes,edges,view}` é interpretado como espaço `main`, exibido como Canvas principal em PT. A conversão para `schemaVersion: 2` ocorre ao gravar, preservando dados anteriores sem limpeza do armazenamento.
- O formato novo contém `activeBoardId` e `boards`, cada um com ID, nome, grafo e viewport. Rejeita IDs duplicados, nomes vazios/repetidos, estrutura inválida e dimensões ou zoom não finitos.
- Atualizações tardias capturam o espaço de origem; eventos de um espaço excluído não alteram o selecionado. Guardas de perfil impedem callbacks antigos de gravar no perfil novo.
- Contexto automático e blocos anexados temporariamente são separados por perfil, workspace e espaço. Referências explicitamente salvas no chat guardam `boardId`; referências antigas sem esse campo só resolvem se o bloco for único naquele workspace. Anexos explícitos já salvos permanecem visíveis no chat até sua remoção.
- Busca global abre o bloco no espaço correspondente. Atualizações de nós em espaços inativos não mudam a seleção. IDs de blocos de colaboração novos incluem o espaço.
- Desfazer, seleção, painéis, busca e menus são reiniciados ao trocar de espaço. Redimensionamento e atalhos anteriores foram preservados.
- Backup aceita o formato anterior e o novo; mescla espaços por ID sem achatar grafos. Imagens geradas de espaços inativos também entram na exportação. Não foi criada uma segunda biblioteca ou chave de Canvas.

## Arquivos desta rodada

Estado e integração:

- Novo `src/components/canvas/canvasBoards.ts`.
- `src/components/canvas/CanvasProvider.tsx`, `canvasState.ts`, `collaborationCanvas.ts`, `Canvas.tsx`.
- `src/features/chat/model/Chat.ts`, `src/features/chat/chatDraftModel.ts`, `src/components/chat/ChatPanel.tsx`.
- `src/data/backupFormat.ts`, `src/data/chatImageBackup.ts`.
- Novo `tests/canvas-boards.test.mjs`; `scripts/test-canvas-system-ui.mjs`, `scripts/test-canvas-interactions-ui.mjs`.

Interface e retirada de Fluxo, implementadas por Claude Code:

- Novos `src/components/canvas/CanvasBoardsBar.tsx`, `src/styles/canvas-boards.css`, `scripts/test-canvas-boards-ui.mjs`.
- `src/app/App.tsx`, `types.ts`, `routes.ts`, `useHashRouter.ts`.
- `src/components/layout/Sidebar.tsx`, `QuickCreate.tsx`, `src/components/command/CommandPalette.tsx`.
- `src/components/production/ProductionDialog.tsx`, `production.css`; texto de orientação em `src/pages/ContentStudio.tsx`.
- Removidos `src/pages/Flow.tsx`, `src/pages/flow.css`, `src/pages/CanvasRelations.tsx`, `src/components/flows/ProductionFlowBox.tsx`. `flowModel.ts` e `production-flows` mantidos.
- Fixtures atualizadas: `scripts/test-production-flows-ui.mjs`, `test-flow-execution-ui.mjs`, `test-production-preflight-ui.mjs`, `test-ux-flow-ui.mjs`, `test-edit-preview-ui.mjs`, `test-captions-frames-ui.mjs`, `test-content-flow-integration-ui.mjs`, `test-semi-production-ui.mjs`, `test-smart-edit-ui.mjs`, `test-checkup-b07-b09-b10-ui.mjs`.
- `package.json`, `package-lock.json` (0.3.83), `README.md`, `RELEASE.md` e este relatório.

## Verificação

- `npm run typecheck`: aprovado.
- `node --experimental-strip-types --test --test-concurrency=1 tests/canvas-boards.test.mjs tests/chat-drafts.test.mjs tests/canvas-system.test.mjs tests/canvas-geometry.test.mjs tests/collaboration-canvas.test.mjs tests/backup.test.mjs tests/chat-images.test.mjs`: 46 aprovados.
- `node --experimental-strip-types --test --test-concurrency=2 tests/*.test.mjs`: 920 testes, 918 aprovados, 2 renders HyperFrames condicionais ignorados, zero falhas. Log `.mainsagents-workspaces/canvas-spaces-unit-tests.log`.
- Oito testes novos cobrem migração sem mutação, independência dos grafos/viewports, exclusão segura, isolamento de contexto, referências ambíguas, IDs de colaboração, backup/merge e imagens de espaços inativos.
- `npm run build`, `node scripts/build-remotion-video.mjs --release`, `node scripts/check-build-files.mjs`: aprovados. Build completo inclui Remotion e Whisper; 120 módulos nativos/de runtime verificados, nenhum ausente.
- `npx electron scripts/test-canvas-system-ui.mjs` e `test-canvas-interactions-ui.mjs`: aprovados, incluindo contexto estrangeiro recusado, estado vivo/undo, exclusão e restauração de conexões, nove tipos, resize, zoom, busca, pan com Espaço, temas e larguras de 360 a 1440.
- `npx electron scripts/test-canvas-boards-ui.mjs`: aprovado no renderer final, com migração, teclado, criar/trocar/renomear/excluir, erro de nome duplicado, reset e separação dos objetos. Claro/Escuro acionados pelos botões reais. Capturas finais em `.mainsagents-workspaces/canvas-boards-ui-test/1793297632715`; revisão visual do menu claro e compacto sem corte fora da janela.
- `test-production-flows-ui.mjs`, `test-flow-execution-ui.mjs`, `test-production-preflight-ui.mjs`, `test-ux-flow-ui.mjs`: aprovados. Verificam redirecionamento, ausência de Fluxo, configuração por workspace, papéis, bloqueios e ausência de execução automática.
- `MAINSAGENTS_TEST_DIST=<dist final> npx electron scripts/test-edit-stages-ui.mjs`: aprovado no renderer final, evidência `.mainsagents-workspaces/edit-stages-ui/1793297189289`. Backend/SQLite/editor MCP/FFmpeg reais com respostas de modelo simuladas; sem inferência paga ou dados pessoais.
- `test-edit-preview-ui.mjs`: aprovado por Claude no dist final, evidência `.mainsagents-workspaces/edit-preview-ui/1793297552904`. Mantém verificação de transcrição, undo, voz, foco, momentos, cancelamento, previews e exportação; explicita a recusa de motion na etapa de cortes e o uso posterior do corte base.
- `MAINSAGENTS_TEST_ASAR=<asar 0.3.83> npx electron scripts/test-desktop-persistence-ui.mjs`: aprovado, resultado em `.mainsagents-workspaces/native-persistence-ui-result.json` (15:10 BRT). Reabre perfis e preserva agentes, conexões das sessões, tarefas e Canvas a partir do pacote.
- `node scripts/check-desktop-release.mjs` com `MAINSAGENTS_RELEASE_DIR=release/r83-20261029`: aprovado; recibo `MainsAgents-0.3.83-verification.json`.

## Limites registrados

- Os testes antigos `test-captions-frames-ui.mjs` e `test-content-flow-integration-ui.mjs` falharam em expectativas da edição automática anterior (botão e revisão de capas/legendas). Somente sua entrada de produção foi adaptada nesta rodada; não se declara que passaram. O caminho atual cortes → visual → SRT foi coberto pelo teste específico de etapas. A cobertura de capas/pacote em produções legadas pode ser retomada com uma fixture sem `editWorkflow`.
- Achados de vídeo fora do escopo: a revisão de cortes ainda oferece foco/momentos que a validação recusa ao usar como corte base; conferir o caminho visível de SRT para capas/agendamento nas produções por etapas. Não foram alterados para ressuscitar a UI antiga.
- O app 0.3.82 havia salvo e fechado sua janela às 17:47:33Z, mas manteve processos ociosos. `activity` confirmou zero jobs e turnos; todas as janelas tinham handle zero, e o log confirmou `Close storage verification: saved`. Após backup íntegro, somente essa árvore verificada do executável instalado foi encerrada para liberar o instalador. Não houve interrupção de trabalho ativo. O encerramento pendente dos serviços fica registrado para investigação separada.
- Nenhum teste novo executou chamadas de IA reais, publicação ou trabalhos pessoais. O app pessoal não foi reaberto após instalar, evitando disparar rotinas automáticas.

## Pacote e instalação

- Comando: `npx electron-builder --win nsis --publish never --config.directories.output=release/r83-20261029`.
- Instalador: `release/r83-20261029/MainsAgents-Setup-0.3.83.exe`.
- SHA-256 do instalador: `09a190925c6717cc08898dcc562010bb4bdbd25428e067a3558c073fd4759658`.
- SHA-256 do ASAR, igual no pacote e instalação: `ef4207737e7929c421c62f0069fcd51b7b58684534cd04a23667aa998e16abde`.
- NSIS oculto `/S /currentuser /D=<destino canônico>`, retorno **0** às `2026-10-29T18:13:35Z`.
- Destino: `%LOCALAPPDATA%/Programs/MainsAgents/MainsAgents.exe`; FileVersion **0.3.83**, ProductVersion **0.3.83.0**.
- Atalhos da Área de Trabalho e Menu Iniciar confirmados apontando para esse executável, com diretório de trabalho correto.

## Backup e preservação

Fora do Git: `~/.mainsagents/backups/local-update-0.3.83-2026-10-29`.

Backup online consistente por API SQLite dos nove bancos, todos com integridade `ok`; cópias de arquivos locais, referências/mídias gerenciadas, sessões e recursos de skills. Credenciais não foram copiadas nem alteradas. O suplemento preserva 15 raízes de skills, 63 arquivos de recursos; a auditoria inclui 146 arquivos do storage.

`before-install.json` e `after-install.json` passaram em `local-update-backup.mjs compare ... --strict-leases`. A mensagem padrão do helper ainda diz “lease rows ignored”, mas o argumento desabilita essa tolerância. Além disso, **`full-before.json` e `full-after.json` têm SHA-256 idêntico**, abrangendo hashes de todas as linhas dos nove bancos (incluindo leases), arquivos e skills, sem expor conteúdo pessoal no relatório.

Recibos locais: `manifest.json`, `activity-before-stop.json`, `install-receipt.json`, os dois pares de snapshots e `preservation-audit.mjs`. Dados pessoais e binários gerados não foram adicionados ao Git.
