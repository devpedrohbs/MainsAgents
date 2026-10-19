# Release local 0.3.70 — SRT separado e editável (CapCut)

Tarefa Orca `task_7336be69c96d` (dispatch `ctx_d7a62ef70c04`). **Instalada e em execução** neste computador. Foi só uma instalação local: sem commit, push, tag ou release pública, sem chamada de IA, sem plugins e sem abrir, renderizar ou editar vídeo pessoal. O código da feature é o aceito pelo Codex no `task_d2f34c219bd0` (relatório: `docs/analysis/editable-srt-2026-10-15.md`).

## Resultado

- MainsAgents **0.3.70** instalado em `C:/Users/pacas/AppData/Local/Programs/MainsAgents` sobre a 0.3.69 verificada. FileVersion `0.3.70`, ProductVersion `0.3.70.0`. NSIS `/S /currentuser /D=…`, oculto, saída 0, em 9 s.
- App aberto pelo executável às `2026-10-15T17:11:15Z`, **visível**. Janela "Central de controle · MainsAgents" respondendo, 5 processos `MainsAgents.exe` (principal + auxiliares Electron).
  - `startup.log` (`C:/Users/pacas/.mainsagents/storage/startup.log`): perfil `QDywHaiJ…`, `version=0.3.70`, storage nativo `desktop-sqlite`, Codex bridge pronto e "Main window loaded".
  - Nenhum erro. O único aviso, `DeprecationWarning: fs.Stats`, já aparecia na 0.3.69 (58 ocorrências anteriores).
- **Onde usar:** Estúdio → conteúdo → card **"Legendas SRT para o CapCut"**. Funciona sem vídeo (importa o SRT do CapCut) ou gera do vídeo editado com o Whisper local. Divide em blocos de 2/3/4 palavras, permite editar e **"Salvar e baixar SRT"** (UTF-8 sem BOM, CRLF). Na produção, o mesmo editor é o painel principal da revisão do vídeo, e gravar legenda no vídeo fica em "Avançado", fechado.
- **Limites ditos ao usuário:**
  - Os tempos de SRT importado sem áudio são **estimados** e marcados como tal.
  - O Whisper é aproximado, sem erro máximo garantido.
  - Não há garantia para todos os modelos de legenda do CapCut.

## Ordem executada e provas

1. **Partida (leitura fresca):**
   - `activity` sem processo do app, jobs ou turnos abertos (`activity-start.json`). Nenhum app fechado nem processo encerrado.
   - Instalada: 0.3.69.
   - Counts: 4 agentes (EditorDeVideo `claude`, modelo padrão, `fileAccess` off), 13 chats (12 codex, 1 claude), 241 itens (57 mensagens, 184 atividades), 2 runs `blocked` na epoch 2.
   - Arquivos: `before-backup.json` e `counts-before.json`.
2. **Backup online novo** em `.mainsagents-workspaces/local-update-0.3.70/backup`:
   - 9 bancos SQLite com integridade `ok`;
   - cópias `storage`=134, `codex-runtime-sessions`=16, `generated-images`=1, `appdata-mains-agents`=74, `skills`=42;
   - sem credenciais;
   - o snapshot do backup é IDENTICAL ao de partida.
   - O backup anterior à feature (`C:/Users/pacas/Documents/MainsAgentsBackups/before-editable-srt-2026-10-15`, 5 arquivos) foi preservado intacto, com hashes no recibo. Nenhum backup foi apagado ou sobrescrito.
3. **Helper de atividade** (`scripts/local-update-backup.mjs`): agora também considera ativo um `content_srt_documents` com `job.status` em andamento (`srt-running`). Verificação focada num fixture temporário (`activity-check/`): com um job `running` e um `done`, sai `active:true`, exit 3, e só o `running` é listado.
4. **Versão e build:**
   - `npm version 0.3.70 --no-git-tag-version`, com `package.json` e `package-lock.json` em 0.3.70;
   - `content-srt.mjs` e `editorial-srt.mjs` adicionados a `build.files`;
   - `npm run build` (tsc/typecheck, vite, preview, Remotion e stage do Whisper);
   - Remotion `--release`, bundle `13a56b63b4a7cac4` **reaproveitado** (nada apagado);
   - `check-build-files`: 95 módulos, `missing: []`. Log em `build.log`.
