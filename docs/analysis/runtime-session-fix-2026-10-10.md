# Rodada 10–11/10/2026 — executor, sessões e atualização local 0.3.61 (frente C)

Status: **concluído em 11/10/2026. A 0.3.61 foi instalada às ~17:16 local e reinstalada às ~17:24 com a revisão dos rascunhos aplicada (seção "Revisão: validação dos rascunhos")**. Não é release pública: nada foi publicado, commitado, marcado com tag ou enviado.

## Ownership

| Frente | Dono | Arquivos |
| --- | --- | --- |
| A — executor/skills/diagnóstico | Claude A | `codex-bridge.mjs`, `codex-runtime-home.mjs`, `agent-file-access.mjs`, `codex-workflow-runtime.mjs`, `codex-executor-readiness.mjs`, RuntimeDiagnostics/sidebar/topbar e testes próprios |
| B — chat/retomada/handoff na UI | Claude B | `ChatProvider`, `ChatPanel`, `model/Chat.ts`, `contentSessions.ts`, `HttpCodexService.ts`, `sessionRecovery.ts`, provedores de conteúdo/produção, `production/model.ts`, FlowDialog/SelectMenu/AgentEditorDrawer, drafts e testes próprios |
| C — integração/pacote/instalação | Claude C (este) | `package.json`/lockfile, `desktop-main.mjs`, `desktop-preload.cjs`, `desktop-state-store.mjs`, `production-coordinator.mjs`, `content-workflow-bridge.mjs`, `native-agent-delegations.mjs` e testes, `codex-session-errors.mjs` (novo), prévia de legendas (`production-captions*`, `CaptionReview`, `EditPreviewPlayer`, `editorial-media.mjs` se preciso), `.github/workflows/windows.yml`, README/BACKLOG/ARCHITECTURE, scripts QA/pacote novos, este relatório e a instalação local |

C não edita arquivos de A/B; mudanças nesses arquivos são pedidas por contrato via coordenador.

## Plano

1. Diagnóstico read-only do app instalado (versão, processos, logs de sandbox do runtime) sem revelar conteúdo/credenciais.
2. Contrato único de "sessão ausente" em `codex-session-errors.mjs` (usado por coordinator e delegações; A/B podem importar):
   - `thread-missing` só com evidência: `error.code==='thread-missing'` ou texto real do CLI `no rollout found for thread id` / `no persisted rollout` / `not materialized yet`.
   - `thread not loaded` = sessão fora da memória: tentar `resume` e só depois decidir.
   - `invalid session id`, autenticação, rede e falha de setup do sandbox **não** são ausência.
   - Recriação automática apenas antes de qualquer envio; turno enviado/streaming exige reenvio explícito.
3. Bug `sessionMode:'new'` em `native-agent-delegations.mjs` (`reused=false` virava sessão alvo → "linked session belongs to another agent").
4. Prévia curta fiel das legendas finais (FFmpeg/libass, mesmo estilo/tempo/versão do render final, fonte intacta, cancelável, cache por hash).
5. Pacote: `codex-executor-readiness.mjs` e `codex-session-errors.mjs` no `files`; `check-build-files` antes de empacotar; testes recentes no CI.
6. Após freeze A/B: testes focados, typecheck/build, pacote 0.3.61 `--publish never`, QA do `app.asar` com CLI real (sem inferência), backup SQLite online (WAL), instalação local somente sem trabalho ativo.

## Diagnóstico (read-only, 11/10 ~16:40 local)

