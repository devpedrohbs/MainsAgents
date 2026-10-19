# Motor de motion autorado (Remotion): pesquisa, decisão e entrega A (2026-10-12)

## 1. Pesquisa (fontes primárias consultadas em 2026-10-12)
- Remotion Agent Skills (https://www.remotion.dev/docs/ai/skills) e as regras do `remotion-markup` no GitHub (packages/skills): animar só com `useCurrentFrame()` + `interpolate()`, usar `Easing.bezier`/`Easing.spring`, e não usar CSS `transition`/`animation`. `premountFor={fps}` em itens temporizados. `TransitionSeries` para cenas.
- Coding agents (https://www.remotion.dev/docs/ai/coding-agents): o fluxo indicado é um projeto Remotion local, com as skills e a prévia no Studio, editado pelo agente.
- AI SaaS template (https://www.remotion.dev/docs/ai/ai-saas-template), mais os guias Generate (/docs/ai/generate) e Dynamic compilation (/docs/ai/dynamic-compilation): o LLM gera código, que é compilado JIT com `@babel/standalone` e `new Function`. A própria doc avisa que o código "runs in the global scope of the browser" e sugere um iframe sandbox mais CSP. O guia Generate trata a saída como algo a sanitizar (cercas de markdown, schema e retry).
- Flickering (https://www.remotion.dev/docs/flickering): o render é multi-aba, então tudo depende do frame. Nada de aleatoriedade (exceto `random()`), nada de CSS animation, nada de `background-image`/`mask-image`. Usar `<Img>`/`<OffthreadVideo>`.
- renderStill (/docs/renderer/render-still): renderiza um frame. Com `puppeteerInstance` reaproveita o navegador entre chamadas.
- renderMedia (/docs/renderer/render-media): aceita `frameRange` inclusivo para gerar trechos. `inputProps` precisa ser igual ao do `selectComposition`.
- Transitions (/docs/transitions e /docs/transitions/transitionseries): numa `TransitionSeries` as transições encurtam a timeline, e os overlays não.
- Motion Canvas (https://motioncanvas.io/docs, /docs/flow, /docs/rendering): animação por generators. Ele mesmo se descreve como ferramenta para animações explicativas e não como substituto de editor de vídeo. O render sai do editor no navegador como sequência de imagens, e a doc não descreve render headless.
- DaVinci Resolve 21.1 (readme oficial em blackmagicdesign.com/support/content/readme/baf7c071c0524fbf8ccc961925c9f443): servidor MCP nativo e novas APIs de scripting. O scripting avançado é exclusivo da versão Studio, que é outra instalação e outra licença.

**Inferências (minhas, não das fontes):**
1. Executar React gerado exigiria isolar de verdade imports, fs, rede e IPC. Num Electron com um broker de mídia local, isso é risco alto para pouco ganho.
2. Motion Canvas e Resolve trocariam a pilha (instalação, licença, render) sem resolver o gargalo real, que era o limite de 3 overlays fixos.
3. O `@remotion/transitions` não está instalado e eu não posso alterar package.json. Por isso as transições foram feitas com matemática de frame e `clip-path`.

**Decisão:** um scene graph declarativo e expressivo (`mainsagents.storyboard/1`) que o Claude escreve como DADOS e que é renderizado por um compositor Remotion genérico. A composição é a mesma (`OverlayVideo`, prop `storyboard`) na prévia via Player, nos stills e no MP4. Não há eval nem código gerado.

## 2. O que foi implementado (ownership A)
- `editorial-storyboard.mjs` / `.d.mts` (puro e browser-safe):
  - `validateStoryboard`: cenas, camadas, keyframes, easing e bezier; exige `segmentsHash`, então se os cortes mudarem o storyboard dá erro explícito em vez de ficar desalinhado.
  - `resolveStoryboardProps` (frames), geometria compartilhada (área segura, faixa da legenda, câmera e slots) e `fitText`.
  - `storyboardFactProblems`: todo número precisa existir na fala ou no briefing; citações precisam ser literais; a fonte `user` só vale se o host confirmar o texto via `userTexts`; a fonte `design` não pode ter números.
  - `storyboardQa`: checa área segura, faixa da legenda, sobreposição, contraste, rosto coberto, tempo de leitura, transição sobre corte e `droppedLayer`.
  - Também: `qaFrames`, `storyboardManifest`, `storyboardJsonSchema` (draft-07) e `storyboardScenes`.
- Primitivas: text (modos words, chars, lines e typewriter, com destaques marker, underline, box e color), counter, steps, process, compare, bars, image e vídeo B-roll (molduras browser, phone e card, Ken Burns), shape, arrow desenhada, callout com alvo, chapter e spotlight.
  - Câmera: full, split-left, split-right, split-top, pip e hidden, com zoom por keyframes e foco.
  - Transições: cut, fade, slide, push, wipe, iris e zoom.
  - Máscaras via `clip-path`. Fundos em SVG (solid, gradient, grid e dots).
  - SFX discretos (até 6 por minuto, espaçados no mínimo 1,5 s, entre −36 e −10 dB), mixados pelo pipeline local que já existia.
- Três tratamentos realmente diferentes: `creator` (Bahnschrift, amarelo e preto, pop e sticker), `editorial` (Georgia, creme e laranja, fades) e `technical` (Cascadia, blueprint em grade, wipe e iris).
- `remotion-video/storyboard-anim.ts` e `Storyboard.tsx` (tudo derivado do frame), além de `types.ts` e `Overlays.tsx`.
- `editorial-remotion.mjs`:
  - `resolveAnimations` aceita `storyboard`.
  - `assetFiles` passa a aceitar `{path, sha256}`. O hash real do arquivo é recalculado e precisa bater (`asset_hash_mismatch`). Vídeo B-roll também é aceito.
  - `renderAnimatedVideo` ganhou `frameRange` (trecho com o áudio e os SFX da mesma janela), `qaPolicy` (`'block'` por padrão, retornando `qa_failed` com o relatório) e `cutsAt`. O resultado inclui `storyboard{qa, manifest}` com o sha256 da fonte, o `compositionSha256` e avisos de HDR ou rotação.
  - `renderStoryboardStills`: entrada, meio e saída por cena, filtro `sceneIds`, `tags` (revision e planHash), `maxImages` e contact sheets de até 16 quadros. `probeVideo` agora informa rotação e color transfer.
- `editorial-smart-edit.mjs`: `validatePlan` aceita `plan.storyboard`, exclusivo com os overlays fixos e as cues automáticas (o reframe continua valendo). `needsAnimation` e `remotionAnimations` foram atualizados.
- `editorial-animate.mjs`: novo `animator.stills()`; os erros preservam `code` e `details`.
- Testes:
  - `tests/storyboard.test.mjs` e `tests/storyboard-anim.test.mjs` (unitários).
  - `tests/storyboard-render.test.mjs`: render REAL com stills, trecho, hash de asset e bloqueio por QA.
  - `tests/remotion-video.test.mjs`: atualizado para incluir a capability `storyboard`.
- Script `scripts/storyboard-demo.mjs`, com as fases prepare, render e before.

## 3. Evidências (fixtures SINTÉTICAS: FFmpeg mais voz offline do Windows; nenhum vídeo pessoal)
Ficam em `docs/analysis/editing-ai-motion-engine-2026-10-12/`. Os storyboards autorados estão em `storyboards/*.json`. Cada demo tem `stills/contact-sheet-00.jpg`, `excerpt.mp4`, `final.mp4`, `final-NNNN.jpg` (frames do MP4 nos mesmos instantes dos stills) e `report.json` (QA e manifesto).

| Demo | Assunto | Tratamento | QA | Render final |
|---|---|---|---|---|
| edicao-creator-9x16 | edição de vídeo | creator | ok, 0 avisos | 65 s, áudio mixed-sfx |
| juros-editorial-16x9 | juros compostos | editorial (print do usuário com hash) | ok, 0 avisos | 51 s |
| juros-technical-9x16 | juros compostos | technical (diagrama, laço, spotlight, barras) | ok, 0 avisos | 55 s |

O "antes" (motor anterior: 3 overlays mais cues heurísticas, no mesmo corte) está em `before-edicao/` e `before-juros/`, com contact sheet e MP4. No juros, o motor anterior gerou só 2 momentos e 1 explicativo.

A QA pegou problemas reais durante as iterações, todos corrigidos antes do MP4 final:
- contraste branco sobre amarelo, que vinha de uma regra de cor divergente entre a QA e o render (unifiquei em `textColorToken`);
- callout sobreposto ao título de capítulo;
- headline em cima do rosto;
- palavras quebradas no meio.

O whisper ouviu "1.120 e sete" no lugar de "mil cento e vinte e sete". Por isso esse número foi citado do briefing (`source: brief`), e a prova de fatos teria barrado a versão `speech`.

## 4. Contrato com B/C (enviado) e pendências de integração (fora do meu ownership)
- C: incluir `editorial-storyboard.mjs` em `package.json` `build.files`. Sem isso, o app empacotado quebra no import.
- C: passar `assetFiles` com os assets registrados ao chamar `animate`. Hoje o `editorial-media` não passa, e é por isso que as imagens de explicativo nunca apareciam.
- C: chamar `storyboardFactProblems` com transcrição, briefing e `userTexts` do host, e expor `storyboardScenes` no validatePlan para o gate de cobertura de B.
- C/B: ligar o handoff do CLI Editor (editor-authoring/1) a `validatePlan`, `animate({frameRange})`, `stills({sceneIds, tags})` e ao export final.
- C: rebuildar o bundle com `node scripts/build-remotion-video.mjs`. Já rebuildei `dist/remotion` localmente.

## 5. Limites honestos
- Medidas de texto são estimativas (largura média por caractere). Os stills são a verificação real e devem ser revisados antes do MP4.
- A caixa de "rosto" na QA é heurística: usa o foco da cena ou do reframe, não um detector facial.
- O counter mostra valores intermediários enquanto anima (por exemplo 1081 a caminho de 1127). O valor final é o citado.
- Fatos sem número escritos como `design` não têm verificação semântica.
- Fontes são só as do sistema (Windows). Em outro SO a pilha cai para fontes genéricas.
- A qualidade foi demonstrada só com fixtures sintéticas. O caso real indicado pelo usuário ainda falta e não foi escolhido automaticamente.
- Não rodei a suíte global depois do pedido do coordenador. Rodei só os testes do meu escopo: 37 de 37 passando.

## 6. Freeze
Freeze da API A em 2026-10-12 nos arquivos acima. Mudanças futuras serão aditivas e versionadas em `mainsagents.storyboard/1`.

## 7. Follow-up A2: rebuild do bundle concorrente com render (2026-10-12)
**Defeito real.** O `scripts/build-remotion-video.mjs` antigo fazia `rmSync(dist/remotion)` e rodava o bundle na mesma pasta. Um render ou still em andamento perdia o `index.html` e os chunks. Foi isso que derrubou o `storyboard_stills` do teste real B2. O repro abaixo mostra o mesmo erro: 404 em `/index.html`, `getStaticCompositions`.

**Correção (ownership: build script + `editorial-remotion.mjs/.d.mts`)**
- O layout passou a ser `<raiz>/versions/<sha16>/`, imutável, com `bundle-manifest.json` `{schema: mainsagents.remotion-bundle/1, sha256, version, composition, remotion, builtAt}`. O ponteiro fica em `<raiz>/current.json` `{schema, version, sha256, publishedAt}`.
- O build agora segue esta ordem:
  1. Gera o bundle em `<raiz>/.staging/<id>/`.
  2. Calcula o hash real da árvore: caminhos ordenados + tamanho + sha256 de cada arquivo, sem o manifesto.
  3. Faz o `rename` da staging para `versions/<sha16>`. Se essa versão já existe com o mesmo hash, ela é reaproveitada. Nunca sobrescreve.
  4. Troca o ponteiro por `rename` de um arquivo temporário, com retentativas para EPERM/EBUSY no Windows.
- Se o build falha, ele remove só a própria staging. O ponteiro e a versão anterior ficam intactos.
- Cada render ou still fixa uma versão no início com `pinRemotionBundle`:
  - cria uma lease em `<raiz>/.leases`, por melhor esforço (raiz só-leitura não bloqueia);
  - confere o hash real contra o ponteiro e o manifesto. Se não confere, falha com `bundle_missing`;
  - usa essa pasta como `serveUrl` até o fim e libera a lease no `finally`.
- O prune mantém a versão atual mais as `keep` mais novas (padrão 2) e nunca remove versão com lease fresca (TTL 12h). O layout plano legado só sai com `--release`, e só os nomes conhecidos (`index.html`, `favicon.ico`, `public`, `*.bundle.js(.map)`).
- Todo delete passa por `removeInside`, que exige caminho resolvido estritamente dentro da raiz e recusa link simbólico. A raiz precisa estar dentro do workspace ou do temp do SO. Raiz de disco, home e o próprio workspace são recusados.
- O ponteiro nunca fornece caminho. A pasta é derivada só do nome de versão validado (`^[a-f0-9]{16}$`).
- A identidade do bundle passou a sair nos resultados: `render.bundle`, `stills.bundle`, `stills.json.bundle` e `storyboard.manifest.bundle`, todos com `{sha256, version}`. O `compositionSha256` não mudou.
- Compatibilidade:
  - uma raiz sem ponteiro e com `index.html` é tratada como layout plano legado;
  - `bundleDir` aceita a raiz ou uma pasta de versão;
  - `getRemotionCapabilities().bundle` ganhou `root`, `layout` e `version`.

**Evidência**
- `node scripts/test-remotion-bundle-concurrency.mjs`: `@remotion/bundler` real, Chromium local, vídeo sintético, 40 stills, tudo em temp.
  - Legado: **falhou em 2/40** (`render_failed`, 404 `index.html`).
  - Novo: **40/40**, fixado em `13a56b63b4a7cac4` enquanto o ponteiro foi para `96357fb6ea62424a`. Com `keep=1`, a lease segurou a versão antiga.
  - Uma falha de build simulada preservou a versão anterior.
- `tests/remotion-bundle-publish.test.mjs`: 7/7, menos de 1s. Usa bundler falso e cobre leitura concorrente, falha, adulteração, prune com lease e legado, raiz insegura e ponteiro forjado.
- Testes direcionados: 69/69, cobrindo `remotion-bundle-publish`, `remotion-video`, `storyboard-render` (real), `editorial-animate`, `storyboard*` e `motion*`. Os 37 do motor A seguem verdes. Não rodei a suíte global nem o packaging.
- `dist/remotion` foi republicado no layout novo (aditivo): `versions/13a56b63b4a7cac4`. O hash é idêntico ao do bundle plano anterior, então é a mesma composição. O legado continua na raiz até `--release`.

**Contrato para C (empacotamento)**
- Caminho e contrato: `dist/remotion/current.json` + `dist/remotion/versions/<sha16>/**`. O `asarUnpack` `dist/remotion/**` atual já cobre, e `desktop-main.mjs` continua passando a raiz `app.asar.unpacked/dist/remotion`. Não é preciso mudar código.
- Antes de empacotar, rode `node scripts/build-remotion-video.mjs --release`. Ele mantém só a versão atual e remove o legado plano. Sem `--release`, o pacote leva o legado e até 2 versões (cerca de 33 MB cada).
- O `npm run build` atual chama o script sem flag. Trocar esse script fica com C, porque o `package.json` não é meu.
- `.staging/` e `.leases/` ficam vazios fora de build/render, e podem ser excluídos do pacote.

**Freeze A2**: API do bundle congelada em `mainsagents.remotion-bundle/1`.
