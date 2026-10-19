# Exclusão local durável de um conteúdo inteiro (2026-10-15)

Task `task_b603ccf95491` · Dispatch `ctx_c12fe3658810` · implementação: Claude Code. Revisão independente com correções: `content-deletion-review-2026-10-15.md`. Desenho aprovado pelo coordenador no checkpoint (com ajustes).
Nenhum dado pessoal foi lido ou excluído: todas as provas usam fixtures em pastas temporárias. Sem commit, push, bump, NSIS ou instalação.

## Causa raiz dos chats que voltavam

1. `ChatProvider.deleteSession` removia o chat só da chave `sessions` e da sombra nativa (`agent_delegation_sessions`).
2. `ProductionProvider.refresh` roda a cada 1 s e chama `mergeProductionSessions`. Quando o id do chat não existe mais, a função faz `result.push(...)` com os shadows `sourceSession`/`editorSession`/`publisherSession` de `production_runs`. Por isso o chat reaparecia em cerca de 1 s.
3. Outros escritores também recriavam dados:
   - `put()` do coordenador de produção fazia INSERT quando a linha do run não existia mais, ou seja, um advance ou recibo tardio ressuscitava o run.
   - `patchSession` das delegações nativas recriava a sombra do chat.
   - O PUT editorial com 409 faz merge 3-way e podia reenviar o conteúdo.
   - Respostas de poll que começaram antes da exclusão.
4. A UI mostrava o toast "Conversa excluída" antes de o DELETE confirmar (`Sessions.tsx`).

## Desenho (o que é apagado, por id real)

Entidade: `EditorialContent` (perfil + workspace + `contentId`). Nada é decidido pelo título: dois conteúdos chamados "Linkedin" são independentes.

| Onde | O que sai |
| --- | --- |
| `state` (mesma transação) | `sessions` do conteúdo + chats de papel dos runs; ponteiros em `active-sessions`, `content-scopes` (a seleção volta para Geral), `production-flows` (sai só o `contentId` e o `sessionId` dos nós; o fluxo fica), `chat-drafts`, `studio-drafts` (chaves com id do conteúdo/run/chat/artefato) |
| `editorial_state` | o conteúdo, `artifacts`, `approvals`, `runs` editoriais, `assets` (só as referências), `publications` sem operação externa. Do tópico/pauta só sai o ponteiro `contentId`; a ideia continua |
| Produção | `production_runs`, `production_commands`, `production_authority`, `production_delegation_links` |
| Especialistas | `agent_delegation_jobs` e `agent_delegation_sessions` ligados aos chats do conteúdo |
| Outros | `content_srt_documents`, `editorial_jobs` e eventos, `workflow_work` e eventos, `editorial_media_jobs`, `runtime_actions`, `chat_publication_requests`/`intents`, `delivery_receipts`, `publication_intents`/`changes`, cache de `editorial_transcripts`/`silences`/`audio` das versões usadas só por esse conteúdo |

- **Fica intacto:** arquivos no disco (brutos, escolhidos, renders e exports; nenhum arquivo físico é removido), agentes, perfis, outros conteúdos, chats Gerais, Paper, Notion, contas, backups, e posts ou agendamentos externos.
- **Entregas externas confirmadas:** guardam só o fato mínimo em `deleted_content_delivery_facts` (provedor, conta, ids externos, chave de idempotência, hash do payload e status), sem texto. Nenhuma mutação remota é feita.
- **Sessão compartilhada** (chat de papel com outro `contentId`, ou chat Geral com histórico próprio usado pela produção): a exclusão é bloqueada com o motivo, e nada é apagado.

## Anti-ressurreição durável

Tombstone só com ids:
- `content_tombstones(profile, content, status purging|deleted)`;
- `content_tombstone_ids(kind session|run|artifact)`;
- `content_deletion_requests`, para idempotência por `requestId`.

As guardas abaixo garantem que filtrar a UI não é o único mecanismo:

