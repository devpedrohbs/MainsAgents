# Checkpoint de pausa — executor e sessões (10/10/2026)

Pausa solicitada explicitamente pelo usuário por precisar sair, aproximadamente às 15:16 de São Paulo (18:16 UTC). **Não retomar automaticamente.** Este arquivo registra a coordenação; não é uma entrega de implementação concluída.

## Regra do usuário

- Codex atua somente como orquestrador: coordena, inspeciona resultados e encaminha tarefas.
- Todo desenvolvimento, correção, scripts, testes e atualização do aplicativo devem ser executados pelo **Claude Code**.
- A preferência também está sendo registrada pelo Claude em `CLAUDE-CODE-COLLABORATION.md` (alteração local já presente).

## Estado preservado

- Repositório: `C:/Users/pacas/Documents/ChatGPT/MainsAgents`, branch `main`, base commit `d513c9d` já enviada ao remoto na rodada anterior.
- Aplicativo instalado: **0.3.60.0**; `package.json` continua **0.3.60**. A atualização planejada 0.3.61 ainda não foi gerada/instalada nesta rodada.
- Há alterações locais parciais dos Claudes, ainda sem commit/push. Não resetar, limpar ou sobrescrever essas alterações.
- Os três agentes da rodada receberam a instrução de pausa e foram parados pelo Orca; o encerramento de cada terminal supervisionado foi confirmado (`ptyKilled:true`, liveness `exited`). Não foi solicitado encerramento do aplicativo do usuário.
- No protocolo Orca, as tentativas aparecem como `stopped` / Dispatch `failed` devido à pausa deliberada, **não** como conclusão nem nova falha técnica da implementação.

## Diagnóstico confirmado

### A — falha do executor e leitura de skills

Erro relatado: `helper_unknown_error: setup refresh had errors`; ferramenta alternativa: `trusted Node process exited unexpectedly; kernel reset`.

Evidências dos Claudes A/C:

1. CLI npm Codex **0.162.0**, instalado depois da verificação da 0.3.60, enumera `%LOCALAPPDATA%/OpenAI/Codex/runtimes` durante a preparação do sandbox Windows. Ao tentar ajustar/validar ACLs de `cua_node/.../node_repl.exe` já em uso, falha com **OS error 32**. Isso impede qualquer `exec_command`, inclusive leitura.
2. O `config.toml` compartilhado por hardlink recebeu configurações internas do Codex Desktop: MCP `node_repl`, caminhos de código confiável e `notify` do Desktop. O runtime do MainsAgents passou a iniciar esse kernel, que depende de serviços do Desktop e também falha.
3. Desabilitar apenas o MCP e `notify` **não** resolve a enumeração de executáveis: o caminho vem de `LOCALAPPDATA`.
4. O fix em andamento usa `desktopRuntimeIsolation` em `codex-runtime-home.mjs`: processo CLI recebe `LOCALAPPDATA` privado; comandos recebem o valor real via `shell_environment_policy.set.LOCALAPPDATA`; só MCPs/notificações internos do Desktop são neutralizados. Sandbox, configuração global compartilhada, autenticação e MCPs legítimos do usuário devem ser preservados.

**Validação já reportada por A:** 7/7 verificações reais do CLI, sem inferência paga, com o executável conflitante ainda em uso: controle sem isolamento reproduziu a falha; com isolamento, leitura de skill em read-only, ambiente original nos comandos, criação/leitura/remoção de scratch autorizado e corte FFmpeg sintético de 1 s passaram; escrita fora da pasta e rede continuaram bloqueadas.

**Ainda pendente:** finalizar/verificar preflight do executor e fallback de leitura de skills pelo host (somente skills configuradas e referências autorizadas, read-only); testes focados finais; contrato com pacote; relatório A; aplicação no app instalado. Não tratar leitura de skill pelo host como prova de que o executor está pronto.

### B/C — erro ao retomar ciclo e encaminhar ao editor

A hipótese inicial de idade/expiração da conversa foi refinada pelos logs: **o `thread/resume` do chat antigo funcionou**. A falha concreta veio de `mainsagents_delegate` ao pedir uma sessão **nova** para o editor, com a mensagem `The linked session belongs to another agent`.

Bug identificado em `native-agent-delegations.mjs`, linhas 67–70:

- `input.sessionMode !== 'new' && ...` produz `false` quando o modo é `new`.
- `child` fica `false`, e `child ?? novaSessao` continua `false`.
- A validação compara `targetSession.agentId` indefinido com o agente alvo e falha.

**Atenção:** na inspeção feita depois da pausa, `native-agent-delegations.mjs` AINDA contém esse código antigo. C reportou testes de um patch, mas a correção precisa ser aplicada e validada no arquivo de produção. Não declarar o bug resolvido no app.

Existe também registro de reconstrução do `state_5.sqlite` do runtime após dano; não foi comprovado como causa do incidente acima. Não apagar/reconstruir bancos pessoais como tentativa de correção.

Contratos exigidos pelo coordenador:

