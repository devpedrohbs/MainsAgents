# F05 — Biblioteca de referências (Reels por link ou vídeo local autorizado)

Status: módulo isolado entregue e testado; **não ligado** ao app (fora do escopo desta onda).

## Arquivos (todos novos; nenhum arquivo existente foi editado)
- `src/features/content/inspiration.ts` — modelo e funções puras, sem dependências, sem rede/I/O.
- `src/components/content/InspirationLibrary.tsx` + `inspiration-library.css` — UI controlada (pt-BR/en-US via `useLanguage`).
- `tests/inspiration-library.test.mjs` — 10 testes (passam com `npm test`-style: `node --experimental-strip-types --test`).

## Contrato
Estado: `{schemaVersion:1, references: InspirationReference[]}`.
`InspirationReference`: `id, workspaceId, sourceUrl?, sourceHost?, platform?, title?, author?, notes, tags[], asset?{assetId,name}, metadataStatus:'not_collected', revision, createdAt, updatedAt, removedAt?`.

Funções (todas recebem `workspaceId` e retornam novo estado, sem mutar):
`createReference`, `updateReference` (com `expectedRevision`), `removeReference` (soft-delete), `restoreReference`, `listReferences` (workspace + tags AND + busca), `workspaceTags`, `describeAvailability`, `buildBriefingContext` (→ `{text, attribution, analysis:'not_collected'}`), `validateReferenceUrl`, `normalizeTags`, `parseInspirationState` (defensivo ao ler do disco). Erros: `InspirationError` com `code`.

Vídeo local: só por `assetId` de um asset existente (`EditorialAsset`, kind `video`, mesmo workspace) via `resolver(assetId) → {workspaceId,name,kind}`. Nunca guarda caminho.

Componente: `<InspirationLibrary workspaceId state onChange(next) assets? onUseAsBriefing?(ctx) />`. `assets` = `{id,workspaceId,name,kind}[]` (mapear de `state.assets`).

## Garantias
- URL: só http/https, sem usuário/senha, sem espaços/controle, ≤2048, host com ponto (rejeita `localhost`), remove `utm_*`/`fbclid`/`igsh` e fragmento; duplicata (mesmo link normalizado) bloqueada por workspace. Link é aberto só por `<a target=_blank rel=noopener>`; nada é buscado.
- Autor só se a pessoa digitar; estado sempre "não coletado/sem análise"; vínculo de vídeo perdido aparece como indisponível.
- Briefing: bloco rotulado como material de referência sem instruções, notas citadas (`>`), atribuição (fonte, autor "informado pelo usuário"/"não informado"), pede crédito e não cópia. Não chama IA, não publica.
- Isolamento: qualquer id de outro workspace → `not_found`; asset de outro workspace → `asset_wrong_workspace`.

## Integração futura (não feita)
1. Persistir `InspirationLibraryState` (ex.: nova chave em `EditorialState` em `model.ts`/bridge, ou store local por workspace) — usar `parseInspirationState` ao carregar e validar de novo no servidor/bridge; `onChange` deve retornar a Promise da gravação.
2. Montar o componente numa página/aba (ex.: Home ou Conteúdo) passando `workspaceId` ativo e assets de vídeo.
3. `onUseAsBriefing`: injetar `ctx.text` no campo de briefing/chat; ainda não existe destino.
4. Backup (`backupFormat`) precisa incluir o estado e referências de asset.
5. Strings estão no próprio componente (padrão de `ContentAssetLibrary`), não em `LanguageProvider`.

## Limites / verificação
- Testes unitários: 10/10 passam. `tsc` focado no componente (config temporária) sem erros nos arquivos novos (apenas erros de `window.mainsAgentsDesktop` por falta do `.d.ts` global na config isolada). Build global e UI em navegador não rodados.
- Skills frontend-design/apple-design não estavam disponíveis; a UI reaproveita classes existentes (`editorial-card`, `primary-button`, `soft-button`) e tokens CSS.
- Sem editor visual de teste de UI (script `test-*-ui.mjs`) — pendente quando houver wiring.