5. **Pacote:**
   - `electron-builder --win nsis --publish never --config.directories.output=release/r70-final` (pasta nova). `check-desktop-release` com `MAINSAGENTS_RELEASE_DIR=release/r70-final` ok, 95 módulos nativos.
   - **Pacote = fonte byte a byte** (`packaged-compare-release.json`): 216 arquivos do asar (96 módulos da raiz e 115 de `dist`, incluindo o renderer) idênticos. Só o `package.json` difere, pela reescrita do builder (`scripts`/`devDependencies`/`build`); `main`, `version` e `dependencies` são iguais.
   - 82 arquivos desempacotados idênticos, dos quais 81 são do Remotion.
   - Novos imports presentes: a ponte importa `./content-srt.mjs` e expõe `/api/content/srt` e `/api/content/srt/file`; o serviço importa `./editorial-srt.mjs`.
   - Guia atualizado presente, e o renderer contém o card SRT e "Salvar e baixar SRT".
   - Whisper (`resources/tools/whispercpp`): binários e modelo idênticos à 0.3.69; só o `MANIFEST.stagedAt` mudou (`tools-compare.json`).
6. **Instalação:**
   - Antes: `activity` ocioso, snapshot fresco (`before-install.json`) IDENTICAL ao de partida, backup verificado.
   - Depois do instalador: `after-install.json` IDENTICAL (leases ignorados).
   - O pacote instalado é idêntico ao release, com o mesmo `app.asar` (`packaged-compare-installed.json`).
7. **Abertura:**
   - `after-launch.json` × `before-install.json`: a **única** diferença é `storage/workspace-state.sqlite.content_srt_documents: undefined -> 0`, a tabela nova e vazia esperada. Esta versão não migra dados antigos.
   - `counts-after-launch.json` é igual ao de antes da instalação em todos os campos: agentes, provedores, EditorDeVideo `claude`, 13 chats com IDs/provedores (sha `91ba8f4d…`), 241 itens, sha das sessões e os 2 runs com mesma revisão/sha (`8314f2f5` r64, `9bed8ebf` r17, não retomados).
   - `activity` com o app aberto: nenhum job, turno ou trabalho de mídia.
   - Nenhum acesso alternativo ao servidor local foi tentado: sem forjar origem, token ou autenticação.

## Testes

- Não houve mudança de código do app nesta rodada, então a suíte não foi repetida. Valem os resultados aceitos: `content-srt` 16/16, afetados 70/70, suíte **736/736**.
- O typecheck rodou de novo dentro do `npm run build`.
- **UI fixture × dados do usuário:** as provas de interface (Electron SRT com 4 downloads reais e painel da produção) rodaram em **fixtures isolados** (`.mainsagents-workspaces/srt-workbench-ui/…`, `captions-frames-ui/…`) na rodada anterior. Os dados reais do usuário só foram lidos (snapshot/counts/backup) e não foram alterados. Na instalação real, não abri nenhum conteúdo nem usei a ferramenta SRT com dados do usuário.
- A única alteração de script nesta rodada foi a detecção de job SRT no helper, verificada com o fixture temporário descrito no passo 3.

## Artefatos

- Instalador: `release/r70-final/MainsAgents-Setup-0.3.70.exe`, 278 168 309 bytes, SHA-256 `1ccba78f255fce48a35cea623adbe18fb88368a7ec196c97ec6f3182762f6b61`.
- `app.asar` (release = instalado): 90 300 015 bytes, SHA-256 `3407ae77dd5a644445b4ceee0c29221d09107bfd5e39b20583c05ff1660cf4ad`.
- Recibo: `release/r70-final/MainsAgents-0.3.70-local-install-receipt.json`.
- Provas em `.mainsagents-workspaces/local-update-0.3.70/`:
  - estado e snapshots: `activity-*`, `before-backup`, `before-install`, `after-install`, `after-launch`, `counts-*`;
  - empacotamento: `packaged-compare-*`, `tools-compare.json`, `release-check.json`, `build.log`, `package.log`;
  - backup: `backup/`;
  - helper: `activity-check/`;
  - scripts: `packaged-compare.mjs`, `tools-compare.mjs`, `receipt.mjs`.

## Estado final

O app 0.3.70 está **aberto e visível**, ocioso. Nenhum vídeo pessoal foi editado e nenhuma produção foi retomada. Agentes, chats e conteúdos estão como antes, com EditorDeVideo continuando Claude.
