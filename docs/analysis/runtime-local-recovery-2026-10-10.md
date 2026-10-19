# Executor local e leitura de skills: recuperação (frente A, 10–11/10/2026)

Status: **corrigido no working tree e validado com o CLI real; ainda não empacotado/instalado** (isso é da frente C). Atualizado em **11/10/2026**. Sem commit, push, publicação ou instalação.

## Sintoma relatado (app instalado 0.3.60.0)

Ao pedir ao agente de conteúdo que encaminhasse o vídeo pronto ao Editor:

- `exec_command` não iniciou: `helper_unknown_error: setup refresh had errors`;
- a "leitura local alternativa" também falhou: `trusted Node process exited unexpectedly; kernel reset`;
- a skill principal não foi lida, corte/contexto ficaram pendentes e nenhuma saída foi produzida.

## Causa real (com evidência)

1. **O 0.3.60 instalado não contém a correção que resolve este caso.** O `app.asar` instalado (`%LOCALAPPDATA%\Programs\MainsAgents`, `package.json` 0.3.60) não tem `desktopRuntimeIsolation` nem `codex-executor-readiness.mjs`. A correção documentada em `docs/codex-executor-isolation-0.3.60.md` só limpava as variáveis `CODEX_*` herdadas do Codex Desktop. Ela não trata a causa abaixo, por isso repetir aquela correção ou reiniciar o app não resolve.
2. **O sandbox do Windows do CLI valida os runtimes do Codex Desktop e esbarra num arquivo travado.** O CLI usado pelo app é o pacote npm `@openai/codex` em `%APPDATA%\npm\…\codex.js`, **0.162.1** (atualizado em 11/10 às 15:29; em 10/10 era 0.162.0). Antes de cada comando, o setup do sandbox (`codex-windows-sandbox-setup.exe`) procura `%LOCALAPPDATA%\OpenAI\Codex\runtimes` e tenta validar/ajustar a ACL de `cua_node\cfb32733c877621e\bin\node_repl.exe`. Esse executável está aberto pelo Codex Desktop (há 2 processos `node_repl.exe` em execução agora), então a operação falha com **os error 32**. O resultado é `setup refresh had errors` → `helper_unknown_error`, e todo `exec_command` é rejeitado antes de executar, inclusive uma simples leitura.
   - `codex-runtime\logs_2.sqlite`: na conversa `01a126f8…`, em 10/10 às 17:59:41Z, quatro `exec_command failed: CreateProcess { … helper_unknown_error: setup refresh had errors }`. Os mesmos segundos (17:59:41, 18:00:34, 18:00:43) aparecem em `codex-runtime\.sandbox\sandbox.2026-10-10.log` como `runtime read/execute validation failed: … node_repl.exe … (os error 32)`.
3. **A "alternativa" era o kernel `node_repl` do Codex Desktop, herdado pelo `config.toml` compartilhado.** O `config.toml` do runtime é um hardlink da configuração compartilhada `~/.codex` e recebeu três coisas do Desktop: `[mcp_servers.node_repl]`, que aponta para o `node_repl.exe` do Desktop, `NODE_REPL_TRUSTED_CODE_PATHS` e o `notify` do computer-use. O runtime do app subia esse MCP (`rmcp … server_name=node_repl … Service initialized`), mas ele depende do serviço de sandbox registrado do Desktop. Por isso falhava: `MCP server stderr (…node_repl.exe): windows sandbox failed: orchestrator_helper_incomplete` → `trusted Node process exited unexpectedly; kernel reset`. O `notify` herdado também falhava: `legacy_notify error=The filename or extension is too long (os error 206)`.
4. **A skill não foi lida porque a leitura dependia do mesmo executor.** Não existia uma leitura pelo host que não passasse pelo shell.

Hipóteses descartadas: idade/expiração da conversa, falta de autenticação (o `account/read` respondia normalmente), FFmpeg ausente e permissão negada na pasta de saída. O controle abaixo falha antes de qualquer acesso a arquivo.

