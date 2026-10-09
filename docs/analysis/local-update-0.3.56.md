# Atualização local 0.3.55 → 0.3.56 (07/10/2026)

Instalação pessoal nesta máquina. **Não é release pública**: nada foi publicado, commitado ou marcado com tag. O link público continua em [v0.3.42](https://github.com/devpedrohbs/MainsAgents/releases/tag/v0.3.42).

## Alvo

- Executável: `C:\Users\pacas\AppData\Local\Programs\MainsAgents\MainsAgents.exe` (antes 0.3.55.0, agora **0.3.56.0**)
- Estado: `C:\Users\pacas\.mainsagents\storage\workspace-state.sqlite` (fora da instalação, não foi tocado pelo instalador)
- Perfil Electron: `%APPDATA%\mains-agents`

## O que entra nesta versão

Rodada de conteúdo aprovada (evidências em [content-flow-integration-report.md](content-flow-integration-report.md) e [content-flow-f01-f06-report.md](content-flow-f01-f06-report.md)):

- **Gate de roteiro**: escolher hook/CTA/caminho, editar e aprovar uma versão com hash. O Notion só é usado depois da aprovação, e a gravação só é liberada para a versão aprovada e confirmada.
- **Claude por etapa no coordenador**: a etapa roda no provedor do agente configurado, sem fallback silencioso. O preflight separa disponibilidade de login.
- **Pacote de gravação**: checklist e sugestões persistidos por versão do roteiro, e importação real do vídeo.
- **Capas locais**: três alternativas por formato com FFmpeg, sem IA. A galeria fica lado a lado, e a capa aprovada vai exatamente para o pacote. O LinkedIn exige confirmar o formato.
- **Biblioteca de referências**: aba Estúdio › Referências, validada no servidor e no backup. “Usar como briefing” não chama IA.

## Build

- `npm version 0.3.56 --no-git-tag-version --ignore-scripts`: `package.json` e `package-lock.json` agora estão em 0.3.56. Todas as mudanças locais foram mantidas, sem commit, tag ou reset.
- `npm run desktop:dist` (`--publish never`): saída 0. O build completo rodou `tsc -b`, vite com 358 módulos, preview, bundle Remotion em `dist/remotion` e staging verificado do Whisper. Em seguida vieram o electron-builder NSIS e o `check-desktop-release.mjs`, com **66 módulos nativos** (61 da 0.3.55 + 5 novos).
- Os artefatos da 0.3.55 (`MainsAgents-Setup-0.3.55.exe`, `.sha256`, `.blockmap` e `MainsAgents-0.3.55-verification.json`, todos com horário 21:13) **não foram sobrescritos**. A 0.3.56 gerou arquivos próprios.
- Linha de base dos testes do código-fonte (do despacho anterior, sem mudança de código depois dele, só a versão): `npm test` **392/392**, `npm run build` ok e e2e Electron verdes. A suíte não foi repetida.

## Hashes (recibo `release/MainsAgents-0.3.56-verification.json`, 2026-10-08T01:52:09Z)

| Artefato | SHA-256 |
| --- | --- |
| `MainsAgents-Setup-0.3.56.exe` (277.780.205 bytes) | `d461084e27907c94c55f00e204b1bfab97bb48aa10f500d71a08e7145af0b7bc` |
| `app.asar` (build, recibo e **instalado**, idênticos) | `054b22c01a27f4bd29e2c82c07a8d49ed170a0da9f6dbe9581bbe15229d57000` |

## Checks contra o app.asar final (`release/win-unpacked`)

- `npx electron scripts/test-packaged-media.mjs release/win-unpacked`: **PACKAGED_MEDIA_OK**. Usou o ffprobe desempacotado do compositor, o Chrome do sistema, o Whisper `ggml-base` de `resources/tools` e o FFmpeg do PATH. Exportou 10,00 s → 5,17 s com overlays Remotion e SRT.
- `MAINSAGENTS_TEST_ASAR=release/win-unpacked/resources/app.asar npx electron scripts/test-desktop-persistence-ui.mjs`: **PACKAGED_NATIVE_PERSISTENCE_UI_OK**, com perfil isolado.
- **Novo** `npx electron scripts/test-packaged-content-flow.mjs release/win-unpacked`: **PACKAGED_CONTENT_FLOW_OK**. Evidência em `.mainsagents-workspaces/packaged-content-flow/<run>/packaged-content-flow.json`.
  - Os 5 módulos novos estão **dentro** do `app.asar` e são byte a byte iguais ao código-fonte:

    | Módulo | SHA-256 (prefixo) |
    | --- | --- |
    | `editorial-thumbnails.mjs` | `e605be76…` |
    | `production-script.mjs` | `6a8bc639…` |
    | `production-runtime.mjs` | `e8ce0e99…` |
    | `production-covers.mjs` | `1409fd42…` |
    | `editorial-inspiration.mjs` | `a1bca2b8…` |

  - O teste importa dinamicamente, a partir do `app.asar` no Electron, esses 5 módulos e também `production-coordinator.mjs`, sem importar nada do código-fonte. Ele confere as exportações reais e regras básicas:
    - Claude é só texto;
    - o hash da versão do roteiro sai no formato esperado;
    - o LinkedIn exige confirmação de formato;
    - caminho privado é recusado na biblioteca.
  - Também gera um vídeo sintético 720×1280 com FFmpeg e renderiza pelo motor empacotado **três capas reais** `instagram-reels-cover`. As três têm 1080×1920, o sha256 de cada arquivo confere com o manifest e a origem fica preservada (hash igual antes e depois).
  - Hashes das capas: `344bf671…`, `e6f8a7f1…` e `2f03671b…`. Motor `ffmpeg-drawtext` v1, fonte do sistema `segoeuib.ttf`.
  - **Diagnóstico do script novo:** na primeira execução, o Electron tratou `app.asar` como diretório ao ler o arquivo bruto (`ENOENT not found in app.asar`). O defeito era só do script de teste, não do pacote: as leituras brutas (hash, listagem e extração) passaram a usar `process.noAsar`, e os imports continuam pelo asar.

## Fechamento e backup

- Antes de instalar, o app oficial **não estava em execução**: zero processos `MainsAgents.exe`. Não foi preciso fechar nem encerrar nada, e nenhum outro processo foi tocado.
- Jobs: as tabelas de jobs, de produção e de workflow tinham contagem zero. Foram registradas só contagens, sem conteúdo.
- Backup: `C:\Users\pacas\Documents\MainsAgentsBackups\before-update-0.3.56-20261007-225134`
  - `storage-sqlite\workspace-state.sqlite`: cópia pela **API de backup do SQLite** a partir de uma conexão somente leitura, o que inclui o WAL já commitado. `integrity_check=ok`, 38 linhas de state.
  - `storage-files\`: cópia integral de `.mainsagents\storage`.
  - `appdata-mains-agents\`: perfil Electron copiado com `robocopy /XJ`, sem caches. Ficaram de fora as junctions do Codex (`skills`, `plugins`, `rules`, `secrets`, `mcp-oauth-locks`), `auth.json` e `config.toml`.
    - Três diretórios `codex-runtime\.sandbox*` entraram por engano, porque `/XF` só exclui arquivos. Foram removidos **somente da cópia** e continuam no original.
    - Verificação final do backup: 0 reparse points e 0 arquivos de credencial; 161 arquivos, cerca de 22 MB.
  - Os originais não foram apagados nem movidos.
  - `snapshot-before.json`, `snapshot-after-install-before-launch.json` e `snapshot-after-launch.json` guardam contagens e SHA-256 canônicos por chave, sem texto.
  - Também foi incluída uma cópia do recibo `MainsAgents-0.3.56-verification.json`.

## Instalação e preservação

- O hash do instalador foi conferido contra o recibo **antes** do `Start-Process … -ArgumentList '/S','/D=C:\Users\pacas\AppData\Local\Programs\MainsAgents' -WindowStyle Hidden -Wait`. Código de saída 0.
- O executável instalado está em **0.3.56.0**, e o `resources\app.asar` instalado é igual ao recibo (`054b22c0…7000`).
- Os atalhos do Menu Iniciar e da Área de Trabalho continuam apontando para o executável oficial.
- Comparação do estado (SHA canônico por chave, sem ler texto):
  - antes, depois de instalar sem abrir e depois de abrir a 0.3.56: as **38 chaves de state são idênticas** (`stateCanonicalSha f1a85439…b480` nos três momentos). Nenhuma chave nova, removida ou alterada;
  - as contagens das 28 tabelas não mudaram, e `editorial_state` continua com 0 linhas (SHA editorial `4f53cda1…` igual);
  - não houve migração com efeito visível: as migrações novas (gate de roteiro e capas locais) são aplicadas sob demanda em produções existentes, e esta base não tem `production_runs`;
  - em relação à 0.3.55, a base tinha 38 chaves e não 37: a chave `execution-overview-filter:<workspace>` foi criada na abertura da 0.3.55, conforme o relatório anterior. O script de snapshot desta vez usa outro prefixo de perfil, então a comparação vale dentro desta atualização.
- Inicialização da 0.3.56, aberta oculta:
  - `version=0.3.56`, serviço de conta local pronto, bridge do Codex pronto, servidor web pronto;
  - `Renderer storage: {"nativeStorage":true,"version":"desktop-sqlite"}` e `Main window loaded`;
  - nenhuma falha de inicialização, de preload ou de bloqueio. O único aviso é o `DeprecationWarning: fs.Stats` pré-existente.
  - O log fica em `.mainsagents\storage\startup.log`. O de `%APPDATA%` é antigo.
- Disponibilidade local, sem chamadas, inferência ou login:
  - `codex`, `claude`, `ffmpeg` e `ffprobe` estão no PATH;
  - no diretório instalado existem whisper-cli, `ggml-base.bin`, o bundle Remotion e o ffprobe desempacotados.

## Limites

- Não houve chamada de IA, Notion ou publicação, nem autenticação. A prontidão real das contas Codex e Claude não foi exercida, e `claude auth status` não foi consultado.
- O app foi aberto oculto e segue em execução (5 processos do executável oficial). A janela não foi inspecionada visualmente nesta instalação; a UI foi validada nos e2e Electron do despacho de integração.
- A suíte de 392 testes não foi repetida, porque só mudou a versão. Rodaram os checks empacotados acima.
- Para reverter, feche o app, reinstale `release/MainsAgents-Setup-0.3.55.exe` (`db825bbf…a3c8`, intacto) e, se for preciso, restaure `storage-sqlite\workspace-state.sqlite` do backup.

## Arquivos deste despacho

- `package.json` e `package-lock.json` (versão)
- `RELEASE.md` (linha local)
- `scripts/test-packaged-content-flow.mjs` (novo)
- `docs/analysis/local-update-0.3.56.md`
- Artefatos em `release/`: `MainsAgents-Setup-0.3.56.exe`, `.sha256`, `.blockmap`, `MainsAgents-0.3.56-verification.json` e `win-unpacked/`
- `dist/`, regenerado pelo build
