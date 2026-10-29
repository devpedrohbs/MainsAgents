# Atualização local 0.3.81 — 29/10/2026

**Instalada nesta máquina em 29/10/2026, às 11:19 (America/Sao_Paulo), sobre a 0.3.80.**

- **Instalação:** NSIS silencioso por usuário, retorno 0.
- **Conferência:** versão 0.3.81.0 e ASAR instalado `1c35211e…b064` = pacote `release/r81-20261029`.
- **Dados:** preservados (`compare --strict-leases`: IDENTICAL).
- **Fora desta rodada:** release pública, push e tag.

## Escopo

Radar editorial, fases 1 e 2 (branch `feat/radar`; backend Claude, interface Codex):

- coleta diária de canais do YouTube (RSS, ou YouTube Data API gratuita com chave criptografada) e notícias (RSS, Hacker News);
- destaques pela mediana dos vídeos maduros do próprio canal, histórico de coletas append-only, lacunas registradas;
- síntese diária com um agente salvo do workspace, só pela assinatura: espera limites e uso alto do Claude, nunca usa API paga;
- virar pauta e salvar na biblioteca de referências, sem duplicar;
- retenção (API do YouTube 30 dias, feeds 365) e backup do radar sem a chave.

`subscription-env.mjs` remove as variáveis de API paga do ambiente do Claude Code e do Codex em todo o app.

## Pacote

- `package.json` `build.files` ganhou `radar-runtime.mjs`, `radar-sources.mjs`, `radar-metrics.mjs`, `radar-synthesis.mjs` e `subscription-env.mjs` (apontados por `check-build-files.mjs`).
- Instalador `MainsAgents-Setup-0.3.81.exe`, SHA-256 `8b100fec5263c76f9d3e5c37b0ad04339dfd98be1d909331f652e94ac6616ae4`, 120 módulos nativos.

## Backup

`C:\Users\pacas\.mainsagents\backups\local-update-0.3.81-2026-10-29` (129 MB): bancos SQLite íntegros, `before-install.json`, `after-install.json`, `install-receipt.json`.
