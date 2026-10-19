# Retomada de sessão, encaminhamento do vídeo e camadas de teclado: frente B (11/10/2026)

Executado pelo Claude Code (worker B, task `task_325ac1efea72`, dispatch `ctx_e8b161e84170`). O Codex atuou somente como orquestrador. Não houve commit, push, instalação, IA paga, publicação, alteração do banco real nem subagentes.

## 1. O que realmente falhou (incidente de 10/10)

Fontes consultadas somente para leitura, a partir de cópias no scratchpad: `codex-runtime/logs_2.sqlite`, o rollout `rollout-2026-10-08T20-30-08-01a11dda-…jsonl` e `~/.mainsagents/storage/workspace-state.sqlite`, além dos backups `workspace-before-0.3.59/0.3.60` e `workspace-latest`. Só foram lidos metadados e trechos curtos.

| Hora (UTC) | Evento |
| --- | --- |
| 17:55:51 | `thread/resume` da conversa antiga (`session-mv065gon-rvfm`, thread `01a11dda…`, criada em 08/10) **funcionou**. Não houve erro de idade nem de expiração. |
| 17:56:34 | O agente de conteúdo chamou `mainsagents_delegate({targetAgentId: editor-de-video, sessionMode: "new", files: [LinkedinSkills.MOV]})` e recebeu **`The linked session belongs to another agent.`** |
| 17:57:35 | O agente repetiu a chamada e recebeu o mesmo erro. |
| 17:58:24 | O agente pediu que o usuário clicasse em **Nova sessão**. O relato “a sessão tinha muito tempo” é a interpretação do usuário; o texto real é o acima. |
| 17:59–18:01 | Num chat novo e genérico, o encaminhamento ao editor **funcionou** (job `6e7f723f…`, sessão `delegated-d3e26e66…`). O editor recebeu o briefing, mas as ferramentas locais falharam. Essa falha do executor pertence à frente A. |
| 17:58–18:06 | `session-mv065gon-rvfm` e `delegated-5773a519…` saíram do store. A única rotina que remove sessões é `deleteSession`, acionada pelo usuário, o que é compatível com o usuário ter apagado o chat que parecia quebrado. Isso não é comprovável pelos logs. |

**Causa (código de C, `native-agent-delegations.mjs` → `dispatch`):**

```js
const reused = input.sessionMode !== 'new' && (...);  // false quando o modo é 'new'
const child = typeof reused === 'string' ? session(profile, reused) : reused;  // false
const targetSession = child ?? { /* sessão nova */ };  // `??` não substitui false
if (targetSession.agentId !== target.id) throw new Error('The linked session belongs to another agent.');
```

O patch foi pedido a C (mensagem `msg_65a09cf244ac`), e o coordenador confirmou que C está aplicando. A correção usa `reused = sessionMode === 'new' ? undefined : (...)` e mantém o erro somente quando uma sessão existente pertence a outro agente. **Essa foi a falha real do handoff.** Todo o resto deste documento é robustez adicional.

Não foram encontradas `production_runs` no perfil real: o fluxo do usuário em 0.3.60 foi chat genérico + delegação, sem a produção por conteúdo (que ainda não está instalada).

## 2. Robustez adicional implementada (frente B)

### 2.1 Recuperação honesta da thread (`src/features/chat/sessionRecovery.ts`, `ChatProvider.tsx`)

- A decisão nunca usa a idade do chat; vale apenas a resposta estruturada do bridge (contrato de A).
- Retomada com **410 `thread-missing`**, antes do envio:
  - abre uma thread nova e envia o histórico salvo uma única vez. O histórico é limitado (24 mil caracteres, mensagens mais recentes primeiro, com marcador de omissão) e diz explicitamente que ações passadas não devem ser repetidas;
  - o turno vai com `firstMessage=true`;
  - grava `previousCodexThreadId` e `threadRecoveries` (as últimas 5);
  - mostra no chat o aviso “Abri uma nova conversa no provedor… nada foi repetido automaticamente”.
  - Histórico, `contentId` e `productionContext` ficam intactos.
- Fallback textual, só para bridge antigo: `no rollout found for thread id`, `no persisted rollout`, `thread not found`, `No conversation found with session/thread ID` (Claude). As regras amplas antigas (`not materialized`, `unknown thread`, `thread…not found`) foram removidas.
- Nunca viram thread nova:
  - qualquer outro `code`, como `invalid-thread-id` (400) ou `thread-not-loaded`;
  - erros de `not loaded`, login/401/403, política, `setup refresh`, sandbox, `kernel reset`, rede, timeout e cota. Nesses casos aparece o erro real.
