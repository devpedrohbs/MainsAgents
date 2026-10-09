# Integração da rodada de conteúdo (F02–F05 sobre F01/F06)

Despacho `task_6ddd05456c81` / `ctx_43f82fbe4bb6` (Claude Opus), 2026-10-07. Não houve commit, tag, reinstalação, NSIS, chamada real de IA, Notion ou publicação, nem uso do perfil pessoal.

## Fluxo no app

Ideia → **roteiro (script-review)** → Notion confirmado → **gravação com pacote de gravação** → importar → edição → aprovar vídeo → redes → legendas (IA de texto) → **capas locais (covers-review)** → aprovar pacote → agendar.

Na aba **Estúdio → Referências** fica a biblioteca de referências. “Usar como briefing” preenche a nova pauta sem criar tópico e sem chamar IA.

## 1. Pacote de gravação (F02)

O `RecordingPackage` aparece no estágio `recording` quando `recordingReady` é verdadeiro, ou seja, roteiro aprovado e Notion confirmado na mesma versão e hash.

**Persistência**
- O comando `recording-prep {version,hash,checklist?,suggestions?}` é validado no servidor: estágio `recording`, gate F01 e versão/hash iguais aos da aprovação.
- As chaves do checklist e os campos das sugestões seguem uma lista fechada.
- O estado fica em `run.recordingPrep`: por perfil, workspace e produção, ligado a versão e hash do roteiro.
- Mudar o roteiro ou o hash zera o estado: o componente ignora o antigo e o servidor recusa gravar para outra versão.
- Marcar itens não gera eventos na auditoria. As sugestões são gravadas com debounce de 800 ms.
- O componente ganhou a prop `suggestions`, que restaura as edições salvas.

**Importar vídeo** é um callback real:
1. abre o seletor nativo (`files:select`), que inspeciona e calcula o hash;
2. associa o arquivo como `source` (`attachFiles`);
3. seleciona o vídeo para a edição.

No navegador, sem a API desktop, o botão apenas foca o seletor de vídeo existente.

**Backup**: o backup restaura `recordingPrep`, mas a produção importada não tem autorização de execução. Os comandos são recusados e a rota de capas também.

## 2. Biblioteca de referências (F05)

- O estado fica em `EditorialState.inspiration` (`{schemaVersion:1,references[]}`), na SQLite do perfil, pelo `PUT /api/content/state` existente com `revision`.
- A validação no servidor é nova, em `editorial-inspiration.mjs`, com lista fechada de chaves. Ela é aplicada em três lugares:
  - na rota de state;
  - no `restoreWorkspace` desktop;
  - no `parseBackup`.
- O que a validação recusa:
  - qualquer campo extra, como `path` ou flags de execução;
  - URL que não seja http(s) ou que contenha credenciais;
  - `metadataStatus` diferente de `not_collected`;
  - ids duplicados;
  - asset de outro workspace ou que não seja vídeo.
- Um asset removido é aceito e aparece como indisponível.
- No backup em modo merge, as referências são unidas por id e a cópia atual prevalece; no modo replace, o backup inteiro é mantido.
- `studio-view: 'references'` passou a ser aceito no backup. Antes deste ajuste, um backup feito com essa aba aberta seria rejeitado.
- A UI é o `InspirationLibrary` sem alterações. O provedor ganhou `saveInspiration`, que passa por `parseInspirationState` antes do commit.

## 3. Capas locais (F03 + F04) como padrão para Codex e Claude

**Estágio novo `covers-review`**, depois de `preparing-package` (legendas) e antes de `package-review`. O `generating-cover` por IA saiu do fluxo.

| Comando | Regras no servidor |
|---|---|
| `cover-render {format,concepts,brand}` | Uma exportação por vez. Valida pelo motor (`validateThumbnailRequest`). O quadro precisa estar dentro do vídeo aprovado. O logo só pode vir por `logoAssetId`: imagem da biblioteca deste conteúdo, verificada por sha256 e com caminho resolvido no servidor; caminho vindo do cliente é recusado. Gera um lote com 3 conceitos por formato, assíncrono, com `render.status` = `running`, `done`, `failed`, `canceled` ou `interrupted`. |
| `cover-cancel` | Aborta o FFmpeg; o motor não entrega lote parcial. |
| `approve-covers {authorize,destinations,selections,concepts,brand}` | Ver lista abaixo. |

