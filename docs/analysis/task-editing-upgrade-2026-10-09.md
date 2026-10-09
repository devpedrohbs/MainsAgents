# Tarefa — Upgrade de edição (6 melhorias) · 09/10/2026

Origem: Orca run `run_3383488c85fa`, Codex orquestrador; implementação Claude Code em três frentes paralelas. O usuário aprovou as seis melhorias: **(1) preview real**, **(2) cortes naturais**, **(3) motion explicativo**, **(4) enquadramento**, **(5) tratamento de voz**, **(6) legendas por palavra**. Checkout `main` com muitas alterações locais preexistentes: nada é resetado, limpo ou descartado; sem commits, sem instalação/release, sem IA paga, sem vídeos pessoais escolhidos sozinhos.

Não existe `AGENTS.md` no repositório (procurado na raiz e em `..`); regras aplicadas: `CLAUDE-CODE-COLLABORATION.md`, `docs/analysis/editing-dynamic-motion-report.md`, `docs/analysis/task-chat-status-and-dynamic-motion-2026-10-08.md` e a mensagem de ownership do coordenador.

## Ownership (exclusivo por arquivo)

| Frente | Dispatch | Arquivos |
|---|---|---|
| **A — cortes naturais + voz** | `task_56230ce3237d` / `ctx_902b4f7ea17b` | `editorial-smart-edit.mjs/.d.mts`, novos módulos de fala/áudio (ex.: speech/audio), seus testes |
| **B — motion explicativo + enquadramento** | `task_ae28ffa767fc` / `ctx_7300ce5bde74` | `editorial-motion-plan.mjs/.d.mts`, `editorial-remotion.mjs/.d.mts`, `editorial-animate.mjs`, `remotion-video/**`, seus testes |
| **C — preview, revisão pela transcrição, legendas por palavra, integração e QA** (este dispatch, `task_2f7bf3028ac7` / `ctx_e34940293516`) | | `src/components/content/SmartEditReview.tsx`, `MotionReview.tsx`, `EditReview.tsx` + `edit-review.css` (diálogo de revisão onde tudo se integra), novas UIs (`EditPreviewPlayer.tsx`, `TranscriptEditor.tsx`, CSS), `src/components/production/CaptionReview.tsx` e UI relacionada, `src/features/content/ContentWorkflowProvider.tsx`/`model.ts`, `src/features/production/model.ts`/`captionReview.ts`, `production-coordinator.mjs`, `content-workflow-bridge.mjs`, `editorial-media.mjs`, novo `production-caption-words.mjs/.d.mts`, `package.json`/lockfile, `scripts/build-remotion-video.mjs`, scripts de QA UI/integração, este documento e `editing-upgrade-preview-integration-2026-10-09.md` |

Arquivos compartilhados fora de A/B passam por C. Build global/suite completa só depois de A e B assentados.

## Desenho da frente C

### 1. Preview real (antes do export)
- Dependência: `@remotion/player` **4.0.534** (já presente no lockfile como transitiva de `@remotion/studio`; vira dependência direta na versão exata — mesma família de `remotion`/`@remotion/bundler`/`@remotion/renderer` 4.0.534, sem upgrade).
- O Player embute **o mesmo componente** da renderização (`OverlayVideo` de `remotion-video/Overlays.tsx`, somente leitura por C) com as **mesmas props** que o adaptador entrega ao renderer: o backend calcula `resolveAnimations(remotionAnimations(plan), metadata)` (funções de B/A, sem duplicar lógica).
- Fonte do vídeo no Player = **proxy de prévia** gerado pelo backend (`POST /api/content/media/preview`): o MESMO `cutFilter` do export (cortes + tratamento de voz quando A o colocar no filtro) em resolução reduzida, e o MESMO mix de SFX (`sfxBedWav` + `sfxMixFilter`, ducking pela voz) — assim o áudio da prévia é o áudio processado do arquivo final, não uma simulação. Cache por hash (fonte sha256 + segmentos + formato + áudio + SFX), arquivos só no diretório de mídia do perfil, servidos por id com token de hash; caminho nunca vem da requisição.
- Cancelamento: uma prévia por vez; nova prévia aborta a anterior; `close()` aborta; contexto isolado por perfil/conteúdo/versão (mesma `authorize`).
- Limites declarados na UI: resolução reduzida; no Player o `OffthreadVideo` vira `<video>` HTML (quadros podem diferir em ±1 frame); legenda queimada (libass) não é a mesma engine → overlay aproximado rotulado; se o proxy estiver desatualizado (plano mudou) a UI mostra “prévia desatualizada — atualizar” e nunca apresenta como final.
- Timeline compacta abaixo do Player: faixas de cortes (bruto→editado), motion e SFX, playhead sincronizado (`frameupdate`), clique = seek.

