# Backlog proposto — MainsAgents desktop

Data: 07/10/2026. Base: código local 0.3.54, relatórios anteriores, capturas de fixtures e pesquisa oficial. Estado: aguardando aprovação do usuário; nenhum worker recebeu tarefa desta rodada. Não envolve o projeto mobile.

## Evidências e limites da auditoria

- Já existem progresso por etapa, próxima ação, rascunhos, diagnóstico de runtime, orçamento por chamadas/tentativas, revisão por versão, recuperação, Inbox e comparação Codex/Claude. Melhorias abaixo ampliam essas entregas, não as recriam.
- `production-coordinator.mjs`: `drain` percorre produções sequencialmente; usa lease, orçamento, eventos e recuperação explícita. Não propor concorrência irrestrita.
- `src/features/flows/flowModel.ts`: quatro tipos de caixa e conexões editáveis. `src/features/production/productionProgress.ts`: etapas lineares do coordenador. Existe oportunidade de explicar/validar o que o desenho realmente executa; não tratar o editor como executor genérico de grafos.
- `HomeProductionPipeline.tsx`: resumo deriva de `content.productionStage`; `Flow.tsx` e progresso usam dados de produção. Auditar divergências antes de classificá-las como bugs.
- `ProductionDialog.tsx`: histórico de eventos já existe, mas a consulta fica dentro da produção individual. Há oportunidade de visão global e recuperação mais explicativa.
- Capturas `overview-light.png` e `studio-light.png` de 06/10 em `.mainsagents-workspaces/refined-ui-test` mostram o splash. `test-refined-workspace-ui.mjs` espera elementos no DOM e 240 ms antes de capturar; `app.html` tem splash sobreposto e sem captura de ponteiro. Isso limita a evidência visual, sem invalidar automaticamente todas as verificações funcionais.
- README referencia prévia pública 0.3.42; RELEASE começa pela rodada 0.3.40; package está em 0.3.54. Versão local não prova release pública.
- Não foram realizadas entrevistas, testes de uso pessoal, novas chamadas de IA ou escritas externas. Prioridades são julgamento baseado nas evidências acima, não métricas de usuários.

## Níveis e distribuição

P1 = benefício imediato na operação e clareza; P2 = evolução após base operacional. Não foi confirmado bloqueador P0 nesta auditoria.

S = pequena/local; M = média, múltiplos componentes; L = grande, persistência/runtime/recuperação. Nível representa complexidade, não promessa de duração ou tokens.

Sonnet recebe S com critérios fechados. Codex 6.1 Low recebe M com contratos e etapas pequenas. Opus recebe decisões de arquitetura e L; separar investigação de execução quando houver incerteza. A identidade/modelo dos dois terminais Claude deve ser confirmada antes do despacho; não inferir pelo título genérico.

## Tarefas propostas

### D01 — Capturas visuais confiáveis

P1 · S · Sonnet. Escopo: scripts de teste UI e readiness do splash; não redesenhar o app.

Esperar a interface efetivamente visível, a remoção/ocultação do splash e estabilidade do layout antes de capturar. Usar condições observáveis, não apenas aumentar sleeps. Registrar telas/temas/dimensões e distinguir teste funcional de revisão visual.

Aceite: Home, Estúdio, Fluxo e chat aparecem nas capturas; fixture falha se o splash cobre a tela; claro/escuro e larguras compactas são verificadas com dados sintéticos.

### D02 — Conferência completa antes de iniciar produção

P1 · L · Opus. Escopo: contratos/preflight do coordenador, runtime capabilities, seleção de arquivos e integração de início.

Consolidar requisitos já existentes: agentes e provedores aptos, ferramentas autorizáveis, destino Notion configurado, FFmpeg/ffprobe conforme etapa, arquivos e plataformas. Mostrar bloqueadores, avisos e ações de correção antes da primeira chamada de IA. Disponibilidade de ferramenta não equivale a acesso autenticado verificado; leitura externa só quando autorizada. Não exigir mídia antes da etapa de gravação.

