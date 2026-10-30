# Atualização local 0.3.86 — V2 completa (30/10/2026)

## O que mudou desde a 0.3.85
- Caixa de entrada: lista e detalhe lado a lado (antes o detalhe caía embaixo da lista).
- Estúdio: centro com abas **Conversa** (conversa com cada agente do conteúdo, ações agrupadas, aprovação pendente e caixa de envio) e **Etapas** (cartões de pauta, roteiro, arquivos e entregas de antes). Abre em Conversa quando a pauta tem conversas; ao abrir o Estúdio apontando para um conteúdo (ex.: "Abrir no Estúdio" no chat), mostra Etapas.
- Radar: cabeçalho com status da coleta, botões Síntese e Fontes (painéis recolhíveis), filtros e lista de sinais (comparação com a mediana do canal, sem nota inventada) com painel de detalhe (histórico, números, virar pauta/salvar referência).
- Calendário: cada post do dia leva à execução da produção ("abrir execução").
- Agentes: aba **Execuções** no painel do agente (últimas execuções e conversas).
- Uso: seção "Execuções que mais consumiram" com tokens/custo informados pelas execuções.
- Barra lateral: atalho Ctrl K compacto; estados da equipe não empurram o nome.
- Correção: o layout genérico das páginas novas deixou de sobrescrever a grade das páginas da equipe (Uso voltou a duas colunas).
- Mission Control em telas estreitas: indicadores 2×2 e tabela sem rolagem lateral.

## Validação
- `npm run typecheck` ok; `npm test`: 920 testes, 918 aprovados, 2 ignorados.
- UI aprovados: ux-flow, refined-workspace, execution-overview, publications, content-deletion, editorial-flow, content-scopes, checkup-b01-b02-b08 (portado para Execuções), checkup-b07-b09-b10, scopes-usage (passo do Flow retirado trocado por Pipelines), radar (com `MAINSAGENTS_UI_DIST=dist`).
- Ainda falhando, anterior à V2: `test-content-flow-integration-ui` (e provavelmente captions-frames, semi-production, smart-edit) seguem o fluxo de edição de antes da edição em etapas (corte → visual → legendas). O rótulo do botão foi atualizado para "Enviar vídeo e preparar cortes", mas o roteiro desses testes precisa ser reescrito.
- Capturas sintéticas em `.mainsagents-workspaces/v2-ui/` (escuro, claro, inglês a 880 px).

## Pacote
- Instalador `release/r86b-20261030/MainsAgents-Setup-0.3.86.exe`, SHA-256 19ac80fab781c5ae3d0bf3abac46e09b36afba18dd8ddad093939f5d628ca2c8; ASAR 6b22ad7b195e54f48d0f148bfa2de354ddbe1c7a72f5d4aacf58c3c7275a33ab. (`release/r86-20261030` ficou incompleto: arquivo travado.)
- Backup antes da instalação: `~/.mainsagents/backups/local-update-0.3.86-2026-10-30/final` (9 bancos ok, sem trabalho ativo).
- Instalação (30/10/2026): o app estava aberto na primeira tentativa e não foi fechado à força. Depois que o usuário fechou: nenhuma atividade, novo backup em `.../local-update-0.3.86-2026-10-30/final-closed` (9 bancos ok, skills=42, sessões=16), NSIS `/S /currentuser` retorno 0, FileVersion 0.3.86, ASAR 6b22ad7b…3ab, snapshots antes/depois IDENTICAL.