- **Triggers SQLite** (`ensureContentFenceTriggers`) em `production_runs`, `agent_delegation_sessions`, `agent_delegation_jobs`, `content_srt_documents`, `editorial_media_jobs`, `workflow_work`, `editorial_jobs` e `delivery_receipts`. Depois da exclusão, o trigger recusa qualquer INSERT para o conteúdo ou os ids. Durante `purging`, recusa linhas novas e também qualquer linha existente que volte de inativa para ativa (retry, resume ou re-queue), seja por INSERT OR REPLACE, seja por UPDATE. Acks de cancelamento, estados terminais e o progresso de um trabalho que está sendo parado continuam passando (ajustado na revisão).
- **Trigger em `editorial_state`** (INSERT e UPDATE): recusa qualquer estado que contenha o conteúdo excluído ou registros dele. Isso cobre qualquer escritor que tenha lido o estado antigo.
- **State store** (`desktop-state-store.mjs`): toda escrita das chaves ligadas passa pelo sanitizador (`content-deletion-model.mjs`). Uma cópia stale do renderer ou de outra janela nunca regrava os chats. A revisão pré-exclusão de cada chave fica aceita como alias, então um write em voo não gera um falso erro "Newer saved data exists". O alias só vale até a primeira escrita depois da exclusão (ajustado na revisão).
- **Código:**
  - `put()` da produção recusa recriar um run apagado;
  - `patchSession` das delegações não recria a sombra;
  - `dispatch`/`manual` recusam chat cercado;
  - `binding()` do bridge devolve null para chat cercado, então não há ação de ferramenta, agendamento nem delegação.
- **PUT editorial stale:** remove os registros do conteúdo excluído e o ponteiro do tópico antes da checagem de operações do provedor, e devolve `stripped:true`. O cliente então adota o estado salvo (`EditorialStateClient`).
- **Renderer:**
  - `PersistentState.adopt` troca as chaves pelos valores que o host já gravou, sem regravar;
  - um filtro descarta ids excluídos em qualquer update local;
  - `ProductionProvider` descarta respostas de poll iniciadas antes da exclusão (contador de geração) e filtra runs excluídos;
  - `ChatProvider` aborta e esquece os chats;
  - `ContentWorkflowProvider` faz resync.
- **Reiniciar ou reabrir:** os dados não existem mais no SQLite, e os triggers e tombstones persistem.

## Fluxo da exclusão (`content-deletion.mjs`, IPC `content:deletePreview` / `content:delete`)

1. **Preview** (só leitura, não cancela nada): contagens por id, busy (trabalho local) e blockers (externo ou compartilhado). Inclui um fingerprint dos ids.
2. **Confirmação única.** O renderer faz `saveNow()`. Se houver resposta de chat em voo no renderer, ele aborta e espera a parada confirmada (até 10 s); se não confirmar, recusa.
3. **Host:**
   - valida o perfil ativo, o sender (janela principal e frame principal) e o fingerprint (preview stale → 409, revise de novo);
   - verifica blockers e busy (trabalho local só é parado se a pessoa confirmou com trabalho listado);
   - grava o tombstone `purging`, que bloqueia novos trabalhos;
   - pede a parada pelo cancel próprio de cada trabalho (produção `cancel`, delegação, export de mídia, work, Notion na fila, transcrição SRT, ação pendente). Nada é morto à força;
   - espera até 15 s por estado terminal confirmado. Um callback ignorado não conta como parada;
   - revalida o perfil e o fingerprint depois de cada await;
   - faz uma única transação atômica `BEGIN IMMEDIATE` que apaga tudo, muda o tombstone para `deleted` e registra o pedido.
4. **Falha ou timeout:** o tombstone `purging` é removido e os dados ficam. O erro aparece no diálogo, sem falso sucesso. O que foi cancelado fica cancelado, e isso é dito na mensagem.
5. **Idempotência:** o mesmo `requestId` repete o resultado; um conteúdo já excluído responde `alreadyDeleted`.

