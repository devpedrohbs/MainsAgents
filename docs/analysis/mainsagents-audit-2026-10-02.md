# MainsAgents — auditoria de produto, usabilidade e automação

Data: 02/10/2026. Código analisado: versão 0.3.30, incluindo as alterações presentes na árvore de trabalho. Este documento é um diagnóstico e uma proposta; as melhorias descritas não foram implementadas nesta auditoria.

## Conclusão

O MainsAgents já possui uma base útil para operar agentes e organizar contexto. A próxima evolução deve transformar as conversas em uma produção editorial que possa ser acompanhada e retomada: cada conteúdo precisa ter identidade, versões, arquivos, aprovações, responsáveis e comprovantes das ações externas.

Para sua rotina, o maior ganho vem de reduzir os intervalos manuais entre pesquisar, escolher uma pauta, aprovar o roteiro, gravar, editar e agendar. Trocar o visual novamente ou aumentar a quantidade de agentes teria menos impacto neste momento.

Minha recomendação é preservar a identidade aprovada, manter Editor de Conteúdo, Editor de Vídeo e Linkedin Agent como especialistas e construir um fluxo persistente ao redor deles. O app controla as etapas; os agentes realizam o trabalho que exige interpretação e criação.

## Escopo e limites da análise

- Inspeção de componentes, modelos de dados, persistência, bridges Node/Electron, integração CLI, comunicação entre agentes, backups e documentação.
- Pesquisa em fontes oficiais de Orca, Maestri, Flowith, Relevance AI, n8n e Buffer. Os recursos dos concorrentes abaixo são documentados por seus fornecedores; não fiz testes de uso nesses produtos.
- Verificação do repositório: `npm test`, 76 testes aprovados; `npm run typecheck`, aprovado.
- Esses testes não comprovam uma publicação real, edição real de vídeo ou execução completa da sua produção editorial.
- Não medi contraste, tamanho de alvos ou comportamento visual em diferentes escalas do Windows nesta auditoria. As recomendações de navegação são julgamentos de produto fundamentados na estrutura atual.
- Os riscos de persistência editorial identificados por código não são uma reprodução de nova perda dos seus agentes. A persistência principal já recebeu correções específicas e tem testes.

## 1. O que existe e deve ser preservado

| Área | Situação observada | Evolução recomendada |
| --- | --- | --- |
| Desktop | Electron, React, TypeScript e serviços Node locais; distribuição Windows com instalador NSIS | Evoluir a base atual, com testes de migração e atualização |
| Agentes | Configuração, instruções, ferramentas, skills locais/instaladas e associação por agente | Mostrar capacidades reais e resultado esperado de cada especialista |
| Chats | Sessões independentes, streaming, seleção de modelo/esforço, contexto e imagens | Transformar entregas em artefatos com ações claras |
| Provedores | Adaptadores CLI de Codex e Claude separados da UI | Diagnóstico e permissões por capacidade; não presumir igualdade entre provedores |
| Comunicação | Handoff entre agentes, contexto, sessões relacionadas e limites de delegação | Registrar o trabalho delegado em uma execução durável |
| Canvas | Objetos, ligações, chats, notas, navegador e terminal | Separar ligação de contexto de ligação que executa uma etapa |
| Fluxograma | Visualização das relações do Canvas | Ainda não é um executor automático de workflows |
| Content Studio | Pesquisa, pauta, geração de roteiro, artefatos versionados e aprovações | Completar gravação, edição, revisão e publicação |
| Persistência | SQLite principal em diretório permanente; editorial em banco separado; IndexedDB na versão web | Incluir todos os módulos no mesmo compromisso de salvamento e recuperação |
| Notion | Instruções e skill para o Editor de Conteúdo usar o MCP após aprovação | Adicionar evento nativo, vínculo estável e confirmação visível |
| Uso do plano | Indicador de limites do Codex quando fornecidos pelo runtime | Acrescentar duração, tentativas e orçamento de execução sem inventar custo por tarefa |
| Organização | Home, Board, Canvas, agentes, sessões, busca e workspaces | Projetar diferentes views do mesmo conteúdo, evitando registros desconectados |

Não proponho reimplementar o chat completo, a busca global ou a persistência dos agentes do zero. Essas bases já existem.

## 2. Achados que merecem prioridade

### A. O fluxo editorial ainda termina no roteiro

O modelo nativo define etapas de workflow `research` e `script`. O conteúdo termina em `script-approved`; ainda não representa gravação, edição, revisão de vídeo, entrega final, agendamento confirmado e publicação. LinkedIn também não aparece na enumeração de plataformas do modelo editorial atual, embora você tenha um especialista para ele.

