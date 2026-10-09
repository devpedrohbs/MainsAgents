# Edição semiautomática — núcleo de análise e cortes (Opus)

Data: 07/10/2026. Escopo: primeira entrega funcional do engine local (silêncios → plano → export com múltiplos cortes sincronizados). Sem chamadas pagas, sem dados pessoais, sem publicação, sem mudanças em dependências/build, React, Remotion, production-coordinator ou protocolo.

## Arquivos

| Arquivo | Mudança |
| --- | --- |
| `editorial-smart-edit.mjs` (**novo, empacotar**) | Helpers puros: opções de silêncio, args do `silencedetect`, parser, candidatos com padding, transcrição importada, possíveis retomadas, segmentos mantidos, validação de plano/animações, `planHash`, filtro `trim/atrim/setpts/asetpts/concat`. |
| `editorial-smart-edit.d.mts` (**novo, empacotar**) | Tipos exatos de request/response, plano, candidatos e contrato `AnimateEngine`. |
| `editorial-media.mjs` | `analyze`, `plan`, modo `advanced` em `enqueue`, opção injetada `animate`, verificação de duração/áudio, integridade do plano no retry, `capabilities().animate`. Corte contínuo legado inalterado. |
| `content-workflow-bridge.mjs` | Somente duas rotas de mídia: `POST media/analyze` e `POST media/plan`. |
| `tests/smart-edit.test.mjs`, `tests/smart-edit-media.test.mjs` (novos) | Unidades puras + FFmpeg real. |

## API (todas `POST /api/content/...?profile=<id>`, erro → HTTP 500 `{error}`)

### `media/analyze` — somente leitura
Request: `{contentId, assetId, versionId, sha256, options?: {thresholdDb -80..-10 = -35, minDuration 0.1..10 = 0.5, padding 0..1 = 0.15}, transcript?: {segments: [{start, end, text ≤500}]}}`

Response: `{revision, analysis: {source: {contentId, assetId, versionId, sha256}, metadata: {duration, width, height, hasAudio, videoCodec, audioCodec}, options, limitations: ('noAudio'|'allSilent'|'candidatesTruncated'|'transcriptUnavailable')[], silences: [{start,end}], candidates: [{id, kind: 'silence'|'possibleRetake', start, end, label, reason, selected}], transcript: null | {origin: 'imported', segments}, suggestedSegments: [{start,end}]}}`

- Silêncio: `selected: true`, reduzido pelo padding nas bordas de fala; silêncio inicial/final vai até a borda do arquivo.
- Possível retomada (só com transcrição importada): `selected: false`, texto “Possível retomada… Revise”. Nunca afirma erro factual nem remove fala por padrão.
- Sem áudio → `noAudio`, nenhum candidato. Tudo silencioso → `allSilent`, nenhum candidato. Sem transcrição → `transcriptUnavailable` (nenhum transcript simulado).
- Uma análise por vez; abortada em `close()`.

### `media/plan` — prévia somente leitura
Request: `{contentId, assetId, versionId, sha256, plan: {segments: [{start,end}] MANTIDOS na timeline original, animations?: [...], format?: 'original'|'portrait', normalizeAudio?: boolean}}`

Response: `{revision, versionId, sha256, plan (normalizado, ms), planHash, outputDuration, sourceDuration, removed: [{start,end}]}`

Animações (timeline de **saída**): `{id /^[A-Za-z0-9_-]{1,40}$/, kind: 'title'|'lowerThird'|'cta'|'accent', text ≤80, subtitle? ≤80, start, duration ≥0.5, preset?: 'default'|'bold'|'minimal'}`, máx. 8; texto sem controle, `<>{}\`\\`, `://` ou `javascript:`; campos extras rejeitados.

### `media` (enqueue) — modo avançado
Request: `{mode: 'advanced', authorize: true, revision, requestKey ≤120, contentId, assetId, versionId, sha256, plan: <plan normalizado de media/plan>, planHash}` → `{revision, state, job}`.

