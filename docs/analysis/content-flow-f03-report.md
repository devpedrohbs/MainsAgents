# F03 — Motor local de três capas por vídeo (report)

Status: motor, contrato `.d.mts` e testes prontos e verificados com FFmpeg real. **Não conectado** ao coordenador, à API, ao desktop-main, ao model.ts ou ao ProductionDialog: a persistência e as rotas ficam para a integração coordenada (dono: Opus F01/F06). Não foi usado Remotion: a composition root e o bundle não foram tocados.

## Arquivos novos
- `editorial-thumbnails.mjs`: motor. Usa só FFmpeg/ffprobe do PATH (os mesmos que `editorial-media` já usa), com `drawtext` (HarfBuzz), `geq`, `drawbox` e `overlay`. Nenhuma dependência nova, sem IA, rede, download, Notion ou publicação.
- `editorial-thumbnails.d.mts`: contrato exato, incluindo os tipos para a galeria F04. Passou no typecheck (`tsc --strict`).
- `tests/editorial-thumbnails.test.mjs`: 21 testes (17 da primeira entrega e 4 de entradas de celular). Os pure rodam sempre; os de render real são pulados só se FFmpeg ou fonte local estiver ausente. `npm test` completo: 382/382.
- `docs/analysis/content-flow-f03-evidence/`: renders reais inspecionados (vídeo sintético `testsrc2` / `mandelbrot` / `smptehdbars`, nenhum vídeo privado).

## O que o motor entrega
- **Três conceitos fixos**, um de cada por lote:
  - `product`: frame em tela cheia com véu inferior, barra de destaque, selo opcional e título embaixo à esquerda.
  - `person`: recorte no ponto de foco escolhido pelo usuário. Na horizontal, o texto vai para o lado oposto ao foco. Na vertical, vai para cima ou para baixo, conforme o `focusY`.
  - `benefit`: painel sólido na cor de destaque mais frame. A cor do texto é preta ou branca, a de maior contraste com a cor de destaque.

  Gerar mais alternativas é um novo lote explícito.
- **Frame real escolhido pelo usuário**: `timestampSeconds` e `framing {focusX, focusY, zoom 1–3}` por conceito. Não há nenhuma detecção de produto, rosto ou expressão. `suggestCandidateFrames` devolve mudanças de cena medidas pelo FFmpeg (só keyframes) completadas por pontos espaçados, cada um com `reason: 'scene-change' | 'evenly-spaced'`. `extractFramePreview` gera um JPG de frame para a galeria.
- **Formatos por destino** (`listThumbnailFormats`):

  | Formato | Tamanho | Observação |
  |---|---|---|
  | `youtube-thumbnail` | 1280×720 | JPG/PNG, até 2 MB, zona do selo de duração |
  | `instagram-reels-cover` | 1080×1920 | Guia de recorte 3:4 da grade |
  | `tiktok-cover` | 1080×1920 | Trilho de ações e área da legenda reservados |
  | `instagram-feed-4x5` | 1080×1350 | Guia 3:4 |

  Cada formato traz `status: 'guidance-unverified'` e um texto `guidance` dizendo que as zonas são aproximadas e precisam ser conferidas na interface atual. Nenhuma regra de plataforma é dada como verificada. Só o limite de 2 MB do YouTube é aplicado: o motor reencoda o JPG com mais compressão se passar.
- **Layout medido, não estimado**: as métricas TrueType/OpenType (cmap 4/12, hmtx) são lidas da fonte local para fazer a quebra de linha e calcular os limites.
  - O título usa o maior tamanho que cabe, até um piso de legibilidade: 7,5% do lado curto na horizontal, 6% na vertical.
  - Se não couber, o motor falha com `layout_overflow`. Ele nunca corta texto.
  - Glifo ausente na fonte (por exemplo, emoji) gera `unsupported_glyph`.
  - Toda caixa (título, selo, barra, logo) é verificada: dentro da área segura, fora das zonas reservadas, sem sobreposição do logo.
  - O contraste do título é de pelo menos 4,5:1 contra o pior pixel possível sob o véu, ou contra o painel opaco. O valor vai para o manifest.
