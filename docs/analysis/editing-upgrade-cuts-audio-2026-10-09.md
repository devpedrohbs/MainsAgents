# Edição: cortes naturais e tratamento de voz (Tarefa A)

Data: 09/10/2026. Escopo: ampliar os cortes automáticos (que hoje só removem silêncios) para **sugerir** muletas, repetições, tomadas refeitas e autocorreções a partir da transcrição com tempos por palavra; permitir editar pela transcrição sem perder a sincronia dos tempos; e oferecer tratamento de voz **opcional** com o FFmpeg local. Nada disso pré-seleciona cortes, altera o arquivo original nem diz que reduziu ruído sem ter medido.

Arquivos meus: `editorial-smart-edit.mjs/.d.mts` (alterações aditivas), os novos `editorial-speech-edit.mjs/.d.mts` e `editorial-audio-cleanup.mjs/.d.mts`, `tests/speech-edit.test.mjs`, `tests/speech-audio-media.test.mjs` e este relatório. Não mexi em `editorial-media`, no coordinator, nas bridges, no `package.json`, no Remotion, na UI nem no `editorial-motion-plan` (dele só **importo** `extractVoicePcm` e `voiceTrack`).

## Contrato (aprovado pelo coordenador e enviado ao C)

| Peça | Contrato |
|---|---|
| `plan.audio` (opcional) | `{leveling:boolean, noiseReduction:false\|{noiseFloorDb:-62..-20}, smoothCuts:boolean}`. Se o campo não vier, `validatePlan` não emite `audio`: plano, `planHash` e filtro ficam **idênticos byte a byte** aos de antes. Chaves desconhecidas, tipos errados, piso abaixo de −62 dBFS ("não há ruído mensurável") ou acima de −20 dBFS são rejeitados. |
| `cutFilter(segments,{hasAudio,format,normalizeAudio,audio,video=true})` | Sem `audio`, a cadeia é a legada. Com `audio`: `atrim → afade 12 ms nas bordas internas (smoothCuts, a duração não muda) → concat → highpass=f=70,afftdn=nr=10:nf=<piso medido> (noiseReduction) → loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000` aplicado **uma vez só**, mesmo com `normalizeAudio` e `leveling` ligados juntos. `video:false` gera a mesma cadeia só de áudio, usada na prévia. |
| Candidatos de fala | `speechEditCandidates({transcript,duration,track})` devolve os `possibleRetake` legados, sem alteração, mais os tipos `filler`, `repetition`, `retake` e `selfCorrection`. Todos vêm com `selected:false` e trazem `confidence` e `evidence{text, words[], repeatedText?, timing, boundary:'voice'\|'transcript', voicedSeconds?, source:'transcript', boundaryNote}`. O id é `kind-<ms do início>`, então é determinístico. |
| Pausas de ênfase | `refineSilenceCandidates(candidates,{transcript,silences,duration})` encurta (sem eliminar) as pausas depois de `? ! … :` ou antes de um número ou palavra-chave e mantém 0,6 s. Fica marcado `emphasis.source:'inferred'`: é uma **inferência editorial a partir do texto, não entonação medida**. As outras pausas passam sem mudança. |
| Edição pela transcrição | `snapRemoval(range,words,{duration,track,silences})`, `segmentsFromWordRemovals(words,indexes,duration,{track,baseSegments})`, `applyCandidateSelection(candidates,ids,duration,{baseSegments})` (desfazer = desmarcar o id; a mesma entrada dá sempre a mesma saída), `sourceToOutput`/`outputToSource`/`remapSpeechWords`. Tudo usa o mesmo `outputTimeline`/`remapTranscript` que as legendas já usam. |
| `cutReview(..., evidence)` | Recebe um 5º argumento opcional `{words,candidates}`. Com ele, cada corte ganha `removedWords[]`, `candidateIds[]`, `kinds[]` e `reasons[]`. Sem ele, a saída é idêntica à antiga (há teste). |
| Áudio | `assessAudio(...)` devolve canais e layout pelo ffprobe, o piso de ruído RMS nas pausas detectadas, o nível de voz, `noiseReductionAvailable`, um `reason` legível, `limitations` (`noAudio`, `multichannel`, `noSilenceToMeasure`, `noMeasurableNoise`) e `measurement{method:'astats-pauses-v1', versionId, sha256, noiseFloorDb, measuredSeconds, measuredAt, digest}`. `assertMeasuredNoiseFloor(plan.audio, stored, {versionId, sha256})` é a verificação de **procedência** feita no servidor: recusa quando não há medição guardada para essa versão, quando o digest foi alterado ou quando o piso do plano difere do medido. O cliente nunca "prova" uma medição. Há também `proposeAudioTreatment`, `verifyAudioCleanup` (antes × depois, olhando a diferença entre voz e ruído para não confundir o efeito do nivelamento com redução de ruído) e `renderAudioPreview` (WAV de até 30 s do áudio final processado, com o mesmo `cutFilter` da exportação). |