Bloqueiam sempre:
- operação de publicação `requesting`/`uncertain` ou `status: sending`;
- pedido de agendamento do chat `running`/`uncertain`;
- produção em `scheduling`.

O diálogo explica cada caso, e nada é cancelado nem publicado remotamente.

## Ações de UI exatas (sem passar pelo Fluxo)

- **Chat, caixa do conteúdo** (`ContentScopeBar`): botão "…" (`Ações de “<título>”`) ao lado de "+" → item "Excluir conteúdo e conversas…".
- **Sessões:** botão "…" em cada caixa de conteúdo (irmão do botão da caixa, não aninhado) → mesmo item.
- **Estúdio:** "…" no cabeçalho do card do conteúdo → mesmo item.
- **Diálogo** (`ContentDeletionDialog`, sobre `FlowDialog`):
  - título "Excluir “<título>”?";
  - "Sai do MainsAgents": N conversas, com contagem por agente, produções, SRT, registros, rascunhos e ponteiros;
  - frase "Fica intacto: arquivos no disco (gravações brutas, vídeos exportados e renders)… Nada é cancelado no provedor.";
  - lista "Em andamento agora" quando houver trabalho;
  - blockers em `role=alert`;
  - foco inicial em **Cancelar**; Esc cancela; foco preso no diálogo;
  - botão destrutivo "Excluir conteúdo e N conversas", ou "Parar trabalhos locais e excluir" se houver trabalho; mostra "Excluindo…" com `aria-busy` e trava Cancelar/Esc enquanto a requisição está em voo;
  - em erro: mensagem inline e "Tentar novamente".
- **Depois de excluir:** a seleção vai para Geral e o anúncio é "“X” e N conversas excluídos deste computador" (toast e `role=status`). O foco vai para o seletor de conteúdo (chat), para a caixa Geral (Sessões) ou para o aviso (Estúdio).
- **Excluir UM chat** (Sessões e aba Sessões do chat):
  - chat comum: o host remove e cerca o id (fence durável); o toast só aparece depois da confirmação, e o erro fica inline;
  - chat que conduz a produção: a UI troca a ação por "Esta conversa conduz a produção deste conteúdo… Excluir conteúdo inteiro…", que abre o mesmo diálogo;
  - busy: mensagem visível, nunca retorno silencioso.

## Provas

- `tests/content-deletion.test.mjs` (SQLite real, um único arquivo compartilhado entre state store e bridge, como no app):
  - exclusão completa por id;
  - B, C, chats Gerais (inclusive com títulos "Linkedin" iguais), agentes e o perfil "other" ficam byte-a-byte iguais;
  - o arquivo bruto não é tocado;
  - fato mínimo sem texto;
  - idempotência.
- O mesmo arquivo testa a anti-ressurreição:
  - 5 polls reais de `production.list` mais `mergeProductionSessions`;
  - resposta de refresh antiga mais snapshot nativo antigo gravados pelo store;
  - inserts tardios de run, SRT, recibo, sombra e job recusados;
  - `UPDATE editorial_state` com estado antigo recusado;
  - reabrir o bridge e o store.
- PUT editorial stale (409 e depois `stripped`).
- Recusas: preview stale, perfil trocado, workspace errado, pedido inválido, chat de papel compartilhado com outro conteúdo, operação externa incerta. Nada muda e nenhuma tombstone sobra.
- Busy:
  - recusa sem a confirmação de parar;
  - recusa com chat do renderer respondendo;
  - parada parcial sem confirmação recusa e preserva os dados (o SRT foi cancelado de verdade e a exportação sem executor não);
  - depois de terminal, a exclusão passa.
