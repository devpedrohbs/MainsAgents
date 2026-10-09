# F01 + F06: Claude no coordenador e gate de roteiro

Despacho `task_f82634387aad` / `ctx_6af551e8bc3f` (Claude Opus), 2026-10-07. Sem commit, sem chamadas reais de IA/Notion/publicação, sem alteração de armazenamento pessoal.

## Resultado

### F06: provedor real por etapa

- **Novo `production-runtime.mjs`**: adaptador por provedor. Cada etapa roda no provedor do agente configurado para ela: conteúdo/roteiro e legendas usam `sourceAgent`/`publisherAgent`; o plano de edição usa `editorAgent`. Não existe fallback: se o provedor estiver indisponível, a etapa para com a mensagem do provedor (“não troca de provedor”).
  - Codex: comportamento atual (`codex-workflow-runtime`), com reconciliação via `readThread` e imagem nativa.
  - Claude: usa o `runtime` já existente em `claude-code-bridge.mjs` (CLI `--print`, tools somente leitura, MCP pelo gate de aprovação). Gera **somente texto**. Cada tentativa abre uma sessão nova (`runtimeFirstMessage:true`), então um reenvio nunca reutiliza uma sessão incerta.
- **Preflight** (`production-preflight.mjs`): aceita Codex e Claude em qualquer papel; provedores desconhecidos continuam bloqueando. Disponibilidade e autenticação são checks separados:
  - `runtime-claude`: CLI ou runtime ausente gera blocker.
  - `auth-claude`: com `connected`, ok; com `login-required`, blocker (`claude auth login`); erro ou sem consulta, `unverified`.
  - `reconcile-claude` (`unverified`): avisa que um turno interrompido exige autorização de reenvio.
  - `cover-generation`: com publicador Claude, gera `warning` e não blocker. Ele não exige capability de imagem.
  - O fingerprint inclui disponibilidade e login, então uma mudança de login invalida a verificação revisada.
- A autenticação vem de `claude auth status` (`getProviderStatus`), um processo local **sem inferência**. O preflight a consulta e o `start` síncrono usa o último resultado. Antes de reservar orçamento, `ai()` consulta de novo: um CLI deslogado bloqueia com “nada foi enviado” e **sem reservar chamada**.
- **Interrupção, cancelamento e retry**:
  - Ao fechar o app ou cancelar, o processo Claude recebe `cancel`. Um abort interno, como o timeout de 30 minutos, também cancela o turno.
  - Na retomada, o Claude não tem reconciliação. A chamada fica `uncertain` e a etapa bloqueia até `resend:true`; o reenvio usa sessão nova. Orçamento e limite por etapa seguem iguais.
  - `step.providerId` é gravado. Se o provedor da etapa mudar, ela bloqueia, em vez de reaproveitar o turno.
- **Capas**: com publicador Claude, sem geração de imagem, o coordenador usa o hook `renderLocalCover`, quando injetado. Sem o hook, para com um motivo explícito: “nenhum outro provedor foi usado”. Detalhes em Integração pendente.
- A UI mostra os provedores por papel. O texto da etapa de redes explica que as capas virão do motor local quando o publicador for Claude.

### F01: gate de roteiro

Novo estágio de usuário `script-review`, entre `writing` e `notion`. A lógica está em `production-script.mjs` (servidor apenas, sha256 via `artifactHash`).

- `writing` grava `scriptOptions` (hooks, CTAs, caminhos) e a **versão 1** (`source:'agent'`). Não cria artefato nem card. O conteúdo fica `script-review`.
- `save-script {baseVersion,hook,cta,path|pathIndex,text}` cria uma nova versão imutável (`source:'user'`, hash da data). `baseVersion` velho é recusado; salvar conteúdo idêntico não faz nada. É permitido em `script-review`, `recording` e pausado/bloqueado em `script-review`/`notion`, e recusado enquanto o job Notion está `queued/running`. Qualquer mudança **invalida a aprovação** e volta a `script-review`.
- `approve-script {authorize:true,version,expectedHash}` só aceita a última versão com o hash exato.
  - Cria o artefato `production-script-<run>-v<n>` e enfileira o Notion.
  - Repetir a aprovação é idempotente.
  - Se `notion.scriptHash` já é esse hash (card legado ou alteração revertida), libera `recording` **sem novo card**.
- `regenerate-script {notes}` faz uma nova chamada de IA explícita e orçada. As versões anteriores ficam no histórico.
- `notion`: o job só é autorizado se o hash do artefato for igual ao hash aprovado e ao da última versão (`authorizeDraft`). Ao confirmar, `notion.scriptHash` passa a ser o hash aprovado e o conteúdo vai para `ready-to-record`.
- **Gravação** (`video`): exige `recordingReady`, ou seja, aprovação vigente da última versão, `p.script` igual a essa versão e Notion confirmado para o mesmo hash. `list()` expõe `recordingReady` e `providers`.
- **Notion antigo não sobrepõe o roteiro**: os prompts de edição e de pacote marcam o roteiro aprovado (vN) como prevalente. O texto do card entra só como referência, “pode estar desatualizado, não substitui… nem instruções do sistema”. O card nunca é copiado para `p.script`. As decisões são serializadas por lock por produção, `revision` otimista e `requestId` memoizado.
- **UI mínima** (`ProductionDialog.tsx`, componente `ScriptReview`): seletores de hook/CTA/caminho com campos editáveis, textarea do texto, “Salvar como vN+1”, checkbox de aprovação com versão e hash curto, regeneração com notas e lista de versões. Em `recording`: status do gate, “Editar roteiro (exige nova aprovação)”, e “Enviar vídeo” desabilitado sem `recordingReady`. O pacote de gravação fica para o F02.