### 2. Revisão pela transcrição
- Transcrição clicável (palavras de `transcript.words`, ou frases quando não há) no tempo do bruto; palavras cortadas riscadas; clique = tocar/seek.
- Seleção de frase/trecho → ações: **sugerir corte** (remoção alinhada às bordas das palavras, via helper de A quando disponível), **desfazer** (pilha de undo da revisão), **manter pausa** (marca o corte sob a seleção como mantido), **aproximar câmera** (cue manual `punchIn`), **destaque** (cue manual `kineticText` com o texto LITERAL selecionado). Tudo entra no rascunho de revisão → `media/plan` (hash) → export autorizado existente. Nada muda o original.

### 3. Enquadramento (com B)
- Foco manual: clique no quadro do preview define o ponto focal (x,y normalizados) que B consome na composição/plano. Detecção facial automática só se B entregar; senão limite explícito.

### 4. Voz (com A)
- Controles opt-in (desligados por padrão) na revisão; contrato de A define o campo do plano incluído no `planHash` e aplicado pelo `cutFilter` (então o proxy de prévia reproduz o mesmo áudio).

### 5. Legendas por palavra
- Novo modo na revisão de legendas: “Por palavra (1–3 palavras por vez)” gerado de `transcript.words` do vídeo editado; texto exatamente o reconhecido (nada é trocado silenciosamente), tempos por palavra rotulados como aproximados; vira uma versão normal de legendas (editável em texto/tempo, aprovação e render libass com os presets `classic/boxed/highlight` existentes). Sem palavras com tempo → fallback por frase com aviso.

## Contratos pedidos (via coordenador/mensagens Orca)
- **A**: (a) campo de tratamento de voz no `EditPlan` (nome, valores, default off) + garantia de que `cutFilter`/`validatePlan`/`planHash` o aplicam; (b) helper puro para alinhar um intervalo selecionado às bordas de palavras/silêncios (ex.: `snapRemoval(range, words, silences)`); (c) se os cortes naturais mudam o formato de candidatos/review (`cutReview`), o shape novo.
- **B**: (a) cue manual aceita por `normalizeMotion` com origem honesta (ex.: `source:'user'`, sinal `user`) para `punchIn`/`kineticText`/`keyPoint`; (b) campo de enquadramento manual (ex.: `motion.focus` ou `plan.reframe = {x,y}`) e onde ele chega nas props; (c) `OverlayVideo` continua exportado, sem import Node, utilizável no `@remotion/player`; (d) tipos/novas cues de motion explicativo.

## Aceite (C)
Electron QA real com fixture sintética (nunca vídeo pessoal): prévia antes do export, controle/undo que realmente mudam o arquivo final (ffprobe/hash), áudio/legenda sem prometer o que diverge; cancelamento e isolamento de contexto; metadata (paths/hash) seguros; depois de A/B: suite global, typecheck, build, `check-build-files` com novos módulos, regressão do status de chat de ontem, relatório final em `editing-upgrade-preview-integration-2026-10-09.md`.

## Andamento
- 09/10 — plano persistido; contratos solicitados a A/B.
- 09/10 — contratos recebidos: A (`plan.audio`, `editorial-speech-edit`, `editorial-audio-cleanup`) concluído e liberado; B (`explainer`, `reframe`, `player.ts`, cues `source:'user'`) em andamento. Coordenador transferiu a C o ajuste de `editorial-smart-edit` para enquadramento (`needsAnimation`/`remotionAnimations` com reframe sem cues; crop 9:16 por foco).
- 09/10 — C integrado: `/media/preview` (+ `preview-file`, `preview-cancel`), `/media/audio`, `/media/snap`; análise com candidatos de fala + pausas naturais + medição de áudio persistida (`editorial_audio`); `assertMeasuredNoiseFloor` e `verifyExplainersAgainstTranscript` no servidor; UI: Player, timeline, transcrição clicável com undo, sugestões de fala, voz opt-in, foco manual no bruto; legendas palavra a palavra. Pendente: crop 9:16 por foco (aguarda `reframeCropFilter` de B), suite/build global e QA Electron após B assentar.
- 09/10 — A e B congelados; crop 9:16 por foco integrado; suite global 532/532, typecheck, build, build.files 78/0, QA Electron `EDIT_PREVIEW_UI_OK` e regressões (chat status, smart-edit, legendas) verdes. Resultado consolidado em `editing-upgrade-preview-integration-2026-10-09.md`.
