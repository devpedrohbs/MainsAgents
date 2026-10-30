# Atualização local 0.3.85 — V2 estrutural (29/10/2026)

## O que mudou
- Barra lateral V2 (`src/components/layout/Sidebar.tsx`, 220 px): busca e chat no topo; Caixa de entrada (contagem do que espera você), Mission Control, Execuções (execuções ativas); grupos Conteúdo, Workspace e Equipe; rodapé com provedores, Configurações, conexão, salvamento e tema.
- Home → Mission Control (`src/pages/Home.tsx`): indicadores, "Precisa de você", tabela de execuções, equipe agora, próximas publicações e atividade.
- Novas páginas: Caixa de entrada (`src/pages/Inbox.tsx`), Execuções (`src/pages/Runs.tsx`), Pipelines (`src/pages/Pipelines.tsx`).
- Estúdio: trilha de etapas e painel de contexto (`src/components/content/StudioV2.tsx`).
- Estilos em `src/styles/v2-shell.css`. Canvas sem mudança. Páginas da equipe seguem o visual V2 da 0.3.84.
- Nenhuma mudança de modelo de dados; os estados novos são só preferências de interface (`inbox-seen:*`, `inbox-dismissed:*`, `runs-selected:*`, `mission-range`). O filtro de Execuções reaproveita `execution-overview-filter:*`.

## Validação
- `npm run typecheck`: aprovado. `npm test`: 920 testes, 918 aprovados, 2 ignorados.
- Testes de UI: `test-ux-flow-ui`, `test-refined-workspace-ui`, `test-publications-ui` aprovados; `test-execution-overview-ui` portado para a página Execuções e aprovado (fixture agora tem pautas/conteúdos válidos).
- Falhas anteriores à V2, não corrigidas: `test-content-flow-integration-ui` procura o botão "Enviar vídeo e iniciar edição automática" (texto mudou no commit 525edbb); `test-scopes-usage-ui` clica em `nav-flow`, página retirada antes da 0.3.84.
- Capturas com dados sintéticos: `node scripts/capture-v2-ui.mjs` (Electron) em `.mainsagents-workspaces/v2-ui/`.

## Instalação
- App fechado, sem trabalho ativo. Backup: `~/.mainsagents/backups/local-update-0.3.85-2026-10-29/final` (9 bancos ok, storage=148, sessões=16, skills=42).
- Instalador `release/r85-20261029/MainsAgents-Setup-0.3.85.exe` (SHA-256 224e6278…20ca59), `/S /currentuser`, retorno 0, FileVersion 0.3.85, ASAR 3696b0f4…8636d.
- Snapshots antes/depois: IDENTICAL. Agentes, skills, sessões e dados preservados.
