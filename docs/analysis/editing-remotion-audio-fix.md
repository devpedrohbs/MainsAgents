# Remotion — correção do áudio (mono −3 dB)

Data: 07/10/2026.

## Causa e abordagem

O mixer do Remotion sempre entrega AAC **stereo 48 kHz**; fonte mono vira stereo com pan law de −3 dB. A API do `renderMedia` (docs oficiais: `muted`, `enforceAudioTrack`, `audioCodec`, `audioBitrate`, `separateAudioTo`, `sampleRate`) não tem opção para preservar canais/ganho da fonte. Solução: o render passa a ser **sempre `muted: true`** e o áudio **ORIGINAL** de `inputPath` é anexado com FFmpeg em um novo arquivo temporário:

`ffmpeg -i <vídeo renderizado> -i <inputPath> -map 0:v:0 -map 1:a:0 -c:v copy -c:a copy|aac -movflags +faststart`

- Áudio AAC → `-c:a copy` (amostras, canais e taxa idênticos; nenhum ganho aplicado).
- Outro codec (ex. MP3/Opus) → `-c:a aac -b:a 192k`, sem `-ac/-ar` (mantém canais e taxa). Nunca amplifica.
- Sem áudio na fonte → nada é anexado (saída sem stream de áudio).

## Contrato (inalterado, só aditivo)

`renderAnimatedVideo({inputPath,outputPath,metadata,animations,signal,onProgress,browserExecutable,bundleDir,ffprobePath})` e `getRemotionCapabilities()` iguais. Adições:
- Opção `ffmpegPath?` (padrão: `ffmpeg` do PATH; o ffmpeg do Remotion não garante encoder AAC).
- Resultado: `audio: {mode:'copy'|'encode'|'none', codec?, channels?, sampleRate?}`.
- Novo código de erro `input_changed` (origem mudou entre a verificação e o remux → nada entregue).
- `probeVideo` devolve também `audioCodec/audioChannels/audioSampleRate/audioDurationSeconds`; novo export `resolveFfmpeg`.
- Verificação final: canais e taxa iguais à fonte, duração do áudio ±(2 frames+0,1 s), dimensões, codec h264, duração do vídeo ±(2 frames+0,1 s); falha → `verify_failed` e nada entregue.

Preservados: patch loopback, token/ranges/Host/409 do servidor de mídia, fonte do sistema sem rede, bundle pré-compilado, nunca sobrescrever saída, saída temporária + verificação + publicação atômica.

## Antes / depois (RMS decodificado em mono; fonte sintética 6 s)

| Fonte | Antes (canais, RMS) | Depois (modo, canais, RMS) |
|---|---|---|
| mono AAC | stereo, 2892 → ~2045 (−3 dB) | copy, **mono**, 2892 → 2892 |
| stereo AAC | stereo, 2892 → 2887 | copy, stereo, 2892 → 2892 |
| stereo MP3 | (não coberto) | encode AAC, stereo, 2751 → 2749 |
| sem áudio | sem áudio | sem áudio |

Taxa 44,1 kHz preservada (antes virava 48 kHz). Duração do container 6,000 s → 6,000 s. QA de frames dos 2 presets existentes regenerado: diffs início/meio/fim idênticos aos anteriores (8,7 / 2,4 / 4,3), isto é, overlays inalterados (`docs/analysis/editing-remotion-frames/`).

## Testes (reais; Chrome 154 + FFmpeg 9.0.1 do PATH; 13/13 passam)

`node --experimental-strip-types --test tests/remotion-video.test.mjs` (~50 s). Casos reais: stereo AAC, mono AAC, MP3→AAC, sem áudio (canais, RMS ±2% em copy / ±10% em encode, taxa, duração ≤2 frames+0,1 s, SHA-256 da origem intacto, overlays); cancelar no render (sem saída/temporários, listeners só em 127.0.0.1); cancelar imediatamente antes do remux e origem alterada durante o render (`input_changed`) — saída vazia, hash da origem intacto. Limite: cancelar no meio do processo do ffmpeg não é testável de forma determinística (copy leva milissegundos); o `AbortSignal` mata o processo e o `finally` remove `.remotion-tmp`/`.remotion-mix`.

## Para o Opus integrar

- Nada muda nas chamadas existentes; `metadata.hasAudio` continua obrigatório. Para mostrar ao usuário use `result.audio` (modo/canais).
- Requer `ffmpeg` executável: no PATH ou `ffmpegPath` (no app empacotado, o mesmo binário que o engine já usa para cortes). `getRemotionCapabilities()` ainda não checa ffmpeg (a decisão de contrato fica com você; se quiser, posso adicionar `ffmpeg: {ready,path}`).
- Temporários ficam ao lado do destino: `.<nome>.<id>.remotion-tmp.mp4` e `.remotion-mix.mp4`; removidos em sucesso, erro e cancelamento.
- Não rodei build raiz nem alterei package/main/core.

## Follow-up: FFmpeg em `getRemotionCapabilities`

- `getRemotionCapabilities({..., ffmpegPath?})` agora devolve `ffmpeg: {ready, source:'explicit'|'path', path, version, reason}` e adiciona `reasons[]` legível (`ffmpegPath indicado não existe/não executa` ou `ffmpeg não encontrado no PATH…`); `available` fica `false` sem FFmpeg. `path` é o caminho explícito ou a string `'PATH'` (nenhum ambiente/segredo exposto); nada é baixado. `ffprobe/browser/bundle/license/versions/template` inalterados.
- Novo export `checkFfmpeg({ffmpegPath?})`. Assinaturas de `renderAnimatedVideo`/`validateAnimations` estáveis.
- `renderAnimatedVideo` com fonte que tem áudio checa o FFmpeg antes de criar diretório/arquivo: falha com `RemotionError.code === 'dependency_missing'` (mensagem acima). Fonte sem áudio não exige FFmpeg.
- Cancelamento do remux: confirmado que `AbortSignal` já mata o processo filho (`runProcess`, inclusive abort prévio) e que o `finally` remove `.remotion-tmp` e `.remotion-mix` (coberto pelo teste existente).
- Testes: 15/15 (novos: ffmpeg ausente e arquivo inválido → `available:false` e render sem criar saída; real: `ffmpegPath` inexistente → `dependency_missing` sem `out/`, e `ffmpeg.source==='path'` com versão). Observação honesta: em uma das execuções, o teste real de cancelamento/metadata falhou uma vez em ~170 ms; não reproduziu em 4 execuções seguintes (15/15 todas) e não consegui capturar a causa.
