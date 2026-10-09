# Edição semiautomática — template Remotion de overlays (relatório)

Data: 07/10/2026. Escopo: um template local (título inicial, tarja lower-third, CTA final) sobre vídeo **já cortado**. Remotion/@remotion/renderer/@remotion/bundler 4.0.534 exatos (já na raiz; package/lock/deps não foram tocados).

## Entregas

| Arquivo | Papel |
|---|---|
| `remotion-video/**` | Composição React/TS (`Root.tsx`, `Overlays.tsx`, `types.ts`, `index.ts`, `tsconfig.json`). Somente fonte do sistema e CSS; sem imagens externas, sem JS/HTML do usuário. Texto sempre renderizado como texto (React escapa). |
| `editorial-remotion.mjs` / `.d.mts` | Adapter, validação, servidor de mídia loopback, capacidades, diagnóstico de navegador. |
| `scripts/build-remotion-video.mjs` | Gera o bundle pré-compilado em `dist/remotion` (entry fixo `remotion-video/index.ts`; ~10 s). |
| `scripts/test-remotion-video.mjs` | Smoke real (vídeo sintético 320x180@15fps com áudio stereo) + frames de QA. |
| `tests/remotion-video.test.mjs` | 9 testes (7 unitários/segurança + 2 de render real). |
| `docs/analysis/editing-remotion-frames/` | Frames início/meio/fim, antes e depois (PNG 3x). |

## Contrato (para engine/UI)

```ts
renderAnimatedVideo({inputPath, outputPath, metadata, animations, signal?, onProgress?, browserExecutable?, bundleDir?, ffprobePath?})
  -> {outputPath, width, height, fps, durationSeconds, hasAudio, browser, animations /* resolvidas */}
getRemotionCapabilities() -> {available, template, versions, bundle, browser, ffprobe, license, reasons[]}
validateAnimations(raw, metadata) -> animações resolvidas (from/to absolutos em s) | RemotionError
prepareRemotionBrowser() // download local OPT-IN do navegador; nunca chamado implicitamente
```

- `metadata = {width,height,fps,durationSeconds,hasAudio}` do vídeo cortado (probe do engine). O adapter **reprobe** a entrada e recusa com `metadata_mismatch` se divergir (dimensões, fps, duração ±1 frame+0,1 s, áudio).
- `animations = {title?:{text≤80,startSeconds?,durationSeconds?}, lowerThird?:{name≤60,role?≤80,startSeconds?,durationSeconds?}, cta?:{text≤80,durationSeconds?}, theme?:'dark'|'light', accent?:'#RRGGBB'}`. Chaves desconhecidas, caracteres de controle/bidi, tipos errados e cores livres são rejeitados. Os textos viram a identidade do plano: hash deve ser calculado sobre a spec **resolvida** (`resolveAnimations`), que é determinística.
- Tempos padrão: título 0,3 s + 3 s; tarja 1,2 s + 4 s; CTA = últimos 3 s. Alinhados ao frame, limitados à duração; fade de 0,3 s.
- `onProgress({phase:'browser'|'render'|'verify', progress:0..1})`. `signal` (AbortSignal) → `RemotionError.code === 'cancelled'`.
- Códigos de erro: `invalid_metadata|invalid_animations|invalid_input|invalid_output|output_exists|dependency_missing|bundle_missing|browser_missing|probe_failed|metadata_mismatch|render_failed|verify_failed|cancelled`.
- Saída: renderiza em arquivo temporário oculto ao lado do destino, verifica (dimensões, duração ±2 frames+0,1 s, áudio presente, codec h264) e publica sem sobrescrever (hard link/`COPYFILE_EXCL`). Falha/cancelamento removem o temporário e não criam destino.

## Segurança

- Só `inputPath` absoluto, arquivo regular, extensão de vídeo; a verificação de origem/hash é do engine. Sem URL externa nem caminho vindo da composição.
- Mídia servida por HTTP em `127.0.0.1` porta efêmera, rota única `/media/<token de 24 bytes>`; allowlist por token (nunca caminho da URL), GET/HEAD, `Range` (200/206/416), `Host` validado (anti DNS-rebinding), `no-store`, arquivo alterado após verificação → 409. Testado contra token errado, `..`, `%2e%2e`, caminho absoluto, `/secret`.
- **Achado importante:** o servidor interno do Remotion (bundle + `/proxy` do OffthreadVideo) escuta em `::`/`0.0.0.0` (`port-config.js`, sem opção de host). O adapter força loopback para listeners criados dentro de `@remotion/renderer` enquanto o render roda (patch refcounted e restaurado de `net.Server.prototype.listen`, restrito pela stack). O teste confere via `netstat` durante um render que todos os listeners do processo estão em `127.0.0.1`. Risco residual: outro processo local ainda pode alcançar a porta efêmera do Remotion durante o render (segundos). Se o Remotion mudar a implementação, o teste acusa.
- Nenhum bundle de projeto arbitrário: apenas `dist/remotion` pré-compilado.