- Envio com **409 `thread-not-loaded`**: a recusa acontece antes de existir turno, então o app retoma a **mesma** thread e envia o mesmo turno uma única vez.
- Falha depois que o turno foi aceito (streaming caiu): a mensagem fica `interrupted`, sem reenvio automático e sem thread nova.

### 2.2 Novo chat do mesmo conteúdo (`contentSessions.ts`, `production/model.ts`, `ChatPanel.tsx`, `ContentSessionCard.tsx`)

- Um chat novo de um conteúdo cuja produção é conduzida em outra conversa recebe um snapshot **somente leitura** (`productionContext.conductedIn = 'main-session'`) com o vídeo e o contexto daquele conteúdo.
- O chat novo não recebe mensagens da produção, a thread de outro chat, dados de outro conteúdo nem de outro workspace.
- Se o conteúdo for remapeado ou a produção desaparecer, o snapshot é removido e o chat continua.
- O card mostra o vídeo gravado, a etapa e os botões **Abrir etapa atual** e “Abrir conversa da produção”.
- “Abrir etapa atual” e as intenções de produção digitadas no chat (`aprovo o vídeo`, `retomar produção`) abrem o **run real** pela sessão principal. Os comandos passam pelo coordinator, com `commandId`, evento `revise-video` e autoridade.
- Abrir uma sessão nunca inicia uma produção nem um formulário de início.
- O prompt do segundo chat proíbe delegar a edição por conta própria e dizer que o vídeo foi enviado.
- O snapshot passou a ser montado pela função pura `chatSessionSnapshot`, lida da sessão viva no momento do envio.
- O rótulo do handoff concluído virou “Especialista respondeu”: a resposta do especialista, e não o rótulo, diz se algum arquivo foi gerado.

### 2.3 Teclado e rascunhos (escopo adicional de 11/10)

- `FlowDialog`: pilha de diálogos abertos. Só o diálogo do topo reage a Escape e Tab, então um diálogo aninhado fecha sozinho.
- `SelectMenu`: com o menu aberto, o Escape é tratado na captura de `window`, antes de qualquer diálogo ou drawer. O primeiro Escape fecha o menu e devolve o foco ao gatilho; o diálogo só fecha no próximo.
- `AgentEditorDrawer`:
  - Tab e Shift+Tab ficam dentro do drawer, e o foco que estiver fora volta para dentro;
  - ao fechar (Escape, fechar, salvar ou excluir), o foco volta para o gatilho.
- Rascunhos de agente (`src/features/agents/agentDrafts.ts`):
  - ficam no estado persistente do perfil (chave `agent-drafts`), com escopo `[perfil, workspace, agent:<id> | new:<template>]`;
  - sobrevivem a fechar e reabrir o drawer e a reiniciar o app;
  - um rascunho de criação sempre usa o workspace atual;
  - o rascunho é removido quando o agente é salvo, quando as edições são desfeitas e quando o agente é excluído.
- Migração dos rascunhos legados (`sessionStorage`):
  - só é adotado o rascunho de um agente **existente**, sem workspace divergente;
  - os rascunhos legados de criação (`new` ou nome de template) eram compartilhados entre perfis e workspaces, por isso nunca são restaurados e expiram com a sessão da janela.

## 3. Validação