- **Prévia de áreas seguras** (`*.safe-area-preview.png`): arquivo separado, com área segura em ciano, zonas reservadas em vermelho e recorte de grade em amarelo. O manifest marca `kind: 'safe-area-preview'` e `kind: 'thumbnail'`; as guias nunca entram na capa exportada.
- **Integridade**:
  - O sha256 do vídeo é verificado antes e depois, junto com tamanho e mtime. O vídeo nunca é escrito.
  - O logo pode ter `logoSha256`.
  - Os caminhos precisam ser locais e absolutos. Caminhos UNC ou de rede são recusados (reusa `localAssetPath`).
  - Os nomes de saída são gerados pelo motor, e o motor nunca sobrescreve um arquivo (`output_exists`).
  - Cada saída é verificada por ffprobe: dimensão exata, codec e tamanho máximo.
- **Tudo ou nada**:
  - O render acontece em `outputDirectory/.<batchId>.<rand>.partial/`. Após a verificação, um único `rename` cria `outputDirectory/<batchId>/` com as 3 capas, as 3 prévias e o `manifest.json`.
  - Cancelamento (`AbortSignal`, que mata o FFmpeg em execução) ou qualquer falha remove o temporário. Os testes cobrem cancelamento entre renders, durante o FFmpeg e antes do commit.
  - `batchId` = `thumbs-<specHash[0:16]>`. O `specHash` cobre versão e hash do vídeo, formato, textos, frames, enquadramento, tema, cor de destaque, hash da fonte e hash do logo.
- **Desempenho medido**: cerca de 1,7 a 2,4 s por lote de 3 capas mais 3 prévias (FFmpeg 9.0.1, Windows).

## Contrato de integração (resumo; tipos exatos no `.d.mts`)
```ts
getThumbnailCapabilities() -> {available, ffmpeg.filters, font, formats, requiresAi:false, network:false, reasons}
suggestCandidateFrames({source, count}) -> {candidates:[{timestampSeconds, reason}], note}
extractFramePreview({source, timestampSeconds, outputPath, maxWidth})
layoutConcept({format, concept, title, kicker, framing, theme, accent, font, logo}) -> ConceptLayout   // puro, para prévia ao vivo
renderThumbnailSet({source:{path,assetId,versionId,sha256}, format, fileType, brand:{theme,accent,logoPath,logoSha256,fontPath},
                    concepts:[3 × {concept,timestampSeconds,title,kicker?,framing}], safeAreaPreview, outputDirectory, signal, onProgress})
  -> ThumbnailManifest {schema:'mainsagents.thumbnails/1', batchId, specHash, source{assetId,versionId,sha256,preserved}, format{…,status},
                        items:[{id:`${batchId}:${concept}`, concept, title, kicker, timestampSeconds, framing, crop, layout, warnings,
                                export:{path,sha256,size,width,height,mime}, preview?}]}
```
Regras para o integrador:
- `source`, `logoPath`, `fontPath` e `outputDirectory` devem vir de assets e versões já registrados no estado editorial, nunca de uma requisição. A fonte pode ser o vídeo editado aprovado.
- Prévia ao vivo, sem FFmpeg a cada tecla: usar `extractFramePreview` uma vez por timestamp e desenhar `layoutConcept(...)` em CSS. Os retângulos estão em pixels da saída e são serializáveis. Para isso, uma rota precisa expor as métricas ou o resultado do layout, porque a fonte é lida no processo Node.
- `renderThumbnailSet` só deve rodar em ação explícita ("Gerar capas"), com debounce e cancelamento no lugar de execuções concorrentes.

### Seleção por versão (persistência é do coordenador)
```ts
ThumbnailSelection = {schema:'mainsagents.thumbnail-selection/1',
  key: `${contentId}|${assetId}|${versionId}|${format}`,   // uma escolha por conteúdo + versão do vídeo + destino
  contentId, source:{assetId,versionId,sha256}, format, batchId, specHash, concept,
  file:{path,sha256,size,width,height,mime}, selectedAt}
createThumbnailSelection(manifest, concept, {contentId})
checkThumbnailSelection(sel, {currentSource, file?}) -> 'current' | 'stale' | 'invalid' (+ reasons)   // puro
verifyThumbnailSelectionFile(sel, {currentSource})                                                    // relê o hash do arquivo
```
- Uma nova versão ou um novo hash do vídeo torna a escolha `stale`. A aprovação do pacote deve exigir `current`.
- O coordenador registra `items[].export` como asset `role:'output', kind:'image'`, com `sourceAssetId` = vídeo, e persiste a seleção. A etapa `generating-cover` passa a ser `covers-review`.

