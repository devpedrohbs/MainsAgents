# MainsAgents V2 — implementação

Os arquivos `V2*.dc.html` são as pranchas aprovadas (HTML com estilos inline). Use-as como referência visual: cores, espaçamentos, hierarquia e textos. Os dados nelas são exemplos; no app, use os dados reais que cada página já tem.

O Canvas **não** muda: continua com o visual anterior (o `v2.css` restaura os tokens antigos dentro da página Canvas).

## Base (pronta, de Claude)

- `src/styles/v2.css`: tokens V2 (escuro e claro), moldura, barra lateral, controles e blocos compartilhados: `.v2-page`, `.v2-header`, `.v2-section-title`, `.v2-label`, `.v2-card`, `.v2-list`, `.v2-row`, `.v2-segmented`, `.v2-tabs`, `.v2-chip`, `.v2-count`, `.v2-kpis`, `.v2-steps`, `.v2-gate`, `.v2-inspector`, `.v2-mono`.
- `src/components/common/StatusIcon.tsx`: `<StatusIcon state="queued|running|waiting|paused|done|failed"/>`.
- Tokens úteis: `--frame --bg --surface --surface-2 --fg --fg-2 --muted --meta --border --line --line-strong --accent --link --primary-bg --primary-fg --warn --warn-soft --success --danger --danger-text --state-*`, raios `--radius-xs/sm/md/lg` (4/6/8/10), `--font-mono`.

## Divisão

| Quem | Arquivos que pode editar | Pranchas |
|---|---|---|
| Claude | `v2.css`, `v2-pages.css`, `StatusIcon.tsx`, `AppShell.tsx`, `Sidebar.tsx`, `pages/Home.tsx`, `pages/ContentStudio.tsx`, `pages/Radar.tsx` e componentes de `components/radar` e `components/content` usados só por eles | Sistema, Sidebar, Inicio, Estudio, Radar, Calendario |
| Codex | `v2-team.css`, `pages/Agents.tsx`, `pages/AgentSettings.tsx`, `pages/Sessions.tsx`, `pages/Scopes.tsx`, `pages/Usage.tsx`, `pages/Settings.tsx`, `pages/Board.tsx`, `pages/EditingReferences.tsx` e componentes de `components/agents`, `components/tasks`, `components/references` | Agentes, Historico, Escopos, Uso, Config, Quadro, Referencias |

Ninguém mexe no Canvas (`components/canvas/**`, `pages/Canvas.tsx`) nem nos arquivos do outro. Se precisar de algo novo na base, peça em vez de editar `v2.css`.

## Regras

- Prefira CSS: mude markup só quando a prancha pede uma estrutura que não existe (cabeçalho `.v2-header`, inspetor lateral, tabela agrupada).
- Mantenha ids, `data-od-id`, rótulos acessíveis e textos que os testes procuram (`scripts/test-*-ui.mjs`, `tests/*.test.mjs`).
- Português e inglês continuam funcionando (`useLanguage`).
- Validar: `npm run typecheck` e `npm test` sem falhas novas.
