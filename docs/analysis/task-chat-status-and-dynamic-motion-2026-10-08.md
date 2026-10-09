# Tarefa — Chat limpo (Frente A) + Remotion dinâmico (Frente B)

Data: 08/10/2026. Origem: handoff Codex → Claude Code (ownership completo). Checkout `main` com muitas alterações locais preexistentes: nada é resetado, limpo ou descartado.

## Frente A — Chat limpo (owner: sessão principal Claude Code)

Arquivos: `src/features/chat/model/Chat.ts`, `src/features/chat/ChatProvider.tsx`, `src/features/chat/responseTiming.ts`, `src/features/chat/chatInbox.ts`, `src/components/chat/ChatPanel.tsx`, `src/components/chat/RunStatusLine.tsx` (novo), `src/styles/*` do chat, `tests/response-timing.test.mjs`, `scripts/test-chat-timing-ui.mjs`.

Causa encontrada: `ChatProvider.applyEvent` grava um `ChatActivityItem` por evento `tool.started/tool.finished/activity/search` (`Used ${tool}`), e `ChatPanel` renderiza cada item como linha no feed.

Critérios de aceite:
1. Nenhuma linha “Used …/Thinking…” por ferramenta no feed principal; os passos continuam salvos e acessíveis num detalhe recolhido da linha de status.
2. Uma única linha por execução: `Trabalhando · 00:12` (en: `Working`) enquanto pensa, usa ferramentas, aguarda aprovação ou transmite resposta.
3. Tempo = duração da execução (início do envio → fim do turno), não uptime do app/sessão.
4. Fim: `Finalizado · 01:37` com contador parado e duração persistida; erro → `Falhou · mm:ss`; cancelamento → `Interrompido · mm:ss`; nunca rotular falha como sucesso.
5. Sem piscar entre eventos de ferramenta (estado da linha não depende do estado transitório da ferramenta), sem multiplicar linhas, intervalo só enquanto a linha está ativa e limpo ao terminar/desmontar.
6. Isolamento por execução/conversa; troca de conversa e reabertura do app preservam a duração final; execução “running” encontrada ao reabrir vira `Interrompido` congelado.
7. Mensagens úteis, resposta final e erros reais (falha do provedor, imagem) continuam visíveis.

Verificação: testes unitários do ciclo (`tests/response-timing.test.mjs`, novo `tests/chat-run-status.test.mjs`), typecheck, build e UI Electron isolada (`scripts/test-chat-timing-ui.mjs`) com streaming, ferramentas sucessivas, conclusão, reabertura.

## Frente B — Remotion dinâmico (owner: agente Claude Code dedicado)

Arquivos: `editorial-remotion.mjs/.d.mts`, `editorial-animate.mjs`, `editorial-transcribe.mjs/.d.mts`, `editorial-smart-edit.mjs/.d.mts`, novo módulo de plano de motion (`editorial-motion-plan.mjs/.d.mts`), `remotion-video/**`, `scripts/build-remotion-video.mjs`, `scripts/test-remotion-video.mjs`, testes `tests/remotion-video.test.mjs`, `tests/editorial-animate.test.mjs`, `tests/transcribe.test.mjs`, `tests/smart-edit*.test.mjs`, novo `tests/motion-plan.test.mjs`, e a UI de revisão existente (`SmartEditReview.tsx`/`EditReview.tsx`) somente para controles de intensidade/revisão.

Fluxo: vídeo+áudio → transcrição com timestamps (palavra/segmento) → análise editorial + ênfase vocal (pausas, intensidade RMS, variação de pitch quando o áudio real permitir) → plano temporal editável → composições Remotion → preview → render integrado.

Critérios de aceite:
1. Sinais medidos (áudio) separados de inferências (texto); fallback honesto e rotulado quando falta áudio ou timestamps por palavra.
2. Plano com frames/tempo, motivo, intensidade, layout (`camera-full`, `split`, `motion-focus`, retorno suave), assets; editável e validado.
3. Punch-in/zoom nas ênfases, tipografia cinética, destaques, cards/diagramas, transições; SFX pontuais licenciados/gerados localmente com volume e ducking; densidade limitada (sem efeitos incessantes); safe areas e proporção respeitadas.
4. Remapeamento de timestamps após cortes; animações determinísticas por frame (`useCurrentFrame`/`interpolate`/`spring`), fps/duração corretos.
5. Opções de intensidade/revisão nos controles existentes, sem jargão técnico.
6. Testes de temporização, layout, áudio/ducking; build do bundle; frames de preview e pequeno render com fixture sintética. Não alegar validação de prosódia real não executada.

