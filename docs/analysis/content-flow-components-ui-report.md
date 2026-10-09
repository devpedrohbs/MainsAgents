# QA visual/funcional isolada — F02 RecordingPackage, F04 ThumbnailGallery, F05 InspirationLibrary

**Escopo honesto:** harness isolado. **Não** é teste end-to-end do app: sem app shell, providers, persistência real, coordenador, IA, Notion, publicação ou rede. Os componentes e seus modelos puros são os reais; estado, callbacks, assets, imagem de capa (`data:image/svg` marcada "MOCK") e `useLanguage` (stub) são mocks do fixture. A integração real continua pendente.

## Como rodar
`node_modules/.bin/electron scripts/test-content-flow-components-ui.mjs` (Electron local oculto + esbuild local; sem download, sem auth, sem deps novas).
Resultado atual: **31/31 passos passam**, 0 erros de console. Resultado e screenshots: `docs/analysis/content-flow-components-ui/` (`result.json`, 16 PNG).

Arquivos novos: `scripts/test-content-flow-components-ui.mjs`, `tests/fixtures/content-flow-components-entry.tsx`, `tests/fixtures/language-stub.tsx`. Os testes só chamam as funções reais dos componentes/modelos via UI; a lógica do modelo não é reimplementada no teste (leem `window.__fx.state()` do estado real controlado).

Skills lidas: `.agents/skills/frontend-design/SKILL.md` e `apple-design/SKILL.md` (acessibilidade, teclado, estados vazio/erro, escrita; HIGs de `references/hig` não foram abertas uma a uma — revisão guiada pelos princípios Craft/Flexibility/Agency do SKILL).

## O que é verificado (asserts funcionais, não só imagem)
**F05** — vazio; formulário abre com foco no link; link inválido (`abc`, `javascript:`, `ftp:`, credenciais) mostra erro localizado e não salva; criar com Enter; duplicata; falha de persistência (erro, formulário mantido, estado intacto, retry); editar (revisão 2); filtro por tag via teclado (Espaço), busca, limpar; briefing devolve atribuição/"não informado"/"não analisado" e notas citadas como dados; remover → desfazer → mostrar removidas → restaurar; isolamento de workspace (outro workspace vazio, só vídeos do próprio workspace e só `video` no seletor, mesmo link permitido em outro workspace); ordem de Tab e foco visível.
**F02** — gate para 4 cenários (sem roteiro, sem aprovação, versão mais nova que a aprovada, Notion ausente): nenhum pacote/checklist/import; roteiro atual: checklist por teclado, progresso `n de 4`, não bloqueia gravação; sugestões rotuladas e editáveis; import só por clique; `busy` desabilita; **editar roteiro (v2) zera checklist e edições de sugestão** mesmo com checklist v1 guardado; versão nova não aprovada volta a bloquear.
**F04** — 3 conceitos "Só conceito" e exportação bloqueada sem título; aprovar exige seleção + exportação (ajustar nunca exporta); capa exportada separada do conceito; editar título/kicker/quadro/enquadramento → "Exportação desatualizada" e aprovação retirada, Aprovar desabilitado; espaço em branco não invalida; trocar formato não mostra artefato do outro formato; **trocar a versão da fonte limpa seleção/aprovação/artefatos, resultado tardio da fonte antiga é ignorado e aprovar exige novo export**; falha de export; busy; quadro além da duração; Tab alcança rádios/ranges/Selecionar.
**Layout (todos os 3):** pt e en, 1280×800, 900×640 com zoom real 1,25 (viewport CSS 720 px — o harness confere), tema escuro; sem scroll horizontal, nada além da viewport, controles com nome acessível e ≥24 px, truncamento do título longo com reticências (F05).

## Correções feitas (apenas arquivos F05)
1. `InspirationLibrary.tsx`: formulário usava validação nativa (`type=url`) que bloqueava o envio com bolha do navegador e **ocultava as mensagens i18n** para texto como `abc`. Adicionado `noValidate` (a validação continua no modelo).
2. `inspiration-library.css`: link da fonte com alvo de 19 px → `min-height:24px`; textos secundários F05 de `--muted` (4,26:1) para `--fg-2` (≥4,5:1), incluindo contador.

## Achados para o coordenador (F02/F04 já liberados — não alterei)
- **Contraste insuficiente (WCAG AA 4,5:1):** `Pronto para gravar.` (F02, verde `rgb(23,163,74)` sobre branco = 3,29:1); badge `Aprovada` (F04, mesmo verde sobre `#f2f3f5` = 2,97:1); badge `Concept only/Só conceito`, labels dos campos, `dt` Hook/CTA, nota do formato sobre fundo cinza = 3,84:1; badge "Exportação desatualizada" (âmbar) também sinalizado visualmente fraco. Causa comum: token `--muted` = `#747b88` (4,26:1 em branco, 3,84:1 em `#f2f3f5`) e verde de status. É token do app (também afeta `.editorial-kicker`/`.editorial-meta`, que o F05 reutiliza e continuam com 4,26:1); sugestão: escurecer `--muted` e o verde no tema claro. Tema escuro: sem achados.
- Gallery em 720 px CSS vira 2 colunas; ok. A prévia exportada em Reels 9:16 é alta (~460 px por cartão) — rolagem vertical longa, sem corte.

## Limites / pendências
- Contraste calculado por script (cores computadas); fundo ausente do app shell é aproximado — por isso valores "bg" refletem `.editorial-card`/superfície real do CSS carregado (mesma ordem de folhas do `app.html`).
- Não testado: foco com leitor de tela, `prefers-reduced-motion`, ordem de foco após remover/restaurar (foco permanece no body — melhoria possível), mobile < 600 px, `file:`/caminho rejeitado em `resolveAsset` (coberto só por teste unitário do modelo).
- `tsc` focado no fixture (config temporária): sem erros nos arquivos novos; apenas os 3 erros pré-existentes de `window.mainsAgentsDesktop` por falta do `.d.ts` global na config isolada. Build global não rodado. Testes unitários F02/F04/F05: 21/21.
- Não adicionei script no `package.json` (arquivo compartilhado).