## Navegador, cache e dependências

- Ordem de resolução (`resolveBrowser`, sem baixar): `browserExecutable` > cache Remotion do projeto (`<cwd>/node_modules/.remotion`) > Chrome/Edge do sistema. Nenhum → `browser_missing` com instrução. Download só via `prepareRemotionBrowser()` (headless-shell, local, sem custo, sem cloud). Observação: o cache usa `process.cwd()`; no app empacotado prefira passar `browserExecutable` (Chrome/Edge do sistema ou binário em pasta de ferramentas) em vez de depender do cwd.
- Verificado neste PC: Chrome 154 do sistema funcionou (`chromeMode: 'chrome-for-testing'`), sem download. FFmpeg/ffprobe: o adapter usa o `ffprobe` do pacote `@remotion/compositor-*` ou PATH; o teste usa `ffmpeg` do PATH só para gerar o vídeo sintético.
- Cache/temporários: `offthreadVideoCacheSizeInBytes` fixo em 128 MB; Remotion limpa seu diretório temporário próprio; o adapter limpa o seu.

## Resultados verificados (máquina real, sem mocks)

Smoke (`node scripts/test-remotion-video.mjs`, ~8 s): saída 320x180, 15 fps, 6,016 s (entrada 6,000 s: +1 frame do muxer), h264 + aac; frames 1,0 s (título+tarja), 3,5 s (limpo) e 5,5 s (CTA) com diff de pixel 8,7 / 2,4 (ruído de recompressão) / 4,3; timestamp visível do `testsrc2` coincide com o instante pedido (sincronia). Áudio stereo: RMS 2892 → 2887 (preservado). Cancelamento no meio do render: `cancelled`, sem arquivo nem temporário.

**Limitações conhecidas**
- Vídeo é re-codificado (h264 crf 20, yuv420p) e o áudio re-encodado em AAC 48 kHz **stereo**. Fonte **mono** sai com −3 dB (mono→stereo do compositor; medido); stereo mantém nível idêntico.
- A saída pode ter +1 frame de duração (6,016 s vs 6,000 s). Engine deve comparar com tolerância (o adapter usa ±2 frames).
- Fonte Segoe UI/Helvetica/Arial: depende da fonte do sistema (Windows ok); sem emoji colorido garantido.
- Só 1 composição, mesma ordem de camadas; sem proporção diferente da entrada (usa `objectFit: contain`, mas a composição tem as dimensões da entrada).

## Docs oficiais consultadas e licença

- `renderMedia`: `cancelSignal` via `makeCancelSignal`, `serveUrl` local, `enforceAudioTrack`, `muted`, `chromeMode`, `browserExecutable`, `offthreadVideoCacheSizeInBytes` conforme usado. `ensureBrowser`: baixa um navegador local se não houver e `browserExecutable` não for informado (e lança se o caminho não existir) — por isso o adapter nunca chama o render sem navegador resolvido (evita download implícito).
- Licença (LICENSE.md instalado e página oficial): grátis para indivíduos, empresas com fins lucrativos de até 3 funcionários, ONGs e avaliação; empresas maiores exigem **Company License paga** (a v5 muda alguns termos). Fica exposto em `capabilities.license.requiresReview = true`. Nada foi contratado. Decisão de licença é do titular do produto.

## Para o coordenador (empacotamento)

- `build.files`: incluir `dist/remotion/**/*` (já coberto por `dist/**/*`) e adicionar `editorial-remotion.mjs`.
- `asarUnpack` obrigatório: `node_modules/@remotion/compositor-*/**` (remotion.exe/ffmpeg/ffprobe não executam de dentro do asar) e, por segurança, `node_modules/@remotion/renderer/**`; dependências de runtime (`remotion`, `@remotion/renderer` e transitivas) precisam estar em `files`/`dependencies` (hoje estão em `dependencies`). `@remotion/bundler` só é necessário no build, não no pacote.
- O bundle pré-compilado deve ser gerado no `npm run build` (`node scripts/build-remotion-video.mjs`); alterar `package.json` é do coordenador.
- Para o app empacotado, chamar o adapter com `browserExecutable` explícito ou garantir cwd com cache; decidir se o instalador oferece `prepareRemotionBrowser()` com consentimento (download ~100 MB, uma vez).
- `resolveFfprobe` já procura em `app.asar.unpacked`.
- Não rodei `npm run build`/typecheck da raiz (tsconfig raiz não inclui `remotion-video`); `tsc -p remotion-video/tsconfig.json` passa sem erros.