- App instalado: `%LOCALAPPDATA%\Programs\MainsAgents`, **0.3.60**; app **fechado** no momento (sem processos, sem jobs ativos nas bases, sem turnos abertos nas últimas 6 h).
- Runtime do app (`%APPDATA%\mains-agents\codex-runtime\.sandbox`): log de hoje com **36** `setup refresh completed with errors` entre 16:28:54 e 16:29:07 locais, todos `runtime read/execute validation failed … OpenAI\Codex\runtimes\cua_node\…\node_repl.exe … (os error 32)`; ontem 27 ocorrências. É exatamente o `helper_unknown_error: setup refresh had errors` que o usuário viu: o CLI 0.162 do app enumera os runtimes do Codex Desktop via `LOCALAPPDATA` e falha no `node_repl.exe` em uso.
- O kernel alternativo (`trusted Node process exited unexpectedly; kernel reset`) vem do MCP `node_repl` do Desktop herdado pelo `config.toml` compartilhado — neutralizado só no processo do app pelo isolamento de A.
- Retomada/handoff: `thread/resume` do chat antigo funcionava; a falha ao mandar o vídeo ao editor era o bug `sessionMode:'new'` (`reused=false` → "The linked session belongs to another agent").
- Observação lateral: numa execução do QA com outros processos `codex.exe` rodando ao mesmo tempo, um `command/exec` falhou uma vez com `windows sandbox: CreateProcessWithLogonW failed: 1326` (logon do usuário do sandbox elevado); a repetição passou. Indica concorrência de refresh do sandbox entre homes diferentes; reportado a A, não reproduzido de forma determinística.

## Correções da frente C

| # | Item | Arquivos | Evidência |
| --- | --- | --- | --- |
| C1 | `sessionMode:'new'` nas delegações (causa do "linked session belongs to another agent" ao mandar o vídeo ao editor). `new` sempre abre sessão nova; `continue` reutiliza a do mesmo agente; vínculo automático obsoleto/de outro agente → sessão nova com `job.notice`; sessão ausente no CLI só é trocada antes do envio. | `native-agent-delegations.mjs`, `tests/native-delegations.test.mjs` | 3 testes novos (Codex e Claude); QA com CLI real: `thread/start`/`thread/resume` reais, envio substituído (sem inferência) |
| C2 | Contrato único de sessão ausente; `thread not loaded` retoma antes de decidir; `invalid session id`/auth/rede/setup nunca viram expiração. Coordenador de produção usa o contrato (regex ampla removida). | `codex-session-errors.mjs` (novo), `production-coordinator.mjs`, `tests/codex-session-errors.test.mjs`, `tests/production-session-recovery.test.mjs` | 2 + 4 testes; CLI real: id inexistente → `{missing:true}` via read→resume; id inválido mantido como erro |
| C3 | Prévia curta fiel das legendas gravadas (item 7). | `production-caption-preview.mjs` (novo), `production-coordinator.mjs`, `content-workflow-bridge.mjs` (rota), `production-captions.d.mts`, `CaptionReview.tsx`, `caption-review.css` | PSNR prévia × arquivo final 41,6–42,3 dB com legenda na tela (× vídeo limpo ≈26 dB); entre legendas também igual; fonte com sha256 igual; cancelamento sem arquivo; cache e hash no teste do coordenador |
| C4 | Empacotamento: `codex-executor-readiness.mjs`, `codex-session-errors.mjs`, `production-caption-preview.mjs` em `build.files`; `check-build-files` antes do `electron-builder`; versão 0.3.61. | `package.json`, `package-lock.json` | `check-build-files`: 81 módulos, 0 faltando |
| C5 | QA empacotado e atualização local. | `scripts/test-packaged-runtime-session.mjs`, `scripts/local-update-backup.mjs` | ver seções abaixo |
| C6 | Docs de versão sem anunciar release pública. | `README.md`, `ARCHITECTURE.md`, `BACKLOG.md` | — |
| C7 | Backup dos rascunhos de agente: `agent-drafts` em `dataKeys`; `parseBackup` recusa chave/valor malformado; a importação re-escopa as chaves ao perfil que importa, descarta rascunhos de workspace/agente ausentes depois da importação e, no modo mesclar, o rascunho atual vence no mesmo slot. | `src/data/backupFormat.ts`, `src/data/backup.ts` (passa `storageProfile()`), `src/features/agents/agentDrafts.ts`, `tests/agent-drafts.test.mjs` | teste novo (replace/merge/órfãos/perfil/5 formatos inválidos) |
| C8 | QA oculto do botão "Ver prévia final". | `scripts/test-captions-frames-ui.mjs` (estendido) | ver abaixo |
| C9 | QA do executor da instalação real. | `scripts/test-installed-executor.mjs` (novo); timeout da RPC do controle negativo em `test-packaged-runtime-session.mjs` 60→180 s | ver abaixo |