## Correção (arquivos da frente A)

| Arquivo | O que mudou |
| --- | --- |
| `codex-runtime-home.mjs` | `desktopRuntimeIsolation()`: **somente o processo do CLI** recebe um `LOCALAPPDATA` privado e vazio (`codex-runtime\desktop-isolation`), então o setup do sandbox deixa de enumerar os runtimes do Desktop. Os **comandos** continuam com o `LOCALAPPDATA` real (`shell_environment_policy.set.LOCALAPPDATA`), e o mesmo vale para os MCPs stdio do usuário, salvo os que já definem o próprio valor. Só os MCPs cujo `command` está dentro do Codex Desktop (hoje `node_repl`) e o `notify` do Desktop são desativados, via `-c` e só neste app. O sandbox, a autenticação, o `config.toml` compartilhado e os MCPs legítimos ficam como estão: nada é escrito na configuração do usuário. |
| `codex-executor-readiness.mjs` (novo) | `probeCodexExecutor`: um único `command/exec` real (sem thread, sem turno, sem tokens) com a **política de sandbox da própria sessão**, que lê o conteúdo da skill configurada. O resultado é um de três estados: `ready`, `failed` (prova de que comandos não rodam) ou `slow` (sem resposta ainda; nunca vira "quebrado"). `sandboxSetupDiagnosis`: lê `setup_error.json` e o log do sandbox e devolve código, caminho e `os error`, sem credenciais. `skillMarkdownFile` / `hostSkillContext`: o host lê **somente** os `.md`/`SKILL.md` configurados no agente, com limite de tamanho, quando o shell não sobe. **Nenhum kernel alternativo** é usado. `executorUnavailableInstructions` avisa o agente para não usar `node_repl` nem fingir que produziu algo. `classifyThreadError` / `threadErrorStatus`: contrato de sessão (abaixo). |
| `codex-bridge.mjs` | Na inicialização, um aquecimento prepara o sandbox antes do primeiro agente. No início de cada sessão, a verificação espera no máximo 8 s; se a sonda ainda estiver rodando, a sessão abre sem aviso falso, e só `failed` injeta o diagnóstico e as skills lidas pelo host. `GET /api/codex/executor` reaproveita um sucesso recente e aceita `?refresh=1` para "testar novamente"; devolve `desktopIsolation`. `AppServerClient.request` aceita timeout por chamada: a sonda espera até 180 s em vez de 30 s. O contrato de erros de thread vale no catch geral, em `/images` e em `chatRuntime.readThread`. `runtimeRequest` propaga `status`/`code` para o coordinator. |
| UI: `runtimeDiagnosticsView.ts`, `productionReadiness.ts`, `RuntimeDiagnostics.tsx`, `Sidebar.tsx` | Linha "Executor local do Codex", **separada do login**, com o motivo real (por exemplo `node_repl.exe … os error 32`), o estado do isolamento e o botão **"Testar executor novamente"**. No checklist "Pronto para produzir?" entra o item obrigatório "Executor local (comandos e FFmpeg)", e `slow` aparece como "não comprovado", nunca como bloqueado. A sidebar mostra "Codex conectado · executor local indisponível" quando há login mas o comando falha (consulta a cada 5 min, reaproveitando o cache). Não foi preciso mudar `Topbar.tsx`. |
| `scripts/codex-executor-real-probe.mjs` (novo) | Prova real e reproduzível com controle negativo e positivo (veja a evidência). |

## Evidência real (CLI 0.162.1, sem inferência paga, 11/10/2026)

Comando: `node scripts/codex-executor-real-probe.mjs --skill C:/Users/pacas/Documents/Skills/EditorDeConteudo/mainsagent-corte-base.md --authorized C:/Users/pacas/Pictures/VideosPacas/VideosSemiEditados`. O teste usa o runtime real do app (fechado durante o teste) e o `node_repl.exe` do Desktop travado de verdade. Só chama `command/exec`, e `thread/read`/`thread/resume` com ids aleatórios.