### Mapeamento para a galeria F04 (`src/features/production/thumbnailGallery.ts`, já existente)
- `ThumbnailConcept.id` corresponde a `concept`. Um `kicker: ''` é aceito e tratado como ausente.
- `ThumbnailArtifact` vem do manifest:
  - `conceptId` = `item.concept`
  - `format` = `manifest.format.id`
  - `sha256`, `width` e `height` vêm de `item.export`
  - `sourceVersionId` e `sourceSha256` vêm de `manifest.source`
  - `assetId` é o asset registrado pelo integrador
  - `inputsSignature` é calculado pelo integrador no momento do pedido
- Diferença real: a galeria tem `onGenerate(id)` por conceito, mas o motor gera sempre os três. O integrador deve renderizar o lote inteiro, em cerca de 2 s, e gravar os três artefatos. Os dois contratos foram comparados por leitura; nenhum código da galeria foi rodado contra o motor.
- Para os formatos, a galeria pode usar `listThumbnailFormats()`, ou só `{id,label,width,height}`.

## Inspeção visual (renders reais em `content-flow-f03-evidence/`)
- `youtube-three-concepts.jpg` e `feed-4x5-three-concepts.jpg`: títulos com acentos (ã, ç, í) corretos, sem colisão com o logo e fora do selo de duração.
- `youtube-246px-legibility.png`: as três capas reduzidas a 246 px de largura (tamanho próximo ao de uma lista lateral) continuam legíveis.
- `reels-grid-crop-140px.png`: recorte 3:4 da grade a 140 px. Os títulos aparecem inteiros.
- `tiktok-light-safe-area-preview.jpg`: tema claro, com as guias e as zonas reservadas visíveis só na prévia.
- Achado corrigido com um aviso: um logo na mesma cor de destaque some no painel de `benefit`. O motor não avalia as cores do logo; ele grava em `warnings` onde o logo pousa (sobre o painel ou sobre o frame), para conferência na prévia.

## Limites honestos
- As zonas seguras e os recortes de grade são aproximações das interfaces observadas, não especificações oficiais. É preciso conferir antes de publicar, e o limite de 2 MB do YouTube é o único aplicado.
- A fonte é a primeira bold do sistema (Windows: `segoeuib.ttf`; macOS e Linux: Arial Bold ou DejaVu, sem teste nesses SOs) ou `brand.fontPath`. Não há fonte embarcada, e `.ttc` não é suportado. O layout depende da fonte: o hash dela entra no `specHash`.
- A medição não considera kerning, o que é conservador: o HarfBuzz só estreita pares. A largura real pode ficar um pouco menor que a calculada.
- O véu garante contraste do título mesmo no pior pixel, mas no tema claro ele deixa a imagem esbranquiçada. A legibilidade do logo é responsabilidade do arquivo de logo.
- As sugestões de frame são por mudança de cena entre keyframes. Em vídeos com poucos keyframes, os pontos espaçados predominam.
- Rotação, SAR e VFR foram validados com fixtures sintéticas (seção abaixo), não com gravações reais de celular.
- O JPG sai em `yuvj444p` para preservar as bordas do texto colorido. Isso é baseline-compatível, mas não foi testado em upload real a cada plataforma.
- Prévia ao vivo, rotas IPC/HTTP, persistência da seleção, registro de assets e troca da etapa de capa no coordenador estão fora deste escopo.

## Rodada 2: entradas de celular (fixtures sintéticas, Windows, FFmpeg 9.0.1)

Sem vídeo privado. As fixtures são geradas no próprio teste com marcadores de cor, e o resultado é comparado pixel a pixel com o frame que o próprio FFmpeg autorrotaciona.