## As 8 melhorias e a prova de cada uma

| # | Melhoria | Prova |
| --- | --- | --- |
| 1 | Executor/skills: isolamento do Codex Desktop (`LOCALAPPDATA` privado só para o CLI, `node_repl`/`notify` do Desktop desligados só no app), sonda tri-estado `ready/failed/slow`, skill lida pelo host só quando o shell falha | **Máquina real, com 6 `node_repl.exe` do Desktop abertos**: o controle (lançamento estilo 0.3.60) devolve `helper_unknown_error … node_repl.exe is in use by another process (os error 32)`, exatamente o erro do usuário. O lançamento 0.3.61 lê a skill real, passa o `LOCALAPPDATA` correto aos comandos, escreve/lê scratch, faz o corte FFmpeg sintético e mantém a escrita fora e a rede bloqueadas. `codex-bridge.mjs` **do app.asar instalado** no runtime real: `GET /api/codex/executor?refresh=1` → `200 ready` em 5,1 s, `desktopIsolation {localAppDataIsolated:true, disabled:[node_repl]}`. Depois de abrir o app instalado, o aquecimento registrou `SUCCESS` no log do sandbox, sem erro de setup. |
| 2 | Contrato de sessão 410/409/400 | CLI real 0.162.1: id inexistente → `thread-missing`; não carregado → `thread-not-loaded` (resume antes de decidir); id inválido → `invalid-thread-id` (nunca expiração). Repetido no pacote (`PACKAGED_RUNTIME_SESSION_OK`). |
| 3 | Handoff ao editor: `new`/`continue`/vínculo obsoleto, `firstMessage` na sessão recriada | `PACKAGED_RUNTIME_SESSION_OK`: Codex com `thread/start`/`thread/resume` reais e Claude; `continue` reaproveita, `new` abre outra, vínculo de outro agente vira sessão nova com aviso; sessão provada ausente é trocada **antes** do envio; 7 handoffs = 7 envios (sem duplicar). `HANDOFF_UI_OK` e `SESSION_RECOVERY_UI_OK` (410/409/login/stream perdido/restart/chat novo do conteúdo → editor real do mesmo run, sem run duplicado). |
| 4 | Teclado (menu/diálogo/drawer) | `SESSION_RECOVERY_UI_OK` (Escape em camadas, Tab contido, foco devolvido). |
| 5 | Rascunhos de agente por perfil/workspace + backup | testes de B + C7; `SESSION_RECOVERY_UI_OK` (restauração após restart). |
| 6 | Prévia fiel das legendas (FFmpeg/libass, ≤ 6 s) | `test-captions-frames-ui` oculto/offscreen: GET real pela ponte → 200, `<video>` blob tocável ≤ 6,2 s com a legenda gravada; trocar o estilo invalida a prévia ("A versão ou o estilo mudou"); cancelar durante a geração fecha a requisição (`closed-by-client`) e nenhuma prévia ou erro tardio aparece; nova prévia `boxed` 200; a aprovação registra `previewed:true` ("conferida na prévia final"). |
| 7 | Pacote 0.3.61 com todos os módulos | `check-build-files`: 81 módulos, 0 faltando; 11 módulos revisados byte a byte iguais à fonte dentro do asar. |
| 8 | CI/docs | `.github/workflows/windows.yml`, README/ARCHITECTURE/BACKLOG (rodada anterior); este relatório e a nota sobre drafts no relatório de B. |

