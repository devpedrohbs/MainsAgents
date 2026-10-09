# D11 — Contraste do link de pré-requisito (07/10/2026)

## Problema
Em `03-blocked-dark`, o link do bloqueio dentro de `.production-panel-body .editorial-hint` usava o azul nativo do navegador: `rgb(0, 0, 238)` sobre `rgb(20,21,26)` = **1,94:1**, sem anel de foco.

## Mudança
Somente `src/components/production/production.css` (3 regras no fim): links `a` e `a:visited` de `.production-panel-body .editorial-hint` usam `var(--accent)`, mantêm `underline` (offset 2px); `:hover` usa `--accent-hover`; `:focus-visible` tem contorno de 2px sólido em `--accent` com offset 2px. Layout, `ProductionDialog.tsx`, lógica e CSS global intactos. Não foi preciso trocar de token: `--accent` já passa nos dois temas.

## Medido no renderer (`scripts/test-production-preflight-ui.mjs`, dist com o CSS, build de 07/10 11:54)
| Tema | Cor computada | Fundo efetivo | Contraste | Sublinhado | Foco |
| --- | --- | --- | --- | --- | --- |
| Escuro | rgb(125,147,255) | rgb(20,21,26) | 6,50:1 | sim | 2px solid, 6,50:1 |
| Claro | rgb(53,87,245) | rgb(255,255,255) | 5,48:1 | sim | 2px solid, 5,48:1 |

Asserts novos: cor ≠ `rgb(0, 0, 238)`, contraste ≥ 4,5, sublinhado, link alcançável por Tab real (`sendInputEvent`), `:focus-visible` com contorno ≥ 2px e contraste ≥ 3. O resto do teste D02 permanece (passa: `PRODUCTION_PREFLIGHT_UI_OK`).

## Evidências
- Antes: `.mainsagents-workspaces/production-preflight-ui/D11-before-03-blocked-dark.png` (e a falha do teste no dist antigo: link `rgb(0, 0, 238)`, 1,94:1).
- Depois: `.mainsagents-workspaces/production-preflight-ui/1791384934771/` — `03-blocked-dark`, `05-link-focus-dark` (inspecionada: link legível e anel visível), `06-link-focus-light`, `result.json` com os valores acima.

## Limites
- A janela offscreen não reporta `:focus-visible`; o teste força `focus`/`focus-visible` via DevTools (`CSS.forcePseudoState`) para ler o estilo computado real. A alcançabilidade por Tab é real.
- A visual `visited` não foi exercida em histórico real; a regra usa a mesma cor por seletor `:visited`.
- Não revisei outros links nativos fora de `.production-panel-body .editorial-hint`.
