# F04 — Galeria de capas (report)

Status: modelo, componente e testes isolados prontos. **Não conectado** a ProductionDialog/model/coordinator/API/desktop-main (dono: Opus). `editorial-thumbnails.mjs` (F03) ainda não existia no disco; os tipos do contrato foram espelhados localmente em `thumbnailGallery.ts` e devem ser trocados pelos `.d.mts` reais.

## Arquivos novos
- `src/features/production/thumbnailGallery.ts` — estado/regras puras.
- `src/components/production/ThumbnailGallery.tsx` + `thumbnail-gallery.css`.
- `tests/thumbnail-gallery.test.mjs` (7 testes passam).
- Acabamento F02: `defaultSuggestions(scenes, pt)` agora gera sugestões genéricas derivadas do título da cena (tomada de apoio da ação citada; materiais citados), sem produto real, editáveis. `buildRecordingPackage(run, pt=true)`.

## Contrato (props)
```ts
<ThumbnailGallery state source formats format pt busy sourceDurationSeconds status
  resolveAsset={(artifact)=>Promise<streamUrl>}
  onFormatChange onAdjust(id,patch) onSelect(id) onGenerate(id) onCancel(id) onApprove(id) />
```
- `state: ThumbnailGalleryState` controlado pelo integrador; helpers: `createGalleryState`, `updateConcept`, `selectConcept`, `recordArtifact(state,source,artifact)`, `applySource`, `approve`, `canApprove`, `isStale`.
- `ThumbnailArtifact` = item do manifest: `{conceptId,format,assetId,sha256,width,height,sourceVersionId,sourceSha256,inputsSignature}`; `inputsSignature = conceptSignature(concept,format,source)` calculado no momento do export.
- `onGenerate` é o único caminho que deve chamar `renderThumbnailSet`; digitar/arrastar só chama `onAdjust`.

## Regras
- 3 conceitos (produto/pessoa/benefício) com enquadramentos e timestamps distintos; prévia por formato (aspect ratio).
- Editar título/kicker/quadro/enquadramento torna a exportação **stale** (arquivo mantido, marcado) e retira a aprovação; whitespace nas pontas não invalida.
- Aprovar exige conceito selecionado com artefato atual não-stale no formato; desabilitado durante busy/loading.
- Nova versão/hash da fonte (`applySource`) zera seleção, aprovação e artefatos; resultados tardios de fonte antiga são ignorados (`recordArtifact`).
- Conceito (quadro tracejado, “não é a capa final”) é visualmente separado da capa exportada (`<img>` só com URL http(s)/blob/data:image; caminhos de disco e `file:` são rejeitados por `isSafePreviewUrl`).
- Sem botão de IA (não há callback real). A11y: labels, fieldset/radio de formato, `aria-pressed`, `role=alert/status`, `aria-invalid`, foco visível, pt/en, estados vazio/erro/carregando.

## Não coberto
- Teste de render do componente (não há infra de render TSX no repo); verificação apenas por typecheck do arquivo e testes do modelo.
- Integração, chamada real ao motor F03, persistência do estado, build global.
