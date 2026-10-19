# Release local 0.3.73 — câmera + tela e espera por limite do provedor

**Instalada, aberta, visível e verificada** em `C:/Users/pacas/AppData/Local/Programs/MainsAgents/MainsAgents.exe`, substituindo a .72. FileVersion **0.3.73**, ProductVersion **0.3.73.0**. Tarefa `task_d5a2398d0e6d`, dispatch `ctx_b26dc72a811b`. Implementação, QA, build e instalação: **Claude Code**; root Codex coordenou e revisou ([feature](camera-screen-provider-wait-2026-10-16.md), 810/810 aceito, com as correções de `task_0bb7c897a0b0`). Somente release local: sem commit, push, tag, publicação ou nova feature. Nenhum vídeo pessoal aberto/editado/renderizado/excluído; nenhuma inferência, probe de quota, MCP externo ou mutação de posts/Notion/Paper/agendamento; `editor-claude-setup` não foi reexecutado e nenhuma produção pessoal foi migrada ou retomada.

## Partida, backup e instalação

Provas em `.mainsagents-workspaces/local-update-0.3.73/` (helpers da .72 adaptados: `state-audit.mjs`, `audit-compare.mjs`, `package-audit.mjs`, `installed-tree-compare.mjs`, `verify-startup.mjs`, `receipt.mjs`, e o novo `verify-backup.mjs`).

1. Activity fresca: **0 processos do app, 0 jobs ativos, 0 turnos abertos** (`activity-start.json`; conferido também pelo caminho exato do executável). O app já estava fechado: nada foi fechado ou encerrado; Orca e outros apps intactos.
2. Snapshot `before-backup.json` e auditoria `audit-before-backup.json` frescos (nenhuma contagem histórica usada como base).
3. Backup online **novo** em `backup/` com a API de backup do SQLite (WAL incluído): **9/9 bancos `integrity ok`**; cópias storage **137**, imagens geradas **1**, sessões do runtime **16**, appdata **74**, skills **42**. `backup-file-verification.json`: todas as cópias conferidas por SHA-256 contra a origem (Node fs, caminhos longos), **0 divergências**, **0 credenciais copiadas**. Snapshot refeito após o backup: idêntico.
4. Auditoria com o app fechado logo antes de instalar (`audit-closed-final.json`) × backup: **sem nenhuma diferença** (linhas, schema, arquivos, credenciais).
5. NSIS `/S /currentuser /D=C:\Users\pacas\AppData\Local\Programs\MainsAgents` via `Start-Process -WindowStyle Hidden`: exit **0**, 9,5 s, 0.3.72 → 0.3.73. Instaladores, bundles e backups antigos preservados.
6. Logo após instalar, ainda com o app fechado: dados **idênticos** ao estado anterior (`compare-after-install.json`).

## Build e pacote

| Etapa | Resultado |
| --- | --- |
| `npm version 0.3.73 --no-git-tag-version` | `package.json`, lock e pacote raiz do lock em .73; sem tag |
| `build.files` | inclui `provider-limits.mjs`, `source-pairs.mjs`, `source-sync.mjs`; `check-build-files`: **105 módulos, missing []** |
| `npm run build` | exit 0 (typecheck, Vite, preview, Remotion, stage Whisper). Aviso existente de chunk grande |
| `node scripts/build-remotion-video.mjs --release` | bundle **`3404bdd9a71e549b`** reaproveitado (o mesmo do render real da feature; não voltou a `13a56b63b4a7cac4`) |
| `npx electron-builder --win nsis --publish never --config.directories.output=release/r73-final` | exit 0 |
| `MAINSAGENTS_RELEASE_DIR=release/r73-final node scripts/check-desktop-release.mjs` | exit 0, versão/hashes/arquivos/dependências ok |
| Pacote × fonte (`package-audit-release.json`) | **245 arquivos** comparados, **106 módulos JS** da raiz; só o `package.json` da raiz difere (chaves `scripts/devDependencies/build`), com versão, `main` e dependências idênticos; 477 desempacotados, 3 `package.json` de dependências com só metadados de publicação reescritos (campos de runtime iguais); **38 binários nativos** e **81 arquivos Remotion** idênticos à fonte; Whisper: 8 arquivos iguais ao stage e, vs .72, só `MANIFEST.stagedAt` difere |
| Código real empacotado | conferido no asar/unpacked, não só nos wrappers: rotas `provider-waits` e `sync-preview`, coordenador com gate/`EDITOR_WAIT_RESUMES`, observador Claude, classificador Codex, campo `screen` do storyboard, trilha de tela no executor, textos da UI (bloco do par, espera, atraso manual) e o **compositor Screen no bundle `3404bdd9a71e549b` empacotado** (`screenSrc`, `with-camera`, janelas) |
| Release × instalado | asar idêntico e **561/561 arquivos** do release iguais no instalado |