- Sessão remota comprovadamente ausente: `error.code = 'thread-missing'`, gateway HTTP 410 com código legível. Antes de enviar um turno, pode criar sessão nova preservando histórico/contexto e avisando o usuário.
- `thread/read: thread not loaded` pode ser apenas sessão fora da memória: tentar retomar corretamente antes de concluir ausência. `invalid session id`, autenticação, rede e falha de setup não devem virar expiração silenciosa.
- Se o turno já foi enviado/em streaming, resultado incerto exige retomada/reenvio explícito; nunca repetir efeitos automaticamente.
- Sessão nova de conteúdo deve associar somente produção escolhida intencionalmente, com `contentId/topicId/run` corretos; não adotar a última produção global nem contexto de outro agente.
- Link automático obsoleto pode abrir sessão nova com aviso; `targetSessionId` explícito de outro agente/workspace deve ser recusado claramente.

**Validação parcial C:** 3/3 testes focados de recuperação passaram; dois falham sem o patch. O coordenador pediu restringir a regex ampla de ausência e adicionar regressões para sessão não carregada ainda recuperável, formato inválido, rede/autenticação/setup e estados anteriores/posteriores ao envio.

## Alterações locais observadas no momento da pausa

Modificados:

- `CLAUDE-CODE-COLLABORATION.md`
- `codex-bridge.mjs`, `codex-runtime-home.mjs`
- `production-coordinator.mjs`
- `src/components/chat/ChatPanel.tsx`, `ContentSessionCard.tsx`
- `src/features/chat/ChatProvider.tsx`, `HttpCodexService.ts`, `contentSessions.ts`, `model/Chat.ts`
- `src/features/production/model.ts`
- `tests/codex-runtime-home.test.mjs`

Novos:

- `codex-executor-readiness.mjs`
- `scripts/local-update-backup.mjs`, `scripts/test-packaged-runtime-session.mjs`
- `src/features/chat/sessionRecovery.ts`
- `tests/codex-executor-readiness.test.mjs`, `tests/production-session-recovery.test.mjs`, `tests/session-editing-recovery.test.mjs`

As edições podem estar incompletas: revisar o diff e a sintaxe ao retomar, antes de executar o pacote ou afirmar que funcionam. Foi observada uma saída de shell anormalmente volumosa no worker B; foi pedido que ele inspecionasse o próprio subprocesso. Isso não foi confirmado como causa de falha do app.

## Tarefas e retomada supervisionada

Run: **`run_2a962f6205d8`**. CLI utilizado: **`orca`**. Preservar a autoridade das tarefas existentes; não criar Run novo só para contornar tentativas interrompidas.

| Frente | Task | Tentativa parada | Ownership |
| --- | --- | --- | --- |
| A — executor/skills | `task_6dc12fc5e890` | `ctx_635eaaad3ae4` | `codex-bridge.mjs`, `codex-runtime-home.mjs`, `agent-file-access.mjs`, `codex-workflow-runtime.mjs`, helpers/readiness e testes próprios |
| B — chat/retomada/handoff | `task_325ac1efea72` | `ctx_84e89fa9c8b9` | ChatProvider/Panel/model/contentSessions/HttpCodexService, provedores de conteúdo/produção e testes próprios |
| C — integração/pacote/instalação | `task_c1b828d7ba68` | `ctx_2031a63053c0` | coordinator/bridges backend/desktop/package/QA, `native-agent-delegations.mjs`, colaboração/docs e atualização local |

Só depois de o usuário pedir continuar:

1. Ler este checkpoint, o guia atual de `orca skills get orchestration`, conferir Run/Task/Dispatch e alterações preservadas; não reutilizar handles efêmeros antigos.
2. Retomar tarefas paradas com `worker-start --task <task> --retry-of <dispatch> --worktree current --agent claude --json`, usando o Run existente e o checkout correto. Se for preciso revincular o coordenador ao Run, usar a operação documentada pela versão atual do CLI; não adivinhar comandos.
3. A/B terminam correções e testes focados e anunciam freeze. C integra o bug `new` no código real, contratos e preflight, depois roda regressões, build e pacote.
4. C verifica o `app.asar` com CLI real: reproduzir controle negativo e positivo do isolamento, ler skill, scratch/corte sintético, direitos de acesso e recuperação/handoff sem duplicação. Não depender somente de mocks ou testes da fonte.
5. Preparar 0.3.61 local (`--publish never`), backup SQLite consistente incluindo WAL e verificação de estado/hash; não fechar trabalho ativo nem forçar encerramento do app do usuário. Só instalar depois de pacote validado e app sem trabalho ativo; conferir versão e dados preservados.
6. Sem inferência paga, publicação externa, alteração de vídeos pessoais, commit ou push nesta rodada sem autorização específica. Todo desenvolvimento continua com Claude Code; Codex apenas orquestra.

Relatórios planejados (ainda não concluídos): `runtime-local-recovery-2026-10-10.md`, `session-editing-recovery-2026-10-10.md`, `runtime-session-fix-2026-10-10.md`.