## Como os cortes evitam cortar palavras

1. Cada sugestão é um intervalo de palavras. O corte começa na primeira palavra removida e termina antes da próxima palavra mantida.
2. Com a trilha de voz medida (PCM 8 kHz do FFmpeg, energia a cada 10 ms), as duas bordas são **encaixadas no quadro silencioso mais próximo**. A borda inicial precisa de 60 ms de silêncio medido antes dela, e a final de 80 ms de silêncio medido depois. Se a voz não cai abaixo do limiar dentro de ±250 ms, a sugestão é **descartada** (`unsafeBoundary`). Se não há voz medida dentro do trecho que seria removido (o Whisper "ouviu" algo que o áudio não tem), também é descartada (`noVoiceEvidence`).
3. Sem a trilha de voz, as bordas vêm só da transcrição (`boundary:'transcript'`), a confiança cai para `low` e entra `voiceUnavailable` nas limitações. Uma transcrição importada sem tempos por palavra não gera nenhum corte por palavra (`wordTimingUnavailable`): ficam só as retomadas por frase, como antes.
4. As margens **não garantem** que fonemas sejam preservados. O `boundaryNote` explica que os tempos do Whisper são aproximados (erro de 0,2–0,5 s perto de pausas) e que só as bordas com vale de energia medido sobrevivem.

## Evidência (saídas reais)

Comandos focados (não rodei a suíte global nem o build, que ficam com o integrador):

- `node --test tests/speech-edit.test.mjs tests/speech-audio-media.test.mjs tests/smart-edit.test.mjs`: **14/14 pass**.
- `node --test tests/smart-edit-media.test.mjs tests/motion-plan.test.mjs tests/motion-media.test.mjs`: **22/22 pass**. Os consumidores atuais de `editorial-smart-edit` continuam funcionando.
- `npx tsc --ignoreConfig --noEmit --strict --module nodenext ... editorial-smart-edit.d.mts editorial-speech-edit.d.mts editorial-audio-cleanup.d.mts`: sem erros.

**Fixture de fala (FFmpeg real, `tests/speech-audio-media.test.mjs`).** Nove "palavras" feitas de tons harmônicos (140–240 Hz) com pausas reais entre elas. Os tempos no estilo Whisper foram passados **atrasados** (+120 ms no início, +50 ms no fim) para simular o desvio do reconhecedor.

- O `ahn` real fica em 1,10–1,45 s; o Whisper disse 1,22–1,50 s. O corte sugerido foi **1,095–1,715 s**: começa 5 ms antes do início real e termina 85 ms antes do início real da palavra seguinte (1,80 s). Confiança `high`, 0,35 s de voz medida dentro do trecho.
- O primeiro `eu` real fica em 1,80–2,00 s; o corte foi **1,795–2,065 s** (`repetition`, `medium`).
- Exportação real com esses dois cortes e `smoothCuts`: duração planejada 6,03 s, ffprobe mediu 6,055 s. Todas as 7 palavras mantidas foram medidas de novo no arquivo final. Cada uma aparece no tempo dado por `sourceToOutput` com no máximo **+20 ms** de diferença e mantém a duração (diferença de no máximo +10 ms, que é a resolução da medição). Nenhuma palavra perdeu o início ou o fim. O SHA-256 do original não mudou.

**Tratamento de voz (FFmpeg real).**

- Fonte com ruído uniforme (pausas a −45,0 dBFS RMS em 2,35 s medidos; voz a −12,7 dBFS): `noiseReductionAvailable:true`. Comparando o export com o tratamento e o mesmo export sem ele, nas mesmas pausas: ruído de **−46,0 para −54,8 dBFS (−8,9 dB)** e voz de −13,24 para −13,34 dBFS (−0,1 dB). `verifyAudioCleanup` deu `improved:true`, com a diferença voz/ruído **8,8 dB** maior.
- Fonte limpa, com pausas digitalmente silenciosas: `noiseFloorDb:null`, `noMeasurableNoise`, *"Pausas digitalmente silenciosas: não há ruído para reduzir."* A proposta mantém `noiseReduction:false`, e tentar forçá-la com um piso inventado é recusado por `assertMeasuredNoiseFloor`.
- Fonte 5.1 (6 canais): `multichannel` nas limitações, piso de −47,7 dBFS medido em todos os canais. Com nivelamento, cortes suaves e redução de ruído, a saída medida pelo ffprobe ficou com **6 canais, layout 5.1**. É um resultado medido nesta fixture, não uma garantia: outros layouts dependem do encoder.
- Vídeo sem áudio: `limitations:['noAudio']`, `measurement:null`.
- Cancelamento: com um sinal já abortado, ou abortado durante a medição, a chamada é rejeitada com *"Media operation canceled."* e nada é relatado como medido.
- Prévia: `renderAudioPreview` gerou um WAV `pcm_s16le` de exatamente 2,000 s da janela 3–5 s do editado, com a mesma cadeia do export. É o áudio final processado.
- Ajuste feito com base em medição: com `afftdn ... :tn=1` (rastreamento de ruído) a redução ficou em só −1,7 dB; sem `tn` ficou em −8,4 dB na mesma fixture. Por isso o filtro final não usa `tn`.

