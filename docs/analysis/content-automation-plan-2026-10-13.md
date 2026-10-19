# Automação de conteúdo no MainsAgents — proposta de 13/10/2026

Objetivo: reduzir a preparação manual, a quantidade de gravações necessárias e a transferência de materiais entre aplicativos. Este documento registra o diagnóstico e os incrementos propostos; não representa implementação ou instalação de novas funções.

## Base encontrada no projeto

| Área | Evidência | Oportunidade |
| --- | --- | --- |
| Carrosséis | `src/features/agents/agentTemplates.ts` e `docs/analysis/task-04-carousel-editorial.md`: texto ordenado, briefings de imagens, revisão e aprovação | Ligar o material aprovado ao design, às imagens e às exportações verificadas |
| Paper | `runtime-tool-policy.mjs` já classifica ferramentas de leitura, escrita, exportação e exclusão | Criar uma experiência de produção de carrossel, além do catálogo de ferramentas |
| Claude | `claude-code-bridge.mjs`: chats comuns têm ponte de aprovação MCP quando disponível; plugins são desativados. O editor de vídeo usa um servidor próprio restrito | Verificar a configuração do Paper na execução real do chat; instalação por plugin pode precisar de adaptação |
| Imagens | `README.md`: geração nativa do Codex, anexos e armazenamento persistente; o modelo de texto não seleciona o modelo de imagem | Associar imagens aos slides e oferecer um provedor opcional com seleção explícita de GPT Image 2.5 |
| Produção de vídeo | `production-coordinator.mjs` e `ProductionDialog.tsx`: roteiro, gravação, edição, legendas, capas, revisão e agendamento | Reaproveitar a gravação em várias entregas e organizar gravação em lote |

Os relatórios de 06/10 e a documentação de versões anteriores contêm estados históricos. Em particular, a afirmação de que todo MCP do Claude é bloqueado não descreve integralmente o bridge atual. Capacidade presente no código não comprova o funcionamento no aplicativo instalado.

Na consulta desta sessão, o MCP do Paper respondeu que o Paper Desktop não estava aberto. Não houve leitura de um documento, criação de design, geração de imagem ou teste de exportação. A configuração atual do usuário e a disponibilidade do Paper dentro do MainsAgents não foram comprovadas nesta rodada.

## Ordem recomendada

### 1. Carrossel completo no Paper

Experiência proposta: aprovar os slides no Estúdio, escolher uma identidade visual salva e usar **Gerar no Paper**. O app entrega o documento editável, uma galeria para revisão e os slides exportados em ordem.

Primeiro incremento:

- Verificar o servidor Paper e a leitura real pelo provedor escolhido no MainsAgents. Distinguir instalação via plugin de servidor MCP configurado; evitar registrar conexões duplicadas.
- Vincular arquivo, página e slides à produção e à versão aprovada.
- Montar os slides com texto editável e imagens associadas. Usar materiais existentes ou o gerador disponível; permitir inicialmente carrossel apenas tipográfico.
- Conferir legibilidade, cortes de texto, contagem e dimensões dos slides antes de registrar a entrega.
- Salvar exportações na biblioteca do conteúdo, com nomes ordenados e arquivos reais verificados.
- Uma alteração em um slide permite atualizar somente aquele slide. Uma tentativa interrompida recupera o trabalho vinculado antes de criar outro documento.

Aceite: um carrossel piloto com sete slides vai da revisão ao Paper e a sete arquivos válidos; reabrir a produção recupera os vínculos; corrigir o slide 3 preserva os demais. O teste real deve atravessar o chat do MainsAgents, não apenas uma sessão externa do Claude.

A documentação atual do Paper recomenda conexão por `paper mcp` e oferece leitura e escrita de designs baseados em HTML/CSS. [Paper MCP](https://paper.design/docs/mcp).

### 2. Uma gravação, várias entregas

Experiência proposta: adicionar uma gravação e usar **Reaproveitar conteúdo**. A transcrição alimenta sugestões de trechos com início e fim, um carrossel e posts adaptados às plataformas escolhidas.

Primeiro incremento: sugerir até três cortes que façam sentido isoladamente, um carrossel e um post de texto. O usuário revisa a seleção; os executores existentes geram os arquivos. Cada derivado mantém referência à gravação original e sua própria versão.

Aceite: os cortes usam intervalos válidos, preservam o sentido do que foi dito e aparecem como arquivos da mesma produção. O carrossel distingue falas do vídeo de novas informações pesquisadas. A quantidade de derivados depende do material disponível; não é uma promessa de que qualquer vídeo renderá três bons cortes.

### 3. Gravação em lote

Experiência proposta: selecionar roteiros aprovados e usar **Preparar sessão de gravação**. O app organiza uma fila, agrupa assuntos e materiais semelhantes, oferece leitura focada do texto e uma lista curta do que mostrar em cada vídeo.

Reaproveitar o pacote de gravação e a aprovação por versão já existentes. Acrescentar navegação entre roteiros, marcação de takes e associação dos vídeos importados à produção correspondente. A duração sugerida é uma estimativa, ajustável ao ritmo real de fala.

Aceite: preparar cinco roteiros sem copiar textos entre aplicativos; navegar entre eles mantendo a versão aprovada; associar os takes sem iniciar cinco fluxos manualmente do zero. Sincronização com celular fica para um incremento posterior.

### 4. Imagens GPT Image 2.5 como opção

A documentação oficial oferece `gpt-image-2.5-flare` para geração rápida e `gpt-image-2.5-sunburst` para edição precisa. Uma integração pela Image API permite escolher o modelo explicitamente. [OpenAI: geração de imagens](https://developers.openai.com/api/docs/guides/image-generation).

Proposta: manter o caminho nativo existente e adicionar um provedor opcional no backend, com chave protegida, modelo/qualidade visíveis, limite de gasto por produção, armazenamento local e regeneração de uma imagem por vez. Imagens de referência e instruções da marca devem acompanhar cada pedido. Textos permanecem editáveis no layout do Paper.

Uso da API tem cobrança própria; acesso pelo plano ChatGPT não deve ser apresentado como crédito automático para essa integração. [OpenAI: preços e uso](https://learn.chatgpt.com/docs/pricing).

Aceite: o app informa qual modelo realmente executou o pedido, associa a imagem ao slide correto e reaproveita imagens já geradas após reabertura. Sem credencial configurada, a opção permanece indisponível. A disponibilidade do modelo na conta precisa ser verificada antes do piloto.

### 5. Identidade e preferências por workspace

Salvar fontes, cores, logo, referências, tom de voz, formas de abertura e CTAs aprovados. Usar esse contexto nas produções para reduzir briefings repetidos e manter consistência entre vídeos, capas e carrosséis.

Aceite: uma produção nova recebe as preferências do workspace; uma produção em andamento conserva a identidade da versão utilizada até uma atualização explícita.

## Primeiro pacote recomendado

Começar por **carrossel no Paper com identidade salva**, usando as imagens já disponíveis. Em seguida, implementar **reaproveitamento de gravações** e **fila de gravação**. Adicionar seleção explícita de GPT Image 2.5 como opção depois de definir o uso da API.

Medir antes e depois: minutos de preparação por conteúdo, minutos para finalizar um carrossel, quantidade de transferências manuais e entregas aproveitáveis por gravação. Usar um conteúdo piloto representativo antes de estimar economia percentual.

## Validação desta proposta

Leitura do repositório e consulta à documentação oficial. Sem mudança no comportamento do app e sem execução de testes de produto, porque esta entrega é uma proposta. A árvore de trabalho já continha alterações; a única adição desta rodada é este documento.
