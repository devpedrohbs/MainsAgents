# MainsAgents — SaaS workspace refactor

## Direction

Neutral Modern is the binding palette and typography contract. References inform
navigation and information architecture; their distinctive branding is not copied.
The result uses a light neutral workspace, white functional surfaces, graphite text,
and cobalt for primary actions and the active destination.

## Reference evidence

- https://www.bridgemind.ai/ — inspected the published product content: agent roster,
  workspace context and dedicated work modes. Direct CSS download returned HTTP 403;
  no BridgeMind color or type values are asserted.
- https://www.themaestri.app/pt-br — inspected product content and stylesheet
  `/_next/static/chunks/0db6hxi6.evnk.css`. Observed Geist / Geist Mono and neutral
  colors including #1d1d1f, #171717, #e5e5e5, plus #1633f9. These are evidence only;
  the active Neutral Modern contract takes precedence.

## Binding tokens

Canonical values are in `src/styles/tokens.css`. The six core values are the
provided background #fafafa, surface #ffffff, foreground #111111, muted #6b6b6b,
border #e5e5e5, and accent #2f6feb. No additional brand colors are introduced.

Display and body: Inter, -apple-system, system-ui, sans-serif. Mono: ui-monospace,
JetBrains Mono, monospace. Existing CSS variable names are compatibility aliases,
not a second theme.

## Layout posture

1. Persistent labeled sidebar on desktop; full-label drawer on phones.
2. One primary page action, clear local search, and neutral secondary actions.
3. Flat surfaces, 1px borders, 8px controls and 12px panels; no decorative shadows.
4. The content responds to its available width, including a docked conversation.
5. Task counts reflect stored tasks; empty states guide the next action.

## Verification boundary

TypeScript and production build pass. Six existing tests pass. React server-render
smoke checks pass for Home, Agents, Board, Sessions, Settings and Canvas.
The export renderer produced an empty screenshot; browser visual checks and exact
viewport measurements remain unverified. `index.html` now embeds the compiled app
and styles to remove relative-asset dependencies from the filesystem preview.
