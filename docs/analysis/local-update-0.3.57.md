# Atualização local 0.3.56 → 0.3.57 (08/10/2026)

Instalação pessoal nesta máquina. **Não é release pública**: nada publicado, commitado ou marcado com tag; o link público continua em v0.3.42. Nenhuma IA, Notion, publicação ou conta externa foi usada.

- Executável: `C:\Users\pacas\AppData\Local\Programs\MainsAgents\MainsAgents.exe` — **0.3.57.0** (antes 0.3.56.0).
- Estado: `C:\Users\pacas\.mainsagents\storage\workspace-state.sqlite` (fora da instalação).

## O que entra
Rodada de check-up (QA em [checkup-round-b07-b09-b10-integration-report.md](checkup-round-b07-b09-b10-integration-report.md)): B01/B02/B08, B03 (escolher o frame vendo o vídeo), B05 (legendas gravadas no MP4), B07 (Notion opcional: modo local × Notion), B09 (análise de referências acessíveis), B10 (status de publicação somente leitura), B11 (uso reportado pelo CLI). B04 excluído; B06 (vídeo real) pendente; mobile intocado.

## Build e QA aceito
- `npm version 0.3.57 --no-git-tag-version --ignore-scripts` (package.json/package-lock.json) e `npm run desktop:dist` (`--publish never`): saída 0 — tsc, Vite, preview, bundle Remotion, staging Whisper, NSIS e `check-desktop-release` com **71 módulos** no pacote.
- QA anterior aceito, não repetido (só mudou a versão): 449/449 testes, build completo, UIs novas e regressão aprovadas; `test-content-flow-components-ui` estourou o timeout no lote (inconclusivo, sem falha do app) e passou isolado 31/31.
- Artefatos 0.3.55/0.3.56 preservados (instaladores e recibos intactos).

## Hashes (recibo `release/MainsAgents-0.3.57-verification.json`, 2026-10-08T18:18:56Z)
| Artefato | SHA-256 |
| --- | --- |
| `MainsAgents-Setup-0.3.57.exe` | `e2e780f6a40296fc3ed409dbdb7001dd0e5ca38a80f189894fb3c4fbfd80e40d` |
| `app.asar` (build, recibo e **instalado**, idênticos) | `80de0d37690c35bb06536ab427d24327476f5493c9b7ed40ba6507b477a0b4e9` |

## Checks contra o app.asar final (`release/win-unpacked`)
- `test-packaged-media.mjs`: **PACKAGED_MEDIA_OK** (ffprobe do Remotion, Chrome do sistema, Whisper ggml-base, FFmpeg).
- `test-desktop-persistence-ui.mjs` com `MAINSAGENTS_TEST_ASAR`: **PACKAGED_NATIVE_PERSISTENCE_UI_OK** (perfil isolado).
- `test-packaged-content-flow.mjs`: **PACKAGED_CONTENT_FLOW_OK** (capas reais empacotadas).
- **Novo** `scripts/test-packaged-checkup.mjs`: **PACKAGED_CHECKUP_OK** — 11 módulos B03/B05/B07/B09/B10/B11 (captions, transcribe, inspiration-analysis, status-refresh, claude-usage, budget, script, preflight, execution, bridge, coordinator) dentro do asar, byte a byte iguais ao código-fonte e importáveis; contratos puros (modo Notion por padrão, intervalos 5/15/30/60, uso reportado) e **legendas reais gravadas com o motor empacotado** (libass, áudio copiado, original intacto, sem IA).

## Fechamento e backup
- Antes de instalar o app oficial **não estava em execução** (0 processos); todas as tabelas de jobs/produção/workflow com contagem 0 — nada foi interrompido.
- Backup: `C:\Users\pacas\Documents\MainsAgentsBackups\before-update-0.3.57-20261008-152011`
  - `storage-sqlite\workspace-state.sqlite` pela **API de backup do SQLite** (inclui WAL commitado), `integrity_check=ok`, 38 linhas de state.
  - `storage-files\` (cópia de `.mainsagents\storage`) e `appdata-mains-agents\` (robocopy /XJ, sem caches, sem `auth.json`/`config.toml`; os 3 diretórios `.sandbox*` do Codex foram retirados só da cópia): 134 arquivos, 0 arquivos de credencial.
  - `snapshot-before.json`, `snapshot-after-install-before-launch.json`, `snapshot-after-launch.json` (contagens e SHA canônico por chave, sem conteúdo) e cópia do recibo 0.3.56. Nada original foi apagado ou movido.

## Instalação e preservação
- SHA do instalador conferido contra o recibo antes de `Start-Process … /S /D=<caminho oficial> -WindowStyle Hidden -Wait`: **saída 0**; `ProductVersion 0.3.57.0`; app.asar instalado = recibo; atalhos do Menu Iniciar e da Área de Trabalho apontam para o executável oficial.
- Antes × depois da instalação × depois de abrir: as **38 chaves de state são idênticas** (SHA canônico `b0348440…` nos três momentos); `editorial_state` idêntico; integridade ok. Única diferença: duas tabelas **novas e vazias** (`inspiration_analyses` de B09, `publication_refresh` de B10), criadas na abertura — migração esperada, sem dados.
- Inicialização (startup.log): `version=0.3.57`, serviço de conta, bridge do Codex e servidor web prontos, `nativeStorage:true` e `Main window loaded`; sem erro crítico (só o aviso `fs.Stats` pré-existente).

## Limites
- App aberto oculto e ainda em execução (5 processos); a janela não foi inspecionada visualmente aqui. Sem login/inferência real: prontidão Codex/Claude não exercida.
- **B06 continua pendente**: exige o vídeo e o modo (Claude local ou Claude + card de teste no Notion) escolhidos pelo usuário. HDR real sem tone-mapping não foi avaliado. Mobile passou verificações Windows, mas Swift/iPhone não foram compilados/testados — não declarado completo.
- Reverter: fechar o app, reinstalar `release/MainsAgents-Setup-0.3.56.exe` e, se preciso, restaurar `storage-sqlite` do backup.

## Arquivos deste despacho
`package.json`, `package-lock.json` (versão), `RELEASE.md`, `scripts/test-packaged-checkup.mjs` (novo), este relatório, checkpoint; artefatos em `release/` (Setup 0.3.57, .sha256, .blockmap, verification.json, win-unpacked) e `dist/`.
