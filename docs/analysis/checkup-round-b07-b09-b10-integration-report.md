# Rodada B07 + B09 + B10 + B11 (+ preparo B6) — relatório (2026-10-08)

Status: **código, testes focados, teste global e pipeline Electron concluídos (ver Evidências); B6 só preparado — aguarda vídeo e escolha do usuário.** Sem commit, reset, instalação, NSIS, dependências novas ou subagentes. Nenhuma conta, Notion, Claude ou publicação reais foram usados.

Escopo/limpeza: B04 (identidade da loja/workspace) está **excluído** pelo usuário (não pendente, não autorizado). O relatório B03/B05 já o marca assim; a referência “Left B04 style customization” não existe mais.

## Feito

- **B11**: `production-coordinator.mjs:107` grava `usage.reported` com `recordUsage(p,call.id,event.usage,stamp())` apenas para provedor `claude` e `executionId` da etapa (a primeira leitura vence; contagem/limites intactos; Codex fica “indisponível”). A UI mostra “indisponível” quando falta e nunca alega saldo/fatura (custo = estimativa local do CLI). `claude-usage.mjs` está nos arquivos do build; `scripts/check-build-files.mjs` confirma 71 módulos de runtime empacotados, 0 ausentes.
- **B07 (Notion opcional)**: `scriptMode` `'notion'` (padrão/legado; campo ausente) | `'local'`, escolhido explicitamente no início (rádio + texto de consentimento por modo), no preflight (fingerprint inclui o modo) e no run; backup normaliza. Local: aprovar o roteiro libera a gravação sem job/leitura/card do Notion; prompts dizem que não há card. Modo Notion inalterado, sem fallback silencioso. Nova versão do roteiro retira aprovação **e checklist**. `enable-notion` reaproveita o mesmo artefato/hash (job idempotente, sem card duplicado). Wizard B02 mostra o item Notion como opcional.
- **B09**: `editor-inspiration-analysis.mjs`; só vídeo local do workspace (asset/versão/sha256); links nunca acessados. Evidência local (FFmpeg + Whisper local), **uma** chamada de IA por autorização explícita; nenhum quadro é enviado (Codex/Claude recebem só texto) e isso consta na cobertura — não há análise de imagem simulada. Proveniência, limites, cancelamento, `interrupted`, importação por backup como histórico (nova autorização para usar), vínculo/desvínculo de briefing por ideia (nunca automático). Painel `ReferenceAnalysisPanel` agora com CSS próprio e tolerante a resposta inesperada do servidor (`analyses` ausente não derruba a tela — corrigido nesta rodada após o teste refined-workspace expor o crash).
- **B10**: `publishing.observe` somente leitura; falha de rede mantém `scheduled`; só recibos confiáveis `published`/`failed` (guarda de snapshot); nunca create/update/cancel. Atualização ao abrir (cache 60 s), manual e automática enquanto o app está aberto (5/15/30/60 min, liga/desliga), só perfil ativo, para ao fechar. Sem worker na nuvem nem endpoint novo.

## Testes novos / ajustados nesta retomada

- **Novo** `scripts/test-checkup-b07-b09-b10-ui.mjs` (renderer real `dist`, SQLite, FFmpeg real; LLM/Notion/Zernio/Whisper simulados, 0 requisições externas): modo local pelo diálogo (0 chamadas Notion até ativar), gravação liberada sem Notion, **Ativar Notion** → 1 upsert, mesmo hash, sem card duplicado; entrega agendada via serviço real → status ao abrir, falha de rede mantém agendado (aviso), recibo `published` gravado, **0 escritas** no provedor; referências: link não analisado, nada roda antes da autorização, 1 chamada de IA, sem caminho local no prompt, vincular/desvincular sem nova chamada. Capturas em `.mainsagents-workspaces/b07-b09-b10-ui/<ts>/`.
- Testes Electron desatualizados por mudanças intencionais desta rodada e corrigidos (não são regressões do app): seletor do 1º checkbox (agora o 1º `input` é o rádio de modo) em preflight/integração/semi/smart-edit; rótulo “Roteiro (e card no Notion, se ativado)”; smart-edit passou a aprovar o roteiro; preflight: o agente Claude de vídeo agora é suportado (bloqueio só se o CLI estiver ausente — fixture usa “não instalado”) e o link de pré-requisito antigo não existe mais.

## B6 (preparo, nada executado de verdade)

`scripts/rehearsal-real-video.mjs`: `--video <caminho> [--mode local|notion]` faz apenas ffprobe (metadados, tags de cor/HDR) e imprime o plano do ensaio; `--selftest` gera clipes **sintéticos** (SDR e HDR10 com fala do Windows TTS) para QA — claramente rotulado como não real. Nenhum arquivo é escolhido sozinho; zero chamadas a Claude/Notion/rede. Achado do selftest: o app não faz mapeamento de tons HDR→SDR (nenhum `zscale/tonemap`); a medição sintética **não prova** degradação, então nada foi corrigido — só um clipe real do usuário decide.

## Evidências finais

Ver seção “Resultado do teste global” abaixo (preenchida ao final da execução).

## Pendente

- B6 real: aguarda caminho do vídeo e escolha **Claude local** ou **Claude + card de teste Notion** (continua pendente; opção pré-selecionada não é resposta). Publicação externa exige autorização à parte.
- Cobertura Electron do cancelamento de análise B09 e do backup/importação está nos testes unitários/coordenador, não na UI.
- Instalação/empacotamento desktop (outro despacho).

## Resultado do teste global (único, após os donos do desktop fecharem)

- `npm run typecheck`: limpo. `npm test`: **449/449** passam. `npm run build` **completo** (tsc, Vite, preview, bundle Remotion, ferramentas Whisper): ok; `check-build-files`: 71 módulos, 0 ausentes.
- Pipeline Electron: **todos os 29 `scripts/test-*-ui.mjs` passam**, incluindo o novo B07/B09/B10 (os dois modos de roteiro, legendas, quadros, referências, uso, status de publicação), com serviços externos simulados e perfil isolado. Única exceção na rodada em lote: `test-content-flow-components-ui` bateu o timeout de 400 s do laço (não encerra o processo sozinho); rodado isolado: 31/31 passos, 0 erros.
- Logs: `/tmp/final-*.log` (temporários) e capturas em `.mainsagents-workspaces/`.
