# Notion: consultas e cards Idea sem confirmações repetidas — 0.3.47

O Editor de Conteúdo pode consultar Notion e criar ideias diretamente na coleção escolhida, para o criador revisar no próprio Notion. A autorização é uma preferência explícita por agente, desativada por padrão, persistida com a configuração local. Pode ser desligada em Configurar agente → Notion sem confirmações repetidas.

O backend mantém as confirmações do CLI e aceita automaticamente somente chamadas conhecidas de leitura ao servidor `notion` e `notion-create-pages` com parent `data_source_id` igual à coleção configurada, título e `Status = Idea` explícitos em todos os cards. A criação automática não permite templates não verificados nem execução assíncrona com resultado incerto. Outras ações continuam no controle de aprovações. As permissões MCP restritivas do agente continuam valendo. Não altera permissões globais do Codex nem libera outros provedores.

Cada chamada autorizada tem seus argumentos, origem da autorização e resultado registrados no audit local. Uma autorização registrada não é prova de criação: o resultado MCP precisa confirmar a execução, e o agente verifica o card. Busca de duplicatas indisponível ou criação com resultado incerto não autorizam criar outra cópia.

As instruções atuais são enviadas também às conversas existentes, para superar a preferência antiga de criar como Gravando. Novas produções que usam esse agente e a mesma coleção também geram seus cards com status Idea; o fluxo continua aguardando aprovações de vídeo, pacote e agendamento. Produções iniciadas com uma configuração anterior não são alteradas silenciosamente.

## Destino conferido

O [Content Pipeline](https://app.notion.com/p/3022bce283d7818db73dff84b0738cce?v=3022bce283d781b9b287000c58f6b4d9) pertence à coleção `3022bce2-83d7-81ad-b3e0-000b6d058613`, Social Media Content Tracker. A leitura confirmou o schema e `Status = Idea`.

Essa view tem filtro relativo sobre Publish Date. Um card sem data pode ficar oculto no quadro; ainda pertence à mesma coleção e tem uma URL própria. O app não inventa data de publicação e não modifica o filtro sem pedido. Consulte All Content ou remova/adapte o filtro no Notion para mostrar ideias sem data.

## Verificação

- Testes de escopo: base incorreta, status diferente, agente sem autorização, revogação, perfil alterado, ferramentas desconhecidas e outras escritas não recebem aprovação automática.
- Electron com SQLite isolado: ativar/salvar a preferência, criar uma ideia simulada com autorização automática auditada, reabrir mantendo a configuração e desligar restaurando confirmação por chamada.
- CLI real com modelo/MCP locais simulados: outros comandos continuam com zero efeitos antes da aprovação, após recusa e com decisão inválida.
- Conector cria Idea sem data de publicação inventada; testes de recuperação e duplicatas anteriores preservados.

Não foram criados cards de teste na base pessoal nem consumidos tokens de IA pessoal. A leitura real da base foi feita pelo conector deste Codex; as leituras já concluídas no MainsAgents também constam no diagnóstico anterior.

## Desktop atualizado e configurado

A versão 0.3.47 foi instalada no diretório canônico e os atalhos conferidos. O modo está ativado somente no Editor de Conteúdo para a coleção indicada. Suas duas skills existentes (`mainsagent-notion` e `mainsagent-editor-fluxo`) foram ajustadas no mesmo local, sem criar pastas extras na pasta de skills.

Backup anterior: `C:\Users\pacas\Documents\MainsAgentsBackups\before-update-0.3.47-1791287984708`. A instalação preservou os hashes do estado principal e editorial. A aplicação da preferência alterou apenas `notionAutomation` e o horário de atualização do Editor de Conteúdo; outras propriedades dos agentes e todas as demais chaves foram verificadas como idênticas. Três agentes, suas 16/3/12 skills e nove sessões foram preservados.

Os 231 testes unitários passaram. A interface de configuração e a persistência nativa do pacote final passaram nos testes Electron. SHA256 do instalador: `b9a9e3bc596d62fd88c249388299dd1a69545b91418471e8a893c0428735d6bc`. SHA256 do `app.asar` instalado: `61388b5dd6913c56aec13a76e345702eef8635f151909bcb40df641454fd2175`. O pacote verifica 54 módulos nativos; segue sem assinatura Authenticode. Não houve push/release público nesta tarefa.
