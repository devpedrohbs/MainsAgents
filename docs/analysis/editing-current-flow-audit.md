# Edição automática — percurso real e lacunas (auditoria 07/10/2026)

## Percurso do usuário hoje (código atual)

1. **Produção → Gravação** (`ProductionDialog.tsx`): associa o vídeo bruto na biblioteca, escolhe formato e “Tipo de edição” (padrão **Automática**), clica “Enviar vídeo e iniciar edição automática” → ação `video {editMode:'smart',authorize:true}` (`production-coordinator.mjs`).
2. **planning-edit** (`planSmartEdit`): `media.capabilities()` → `media.transcribe` (whisper.cpp local, cache por versão/sha) → agente Editor (runtime configurado do usuário) devolve só parâmetros/textos (`validateSmartEditDirection`) → `media.analyze` (FFmpeg `silencedetect` + retomadas da transcrição, nunca cortadas) → `media.plan` (planHash).
3. **editing**: `media.enqueue` modo `advanced` → FFmpeg `trim/atrim/concat` → Remotion (`editorial-animate.mjs` → `editorial-remotion.mjs`) se houver animações e navegador → verificação (duração/áudio/hash da fonte) → novo asset de saída + `.srt` (tempo editado) se houver transcrição.
4. **video-review**: “Conferir edição (bruto × editado)” (`EditReview.tsx`) — players via `GET /api/content/media/file`, cortes com fala sinalizada, manter/ajustar cortes, cortar retomada, prévia pulando cortes, “Exportar versão com meus ajustes” → “Usar esta versão na produção” (`use-edited-video`) → “Aprovar este vídeo”.
5. **CapCut**: “Mostrar MP4 na pasta” / “Mostrar legendas (.srt)” → importar no CapCut (Texto → Legendas → Importar).

## Lacunas encontradas

| # | Lacuna | Impacto | Dono/ação |
|---|---|---|---|
| G1 | Whisper (`whisper-cli` + DLLs + `ggml-base.bin`) só existe em `.mainsagents-workspaces/tooling/whispercpp`; nada no pacote | App instalado: transcrição/SRT/retomadas indisponíveis (aparece como indisponível, sem falso transcript) | Integração: `extraResources` → `resources/tools/whispercpp` (já procurado pelo `desktop-main.mjs`) |
| G2 | Navegador do Remotion resolvido implicitamente (cache via `process.cwd()` ou Chrome do sistema) | Empacotado: cwd imprevisível; diagnóstico pouco explícito | Integração: resolver Chrome/Edge do sistema uma vez e passar `browserExecutable` explícito; `MAINSAGENTS_BROWSER` para override |
| G3 | `media.subtitles` não recusa job restaurado de backup (`imported`) | Backup poderia disparar transcrição/escrita sem nova ação local | Corrigir (Rodada 4, `editorial-media.mjs`) |
| G4 | Transcrições (`editorial_transcripts`) não entram no backup | Após restaurar, re-transcreve sob demanda; não concede execução | Aceito (cache recalculável) |
| G5 | FFmpeg/ffprobe vêm do PATH (não empacotados) | Sem FFmpeg no PATH, edição indisponível com aviso | Fora do escopo desta rodada |
| G6 | Tela “Conferir edição” e início smart nunca rodaram no Electron | Risco de UI | Teste Electron real nesta rodada |
| G7 | Áudio mono via Remotion −3 dB | Qualidade | Sonnet (`editorial-remotion`) |

## Resultado da rodada de integração/validação