- Instalador `release/r73-final/MainsAgents-Setup-0.3.73.exe`: **278238734 bytes**, SHA-256 **`0882f8b3480985e70bfa0f970d3618221847d8b582f7a0a00c1ca29401150734`**.
- `app.asar` (release = instalado): **90600423 bytes**, SHA-256 **`5c182af72f425834e91cf60483f39ea14776d010801a7d008ed9fe1a566ec5f6`**.
- [Recibo](../../release/r73-final/MainsAgents-0.3.73-local-install-receipt.json) e `release/r73-final/MainsAgents-0.3.73-verification.json`.

A suíte (810/810, aceita na tarefa anterior) não foi repetida: não houve alteração funcional nesta tarefa; o build refez o typecheck.

## Abertura e comparação

App aberto normalmente, **visível**: janela “Central de controle · MainsAgents”, respondendo, 5 processos no caminho instalado. Startup: `single-instance lock=true`, `version=0.3.73`, storage `desktop-sqlite`, bridges prontas, `Main window loaded`; nenhum erro, só o aviso `fs.Stats` que já existia. Activity após abrir: **ocioso**.

Diferenças após abrir, todas verificadas estreitamente (`expected-startup-changes.json`, `verify-startup.mjs`):
- **Duas tabelas novas vazias** `content_source_pairs` e `provider_waits` e os triggers `fence_source_pairs` e `fence_source_pairs_update`; nenhuma outra mudança de schema.
- `metadata.app-version` .72 → .73, demais metadados iguais.
- Append no `startup.log` (prefixo intacto) e backup automático novo `backups/workspace-before-0.3.73-….json`.
- `account.json`: só a porta loopback mudou (59319 → 64517), conferido reconstruindo o hash original trocando apenas a porta.
- `publication_refresh`: só `lastRunAt`; `checked=0`, sem resultados; nenhum `publishing.observe` nem mudança de post/agendamento.
- Codex `auth.json` **inalterado**. `codex-runtime/config.toml`: a sincronização de conexão já existente (`codex-runtime-home.mjs`) substituiu uma cópia antiga do runtime por um hardlink ao `~/.codex/config.toml` compartilhado, que tinha mudado **fora do app antes da instalação** (escrito às 14:34Z; instalação às 17:33Z). Verificado: mesmo arquivo (inode), mesmo hash do compartilhado, compartilhado não escrito pelo app. O conteúdo não foi lido nem exibido.
- Tabelas de lease ignoradas apenas nessa comparação.

Todos os outros dados ficaram com o **mesmo hash por linha/tabela/arquivo**: agentes, providers, modelos, chats, mensagens, rascunhos, SRTs, produções (incluindo as bloqueadas, com as mesmas revisões/epochs, sem retomar), autoridades, editorial, recibos, assets e arquivos. **Zero** runs ou jobs pessoais novos; tabelas novas vazias. Não houve drift inesperado nem rollback.

## Limites reais
- Smoke instalado só de leitura; nenhuma feature nova foi acionada com vídeo pessoal.
- **Decisão do Claude real não foi executada**: nas provas da feature, as decisões do diretor e o evento de limite de ponta a ponta são simulados; FFmpeg, Remotion, medição de sincronismo, host, renderer e Electron são reais.
- Sincronismo automático exige áudio comum com estrutura e ~20 s de sobreposição (atraso dentro de ±120 s dos primeiros 200 s); senão, o atraso é manual e marcado como não verificado. A deriva é detectada e **não** corrigida.
- Espera por limite: retomada sempre explícita, sem timers, retries ou retomada automática; horário de liberação só quando o provedor informa.

Estado final: **MainsAgents 0.3.73 aberto, visível e ocioso; dados pessoais preservados; backup novo íntegro**.
