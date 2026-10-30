# Atualização local 0.3.82 — 29/10/2026

Instalada nesta máquina sobre a 0.3.81 em 29/10/2026 às 14:35 BRT. NSIS silencioso por usuário com retorno 0, destino `C:\Users\pacas\AppData\Local\Programs\MainsAgents`. O app pessoal permaneceu fechado; nenhuma pauta ou conversa pessoal foi excluída durante a atualização.

## Comportamento

- Antes: a entrada mostrava o guia de boas-vindas e o painel “Por onde começar”, inclusive por workspace. Agora: abre diretamente a visão geral. A ação de reabrir tutorial em Configurações também foi removida; preferências antigas de backup não o reativam.
- Antes: excluir chat ou conteúdo mantinha a pauta e não havia botão para removê-la. Agora: cada pauta no Estúdio possui lixeira com nome acessível, confirmação, estado de processamento, mensagem de erro e sucesso. Remove a pauta e seus registros de pesquisa; preserva conversas independentes e arquivos no disco.
- Pauta com conteúdo vinculado direciona à revisão da exclusão de conteúdo existente antes de permitir excluir a pauta. Pesquisa em execução impede a exclusão com explicação; nenhum trabalho é interrompido silenciosamente.
- Exclusão transacional por perfil/workspace/revisão. Reutiliza as cercas persistentes existentes (`content_tombstone_ids`, tipo `topic`) para impedir retorno por escrita antiga, resultados tardios, reinício ou restauração local de backup. Limpa pesquisas finalizadas, aprovações, ponteiros de tópico nos chats e rascunhos correspondentes.
- Corrigida a confirmação de exclusão de conteúdo que recarregava ao receber uma nova identidade do callback do pai. O callback atual fica em ref, mantendo o carregamento estável durante polls.

## Arquivos

- Entrada: `src/app/App.tsx`, `src/pages/Home.tsx`, `src/pages/Settings.tsx`.
- Exclusão: `src/pages/ContentStudio.tsx`, `src/features/content/ContentWorkflowProvider.tsx`, `src/styles/content.css`, `src/components/content/ContentDeletionDialog.tsx`.
- Backend e cercas: `content-workflow-bridge.mjs`, `content-deletion.mjs`, `content-deletion-model.mjs`, `content-deletion-model.d.mts`.
- Testes: novo `tests/topic-deletion.test.mjs`; atualizados `scripts/test-content-deletion-ui.mjs`, `scripts/test-ux-flow-ui.mjs`, `scripts/test-checkup-b01-b02-b08-ui.mjs`.
- Versão/documentação: `package.json`, `package-lock.json`, `README.md`, `RELEASE.md`, este relatório. Sem commit, push, tag ou release pública.

## Validação

- `npm run typecheck` e `git diff --check`: aprovados.
- `node --experimental-strip-types --test --test-concurrency=1 tests/topic-deletion.test.mjs tests/content-deletion.test.mjs tests/content-deletion-renderer.test.mjs tests/content-workflow.test.mjs tests/editorial-state-merge.test.mjs`: 26/26 aprovados.
- `node --experimental-strip-types --test --test-concurrency=2 tests/*.test.mjs`: 912 testes, 910 aprovados, 2 renders HyperFrames condicionais ignorados, zero falhas. Log `.mainsagents-workspaces/topic-removal-unit-tests.log`.
- `npm run build`, Remotion `--release`, `check-build-files.mjs`: aprovados; 120 módulos, nenhum ausente.
- UI sem introdução: `test-ux-flow-ui.mjs`, incluindo flag antiga false, troca de workspace, PT/EN, temas claro/escuro e larguras 360/880/1440. Capturas em `.mainsagents-workspaces/ux-flow-ui-test`.
- Diagnóstico manual acessível sem tutorial: `test-checkup-b01-b02-b08-ui.mjs`, resultado aprovado sem mutações externas ou erros de renderer. Evidência `.mainsagents-workspaces/checkup-b01-b02-b08-ui/1793294885375`.
- `test-content-deletion-ui.mjs`: backend, preload, SQLite e renderer reais; confirmação/cancelamento, preservação de conversas, exclusão de pauta após remover conteúdo, reload sem reaparecimento. Aprovado também com `MAINSAGENTS_TEST_ASAR` apontando ao pacote, evidência `.mainsagents-workspaces/content-deletion-ui/1793295229566` (captura 08 inspecionada visualmente; reload conferido pelo teste).
- `test-desktop-persistence-ui.mjs` com o ASAR do pacote: `PACKAGED_NATIVE_PERSISTENCE_UI_OK`.

As provas usam perfis isolados e dados sintéticos. Não houve inferência real, publicação, alteração de credenciais ou execução de automações pessoais.

## Pacote e instalação

- Comando: `electron-builder --win nsis --publish never --config.directories.output=release/r82-20261029`, seguido por `check-desktop-release.mjs`.
- Instalador: `release/r82-20261029/MainsAgents-Setup-0.3.82.exe`.
- SHA-256 instalador: `670601c39f908adedba2181ea6e094c4b264fad4f0abb847f26402e5523b3902`.
- SHA-256 ASAR empacotado e instalado: `49362d761ea33f400e57aa4a352ea8ecfd4f06a8537e3af2f6472af3cacd39d6`.
- Instalação: `Start-Process -WindowStyle Hidden -Wait` com `/S /currentuser /D=...`, retorno 0.
- FileVersion `0.3.82`, ProductVersion `0.3.82.0`. Atalhos do Desktop e Menu Iniciar conferidos, destino e diretório de trabalho canônicos.

## Backup e preservação

Backup fora do Git: `C:\Users\pacas\.mainsagents\backups\local-update-0.3.82-2026-10-29`.

`local-update-backup.mjs activity` comprovou zero processos do app, trabalhos ativos ou turnos abertos antes da instalação e depois dela. Backup online dos nove bancos SQLite com integridade `ok`; arquivos de armazenamento, histórico local e skills copiados, incluindo suplemento completo de 15 raízes/63 arquivos de recursos de skills.

`before-install.json` e `after-install.json` comparados com `--strict-leases`: sem diferenças. `full-before.json` e `full-after.json` também idênticos: hashes de todas as linhas dos nove bancos, 145 arquivos locais (incluindo mídias gerenciadas) e recursos das skills. Recibo de instalação, manifesto e hashes guardados no mesmo diretório. Credenciais não foram modificadas. Nenhum dado pessoal consta neste relatório.