| Verificação | Controle (lançamento 0.3.60, sem isolamento) | Com isolamento (lançamento do working tree) |
| --- | --- | --- |
| Ler a skill principal (read-only) | ✕ `helper_unknown_error: setup refresh had errors` | ✓ 2085 caracteres lidos |
| `LOCALAPPDATA` visto pelos comandos | ✕ (rejeitado) | ✓ valor real do usuário |
| Criar e ler arquivo scratch na pasta autorizada | ✕ | ✓ |
| Escrita fora da pasta autorizada | (nada executou) | ✓ bloqueada: "Acesso negado" |
| Rede nos comandos | (nada executou) | ✓ bloqueada (`WebException`) |
| Corte FFmpeg sintético (testsrc + seno, 2 s → 1 s) | ✕ | ✓ `ffprobe` = 1.000000 s |
| Diagnóstico do setup | "`…\cua_node\cfb32733c877621e\bin\node_repl.exe` is in use by another process (os error 32)" | sem erro (`setup_error.json` removido pelo CLI) |

Todos os arquivos scratch e sintéticos foram removidos ao final (verificado: zero `.mainsagents-probe-*` na pasta e nenhum arquivo fora dela). Nenhum vídeo pessoal foi lido ou alterado. Transcrição e Remotion não foram necessários para provar o executor, porque FFmpeg/ffprobe já passaram pelo mesmo shell no sandbox.

Ponte real de ponta a ponta (`startCodexBridge` do working tree no runtime real, apenas `GET`): `/api/codex/executor?refresh=1` respondeu `200 {"ready":true,"state":"ready","desktopIsolation":{"localAppDataIsolated":true,"disabledDesktopMcpServers":["node_repl"]}}` em 3,6 s; o cache respondeu em 2 ms. `/api/codex/sessions/<uuid inexistente>/images` respondeu `410 {"code":"thread-missing"}`.

### Latência do primeiro comando (achado secundário, corrigido na ponte)

Num app-server recém-iniciado, o primeiro `command/exec` levou de 5 a 30 s, e uma vez **79,6 s** com a primeira raiz gravável. Os seguintes levaram ~0,3–0,5 s. O log mostra `sandbox setup required: sandbox users missing or incompatible with marker version` seguido de um novo provisionamento de `CodexSandboxOffline/Online` (regras de firewall/WFP). Com o timeout fixo de 30 s, a primeira versão da sonda reportava um falso "indisponível". Agora há aquecimento, espera curta e o estado `slow`.

Causa provável, não corrigível neste app sem enfraquecer o isolamento: `~/.codex`, o runtime do MainsAgents e o Codex Desktop guardam cada um a sua senha (`.sandbox-secrets`) para os **mesmos** usuários locais do sandbox. Quando um deles reprovisiona, os outros ficam com credencial antiga. Isso explica o `CreateProcessWithLogonW failed: 1326` intermitente que a frente C observou com vários `codex.exe` abertos. Observação: `~/.codex/.sandbox/setup_error.json` (do CLI de terminal do usuário, não do app) também registra `setup refresh had errors` em 11/10 às 15:45. O mesmo travamento do `node_repl.exe` deve afetar o Codex de terminal; isso não foi alterado.

## Contrato de sessão (entregue a B/C)

Textos reais do CLI 0.162.1, verificados pelo probe:

| Situação | Texto do CLI | Ponte |
| --- | --- | --- |
| Thread comprovadamente ausente | `no rollout found for thread id <id>` (também `no persisted rollout`, `thread not found`, `… not materialized yet`) | **HTTP 410** `{error, code:'thread-missing'}` |
| Thread fora da memória | `thread not loaded: <id>` (vem de `thread/read`; uma thread persistida e não carregada responde `status.type:'notLoaded'` sem erro) | a ponte faz `thread/resume` primeiro; só vira 410 se o resume provar a ausência; caso contrário, **409** `code:'thread-not-loaded'` |
| Id inválido | `invalid session id: …` / validação do host `Invalid Codex thread identifier.` | **400** `code:'invalid-thread-id'` (nunca é expiração) |
| Envio sem a sessão ter sido retomada nesta ponte | — | **409** `code:'thread-not-loaded'`: reabrir com `POST /api/codex/sessions`, sem recriar |
| Autenticação, rede, setup do sandbox, writer ativo | — | 500/409 com `message`, **sem** `code` de ausência |

