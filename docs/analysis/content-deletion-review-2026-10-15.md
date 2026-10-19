# Revisão independente: exclusão local de conteúdo (2026-10-15)

Task `task_3f27e5d7d37c` · Dispatch `ctx_69d24550c5be` · revisor: Claude Code. Entrega revisada: `docs/analysis/content-deletion-2026-10-15.md`.
Li o código novo e os pontos integrados (store, bridge, coordenador, delegações, IPC/preload, providers e restore), em vez de só aceitar o relatório. Todo o QA rodou em fixtures temporárias. Nenhum dado real, vídeo, modelo ou Claude CLI foi tocado, e não houve mutação externa, commit, bump, NSIS nem instalação.

## Achados corrigidos

1. **Regressão de backup (grave).** Qualquer backup feito antes de uma exclusão ficava impossível de restaurar.
   - Causa: `restoreWorkspace` grava `editorial_state` com INSERT OR REPLACE, e o trigger recusava o estado inteiro com uma mensagem em inglês. O mesmo acontecia nos modos substituir e mesclar, e também com runs, sombras ou jobs do conteúdo excluído no `execution`.
   - Além disso, a chave `sessions` era gravada sem passar pelo sanitizador. Um chat Geral excluído sozinho podia voltar pelo restore.
   - Correção: `stripDeletedFromRestore` (`content-deletion.mjs`), chamada dentro da transação do restore. Ela tira do backup só o que foi excluído neste computador: conteúdo, artefatos, aprovações, runs, assets, publicações, o ponteiro do tópico, chats, ponteiros, rascunhos, produções, sombras, jobs, ações, exportações e work. Todo o resto é restaurado normalmente.
   - As tombstones não são limpas e os triggers continuam ativos.
   - `restoreWorkspace` agora devolve `omittedDeleted`. A tela Configurações → Dados e backup avisa: "Backup importado. N conteúdo(s) e M conversa(s) que você excluiu neste computador continuam excluídos e não foram restaurados", e recarrega depois de 6 s.
   - Não criei nenhum sistema novo de restore.
2. **Trabalho novo durante `purging` por UPDATE ou REPLACE.** Os triggers eram só BEFORE INSERT e liberavam qualquer REPLACE de uma linha existente. Um retry (`completed→queued`), um resume da produção pelo `put()` ou um UPDATE direto reativavam trabalho enquanto a exclusão esperava as paradas.
   - Agora, durante `purging`, é recusada a transição de inativo para ativo, tanto em INSERT OR REPLACE quanto em BEFORE UPDATE. Isso vale para `production_runs` (estágio), `agent_delegation_jobs`, `editorial_media_jobs`, `workflow_work`, `editorial_jobs` (status) e `content_srt_documents` (`job.status`).
   - Continuam passando os acks, os estados terminais e o progresso de um trabalho que já estava rodando e está sendo parado.
   - Depois de `deleted`, UPDATE não é bloqueado, porque as linhas do conteúdo já não existem. Isso evita quebrar a atualização de registros antigos que só citam um chat avulso excluído.
3. **PUT editorial stale com entrega confirmada do conteúdo excluído.** A checagem de operações do provedor rodava antes do strip, e a janela antiga recebia 409 "Provider operations can only change…" em vez de ser saneada.
   - Agora o strip vem antes da checagem e usa o helper puro compartilhado `stripDeletedEditorial` (`content-deletion-model.mjs`). Ele também tira o ponteiro `contentId` do tópico, que o PUT antigo deixava voltar.
4. **Alias CAS sem expiração (ABA).** O alias `from→to` da revisão anterior à exclusão valia para sempre. Se a chave voltasse ao valor exato pós-exclusão, um write stale com a revisão antiga seria aceito.
   - Agora o alias vale só até a primeira escrita depois da exclusão. Um write stale nunca sobrescreve alteração nova, de outro conteúdo ou não.
   - Também troquei o separador NUL literal da chave do alias por `\u0000`: o arquivo voltou a ser texto, e o grep parou de tratá-lo como binário. O comportamento é o mesmo.
5. **Fingerprint não cobria trabalho novo.** Um job de Notion, work, exportação, ação de ferramenta ou pedido de agendamento criado depois da revisão era parado sem que a pessoa o tivesse visto.
   - Agora os ids desses registros entram no fingerprint, e o pedido volta como `stale`.