- `npx tsc -b`: ok.
- Testes focados: `tests/session-editing-recovery.test.mjs`, `tests/production-session-recovery.test.mjs`, `tests/content-session*.test.mjs` e `tests/agent-drafts.test.mjs` passaram.
- Suíte completa `node --test tests/*.test.mjs`: **567/567** (antes do freeze; a suíte e o build globais ficam com C).
- **Electron QA isolado** `scripts/test-session-recovery-ui.mjs`:
  - ambiente: renderer, SQLite e production coordinator reais; FFmpeg real com vídeo fixture `LinkedinSkills-fixture.mp4`; bridge de chat simulado com o contrato HTTP de A; editor CLI simulado;
  - sem IA, sem rede, sem Notion e sem publicação;
  - comando: `MAINSAGENTS_UI_DIST=.mainsagents-workspaces/qa-b-dist npx electron scripts/test-session-recovery-ui.mjs`;
  - resultado: `SESSION_RECOVERY_UI_OK`.

  O que foi verificado:
  1. 410: thread nova, histórico preservado, aviso visível, pedido enviado uma única vez e briefing só no primeiro turno.
  2. 409: a mesma thread é retomada e enviada uma única vez; nenhuma thread nova.
  3. Login e id inválido: erro real, thread mantida e nenhum turno.
  4. Stream perdido depois do envio: mensagem `interrupted` e nada reenviado.
  5. Restart: reabrir não repete nada e o chat recuperado retoma a thread nova.
  6. Chat novo do conteúdo com vídeo gravado:
     - o card reconhece o vídeo;
     - o payload leva o snapshot `conductedIn`;
     - a resposta do chat não edita nada;
     - “Abrir etapa atual” → “Enviar ajuste ao editor” chega ao **editor real** do mesmo run, com recibo `revise-video`, sem run duplicado e sem mensagens de produção vazando para o chat novo.
  7. Escape: no diálogo de produção, primeiro fecha o menu, depois o diálogo, e o foco volta ao gatilho.
  8. Escape também fecha primeiro o menu dentro do drawer de agente.
  9. Tab e Shift+Tab ficam contidos no drawer e o foco volta ao gatilho; os rascunhos são separados por workspace, mantidos depois de fechar e reabrir e restaurados depois do restart.

  Capturas: `.mainsagents-workspaces/session-recovery-ui/<timestamp>/`.
- Regressões Electron já existentes, todas OK com o mesmo bundle: `test-content-sessions-ui`, `test-agent-handoff-ui`, `test-chat-interaction-ui`, `test-refined-workspace-ui`, `test-provider-choice-ui` e `test-production-flows-ui`.

## 4. Limites exatos

- A correção do `sessionMode: 'new'` está no arquivo de C e só vale no app depois da integração, do pacote e da instalação feitos por C. A frente B não alterou esse arquivo.
- A recuperação automática depende do código `thread-missing` (410) entregue pelo bridge de A. Com o bridge 0.3.60 instalado, só o fallback textual comprovado funciona.
- Claude: `--resume` de uma sessão inexistente aparece só durante a execução (o CLI sai). Por isso não há recuperação automática nesse caso, já que o turno já foi aceito: o erro aparece e o usuário reenvia.
- O teste Electron de diálogos aninhados cobre menu dentro de `FlowDialog` e menu dentro do drawer. A pilha `FlowDialog` dentro de `FlowDialog` está garantida pelo código (pilha por módulo), mas não tem um cenário de UI alcançável no app atual.
- A troca de workspace no QA foi feita por `current-workspace` + reabertura do app, não pelo seletor visual. A separação por perfil é garantida pela chave e pelo store por perfil, e testada na unidade.
- A mensagem de C `Este conteúdo já tem uma produção em andamento. Continue por ela nesta sessão.` deveria indicar “na conversa principal deste conteúdo” quando a sessão não é a role session (pedido enviado a C). O chat novo não chega a esse caminho porque a UI não oferece início de produção.

## 5. Contrato para C (integração, pacote e QA final)

1. `native-agent-delegations.mjs`: aplicar o patch do `sessionMode: 'new'` com regressão (modo `new` com e sem job anterior ou conexão cria uma sessão nova do alvo herdando `contentId` e `topicId` da origem; `targetSessionId` explícito de outro agente continua recusado).
2. Arquivos da frente B, congelados:
   - `src/features/chat/{sessionRecovery.ts,ChatProvider.tsx,contentSessions.ts,model/Chat.ts,HttpCodexService.ts}`
   - `src/features/production/model.ts`
   - `src/components/chat/{ChatPanel.tsx,ContentSessionCard.tsx}`
   - `src/components/common/{FlowDialog.tsx,SelectMenu.tsx}`
   - `src/components/agents/AgentEditorDrawer.tsx`
   - `src/features/agents/agentDrafts.ts`
   - testes: `tests/{session-editing-recovery,production-session-recovery,agent-drafts}.test.mjs`
   - QA: `scripts/test-session-recovery-ui.mjs`
3. No pacote: rodar `scripts/test-session-recovery-ui.mjs` contra o `dist` final, junto com as regressões da seção 3.
4. Atualizado por C (11/10): `agent-drafts` entram no backup (`dataKeys`), validados no `parseBackup` e re-escopados ao perfil que importa; rascunhos de workspace/agente ausentes após a importação são descartados e, no modo mesclar, o rascunho atual vence no mesmo slot (`tests/agent-drafts.test.mjs`).