| Lacuna | Situação |
|---|---|
| G1 Whisper fora do pacote | **Corrigido**: `package.json` `build.extraResources` → `resources/tools/whispercpp` (whisper-cli + 4 DLLs + `ggml-base.bin`, 144 MB). Verificado no pacote. |
| G2 navegador implícito | **Corrigido**: `editorial-animate.mjs` resolve Chrome/Edge instalado por caminho explícito (ou `MAINSAGENTS_BROWSER`), passa `browserExecutable` e diagnostica a ausência sem baixar nada. Neste PC: `C:\Program Files\Google\Chrome\Application\chrome.exe`. |
| G3 legendas em job restaurado | **Corrigido** (`editorial-media.mjs`): `media.subtitles` recusa `imported`. Testado com `executionSnapshot`/`restoreExecution`; transcrições não entram no backup. |
| G6 UI nunca rodou | **Validado** no Electron real (abaixo). |
| **Novo bug crítico — pacote** | Dentro do app empacotado, o `@remotion/renderer` executava o compositor (`ffprobe.exe`/`remotion.exe`) de dentro de `app.asar` → `ENOENT`/`EPIPE`, sem overlays. **Corrigido** com autorização do coordenador em `editorial-remotion.mjs`/`.d.mts`: `resolveBinariesDirectory()` (asar → asar.unpacked) passado como `binariesDirectory` para `selectComposition` e `renderMedia`; `resolveFfprobe` também fora do asar. Composição, correção de áudio, `checkFfmpeg` e loopback preservados. |
| **Novo bug — aviso falso** | “Fala reconhecida neste corte” aparecia em pausas puras: o Whisper estende as frases sobre as pausas e o tempo das palavras deriva até ~1 s (DTW também não serviu neste build). **Corrigido**: a análise de silêncio do FFmpeg fica guardada por versão (`editorial_silences`); o aviso mede só a parte do corte que **não** é silêncio detectado (“Este corte remove X s com som…”) e é recalculado na hora quando o usuário mexe nas bordas. As frases do Whisper agora usam o início/fim das palavras (`-ojf`), deixando as legendas `.srt` mais justas. |
| G5 FFmpeg do PATH | Mantido (fora do escopo). O corte principal usa `ffmpeg` do PATH. |
| Observação | `@remotion/bundler` está em `dependencies`, então vai para o pacote (inclui `esbuild.exe` desempacotado); só é usado no build. A mudança é do coordenador. |

## Testes executados (reais)

- `npm run build` ok (tsc + Vite + bundle Remotion uma vez; sem patch de `source-map-js` necessário). `tsc -b` ok. Suíte `node --test` **334/334**.
- `npx electron scripts/test-smart-edit-ui.mjs` (novo) — Electron real, voz pt-BR offline do Windows, Whisper/FFmpeg/Remotion reais, agente e provedores simulados: produção inicia no modo automático → 15,08 s → 9,00 s, 3 cortes, 1 possível retomada, título + CTA, `.srt` → “Conferir edição” carrega bruto e editado pelo stream → nenhum aviso nos cortes de pausa; alargar um corte avisa “remove 0,6 s com som: ‘Hoje vamos falar de edição.’” → usuário mantém um trecho → exporta (10,21 s) → “Usar esta versão na produção” → cancelar → `canceled` sem entrega; reinício no meio → `interrupted` → retomada explícita → `succeeded`; fonte adulterada → stream 409 e plano recusado; sha256 do original inalterado. Artefatos em `.mainsagents-workspaces/smart-edit-ui/<ts>/` (prints, frames, `captions.srt`, `journey.log`).
- `npx electron scripts/test-semi-production-ui.mjs` — continua OK no modo automático.
- `npx electron-builder --win dir` (somente pasta, sem instalador) + `npx electron scripts/test-packaged-media.mjs release/win-unpacked` (novo): o motor é carregado **de dentro do `app.asar`**; Whisper vem de `resources/tools`, o compositor de `app.asar.unpacked`, o Chrome do sistema por caminho explícito; exportação real 10,13 s → 5,17 s com overlays + `.srt`; original intacto. Frame do título salvo em `.mainsagents-workspaces/packaged-media/<ts>/packaged-title.png`.

## Arquivos desta rodada

`editorial-animate.mjs`, `editorial-remotion.mjs` + `.d.mts` (apenas o patch de `binariesDirectory`), `editorial-transcribe.mjs`, `editorial-smart-edit.mjs`, `editorial-media.mjs`, `src/components/content/EditReview.tsx`, `src/features/content/model.ts`, `package.json` (`extraResources`), novos `scripts/test-smart-edit-ui.mjs`, `scripts/test-packaged-media.mjs`, `tests/editorial-animate.test.mjs`; ajustes em `tests/smart-edit-media.test.mjs` e `tests/transcribe.test.mjs`.