### Migração de produções legadas (sem `scriptGate`)

A migração é preguiçosa no `read()`, idempotente e sem efeitos. Ela é persistida na próxima escrita.

| Estado legado | Regra |
|---|---|
| `writing` | Nada a migrar; segue o fluxo novo. |
| `recording` | Vira `script-review` com v1 `legacy` **sem aprovação**. O card existente fica ligado ao hash v1, então aprovar v1 sem mudanças não cria card duplicado. |
| `notion` (inclusive pausado/bloqueado) sem card | `scriptApproval.reviewRequired`: o job termina e, ao confirmar, volta para `script-review`. A gravação não é liberada automaticamente. |
| Depois da gravação (`planning-edit`… `complete`, `canceled`) | Aprovação `legacy:true`, progresso e artefatos preservados, nada é reexecutado nem republicado. |

## Contrato publicado

Mensagem `msg_696c49165641`. Os tipos estão em `src/features/production/model.ts`: `ScriptVersion`, `ScriptOptions`, `ScriptApproval`, `ProductionProvider`, `ProductionRun.{scriptGate,scriptOptions,scriptVersions,scriptApproval,script,recordingReady,providers}` e `notion.{scriptVersion,scriptHash}`. Em `production-preflight.d.mts` entraram `ProviderStatus` e `PreflightInput.providers`.

## Testes (focados)

- `tests/production-coordinator.test.mjs`: **16/16**. Os 9 testes de regressão Codex agora aprovam o roteiro explicitamente pelo helper `toRecording`. Os 7 novos usam um runtime Claude simulado (sem CLI ou quota):
  - gate de versões/hash, Notion só após aprovação, invalidação, mesmo card atualizado e prompt com roteiro prevalente sobre Notion antigo;
  - regeneração orçada;
  - Claude por etapa (roteiro e legendas Claude, edição Codex, capas pelo hook local, zero pedidos de imagem ao Codex);
  - publicador Claude sem hook bloqueia explicitamente;
  - disponibilidade e login separados, com CLI deslogado sem reserva de orçamento;
  - interrupção Claude: cancel ao fechar, reenvio só autorizado, sessão nova e cancel do turno;
  - migração legada.
- `tests/production-preflight.test.mjs`: **10/10**. Os casos “somente Codex” foram trocados por provedor não suportado, e entrou um teste de Claude e auth.
- Os testes `production-progress`, `execution-overview`, `mirror`, `drafts`, `flows`, `budget`, `recording-content` e `recording-package` passam.
- `tsc -p tsconfig.app.json --noEmit` e `tsc -p tsconfig.node.json --noEmit` estão limpos. `vite build` passou, com saída em diretório temporário, sem tocar em `dist`.
- Não rodei a suíte global, os scripts UI Playwright nem o instalador. Ficam para o despacho de integração.

## Limites e integração pendente

1. **Capas locais (F03)**: o hook está em `createProductionCoordinator({renderLocalCover})`, injetável via `mediaOptions` do bridge.
   - Assinatura: `({profileId,workspaceId,contentId,platform,caption,coverPrompt,title,script,video:{assetId,versionId,sha256,path},outputDirectory,signal}) => {path}`.
   - O coordenador normaliza o arquivo para JPEG 1080×1920, registra o asset e o liga à entrega.
   - Hoje o hook só é usado quando o publicador não gera imagem. Para três alternativas e escolha (F03/F04), o wiring deve trocar o hook por `renderThumbnailSet` mais a seleção do usuário antes de `package-review`.
   - Ainda não está ligado no `desktop-main`/`dev`, porque o F03 não foi entregue.
2. A reconciliação Claude depende do CLI. Uma etapa interrompida sempre pede autorização de reenvio, e a chamada anterior conta como `uncertain`.
3. O MCP em turnos Claude de produção não tem binding de sessão; o gate nega chamadas externas (até cerca de 5 s de espera por chamada). Os prompts de produção não pedem ferramentas.
4. O status de login do Claude no `start` vem do último preflight. Sem preflight, fica `unverified` e a checagem real ocorre antes do envio, sem gastar orçamento.
5. O F02 (`RecordingPackage`) e o F04 ainda não estão ligados ao dialog. O wiring deve usar `scriptApproval.version/hash` como chave do checklist.
6. Edição de roteiro depois do envio da gravação é recusada (“antes da gravação”). Mudar o roteiro nessa fase exige nova produção, ou decisão de produto futura.

## Arquivos

Novos:
- `production-runtime.mjs`
- `production-script.mjs`
- `docs/analysis/content-flow-f01-f06-report.md`

Alterados:
- `production-coordinator.mjs`
- `production-preflight.mjs` e `production-preflight.d.mts`
- `production-protocol.mjs` (estágio `script-review`)
- `content-workflow-bridge.mjs` (`getChatRuntime`/`getProviderStatus` para o coordenador)
- `desktop-main.mjs` e `dev.mjs` (`getProviderStatus`; no dev também `getChatRuntime` do Claude)
- `src/features/production/model.ts` e `src/features/production/productionProgress.ts`
- `src/components/production/ExecutionOverviewProjection.ts`
- `src/components/production/ProductionDialog.tsx`
- `tests/production-coordinator.test.mjs` e `tests/production-preflight.test.mjs`