- SRT standalone (conteúdo sem produção).
- Chat avulso durável; chat de papel → `production-role`.
- Os papéis source, editor e publisher, incluindo o publisher que só existe no run.
- `tests/content-deletion-renderer.test.mjs`: `PersistentState.adopt` não regrava, e o filtro descarta chats excluídos que um poll de produção tenta recriar.
- `scripts/test-content-deletion-ui.mjs` (Electron real com `desktop-preload.cjs` real, IPC sender-bound, SQLite e bridge reais; renderer de build isolado em `.mainsagents-workspaces/content-deletion-dist`):
  - Teclado: "…" → item → diálogo; foco em Cancelar; Esc não muda nada (`readAll` idêntico).
  - Exclusão de A ("Linkedin", 4 chats em 2 agentes e 1 produção): resta só B "Linkedin"; seleção em Geral; foco no seletor; o rascunho de B fica.
  - Depois de 3,5 s de polls, nada voltou.
  - Em Sessões, o chat de produção de C mostra a orientação e o diálogo de C (1 documento SRT) exclui C.
  - Foco na caixa Geral; anúncio em `role=status`.
  - Chat Geral comum excluído só após confirmação, e não volta.
  - Tema escuro com janela de 420 px: sem overflow horizontal, foco preso, Esc cancela.
  - Reiniciar store, bridge e janela: A e C continuam ausentes; o bruto não foi tocado.
  - Nenhum erro de console.
  - Capturas: `01-scope-bar-light`, `02-dialog-light`, `03-after-delete-light`, `04-role-chat-guidance`, `05-dialog-dark-narrow`, `06-after-restart`.

## Limitações v1

- Nenhum arquivo físico é removido (renders e exports gerados pelo app continuam no disco). O diálogo diz isso.
- Backups (`backups/workspace-*.json`, exportações) continuam com os dados antigos. Restaurar um backup desses **funciona** (revisão de 2026-10-15): o app restaura todo o resto e deixa de fora apenas o que foi excluído neste computador. Configurações avisa quantos conteúdos e conversas continuaram excluídos. As tombstones não são limpas no restore (decisão do coordenador). Para trazer de volta um conteúdo excluído de propósito, seria preciso um escopo de ids próprio.
- Entregas externas confirmadas não são mais reconciliadas pelo app depois da exclusão. Fica só o fato mínimo, e o calendário do provedor continua mostrando o post.
- A exclusão completa existe só no app desktop (no modo navegador o diálogo avisa).
- Uma ação de ferramenta já aprovada ou rodando no CLI não é interrompida à força: a exclusão espera até 15 s e depois recusa de forma recuperável.
- Análises de referência (`inspiration_analyses`) são do tópico ou referência, não do conteúdo, e não são tocadas.

## Arquivos

**Novos:**
- `content-deletion.mjs`, `content-deletion-model.mjs` (+ `.d.mts`), `content-deletion-ipc.mjs`;
- `src/features/content/contentDeletion.ts`;
- `src/components/content/ContentDeletionDialog.tsx`, `src/components/content/ContentActionsMenu.tsx`;
- `src/styles/content-deletion.css`;
- `tests/content-deletion.test.mjs`, `tests/content-deletion-renderer.test.mjs`;
- `scripts/test-content-deletion-ui.mjs`;
- este documento.

**Alterados:**
- `content-workflow-bridge.mjs`, `production-coordinator.mjs`, `native-agent-delegations.mjs`, `content-srt.mjs`, `desktop-state-store.mjs`, `desktop-main.mjs`, `desktop-preload.cjs`;
- `package.json` (só a lista `build.files` com os 3 módulos novos; sem bump);
- `src/app/desktop.d.ts`, `src/data/PersistentState.ts`, `src/data/localPersistence.ts`;
- `src/features/content/EditorialStateClient.ts`, `src/features/content/ContentWorkflowProvider.tsx`;
- `src/features/chat/ChatProvider.tsx`, `src/features/production/ProductionProvider.tsx`;
- `src/components/chat/ContentScopeBar.tsx`, `src/components/chat/ChatPanel.tsx`;
- `src/pages/Sessions.tsx`, `src/pages/ContentStudio.tsx`.
