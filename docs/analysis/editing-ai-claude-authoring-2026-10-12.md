# Claude como diretor/editor com ferramentas locais controladas · 12/10/2026

Frente **B** (Orca `task_babc57820322` / `ctx_2b63f93b93f4`, MainsAgents 0.3.61). Codex coordena; código, testes e scripts desta frente foram feitos pelo Claude Code. Alterações locais anteriores preservadas; sem commit, push, instalação, API paga, subagentes de desenvolvimento ou vídeo pessoal.

**Objetivo:** o editor Claude deixa de devolver um JSON "às cegas". Ele lê a fonte autorizada, **vê frames reais**, escreve um plano de storyboard/motion flexível (schema de A), renderiza prévias curtas, inspeciona **todas as cenas** da revisão atual, corrige dentro de um orçamento e pede o export final, cujo **recibo é verificado pelo host** (arquivo real + sha256). Tudo fica vinculado a uma produção/delegação e não usa shell, escrita de arquivos nem publicação.

## 1. Fontes primárias e o que foi decidido a partir de cada uma

Cada resumo deriva da fonte em ≤150 palavras; consulta feita em 12/10/2026.

**[Custom tools](https://code.claude.com/docs/en/agent-sdk/custom-tools).** Ferramentas são servidores MCP; o nome visto pelo Claude é `mcp__{server}__{tool}`. Listar o nome (ou `mcp__server__*`) em `allowedTools` faz a ferramenta rodar sem prompt. Um resultado contém blocos `text`, `image` (base64 cru + `mimeType`; PNG/JPEG/GIF/WebP chegam como entrada **visual**), `resource`; `isError: true` deixa a mensagem de erro sob controle de quem escreve a ferramenta; `structuredContent` traz JSON exato. Anotações (`readOnlyHint` etc.) são metadados, não enforcement. `tools: []` remove os built-ins sem afetar o MCP. **Decisão:** servidor MCP próprio `mainsagents_editor`; frames voltam como blocos `image` reais; recusas voltam como `isError` com texto escrito pelo host; resultado estruturado em `structuredContent`.

**[Permissions](https://code.claude.com/docs/en/agent-sdk/permissions).** Ordem: hooks → regras deny → regras ask → modo → regras allow → callback. Uma regra *ask* manda a chamada ao callback e, em `dontAsk`, ela é **negada** mesmo com allow. `dontAsk` nega tudo o que pediria confirmação; allow com glob só depois de `mcp__<server>__`; `mcp__*` em allow é ignorado. `allowedTools` não limita `bypassPermissions`. **Decisão:** a sessão de edição não herda o `ask: ['mcp__*']` das conversas normais; usa `dontAsk` + allow só `mcp__mainsagents_editor__*`; nada de `bypassPermissions`.

**[Structured outputs](https://code.claude.com/docs/en/agent-sdk/structured-outputs).** JSON Schema draft-07 validado depois do loop de ferramentas; o resultado traz `structured_output`; falha vira `error_max_structured_output_retries`, e `success` sem `structured_output` deve ser tratado como falha. **Decisão:** relatório final pequeno via `--json-schema`, sempre **reconciliado com o checkpoint do host**; o plano em si passa pela ferramenta `write_plan`, validada pelo schema de A com erros semânticos e revisões, o que um único JSON final não oferece.

**[Subagents](https://code.claude.com/docs/en/agent-sdk/subagents).** `agents` define subagentes com `description`, `prompt`, `tools` restritos e `model` próprio; o Agent tool precisa estar disponível; profundidade/concorrência limitadas por `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`/`..._MAX_CONCURRENT_SUBAGENTS`. **Decisão:** papel opcional `frame-reviewer` (modelo próprio, só ferramentas read-only do editor), profundidade 1, concorrência 1. Desligado por padrão.

**[CLI reference](https://code.claude.com/docs/en/cli-reference) + `claude --help` local (2.1.296).** Confirmados: `--mcp-config`, `--strict-mcp-config`, `--tools`, `--allowedTools`, `--permission-mode dontAsk`, `--json-schema`, `--agents <json-or-file>`, `--restricted` (remove ferramentas que executam código e WebFetch, ignora settings de usuário/projeto, confina ferramentas de arquivo, recusa bypass). `--bare` **não** é segurança (pula OAuth). **Decisão:** sessões de edição usam `--restricted --strict-mcp-config --permission-mode dontAsk --tools ""`.

## 2. CLI existente vs Agent SDK

| | CLI atual (escolhido) | Agent SDK |
|---|---|---|
| Autenticação/cobrança | conta do Claude Code já logada (`claude auth status` → `claude.ai`) | o SDK também roda o Claude Code; não muda a cobrança, mas acrescenta uma dependência e outro ciclo de atualização |
| Ferramentas próprias | servidor MCP stdio (mesmo protocolo dos "in-process tools") | `createSdkMcpServer` no processo |
| Empacotamento | reutiliza `claude-permission-mcp.mjs`, já em `asarUnpack` | novo pacote e binário no instalador |
| Risco de migração | nenhum fluxo existente muda | reescrever bridge, eventos, aprovação e uso |

Não houve migração às cegas: o protocolo de ferramentas (MCP, blocos `image`, `isError`, allow por servidor) é o mesmo nas duas vias, e a CLI já instalada cobre tudo o que é necessário. Sem API paga nem extração de tokens.

## 3. Arquitetura entregue

```
Claude CLI (--restricted, dontAsk, strict MCP)
  └─ stdio MCP "mainsagents_editor" (claude-permission-mcp.mjs, MAINSAGENTS_MCP_ROLE=editor)
       └─ POST loopback /editor  (Bearer token por execução)
            └─ editor-authoring.mjs  (binding, orçamento, ordem, QA, verificação de recibo)
                 └─ callbacks do host  (C: coordinator/delegação/media; A: schema, Remotion, stills)
```

- **`editor-authoring.mjs`** (novo): ferramentas, sessões, tokens, orçamento, gates de QA, checkpoint/restauração, verificação de recibo (`stat` + sha256 do arquivo real), reconciliação do relatório.
- **`claude-permission-mcp.mjs`**: ganhou o papel `editor` (autocontido; repassa `tools/list` e `tools/call`; nunca engole o payload de imagem).
- **`claude-code-bridge.mjs`**: rota `/editor` no gate loopback; para `editorSessionId` monta settings/MCP/agents **por execução** (apagados ao fim), `--restricted`, sem built-ins, `--json-schema`; eventos `editor.checkpoint`, `file.completed`, `editor.report`; `tool.finished.summary` com o texto do host (ação efetiva); buffer de linha maior para resultados com imagem; a rota HTTP remove `editorSessionId`; ao fim do turno só faz `detach` (token morre).
- **`production-runtime.mjs`**: `capabilities.editorTools`, `openEditorSession`/`editorCheckpoint`/`closeEditorSession`; `providerStatus().editorTools`; `editorRoleSuggestion` (sugere o agente Claude conectado como editor, **nunca** troca agentes nem provedor; Claude indisponível → `provider-unavailable` explícito).
- **`production-preflight.mjs/.d.mts`**: checagem `editor-tools` (ok/aviso/não verificado) e `editor-limits` (bloqueio fora da faixa); fingerprint antigo intacto quando não há limites.
- **`src/features/chat/CodexService.ts`**: tipos `EditorFileReceipt`, `EditorCheckpoint` e eventos `file.completed`, `editor.checkpoint`, `editor.report` (contrato com C; ChatProvider/UI não foram tocados).

## 4. Contrato `mainsagents.editor-authoring/1` (congelado nesta entrega)

**Abrir e executar (C):**
```js
const rt = productionRuntimeFor('claude', {getChatRuntime}); // ou bridge.runtime na delegação nativa
if (rt?.capabilities.editorTools) {
  const {sessionId} = rt.openEditorSession({binding, host, grant, limits?, checkpoint?, plan?});
  const {executionId} = await rt.send(threadId, prompt, {...editorAgent, editorSessionId: sessionId, editorReviewerModel?});
  for await (const event of rt.events(executionId)) { /* editor.checkpoint, file.completed, editor.report, ... */ }
}
```
- `binding = {runId, epoch, profileId, workspaceId, agentId, contentId, authorityHash, source:{assetId, versionId, sha256}}`. Na delegação: `runId` = id do job, `epoch` = tentativa, `authorityHash` = autorização real do job.
- `grant = {scope:'edit-local', authorityHash}` deve ser igual ao do binding: a autorização de edição já dada cobre todos os passos locais **sem popups**.
- `host.currentBinding()` é reconsultado **a cada chamada**; qualquer diferença (epoch, agente, perfil, fonte) → `stale`.

**Callbacks do host** (todos recebem `signal`):

| Callback | Retorno | Dono |
|---|---|---|
| `context()` | `{metadata, transcript?:{segments}, brief?, capabilities?, planSchema?, currentPlan?}` | C (+A schema) |
| `frames({target, times, maxWidth})` | `[{time, path\|bytes, mimeType}]` | C (fonte: FFmpeg; edição: Remotion real) |
| `contactSheet({target, start, end, count})` | `{path\|bytes, mimeType, times}` | C/A |
| `storyboardStills({revision, planHash, sceneIds, maxImages})` | `[{sceneId, position:'in'\|'mid'\|'out', time, path\|bytes, mimeType}]` | A (`renderStoryboardStills`) via C |
| `validatePlan({plan, baseRevision})` | `{ok:true, plan, planHash, summary, warnings, scenes:[{id,start,end}]}` \| `{ok:false, errors}` | A, sem efeitos |
| `savePlan({revision, plan, planHash, note})` | — (checkpoint do plano) | C |
| `renderPreview({revision, planHash, start, duration≤10})` | `{previewId, path, sha256, duration}` (B re-hasheia) | C/A |
| `finalExport({revision, planHash, requestKey, summary, qa})` | `{status:'succeeded', receipt}` \| `{status:'pending', jobId}` \| `{status:'failed', message}` | C, idempotente por `requestKey` |
| `exportStatus({jobId, requestKey})` | idem | C |
| `loadCheckpoint(binding)` (opcional) | último checkpoint salvo | C |

`target` = `'source'` \| `{revision}` (composição da revisão atual na timeline editada) \| `{previewId}` (tempos relativos à janela; B soma o início). `requestKey = editor:{runId}:{epoch}:{planHash}`.

**Ferramentas vistas pelo Claude:** `get_context`, `get_frames` (≤8 imagens), `contact_sheet` (≤16 tiles), `storyboard_stills` (≤16), `write_plan` (CAS em `baseRevision`), `render_preview`, `finalize`, `export_status`.

**Regras de ciclo:**
- `maxRevisions = 2` = **duas correções além do plano inicial** (0..5); `maxPreviews = 3` (0..8); `maxVisionBytes = 24 MB` (1..64 MB); `maxCalls = 60`; prévia ≤10 s (configurável até 15).
- `finalize` exige: frames reais da fonte recebidos; prévia da revisão atual renderizada **e inspecionada**; **todas as cenas** da revisão atual cobertas (stills ou frames dentro do intervalo). Uma nova revisão zera a cobertura. Sem capacidade de visão/prévia → `limitations` explícitas (`framesUnavailable`, `previewUnavailable`, `previewBudgetExhausted`, `sceneCoverageIncomplete`), nunca inspeção fingida. `qa.kind = 'model-interpretation'`: revisão do modelo não é sinal medido. Um frame só conta como visto depois que o bloco `image` foi efetivamente montado.
- Depois de `finalize`: `write_plan` e `render_preview` negados; `finalize` repetido vira `export_status` (nunca renderiza de novo). `pending` **não** gera `file.completed`. Exceção em `finalExport` → `uncertain`, nunca repetido; o host reconcilia por `requestKey`.
- `file.completed` sai **só** depois de `stat` + sha256 do arquivo indicado pelo host coincidirem com o recibo (bytes iguais à fonte são rejeitados). O caminho absoluto vai ao host/UI, não ao Claude.
- Fim do turno → `detach` (chamadas tardias `unbound`); export autorizado continua; `closeEditorSession(id,'cancelled')` (cancelamento do usuário) aborta host calls e export; `'closed'` preserva o export.
- Checkpoint (`editor.checkpoint`) traz contadores, cenas, cobertura, `final`, `receipt`; C persiste por run+epoch e o devolve no `open` (ou via `loadCheckpoint`), então reabrir não zera orçamento.
- **`unsafe_plan` é estrutural (revisão B2, 12/10):** o plano é dado declarativo nunca executado, então texto educativo como "localhost:3000", "tokens", "process.env.API_KEY", "127.0.0.1" ou "Bearer token" é **aceito** (o filtro `safeStoryText` de A concorda). São recusados: campos capazes de executar/acessar (`code`, `script`, `html`, `eval`, `src`, `url`, `href`, `path`, `file`, `env`, `fetch`, `ipc`, `command`, `component`, `on*`, `__proto__`…), valores com URL (`scheme://`), URIs `javascript:`/`data:`/`file:`, caminhos de sistema/`../`, marcação `<tag>`, `${…}`/`{{…}}`, caracteres de controle/bidi e o valor exato do token da sessão. Campos desconhecidos continuam negados pelo validador de A (chaves exatas); mídia só por `assetId` registrado. Exportado como `planSafetyProblems(plan, {secrets})`.
- Execuções de edição levam `--max-turns` (padrão 20; `editorMaxTurns` 1..60; flag aceita pela CLI 2.1.296 apesar de oculta no `--help`). Ao estourar: `execution.failed` com `code: 'editor_turn_limit'`, sem retry; o checkpoint guarda o que foi feito.

## 5. Evidência

**Testes novos** (sem modelo; mídia real gerada com FFmpeg 9.0.1):
- `tests/editor-authoring.test.mjs` (10): loop completo com PNGs reais (assinatura verificada), validação, CAS, 2 correções + bloqueio da 3ª, prévia obsoleta, cobertura por cena (prévia cobre só a cena do meio → `qa_required` → `storyboard_stills` → final), recibo com hash real; sem visão → limitações explícitas; binding errado/stale/tardio/cancelado negados; `pending` só vira arquivo após verificação, restart não repete `finalize`; hash errado, bytes da fonte e exceção rejeitados; cancelamento aborta prévia/export; orçamento de imagens não contornável reabrindo; planos inseguros recusados.
- `tests/claude-editor-transport.test.mjs` (3): CLI de fixture lê o `--mcp-config` gerado, sobe o **servidor MCP real** e executa o loop nativo via JSON-RPC (`tools/list` com 8 ferramentas, `tools/call` com imagens). Verifica: só `mainsagents_editor`, `--restricted`, `dontAsk`, sem prompt tool, sem regra ask, `--tools` = `Agent` (com revisor) e nenhum Bash/Write/Edit/PowerShell, allow sem `mcp__*`, `--json-schema`, arquivo de agents; resultados grandes com imagem parseados; `tool.finished.summary` com recusa/ação efetiva; `file.completed` antes do fim; relatório consistente; token tardio `unbound`; configs por execução removidas. Conversas normais mantêm `ask: ['mcp__*']`/`--disallowedTools mcp__*`, sem protocolo de editor; HTTP não consegue anexar sessão; sessão forjada recusada antes de iniciar processo.
- `tests/production-editor-runtime.test.mjs` (3): capacidade só quando o runtime oferece; Claude ausente → `null` (sem troca de provedor); sugestão de editor sem troca silenciosa; preflight ok/aviso/não verificado/bloqueio de limites; fingerprint legado preservado.
- Regressão: `claude-code-bridge`, `claude-mcp-approvals`, `production-preflight`, `production-readiness`, `runtime-capabilities`: todos verdes (40/40 somando os testes novos e as regressões).
- Suíte completa: 536/545 numa execução feita enquanto `editorial-storyboard.mjs` (A) estava com erro de sintaxe no meio da edição; os arquivos afetados passam isoladamente, exceto 1 caso em `remotion-video.test.mjs` (área de A, em andamento). `tsc -p tsconfig.app.json`: sem erros fora de `remotion-video/Storyboard.tsx` (A).

**Prova de infraestrutura na CLI real, sem inferência** — `node scripts/claude-editor-mcp-probe.mjs`: monta os argumentos exatos do bridge, inicia a CLI instalada em modo `stream-json` e envia só `control_request` (`initialize`, `mcp_status`), sem mensagem de usuário:
```
cliVersion 2.1.296 · flagsAccepted · onlyEditorServer · editorConnected · allToolsListed (8)
permissionMode dontAsk · restricted · strictMcpConfig · allowedTools [mcp__mainsagents_editor__*]
builtInTools (none) · structuredReport · modelTurns 0
```
`claude --version`/`auth status` (read-only) confirmaram login `claude.ai`; o settings do usuário não tem regras de permissão (só contagens foram lidas).

## 6. Limites e pendências

- **Avaliação de permissão por chamada não é observável sem inferência.** A probe prova flags aceitas, servidor carregado e lista de ferramentas; a decisão `dontAsk` + allow vem da documentação e dos testes da fronteira. A primeira execução real autorizada pelo coordenador confirma.
- **Callbacks reais dependem de C e A:** frames/contact sheet/stills da composição devem vir do Remotion real (não de proxy FFmpeg sem overlay); `validatePlan` precisa devolver `scenes`; C precisa incluir `editor-authoring.mjs` em `package.json → build.files` (o servidor MCP reaproveita o script já em `asarUnpack`).
- **Delegação nativa:** a API está pronta em `bridge.runtime`; o roteamento do handoff `mainsagents_delegate` → editor Claude é de C. Um alvo Codex não oferece `openEditorSession`, então a capacidade aparece como `false` em vez de fingir.
- **Lançador `.cmd` no Windows:** JSON não passa com segurança, então `--json-schema` é omitido nesse caso (o checkpoint continua sendo a fonte da verdade); `--agents` usa arquivo.
- **Caso real:** nenhum vídeo foi escolhido. A execução no caso do usuário espera o vídeo indicado e a autorização específica do coordenador. Logs reais não foram lidos além de contagens repassadas por C (`production_runs`/`media_jobs = 0`).
- `--max-turns` é oculto no `--help` local, mas aceito (verificado por `control_request` sem inferência; flag desconhecida dá `unknown option`). Os limites com autoridade continuam sendo os contadores do host (`maxCalls`, imagens, revisões, prévias).

## 7. Revisão B2 — prova mínima REAL (12/10/2026)

- **Gate `unsafe_plan` corrigido** para estrutural (ver seção 4); regressão: texto educativo aceito, campos executáveis/URL/path/markup/bidi negados, storyboards autorados de A passam.
- **`--max-turns`** nas execuções de edição (padrão 20; QA usou 12) e falha `editor_turn_limit`.
- **Script** `scripts/claude-editor-real-qa.mjs`: preflight (só método de auth; aborta antes do modelo com API key/proxy/Bedrock/Vertex/apiKeyHelper), clip sintético 8 s em temp isolado, host sobre funções REAIS de A (`validatePlan`+storyboard, `renderStoryboardStills`, `renderAnimatedVideo` excerpt/final). Stubs declarados: clip sem cortes, transcrição = roteiro sintético, sem banco/registry de perfil.
- **Execução real única** (autorizada pelo coordenador; `claude.ai`/firstParty, sem chaves cobradas): `claude-sonnet-5-5`, 11 turnos, 55 s, uso informado pela CLI (tokens out 2243; `reportedCostUsd` 0,13 é o valor que a CLI reporta, não cobrança verificada). Ferramentas: get_context → get_frames fonte (2 imagens) → write_plan (3 cenas) → storyboard_stills **falhou** (bundle Remotion reescrito por outra frente no mesmo instante, 20:14:15Z; erro honesto ao Claude) → render_preview Remotion (frames 60–149) → get_frames preview (2) → finalize **negado `qa_required`** (cenas abertura/fim não vistas) → get_frames `{revision:1}` via renderStill (2) → finalize OK. 6 imagens reais recebidas; cobertura 3/3 cenas; recibo `file.completed` sha256 `248fa150…`, 4.930.820 bytes, 1280x720, 8 s, decodifica inteiro, difere da fonte; `editor.report` consistente com o checkpoint. Contrapontos sem modelo: chamada tardia e token forjado `unbound`, attach após cancel e epoch stale recusados. Evidências: `docs/analysis/editing-ai-claude-authoring-2026-10-12/qa-real-run.json`, `qa-dry-run.json`, `qa-final-mid.png`.
- **Limites:** QA visual é interpretação do modelo; bundle Remotion precisa de publicação atômica (A) para não falhar durante rebuild; ensaio de C (handoff/registry/receipts) deve reusar esta evidência sem nova inferência. Testes B: 41/41.

## 8. Integração C — revisão independente B3 (12/10/2026, somente leitura)

Revisão de `production-coordinator.mjs` (`planAuthoredEdit`, l.103–140), `editor-host.mjs`, `editorial-media.mjs` (`authoring`/`authoringFrames`), `production-runtime.mjs` e da rota `engine` de `native-agent-delegations.mjs` contra o contrato `mainsagents.editor-authoring/1` (revisão B2) e o storyboard de A. Sem inferência, sem suíte global, build ou install; nenhum arquivo de C/A editado. Defeitos enviados ao root pelo Orca (a dispatch de C `ctx_f25132483639` já constava como `failed`).

**Conferido e correto**
- Binding: `runId`/`epoch`/`profileId`/`agentId`(editor)/`contentId`/`source{assetId,versionId,sha256}` do run; `authorityHash = bindingHash(p)` = a prova gravada em `production_authority`, que `guard()` reconsulta a cada chamada (via `currentBinding`). `grant.scope='edit-local'` igual ao binding.
- Export final único: depois de `finalize`, B só chama `export_status`; C bloqueia segundo export por `p.videoJobId`, e o `requestKey` de mídia `editor-<hash(editor:runId:epoch:planHash)>` é idempotente (`editorial-media.mjs:254`); reinício com job salvo segue o mesmo job (l.105). `pending` não gera `file.completed`; o recibo do host sai pelo `receiptFor` normal na etapa `editing`.
- Imagens reais: `{revision}` → stills do Remotion (mesmos props/assets do export); prévia → frames do MP4 renderizado pelo Remotion; fonte → FFmpeg. Tempos de cena do storyboard são da timeline editada (`basis:'output'`), a mesma usada pela cobertura de B.
- Diretor: padrão Claude; fonte Codex → editor sob diretor Claude via `directorAgent` + `editorSessionId` na mesma instância do bridge que abriu a sessão; Claude indisponível → erro explícito, sem troca de provedor. Cancelamento fecha a sessão com `'cancelled'`.

**Defeitos**

| # | Sev. | Onde | Problema | Correção sugerida (C) |
|---|---|---|---|---|
| D1 | Alta | `production-coordinator.mjs:125` (+ `revise-video` l.671, `set-edit-director` l.610, `accept-basic` l.618) | `p.authoring` nunca é limpo quando `epoch++`; o próximo `openEditorSession` recebe checkpoint da época anterior e `editor-authoring.mjs:186` recusa (`belongs to another production revision`) → pedir ajuste do vídeo depois de uma edição autorada (ou trocar o diretor após falha do export) bloqueia o run para sempre. Reproduzido com Node, sem modelo. | Limpar `p.authoring` ao mudar de época (ou indexá-lo por época) e só passar `checkpoint`/`plan` quando `checkpoint.epoch === p.epoch`; teste `revise-video` após `editor-tools`. B mantém a recusa estrita: checkpoint obsoleto nunca restaura orçamento. |
| D2 | Média | `editor-host.mjs:59–62` | `storyboardStills` renderiza todas as cenas (`perScene:3`) e só depois filtra `sceneIds`/corta em 16; com mais de 5 cenas, cada chamada de complemento re-renderiza o storyboard inteiro. | Passar `sceneIds` (ou os tempos das janelas das cenas) para `media.authoring` stills. |
| D3 | Baixa | `production-coordinator.mjs:114` | `status()` faz `asset.id` sem checar `undefined`; `versionId` vem de `currentVersionId`, não da versão cujo sha256 é o do arquivo. | Buscar a versão pelo sha256; ausente → `pending`/`failed` com mensagem. |
| D4 | Baixa | `editor-host.mjs:20` | `currentBinding` devolve a época do objeto em memória; deriva só é pega por `guard()` (cancelamento + hash de autoridade). Hoje é seguro (nenhuma ação muda época em `planning-edit`). | Reler época/fonte/editor do banco. |
| D5 | Baixa | `production-coordinator.mjs:136` | Fecha sem `forgetEditorSession`; sessões fechadas (com closure do run) ficam no registro do bridge até sair do app. | `rt.forgetEditorSession?.(id)` depois do `close`. |
| D6 | Baixa | `production-coordinator.mjs:135` | O checkpoint do `onEvent` só é gravado no `put` limitado a cada 200 ms; se o turno falhar logo após `write_plan`, os contadores podem ficar um passo atrás ao retomar. | `put(p)` ao receber `editor.checkpoint`. |

**Mudança em B (dona, testes direcionados 17/17):** o `editor.checkpoint` passou a levar `authorityHash`, e `open()` recusa checkpoint de outra autoridade (`editor-authoring.mjs:186–188, 203`; teste em `tests/editor-authoring.test.mjs`). Motivo: trocar o diretor em `planning-edit` muda a autoridade sem `epoch++` quando ainda não há job, e o orçamento/cobertura do diretor anterior seria restaurado.

**Outros achados enviados a C/root:** (1) travamento de `tests/production-authored-edit.test.mjs` (teste 3): `kick()` em `native-agent-delegations.mjs` enfileirava o segundo job atrás do primeiro (mesmo `targetSessionId`), e o gate do teste só liberava depois do segundo; com autorização do root, B ajustou **apenas** essa linha (jobs `engine` não esperam pela sessão de CLI) e encerrou só a árvore de processos travada desse teste (3 PIDs conferidos). (2) Chat genérico sem `contentId`: o backend só achava o conteúdo por `input.contentId`. A UI liga o chat depois do refresh (`mergeProductionSessions`), mas o backend não deve depender disso. C passou a procurar por `sourceSessionId` + sha256 do vídeo e criou a tabela `production_delegation_links`. Também foi recomendado um assert do recibo no chat de origem público.

**Segunda leitura (diff final de C):** D1–D6 corrigidos. Conferidos: reset de `p.authoring` por época/autoridade com `previousPlan`; checkpoint e plano só passam quando época e autoridade coincidem; `host.read` relê o banco e `bindingOf` reconstrói época/editor/autoridade/fonte; `sceneIds` repassados até `renderStoryboardStills`; versão do recibo achada pelo sha256; `forgetEditorSession`; `put` a cada checkpoint; `dropVideoJob` em troca de diretor e em `accept-basic`; `producedBy` com o provedor do diretor; gate de motion visível em `validatePlan` e `finalExport`; dedup A/B/A por `currentRequestHash` (pedido igual durante render → anexa; qualquer pedido numa versão entregue → ajuste em nova época; pedido diferente durante render → recusado com motivo). **Observação baixa, sem bloqueio:** se `revise-video` falhar depois de `linkJob`, um retry do MESMO job encontra o run ainda em `video-review` e devolveria o recibo anterior; vale fazer o link só depois do `revise` confirmado.

**Freeze B:** contrato `mainsagents.editor-authoring/1` congelado como na seção 4, mais o `authorityHash` no checkpoint. Sem inferência nova nem suíte global. Ficam com C/D: dois ensaios com o motor real, UI e empacotamento.
