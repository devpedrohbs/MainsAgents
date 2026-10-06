# Gravações em fluxos sem conteúdo selecionado — 0.3.48

O erro examinado não era ausência do aplicativo desktop: o perfil tinha um fluxo sem `contentId` e nenhum conteúdo local. O código usava a mesma mensagem para falta de arquivos nativos e falta de conteúdo, dificultando identificar a causa. Cards criados pela conversa no Notion não são importados automaticamente para o Estúdio.

Ao clicar em Adicionar vídeo ou soltar arquivos na caixa Vídeos da gravação, um fluxo sem conteúdo agora permite escolher um cadastro existente ou criar um conteúdo local com título. Depois de salvar esse vínculo, o seletor de arquivos é aberto ou os arquivos soltos são inspecionados e associados ao mesmo conteúdo. O limite de 20 arquivos e as verificações de caminho, tipo e bytes são mantidos.

O cadastro criado é um rascunho em etapa de gravação. Não gera aprovação de pesquisa/roteiro, não escolhe redes, não cria card Notion, não inicia agente nem envia vídeos para serviços externos. Os arquivos permanecem no local original. Para executar a edição, ainda é necessário configurar/revisar o contexto e autorizar a etapa correspondente do fluxo; o anexo não concede essa autorização.

Trocar de fluxo/workspace ou cancelar a escolha impede usar o pedido pendente em outro destino. Falta de suporte a arquivos locais recebe uma mensagem própria. Os vínculos e o cadastro usam a persistência existente e sobrevivem à reabertura.

Validação: teste unitário do cadastro sem aprovações fabricadas; teste Electron com SQLite e arquivo local real, criação direta em fluxo sem vínculo, arrastar/soltar e associação a conteúdo existente, fluxo manual anterior, envio ao especialista sem repetição, reabertura e layout compacto. O arquivo sintético desse teste verifica associação, não validade de codec nem edição de vídeo.

## Atualização desktop

O teste de produção semiautomática compartilhada e a persistência nativa do pacote também passaram. A versão 0.3.48 foi instalada no diretório canônico com os atalhos conferidos. Backup anterior: `C:\Users\pacas\Documents\MainsAgentsBackups\before-update-0.3.48-1791289510647`. Os hashes dos dados principais e editoriais permaneceram idênticos após instalar: três agentes, suas skills e nove sessões preservados, incluindo a preferência Notion configurada na 0.3.47.

SHA256 do instalador: `6bf1689ebb232209e98572a1c4fc612e5ac9774e3f9321426e826cee044ed893`. SHA256 do `app.asar` instalado: `84fab18abeed04eaca2667c9013b847cd1665b59a18eda118e6d4f93a3eac82a`. O pacote verifica 54 módulos nativos. A instalação não criou conteúdo, não anexou arquivos pessoais nem iniciou trabalhos nas contas do usuário.
