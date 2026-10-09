# Atualização local 0.3.53 → 0.3.55 (07/10/2026)

Instalação pessoal nesta máquina. **Não é release pública**: nada foi publicado, commitado ou marcado com tag. O link público continua em [v0.3.42](https://github.com/devpedrohbs/MainsAgents/releases/tag/v0.3.42).

## Alvo

- Executável: `C:\Users\pacas\AppData\Local\Programs\MainsAgents\MainsAgents.exe` (antes 0.3.53.0, agora **0.3.55.0**)
- Estado: `C:\Users\pacas\.mainsagents\storage\workspace-state.sqlite` (fora da instalação, não foi tocado pelo instalador)
- Perfil Electron: `%APPDATA%\mains-agents`

## Build e checks

- `package.json`/`package-lock.json` = 0.3.55 (`npm version 0.3.55 --no-git-tag-version --ignore-scripts --allow-same-version`; já estava em 0.3.55 no working tree). Todas as mudanças locais foram mantidas, sem commit, tag ou reset.
- `npm test`: **336/336**.
- `npm run desktop:dist` (`--publish never`): `tsc -b`, vite, bundle Remotion, staging do Whisper, electron-builder NSIS e `check-desktop-release.mjs` (61 módulos verificados), tudo sem erro.
- `npx electron scripts/test-packaged-media.mjs release/win-unpacked`: `PACKAGED_MEDIA_OK`. Usa o ffprobe do compositor desempacotado, o Chrome do sistema, o Whisper `ggml-base` de `resources/tools` e o ffmpeg do PATH. A exportação foi de 10,13 s para 5,17 s, com overlays e SRT.
- `MAINSAGENTS_TEST_ASAR=release\win-unpacked\resources\app.asar npx electron scripts/test-desktop-persistence-ui.mjs`: `PACKAGED_NATIVE_PERSISTENCE_UI_OK`.
- Os artefatos 0.3.55 anteriores (17:58) foram sobrescritos por este build (21:13). Os recibos 0.3.53 e 0.3.54 não foram usados.

## Hashes (recibo `release/MainsAgents-0.3.55-verification.json`, 2026-10-08T00:13:39Z)

| Artefato | SHA-256 |
| --- | --- |
| `MainsAgents-Setup-0.3.55.exe` (277.738.297 bytes) | `db825bbffe69b4fcb625017b8fdb79cd0cb9453a6f95e30a9ae078acce98a3c8` |
| `app.asar` (build e **instalado**, idênticos) | `a9ec1f3cf52fc8df710fc15784d73112afec9356ef8f83876c614ef4b5710836` |

## Fechamento e backup

- Jobs ativos antes de fechar: zero. As tabelas de jobs, de execuções de produção e de workflow estavam vazias, e `runtime_actions` só tinha registros `succeeded`/`interrupted`.
- Primeiro foi feito um backup ao vivo pela API de backup do SQLite, com o app aberto. Depois o app oficial foi fechado com `CloseMainWindow` (log: `Close storage verification: saved`). Todos os processos saíram sem forçar, e o WAL foi consolidado. Nenhum outro processo foi tocado.
- Backup: `C:\Users\pacas\Documents\MainsAgentsBackups\before-update-0.3.55-20261007-211149`
  - `live\workspace-state.sqlite`: cópia ao vivo, `integrity_check=ok`
  - `storage-sqlite\workspace-state.sqlite`: cópia com o app fechado, `integrity_check=ok`
  - `storage-files\`: cópia integral de `.mainsagents\storage` (imagens e backups internos)
  - `appdata-mains-agents\`: perfil Electron copiado com `robocopy /XJ`, sem caches. Ficaram de fora as junctions do Codex (`skills`, `plugins`, `rules`, `secrets`, `mcp-oauth-locks`), `auth.json`, `config.toml` e `.sandbox*`. O backup não tem nenhum reparse point nem arquivo de credencial. Os originais não foram apagados nem movidos.
  - `snapshot-*.json`: contagens e SHA-256 canônicos, sem conteúdo.

## Instalação e preservação

- `Start-Process … -ArgumentList '/S','/D=C:\Users\pacas\AppData\Local\Programs\MainsAgents' -WindowStyle Hidden -Wait`: código de saída 0. O hash do instalador foi conferido antes.
- Os atalhos do Menu Iniciar e da Área de Trabalho continuam apontando para o executável oficial.
- Comparação do estado (SHA canônico por chave, sem ler texto):
  - antes do fechamento e depois da instalação, ainda sem abrir: `a6aee489…c28b`, idêntico (37 chaves);
  - depois de abrir a 0.3.55: as **37 chaves originais estão idênticas**. Há uma chave nova de preferência de UI (`execution-overview-filter:<workspace>`), duas tabelas novas e vazias da migração (`editorial_silences`, `editorial_transcripts`) e os leases recriados pelo app em execução;
  - `editorial_state`: 0 linhas antes e depois (sem mudança).
- Inicialização: `version=0.3.55`, o serviço de conta local, o bridge do Codex e o servidor web ficaram prontos, `nativeStorage=true` e `Main window loaded`. O log não registra falha de inicialização, de preload nem bloqueio de fechamento.
- Disponibilidade local, sem chamadas: `codex`, `claude`, `ffmpeg` e `ffprobe` estão no PATH, e Chrome e Edge estão instalados. No diretório instalado existem whisper-cli, `ggml-base.bin`, o bundle Remotion e o ffprobe desempacotados.

## Limites

- Não houve chamada de IA, Notion ou publicação, nem autenticação. A prontidão real das contas Codex e Claude não foi exercida.
- O app foi aberto com `-WindowStyle Hidden`. A janela não foi inspecionada visualmente.
- Para reverter, feche o app, reinstale `release/MainsAgents-Setup-0.3.54.exe` ou um instalador 0.3.53 e, se for preciso, restaure `storage-sqlite\workspace-state.sqlite` do backup.
