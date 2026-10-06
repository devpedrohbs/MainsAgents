# Aprovações e tempo de resposta — 0.3.46

O chat mostra o tempo total desde o envio da mensagem até concluir, falhar ou interromper a resposta. O tempo inclui conexão, ferramentas, trabalho delegado e espera pela decisão do usuário. O contador não mede tokens nem somente processamento do modelo. A última duração fica salva na sessão; a duração de cada resposta concluída também fica registrada na mensagem. Ao reabrir uma execução interrompida, o contador para no último estado salvo, sem contar o período com o aplicativo fechado.

As aprovações de ferramentas agora aparecem numa área própria abaixo do cabeçalho, fora da rolagem das mensagens. A área possui sua própria rolagem em telas menores e informa que a IA está aguardando uma decisão. Consultas Notion conhecidas são classificadas como leitura; criação e atualização de páginas são classificadas como escrita. Nenhuma classificação aprova automaticamente uma chamada.

## Diagnóstico da tentativa Notion

A tentativa examinada era uma conversa comum, sem produção automática registrada. As chamadas `notion-get-tool-access` e duas `notion-fetch` ficaram pendentes de confirmação por aproximadamente quatro minutos, até o turno ser interrompido. Os resultados registrados foram `user cancelled MCP tool call`; não houve chamada `notion-create-pages`. Isso confirma a espera por aprovação, mas não confirma autenticação nem acesso à coleção, pois as consultas não executaram.

Para testar na conta: pedir novamente a consulta/criação e aprovar as chamadas exatas exibidas. Depois da consulta, o agente deve preparar a criação e aguardar a aprovação correspondente. A existência do servidor ou do catálogo não prova leitura bem-sucedida da base. Nenhuma consulta ou escrita pessoal foi executada durante o diagnóstico.

## Validação

- Testes de duração: tempo decorrido, término, horas, cancelamento, retomada após fechamento e isolamento entre respostas.
- Testes de permissões: leituras Notion continuam pendentes até aprovação; comandos desconhecidos não recebem permissão de leitura.
- Electron isolado: resposta streaming aguardando aprovação, controles acessíveis a 880px, contador congelado ao concluir e duração preservada após reabrir. CLI/provedores simulados; sem tokens pessoais.
- Os 13 testes focados passaram, assim como o teste Electron de conclusão de tarefas e o teste de persistência nativa do pacote final.

## Atualização desktop

A versão 0.3.46 foi instalada no diretório canônico, com atalhos do desktop e menu Windows verificados. Backup prévio: `C:\Users\pacas\Documents\MainsAgentsBackups\before-update-0.3.46-1791254814093`. Os hashes do estado principal e editorial permaneceram idênticos após instalar: três agentes, suas 16/3/12 skills e nove sessões preservados.

SHA256 do instalador: `39db7594761b7854cefe2c6c470507a064ac9a890938b7f3c4bba9e04ab16357`. SHA256 do `app.asar` instalado: `b52b240e8024bbcf3cb846599ba1aec78481234798fb4e86d7ecae013f8b7098`. O pacote verifica 53 módulos nativos; ainda sem assinatura Authenticode. Esta instalação não representa push ou publicação de release no GitHub.