## Checks (11/10, depois do freeze de A/B)

- `npm run typecheck` ok · `npm test` **571/571** · `npm run build` ok · `npm run desktop:dist` (`--publish never`) saída 0.
- Contra `release/win-unpacked/resources/app.asar`: `PACKAGED_RUNTIME_SESSION_OK` (3/3 seguidas, ~13 s cada), `PACKAGED_MEDIA_OK`, `PACKAGED_CHECKUP_OK`, `PACKAGED_CONTENT_FLOW_OK`, `PACKAGED_CONTENT_SESSIONS_OK`, `PACKAGED_NATIVE_PERSISTENCE_UI_OK`.
- Electron oculto com o `dist` final: `SESSION_RECOVERY_UI_OK`, `HANDOFF_UI_OK`, `CHAT_INTERACTION_OK`, UI de content-sessions ok, captions-frames + prévia final ok.
- Instabilidade encontrada e corrigida no QA (não no app): numa execução, o controle negativo (CLI **sem** isolamento) passou de 60 s esperando o provisionamento do sandbox, e o script acusou `command/exec timeout` em vez do erro esperado. A RPC de `command/exec` do script agora espera 180 s (o provisionamento já foi visto em ~80 s); a asserção continua exigindo o erro exato.

## Artefatos

| Item | Valor |
| --- | --- |
| Instalador **atual** (revisão aplicada, instalado) | `release/r2/MainsAgents-Setup-0.3.61.exe`, SHA-256 `ffc2e3cfe55ddb6a9e9620584c8ed1466f18fd25090e73d4c419b7a44a0a6d46` |
| `app.asar` atual (build = recibo = **instalado**) | `d19872da3c4e2c4400bd6484ea0a2c69c125bce6258a38084f0af6bea1c8c67f` |
| Recibo atual | `release/r2/MainsAgents-0.3.61-verification.json` (cópia no backup da reinstalação) |
| Primeira build, **substituída** | `release/MainsAgents-Setup-0.3.61.exe` `b61f5caa…`, asar `a352962d…`: não usar (validação de rascunhos incompleta) |

## Backup, instalação e preservação

- Antes: app **fechado** (0 processos `MainsAgents`); `local-update-backup.mjs activity` → `active:false` (0 jobs, 0 processos filhos, 0 turnos abertos), repetido imediatamente antes do instalador.
- Backup: `C:\Users\pacas\Documents\MainsAgentsBackups\before-update-0.3.61-20261011-171120`
  - `sqlite/`: 9 bancos pela **API de backup do SQLite** (`node:sqlite backup()`, inclui o WAL commitado), todos `integrity_check=ok`, com contagens e SHA-256 em `manifest.json` (state do perfil: 38 chaves).
  - `files/`: `storage` (27 arquivos, sem `.sqlite*`), imagens geradas (1), rollouts do runtime (8), 40 skills configuradas e `appdata-mains-agents` (72 arquivos: Local Storage/IndexedDB/Preferences/partições). Ficaram **fora** os caches, `account.json`, cookies, `auth.json`, `config.toml` e `.sandbox*`; conferido: 0 arquivos de credencial no backup.
  - `snapshot-before / after-install-before-launch / after-launch / after-close.json`: contagens e hashes canônicos, sem conteúdo.
- Instalação: SHA do instalador conferido; `/S /D=%LOCALAPPDATA%\Programs\MainsAgents`, janela oculta, **saída 0**; `ProductVersion 0.3.61.0`; os atalhos do Menu Iniciar e da Área de Trabalho apontam para o executável oficial.
- Smoke oficial oculto: o `startup.log` registra `version=0.3.61`, ponte do Codex e servidor web prontos, `nativeStorage:true` e `Main window loaded`; nenhuma janela visível. Fechado por `WM_CLOSE` (sem trabalho ativo) → `Close storage verification: saved`, 0 processos.
- Dados: as 38 chaves de state e todas as contagens, arquivos e skills ficaram **idênticos** antes da instalação, depois dela, depois de abrir e depois de fechar. Única diferença: a tabela nova e vazia `editorial_audio` (0 linhas, criada pelo `editorial-media.mjs` de d513c9d). Os leases voltam a 0 com o app fechado.