O `approve-covers` só passa quando:
- `destinations` corresponde exatamente a `p.platforms`;
- cada formato tem uma seleção do **lote atual** (`batchId`);
- os conceitos e a marca enviados geram o mesmo `inputsHash` do lote, o que recusa aprovação suja;
- a fonte do lote é o vídeo aprovado;
- o sha256 de cada arquivo escolhido é confirmado.

Depois disso, ele cria as entregas com `coverAssetId` exato e passa a `package-review`. O `approve-package` confere que a capa de cada entrega é a capa aprovada.

**Regras adicionais**
- **Repetição com entradas idênticas**: reaproveita o lote já registrado depois de verificar os hashes, sem renderizar de novo.
- **Lote já em disco** (`output_exists`, quando o batchId é determinístico): relê o `manifest.json`, verifica fonte e hashes e reutiliza o lote, sem apagar nem sobrescrever.
- **Resultados atrasados são descartados.** Isso cobre cancelamento, outro render, troca de vídeo ou de estágio. O app reaberto marca a exportação como `interrupted` e nunca a retoma sozinho.
- **Vídeo novo aprovado** (por `revise-video`) reinicia a galeria. Pedir novas legendas mantém os lotes, mas exige nova aprovação.

**Rota protegida** `GET /api/content/productions/:id/cover?profile&assetId&versionId`:
- serve só capas exportadas por esta produção ou entregues por ela, do perfil atual e do mesmo conteúdo e workspace;
- os bytes passam por sha256 antes de sair;
- recusa produções importadas de backup.
- A galeria e a prévia do pacote usam essa rota. A prévia antes usava o IPC `files:preview`, que falhava com chamadas concorrentes.

**Legado**
- Produções em `generating-cover`, inclusive pausadas nesse estágio, migram para `covers-review` e exigem seleção.
- `package-review`, agendadas e concluídas são preservadas sem reenvio (`migrateCoverGate`, idempotente).

**IA de imagem**: não existe chamada automática. Não há UI de imagem por IA opcional, então nenhuma foi mantida. O hook `renderLocalCover` de F01/F06 foi removido e substituído pelo gate.

**UI**: `src/components/production/CoversReview.tsx` (novo) envolve o `ThumbnailGallery` (F04):
- um lote por formato; digitar não renderiza nada;
- marca editável: tema, cor de destaque e logo da biblioteca;
- formato por rede, com padrão Instagram Reels / TikTok / feed 4:5 para LinkedIn;
- aprovação local por formato e confirmação final.
- O rascunho é salvo nos drafts do Estúdio por produção e fonte.

**Preflight**: o check `cover-generation` agora fala de capas locais (FFmpeg, sem IA) para qualquer provedor. Com `probeMedia`, ele usa `getThumbnailCapabilities` e emite `warning` se faltar filtro ou fonte. Não sai mais aviso de “Claude não gera imagem”.

## 4. Progresso, overview e i18n

- `covers-review` foi adicionado em labels, fases de progresso, etapas de usuário, próxima ação (pt/en) e `ExecutionOverviewProjection`.
- O texto do estágio de redes explica as legendas por IA e as capas locais sem IA.

## Testes

- **Focados, `tests/production-coordinator.test.mjs`: 19/19**, com FFmpeg real e o motor F03. O teste principal de Codex agora passa por `script-review` e `covers-review` e usa o helper `toPackage`. Testes novos:
  - pipeline Claude com capas locais e zero chamadas de imagem;
  - gate de capas: nada antes do export; campo inválido, caminho de logo e logo não-imagem recusados; reuso idêntico; batch forjado, aprovação suja, marca alterada e rede faltando recusados; rota de capa com hash e escopo; pacote com a capa exata; `approve-package`;
  - cancelamento, reinício (`interrupted`) e resultado atrasado descartados; lote em disco reaproveitado (`output_exists`); entradas novas geram novo lote; lote antigo recusado; vídeo novo reinicia;
  - `recording-prep` persistido, validado e invalidado pela mudança do roteiro; backup sem execução; migração legada de capas e concluídas preservadas;
  - validação da biblioteca no servidor.