6. **Exclusão interrompida por crash travava o conteúdo para sempre** (continuação: task `task_ce796aab3c73`, dispatch `ctx_6354b0f4a963`).
   - Causa confirmada: o `purging` é durável, mas só o `finally` do processo que criou a cerca a removia. Se o processo morresse entre a cerca e o commit (crash, fechamento ou falta de energia), a prévia respondia "já em andamento" para sempre, e o trabalho novo daquele conteúdo continuava bloqueado pelos triggers.
   - Correção conservadora: `recoverAbandonedDeletions` (`content-deletion.mjs`) só é chamada pela bridge quando recebe `hostExclusive:true`. Só o `desktop-main` passa essa opção, dentro de `createWindow`, que só roda depois do `requestSingleInstanceLock`. A chamada acontece logo após abrir o banco e antes de criar qualquer worker, ou seja, antes da recuperação ou admissão de jobs.
   - A recuperação remove apenas as tombstones `purging` e os ids ligados a elas, e preserva qualquer purge vivo neste processo (registro em memória `livePurges`, por `requestId`).
   - Ficam como estão:
     - os dados locais (o commit nunca rodou e era atômico; um crash dentro do commit faz rollback);
     - as tombstones `deleted`;
     - os chats excluídos avulsos;
     - o que foi cancelado, que continua cancelado.
   - Nada é concluído automaticamente nem relançado (a produção já volta em `paused` pelo próprio recover dela). Operações externas incertas continuam bloqueando na nova prévia, porque `collect` não mudou.
   - `ensureContentFences`, uma segunda conexão, o state store, o `dev.mjs` e os scripts nunca limpam `purging`. Timeout nenhum é tratado como "processo morto".
   - Provas (`tests/content-deletion.test.mjs`):
     - Crash real: um processo filho roda o código de exclusão do app e morre (`process.exit`) com o `purging` gravado. Depois disso, outra bridge comum abre o banco e o `purging` continua, com a prévia "em andamento". A instância autorizada (`hostExclusive`) libera a cerca.
     - Depois da liberação: o conteúdo, os chats, o run e o SRT de A continuam; C, excluído antes, continua `deleted` e recusando inserts tardios; a nova prévia funciona e a exclusão confirmada vai até o fim.
     - Purge vivo: um segundo store, uma bridge comum e até uma bridge `hostExclusive` no mesmo processo não derrubam a cerca, e o trabalho novo continua recusado. Só o próprio purge solta a cerca ao terminar (timeout → `busy`, dados mantidos).
   - typecheck ok, `check-build-files` ok, suíte completa **752/752**.
   - Limitação: um host que não seja o `desktop-main` (`dev.mjs` ou script) não recupera sozinho. Basta reabrir o app desktop.

## Verificado sem alteração

- **Alias CAS:** só é aceito se a chave não mudou desde a exclusão, ou seja, se a revisão atual é igual a `to`. Uma escrita de outro conteúdo feita depois disso invalida o alias.
- **Callbacks e polls antigos:**
  - contador de geração em `ProductionProvider` e `ChatProvider`;
  - filtro `deletedLocally`;
  - `adopt` sem regravar;
  - `put()` recusa um run sem linha;
  - `patchSession` não recria a sombra;
  - `binding()` devolve null.
- **Timeout:** `unfence` só remove a tombstone que tem o mesmo `requestId` e status `purging`. Os dados ficam, e não há falso sucesso. Um duplo clique cai em 409 sem desfazer a cerca do primeiro pedido.
- **Perfil e workspace:** `profileCheck` roda depois de cada await. `collect` revalida o `workspaceId` do conteúdo antes de cancelar e antes do commit. O commit é síncrono em `BEGIN IMMEDIATE`.
- **Escopo:** sessões Gerais, compartilhadas, de outro perfil ou com o mesmo título continuam intactas (teste byte a byte existente). `requestId` usado para outro conteúdo → 409.
- **Externo:** `requesting`/`uncertain`/`sending`, agendamento do chat em andamento e produção em `scheduling` bloqueiam. O fato mínimo não guarda texto.
- **Infra:**
  - `build.files` contém os 3 módulos, e `check-build-files` não acusa módulo faltando (98);
  - os triggers são idempotentes (DROP+CREATE a cada abertura) e pulam tabelas que ainda não existem;
  - as duas conexões SQLite no mesmo arquivo usam WAL, com transações síncronas que não atravessam await.

## Evidências

- Testes novos em `tests/content-deletion.test.mjs`:
  - restore de backup anterior à exclusão nos modos substituir e mesclar: resta só B, `omittedDeleted`, a tombstone persiste e um insert tardio continua recusado;
  - PUT stale com entrega confirmada válida → 200 `stripped`, sem ponteiro de tópico;
  - durante `purging`: o ack passa; retry, resume via REPLACE e UPDATE para ativo são recusados; outro conteúdo não é afetado;
  - alias aceito uma única vez, e a ABA é recusada;
  - trabalho criado depois da revisão → `stale`, e a ação continua `pending`.
- `npm run typecheck`: ok. Suíte completa, rodada uma vez ao fim: **750/750** (745 anteriores + 5 novos).
- Electron isolado (`scripts/test-content-deletion-ui.mjs`, renderer em `.mainsagents-workspaces/content-deletion-review-dist`): todos os passos anteriores (claro, escuro, 420 px, reinício) mais um passo novo de restore.
  - O passo novo importa pelo próprio Configurações → Substituir dados locais um backup exportado antes das exclusões. A mensagem aparece em `role=status` (captura `07-restore-explained`).
  - Depois do reload, sobram apenas `b-editor`, `b-source` e `general`; o editorial tem só `content-b`; não há produções; as tombstones A e C continuam `deleted`.
  - Nenhum erro de console.
  - Ajustes do fixture do script: a aresta do fluxo ganhou `kind:'sequence'` (sem isso o backup não passava na validação), e foram adicionados stubs de `account:*` e os handlers de backup iguais aos do `desktop-main`.

## Limitações reais (sem mudança nesta fase)

- O fingerprint não muda quando uma produção que já existe muda de estágio (o id é o mesmo). Se ela começar a rodar depois da revisão, é recusada como busy, salvo se a pessoa tiver escolhido parar os trabalhos locais.
- `runtime_actions` e `chat_publication_requests` não têm trigger. Novas linhas para chats cercados são impedidas pelo `binding()` nulo.
- Excluir um chat avulso não apaga jobs, ações ou pedidos já terminados que citam esse chat. Ficam como registros de auditoria e não ressuscitam o chat.
- A mensagem do restore fica visível por 6 s antes do reload automático. Nesse intervalo os botões de importar ficam desativados.

## Release local 0.3.71

Entregue e instalada nesta máquina em 2026-10-16. Instalador SHA-256 `2d719393…d25496`; `app.asar` release = instalado (`dda04c2b…9cea`); dados antes/depois idênticos, exceto as 4 tabelas novas e vazias. Detalhes em `content-deletion-release-2026-10-15.md`.
