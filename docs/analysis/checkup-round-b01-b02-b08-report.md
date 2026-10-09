# Checkup — rodada B01 + B02 + B08 (Sonnet)

Status: implementado e verificado no escopo desta rodada; sem commit. Não toquei em coordenador, mídia, rotas, protocolo, modelo global, `desktop-main`, `package.json` nem ponte do Claude. Não rodei o build global nem a suíte completa (392): o dono da integração faz isso.

## Contratos e necessidades compartilhadas
- **Nenhum endpoint novo e nenhuma edição em arquivo compartilhado.** B01 usa `useProduction().runs` (já existente); B02 usa `/api/codex/diagnostics`, `/api/providers/claude/diagnostics` e `/api/content/media/capabilities`, que já devolve `transcribe`/`animate` e os motivos (`transcribeReasons`/`animateReasons`); B08 é só leitura sobre `buildRecordingPackage`.
- Observação para o dono do coordenador: se o contrato de `media.capabilities` perder `transcribe`/`animate`, a checklist mostra “não verificado”, nunca “pronto”.

## B01 — Home segue a execução ativa
- `src/features/content/homePipeline.ts` (novo, puro): a coluna vem da execução ativa do mesmo conteúdo **e** workspace; `productionStage` do conteúdo só é fallback (conteúdos manuais, execução cancelada, histórico importado parado, estágio desconhecido). Execução em andamento sempre vence uma `complete` antiga; entre iguais vale a mais recente (desempate por id). Pausada/bloqueada fica onde parou (reusa `productionProgress`); sem evidência não inventa coluna.
- `HomeProductionPipeline.tsx`: 8 colunas — Pauta, Pesquisa, Roteiro, Gravação, Edição, **Capas e pacote**, **Agendamento**, Publicação. `Home.tsx` passa `runs` de `useProduction()`.
- Testes: `tests/home-pipeline.test.mjs` (9) cobrem todos os estágios do coordenador, conteúdo guardado como `video-review` com execução em `covers-review`, concluída antiga × ativa, workspace/conteúdo alheio, fallback manual, cancelada/importada/desconhecida, pausada/bloqueada, pautas sem duplicar.

## B02 — “Pronto para produzir?”
- `src/features/chat/productionReadiness.ts` (novo, puro) reagrupa as linhas que `runtimeDiagnosticsView` já monta: provedor+login (um provedor pronto basta), FFmpeg/ffprobe, Whisper, Remotion+navegador, integrações Zernio/Publora. Estados: pronto / bloqueado / não comprovado / ainda não verificado, com o motivo real e “como resolver”. Whisper, animações e integrações são opcionais no resumo; catálogo MCP sem leitura real = “não comprovado”.
- `mediaRow` ganhou os fatos Whisper e Remotion (só quando o endpoint os devolve), mantendo os 7 testes antigos.
- UI: seção “Pronto para produzir?” no topo de Conexões de IA (`RuntimeDiagnostics`) e terceiro passo “Abrir verificação” no `WelcomeGuide` (usa o `onCodexSettings` real). A verificação continua manual, sem IA nem escrita.
- Testes: `tests/production-readiness.test.mjs` (6) + `runtime-diagnostics-view` existente.

## B08 — Modo de leitura
- `src/features/production/teleprompter.ts` (helpers puros), `Teleprompter.tsx` + `teleprompter.css` (novos), botão “Abrir modo de leitura” em `RecordingPackage.tsx`. Diálogo em portal, tela cheia progressiva (API de fullscreen se disponível), foco entra e volta, Tab preso, Esc sai, Espaço pausa/inicia (exceto sobre botões/campos). **Começa pausado**; tamanho da letra (7 passos), velocidade (nunca “0”), espelhar texto, voltar ao início, orientação por cena (anterior/próxima, só navegação). Com `prefers-reduced-motion` não há rolagem automática: botões de página.
- O roteiro é exibido literalmente; nada é gravado, persistido, enviado ou capturado (teste de código-fonte proíbe fetch/storage/getUserMedia/MediaRecorder). Importar vídeo gravado fora do app permanece.
- **Orientação por cena (atualizado):** o modo de leitura lista os títulos do outline do caminho aprovado como seleção **manual** (botões com `aria-pressed`, anterior/próxima), com a fonte declarada (“tópicos do caminho … aprovado no roteiro vN. Marcação manual: o app não sabe onde cada cena começa no texto e não estima durações”). Selecionar uma cena **não move o texto**, não é salvo e não altera hash/texto. Sem outline: “O caminho aprovado não define cenas; nenhuma foi inventada”, sem controles de cena. Mapeamento automático cena→trecho e durações (L2b) **não existem**.
- Testes: `tests/teleprompter.test.mjs` (9, incluindo outline ausente/em branco e ausência de mapeamento automático no código). Harness: seleção manual sem rolar o texto e caso sem cenas.

## Verificação
- `npx tsc -b` limpo. 46 testes focados passam (home-pipeline, production-readiness, teleprompter, runtime-diagnostics-view, recording-package, production-progress, production-execution-overview).
- Harness Electron real e isolado: `scripts/test-checkup-b01-b02-b08-ui.mjs` (renderer real, APIs simuladas, perfil descartável, sem dados pessoais). Para não tocar `dist/`, compilei só o renderer em pasta temporária (`vite build --outDir`) e apontei com `MAINS_DIST`. Resultado `CHECKUP_B01_B02_B08_UI_OK`: 0 mutações, 0 requisições externas, 0 erros de renderer. Cobre colunas da Home, checklist (sem “pronto” antes da verificação, motivo real do Remotion, integração não comprovada), leitura (pausado, Espaço, Esc, fonte, cena, texto idêntico), movimento reduzido, 200% e rótulos em EN. Capturas em `.mainsagents-workspaces/checkup-b01-b02-b08-ui/<timestamp>/`.
- Limites: janela offscreen, então fullscreen nativo e anel de foco não foram provados; contraste do modo de leitura é por construção (#f5f5f7 sobre #000), não medido; leitor de tela não testado.

## Referências (apple-design, `references/hig`)
accessibility, layout, typography, color, designing-for-macos, motion, keyboards, modality, going-full-screen, buttons, feedback. Aplicado: modal com saída óbvia (modality), controles persistentes em tela cheia e saída escolhida pelo usuário (going-full-screen), status passivo junto ao item (feedback), alvos de 44 px (buttons), texto grande e movimento reduzido (accessibility/motion), Esc/Espaço (keyboards). Frontend-design: o modo de leitura é um instrumento — sem decoração, só tipografia grande e contraste.

## Arquivos
Novos: `src/features/content/homePipeline.ts`, `src/features/chat/productionReadiness.ts`, `src/features/production/teleprompter.ts`, `src/components/production/Teleprompter.tsx`, `src/components/production/teleprompter.css`, `tests/home-pipeline.test.mjs`, `tests/production-readiness.test.mjs`, `tests/teleprompter.test.mjs`, `scripts/test-checkup-b01-b02-b08-ui.mjs`.
Editados: `HomeProductionPipeline.tsx`, `src/pages/Home.tsx` (+import/uso de `useProduction`; o arquivo já tinha edições de outro dono), `RuntimeDiagnostics.tsx`, `runtime-diagnostics.css`, `runtimeDiagnosticsView.ts`, `WelcomeGuide.tsx`, `RecordingPackage.tsx`, `recording-package.css`.