- `tests/production-preflight.test.mjs`: 10/10.
- `tests/content-flow-backup.test.mjs` (novo): 2/2. Cobre o round trip do backup, a aba `references` e a recusa de caminho, execução, outro workspace e schema errado.
- **Suíte global (`npm test`, uma vez): 388/389.**
  - A falha é `editorial-thumbnails.test.mjs › cancelamento com FFmpeg em execução…`, do dono F03. Ela passa isolada (3,1 s), o que indica dependência de tempo sob carga paralela.
- `tsc -p tsconfig.app.json` e `tsconfig.node.json`: limpos. `vite build` foi gerado em `dist`, sem NSIS nem instalador.
- **Electron (renderer real, SQLite, FFmpeg, Whisper `ggml-base` disponível; IA, Notion e provedores simulados)**:
  - `scripts/test-content-flow-integration-ui.mjs` (novo): `CONTENT_FLOW_UI_OK`.
    1. Referência salva e usada como briefing, sem IA.
    2. Roteiro gerado pelo agente Claude simulado, editado para v2 e aprovado; Notion uma vez.
    3. Checklist persistido.
    4. Importação pelo botão do pacote; edição automática.
    5. Três capas locais por formato exportadas pela UI e aprovadas por rede, com zero chamadas de IA.
    6. Pacote com a capa exata; reabertura sem duplicar.
  - `scripts/test-semi-production-ui.mjs`: ajustado aos gates (aprova o roteiro; exporta e aprova a capa local; confere zero IA nas capas), mantendo os demais checks. Passa. Aceita `MAINSAGENTS_UI_DIST`.
  - `test-production-flows-ui`, `test-flow-execution-ui` e `test-execution-overview-ui`: OK.
- **Screenshots** em `.mainsagents-workspaces/content-flow-integration-ui/1791422892969/`:
  - `01-references`
  - `02-briefing-filled`
  - `03-script-review`
  - `04-recording-package`
  - `05-covers-review`
  - `06-covers-exported` (capas reais renderizadas)
  - `07-package-review`

## Empacotamento

`package.json build.files` passou a incluir `production-runtime.mjs`, `production-script.mjs`, `production-covers.mjs`, `editorial-thumbnails.mjs` e `editorial-inspiration.mjs`. Uma checagem por grafo de imports a partir de `desktop-main.mjs` não encontrou nenhum módulo faltando.

O motor usa uma fonte do sistema (Windows: Segoe UI Bold). Não há fonte empacotada.

## Limites

- A galeria F04 fica em uma coluna dentro do diálogo estreito, então os três conceitos exigem rolagem. O layout lado a lado fica com o dono F04.
- A prévia do conceito é CSS. A capa real só aparece depois de “Exportar”; não há quadro extraído por tecla, por decisão de custo. `suggestCandidateFrames`/`extractFramePreview` não foram ligados.
- O formato padrão do LinkedIn é `instagram-feed-4x5` e o usuário pode trocá-lo. As guias de rede do motor continuam `guidance-unverified`.
- O card “Uso de IA” ainda diz “o Codex CLI não informa esse uso”, mesmo quando o agente é Claude. É texto pré-existente do `ProductionBudget`.
- A opção de IA de imagem foi intencionalmente deixada de fora.
- Adições opcionais anunciadas pelo F03 (`source.display`, `frameTimestampSeconds`) não são necessárias. Um `invalid_concepts` sem frame decodificável aparece como erro da exportação.

## Arquivos

**Novos**
- `production-covers.mjs`
- `editorial-inspiration.mjs`
- `editorial-inspiration.d.mts`
- `src/components/production/CoversReview.tsx`
- `scripts/test-content-flow-integration-ui.mjs`
- `tests/content-flow-backup.test.mjs`
- `docs/analysis/content-flow-integration-report.md`

**Alterados**
- Backend:
  - `production-coordinator.mjs`
  - `production-preflight.mjs` e `production-preflight.d.mts`
  - `content-workflow-bridge.mjs` (rota de capa e validação da biblioteca)
  - `desktop-state-store.mjs` (validação no restore)
  - `package.json`
