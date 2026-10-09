# Correção de contraste F02/F04 (CSS apenas)

Arquivos alterados: `src/components/production/recording-package.css`, `src/components/production/thumbnail-gallery.css` (e, no harness, só `low.slice(0,6)`→`30` em `scripts/test-content-flow-components-ui.mjs` para não truncar a lista de achados). Nenhum TSX, modelo, token global ou CSS do app foi tocado. **Integrador ctx_43f82fbe4bb6:** esses dois CSS mudaram; se ele os edita, deve fazer merge (o coordenador precisa repassar o aviso — não há endereço direto para esse terminal).

## Método
Variáveis locais por componente (escopo `.recording-package` / `.thumbnail-gallery`), com valores claros escuros no tema claro e os tokens do app no tema escuro (`:root[data-appearance=dark]`):
`--q-muted:#4f5560; --q-ok:#0e6b33; --q-warn:#7a4f00; --q-danger:#b42318`. Botões primários usam `var(--accent-on,#fff)` em vez de `var(--bg)`. Estado continua em texto (Aprovada / Exportação desatualizada / Só conceito / Pronto para gravar), não só cor.

## Antes → depois (tema claro, razão de contraste)
| Elemento | Antes | Depois |
|---|---|---|
| "Pronto para gravar." (F02) | 3,29 | ≥ 4,5 (sem achado) |
| Badge "Aprovada" / "Exportada" (F04) | 2,97 | ≥ 4,5 |
| Badge "Exportação desatualizada" e "Desatualizada: exporte de novo" (âmbar) | abaixo de AA | ≥ 4,5 |
| Labels, `dt` Hook/CTA, notas, versão, progresso sobre card `#f2f3f5` | 3,84–4,26 | ≥ 4,5 |
| Botões "Importar vídeo gravado" / "Aprovar capa" (texto `--bg` sobre accent) | 4,21 (visto após ampliar a lista) | ≥ 4,5 (`--accent-on`) |
| Mensagens de erro "Informe um título." | 4,35 | ≥ 4,5 |
Tema escuro: sem achados antes nem depois.

## Reexecução
`node_modules/.bin/electron scripts/test-content-flow-components-ui.mjs`: 31/31 passos, 0 erros de console. Achados de contraste: 10 → 4; os 4 restantes são **todos F05**, em classes compartilhadas do app (`.editorial-kicker`, `.editorial-meta`, `--muted` = `#747b88`, 4,26:1) fora do ownership desta tarefa. Zero achados em F02 e F04 (pt/en, 1280, 900×640 zoom 1,25, escuro).
Screenshots atualizadas em `docs/analysis/content-flow-components-ui/` (ex.: `f04-stale-1280-pt.png`, `f04-approved-1280-pt.png`, `f02-ready-v1-1280-pt.png`).

## Limites
Harness isolado, não é e2e do app; valores `#4f5560/#0e6b33/#7a4f00/#b42318` são locais — se o time ajustar `--muted/--success/--warn` globalmente, essas variáveis podem ser removidas.