## Regras gerais
- Sem reset/clean/descartar arquivos; não sobrescrever alterações alheias; ownership por arquivo acima.
- Sem publicar nem enviar mensagens externas; sem Codex.
- Resultado final consolidado neste documento (seção “Resultado”).

## Resultado

### Frente A — concluída
- Causa: `ChatProvider.applyEvent` persistia um `ChatActivityItem` por evento de ferramenta e `ChatPanel` renderizava todos; havia ainda uma linha `Thinking…` e um cronômetro de sessão no topo.
- Mudança: item `activity` com `kind:'run'` (`startedAt/endedAt/outcome`) criado no início de `executeMessage`, logo após a mensagem do usuário, e fechado em `finishResponseTiming` com o desfecho real (`completed|interrupted|error`). `chatFeed()` (`src/features/chat/responseTiming.ts`) agrupa os passos `codex-activity-*` dentro da linha da execução; eles nunca viram linhas do feed. `RunStatusLine` (`src/components/chat/ResponseTimer.tsx`) mostra `Trabalhando · mm:ss` → `Finalizado|Falhou|Interrompido · mm:ss`; intervalo de 1 s só enquanto a linha está ativa; marcação idêntica durante a execução (sem piscar); passos recolhidos em “N etapas” depois do fim. Recuperação ao reabrir fecha linhas abertas como `Interrompido` com a duração até o último salvamento. Erros reais (falha do provedor, imagem) continuam visíveis; caixa de inbox ignora a linha de status.
- Checks: `tests/chat-run-status.test.mjs` (6) + `response-timing` + `chat-inbox`: 11/11; `npm run typecheck`: ok; `scripts/test-chat-timing-ui.mjs` (Electron isolado, fixtures locais): PASS — 12 eventos de ferramenta sucessivos + espera de aprovação com 1 linha sempre `Trabalhando`, 0 `.tool-activity`, `Finalizado` congelado, `Falhou` com erro visível e resposta parcial, `Interrompido` via botão parar, 3 linhas idênticas após reabrir. Regressões: chat-interaction, agent-comparison, agent-handoff, chat-deliveries, runtime-controls — todos OK. Evidência: `chat-run-status-evidence/feed-after-runs.png`.
- Limite: delegações nativas executadas pelo backend (sem item de execução local) mostram `Trabalhando` sem cronômetro enquanto ocupadas; histórico antigo (antes desta versão) não ganha linha retroativa — só deixa de exibir as linhas de ferramenta.

### Frente B — concluída (detalhes em `editing-dynamic-motion-report.md`)
- Fluxo existente ampliado: whisper.cpp com `-dtw` (tempo por palavra; fallback rotulado), análise de voz medida (energia, pitch, pausa, alongamento → `source:'measured'`) separada de inferências de texto (`'inferred'`), plano editável `editorial-motion-plan.mjs` (punch-in, texto cinético, cartão em tela dividida/motion em destaque com retorno à câmera, densidade por intensidade, remapeamento após cortes, incluído no hash do plano aprovado), composição `remotion-video/Motion.tsx` + `layout.ts` (9:16/16:9/1:1, safe areas, determinístico por frame), SFX sintetizados localmente (sem licença de terceiros) a ≤ −10 dB com ducking. UI: seletor “Movimento na edição” e seção “Movimento” em “Conferir edição”.
- Verificação independente da sessão principal após a entrega: `npm test` 489/489, `npm run typecheck` ok, `npm run build` ok, `test-smart-edit-ui` SMART_EDIT_UI_OK, `test-chat-timing-ui` PASS com o build final. Frames e 3 renders de amostra em `editing-motion-frames/` conferidos visualmente.
- Limites: só fixtures sintéticas (tons + TTS offline) — prosódia de voz humana real NÃO validada; tempo por palavra com erro de ~0,2–0,5 s; sem detecção de rosto (foco fixo no terço superior central); sem preview Remotion ao vivo antes da exportação; fontes com > 2 canais de áudio ficam sem SFX.
- Nada instalado/empacotado: instalar exige despacho autorizado (`npm run desktop:dist` + procedimento de `local-update-*.md`).