- `authorize !== true` (inclusive `'true'`) → bloqueado. Plano diferente do hash revisado, hash adulterado, revisão antiga, versão/sha diferentes → bloqueado, sem FFmpeg.
- Idempotência: mesmo `requestKey` + mesmo plano → mesmo job; plano diferente → erro.
- Job: `mode: 'advanced', plan, planHash, authorizedAt, start (1º segmento), duration (= outputDuration)`, `phase: queued|encoding|animating|exported|verified`. Lista/cancel/retry pelas rotas existentes (`GET /api/content/work` → `mediaJobs`, `media/<id>/cancel|retry`).
- No launch e no retry o plano é revalidado contra a duração real e o `planHash` armazenado; plano adulterado no banco → retry bloqueado.
- Legado `{start, duration, edit}` inalterado (coberto pelos testes existentes e por um corte legado no teste novo).
- `GET media/capabilities` agora inclui `animate: boolean`.

## Render

- Um único `-filter_complex`: por segmento `[0:v:0]trim=…,setpts=PTS-STARTPTS` e `[0:a:0]atrim=…,asetpts=PTS-STARTPTS`, depois `concat=n=N:v=1:a=1`; escala/normalização após o concat. Mesmo plano para vídeo e áudio; nenhum `silenceremove`.
- Sem shell; somente números validados entram no filtro; caminho de entrada é a versão verificada do ativo. `-n` impede sobrescrever; cada tentativa usa nomes novos; original nunca é alvo.
- Saída verificada: duração dentro de `max(0.4, 0.05·segmentos)` s e áudio presente se a fonte tinha áudio; hash da fonte reconferido antes de anexar; resultado vira novo ativo `role: output` com `sourceAssetId`.

## Contrato de animação (para Sonnet / coordenador)

`createEditorialMedia(db, {animate})` — repassado por `mediaOptions.animate` no bridge. Assinatura compatível com `renderAnimatedVideo`:

```js
animate({inputPath, outputPath, animations, metadata: {duration,width,height,hasAudio,videoCodec,audioCodec,format}, signal, onProgress(fraction 0..1)}) => Promise
```

- `inputPath` é o vídeo **já cortado** (arquivo temporário novo); `outputPath` ainda não existe e deve ser criado pelo engine.
- Após o engine: duração deve ficar a ≤0.1 s da entrada e o áudio preservado, senão o job falha sem entrega.
- Sem engine injetado, planos com animações são rejeitados no enqueue (não há import de módulo inexistente). O coordenador liga `editorial-remotion.mjs` quando alinhado.

## Limites

Entrada ≤ 3600 s; ≤ 200 segmentos; segmento ≥ 0.1 s; ≤ 500 candidatos (`candidatesTruncated`); ≤ 8 animações; transcrição ≤ 5000 segmentos, ordenada, dentro do vídeo; valores não finitos, strings, sobreposições, fora de ordem e campos extras rejeitados.

## Evidências

- `node --test tests/smart-edit.test.mjs tests/smart-edit-media.test.mjs`: 9/9.
- FFmpeg 9.0.1 real (`C:/ffmpeg/bin`), vídeo sintético 6 s: tom em [0,1], [2.5,3.5], [5,6]; silêncio em [1,2.5], [3.5,5]; vídeo branco com tom e preto no silêncio.
  - Candidatos ≈ [1.15,2.35] e [3.65,4.85] (±0.03 s); plano 3.6 s.
  - Saída: duração 3.6 s ±0.1, streams de vídeo e áudio ambos ≈3.6 s; silêncio residual detectado só no padding (≈1.0–1.3 e 2.3–2.6 s) e quadros escuros apenas nessas mesmas janelas → vídeo e áudio sincronizados.
  - Bytes e sha256 do original idênticos.
  - Sem áudio: `noAudio`, export só-vídeo 2.5 s; `anullsrc`: `allSilent`.
  - Engine de animação injetado recebe só o `.cut.partial.mp4`; engine que encurta → `failed`, nenhum ativo novo.
  - Interrupção por fechamento → `interrupted`; plano adulterado bloqueia retry; retry explícito → `succeeded` (tentativa 2); cancel → `canceled` sem entrega.
- Regressões: suíte completa `node --experimental-strip-types --test tests/*.test.mjs` 307/307; `tsc -b` ok; `.d.mts` compila com `--strict`.

## Pendências / follow-up

- Análises e planos são stateless (recalculados e assinados por `planHash`); só o job avançado entra no backup existente. Ao restaurar, a importação já marca `imported` e impede execução (comportamento atual de `editorial-execution-backup.mjs`, não alterado).
- Transcrição local (whisper.cpp + ggml-base) é follow-up separado; hoje apenas transcrição importada.
- Wire de `animate` (Remotion) e UI (Codex) pendentes do coordenador.
- `Downloads/ffmpeg-9.0.2` contém só código-fonte; testes usam o binário 9.0.1 do PATH.