## Revisão: validação dos rascunhos (11/10, ~17:24)

**Bug encontrado pela revisão do Codex na entrega anterior:** `validateAgentDrafts` só verificava a chave, `values` como objeto e `savedAt` como texto. Um backup com `values.name=123` ou `tools:null` era aceito pelo `parseBackup`; o `restoreAgentDraft` mesclava esse valor com o fallback, e o `AgentEditorDrawer` quebrava em `trim`/`includes`. A mesma corrupção no armazenamento local quebrava o editor.

**Correção** (`src/features/agents/agentDrafts.ts`, `src/data/backupFormat.ts`):
- `agentDraftValuesProblem` valida cada campo **presente** pelo modelo atual `AgentEditorValues`:
  - textos: `name`, `role`, `description`, `instructions`, `workspaceId`, `skillsDirectory`, `skillsInstallKey`, `modelId`, `avatarImage`;
  - `tools`: lista de `AgentTool`;
  - `skills`/`disabledSkills`: listas de texto;
  - `skillFiles`: mapa texto→texto;
  - `providerId`: `codex|claude|gemini`;
  - `mcpPermissions`: lista dos 6 valores do contrato;
  - `notionAutomation`: exatamente `{enabled:boolean, dataSourceId:string}`;
  - `fileAccess`: exatamente `{enabled:boolean, outputDirectory:string}`;
  - campo desconhecido é recusado.
- Um Partial sem campos opcionais continua válido e é completado pelo fallback.
- Permissões e acesso **nunca** são corrigidos em silêncio: um campo inválido invalida o rascunho inteiro.
- Importação: `parseBackup` recusa com mensagem clara, que nomeia o rascunho e o campo (ex.: `Invalid agent drafts in backup: draft [...]: "name" must be text.`). Nada é restaurado.
- Armazenamento local: `restoreAgentDraft` ignora o rascunho inválido (ou um mapa que não seja objeto) e abre no fallback seguro (o agente salvo ou os valores de criação).
- No modo mesclar, só as entradas locais válidas entram na mescla. Uma entrada corrompida só abriria no fallback; as entradas válidas do mesmo mapa são mantidas.
- O isolamento por perfil/workspace/agent, o reindex e a regra "local vence" não mudaram.
- Dados reais conferidos (somente leitura): o perfil não tem rascunhos salvos, então a validação mais rígida não esconde nada do usuário.

**Testes** (`tests/agent-drafts.test.mjs`, teste novo):
- 17 formatos inválidos, todos recusados na importação com o nome do campo e restaurados localmente no fallback sem quebrar `trim`: nome numérico, `tools` nulo/não lista/ferramenta desconhecida, skills inválidas, `skillFiles` não textual, provider desconhecido/nulo, permissão MCP desconhecida, `fileAccess` sem pasta/com chave extra/`enabled` textual, `notionAutomation` lista/fonte numérica, campo desconhecido.
- Mapa nulo cai no fallback.
- Rascunho completo e Partial continuam funcionando.
- Mescla com rekey de perfil continua funcionando, deixa de fora a entrada local corrompida e mantém a válida.
- Afetados: `agent-drafts`, `backup`, `chat-drafts`, `studio-drafts`, `agent-comparison`, `chat-inbox`, `production-flows`, `content-flow-backup` e `runtime-backup` → **40/40**. `typecheck` ok; build ok.
- A suíte global, o CLI real e o QA de runtime não foram repetidos (runtime/backend sem mudança).