- Renderer:
  - `src/features/production/model.ts`
  - `src/features/production/productionProgress.ts`
  - `src/components/production/ExecutionOverviewProjection.ts`
  - `src/components/production/ProductionDialog.tsx`
  - `src/components/production/RecordingPackage.tsx` (prop `suggestions`)
  - `src/features/content/ContentWorkflowProvider.tsx`
  - `src/features/content/model.ts`
  - `src/pages/ContentStudio.tsx`
  - `src/data/backup.ts` e `src/data/backupFormat.ts`
- Testes e scripts:
  - `tests/production-coordinator.test.mjs`
  - `tests/production-preflight.test.mjs`
  - `scripts/test-semi-production-ui.mjs`

Não editei `editorial-thumbnails.*`, `inspiration.ts` nem `InspirationLibrary.tsx`.

## Correções para DONE (despacho `task_e69930935536` / `ctx_40d3f72becfa`)

### 1. Falha global de cancelamento do FFmpeg (`editorial-thumbnails`): causa encontrada e corrigida no motor

- **Erro exato**: sob carga paralela (6 execuções simultâneas), 4 de 6 falharam com `EBUSY: resource busy or locked, rmdir '…/.thumbs-….partial/product'`.
- **Causa**: o `runProcess` rejeitava com `cancelled` assim que recebia o abort, antes de o FFmpeg morto encerrar.
  - O `finally` do `renderThumbnailSet` apagava a pasta de trabalho com o processo ainda vivo.
  - No Windows o processo segura a pasta e o arquivo de saída, então o `rm` falhava. O erro virava `EBUSY` em vez de `cancelled` e o temporário podia ficar no disco.
- **Correção** (`editorial-thumbnails.mjs`):
  - Cancelamento e timeout agora pedem a parada (`kill`, com `SIGKILL` após 5 s) e só resolvem a promessa no `close`/`error` real do processo. O código continua `cancelled` estável, e a limpeza ocorre com o processo já encerrado.
  - Abort antes do spawn ou depois do término resolve imediatamente.
- **Sinal observável**:
  - Novo `onProgress({phase:'render',completed,total,process:'running'})`, emitido no evento `spawn` de cada render (aditivo; tipo atualizado em `.d.mts`).
  - O teste “com FFmpeg em execução” agora aborta de forma síncrona nesse evento: o filho existe e ainda não pode ter terminado.
  - A espera fixa de 15 ms foi removida. Nenhuma asserção foi removida e foi adicionada `assert.ok(aborted)`. Sem skip, sem timeout maior e sem desligar a concorrência.
- **Evidência**:
  - 8 execuções paralelas do teste com a suíte do coordenador rodando ao mesmo tempo: 8/8 ok (antes, 4/6 falhavam).
  - `tests/editorial-thumbnails.test.mjs`: 21/21.

**Falha encontrada e corrigida no caminho:** a primeira suíte global deste despacho acusou 3 testes `remotion-video` com “Bundle Remotion pré-compilado ausente”. A causa foi o `vite build` avulso que rodei no despacho anterior: ele esvaziou `dist`, inclusive `dist/remotion`. Rodei o `npm run build` completo (`tsc -b`, vite, preview, bundle Remotion e manifesto do Whisper, sem rede e sem NSIS) e o bundle voltou.

**Resultado final da suíte global (`npm test`): 392/392, 0 falhas.**

### 2. Layout da galeria de capas

- O diálogo fica mais largo só enquanto há capas (`.flow-dialog:has(.production-covers)`, até 1180px).
- A galeria tem 3 colunas no desktop, 2 em larguras médias ou com zoom de 125%, e 1 em telas estreitas.
- As prévias têm altura limitada, e o formato 9:16 cabe sem ultrapassar o card.
- Ajustes visuais:
  - checkbox e texto lado a lado;
  - campo de cor com tamanho real;
  - opções de formato em linha.
- O CSS foi escopado em `production.css`. Nada global ou de tokens mudou.
- **Medido no app real em Electron** (`layout-metrics.json` + screenshots):

| Janela | Viewport CSS | Diálogo | Colunas | Overflow horizontal | Altura da capa |
|---|---|---|---|---|---|
| 1280 | 1280 | 1180 | 3 | 0 | 304 |
| 1280 com zoom 125% | 1024 | 984 | 2 | 0 | 243 |
| 900 | 900 | 860 | 2 | 0 | 270 |
| 900 com zoom 125% | 720 | 696 | 2 | 0 | 216 |
| 560 | 560 | 536 | 1 | 0 | 414 |

