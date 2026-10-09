# MainsApp — backlog do checkup de 08/10/2026

Status: usuário aprovou B01–B03 e B05–B12; B04 foi retirado por decisão explícita. Implementação supervisionada no Orca, Run `run_eee98d2a6cb2`. Os detalhes abaixo registram o escopo aprovado; ainda não representam entregas validadas desta rodada. Instalação inicial e fonte em 0.3.56; os 392 testes são a linha de base anterior.

Primeira onda: B01/B02/B08 com Sonnet (`task_9e01b02a324f`), B03/B05 com Opus (`task_e4eee212a46b`), B12 no projeto separado existente `MainsAgentsMobile` com Opus (`task_d5b771f0267a`). B07/B09/B10/B11 seguem em ondas posteriores. B06 aguarda vídeo indicado pelo usuário e escolha do destino de teste; a execução real não usará arquivos pessoais selecionados automaticamente. Pré-requisitos de validação iOS real também foram perguntados ao usuário.

Evidências: [core](checkup-core-2026-10-08.md), [UX](checkup-ux-2026-10-08.md), [entrega instalada](local-update-0.3.56.md).

## Propostas

| ID | Prioridade | Proposta | Complexidade / responsável sugerido | Critério de conclusão |
|---|---|---|---|---|
| B01 | P1 | Unificar status da Home, produção e próxima ação | Baixa / Sonnet | Capas, pacote e agendamento aparecem na etapa correta; projeção testada para todos os estágios. Divergência identificada no código, sem reprodução nova no app. |
| B02 | P1 | Checklist central “pronto para produzir?” | Baixa a média / Sonnet | Mostrar provedor/login, FFmpeg, Whisper, navegador de animações e integrações com motivos reais; reutilizar preflight, sem duplicar regras ou chamar IA. |
| B03 | P1 | Escolher o frame vendo o vídeo | Média / Opus + Sonnet | Miniaturas reais e seleção visual de instante, usando `suggestCandidateFrames`/`extractFramePreview`; versão/hash e rotação respeitados, sem IA e sem render a cada tecla. |
| B05 | P1 | Revisar e colocar legendas dentro do vídeo | Alta / Opus + Sonnet | Editor de texto/tempo e exportação MP4 com legendas aprovadas, além do SRT existente; fonte preservada e nova versão invalidando aprovações dependentes. Hoje o caminho confirmado gera SRT para uso externo. |
| B06 | P1 | Ensaio com vídeo real e contas configuradas | Média / Opus | Validar um clipe real, inclusive HDR se disponível, e o fluxo de IA/Notion escolhido. Publicação externa exige autorização específica; registrar diferenças entre testes simulados e reais, corrigir apenas falhas comprovadas. |
| B07 | P2 — decisão de produto | Produção local com Notion opcional | Alta / Opus | No modo local, roteiro aprovado libera gravação; no modo Notion, confirmação continua obrigatória. Sem duplicar cards ao conectar depois. Muda uma regra aprovada anteriormente. |
| B08 | P2 | Modo de leitura para gravar | Média / Sonnet | Texto grande, pausa/velocidade, tela cheia e orientação por cena, sem alterar o roteiro aprovado. A captura continua externa nesta proposta. |
| B09 | P2 | Analisar referências acessíveis | Alta / Opus + Sonnet | Gancho, ritmo e estrutura extraídos de vídeos fornecidos/autorizados, com fonte e limites explícitos; conteúdo inacessível não recebe análise inventada. Busca/coleta automática é decisão posterior de integração. |
| B10 | P2 | Atualização dos posts e alertas | Média / Opus | Acrescentar atualização automática ou ao abrir a tela, com cache e aviso de falha; nenhuma escrita externa nem reenvio. Consulta manual e transição para `published`/`failed` já existem e devem ser reaproveitadas. |
| B11 | P2 | Exibir uso reportado pelo CLI | Média / Sonnet | Primeiro verificar trace autorizado; guardar tokens/uso apenas quando informados, com origem clara. Sem inventar custo, saldo ou estimativas; preservar contador de chamadas existente. |
| B12 | Frente separada — decisão do usuário | Retomar app iPhone independente do PC | Alta / Opus + desenvolvimento mobile | Primeiro avaliar eventual projeto mobile existente e definir login, integração de IA e processamento no celular. Não tratar o pacote Electron/CLI desktop como aplicativo iOS pronto. Esta auditoria não cobriu outro projeto. |

## Ordem recomendada

B01 + B02 são ganhos rápidos; B03 reduz o preparo manual; B06 valida o uso real. B05 fecha a edição. B07 (Notion opcional) e B12 foram aprovados nesta rodada. B04 não será implementado: a identidade de loja foi considerada pertinente apenas para uma futura discussão mobile, não para o desktop pessoal do usuário.

## Limites e itens já presentes

- Roteiro versionado, revisão de cortes, checklist, três capas locais, seleção por destino e referências com tags já existem; não são tarefas novas.
- Gravação ocorre fora do app. Referências atuais são links/arquivos associados, sem coleta ou análise automática.
- Consulta manual de publicação já funciona no código: `reconcile` atualiza o estado retornado pelo provedor. A proposta B10 é automação de leitura, não correção de uma ausência de consulta.
- Não foram exercidas contas reais, novas inferências, Notion, publicação, novos vídeos ou testes nesta revisão. Riscos de HDR e disponibilidade de métricas do CLI dependem de evidência real.
- Retenção de backups e limpeza de nomenclatura são ajustes menores para uma rodada de manutenção; não são prioridades de produção neste backlog.
