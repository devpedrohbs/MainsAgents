# Release local 0.3.67 — espaços de conteúdo (2026-10-13)

Instalação local apenas. Sem commit, push, tag ou release pública; sem chamadas reais de IA, geração de imagem, agendamento ou redes sociais.

## Build
- `package.json`/`package-lock.json`: 0.3.66 → 0.3.67 (`npm version --no-git-tag-version`; nenhuma versão mais nova existia).
- `npm run typecheck` e `npm run build` OK, com o código-fonte final congelado (dist gerado depois da correção legacy-active).
- `build-remotion-video --release`, `check-build-files` (92 módulos, nenhum faltando), `electron-builder --win nsis --publish never` em `release/r67-final` (caminho novo; `release/r66/win-unpacked` travado pelo Orca não foi tocado).
- `check-desktop-release` (`MAINSAGENTS_RELEASE_DIR=release/r67-final`):
  - instalador `MainsAgents-Setup-0.3.67.exe` SHA-256 `eaef9d3b7cc8ee5ab82fa03d11bfb8aa598ec724de3d7f0646916671c1fbc671`
  - `app.asar` SHA-256 `61e1246815cb589d2a22fc0194e283298e21a72b0868f419ae6702a560f94952`

## Prova do pacote
- Os 34 arquivos de `dist` dentro do asar e os 94 módulos da raiz são idênticos byte a byte ao código-fonte (só o `package.json` muda, reescrito pelo electron-builder); 82 arquivos de `dist/remotion` ficam em `app.asar.unpacked`.
- `test-packaged-content-sessions` contra `release/r67-final/win-unpacked`: `PACKAGED_CONTENT_SESSIONS_OK`.
- `test-content-scopes-ui` com `MAINSAGENTS_UI_DIST` = dist extraído do asar 0.3.67 (fixture isolada, sem chats pessoais): `CONTENT_SCOPES_UI_OK`.

## Backup e preservação
- Atividade antes da instalação: ociosa (sem jobs, turnos abertos ou processos do app). Nenhum processo precisou ser fechado.
- Backup online (`node:sqlite backup()`, handle de origem aberto durante o await) de 9 bancos SQLite (storage, appdata, codex-runtime), com `integrity_check` ok e SHA registrado; cópia de storage/imagens/mídia, imagens geradas e sessões do CLI, perfil do app sem caches e 42 skills. Credenciais não foram lidas nem copiadas.
- Pasta: `C:\Users\pacas\Documents\ChatGPT\MainsAgents\.mainsagents-workspaces\local-update-0.3.67\20261013-230636\backup`.
- Perfil ativo antes: 4 agentes e 9 sessões, com 204 itens de chat. Desses itens, 44 são mensagens de texto (`ChatMessageItem`) e 160 são atividades (`ChatActivityItem`). Os números são iguais na cópia de backup e na leitura atual. Criador de Carrosséis com Paper ativo e automático (Joyful olive) e publicação Publora ativa.
- Depois da instalação e antes de abrir o app: snapshot IDÊNTICO.
- Depois de abrir o app: a única diferença é a nova chave `content-scopes` (state 39 → 40), criada com `selected` e `active` vazios. Ou seja, nenhum chat pessoal foi agrupado por palpite. Agentes, sessões, rascunhos e os dados editoriais, de produção e de publicação continuam com o mesmo hash, assim como recibos, runtime do Codex, imagens e skills.

## Instalação
- Instalador `C:\Users\pacas\Documents\ChatGPT\MainsAgents\release\r67-final\MainsAgents-Setup-0.3.67.exe` executado com os argumentos `/S`, `/currentuser` e `/D=C:\Users\pacas\AppData\Local\Programs\MainsAgents` (código de saída 0).
- `C:\Users\pacas\AppData\Local\Programs\MainsAgents\MainsAgents.exe` com versão de arquivo 0.3.67.0 e entrada de desinstalação "MainsAgents 0.3.67". O hash do `app.asar` instalado é igual ao do build.
- No `startup.log` aparecem `version=0.3.67`, Codex bridge pronto, `nativeStorage: true` e `Main window loaded`.
- O app ficou aberto em uma única instância.

Recibo: `release/r67-final/MainsAgents-0.3.67-local-install-receipt.json`.