O e2e verifica esses valores com asserções: número de colunas, overflow ≤ 1px, diálogo dentro do viewport e capa com pelo menos 180px.

### 3. Card “Uso de IA” neutro quanto ao provedor

- O texto de tokens/custo agora diz que esta produção não recebe tokens nem custo das execuções e não estima nada; só conta as chamadas. Para o consumo, orienta a consultar a conta de cada provedor. Não afirma mais o que Codex ou Claude informam.
- A etapa mostra “Quem executa cada papel”, a partir do snapshot do agente salvo no início: `providerId` e `modelId`, ou “modelo padrão do provedor” quando não há modelo definido.

### 4. Formato de capa do LinkedIn

- Instagram e TikTok têm presets próprios. Os demais destinos (hoje, LinkedIn) começam em `instagram-feed-4x5` marcado como ponto de partida aproximado, com `confirmed:false`.
- A UI explica que não existe modelo próprio verificado e que a pessoa deve conferir no próprio LinkedIn. Uma nota geral avisa que áreas seguras e guias são aproximações.
- “Aprovar capas” fica bloqueado até a confirmação explícita “Escolhi este formato para LinkedIn”.
- O servidor também exige `confirmed:true` em `approve-covers` (`validateDestinations`). Escolher um formato sem confirmar é recusado.
- Nenhuma API de rede foi consultada nem simulada.
- Evidências:
  - teste unitário novo no coordenador;
  - o e2e agora inclui LinkedIn: exporta 3 formatos, verifica o bloqueio e confirma;
  - screenshot `06b-linkedin-format-confirm.png`.

### 5. Empacotamento e frame efetivo

- Os 5 módulos novos continuam em `build.files`.
- A checagem por grafo de imports a partir de `desktop-main.mjs` não encontrou nenhum módulo faltando.
- O manifest F03 agora traz `source.display` e `items[].frameTimestampSeconds`, mas a integração **não os usa nem persiste** nesta rodada. A prévia do conceito continua em CSS, a capa exportada é o artefato real e não há prévia de frame por tecla. É opcional e fica documentado como limite, sem alegar uso.

### Verificação deste despacho

- **Testes focados**: coordenador 20/20, preflight 10/10, progress e budget ok, thumbnails 21/21 (todos verdes).
- **Typecheck e build**: `tsc` limpo (app, node e o `tsc -b` do build). `npm run build` completo ok.
- **Suíte global**: 392/392.
- **Scripts de UI**: rodei apenas os afetados pelas mudanças, contra o `dist` reconstruído.
  - `test-content-flow-integration-ui`: `CONTENT_FLOW_UI_OK`, agora com LinkedIn e medições de layout.
  - `test-semi-production-ui`: `SEMI_PRODUCTION_UI_OK`.
  - Os outros 3 scripts de UI não foram alterados e não rodaram de novo.
- **Screenshots** em `.mainsagents-workspaces/content-flow-integration-ui/1791423987839/`:
  - `01`–`07`
  - `06-layout-1280.png`
  - `06-layout-1280-zoom125.png`
  - `06-layout-900.png`
  - `06-layout-900-zoom125.png`
  - `06-layout-narrow-560.png`
  - `06b-linkedin-format-confirm.png`
- **Itens obrigatórios pendentes**: nenhum.
- **Não executado** (fica para o despacho 0.3.56): instalador/NSIS e instalação. Também não houve commit, nova dependência, rede real, IA, Notion, publicação nem uso do perfil pessoal.

**Arquivos alterados neste despacho**
- `editorial-thumbnails.mjs` e `editorial-thumbnails.d.mts`
- `tests/editorial-thumbnails.test.mjs`
- `production-covers.mjs`
- `src/components/production/CoversReview.tsx`
- `src/components/production/production.css`
- `src/components/production/ProductionBudget.tsx`
- `src/components/production/ProductionDialog.tsx`
- `src/features/production/model.ts`
- `tests/production-coordinator.test.mjs`
- `scripts/test-content-flow-integration-ui.mjs`
- `docs/analysis/content-flow-integration-report.md`
- `dist/`, regenerado pelo `npm run build`