| Caso | Fixture | Resultado antes | Correção | Teste |
|---|---|---|---|---|
| Rotação 90 | 640×360 gravado + `-display_rotation 90` (ffprobe: `rotation: 90`) | Já correto: troca de largura/altura para ±90 | Nenhuma; passou a ser confirmado pelo frame decodificado | Cores esquerda/direita, marcador, foco (0,0) com zoom 2 e painel do benefício iguais à referência; 3 capas 1080×1920 |
| Rotação 270 | Idem com 270 (ffprobe: `rotation: -90`) | Já correto | Nenhuma | Idem |
| SAR 4:3 | 640×360 gravado, exibido 852×360 | **Bug**: recorte em pixels gravados, a imagem saía comprimida na horizontal (círculo virava elipse) | `SQUARE_PIXELS` antes de todo recorte e no `extractFramePreview` | Fronteira de cor na posição correta (1066 px, sem correção cairia em 960); prévia 852×360 |
| VFR | 30 fps, depois 5 fps, depois 24 fps (passos de 0,033 / 0,2 / 0,042 s verificados no ffprobe) | Frame certo, mas o pts real não era registrado e um ponto sem frame dava erro genérico do FFmpeg | `probeFrame` por conceito: tamanho real, `frameTimestampSeconds`, e `invalid_concepts` quando não há frame | Cor certa por trecho, pts a ≤0,2 s do pedido, recusa de timestamp após o fim, NaN e Infinity, sem lote nem temporário deixados |
| Abertura no navegador | 3 JPG + 3 PNG | — | — | Chrome local (caminho explícito via `resolveBrowser`, `--headless=new`, `file://`, perfil temporário, sem rede) carrega todas as imagens nas dimensões exatas |

- **Divergência entre o ffprobe e a autorrotação**: antes do render, cada timestamp é decodificado uma vez (sem gravar nada, ~0,1 s). O tamanho que chega aos filtros é a fonte de verdade para o recorte. Se divergir da previsão do ffprobe (matriz de rotação mais SAR), o manifest registra `source.display.consistentWithProbe=false` e cada item ganha um aviso. Nos 4 casos testados não houve divergência; o caminho de divergência não tem fixture, porque o FFmpeg usado é coerente com o próprio ffprobe.
- Hash da fonte e do logo, tudo-ou-nada e cancelamento continuam como antes: os 17 testes originais seguem passando.
- Validação de tempo: um timestamp não finito é recusado na validação, um timestamp maior que a duração é recusado antes do render, e uma duração desconhecida ou ≤0 vira `invalid_source`.
- Evidência (antes/depois) em `content-flow-f03-evidence/`:
  - `mobile-rot90-stored-reference-covers.jpg` e `mobile-rot270-stored-reference-covers.jpg`: frame gravado sem rotação, referência autorrotacionada do FFmpeg e as 3 capas.
  - `mobile-sar-before-after.jpg`: recorte em pixels gravados (comportamento anterior: elipse), referência exibida (círculo) e capa atual (círculo).

### Mudanças de contrato (só adições, já avisadas ao integrador ctx_43f82fbe4bb6)
- Manifest:
  - `source.display {width, height, rotation, sampleAspectRatio, consistentWithProbe}`
  - `items[].frameTimestampSeconds`
- `probeMedia` retorna também `sampleAspectRatio`, `stored` e `display`.
- Novas exports: `probeFrame(file, t)` e `SQUARE_PIXELS`.
- `planThumbnailSet` aceita `facts.frames` por conceito.
- Novos casos de erro: `invalid_concepts` (sem frame no ponto ou após o fim) e `invalid_source` (duração desconhecida).
- Nenhuma assinatura existente mudou.

### Limites desta rodada
- As fixtures são sintéticas. Não foram testados vídeos HEVC/HDR de iPhone ou Android, Dolby Vision, rotação de 180° ou vídeos com troca de resolução no meio. Nesse último caso, o recorte usa o tamanho de cada frame, mas isso não tem teste.
- O SAR < 1 é normalizado esticando a altura, sem fixture própria. Só o SAR 4:3 foi testado.
- O teste no Chrome só confirma que as imagens carregam e decodificam nas dimensões certas. Não compara pixels, e a QA visual da UI final fica com o Sonnet.
- A suíte global não foi reexecutada nesta rodada, a pedido; só o arquivo focado: 21/21.
