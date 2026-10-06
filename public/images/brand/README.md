# MainsAgents — identidade v2

Marca vetorial do Claude Design (`Logo.dc.html` e `Splash.dc.html`): o mesmo maestro, agora em silhueta plana num quadro de 64 unidades. Lê bem a 16 px e funciona em fundo claro, escuro e colorido.

| Arquivo | Uso |
| --- | --- |
| `mainsagents-mark-ink.svg` / `mainsagents-mark-white.svg` | Marca sem fundo, para fundo claro / escuro |
| `mainsagents-appicon-black.svg` (+ `.png` 1024) | Ícone principal: #0C0D10 / #F3F4F6 |
| `mainsagents-appicon-light.svg`, `-cobalt.svg`, `-violet.svg` (+ `.png`) | Variações claro, cobalto (direção A) e violeta (direção B) |
| `mainsagents-lockup-on-light.svg` / `-on-dark.svg` | Marca + nome |
| `mainsagents-icon-black.ico` | Ícone do Windows (app, atalhos e instalador), 16–256 px, tile com raio de 22% |
| `mainsagents-favicon-64.png` | Favicon |

No app, a marca é o componente `src/components/common/BrandMark.tsx` (cores por props). A abertura animada de 2,6 s fica em `app.html` (`#splash`) e é removida quando o workspace termina de carregar; respeita “reduzir movimento”.

Para regenerar PNGs e o `.ico` depois de alterar os SVGs: `npx electron scripts/export-brand-icons.mjs`.

A identidade anterior (mascote em vidro fosco, raster) está em `legacy/`.
