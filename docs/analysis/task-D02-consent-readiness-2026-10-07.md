# D02 — Consentimento só com verificação pronta (07/10/2026)

## Mudança
- `src/components/production/ProductionDialog.tsx` (somente o `<input type="checkbox">` de `setAuthorize`): `disabled={busy||!preflight||preflight.blockers.length>0}` e `title` "Aguarde a verificação antes de aprovar." / "Wait for the pre-start check before approving." enquanto não há relatório. O reset por fingerprint, o botão de iniciar e os demais guards ficaram intactos.
- Efeito: um clique feito antes do relatório carregar não é mais aceito (antes era descartado em silêncio quando o primeiro fingerprint chegava). Com bloqueio verificado (por exemplo, ideia não escolhida ou agente de vídeo Claude), a caixa também fica desabilitada.

## Teste (`scripts/test-production-preflight-ui.mjs`)
- A resposta do preflight é retida por um portão controlado: com o relatório pendente, a caixa está desabilitada, o clique não a marca e há dica de espera; ao liberar, a caixa habilita.
- Fluxo existente mantido: marcar a autorização e trocar o fluxo a desmarca; com bloqueio do Claude a caixa continua desabilitada e o início desabilitado; IA/Notion/publicação/runs em 0.
- Sem sleeps novos: tudo por condições observáveis.

## Resultado (novo dist do coordenador)
`PRODUCTION_PREFLIGHT_UI_OK`, `SEMI_PRODUCTION_UI_OK` e `PRODUCTION_FLOWS_UI_OK` (o log `files:inspect: Untrusted application window` é esperado). `npx tsc -b` sem erros.

## Limites
Cobre o diálogo do Fluxo; o início pelo chat não foi exercitado. Sem IA real, dados pessoais ou contas.
