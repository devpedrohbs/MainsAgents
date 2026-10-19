# Release local 0.3.71: exclusão local de conteúdo (2026-10-15/16)

Tarefa Orca `task_8f62903dbc29` (dispatch `ctx_773c000709a8`). **Instalada e em execução** neste computador.
- O código é o aceito pelo Codex em `task_3f27e5d7d37c` e `task_ce796aab3c73`. Relatórios: `content-deletion-2026-10-15.md` e `content-deletion-review-2026-10-15.md`.
- Foi só uma instalação local: sem commit, push, tag ou release pública.
- Sem chamada de IA, sem mutação externa e sem abrir, renderizar ou editar vídeo pessoal.
- Nenhum conteúdo ou conversa real foi excluído: a feature não foi acionada com dados do usuário.

## Resultado

- MainsAgents **0.3.71** instalado em `C:/Users/pacas/AppData/Local/Programs/MainsAgents` sobre a 0.3.70 verificada.
  - FileVersion `0.3.71`, ProductVersion `0.3.71.0`.
  - NSIS `/S /currentuser /D=…`, rodado com `Start-Process -WindowStyle Hidden`. Saída 0, em 8 s.
- App aberto pelo executável às `2026-10-16T00:06:31Z`, **visível**.
  - Janela "Central de controle · MainsAgents" respondendo; 5 processos `MainsAgents.exe` (principal + auxiliares), todos no caminho instalado.
  - `startup.log`: `single-instance lock=true`, perfil `QDywHaiJ…`, `version=0.3.71`, storage `desktop-sqlite`, Codex bridge pronto e "Main window loaded".
  - Nenhum erro. O único aviso (`DeprecationWarning: fs.Stats`) já aparecia antes.
- **Onde usar:** o botão "…" do conteúdo leva a "Excluir conteúdo e conversas…". Ele aparece na barra de conteúdo do chat, na caixa do conteúdo em Sessões e no card do Estúdio. Há uma confirmação única.

## Ordem executada e provas

Todos os arquivos citados ficam em `.mainsagents-workspaces/local-update-0.3.71/`.

1. **Partida, leitura fresca:**
   - `activity-start.json`: ocioso, sem processo do app, jobs ou turnos abertos. O app já estava **fechado**, então nenhum processo foi encerrado.
   - Versão instalada: 0.3.70.
   - Snapshot `before-backup.json` e `counts-before.json`:
     - 4 agentes (EditorDeVideo `claude`);
     - 13 chats (12 codex, 1 claude);
     - 206 itens (46 mensagens, 160 atividades);
     - 2 runs `blocked`.
   - As contagens são diferentes das da 0.3.70 por causa do uso normal desde então. A base usada foi a fresca.
2. **Backup online novo** em `backup/` (`scripts/local-update-backup.mjs backup`):
   - 9 bancos SQLite com integridade `ok`;
   - cópias `storage`=135, `codex-runtime-sessions`=16, `generated-images`=1, `appdata-mains-agents`=73, `skills`=42;
   - sem credenciais;
   - snapshot IDENTICAL ao de partida (leases ignorados).
   - Backups anteriores preservados: nada foi apagado nem sobrescrito.
3. **Versão e build:**
   - `npm version 0.3.71 --no-git-tag-version`; `package.json` e `package-lock.json` em 0.3.71.
   - `build.files` já continha `content-deletion.mjs`, `content-deletion-ipc.mjs` e `content-deletion-model.mjs`.
   - `npm run build`: tsc, vite, preview, Remotion e stage do Whisper.
   - Remotion `--release`: bundle `13a56b63b4a7cac4` **reaproveitado**.
   - `check-build-files`: 98 módulos, `missing: []`.
   - Log: `build.log`.
4. **Pacote:**
   - `electron-builder --win nsis --publish never --config.directories.output=release/r71-final` (pasta nova).
   - `check-desktop-release` com `MAINSAGENTS_RELEASE_DIR=release/r71-final`: ok, 98 módulos (`release-check.json`).
   - **Pacote = fonte** (`packaged-compare-release.json`):
     - 219 arquivos do asar, sendo 99 módulos da raiz e 115 de `dist` com o renderer, idênticos.
     - Só o `package.json` difere, pela reescrita do builder; `main`, `version` e `dependencies` são iguais.
     - 82/82 arquivos desempacotados idênticos (81 do Remotion).
   - Integrações presentes no pacote:
     - a ponte importa `content-deletion.mjs` e só recupera exclusões abandonadas com `hostExclusive`;
     - o `desktop-main` passa `hostExclusive:true` e registra `content-deletion-ipc`;
     - o preload expõe `content:delete`;
     - o store tem o restore que omite o excluído;
     - o renderer contém o item de menu e o aviso de restore.
   - Whisper (`resources/tools/whispercpp`): binários e modelo idênticos à 0.3.70; só `MANIFEST.stagedAt` mudou (`tools-compare.json`).
5. **Instalação:**
   - Antes: `activity` ocioso, 0 processos do app e snapshot `before-install.json` IDENTICAL ao de partida.
   - Depois: `after-install.json` IDENTICAL.
   - O pacote instalado é idêntico ao release, com o mesmo `app.asar` (`packaged-compare-installed.json`).
6. **Abertura:**
   - `after-launch.json` × `before-install.json`: as **únicas** diferenças são as 4 tabelas novas e vazias esperadas: `content_deletion_requests`, `content_tombstone_ids`, `content_tombstones` e `deleted_content_delivery_facts` (`undefined -> 0`).
   - `counts-after-launch.json` é **idêntico** a `counts-before.json`: agentes, provedores, IDs e sha dos chats, itens, rascunhos e os 2 runs com a mesma revisão/sha (não retomados).
   - Os 23 triggers `fence_*` foram criados e há 0 tombstones (`fence-check.json`, leitura somente).
   - `activity` com o app aberto: ocioso.

## Testes

- Não houve mudança de código do app nesta rodada, só o bump, então a suíte não foi repetida.
- Valem os resultados aceitos: suíte **752/752**, typecheck, Electron isolado de exclusão e restore (fixtures). O build refez o typecheck.
- O smoke instalado foi somente leitura (snapshot, counts, triggers e janela).

## Artefatos

- Instalador: `release/r71-final/MainsAgents-Setup-0.3.71.exe`, 278 183 946 bytes, SHA-256 `2d719393eb005dbb220f2fd27b1b2447f4d9304f8256cca6c9d2e2bba4d25496`.
- `app.asar` (release = instalado): 90 375 517 bytes, SHA-256 `dda04c2b87e3cef6f75437198a3c188da23654d5fb0362dd9fc431c4fe229cea`.
- Recibo: `release/r71-final/MainsAgents-0.3.71-local-install-receipt.json`.
- Provas: `activity-*`, `before-backup`, `backup-snapshot`, `before-install`, `after-install`, `after-launch`, `counts-*`, `packaged-compare-*`, `tools-compare.json`, `release-check.json`, `fence-check.json`, `build.log`, `package.log` e `backup/`.

## Limitações reais

- A exclusão não apaga arquivos físicos (brutos, renders, exports) nem cancela posts no provedor.
- Backups antigos continuam com os dados. Restaurar um deles mantém excluído o que foi excluído e avisa quantos itens ficaram de fora.
- A recuperação de uma exclusão interrompida por crash acontece só no app desktop, que é o host exclusivo.

## Estado final

O app 0.3.71 está **aberto e visível**, ocioso. Agentes, chats, rascunhos, produções e SRT estão como antes.
