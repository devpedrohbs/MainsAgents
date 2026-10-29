# Consumo da conta Claude — 0.3.79, 27/10/2026

## Causa e correção

O Claude Code já estava autenticado; o app consultava somente o snapshot em memória de `rate_limit_event` recebido durante execuções. Ao iniciar o app sem conversa, não havia limites; Atualizar apenas relia esse snapshot. O consumo por resposta (tokens e custo estimado do CLI) é um dado separado e foi preservado.

O backend agora consulta `GET https://api.anthropic.com/api/oauth/usage`, com o OAuth existente do Claude Code. Uma leitura real retornou HTTP 200, plano Pro, 51% na janela de cinco horas e 37% na semana em 27/10/2026 às 15:12 BRT. Nenhuma mensagem de IA foi enviada para essa consulta. O endpoint retorna utilização em **percentual**, enquanto o stream do CLI usa frações; os normalizadores permanecem separados.

- Token lido apenas no host, de `CLAUDE_CONFIG_DIR/.credentials.json` ou `~/.claude/.credentials.json`; `CLAUDE_CODE_OAUTH_TOKEN` também é respeitado. Não vai ao renderer, resposta HTTP, relatório ou logs; nenhuma credencial é gravada/renovada pelo app.
- Cache compartilhado por conta de cinco minutos, deduplicação de consultas simultâneas. Atualizar e término de conversa podem forçar consulta, respeitando intervalo mínimo de 15 segundos. Polling da interface pode consultar esse cache a cada minuto.
- HTTP 429 respeita Retry-After com espera mínima de um minuto; falha de rede espera um minuto; demais erros esperam cinco minutos por padrão. A última leitura real é marcada como desatualizada; dados ausentes nunca viram zero.
- Mudança de token/logout invalida o cache, inclusive respostas antigas ainda em andamento. HTTP 401/403 limpa os valores anteriores e orienta `claude auth login`.
- API key e provedores Bedrock/Vertex/Foundry são identificados como cobrança por API; limites de assinatura Claude não são exibidos para esse modo.
- Tela de consumo PT-BR/EN-US informa origem da conta, horário, plano e erros. Barra lateral usa os mesmos dados; a troca de provedor limpa o resultado anterior enquanto carrega.

## Arquivos

Implementação: `claude-account-usage.mjs`, `claude-code-bridge.mjs`, `src/features/usage/usageLedger.ts`, `src/features/usage/useProviderUsage.ts`, `src/pages/Usage.tsx`. Empacotamento/versão: `package.json`, `package-lock.json`. Testes: `tests/claude-account-usage.test.mjs`, `tests/claude-code-bridge.test.mjs`, `scripts/test-scopes-usage-ui.mjs`, `scripts/test-packaged-claude-usage.mjs`. Documentação: este relatório, `README.md`, `RELEASE.md`.

## Validação

```powershell
node --experimental-strip-types --test tests/*usage*.test.mjs tests/claude-code-bridge.test.mjs tests/provider-limits.test.mjs
npm run typecheck
npm run build
node scripts/build-remotion-video.mjs --release
node scripts/check-build-files.mjs
npx electron scripts/test-scopes-usage-ui.mjs
npx electron-builder --win nsis --publish never "--config.directories.output=release/r79-20261027"
$env:MAINSAGENTS_RELEASE_DIR='release/r79-20261027'
node scripts/check-desktop-release.mjs
npx electron scripts/test-packaged-claude-usage.mjs release/r79-20261027/win-unpacked/resources/app.asar
$env:MAINSAGENTS_TEST_ASAR=(Resolve-Path release/r79-20261027/win-unpacked/resources/app.asar).Path
npx electron scripts/test-desktop-persistence-ui.mjs
```

40/40 testes direcionados aprovados. Typecheck e grafo de 110 módulos sem ausências. Build inclui renderer, prévia, Remotion e Whisper. `SCOPES_USAGE_UI_OK` verifica limites antes de conversar com Claude, Atualizar trazendo novo percentual, indicação de login e limpeza dos números ao desconectar, troca Codex/Claude, temas claro/escuro e navegação. `PACKAGED_CLAUDE_ACCOUNT_USAGE_OK` verifica o backend real do ASAR com conta sintética, sem CLI/modelo. `PACKAGED_NATIVE_PERSISTENCE_UI_OK` verifica migração 0.3.78 → 0.3.79 e persistência em perfil temporário. A suíte geral não foi repetida nesta correção; a validação foi direcionada aos módulos afetados.

## Instalação e preservação

App fechado, zero jobs/turnos/processos pessoais ativos antes e depois. Instalador NSIS executado com `/S /currentuser /D=C:\Users\pacas\AppData\Local\Programs\MainsAgents`, janela oculta, retorno **0**. FileVersion **0.3.79**, ProductVersion **0.3.79.0**. ASAR instalado idêntico ao pacote; atalhos Desktop e Menu Iniciar apontam ao executável canônico. O app pessoal não foi aberto para evitar retomadas automáticas.

- Instalador `release/r79-20261027/MainsAgents-Setup-0.3.79.exe`, SHA-256 `1ca4e072bdd744f519e0fade1bc2e4799fc50b4b60a137a9fda2f9823f80536e`.
- ASAR SHA-256 `6425af8dfbdad03881c7696a119e6d2e4a0c0dab01af4dfea96e87750168c260`.
- Backup externo ao Git: `C:/Users/pacas/.mainsagents/backups/local-update-0.3.79-2026-10-27/`.
- Nove bancos copiados pela API online SQLite, todos íntegros; arquivos locais, sessões, perfil auxiliar e skills copiados, incluindo recursos das 15 pastas de skills.
- Snapshots lógicos completos antes/depois idênticos: todas as linhas dos nove bancos, 142 arquivos locais e 15 pastas de skills. SHA-256 do snapshot `e6ff7076c10dedfbc726d2f982ca31e542618084ca7bb293c11de087aba35fc8`. Comparação estrita adicional sem diferenças, inclusive leases.
- Evidências externas: `install-receipt.json`, `verification-installed.json`, `activity-before-install.json`, `activity-after-install.json`, `full-before.json`, `full-after.json`, `before.json`, `after.json`, manifesto de backup e manifesto dos recursos das skills.

## Limites

A consulta OAuth é uma interface interna usada para leitura de conta, sem contrato público estável; se mudar ou bloquear consultas, o app informa indisponibilidade em vez de inventar limites. O login usa o arquivo local do Claude Code nesta entrega Windows; não implementa leitura do Keychain do macOS. Tokens expirados devem ser renovados pelo próprio Claude Code, não por este leitor. Os percentuais representam a conta e podem incluir uso de outras superfícies Claude; os tokens/custos por agente continuam sendo o histórico local de respostas registradas no app. Não houve commit, push, publicação ou mudança de dados pessoais nesta rodada.

Referências primárias: [limites compartilhados Claude/Claude Code](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan) e [dados de consumo e custo no status line](https://code.claude.com/docs/en/statusline). O formato do endpoint de conta foi validado pela resposta real, sem atribuí-lo a um contrato público documentado.
