# Rodada checkup B03 + B05 — relatório (2026-10-08)

Responsável: Claude Opus (worker `task_e4eee212a46b`). Escopo: B03 (escolher o frame vendo o vídeo) e B05 (legendas de fala gravadas no MP4). B04 (identidade da loja/workspace) está **excluído** pelo usuário (não pendente, não autorizado) e não foi tocado; cores/logo por produção existentes continuam como estavam. Nada de contas de IA do usuário, Notion, publicação real, tags, commits, reset, instalações ou subagentes.

## Resultado

Os dois itens estão **ligados de ponta a ponta** (backend → HTTP → UI real no Electron), não como stubs.

### B03 — escolher o frame vendo o vídeo

- **Backend** (`production-coordinator.mjs`): `coverCandidates(profile, runId)` usa `suggestCandidateFrames` (até 6 instantes, motivo `scene-change`/`evenly-spaced`, cache por run+sha256, limite 16); `coverFrame(profile, runId, {timestampSeconds, versionId, sha256}, signal)` usa `extractFramePreview` (JPG 480 px, grade de 0,1 s).
  - O vídeo vem sempre da versão registrada (asset/versão/sha256) — nenhum caminho vem da requisição nem volta ao cliente.
  - Pedido de versão antiga → 409; resultado tardio (vídeo/etapa mudou ou índice trocado) → arquivo apagado + 409; desconexão do cliente aborta o FFmpeg (o runner espera o processo fechar e apaga o `.partial`).
  - Cache limitado: 48 quadros por run, 8 runs; troca de versão apaga os quadros da anterior; arquivos órfãos de sessões anteriores são limpos na primeira chamada. No máximo 2 extrações simultâneas.
  - Inicialização do índice é single-flight (corrigida uma corrida real encontrada pelo teste de UI: dois primeiros pedidos simultâneos se invalidavam).
  - Verificação de hash do vídeo com cache por estado do arquivo (path, tamanho, mtime, ctime) em `editorial-thumbnails.mjs`, para que cada miniatura não releia o vídeo inteiro.
  - Rotação/SAR: o FFmpeg autorrotaciona e `SQUARE_PIXELS` normaliza antes do quadro; o player do navegador mostra a mesma orientação.
- **Capas usam o vídeo SEM legendas gravadas**: `coverVideo(p)` = base do vídeo aprovado quando ele é a versão legendada; senão o próprio vídeo aprovado. Toda a cadeia de capas (render, reaproveitamento, aprovação, troca de lote) usa essa referência.
- **UI** (`CoverFramePicker.tsx`, `CoversReview.tsx`, `ThumbnailGallery.tsx`): player com scrub da versão base, seleção do conceito (produto/pessoa/benefício), "Usar o instante atual", 6 miniaturas candidatas clicáveis e prévia do quadro real dentro de cada cartão de conceito (com o foco/zoom aproximados em CSS).
  - Clicar/digitar muda o timestamp do conceito → retira a aprovação daquele conceito em todos os formatos e deixa a exportação desatualizada (regra existente de `updateConcept`).
  - Prévia por conceito com debounce de 350 ms, `AbortController` por pedido, URLs blob revogadas; **nunca** exporta capa por tecla (teste confirma `batches` vazio após digitar).

### B05 — legendas de fala dentro do vídeo