Fonte técnica: a ajuda oficial do FFmpeg 9.0.1 instalado (`ffmpeg -h filter=afftdn`: `nr` de 0,01 a 97, `nf` de −80 a −20, `tn` desligado por padrão; `-h filter=loudnorm`), junto com o comportamento medido acima. Não usei rede nem fontes de terceiros.

## Patch proposto ao integrador (C, dono de `editorial-media.mjs`)

Eu não editei esses arquivos. O contrato completo foi enviado ao C (`dispatch:ctx_e34940293516`).

1. `analyze`:
   - trocar `retakeCandidates(transcript)` por `speechEditCandidates({transcript,duration:metadata.duration,track})`. O `track` vem de `voiceTrack(await extractVoicePcm({ffmpeg,inputPath,signal}))` quando houver áudio; ele já é calculado e guardado em cache por `motion`, então dá para reaproveitar o `voiceCache`;
   - opcionalmente, passar os candidatos de silêncio por `refineSilenceCandidates`. Isso **muda** `suggestedSegments`, então deve ficar atrás de uma opção;
   - devolver também `analysis.audio = await assessAudio(...)` e persistir `measurement`, por exemplo junto de `editorial_silences`.
2. `plan()`, `enqueueAdvanced`, `launch` e `retry`: chamar `assertMeasuredNoiseFloor(plan.audio, storedMeasurement, job)`.
3. `launch` avançado: `cutFilter(job.plan.segments,{hasAudio,format:job.plan.format,normalizeAudio:job.plan.normalizeAudio,audio:job.plan.audio})`.
4. `review`: `cutReview(segments,duration,speech,silences,{words:transcript.words,candidates})`. Para isso os candidatos da análise precisam ser guardados, ou então recalculados de forma determinística a partir da transcrição e da trilha.
5. UI e coordinator: nenhuma mudança é obrigatória. Os tipos novos vêm com `selected:false`, e o coordinator já filtra `possibleRetake`. Para exibir a evidência, usar `confidence`, `evidence.text` e `evidence.boundary`.

## Limites reais

- **Nenhuma voz humana foi usada.** Toda a validação foi feita com tons sintéticos e transcrições escritas à mão. Os limiares (silêncio 60/80 ms, encaixe de ±250 ms, piso de −62 dBFS) precisam ser calibrados com gravações reais. Em fala humana corrida, com coarticulação, muitas repetições ("eu eu") **não têm vale de energia** e serão descartadas como `unsafeBoundary`. Isso é o comportamento honesto, mas reduz a cobertura.
- O Whisper muitas vezes **omite** as muletas ("ahn", "é…") da transcrição. Sem a palavra transcrita não há sugestão, e não existe detector acústico de hesitação.
- As muletas lexicais (tipo, né, então, like) e as autocorreções ("quer dizer", "digo") têm confiança `low` e dependem do sentido. O início do trecho "errado" numa autocorreção é estimado (volta até 6 palavras ou até a pausa anterior).
- As pausas de ênfase são inferidas pela pontuação, números e uma lista curta de palavras-chave, não pela entonação medida.
- A redução de ruído é conservadora (10 dB, FFT de banda larga): funciona para chiado estacionário e não para ruídos impulsivos, música ou eco. A medição feita a 48 kHz cobre a banda inteira, mas usa as pausas detectadas pelo `silencedetect` (−35 dB); se o ruído passar disso, as pausas não são detectadas e o resultado é `noSilenceToMeasure`.
- O nivelamento usa `loudnorm` em uma passada só (sem medição prévia de duas passadas), exatamente como o `normalizeAudio` que já existia.
- No export real apareceu um deslocamento sistemático de até +20 ms nas palavras depois de um corte (granularidade de quadro do AAC no concat). Fica dentro da tolerância de ±30 ms dos testes, mas existe.
- As amostras 5.1 deste teste mantiveram o layout; não há garantia para layouts exóticos.
- Ainda não está ligado ao app: depende do patch do integrador acima. A UI de revisão ainda não mostra os tipos novos.