Isso explica uma parte da sensação de ter muitas funcionalidades, mas ainda precisar conduzir o processo pelo chat. As skills descrevem seu fluxo completo, enquanto o aplicativo só conhece parte dele.

Evidência: [modelo editorial](C:/Users/pacas/Documents/ChatGPT/MainsAgents/src/features/content/model.ts:1).

**Proposta:** ampliar o conteúdo para acompanhar a produção inteira, preservando pesquisa, versões e aprovações existentes. Separar três coisas: etapa editorial do conteúdo, estado técnico da execução e estado de publicação por rede.

Exemplo: um vídeo pode estar com roteiro aprovado, ter uma execução de edição aguardando arquivo e possuir uma versão de LinkedIn ainda em revisão. Um único campo `status` não expressa tudo isso.

### B. Aprovar na interface não executa o próximo passo externo

`approveScript` registra o artefato, a aprovação e o novo status. Não há nessa operação um disparo nativo de criação do card no Notion. A skill que configuramos instrui o agente a fazer isso quando recebe a aprovação na conversa, mas esse comportamento não equivale a uma transição garantida pelo botão da interface.

Evidência: [aprovação do roteiro](C:/Users/pacas/Documents/ChatGPT/MainsAgents/src/features/content/ContentWorkflowProvider.tsx:179).

**Proposta:** a aprovação gera um evento persistido. Esse evento cria um trabalho para atualizar o Notion, verifica o resultado e registra o endereço do card. Se ocorrer erro, a tarefa continua visível e pode ser retomada sem criar outro card.

O primeiro fluxo que vale implementar é: **aprovar roteiro → criar/atualizar card no Notion → conferir o card → mostrar “Pronto para gravar” com o link**.

### C. A persistência editorial tem garantias diferentes da principal

O banco principal foi movido para `%USERPROFILE%/.mainsagents/storage`, evitando o redirecionamento de AppData que causou problemas anteriores. Entretanto, `editorial.sqlite` continua em `app.getPath('userData')`.

Além disso, o estado editorial aparece na memória antes de concluir sua fila de gravação HTTP. O fechamento aguarda `window.mainsAgentsSaveNow`, associado à persistência principal; não há nessa interface uma espera explícita pela fila editorial. A exportação consulta o editorial já salvo no servidor. A importação atualiza primeiro o editorial e depois o estado principal, sem uma transação abrangendo as duas operações.

Evidências: [localização editorial](C:/Users/pacas/Documents/ChatGPT/MainsAgents/desktop-main.mjs:308), [fechamento](C:/Users/pacas/Documents/ChatGPT/MainsAgents/desktop-main.mjs:360), [fila editorial](C:/Users/pacas/Documents/ChatGPT/MainsAgents/src/features/content/ContentWorkflowProvider.tsx:65), [backup e restauração](C:/Users/pacas/Documents/ChatGPT/MainsAgents/src/data/backup.ts:39).

**Classificação:** risco por inspeção, ainda sem reprodução. Não concluo que os agentes continuam desaparecendo. Recomendo testar fechamento com gravação editorial atrasada, falha de disco, restauração parcialmente interrompida e abertura pelos diferentes atalhos do Windows.

**Proposta:** migrar o editorial para a localização permanente, registrar todos os módulos no salvamento ao fechar e oferecer backup consistente com recuperação se qualquer parte da importação falhar. Rascunhos do composer também merecem persistência: hoje usam `sessionStorage`, que não garante sobreviver a um novo processo do app.

### D. A execução editorial depende do ciclo de vida da tela

Pesquisa e roteiro são orquestrados pelo provider React. Ao carregar novamente, execuções que ficaram `running` passam para `interrupted`, com orientação para tentar de novo. Isso é uma recuperação honesta, mas ainda não é uma fila que continua trabalhando independentemente da navegação ou do processo de interface.

**Proposta:** um serviço Node local persiste os trabalhos, executa as etapas e publica eventos. React mostra o que está acontecendo. Cada trabalho tem `queued`, `running`, `waiting-user`, `waiting-file`, `succeeded`, `failed` ou `canceled`, com motivo e próxima ação.

Fechar a janela pode futuramente manter o serviço na bandeja, se você ativar essa opção. Encerrar o aplicativo ou desligar o PC interrompe a execução local. Após reiniciar, o serviço precisa reconciliar o resultado externo antes de repetir uma escrita.

### E. Aprovação precisa ser uma regra executável

As skills já dizem para pedir seu consentimento. Para agendar, publicar ou sobrescrever uma entrega, o aplicativo também precisa validar a autorização.