Aceite: prévia não escreve externamente nem inicia IA; falha obrigatória conhecida impede início; requisitos mudam com a etapa; estado verificado/desconhecido/indisponível fica explícito; validação final protege mudanças entre revisão e envio.

### D03 — Visão de execuções e fila

P1 · M · Codex 6.1 Low. Escopo: nova visualização/componentes e leitura de dados; coordenador apenas se contrato mínimo for indispensável e acordado com Opus.

Listar produções em execução, aguardando revisão, bloqueadas, pausadas e concluídas, por workspace. Exibir agente, etapa, motivo, atualização e acesso ao chat/revisão. Expor espera pelo executor quando comprovada, sem inventar posição/ETA. Primeira entrega sem reorder ou aumento de concorrência.

Aceite: fechar/reabrir preserva consulta; filtrar ou abrir detalhe não envia nada; duas produções mostram estado verdadeiro; nenhuma execução fora do perfil/workspace é exposta.

### D04 — Alinhar desenho do Fluxo e execução real

P1 · M · Opus. Escopo: flowModel, validação do vínculo e comunicação no Fluxo, com integração de UI delimitada.

Definir e mostrar quais conexões organizam contexto e quais são suportadas pela produção semiautomática. Validar agente ausente, caixas/conexões incompatíveis e edições durante execução. Não implementar executor genérico de DAG nesta tarefa.

Aceite: mudar desenho não sugere mudança automática de execução; configuração suportada é explicada; topologia incompatível informa limitação antes de iniciar; produções existentes e backups preservados.

### D05 — Status coerente em Home, Fluxo e Estúdio

P1 · M · Codex 6.1 Low. Escopo: função de projeção de status + consumidores, em sequência após D03 para evitar conflito.

Definir fonte e precedência entre produção, conteúdo e entregas. Mostrar parada e motivo de forma consistente. Atalhos devem abrir a produção/conteúdo correto; não corrigir status persistido por heurística visual.

Aceite: fixtures cobrem gravação, edição, pausa, bloqueio, conclusão e dados legados sem evidência; mesma produção não ganha fases conflitantes entre telas; nenhum percentual fictício.

### D06 — Retomada com prévia do que será verificado ou reenviado

P1 · L · Opus. Escopo: expansão da recuperação atual e recibos, depois de D02/D04.

Ao retomar, mostrar etapa salva, saída existente, resultado incerto e ação pretendida. Diferenciar verificar, continuar e reenviar. Reutilizar identidade/recibo e limite de tentativas atuais. Incerteza externa deve exigir reconciliação; não reenviar agendamento para tentar descobrir se funcionou.

Aceite: interrupções antes/depois de recibo não duplicam roteiro/card/publicação; resultado já confirmado é reaproveitado; orçamento permanece; aprovações antigas ou importadas não autorizam novos efeitos.

### D07 — Contexto editorial versionado por workspace

P2 · L · Opus. Escopo: modelo de contexto, persistência, backup e montagem de briefing.

Guardar público, tom, produtos, restrições e referências da marca em campos editáveis. Cada execução captura a versão utilizada. Começar com contexto explícito; não inferir memória automaticamente de todos os chats.

Aceite: editar marca não altera execução em curso; contexto correto segue para o agente; segregação por perfil/workspace e backup validados; sem credenciais nos campos.

### D08 — Modelos reutilizáveis de produção

P2 · M · Codex 6.1 Low. Escopo: configurar e instanciar modelos sobre fluxo existente; não criar novo motor.

Modelos para vídeo curto e carrossel com agentes, formato e checklist. Duplicação de fluxo já existe: ampliar para parâmetros reutilizáveis, sem clonar conteúdo, sessões, autorizações ou recibos. Entrega depende de D04 e compatibilidade real de cada formato.

Aceite: instanciar modelo prepara configuração, não executa; cada produção tem identidade própria; limites/capacidades incompatíveis são mostrados; modelos importados não concedem permissões.

