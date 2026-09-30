# MainsAgents

MainsAgents é um workspace desktop para criar e operar agentes de IA especializados. Ele reúne agentes, sessões, tarefas, Canvas e contexto em uma interface única, com integração local às CLIs do Codex e Claude Code e histórico persistente.

O projeto foi pensado para pesquisa, notícias, criação de conteúdo, tendências, roteiros, hooks e organização de ideias. Cada agente pode ter instruções e ferramentas próprias, enquanto suas conversas permanecem separadas em sessões.

## Recursos

- Workspaces independentes com agentes, tarefas, sessões e Canvas próprios.
- Criação, edição e exclusão de agentes.
- Chat com streaming pelo Codex App Server e Claude Code CLI.
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

O campo de chat fica fixo; somente o histórico rola. Rascunhos ficam separados por agente e sessão enquanto o aplicativo permanece aberto. **Enter** envia, **Shift + Enter** cria uma linha e **/** seleciona uma skill associada. Se a IA estiver desconectada, o chat oferece acesso direto às configurações.

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

### Fluxo editorial (primeira versão)

1. Crie no workspace um agente de pesquisa com **Web Search** e conecte a CLI Codex ou Claude em **Settings**. Um segundo agente pode ser usado para roteiros.
2. Abra **Conteúdo** na barra lateral. Envie uma ideia, uma URL ou peça sugestões de pautas. A pesquisa abre uma sessão do agente e apresenta fontes e possíveis ângulos. Confira as fontes antes de decidir.
3. Edite a pauta se necessário e aprove ou descarte. A aprovação cria um card vinculado no **Board**; o estado desse card acompanha o fluxo editorial.
4. Gere opções de roteiro. Escolha entre hooks, caminhos de condução e CTAs, edite o texto, os tópicos para improviso e a direção de capa, e aprove a versão final. Versões, decisões, sessões e erros ficam acessíveis no card.

O aplicativo precisa permanecer aberto durante a pesquisa e a geração do roteiro. Se o provedor falhar ou o aplicativo fechar, a etapa fica marcada para nova tentativa sem criar outro card. Esta versão não agenda publicações, edita vídeos, transcreve mídias nem sincroniza com Notion.

Os dados de conta local usam SQLite em `%APPDATA%\mains-agents\accounts.sqlite`. O fluxo editorial usa `%APPDATA%\mains-agents\editorial.sqlite`. Agentes, workspaces, sessões, mensagens, tarefas e Canvas usam IndexedDB local. Cada instalação mantém seus próprios dados.

O idioma pode ser alterado em **Settings → Interface language**. A escolha é salva localmente.
Em **Settings**, você também pode aumentar a interface, reduzir animações, exportar um backup ou importar um arquivo após conferir a prévia. O backup inclui as pautas, artefatos e decisões editoriais, mas não inclui credenciais.

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

Workspaces, agentes, sessões, mensagens, tarefas, nodes e edges são armazenados em IndexedDB. Pautas, cards de conteúdo, execuções, artefatos e aprovações ficam no SQLite editorial. O aplicativo utiliza uma origem local estável para recuperar os mesmos bancos após fechar ou reiniciar.

No Windows, o perfil persistente fica em:

```text
%APPDATA%\mains-agents
```

O diretório de trabalho disponibilizado ao runtime Codex fica em:

```text
%USERPROFILE%\Documents\MainsAgents Workspace
```

## Integração com Codex

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

A aplicação funciona localmente com integração ao Codex e Claude Code CLI. O runtime Codex opera em sandbox somente leitura; o adaptador Claude restringe ferramentas à seleção do agente e não permite subagentes automáticos. O instalador ainda não possui assinatura comercial de código. A distribuição de suporte ao Claude Code depende dos termos comerciais da Anthropic. O cadastro é local a este PC e esta versão não sincroniza histórico entre dispositivos.