## Pendente

Instalador completo (NSIS) e o tamanho final (+144 MB do Whisper); FFmpeg empacotado; teste com vídeo real do usuário; correção do mono −3 dB do Remotion (já com Sonnet).

## Fechamento das mensagens do coordenador

- **Whisper reproduzível**: `scripts/prepare-whisper-tools.mjs` (chamado no fim do `npm run build`) copia para `build-resources/whispercpp` (no `.gitignore`) só arquivos com SHA-256 fixado: whisper.cpp v1.7.6 x64 (`whisper-cli.exe` + 4 DLLs) e `ggml-base.bin`. Grava `MANIFEST.json` (versão, hashes) e `THIRD-PARTY-LICENSES.txt` (MIT whisper.cpp e OpenAI Whisper). Em um clone sem as ferramentas, grava `available:false` com o motivo; o build não falha, não baixa nada e o app mostra a transcrição como indisponível. `extraResources` agora lê `build-resources/whispercpp` (não depende mais de caminho pessoal).
- **Tempos do Whisper**: transcrições novas guardam `timing:'words'` (spans de palavras); caches antigos aparecem como `timing:'sentences'`. A tela diz “tempos aproximados por palavra/frase” e deixa claro que o aviso de som vem da análise de áudio. Transcrição importada sem spans continua marcada como “Possível fala… (pela transcrição; ouça para confirmar)”. Nada é apagado; a recalibração acontece só numa nova transcrição.
- **Legendas sem duplicação**: teste de uma frase que atravessa uma pausa removida gera uma legenda só, sem repetir e sem perder texto mantido; a fala que fica inteira dentro do corte some. Testados também tokens especiais, offsets inválidos e `[Música]`. Limite conhecido: uma palavra cortada no meio de uma frase continua no texto da legenda, porque o tempo das palavras do Whisper deriva até ~1 s neste build e usá-lo para apagar texto poderia remover fala mantida.
- **Stream com versão verificada**: além do tamanho, o player só recebe o arquivo cujo sha256 bate com a versão revisada. O hash é calculado uma vez por estado do arquivo (caminho, tamanho, mtime, ctime) e as leituras por faixa reaproveitam. Teste: alteração do mesmo tamanho com o mtime original restaurado → 409; bytes restaurados → 206. Risco residual: uma troca durante a própria leitura não é detectada naquele request; a exportação continua conferindo o hash da fonte.
- **Adapter do Sonnet**: as novas `checkFfmpeg`/correção de áudio foram preservadas; o único patch é `binariesDirectory`/`resolveFfprobe` (autorizado). Testes do adapter passam na suíte.
- **Pacote QA isolado**: `electron-builder --win dir -c.directories.output=.mainsagents-workspaces/packaged-editing`, sem instalador.
  - `app.asar` sha256 `bd8e1ff7a73cb963a943fb884432110102a2193c950fed2368bbb258f5e79d64` (85 MB).
  - `app.asar.unpacked` 121 MB; `tools/whispercpp` 144 MB (`MANIFEST.json` `1a4ed190…`).
  - `dist/remotion/index.html` `78e352ad…`.
  - `scripts/test-packaged-media.mjs .mainsagents-workspaces/packaged-editing/win-unpacked` → `PACKAGED_MEDIA_OK`.
- **Recibos antigos**: nas execuções anteriores desta rodada, `release/win-unpacked` foi sobrescrito por um `--dir`. Os recibos `release/MainsAgents-0.3.54-verification.json` e o instalador 0.3.54 **não** correspondem ao asar atual e não validam este pacote. Nada foi restaurado nem publicado.
- **Resultado final**: suíte **336/336**, `tsc -b` ok, `npm run build` ok, `test-smart-edit-ui` e `test-semi-production-ui` ok no Electron, smoke do pacote QA ok.
