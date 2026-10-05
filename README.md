# MainsAgents

[Baixar a prévia desktop Windows 0.3.42](https://github.com/devpedrohbs/MainsAgents/releases/tag/v0.3.42) — instalador, SHA-256 e manifesto.

O Calendário de entregas também pode consultar posts existentes no Publora e Zernio pelos MCPs do Codex CLI, com contas escolhidas por workspace e cache local. [Configuração e limites do calendário](docs/provider-calendar-increment.md). A versão 0.3.42 amplia a publicação nativa para mídia e Zernio, conforme os limites descritos abaixo.

MainsAgents é um workspace desktop para criar e operar agentes de IA especializados. Ele reúne agentes, sessões, tarefas, Canvas e contexto em uma interface única, com integração local às CLIs do Codex e Claude Code e histórico persistente.

O projeto foi pensado para pesquisa, notícias, criação de conteúdo, tendências, roteiros, hooks e organização de ideias. Cada agente pode ter instruções e ferramentas próprias, enquanto suas conversas permanecem separadas em sessões.

## Recursos

- Workspaces independentes com agentes, tarefas, sessões e Canvas próprios.
- Criação, edição e exclusão de agentes.
- Chat com streaming pelo Codex App Server e Claude Code CLI.
- Imagens geradas pelo Codex aparecem como anexos no chat, com ampliação, download e envio ao Canvas. O app recupera imagens de conversas anteriores pelo histórico do CLI.
- Continuação de threads e sessões anteriores.
- Board com tarefas movidas por drag and drop.
- Canvas visual com pan, zoom, conexões e nove tipos de node. Notas editáveis têm formato de post-it; o Browser abre uma prévia de site quando a página permite incorporação.
- Contexto bidirecional entre Chat e Canvas.
- Command Palette com `Ctrl + K`.
- Persistência local de todo o histórico.
- Interface alternável entre Português (Brasil) e English (US).
- Skills por agente, com instalação pelo comando `npx skills add`, seleção de pasta local, remoção de vínculos e comandos `/` no chat.
- Aplicativo desktop para Windows com instalador NSIS.
- Guia inicial opcional com modelos editáveis de agentes.
- Escala de interface de 100% a 200%, larguras ajustáveis e movimento reduzido.
- Backup local completo com prévia e importação por mesclagem ou substituição.
- Busca em agentes, tarefas, sessões, mensagens e Canvas de todos os workspaces.
- Estúdio de conteúdo: entrada de pautas, pesquisa com fontes, revisão humana e versões aprovadas de roteiro.

## Fluxo de uso

1. Use **Criar**, disponível em qualquer tela, para começar uma conversa, tarefa, agente, nota ou pauta.
2. Defina nome, função, instruções e provedor do agente. Ao salvar, você pode conversar com ele. Se estava criando uma sessão ou tarefa, esse fluxo continua.
3. Em **Sessões**, escolha o agente antes de abrir uma conversa nova. Busque, filtre, retome ou renomeie as conversas. A exclusão exige confirmação; sessões em execução ficam protegidas nessa lista.
4. No **Quadro**, salvar uma tarefa apenas organiza o trabalho. Abra seu card e use **Abrir chat do agente**: uma sessão fica ligada à tarefa e o título/descrição entram como rascunho. Revise o texto e envie para iniciar o trabalho.
5. No **Canvas**, busque objetos pelo botão **Objetos**. Selecione um ou mais blocos e escolha o agente que receberá o contexto. Nada é enviado à IA até você enviar uma mensagem.
6. No **Estúdio de conteúdo**, acompanhe pesquisa, decisão da pauta, revisão de roteiro e versão aprovada.
7. Em **Configurações**, use as seções Interface, Conexões de IA, Dados e backup, Conta local e Ajuda.

Em **Agentes**, use **Conversar** no card para abrir o chat diretamente. O botão **Conversar com agente** nos detalhes também abre a conversa e fecha os detalhes.

O campo de chat fica fixo; somente o histórico rola. Você pode preparar a próxima mensagem enquanto o agente responde; o botão de interromper permanece disponível e o envio aguarda a resposta atual. Rascunhos ficam salvos por perfil, agente e sessão, inclusive após fechar e reabrir o aplicativo. **Enter** envia, **Shift + Enter** cria uma linha e **/** seleciona uma skill associada. Se a IA estiver desconectada, o chat oferece acesso direto às configurações.

No cabeçalho do chat, ligue **Conectar agente** e escolha outro agente do mesmo workspace. O agente de origem precisa usar Codex; o destino usa seu próprio provedor, função, instruções e skills. O Codex recebe o agente escolhido como destino para pedidos relevantes, e o app abre os dois chats quando ele é chamado. A conexão é salva por sessão, inclusive após reiniciar o aplicativo.

As próximas chamadas continuam na mesma sessão do agente conectado. Use **Nova sessão** na área da conexão, ou peça explicitamente “abra outra sessão no agente conectado”, para começar outro histórico mantendo sua configuração. Desligar a conexão interrompe as chamadas automáticas dessa conversa; religar com o mesmo destino preserva a sessão anterior. Trocar o destino inicia uma conexão separada, sem apagar conversas. Os briefings recebidos aparecem recolhidos como **Tarefa recebida de…**, separados das respostas da IA.

O botão **Uso** no topo mostra o consumo real do Codex nas janelas de **5 horas** e **semana**, com horário de renovação. Os dados vêm da conta autenticada pelo Codex CLI, são atualizados ao abrir o painel e a cada minuto enquanto ele estiver aberto. Também é possível atualizar manualmente. Quando o CLI não fornece um limite, o painel informa que ele está indisponível; contas por chave de API podem não expor os limites do plano ChatGPT.

O **Navegador do Canvas** no desktop abre o Google automaticamente ao criar um bloco. A barra aceita endereços ou pesquisas no Google; há controles de voltar, avançar, recarregar e início. Links que solicitam outra aba permanecem no mesmo bloco. A última página fica salva no Canvas e os cookies ficam separados do aplicativo. Na versão web, sites que recusam iframes ainda precisam ser abertos externamente.

O **Terminal do Canvas** tem uma janela escura independente do tema, fonte monoespaçada, prompt com a pasta do workspace e saída com rolamento próprio. **Enter** executa, **Shift + Enter** permite comandos com várias linhas e **↑ / ↓** recuperam comandos anteriores. Há controles para copiar, limpar e interromper a execução; os cantos da janela selecionada permitem redimensioná-la. A saída anterior permanece entre comandos e é salva com o Canvas.

A execução atual usa um novo processo de shell para cada comando, na pasta do workspace. Mudanças de diretório ou variáveis não passam automaticamente ao comando seguinte, e programas que exigem entrada interativa contínua ainda precisam de um terminal externo.

### Skill de design do projeto

A skill oficial da Anthropic foi adicionada em `.agents/skills/frontend-design`, com sua licença. Para reinstalá-la:

```bash
npx skills add https://github.com/anthropics/skills --skill frontend-design --agent codex --yes
```

A direção e os critérios desta revisão estão em [docs/usability-refinement.md](docs/usability-refinement.md).

### Arquivos por conteúdo

No **Estúdio de conteúdo**, uma pauta aprovada tem a seção **Arquivos do conteúdo**. Adicione ou arraste vídeos, imagens, áudios e documentos do PC; classifique como Original, Referência ou Resultado e associe resultados à sua origem. Use **Nova versão**, **Verificar arquivos** e **Localizar** para manter identidade e histórico. **Desassociar** remove somente o vínculo.

A biblioteca usa a persistência editorial e aparece nos backups. O JSON contém caminhos e metadados, sem copiar arquivos externos; guarde seus vídeos e documentos separadamente. Operações com arquivos locais exigem o desktop. Veja [instruções e limites](docs/content-files-increment.md).

### Fechamento dos fluxos locais — 0.3.38

A Home também reúne respostas não vistas e bloqueios de chats. Avisos podem ser ativados ou silenciados. Entregas de arquivos têm conferência do arquivo real e revisão por versão; modificar o arquivo invalida o estado pronto. O envio manual entre agentes usa uma fila nativa e pode continuar a sessão do especialista Codex/Claude.

Em **Configurações → Conexões de IA**, o diagnóstico distingue catálogo MCP de leitura efetivamente autorizada; os testes específicos de Zernio/Publora pedem aprovação antes de consultar contas e exigem dados verificáveis. Nas configurações do agente Codex, permissões por categoria complementam a aprovação de cada chamada. Claude permanece sem MCP/escrita/controle do computador e usa seu login normal da CLI. Veja [fluxos, comandos, requisitos de skills e limites](docs/completion-increment.md).

## Stack

- React 19
- TypeScript
- Vite
- Electron
- React Flow
- IndexedDB
- Codex App Server
- Claude Code CLI

## Pré-requisitos

Para desenvolvimento com os provedores locais:

- Windows 10 ou 11 x64.
- Node.js e npm instalados.
- Codex CLI instalado. O login pode ser feito pela área **Configurações → Conexões de IA → Codex**.
- Claude Code CLI instalado e autenticado com `claude auth login`. **Configurações → Conexões de IA → Claude Code** mostra o comando oficial de instalação e o de login.

Instale o Codex CLI caso ainda não esteja disponível:

```bash
npm install -g @openai/codex
codex login
```

O MainsAgents inicia o `codex app-server` localmente. Nenhuma chave de API é armazenada no frontend.

Pedidos de imagem usam o gerador nativo do Codex. O modelo de texto selecionado no chat não seleciona o modelo de imagem. No Codex CLI 0.159.2, o gerador usa GPT Image 2 e não expõe uma opção para trocar por GPT Image 2.5; o MainsAgents não promete uma versão que o CLI não permite configurar, nem utiliza uma API cobrada separadamente como alternativa automática. Referências: [implementação oficial do CLI](https://github.com/openai/codex/blob/rust-v0.159.2/codex-rs/ext/image-generation/src/tool.rs) e [modelos de imagem da API](https://developers.openai.com/api/docs/guides/image-generation).

As imagens são gravadas de forma atômica em `%USERPROFILE%\.mainsagents\storage\images`, fora da instalação. Elas continuam disponíveis após fechar, atualizar ou desconectar o CLI. O backup exportado pelo app inclui os arquivos de imagem das conversas e do Canvas para permitir a restauração em outra instalação.

O MainsAgents executa o binário oficial e não modificado do Claude Code CLI para responder às sessões. O login permanece dentro do CLI; o MainsAgents não coleta nem lê tokens de Claude. Prompts e contexto enviados pelo chat seguem para o provedor configurado no Claude Code e são cobrados diretamente na conta dessa pessoa.

## Instalação para usuário

Baixe ou gere o instalador `MainsAgents-Setup-<versão>.exe`, execute-o e escolha o diretório de instalação. O instalador cria atalhos na área de trabalho e no menu Iniciar. O aplicativo abre mesmo sem a CLI do Codex; Board, Canvas e os dados locais continuam disponíveis.

Na primeira abertura, o aplicativo já entra no workspace local: não exige conta MainsAgents, cadastro, servidor hospedado ou sincronização. O login do Codex é independente e usa a CLI instalada e autenticada pela própria pessoa.

Se quiser separar perfis locais no mesmo perfil do Windows, **Settings → MainsAgents account** permite criar uma conta local opcional. Ela não é uma conta hospedada e não sincroniza dados entre computadores.

O fluxo inicial é:

1. Na Home, escolha o idioma e um modelo opcional de agente. Você pode dispensar e reabrir o guia em **Settings**.
2. Defina nome, função, instruções e ferramentas do agente.
3. Abra uma nova sessão pelo painel lateral ou com `Ctrl + K`.
4. Envie uma mensagem; a resposta será transmitida pelo CLI escolhido em tempo real.
5. Envie respostas para o Canvas ou use nodes do Canvas como contexto. Na barra de ferramentas do Canvas, clique em **Nota**, **Navegador**, **Chat** ou **Terminal** para criar um objeto, ou arraste-o para o local desejado. **Mais** reúne os demais tipos. Se um site bloquear a prévia no Browser, use **Abrir site em outra janela**.
6. Organize o trabalho no Board.

### Fluxo editorial e card no Notion

1. Crie no workspace um agente Codex de pesquisa com **Web Search** e conecte a CLI Codex em **Settings**. Um segundo agente pode ser usado para roteiros. Os chats Claude/Gemini continuam disponíveis; este fluxo editorial persistente inicialmente usa Codex.
2. Abra **Conteúdo** na barra lateral. Envie uma ideia, uma URL ou peça sugestões de pautas. A pesquisa abre uma sessão do agente e apresenta fontes e possíveis ângulos. Confira as fontes antes de decidir.
3. Edite a pauta se necessário e aprove ou descarte. A aprovação cria um card vinculado no **Board**; o estado desse card acompanha o fluxo editorial.
4. Gere opções de roteiro. Escolha entre hooks, caminhos de condução e CTAs, edite o texto, os tópicos para improviso e a direção de capa, e aprove a versão final. Versões, decisões, sessões e erros ficam acessíveis no card.
5. Para enviar esta versão ao Notion, confira o **ID da base (data source)** e marque **Ao aprovar, criar/atualizar o card desta versão**. O botão **Aprovar roteiro e enviar ao Notion** guarda a autorização e o trabalho em uma transação local. O app usa diretamente o MCP Notion configurado no Codex CLI; não precisa de uma chave de API adicional. A base deve ter título, `Status` com `Idea`/`Gravando` e `Channel` com as plataformas escolhidas. Uma skill associada que informe `collection://…` pode sugerir o destino; a opção começa desligada.
6. Acompanhe a confirmação com link, versão e horário. Em caso de falha, confira o destino e use **Verificar e tentar novamente**. Uma resposta perdida não provoca outra criação às cegas: o app procura o card já criado e verifica seus identificadores. Versões posteriores são acrescentadas ao mesmo card, preservando notas manuais e o estágio existente.
7. Use **Etapa de produção** para acompanhar gravação, edição e revisão. **Abrir roteiro no Canvas** cria um objeto ligado à versão aprovada; **Abrir conteúdo** retorna ao card. Sessões novas de pesquisa/roteiro também guardam o vínculo editorial.

Pesquisa, roteiro e envio ao Notion usam filas Node/SQLite. Você pode navegar sem interromper o trabalho; o app precisa continuar aberto para executá-lo. Fechar guarda a interrupção. **Trabalhos e especialistas → Acompanhar** mostra instrução, streaming, atividades e histórico. **Verificar e retomar** consulta a thread e recupera uma resposta concluída sem reenviar; quando houver necessidade de uma nova tentativa, **Reenviar instrução** exige confirmação e pode consumir seu plano.

Depois de aprovar o roteiro, use **Enviar ao especialista** para transferir briefing, versão aprovada e até 20 arquivos associados. A origem precisa de Subagents, e o destinatário precisa de Files para referências locais. A sessão do mesmo conteúdo/especialista continua por padrão; há opção de abrir outra. O painel de acompanhamento mostra os dois lados. Este caminho é de análise/pesquisa: o Editor de Vídeo relata ferramentas ausentes e não ganha controle do computador. Publicação, edição automática e integração da delegação dos chats/Canvas com a fila ainda pertencem ao backlog. Veja [o escopo e a recuperação deste incremento](docs/persistent-editorial-work-increment.md).

Os dados de conta local usam SQLite em `%APPDATA%\mains-agents\accounts.sqlite`. A partir de 0.3.31, agentes, workspaces, sessões, mensagens, tarefas, Canvas e dados editoriais compartilham `%USERPROFILE%\.mainsagents\storage\workspace-state.sqlite`. O antigo `editorial.sqlite` é migrado uma vez, com cópia de recuperação e preservação do original. No navegador, o estado principal usa IndexedDB e o editorial depende do serviço Node local. Cada usuário do PC mantém seus próprios dados.

O idioma pode ser alterado em **Settings → Interface language**. A escolha é salva localmente.
Em **Settings**, você também pode aumentar a interface, reduzir animações, exportar um backup ou importar um arquivo após conferir a prévia. O backup desktop inclui pautas, artefatos, decisões, imagens do chat, recibos de execução e destinos do Notion. O manifesto de skills contém referências aos caminhos; ele não copia arquivos externos ou vídeos, nem credenciais. Ao restaurar, tarefas pendentes importadas exigem revisão e tentativa explícita, e os destinos importados começam desligados. A restauração desktop é uma única transação; a versão web registra um diário de recuperação entre IndexedDB e o serviço editorial. Exportações de recuperação indicam alterações ainda não confirmadas em disco.

Para associar skills a um agente, abra a configuração do agente e use a seção **Skills**. Você pode:

- escolher uma pasta existente que contenha um ou mais arquivos `SKILL.md`;
- informar um repositório como `dickwu/apple-design-skill` e clicar em **Install skill**.

Skills instaladas pelo aplicativo ficam em `%USERPROFILE%\Documents\MainsAgents Skills`. A pasta e a lista detectada são salvas na configuração do agente e enviadas como contexto quando uma nova thread Codex é criada.

No chat de um agente, digite `/` para ver as skills associadas a ele. Filtre pelo nome e escolha com as setas e **Enter**, ou clique na skill. Escreva a mensagem em seguida; o chat mostra qual skill foi usada. Você também pode escrever `/nome-da-skill sua instrução` diretamente. Para desvincular uma skill, abra **Configure** no cartão do agente, use **Remove** ao lado da skill e salve. Isso não apaga os arquivos da skill do computador; você pode restaurar a associação na mesma tela.

## Desenvolvimento

Instale as dependências:

```bash
npm install
```

Inicie Vite e o bridge local do Codex:

```bash
npm run dev
```

A interface será aberta em `http://127.0.0.1:5173/app.html`.

Para executar somente o frontend, sem iniciar o bridge:

```bash
npm run dev:web
```

Para abrir a aplicação no Electron:

```bash
npm run desktop
```

Também é possível baixar o código do GitHub, executar `npm install` e abrir o desktop com `npm run desktop`. Para isso, instale Node.js e, se quiser conversar com o Codex, instale e autentique a CLI com `codex login`.

## Build

Valide os tipos e gere o frontend de produção:

```bash
npm run typecheck
npm run build
```

Gere o instalador Windows:

```bash
npm run desktop:dist
```

Os artefatos são criados em `release/`:

```text
release/
  MainsAgents-Setup-0.3.0.exe
  win-unpacked/
```

## Persistência

No desktop, alterações são confirmadas pelo SQLite antes de aparecerem como salvas. O botão **Salvo** no topo indica o salvamento automático e permite **Salvar agora**. Se uma gravação falhar, o indicador mostra **Não salvo**, as alterações ficam disponíveis em memória para nova tentativa ou exportação, e o fechamento normal é bloqueado até confirmar o salvamento. Ao fechar, o app gera `%USERPROFILE%\.mainsagents\storage\backups\workspace-latest.json` e confirma a gravação do banco. As últimas 50 alterações de agentes ficam em um histórico de recuperação local. Uma interface antiga não pode sobrescrever uma versão mais recente dos dados: cada gravação verifica a revisão que foi carregada.

O desktop exige o bridge SQLite e não usa silenciosamente um IndexedDB antigo do navegador. O cache de interface é atualizado na abertura; a versão, o perfil e a disponibilidade do bridge ficam registrados em `startup.log` para diagnóstico.

No navegador, workspaces, agentes, sessões, mensagens, tarefas, nodes e edges são armazenados em IndexedDB. No desktop, esses dados e o editorial ficam no mesmo `workspace-state.sqlite`. O aplicativo utiliza uma origem local estável para a migração de dados anteriores.

No Windows, agentes, conversas, Canvas, tarefas e preferências ficam em:

```text
%USERPROFILE%\.mainsagents\storage
```

A partir da versão 0.3.28, esse diretório é o mesmo quando o app é aberto pelo menu do Windows, atalho ou por um aplicativo MSIX como o Codex. O Windows pode redirecionar `AppData` para uma cópia privada de cada pacote, fazendo uma recuperação parecer salva durante a atualização e desaparecer na abertura normal. A localização atual fica fora desse redirecionamento. O banco antigo é migrado uma única vez pelo backup transacional do SQLite, incluindo seu diário de gravações, e permanece intacto. Uma migração que falha não abre uma equipe vazia. Depois da migração, o banco antigo não volta a substituir o atual nem desfaz exclusões intencionais. O `startup.log` também fica no diretório permanente, permitindo conferir o caminho usado em cada abertura.

Conta local e runtime Codex continuam em `%APPDATA%\mains-agents`; o workspace e o editorial têm a localização permanente acima.

O diretório de trabalho disponibilizado ao runtime Codex fica em:

```text
%USERPROFILE%\Documents\MainsAgents Workspace
```

## Integração com Codex

O MainsAgents mantém o histórico do runtime separado do aplicativo Codex. No desktop, novas threads, transcrições e bancos do Codex ficam em `%APPDATA%\mains-agents\codex-runtime`; em desenvolvimento (`npm run dev`), ficam em `.mainsagents-workspaces/codex-runtime`. A CLI é iniciada com `CODEX_HOME` e o diretório SQLite apontando para esse armazenamento próprio. Atualizações do instalador preservam essa pasta.

O login, a configuração, as skills globais e as conexões MCP continuam compartilhados com o Codex local (`CODEX_HOME` original, ou `%USERPROFILE%\.codex`). Arquivos de conexão usam links físicos; diretórios de credenciais MCP, locks OAuth, skills, rules e plugins usam junctions no Windows. A sincronização repara links quando a CLI substitui um arquivo de credenciais durante a renovação. Não há cópia permanente de refresh tokens nem sincronização de conversas. Adicionar um MCP no Codex continua disponibilizando-o ao MainsAgents após reiniciar ou reconectar o runtime. O consumo segue sendo da mesma conta.

Ao retomar uma conversa anterior à separação, somente a transcrição daquela thread é copiada para o histórico próprio; o identificador e as mensagens do MainsAgents são preservados. A transcrição antiga permanece no Codex como estava, sem receber as próximas mensagens do MainsAgents. A separação não remove retroativamente conversas do outro aplicativo. Não faça commit de arquivos de credenciais ou da pasta do runtime. Em instalações com diretórios de conexão em volumes diferentes ou arquivos independentes já existentes, o app apresenta um erro de conexão em vez de sobrescrever esses dados ou voltar ao histórico compartilhado.

O frontend depende da interface `CodexService` e não chama o runtime diretamente. O bridge Node inicia o Codex App Server via stdio e expõe uma API HTTP local para:

- criar ou retomar uma thread;
- enviar uma mensagem;
- receber eventos em streaming;
- acompanhar pesquisa, raciocínio e uso de ferramentas;
- cancelar uma execução.

Por padrão, o runtime usa o modelo recomendado pelo Codex. Quando estiver conectado, escolha outro modelo em **Settings → Default Codex model**. A escolha afeta apenas novas sessões. Para desenvolvimento, também é possível definir um padrão via ambiente:

```powershell
$env:MAINSAGENTS_CODEX_MODEL = "nome-do-modelo"
npm run desktop
```

As sessões do MainsAgents armazenam o `codexThreadId` legado e o identificador remoto no contrato de provedor, permitindo continuar conversas anteriores depois de reiniciar a aplicação.

## Integração com Claude Code CLI

O bridge local verifica o login usando `claude auth status` e executa cada resposta com `claude -p` em modo `stream-json`. O identificador UUID da sessão do MainsAgents é passado ao Claude Code CLI para iniciar ou retomar o transcript local. O adaptador limita as ferramentas built-in às habilitadas no agente e desativa servidores MCP descobertos automaticamente; a pasta de skills selecionada pode ser adicionada explicitamente.

Se o CLI não estiver instalado, **Configurações → Conexões de IA → Claude Code** mostra o comando de instalação recomendado para o sistema. Depois de executar `claude auth login`, use **Check again**. As mensagens permanecem salvas no MainsAgents e o Claude Code CLI mantém seus próprios transcripts locais.

Antes de distribuir o MainsAgents com suporte ao Claude Code CLI, consulte [PROVIDER_COMPATIBILITY.md](PROVIDER_COMPATIBILITY.md) e cumpra o acordo comercial e as condições de distribuição aplicáveis da Anthropic.

## Ajuda e recuperação

- **Codex desconectado:** instale a CLI com o comando acima, abra **Settings → Codex CLI connection** e use **Reconnect** ou **Sign in**. Conversas locais continuam visíveis enquanto o Codex está indisponível.
- **Claude Code CLI desconectada:** execute o comando de instalação mostrado em Settings e depois `claude auth login` no terminal. Volte ao app e escolha **Check again**.
- **Dados locais:** exporte um backup em **Settings → Your data** para guardar uma cópia. A conta não sincroniza histórico com outros computadores.
- **Salvamento no desktop:** agentes, sessões, mensagens, tarefas, Canvas e preferências são gravados diretamente no SQLite a cada alteração, antes de atualizar a tela. Os dados ficam em `%USERPROFILE%\.mainsagents\storage`, fora da instalação e do redirecionamento MSIX do Windows. Ao abrir, o app restaura o perfil e seus dados antes de mostrar o workspace; uma falha de leitura exibe uma opção de tentar novamente, sem abrir uma equipe vazia. Atualizações do instalador preservam esse diretório.
- **Falha ao salvar:** o app mostra um aviso persistente. Exporte um backup, confira espaço em disco e tente novamente. Não feche o app antes de preservar os dados.
- **Feedback:** em **Settings → Help and feedback**, baixe um diagnóstico sem mensagens ou credenciais e abra uma issue no GitHub.

O procedimento de publicação e rollback está em [RELEASE.md](RELEASE.md). As decisões de privacidade estão em [PRIVACY.md](PRIVACY.md).

## Arquitetura

```text
src/
  app/                  composição, rotas, workspaces e estado da aplicação
  components/
    agents/             lista, linhas, status e editor de agentes
    canvas/             React Flow, nodes e interações de contexto
    chat/               painel lateral de conversa
    command/            Command Palette
    layout/             AppShell, Sidebar, Topbar e RightPanel
    tasks/              colunas e cards do Board
  data/                 persistência IndexedDB
  features/
    agents/             domínio e estado dos agentes
    chat/               sessões, mensagens e CodexService
  pages/                Home, Board, Canvas, Agents, Sessions e Settings

codex-bridge.mjs        bridge HTTP para o Codex App Server
desktop-main.mjs        processo principal do Electron
dev.mjs                 Vite e bridge em desenvolvimento
```

As camadas principais são separadas em interface, estado da aplicação, persistência e runtime Codex. Isso permite trocar o transporte ou o armazenamento sem acoplar essas decisões aos componentes React.

## Scripts

| Comando | Função |
| --- | --- |
| `npm run dev` | Inicia Vite e o bridge Codex |
| `npm run dev:web` | Inicia somente o frontend |
| `npm run codex:bridge` | Inicia somente o bridge Codex |
| `npm run desktop` | Faz o build e abre o app Electron |
| `npm run desktop:dist` | Gera o instalador Windows |
| `npm run typecheck` | Valida os tipos TypeScript |
| `npm run build` | Gera o frontend de produção |
| `npm run preview` | Abre o build web localmente |

## Estado atual

Na conversa entre agentes, **Criar Canvas** abre as duas sessões como chats no Canvas do workspace, com uma seta da origem para o agente que recebeu a tarefa. Os chats usam o histórico original, recebem as respostas em andamento e permitem continuar as mesmas sessões. Clicar novamente reutiliza os objetos existentes; sessões novas geram chats próprios. As posições e ligações são salvas localmente, e o campo de mensagem permanece fixo enquanto o histórico rola.

A aplicação funciona localmente com integração ao Codex e Claude Code CLI. O runtime Codex opera em sandbox somente leitura; o adaptador Claude restringe ferramentas à seleção do agente e não permite subagentes automáticos. O instalador ainda não possui assinatura comercial de código. A distribuição de suporte ao Claude Code depende dos termos comerciais da Anthropic. O cadastro é local a este PC e esta versão não sincroniza histórico entre dispositivos.



## Entregas no chat

Pesquisas com fontes e opções de roteiro no formato editorial suportado aparecem como cartões. Use **Salvar entrega**, vincule o roteiro a uma pauta aprovada e escolha **Revisar e aprovar** para editar e aprovar sem sair da conversa. O envio opcional ao Notion usa a mesma fila do Estúdio, com conferência da versão e do destino. **Trabalho persistente** transfere a versão aprovada a outro especialista e mantém acompanhamento e recuperação salvos. A captura de mensagens requer o desktop. Veja [uso, garantias e limites](docs/chat-deliveries-increment.md).

No desktop, os chats Codex também mostram **Aprovar uma vez** antes de cada ferramenta MCP configurada executar. As chamadas automáticas entre agentes Codex são acompanhadas por uma fila local persistente, mantendo os dois chats e permitindo recuperação explícita após interrupção. Em **Configurações → Conexões de IA → Verificar capacidades**, confira login, catálogo MCP e arquivos das skills sem gerar uma resposta da IA. Veja [uso e limites dos controles de runtime](docs/runtime-controls-increment.md).


## Revisão, calendário e vídeo local

Na revisão de roteiro, aprove, rejeite ou peça ajustes sem apagar versões. No chat, `aprovo esse roteiro` e `ajuste: encurte a introdução` abrem a confirmação da versão salva; não publicam nem geram uma nova resposta automaticamente.

No Estúdio, **Entregas por rede** separa texto, mídia, revisão e horário planejado de Instagram, TikTok, YouTube e LinkedIn. A aba **Calendário** usa o fuso escolhido e vira agenda em telas menores. Aprovar uma entrega não a envia. No desktop 0.3.42, LinkedIn com texto/mídia pode criar rascunho, agendar, editar, reagendar e cancelar via Publora MCP. Instagram/TikTok e LinkedIn podem usar a API Zernio, com seleção da conta e opções da rede. Cada envio exige autorização específica; edição preserva o mesmo ID e histórico de versões. O calendário permite consulta automática opcional enquanto o app está aberto; rascunhos dos formulários editoriais sobrevivem ao reinício. Veja [como usar edição, calendário e rascunhos](docs/publication-edit-and-drafts-increment.md). Veja [como enviar mídia, conectar Zernio e recuperar falhas](docs/publication-media-and-zernio-increment.md). Veja [publicação integrada](docs/publication-connector-increment.md).

**Edição local de vídeo** permite cortar/exportar um trecho autorizado com FFmpeg e ffprobe no PATH. Gera um novo MP4, preserva o original e confere duração/áudio antes de associar o resultado. Progresso e recuperação ficam salvos; fechar interrompe e exige retomada explícita. Abra original e resultado no player padrão para revisar. Sem controle do computador nem acabamento automático.

Veja [uso e limites](docs/review-publications-media-increment.md). O projeto usa [MIT](LICENSE); consulte [contribuição](CONTRIBUTING.md) e [segurança](SECURITY.md). Skills, dependências e imagens de terceiros têm termos próprios.
