# Atualização local 0.3.57 → 0.3.58 (08/10/2026)

Instalação pessoal nesta máquina. **Não é release pública**: nada publicado, commitado ou marcado com tag; o link público continua em v0.3.42. Nenhuma IA, Notion, publicação ou conta externa foi usada. Sem features novas.

- Executável: `C:\Users\pacas\AppData\Local\Programs\MainsAgents\MainsAgents.exe` — **0.3.58.0** (antes 0.3.57.0).
- Estado: `C:\Users\pacas\.mainsagents\storage\workspace-state.sqlite` (fora da instalação).

## O que entra
Sessões por conteúdo no mesmo agente e entrada com vídeo já gravado ([relatório](content-sessions-report-2026-10-08.md)): `production-import.mjs` (novo), `ContentSessionCard`/`RecordedEntry`, contexto de produção com marcador de truncamento, espelhamento A/B. QA aceito e não repetido: 462 testes após o espelhamento, teste focado do truncamento, Electron integrado com payload A/B e reinício, regressões e build completo.

## Build
- **Correção de empacotamento:** `production-import.mjs` NÃO estava em `build.files` (o `check-desktop-release` só falharia ao importar do asar). Adicionado em `package.json` antes do `desktop:dist`. O check passou de 71 para **72 módulos**.
- `npm version 0.3.58 --no-git-tag-version --ignore-scripts`; `npm run desktop:dist` (`--publish never`, Remotion + Whisper): saída 0.

## Hashes (recibo `release/MainsAgents-0.3.58-verification.json`, 2026-10-08T19:30:58Z)
| Artefato | SHA-256 |
| --- | --- |
| `MainsAgents-Setup-0.3.58.exe` | `6ba73d267fa75955205ab02eee7030bf5d723c1e9ad209eb53a670005e047c10` |
| `app.asar` (build, recibo e **instalado**, idênticos) | `2544e1612e99b91220bc9af66c07aa0749e27c3a78be106e0d1c5f749724168c` |

## Checks contra o app.asar final (`release/win-unpacked`)
- `test-packaged-media.mjs`: **PACKAGED_MEDIA_OK**.
- `test-desktop-persistence-ui.mjs` com `MAINSAGENTS_TEST_ASAR`: **PACKAGED_NATIVE_PERSISTENCE_UI_OK** (perfil isolado).
- `test-packaged-checkup.mjs`: **PACKAGED_CHECKUP_OK**; `test-packaged-content-flow.mjs`: **PACKAGED_CONTENT_FLOW_OK** (versão 0.3.58).
- **Novo** `scripts/test-packaged-content-sessions.mjs`: **PACKAGED_CONTENT_SESSIONS_OK** — `production-import.mjs` (`11bad5aac75c`), `production-preflight`, `production-coordinator`, `content-workflow-bridge` no asar byte a byte iguais à fonte; `dist/assets/app-Bnn8I3bQ.js` e `.css` do asar iguais ao build, com os marcadores "Novo conteúdo", "Ler este card", `recorded-import`, `truncated`, `[arquivo local]`; contratos do módulo empacotado (id de página Notion, `validateRecordedEntry`, ações bloqueadas, `recordedContextPrompt`). Sem serviço externo.

## Fechamento e backup
- Trabalho ativo: nenhum. Tabelas de jobs/produção/workflow com 0 linhas, nenhum processo filho (claude/codex/ffmpeg) do app, estado estável em duas leituras com 25 s de intervalo. O app oficial (aberto desde 15:20, oculto) foi fechado por `WM_CLOSE` na janela principal oculta (log: `Close storage verification: saved`, 0 processos). Nada foi forçado.
- Backup: `C:\Users\pacas\Documents\MainsAgentsBackups\before-update-0.3.58-20261008-164115`
  - `storage-sqlite\workspace-state.sqlite` pela **API de backup do SQLite** (com o app aberto, inclui WAL commitado), `integrity_check=ok`, 38 linhas de state, snapshot idêntico ao `snapshot-before.json`.
  - `storage-files\` (antes do fechamento), `storage-files-after-close\` e `appdata-mains-agents\` (62 arquivos; robocopy /XJ, sem caches, sem `auth.json`/`config.toml`, sem `.sandbox*`; 0 credenciais). `Network\Cookies` estava travado com o app aberto e foi copiado após o fechamento.
  - `snapshot-before / after-close / after-install-before-launch / after-launch.json` (contagens e SHA canônico por perfil/chave, sem conteúdo), `snap-tool.mjs` e cópia do recibo 0.3.58. Nada original apagado ou movido.

## Instalação e preservação
- SHA do instalador = recibo; `Start-Process … /S /D=<caminho oficial> -WindowStyle Hidden -Wait`: **saída 0**; `ProductVersion 0.3.58.0`; app.asar instalado = recibo; atalhos do Menu Iniciar e da Área de Trabalho continuam apontando para o executável oficial.
- Antes × depois: as **38 chaves de state são idênticas** nos quatro snapshots; todas as contagens de tabelas iguais. Única diferença transitória: as 3 linhas de lease (`workflow_worker_lease`, `agent_delegation_lease`, `production_lease`) ficam em 0 com o app fechado e voltam a 1 ao abrir — esperado. Sem tabelas novas nesta versão. `integrity_check=ok`.
- Inicialização (startup.log): `version=0.3.58`, serviço de conta, bridge do Codex e servidor web prontos, `nativeStorage:true`, `Main window loaded`; sem erro crítico (só o aviso `fs.Stats` pré-existente).

## Limites
- App aberto oculto e em execução (5 processos); janela não inspecionada visualmente. Sem login/inferência real, Notion real ou gravação real: o usuário poderá testar suas gravações/contas após a instalação, o que **não foi validado por fixtures**.
- A leitura de card fica em memória: depois de reiniciar antes de iniciar a produção, é preciso ler o card de novo (limite documentado no relatório de sessões).
- Reverter: fechar o app, reinstalar `release/MainsAgents-Setup-0.3.57.exe` e, se preciso, restaurar `storage-sqlite` do backup.

## Arquivos deste despacho
`package.json` (versão + `production-import.mjs` em `build.files`), `package-lock.json`, `scripts/test-packaged-content-sessions.mjs` (novo), este relatório; artefatos em `release/` (Setup 0.3.58, .sha256, .blockmap, verification.json, win-unpacked) e `dist/`.