## Rodada 2 — edição automática FFmpeg + Remotion ligada de ponta a ponta (07/10/2026)

Pedido direto do usuário: a edição deve funcionar automaticamente com Remotion e FFmpeg.

- **Contrato alinhado ao Remotion** (`editorial-smart-edit.mjs`): animações = no máximo um `title`, um `lowerThird` (nome ≤60, `subtitle` = função ≤80) e um `cta` (sempre ancorado ao fim; `start` ignorado). `preset` e o tipo `accent` foram removidos; `plan.theme: 'dark'|'light'`. Saída animada ≤1800 s. `remotionAnimations(plan)` gera exatamente a spec de `renderAnimatedVideo`. O plano normalizado agora inclui `theme`, e o `planHash` cobre essa forma.
- **Engine** (`editorial-media.mjs`): `probeVideo` devolve `fps`; o engine chama `animate` com `{inputPath, outputPath, animations: <spec Remotion>, metadata: {width,height,fps,durationSeconds,hasAudio}, signal, onProgress}`; aceita progresso `{phase,progress}`; tolerância de duração 2 quadros + 0,1 s; `capabilities().animate` consulta `animationCapabilities()` (com `animateReasons`).
- **Ligação** (`editorial-animate.mjs`, novo): `createRemotionAnimator()` → `{animate, animationCapabilities}` sobre `editorial-remotion.mjs`, sem download de navegador. Ligado em `desktop-main.mjs` (bundle em `app.asar.unpacked/dist/remotion` quando empacotado) e `dev.mjs`.
- **Produção automática** (`production-protocol.mjs`, `production-coordinator.mjs`): ação `video` aceita `editMode: 'smart'|'basic'`. No modo `smart` o agente Editor devolve só parâmetros limitados (`removeSilences`, `silence {thresholdDb -60..-20, minDuration 0.3..5, padding 0.05..0.6}`, `normalizeAudio`, `theme`, textos de título/tarja/CTA); o executor analisa com FFmpeg, monta o plano (silêncios removidos; retomadas nunca), adiciona animações só se o Remotion estiver disponível e o vídeo for longo o bastante, gera `planHash` e exporta em modo avançado. A autorização vem do `authorize:true` da ação `video`; o resultado continua indo para `video-review` antes de qualquer aprovação/publicação.
- **UI** (`ProductionDialog.tsx`): seletor “Tipo de edição” com padrão **Automática: cortar silêncios e animar**. `SmartEditReview.tsx` alinhado (sem preset, CTA sem início, nome ≤60). `scripts/test-semi-production-ui.mjs` atualizado para o padrão automático.
- **Empacotamento** (`package.json`): `files` + `editorial-smart-edit.mjs`, `editorial-animate.mjs`, `editorial-remotion.mjs`; `asarUnpack` + `dist/remotion/**`, `@remotion/compositor-*`, `@remotion/renderer`; `build` agora roda `scripts/build-remotion-video.mjs` depois do Vite.

### Evidências

- Render Remotion **real** a partir do engine (`tests/smart-edit-media.test.mjs`): vídeo 320x180 com silêncios → cortes FFmpeg → título + CTA Remotion; duração = plano ±(2 quadros+0,1 s), áudio presente, silêncio residual só no padding, título e CTA visíveis nos quadros (verificado por imagem), original intacto. ~8 s com Chrome do sistema.
- Produção automática (`tests/production-coordinator.test.mjs`): agente → análise → job `advanced` com o mesmo `planHash` → `video-review`.
- Suíte completa 318/318; `tsc -b` ok; `.d.mts` `--strict` ok.

### Pendente

- Rodar `npm run build` + `scripts/test-semi-production-ui.mjs` (Electron) — não executado para não concorrer com outro build; o `dist/` atual é anterior à mudança de UI.
- Gerar instalador e conferir o Remotion dentro do app empacotado (Chrome/Edge do sistema; sem navegador → exporta sem animações e informa o motivo).
- Transcrição local (Whisper) para sugerir retomadas automaticamente; revisão manual com `SmartEditReview` ainda não montada numa tela.
- Revisar a licença Remotion (empresas >3 pessoas precisam de licença paga).

## Rodada 3 — transcrição local com Whisper (07/10/2026)