O mesmo critério de evidência é usado em `codex-session-errors.mjs` (C) e em `sessionRecovery.ts` (B). `runtimeRequest` repassa `error.code`/`error.status` ao `production-coordinator`.

## Testes focais (todos passando)

`node --test tests/codex-thread-errors.test.mjs tests/codex-executor-readiness.test.mjs tests/codex-runtime-home.test.mjs tests/agent-file-access.test.mjs tests/chat-image-bridge.test.mjs tests/codex-launch.test.mjs tests/editorial-work-bridge.test.mjs tests/native-runtime-bridge.test.mjs tests/production-readiness.test.mjs tests/runtime-diagnostics-view.test.mjs tests/codex-session-errors.test.mjs`

Esses testes cobrem: o diagnóstico com o log do incidente; a sonda com a política da sessão e o caminho passado por variável de ambiente (sem injeção no comando); o estado `slow` diferente de `failed`; skills lidas pelo host apenas de Markdown configurado, com limite; a ponte injetando diagnóstico e skill **somente** em `failed`; o mapeamento 410/409/400/500 com textos reais; "not loaded" resolvido por resume; `chatRuntime` propagando `code`; o isolamento sem tocar MCPs do usuário nem o sandbox; e a UI separando login de executor. `tsc --noEmit -p tsconfig.app.json` passa. A suíte completa, o build e o pacote ficam com C.

## Limites

- A correção só chega ao usuário com o **0.3.61 empacotado e instalado** (C). Até lá, o 0.3.60 instalado continua falhando sempre que o Codex Desktop estiver com o `node_repl.exe` aberto.
- O isolamento depende de o CLI descobrir os runtimes do Desktop via `LOCALAPPDATA`; o comportamento foi verificado na 0.162.1. Se uma versão futura do CLI usar outro caminho, a sonda vai devolver `failed` com o caminho e o `os error` exatos, sem afirmar que está pronto. Nesse caso, a linha "Executor local" da UI mostra o motivo.
- O MCP `node_repl` do Desktop fica indisponível **dentro do MainsAgents** (de qualquer forma, ele não funciona fora do Desktop). O Codex Desktop e o CLI de terminal não são alterados.
- A rotação de credenciais dos usuários do sandbox compartilhados entre homes Codex é comportamento do CLI (upstream). O app apenas tolera a latência.
- A leitura de skill pelo host **não prova** que o executor está pronto. Ela só evita que o agente fique sem contexto quando o shell falha, e o agente continua instruído a relatar o erro e a não declarar cortes/exportações.

## Contrato para C (pacote, QA e instalação)

1. Incluir no `app.asar` os arquivos `codex-executor-readiness.mjs` (já está em `build.files`), `codex-bridge.mjs`, `codex-runtime-home.mjs`, `agent-file-access.mjs` e o `dist/` com a UI. `scripts/codex-executor-real-probe.mjs` é ferramenta de QA e não precisa ir no pacote.
2. QA do pacote com o CLI real: repetir o controle negativo e o positivo acima. O `scripts/test-packaged-runtime-session.mjs` de C já cobre isso com fixture. Opcionalmente, rodar o probe A contra o runtime real **com o app fechado**.
3. Depois de instalar, em Configurações → Capacidades → "Verificar capacidades", esperar "Executor local do Codex: Pronto", com "Isolamento do Codex Desktop: Ativo · node_repl desativado(s) só neste app". O primeiro teste após abrir o app pode mostrar "Ainda preparando o sandbox" por até ~1 min.
4. Não apagar `codex-runtime\.sandbox*`, os bancos SQLite nem `config.toml`. Não desativar o sandbox nem conceder escrita global.
