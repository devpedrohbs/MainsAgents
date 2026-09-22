# MainsAgents

MainsAgents é um workspace desktop para criar e operar agentes de IA especializados. Ele reúne agentes, sessões, tarefas, Canvas e contexto em uma interface única, com integração local ao Codex e histórico persistente.

O projeto foi pensado para pesquisa, notícias, criação de conteúdo, tendências, roteiros, hooks e organização de ideias. Cada agente pode ter instruções e ferramentas próprias, enquanto suas conversas permanecem separadas em sessões.

## Recursos

- Workspaces independentes com agentes, tarefas, sessões e Canvas próprios.
- Criação, edição e exclusão de agentes.
- Chat com streaming conectado ao Codex.
- Continuação de threads e sessões anteriores.
- Board com tarefas movidas por drag and drop.
- Canvas visual com pan, zoom, conexões e seis tipos de node.
- Contexto bidirecional entre Chat e Canvas.
- Command Palette com `Ctrl + K`.
- Persistência local de todo o histórico.
- Interface alternável entre Português (Brasil) e English (US).
- Skills por agente, com instalação via GitHub ou seleção de uma pasta local.
- Aplicativo desktop para Windows com instalador NSIS.

## Stack

- React 19
- TypeScript
- Vite
- Electron
- React Flow
- IndexedDB
- Codex App Server

## Pré-requisitos

Para desenvolvimento ou integração real com o Codex:

- Windows 10 ou 11 x64.
- Node.js e npm instalados.
- Codex CLI instalado e autenticado.

Instale o Codex CLI caso ainda não esteja disponível:

```bash
npm install -g @openai/codex
codex login
```

O MainsAgents inicia o `codex app-server` localmente. Nenhuma chave de API é armazenada no frontend.

## Instalação para usuário

Baixe ou gere `MainsAgents-Setup-0.2.0.exe`, execute o instalador e escolha o diretório de instalação. O instalador cria atalhos na área de trabalho e no menu Iniciar.

Na primeira abertura, a aplicação cria um workspace vazio. O fluxo inicial é:

1. Abra **Agents** e clique em **Create agent**.
2. Defina nome, função, instruções e ferramentas do agente.
3. Abra uma nova sessão pelo painel lateral ou com `Ctrl + K`.
4. Envie uma mensagem; a resposta será transmitida pelo Codex em tempo real.
5. Envie respostas para o Canvas ou use nodes do Canvas como contexto.
6. Organize o trabalho no Board.

O idioma pode ser alterado em **Settings → Interface language**. A escolha é salva localmente.

Para associar skills a um agente, abra a configuração do agente e use a seção **Skills**. Você pode:

- escolher uma pasta existente que contenha um ou mais arquivos `SKILL.md`;
- informar um repositório como `dickwu/apple-design-skill` e clicar em **Install skill**.

Skills instaladas pelo aplicativo ficam em `%USERPROFILE%\Documents\MainsAgents Skills`. A pasta e a lista detectada são salvas na configuração do agente e enviadas como contexto quando uma nova thread Codex é criada.

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
  MainsAgents-Setup-0.2.0.exe
  win-unpacked/
```

## Persistência

Workspaces, agentes, sessões, mensagens, tarefas, nodes e edges são armazenados em IndexedDB. O aplicativo utiliza uma origem local estável para recuperar o mesmo banco após fechar ou reiniciar.

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

Por padrão, o runtime usa o modelo `gpt-5.6-terra`. Para escolher outro modelo compatível com sua instalação do Codex:

```powershell
$env:MAINSAGENTS_CODEX_MODEL = "nome-do-modelo"
npm run desktop
```

As sessões do MainsAgents armazenam o `codexThreadId`, permitindo continuar a conversa real depois de reiniciar a aplicação.

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

A aplicação funciona localmente com integração real ao Codex. O runtime opera em sandbox somente leitura e sem orquestração multiagente automática. O instalador ainda não possui assinatura comercial de código.