- **Motor novo** `editorial-captions.mjs` (+ `.d.mts`): FFmpeg + libass (filtro `subtitles`), sem IA, rede, download de fontes ou dependência nova.
  - Três estilos genéricos (`classic`, `boxed`, `highlight`), geometria proporcional ao lado menor do vídeo exibido; nada de identidade de loja (B04 está excluído).
  - Fonte local já usada pelas capas (Segoe UI Bold no Windows); a família é lida da tabela `name` e o arquivo é copiado para `fontsdir`, garantindo que o libass use a fonte que mediu o texto.
  - Quebra de linha medida na fonte real (máx. 2 linhas, `WrapStyle 2`); texto que não cabe → erro `layout_overflow` claro (não corta). Caracteres sem glifo (ex.: emoji) → `unsupported_glyph` listando os caracteres. `{ } \` são recusados (evita injeção de tags ASS).
  - Saída: MP4 novo (x264 CRF 20), **áudio copiado byte a byte** quando o codec cabe em MP4 (senão AAC, informado como `reencoded`), sem áudio inventado em vídeo mudo. Original nunca escrito; verificação de duração/áudio/tamanho e re-hash da origem antes do rename atômico; cancelamento espera o FFmpeg fechar e remove diretório de trabalho e parcial.
  - `parseSrt` (inclusive SRT corrigido no CapCut, tags `<i>/<b>/<font>` removidas), `captionsToSrt`, `captionsFromTranscript` (primeira versão a partir do Whisper local).
- **Fluxo na produção** (`production-captions.mjs` + coordinator), só na etapa `video-review`:
  1. `captions-transcribe` (background, Whisper local em cache por versão; cancelável via `signal` novo em `media.transcribe`) → versão v1 `origin:'transcript'`.
  2. `captions-save {baseVersion, segments | srt}` → versão imutável com hash; idêntica = no-op; salvar retira a aprovação.
  3. `captions-approve {version, hash, style, authorize}` → só a última versão.
  4. `captions-render {version, hash, style, authorize}` → precisa bater com a aprovação (versão+hash+estilo); grava MP4 + SRT da mesma versão como assets novos; o vídeo em revisão passa a ser o legendado (precisa de nova aprovação do vídeo). Mesmo hash+estilo já gravado e verificado é reaproveitado.
  5. `captions-cancel`, `captions-remove` (volta ao vídeo base; o legendado fica na biblioteca).
  - `approve-video` é recusado enquanto houver transcrição/gravação de legenda em andamento.
  - `reopen-video {authorize}` (etapas platforms → schedule, sem envio externo pendente): reabre o vídeo aprovado para revisão e **retira as aprovações dependentes** (vídeo, capas, pacote, horário). As legendas do post são reaproveitadas sem nova chamada de IA (`packageReuse`, comparação de redes independente de ordem); as capas pedem nova aprovação e, se a base mudou, recomeçam.
  - `revise-video` (novo corte) descarta legendas cronometradas para o corte anterior.
  - Cancelamento, reinício do app e resultados tardios nunca oferecem vídeo parcial/obsoleto (arquivo tardio é apagado). Recuperação marca jobs `running` como `interrupted`; nada retoma sozinho.
- **Honestidade de tempo**: toda versão vinda do Whisper carrega `whisper-approximate`; sem tempo por palavra → `sentence-timing`; frases longas divididas → `split-proportional` (tempo proporcional ao texto, não ao áudio); SRT importado → `imported-srt`. A UI mostra esses avisos; não há "sincronia perfeita" nem correção semântica automática das falas (o teste confirma o texto exatamente como transcrito).
- **UI** (`CaptionReview.tsx`, `captionReview.ts`): editor por linha (início/fim em `m:ss.cc`, "= agora" a partir do player, "Ouvir", inserir/remover), validação inline espelhando o servidor, rascunho local por base+versão, importar SRT, transcrever, escolher estilo (prévia aproximada sobreposta ao player), aprovar, gravar com progresso e cancelar, aviso do vídeo legendado em revisão e "Voltar ao vídeo sem legendas". Texto deixa claro que isso **não** é a legenda do post. `ProductionDialog` ganhou o painel e o "Reabrir vídeo" com confirmação.

### Correções encontradas no caminho

- `productionStages` não tinha `covers-review`: um backup feito na etapa de capas falhava na importação ("Inconsistent production history"). Corrigido em `production-protocol.mjs`.
- `production-backup.mjs`: jobs `running` (render de capas, transcrição, gravação de legendas) de histórico importado viram `interrupted`; importado continua sem autorização e sem expor quadros.

## Contrato para fases futuras (B07/B09/B10)

- Tipos: `editorial-captions.d.mts` (motor), `production-captions.d.mts` (`ProductionCaptions`, `CaptionVersion`, `coverVideo`, `captionBase`), `editorial-thumbnails.d.mts` (`runProcess` exportado com `cwd`/`onStdout`).
- Estado em `run.captions = {base, durationSeconds, language, versions[], transcription?, approved?, render?, output?}` — leitura apenas fora do coordinator; `run.captionStyles` é enviado só em `video-review`.
- Comandos (POST `/api/content/productions/:id`, com `revision` + `requestId`): `captions-transcribe`, `captions-save`, `captions-approve`, `captions-render`, `captions-cancel`, `captions-remove`, `reopen-video`.
- Leitura HTTP: `GET /api/content/productions/:id/frames`, `GET /api/content/productions/:id/frame?t=&versionId=&sha256=` (JPEG, `x-frame-timestamp`), `GET /api/content/productions/captions-capabilities`.
- `media.transcribe(profile, input, {signal})` — o `signal` só vem de chamadas internas (corpo HTTP não carrega).

## Evidências (Windows, FFmpeg 9.0.1 com libass, whisper.cpp ggml-base, sem dados do usuário)

- `tests/editorial-captions.test.mjs` — 6/6: regras, SRT, divisão honesta, layout na fonte real, render real (áudio idêntico byte a byte, original intacto, rotação 90° em pé, vídeo mudo sem áudio inventado, emoji recusado, saída existente recusada), cancelamento sem resíduos, **Whisper real + voz pt-BR do Windows → v1 → MP4 legendado**.
- `tests/production-coordinator.test.mjs` — 3 testes novos (fluxo B05 + B03 completo; cancelar/reiniciar/tardio; backup importado) + todos os existentes.
- Conjunto focado: `production-*`, captions, thumbnails, gallery, backups, media, smart-edit-media, transcribe, recording-package → **141/141**. `tsc -b` limpo.
- Electron real (`scripts/test-captions-frames-ui.mjs`, dist privado em `.mainsagents-workspaces/ui-dist-b03b05`): transcrever → erro inline → v2 → estilo "Caixa" → aprovar → gravar (áudio `copied`, 0 chamadas de IA) → aprovar vídeo legendado → capas usam a base sem legenda → miniaturas e prévias reais carregadas → clique em candidato muda o timestamp → 4 digitações geram ≤ 2 pedidos de quadro e nenhuma exportação → reabrir vídeo retira aprovações → voltar ao vídeo sem legendas. Capturas: `captions-burned.png`, `frame-picker.png`, `frame-previews.png`.
- Regressão Electron: `test-semi-production-ui` e `test-production-flows-ui` passam com o build novo.
- Teste global completo **não** rodado: fica para depois que todos os responsáveis fecharem, como pedido.

## Limitações conhecidas

- Tempos do Whisper são aproximados; a divisão de frases longas é proporcional ao texto. O usuário precisa revisar; não existe alinhamento forçado.
- Prévia de estilo no navegador é aproximada (CSS); o arquivo final vem do libass. A medição de largura é conservadora (em-box, sem kerning).
- Estilos são três presets genéricos fixos. Personalização por loja (B04) foi excluída pelo usuário e não está pendente.
- Legendas gravadas exigem recodificar o vídeo (x264 CRF 20); o áudio é preservado.
- Candidatos de quadro são mudança de cena/espaçamento, sem detectar produto/rosto. Em vídeos muito curtos podem vir menos de 6.
- Frames/candidatos só existem na etapa `covers-review` e passam pelo `guard` da produção (perfil ativo, lease, agentes sem alteração).
- Fora do escopo (próximo despacho): fluxo local sem Notion (B07), referências (B09), atualização automática de publicações (B10). B06 (vídeo real/contas) continua aguardando a resposta do usuário; nenhum vídeo privado foi acessado.

## Arquivos

Novos: `editorial-captions.mjs/.d.mts`, `production-captions.mjs/.d.mts`, `src/components/production/CaptionReview.tsx`, `caption-review.css`, `CoverFramePicker.tsx`, `src/features/production/captionReview.ts`, `tests/editorial-captions.test.mjs`, `scripts/test-captions-frames-ui.mjs`, este relatório.
Alterados: `production-coordinator.mjs`, `production-protocol.mjs`, `production-backup.mjs`, `editorial-media.mjs` (signal em `transcribe`), `editorial-thumbnails.mjs/.d.mts` (`runProcess` exportado, cache de digest), `content-workflow-bridge.mjs` (rotas), `package.json` (arquivos do build), `ProductionDialog.tsx`, `CoversReview.tsx`, `ThumbnailGallery.tsx`, `thumbnail-gallery.css`, `src/features/production/model.ts`, `tests/production-coordinator.test.mjs`. Nenhum arquivo de Home/diagnóstico/RecordingPackage/teleprompter foi editado.
