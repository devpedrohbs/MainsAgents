# D02 regressão — `test-semi-production-ui.mjs` (07/10/2026)

## Causa
O fixture escolhia a ideia e clicava a caixa de autorização imediatamente. O novo preflight é assíncrono (debounce 250 ms) e `ProductionDialog.tsx` zera a autorização quando o `preflight?.fingerprint` muda (linha ~76, efeito com `setAuthorize(false)`). Como o clique ocorria antes do relatório carregar, a chegada do primeiro fingerprint desmarcava o consentimento; o botão "Aprovar ideia e iniciar produção" ficava desabilitado ("Revise a ideia e o destino e marque a autorização acima"), o que bate com o log `mainsagents-round-test-semi-production-ui.log` (relatório "Nenhum bloqueio verificado" e botão desabilitado).

Isso é o comportamento projetado (consentimento ligado à configuração/relatório atual), não regressão de produto. Observação para a Opus, sem edição: um clique feito antes do relatório carregar é descartado em silêncio; talvez valha desabilitar a caixa enquanto o preflight carrega.

## Correção (somente `scripts/test-semi-production-ui.mjs`, uma linha)
Depois de escolher a ideia, o fixture espera a condição observável `.production-preflight [role=status]` com "Nenhum bloqueio"; **afirma que o botão de iniciar está desabilitado e que há 0 produções antes do consentimento**; marca a caixa e espera `checked===true`; só então aprova. Nenhum assert original foi retirado nem sleep adicionado; o início continua exigindo aprovação atual.

## Resultado (dist novo)
- `test-semi-production-ui.mjs`: `SEMI_PRODUCTION_UI_OK` em 3 execuções consecutivas (a última com os asserts novos).
- `test-production-flows-ui.mjs`: `PRODUCTION_FLOWS_UI_OK` (o log `files:inspect: Untrusted application window` é esperado/pré-existente).
- `test-chat-deliveries-ui.mjs`: PASS.
- Sem IA real, dados pessoais ou build.