Hoje o Codex recebe sandbox local de leitura e `approvalPolicy: 'never'`. O Claude permite ferramentas como leitura e busca conforme a configuração. Isso limita certas operações locais, mas não demonstra um bloqueio nativo por ação para cada ferramenta externa disponível via MCP. Uma regra no texto da skill não substitui esse controle.

Evidências: [configuração Codex](C:/Users/pacas/Documents/ChatGPT/MainsAgents/codex-bridge.mjs:229) e [capacidades de provedores](C:/Users/pacas/Documents/ChatGPT/MainsAgents/src/features/chat/AiProvider.ts:10).

**Proposta:** ações externas passam por um serviço que apresenta conteúdo, versão, destino e efeito. A autorização vincula-se àquela ação. Mudar vídeo, legenda, conta ou horário invalida a aprovação quando necessário. Publicar exige autorização distinta de aprovar roteiro; ferramentas externas que publicam precisam respeitar o mesmo caminho.

O Editor de Vídeo continua sem controle do computador. Para edição automatizada, oferecer operações específicas de arquivos e FFmpeg, com saída nova e verificação, em vez de acesso amplo à máquina.

## 3. Ideias dos concorrentes que se encaixam no MainsAgents

As sugestões abaixo são minha adaptação ao seu caso, não uma afirmação de que o concorrente resolve seu fluxo editorial completo.

| Referência | Recurso documentado | Aplicação no MainsAgents |
| --- | --- | --- |
| Orca | Ambiente de agentes CLI e sessões; notificações/inbox; automações com horário, fuso, histórico e execução manual | Caixa de entrada de entregas e aprovações; rotinas testáveis; estado claro da CLI |
| Maestri | Canvas com agentes, notas e portais; referências no composer; Partituras reutilizáveis | Modelos de equipe editorial com conexões e contexto; referências a cards/arquivos no chat |
| Flowith | Knowledge Garden com bases de conhecimento associadas aos fluxos | Biblioteca pesquisável de exemplos aprovados, preferências e fontes |
| Relevance AI | Workforces com roteamento por IA ou próximo passo fixo; aprovações e escalonamentos | Separar interpretação do agente de passos obrigatórios, com pausa humana |
| n8n | Gatilhos por agenda e configuração de fuso | Rotinas previsíveis, com política explícita para execuções perdidas |
| Buffer | Rascunhos, calendário e distinção entre data planejada e postagem efetivamente colocada na fila | Calendário editorial que mostre o que está apenas planejado e o que foi confirmado pelo publicador |

