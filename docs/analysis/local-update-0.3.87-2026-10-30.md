# Claude Code: modelo configurado no chat — 0.3.87 local

## Problema e comportamento final

O adaptador Claude já executava o Claude Code CLI autenticado pela conta local, mas o seletor não conhecia o modelo configurado. Quando o chat seguia o padrão, mostrava apenas Claude/Padrão do provedor. Antes de criar uma conversa, também ignorava visualmente um modelo explícito do agente.

Agora o status informa `connectionName` e `defaultModel` opcionais. O chat identifica Claude Code e exibe o modelo configurado quando não há escolha explícita; o menu explica que essa opção segue a configuração do CLI. Um modelo escolhido na conversa continua tendo prioridade. Antes da primeira conversa, o modelo do agente é exibido corretamente. A atualização de status não altera configurações, agentes ou sessões.

`claude-runtime-defaults.mjs` lê somente a escolha do modelo em `settings.json`, respeita `CLAUDE_CONFIG_DIR` e considera as variáveis `ANTHROPIC_MODEL` e `ANTHROPIC_DEFAULT_MODEL` na prioridade documentada. Configuração inválida, ausente, grande demais ou `default` não gera modelo inventado. Aliases como `opus` são mostrados como Claude Opus, sem fixar uma versão não confirmada. A leitura não usa inferência e não acessa credenciais.

O menu passou a usar o top layer do navegador (`popover="manual"`), mantendo a árvore DOM, estilos e navegação de teclado. Sua posição cabe na janela mesmo quando o painel do chat recorta os descendentes. Esc agora impede propagação ao atalho global, fecha só o menu e devolve foco ao botão. O seletor de esforço existente foi preservado; não foi alterada a política de esforço nem a autenticação.

Referência primária consultada: [configuração de modelos do Claude Code](https://code.claude.com/docs/en/model-config).

## Arquivos

- Novos `claude-runtime-defaults.mjs`, `tests/claude-runtime-defaults.test.mjs`, `scripts/test-claude-model-default-ui.mjs`.
- `claude-code-bridge.mjs`: acrescenta metadados ao status, com dependência injetável para teste.
- `src/features/chat/AiProvider.ts`: contrato opcional dos metadados.
- `src/components/chat/ChatPanel.tsx`: consulta/limpa metadados por provedor e respeita o modelo do agente antes de criar sessão.
- `src/components/chat/ModelPicker.tsx`: conexão, padrão identificado, posicionamento sem recorte e Esc com foco preservado.
- `package.json`, `package-lock.json`: versão 0.3.87 e inclusão do módulo no pacote.
- `README.md`, `RELEASE.md`, este relatório.

O checkout anterior, incluindo toda a V2 da 0.3.86, foi preservado. Claude Code estava em limite de uso ao receber a solicitação de UI; o pedido foi cancelado e Codex concluiu esses arquivos, avisando o terminal existente para não os alterar ao retomar. Sem novos workers, commit, push, tag ou publicação pública.

## Verificação

- `npm run typecheck` e build completo: aprovados.
- Testes focados de defaults, bridge, transporte/editor e aprovação MCP: **12 aprovados**. Cinco testes novos verificam configuração segura, prioridade, atualização sem cache, indisponibilidade sem inventar modelos e status sem inferência.
- `node --experimental-strip-types --test --test-concurrency=2 tests/*.test.mjs`: **925 testes, 923 aprovados, 2 renders HyperFrames condicionais ignorados, zero falhas**, em 227,3 s. Log `.mainsagents-workspaces/claude-defaults-all-tests.log`.
- `npx electron scripts/test-claude-model-default-ui.mjs`: aprovado no dist final e depois no renderer do ASAR final por `MAINSAGENTS_TEST_DIST`. Verifica configuração inicial, identidade Claude Code, esforço acessível, seleção explícita, atualização do padrão sem sobrescrever a seleção, reabertura, fallback honesto, modelo do agente antes da primeira conversa, menu inteiro a 360 px e Esc/foco. Zero requisições de inferência ou criação de sessão remota.
- Capturas finais do renderer empacotado: `.mainsagents-workspaces/claude-model-default-ui/1793371679556`. Revisão visual também realizada nas capturas do dist final `1793371540314`: escuro compacto e claro em inglês, usando o botão real de aparência.
- `test-canvas-boards-ui.mjs`: aprovado no dist final, evidência `.mainsagents-workspaces/canvas-boards-ui-test/1793371600536`.
- `MAINSAGENTS_TEST_ASAR=<ASAR final> npx electron scripts/test-desktop-persistence-ui.mjs`: **PACKAGED_NATIVE_PERSISTENCE_UI_OK**. Teste isolado de persistência/perfis, sem abrir o app pessoal.
- `check-build-files.mjs` e `check-desktop-release.mjs`: aprovados, **121 módulos**, nenhum ausente. `git diff --check` aprovado com CRLF tratado como fim de linha.

Limite registrado: `test-provider-choice-ui.mjs` falha no limite geométrico da janela de comparação a 360 px. A mesma falha foi reproduzida usando o ASAR instalado da **0.3.86**, antes desta mudança. Os logs de baseline e versão nova ficam em `.mainsagents-workspaces/claude-defaults-provider-baseline-ui.log` e `claude-defaults-provider-ui.log`. Não se declara essa suíte aprovada; a correção desta rodada limita-se ao menu de modelos.

## Pacote, instalação e preservação

Pacote final em `release/r87c-20261030`, gerado após o término dos testes. Uma tentativa intermediária em `r87b` encontrou um lease temporário de Remotion removido por um teste concorrente; esse pacote incompleto não foi instalado. `r87` precede os ajustes finais do menu e também não foi instalado.

- Instalador final: `release/r87c-20261030/MainsAgents-Setup-0.3.87.exe`.
- SHA-256: `b010564e4023610b904d3da60cd977ad1e028b3319d126e9e5bed42a2ea8db67`.
- ASAR, igual no pacote e na instalação: `31ee1524515ff0a32df753061d6e625bafcef997ebee3393249a91ca1350d3eb`.
- Instalação em `2026-10-30T14:48:31Z`, NSIS oculto `/S /currentuser /D=<destino canônico>`, retorno **0**.
- Destino `%LOCALAPPDATA%/Programs/MainsAgents/MainsAgents.exe`, FileVersion **0.3.87**, ProductVersion **0.3.87.0**. Atalhos da Área de Trabalho e Menu Iniciar confirmados.
- App já estava fechado, com zero jobs/turnos/processos confirmados em `activity`. Não houve encerramento forçado nem reabertura do app pessoal para disparar rotinas.
- Backup fora do Git: `~/.mainsagents/backups/local-update-0.3.87-2026-10-30`.
- Nove bancos copiados consistentemente pela API SQLite, todos com integridade `ok`. Arquivos de referências/mídia e sessões preservados; suplemento de **15 raízes de skills / 63 arquivos**, **150 arquivos do storage**.
- `compare before-install.json after-install.json --strict-leases` aprovado; adicionalmente os hashes dos arquivos `full-before.json` e `full-after.json` são idênticos, cobrindo todas as linhas dos bancos, arquivos e skills. Credenciais não foram copiadas nem alteradas. Dados pessoais e binários não foram adicionados ao Git.

Recibos e logs: `release/r87c-20261030/MainsAgents-0.3.87-verification.json`, backup `install-receipt.json`, `manifest.json`, `activity-final.json`, snapshots antes/depois e `.mainsagents-workspaces/claude-defaults-*`.
