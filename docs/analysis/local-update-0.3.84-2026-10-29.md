# Design V2 — 0.3.84 local

Rodada local de 29/10/2026 sobre a 0.3.83, sem commit, push, tag ou publicação pública. O código de interface já existente foi preservado e empacotado; esta rodada altera somente versão, documentação e artefatos de release.

## Design incluído

- `src/styles/v2.css`: base, tokens claro/escuro, moldura, navegação e controles compartilhados.
- `src/styles/v2-pages.css`: Home, Estúdio e Radar.
- `src/styles/v2-team.css`: páginas da equipe, agentes, histórico, escopos, uso, configurações, quadro e referências.
- `src/components/common/StatusIcon.tsx`: estados compartilhados de execução.
- Pranchas aprovadas em `docs/design/v2`. O Canvas mantém o visual anterior, com seus espaços já presentes na 0.3.83.
- A correção preexistente de `scripts/test-editorial-flow-ui.mjs` lê tanto `canvas.nodes` quanto os nós do espaço ativo em `canvas.boards`; a asserção do conteúdo vinculado permanece. O teste foi validado sem modificar estilos ou código de interface nesta rodada.

## Validação e pacote

- `npm run typecheck`: aprovado.
- Suíte completa com `node --experimental-strip-types --test --test-concurrency=2 tests/*.test.mjs`: **920 testes, 918 aprovados, 2 renders HyperFrames condicionais ignorados, zero falhas**, em 224,9 s.
- `npm run desktop:dist`: aprovado, incluindo build do renderer, Remotion de release e Whisper; saída temporariamente direcionada a `release/r84-20261029` pela configuração de build no `package.json`, restaurada para `release` ao terminar. `check-build-files` e `check-desktop-release` aprovaram 120 módulos, nenhum ausente.
- Os três arquivos de entrada/assets do renderer no ASAR são idênticos ao dist final testado; recibo `renderer-equivalence.json`.
- Logs e recibos desta rodada em `release/r84-20261029`.

| Teste de UI | Resultado |
|---|---|
| `test-ux-flow-ui` | Aprovado; PT/EN, claro/escuro e 360/880/1440 px |
| `test-radar-ui`, `MAINSAGENTS_UI_DIST=dist` | Aprovado; backend real e fixtures de fontes/IA |
| `test-canvas-boards-ui` | Aprovado; migração, teclado, espaços isolados, exclusão, temas e 360 px |
| `test-editorial-flow-ui` | Aprovado; roteiro editado, retry explícito, reinício, deduplicação e Canvas vinculado |
| `test-publications-ui` | Aprovado; revisão, calendário, aprovação, seleção de contas e reinício sem duplicatas |
| `test-desktop-persistence-ui`, `MAINSAGENTS_TEST_ASAR=<ASAR 0.3.84>` | Aprovado; perfis, agentes, conversas, tarefas e Canvas preservados |

Instalador: `release/r84-20261029/MainsAgents-Setup-0.3.84.exe`.

- SHA-256 do instalador: `9e9dc1c4aa9ac1719efb41af1547a8487cfc1aabd1fcaf066a526224a07bde6f`.
- SHA-256 do ASAR do pacote: `7db76f6dd8492395b32f437c4d2d68b145ee4c8016906fde361014d7a0d17ad4`.

## Backup e instalação

Backup fora do Git em `~/.mainsagents/backups/local-update-0.3.84-2026-10-29`, pelo mesmo processo da 0.3.83: API SQLite online, integridade dos nove bancos, arquivos locais, sessões e suplemento dos recursos de skills. O backup inicial preservou 15 raízes de skills e 63 arquivos de recursos. Credenciais não são copiadas nem alteradas.

Às `2026-10-29T20:35:03Z`, o fechamento normal da 0.3.83 foi recusado pelo guard de salvamento: “Newer saved data exists. Your changes are still in memory; export a backup and reload before continuing.” Não houve encerramento forçado nem instalação. O coordenador orientou manter o app aberto, sem exportar pela UI, para o usuário resolver o conflito e fechá-lo; comparação final e instalação aguardam esse aviso.

Limites: os testes usam perfis e dados sintéticos, sem inferência paga ou publicação em contas pessoais. Os dois renders HyperFrames condicionais não foram executados nesta rodada. Avisos de chunks grandes, SQLite experimental e depreciação do Node não impediram as validações.

## Instalação concluída

- O usuário fechou a 0.3.83 normalmente às `2026-10-29T20:49:01Z` (`Close storage verification: saved`); `activity` sem jobs, turnos ou processos.
- Backup final em `~/.mainsagents/backups/local-update-0.3.84-2026-10-29/final-1753`: nove bancos com integridade `ok`, 147 arquivos do storage, 16 sessões e 42 arquivos de skills.
- Hash do instalador conferido; NSIS `/S /currentuser /D=<destino canônico>`, retorno **0**. FileVersion **0.3.84**, ProductVersion **0.3.84.0**; ASAR instalado `7db76f6d…7ad4`, idêntico ao pacote. Atalhos da Área de Trabalho e Menu Iniciar apontam para o executável instalado.
- `compare before-install.json after-install.json --strict-leases`: idênticos.
- Rascunhos do Estúdio: o estado salvo tem 1 rascunho; 3 rascunhos de handoff que existiam só na memória da 0.3.83 não foram persistidos e estão preservados em `studio-drafts-union.json` (backup no formato `mainsagents-backup`, importável em Configurações → Dados). Não foram gravados diretamente no banco.