**Orca:** seu foco principal é desenvolvimento de software. A parte de worktrees e Git tem pouco valor direto para sua produção de conteúdo. Já sua organização de sessões e de trabalho pendente é bastante aplicável. Fontes: [repositório](https://github.com/stablyai/orca), [notificações e inbox](https://www.onorca.dev/docs/notifications), [automações](https://www.onorca.dev/docs/cli/automations).

**Maestri:** aproveitar a ideia de um ambiente de trabalho montado com especialistas e contexto. As Partituras inspiram um botão “Criar projeto de vídeo” que monta os objetos necessários sem configurar tudo novamente. A proposta para Windows não depende de recursos específicos de macOS. Fonte: [site oficial](https://www.themaestri.app/pt-br).

**Flowith:** conhecimento reutilizável merece uma camada própria. Uma skill orienta comportamento; a memória recupera fatos, exemplos e preferências relevantes; a sessão guarda a conversa daquele trabalho. Começar com busca local e tags, acrescentando embeddings apenas se houver necessidade demonstrada. Fonte: [Knowledge Garden](https://flowith.io/docs/en/knowledge-garden/building/).

**Relevance AI:** a distinção entre conexão por decisão da IA e sequência obrigatória é especialmente útil. “Use esta referência” não deve ter o mesmo efeito de “Após aprovar, encaminhe ao Editor de Vídeo”. Fontes: [Workforces](https://relevanceai.com/docs/get-started/core-concepts/workforces), [aprovações e escalonamentos](https://relevanceai.com/approvals-escalations).

**n8n:** pode ser uma integração futura para automações externas. Para o primeiro fluxo, um executor Node pequeno dentro da arquitetura atual reduz dependências e facilita a instalação. Fonte: [Schedule Trigger](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.scheduletrigger/).

**Buffer:** copiar a clareza do calendário, mantendo Publora como seu publicador. Uma data no card não comprova agendamento. Fonte: [rascunhos e agendamento](https://support.buffer.com/en-us/articles/saving-and-scheduling-draft-posts-CBLXg1yFXp).

## 4. Automação que ajudaria na sua rotina

| Momento | Proposta de automação | Sua decisão |
| --- | --- | --- |
| Começo do dia | Buscar novidades em fontes escolhidas, eliminar duplicatas e preparar uma lista curta com fontes, relevância e ângulo | Escolher pautas |
| Preparação da semana | Agrupar pautas aprovadas por tema/formato e propor uma lista de gravação | Aprovar a seleção e os roteiros |
| Roteiro aprovado | Atualizar o card no Notion com roteiro, materiais e checklist | Aprovação já vinculada à versão |
| Gravação transferida | Detectar arquivo completo na pasta do conteúdo e oferecer encaminhamento ao Editor de Vídeo | Confirmar arquivo e objetivo da edição |
| Edição | Preparar corte, exportação e relatório de mudanças com ferramentas explicitamente disponíveis | Revisar vídeo e pedir ajustes |
| Conteúdo pronto | Propor derivados para LinkedIn, Instagram/TikTok e YouTube conforme pertinência | Aprovar cada entrega |
| Publicação | Enviar versão autorizada ao publicador e registrar confirmação, horário e identificador | Aprovar conta, texto, mídia e horário |
| Revisão semanal | Comparar resultados autorizados e registrar hipóteses para os próximos conteúdos | Escolher mudanças editoriais |

São propostas, não rotinas criadas nesta análise. Frequência e quantidade devem ser configuráveis. Um radar sem novidades relevantes não precisa consumir uma chamada longa de IA nem enviar notificações vazias.

A observação de pastas deve esperar o término da cópia e identificar a qual conteúdo o arquivo pertence. Um vídeo novo não pode disparar automaticamente uma publicação. A coleta de métricas depende de acesso efetivo às ferramentas de cada plataforma.

## 5. Como organizar as telas

Estas são recomendações de fluxo, preservando cores, tipografia e identidade aprovadas.

### Home: o que exige uma decisão hoje

Mostrar entregas aguardando revisão, próximos conteúdos para gravar, trabalhos bloqueados, últimas entregas e publicações confirmadas. Cada item abre a versão correta e oferece uma ação concreta: aprovar, ajustar, fornecer arquivo ou tentar novamente. Evitar gráficos e contagens de “agentes trabalhando” derivadas de status estáticos.

### Conteúdos: um card atravessa a produção

Detalhes do conteúdo reúnem briefing, fontes, roteiro aprovado, arquivos, edição, derivados, sessões e links externos. Board, calendário e Canvas mostram esse registro, sem criar cópias independentes. O Board de tarefas técnicas pode continuar separado do estágio editorial.

### Chat: conversa e entregas reconhecíveis

Resultados estruturados aparecem com ações junto da entrega: “Abrir conteúdo”, “Aprovar esta versão”, “Pedir ajuste”, “Enviar para edição”. Um relatório de execução mostra o que foi produzido e quais ações foram realmente confirmadas. Preservar o composer fixo e o histórico existente.

### Canvas: contexto e caminho de trabalho

Agrupar objetos por conteúdo/projeto. Dar significado às conexões: contexto, próximo passo ou dependência. Mostrar essa distinção no menu da ligação e na execução. Adicionar modelos de projeto e foco no conteúdo atual antes de expandir a quantidade de objetos.

### Agentes: responsabilidade e capacidade

Mostrar especialidade, trabalhos atuais, conexões e ferramentas disponíveis. Uma skill instalada não prova que sua dependência externa está autenticada. Permitir testar uma conexão de leitura e informar a ausência de ferramenta de edição ou publicação no próprio agente.

### Configurações: conexão com diagnóstico

Uma área de conexões reúne CLI, modelo disponível, MCP, autenticação, capacidades e ação para corrigir falhas. O indicador da navegação deve acompanhar o provedor efetivamente utilizado. Informar separadamente falha de login, quota, ferramenta, rede ou execução.

Para reduzir sobreposição entre Sidebar e Topbar, a Sidebar pode escolher a área e a Topbar escolher a view do projeto. Isso requer validação com tarefas reais; não proponho remover atalhos úteis indiscriminadamente.

### Base da revisão de UX

A skill `apple-design` foi usada como referência de princípios gerais aplicáveis ao desktop Windows. A recomendação de feedback junto ao trabalho vem de [Feedback — Best practices](C:/Users/pacas/Documents/ChatGPT/MainsAgents/.agents/skills/apple-design/references/hig/feedback.md). Ações de refinamento junto ao resultado e explicação do que a IA está fazendo vêm de [Generative AI — Best practices](C:/Users/pacas/Documents/ChatGPT/MainsAgents/.agents/skills/apple-design/references/hig/generative-ai.md). Também foram consultadas referências de acessibilidade, layout, tipografia, cor, desktop e sidebars. Não há nesta análise uma reprovação visual medida da interface atual.

## 6. Notion, MainsAgents e publicador

Manter o Notion como sua base editorial existente é a opção de menor atrito agora. O MainsAgents deve assumir execução, contexto, arquivos e aprovações, mantendo um vínculo com o card externo. Essa divisão pode evoluir depois, sem exigir uma migração de todo seu histórico imediatamente.

Cada conteúdo precisa guardar `notionPageId` e última sincronização. Definir responsabilidade por campo: por exemplo, o app envia a versão aprovada do roteiro e preserva notas que você editou manualmente no Notion. Conflitos precisam aparecer antes de sobrescrever dados.

No seu Notion, um roteiro aprovado de vídeo pode seguir para `Gravando`; isso não significa que o vídeo está `Pronto`. `Published` exige comprovação de publicação. O app deve acompanhar esses significados ao mapear seus estados.

Para Publora, MCP pode continuar útil nas interações do agente. O calendário nativo precisa de um adaptador que devolva resultados estruturados e identificadores persistidos. Esse adaptador pode usar MCP ou API conforme as operações e autenticação realmente disponíveis. A qualidade da integração depende de confirmar e reconciliar as ações, não apenas da escolha do protocolo.

## 7. Arquitetura proposta e consumo

Conservar React/Electron/Node/SQLite. Acrescentar um serviço de execução local independente dos providers React, um registro de eventos e uma fila persistente. A primeira implementação pode continuar em um único processo Node, sem Redis, Docker ou um motor genérico de workflows.

Modelo sugerido: `Content`, `ArtifactVersion`, `Asset`, `Approval`, `Job`, `JobEvent`, `ExternalBinding` e `Publication`. Cada trabalho associa conteúdo, agente, sessão, versão da entrada e resultado. Uma chave estável evita repetir a mesma ação quando ela é retomada; em timeout externo, consultar o destino antes de repetir.

Para consumo, começar com poucos trabalhos simultâneos e limites de tentativas. Usar código para deduplicação, validação e movimentação de estados. Reservar IA para pesquisa interpretada, roteiro, revisão e adaptação. Recuperar apenas o contexto relevante e evitar enviar todos os históricos e arquivos em cada etapa.

O painel de 5 horas/semana continua útil. Não atribuir um valor monetário exato a cada tarefa de assinatura se o provedor não fornece essa informação. Registrar duração, tentativas, modelo, ferramentas e tokens apenas quando esses dados estiverem disponíveis.

O Canvas grava estruturas amplas e o streaming altera históricos frequentemente. Isso merece benchmark com conjuntos grandes antes de normalizar o armazenamento ou trocar tecnologias. Não foi demonstrada lentidão por medição nesta análise.

## 8. Preparação para outras pessoas

O produto já tem uso local sem conta obrigatória MainsAgents. Manter essa primeira experiência simples, com login separado da CLI escolhida. Não há necessidade de unir computadores para o app cumprir sua proposta.

Não encontrei licença, guia de contribuição, política de segurança ou configuração `.github` de CI no escopo consultado. Preparar esses itens, exemplos sem dados pessoais, templates com caminhos portáveis e uma instalação testada em perfil Windows limpo antes de divulgação ampla.

Há documentação antiga que contradiz o produto atual: `ARCHITECTURE.md` descreve a integração real como futura e o backlog de 22/09 ainda exige conta obrigatória. Atualizar essas decisões evita que uma tarefa futura reintroduza comportamentos já descartados. As orientações antigas de provedores também precisam ser revistas com a documentação oficial quando essa área for alterada, sem tratá-las como verdade atual.

## 9. Sequência recomendada

1. Uniformizar salvamento editorial, fechamento e restauração; preservar rascunhos.
2. Criar conteúdo unificado, eventos de aprovação e execução persistente mínima.
3. Entregar o fluxo aprovado → Notion → confirmação, com teste de interrupção e duplicação.
4. Criar caixa de entrada e ações de revisão associadas às versões.
5. Acrescentar arquivos, handoff durável e edição limitada a ferramentas verificadas.
6. Integrar calendário/publicador, com autorização e confirmação por rede.
7. Adicionar rotinas, memória editorial e modelos reutilizáveis sobre essa base.

O [backlog executável](C:/Users/pacas/Documents/ChatGPT/MainsAgents/docs/analysis/mainsagents-automation-backlog-2026-10-02.md) detalha dependências e critérios de aceite. A próxima implementação mais útil é o primeiro fluxo completo com Notion, acompanhado das correções de persistência necessárias para confiar nele.