### D09 — Rotinas locais com calendário de próximas execuções

P2 · L · Opus. Escopo: agenda persistente e disparo controlado; depende D02/D06.

Primeiro recorte: rotina de pesquisa ou rascunho em horário escolhido. Fuso, próximo disparo, histórico, desativação e política de horário perdido. Funciona com desktop aberto; bandeja pode ser incremento separado. Não prometer execução com PC desligado nem criar publicação automática nesta tarefa.

Aceite: reinício/suspensão não duplicam disparo; usuário escolhe comportamento para atraso; orçamento limita chamadas; nenhum efeito externo sem autorização específica.

### D10 — Revisão de versões e materiais dentro do app

P2 · M · Codex 6.1 Low. Escopo: previews locais + comparação de texto/imagens, separada do editor avançado.

Comparar roteiro/legenda anterior e atual, prévia de capa e reprodução do vídeo associado. Mostrar versão selecionada e o que está aprovado. Reutilizar validação de arquivos existentes; não incorporar nova edição avançada FFmpeg.

Aceite: revisão usa arquivo/versão verificável; arquivo alterado invalida estado pronto; preview não escreve nem aprova; compacta e teclado funcionam; comparação não chama IA.

### D11 — Clareza das ações e polimento visual localizado

P2 · S por lote · Sonnet. Escopo: pequenos componentes após D01, mantendo direção Precisão/Geist/azul.

Lotes separados: rótulos que diferenciem abrir chat/preparar/enviar/executar; estados vazios com próxima ação; foco visível e status com texto além de cor. Corrigir problemas comprovados nas novas capturas, com antes/depois. Não redesenhar globalmente nem mudar lógica de aprovação.

Aceite: PT/EN, teclado, temas e escala 100–200%; nenhum botão de preparo executa tarefa por acidente; cada lote tem escopo e evidência próprios.

### D12 — Documentação e matriz de recursos atualizadas

P2 · S · Sonnet. Escopo: README, RELEASE, backlog e matriz de recursos.

Separar versão local, último instalador público, capacidades reais e limites por provedor. Atualizar estados desatualizados consultando código e relatórios finais; preservar histórico das rodadas.

Aceite: não anunciar 0.3.54 como pública sem evidência; recursos simulados/validados localmente não viram integração real; cada pendência tem próximo passo verificável.

## Execução proposta após aprovação

Primeira onda: Sonnet D01, Opus D02, Codex D03. Opus define contrato de preflight antes da UI; Codex usa somente leitura existente para painel de execução. Segunda onda: D04, D05 e D06 com ownership explícito; tarefas grandes do Opus sequenciais. Sonnet pode seguir com D12 enquanto UI/runtime são trabalhados. D11 depende de capturas válidas. Evoluções D07–D10 recebem aprovação por recorte.

Coordenador neste chat prepara briefs completos, delimita arquivos, recebe dúvidas/relatórios, valida evidências, integra e atualiza backlog. Não enviar agentes simultaneamente para editar os mesmos arquivos. Não fazer instalação pessoal, publicação, chamadas pagas nem escrita em contas externas como parte da validação automática.

## Fontes de pesquisa

- n8n, visão e filtros de execuções e distinção entre repetir com versão original/atual: https://docs.n8n.io/build/understand-workflows/understand-executions/view-all-executions
- n8n, aprovação por ferramenta/argumentos e reação a negativa: https://docs.n8n.io/build/integrate-ai/ai-examples/human-in-the-loop-for-tools
- Apple HIG, agrupamento, espaço para informação essencial, status perceptível e controle sobre IA: referências locais da skill apple-design, `layout.md` (Best practices), `accessibility.md`, `generative-ai.md` (Keep people in control / Transparency).
- Filtro de escopo da skill revenue-centric-design: https://x.com/richardrx/status/2059236567533650119

Estas fontes inspiram a proposta; não estabelecem que o MainsAgents tem todos os problemas descritos em outros produtos. n8n é referência de comportamento, não dependência recomendada para o projeto.