- `editorial-transcribe.mjs` / `.d.mts` (novos, empacotar): whisper.cpp 1.7.6 (`whisper-cli`) + `ggml-base` multilíngue, aceito só por sha256 oficial (`60ed5bc3…`; sha1 `465707469f…` confere com o oficial). Procura em `MAINSAGENTS_WHISPER_DIR`, `.mainsagents-workspaces/tooling/whispercpp` (dev) e `userData/tools/whispercpp` ou `resources/tools/whispercpp` (app). Nunca baixa nada. Extrai WAV 16 kHz mono para pasta temporária privada, apagada no fim. Marcadores como `[Música]` são descartados.
- Engine: `POST /api/content/media/transcribe {contentId,assetId,versionId,sha256,language?: 'pt'|'en'|'auto'|…}` → `{revision,source,transcript:{origin:'local-whisper',engine,model,language,segments,cached?,noSpeech?}}`. Cache por versão+sha256+idioma (tabela `editorial_transcripts`). Uma transcrição por vez; cancelada ao fechar. `analyze` aceita `transcript:'local'` e novas limitações `noSpeech`/`transcriptionFailed`. Texto enviado no payload continua `origin:'imported'`, mesmo que finja ser local. `capabilities()` inclui `transcribe` e `transcribeReasons`.
- Produção automática: transcreve antes do Editor; o agente recebe a transcrição com timestamps (até 8000 caracteres, marcada como possivelmente imprecisa); a análise usa o cache; possíveis retomadas vão para `editPlan.possibleRetakes` e para a mensagem, **sem corte**.
- Evidências: voz pt-BR offline do Windows fala “Hoje vamos falar de edição / Hoje vamos falar de edição automática no computador / Obrigado por assistir”; o Whisper devolveu exatamente essas três frases com timestamps; uma retomada detectada (não selecionada); segunda chamada usou o cache; original intacto. Suíte 322/322, `tsc -b` ok.
- Pendente: incluir whisper-cli + DLLs + modelo no instalador (`resources/tools/whispercpp`) quando gerarmos o instalador.

## Rodada 4 — “Conferir edição” (bruto × editado) e entrega para o CapCut (07/10/2026)

Decisão do usuário: o MainsAgents faz a edição básica automática; o usuário confere e, se quiser, ajusta os cortes ele mesmo (sem pedir ao agente); a edição caprichada é feita no CapCut.

- CapCut desktop importa legendas `.srt` (Texto → Legendas → Importar); não há importação documentada de timeline XML/EDL. Entrega = MP4 editado + `.srt` já no tempo do vídeo editado.
- Engine: `POST media/review {jobId}` (cortes com posição no editado e fala reconhecida dentro de cada corte, possíveis retomadas, transcrição, assets de saída e legendas); `GET|HEAD media/file?contentId&assetId&versionId` (stream com Range só de versões de vídeo vinculadas ao conteúdo; caminho vem do estado, nunca da URL; tamanho divergente → 409); `POST media/subtitles {jobId,language?}` (gera `.srt` depois, transcrevendo localmente se preciso). Exportações avançadas criam o `.srt` automaticamente quando já existe transcrição local da versão.
- Produção: ação `use-edited-video {jobId,authorize:true}` na revisão do vídeo — a versão ajustada pelo usuário (mesma gravação, verificada) passa a ser a versão a aprovar.
- UI: `src/components/content/EditReview.tsx` + `edit-review.css`: players bruto/editado, linha do tempo (mantido, cortes, cortes com fala em listras, retomadas), lista de cortes com “Ouvir no bruto”, “Ver no editado”, “Manter este trecho” e ajuste de bordas ±0,1 s; “Cortar esta retomada”; prévia instantânea tocando o bruto pulando os cortes; “Exportar versão com meus ajustes” (plan + planHash + authorize); “Usar esta versão na produção”; seção “Levar para o CapCut”. Aberto por “Conferir edição” na lista de exportações do conteúdo e por “Conferir edição (bruto × editado)” na revisão da produção.
- Evidências: suíte 325/325; `tsc -b` ok. Whisper real → corte da primeira frase → `.srt` com BOM/CRLF no tempo editado, sem a frase cortada; review sinaliza fala dentro do corte. Stream: 200 completo idêntico ao original, 206 com `content-range` correto, versão/conteúdo errados → 404, parâmetro `path` ignorado. Produção: ajuste do usuário substitui a saída e é aprovado.
- Não validado: a tela no Electron (build não executado a pedido do usuário).