**Pacote:**
- `npm run build` + `check-build-files` (81 módulos, 0 faltando).
- O `electron-builder` falhou ao apagar `release/win-unpacked/resources/app.asar`: o arquivo estava aberto pelo processo **Orca** (identificado pelo Restart Manager). Não mexi no Orca e gerei em `release/r2` (`--config.directories.output=release/r2`, `--publish never`). `check-desktop-release.mjs` passou a aceitar `MAINSAGENTS_RELEASE_DIR`.
- O bundle `dist/assets/app-BCeGsjJL.js` dentro do asar é idêntico ao `dist` e contém a validação nova.
- Com o pacote novo: `PACKAGED_CONTENT_SESSIONS_OK` (asar `release/r2`) e `SESSION_RECOVERY_UI_OK` (Electron oculto: drawer, rascunhos e restauração).

**Reinstalação:**
- App fechado e `activity` → `active:false`, conferido antes do backup e de novo antes do instalador.
- Novo backup online: `C:\Users\pacas\Documents\MainsAgentsBackups\before-reinstall-0.3.61-r2-20261011-172349`. Os 9 bancos estão `integrity_check=ok`, sem credenciais. O backup anterior foi preservado.
- Instalação silenciosa, saída 0; `ProductVersion 0.3.61.0`; o `app.asar` instalado é igual ao recibo novo (`d19872da…`); atalhos ok.
- Snapshots antes, depois de instalar, com o app aberto e depois de fechar: **IDÊNTICOS** (comparação estrita).
- Smoke oculto: `version=0.3.61`, `Main window loaded`, janela invisível, sandbox `SUCCESS`; fechamento por `WM_CLOSE` → `Close storage verification: saved`.

## Limites

- Nenhuma inferência real: nos testes de handoff o envio ao modelo foi substituído, e o executor foi provado com `command/exec`. O primeiro pedido real do usuário ao editor ainda não foi observado.
- Se o Codex Desktop e o MainsAgents reprovisionarem o sandbox ao mesmo tempo, o primeiro comando pode demorar (até ~80 s) ou falhar uma vez com `1326`. Isso vem das credenciais compartilhadas dos usuários do sandbox, comportamento do CLI. A UI mostra "ainda preparando" ou o motivo real, e "Testar executor novamente" resolve.
- Quando o CLI prova que a thread de uma conversa antiga não existe mais, o chat abre uma thread nova com o histórico e mostra um aviso. A recuperação automática pelo código 410 vale a partir desta instalação. Um turno já aceito que caiu fica "interrompido" e exige reenvio explícito.
- Observação (não alterada): o `second-instance` do `desktop-main.mjs` só faz `focus()`. Se o app estiver aberto **oculto**, clicar no atalho não mostra a janela; por isso a instância de smoke foi fechada. Em uso normal a janela é visível.
- Reverter: fechar o app e reinstalar `release/MainsAgents-Setup-0.3.60.exe`; se preciso, restaurar `sqlite/storage/workspace-state.sqlite` do backup com o app fechado.

## Como testar (usuário)

1. Abrir o MainsAgents pelo atalho. Em Configurações → Capacidades → "Verificar capacidades", esperar "Executor local do Codex: Pronto" e "Isolamento do Codex Desktop: Ativo". Na primeira vez pode aparecer "ainda preparando" por até ~1 min; nesse caso, use "Testar executor novamente".
2. Abrir a conversa antiga e pedir ao agente de conteúdo para encaminhar o vídeo ao Editor (inclusive pedindo "nova sessão"). Esperado: o editor recebe o vídeo, lê a skill e roda o corte. Não deve aparecer "linked session belongs to another agent", `setup refresh had errors` nem `kernel reset`.
3. Se a conversa for muito antiga e o provedor não a tiver mais, o chat avisa que abriu uma nova conversa com o histórico e não repete nada sozinho.
4. Na revisão de legendas, "Ver prévia final" mostra um trecho de até 6 s exatamente como o arquivo final; trocar o estilo pede uma nova prévia.
