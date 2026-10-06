# Redesign Precisão — 0.3.49

Referência: ZIP “Redesign SaaS para app existente”, exportado pelo Claude Design, com `MainsApp.dc.html` e duas direções. O usuário escolheu explicitamente a direção **Precisão**, azul cobalto. O protótipo foi tratado como referência visual e os comportamentos/dados mock não foram importados para o runtime.

## Direção aplicada

- Geist variável hospedada localmente, com subconjuntos latino e latino estendido (~46 KB) e licença OFL incluída. Funciona sem Google Fonts/internet; a prévia HTML também incorpora as fontes.
- Claro: fundo `#f6f6f7`, superfície branca, texto `#0f1013`, borda `#e6e6e9`, azul `#3557f5`. Escuro: fundo `#0c0d10`, superfície `#14151a`, texto `#eceef2`, borda `#25272e`, azul `#7d93ff`.
- Sidebar acompanha o tema; largura padrão 244 px e cabeçalho 60 px. Larguras já personalizadas são preservadas. Provedor visível nas linhas de agentes, sem substituir imagens pessoais.
- Cards com raio de 10 px, controles compactos, hierarquia tipográfica e bordas finas. Home, agentes, sessões, Estúdio, calendário, Canvas, Fluxo, chat e formulários reutilizam os tokens semânticos.
- Home incorpora o pipeline por etapa com pautas e conteúdos reais, links para o Estúdio e revisões existentes. Números/gráficos fictícios, nomes pessoais e resultados do protótipo não foram copiados.
- Agentes: cards compactos com identidade, provedor, contexto, ferramentas, status e ações de configurar/conversar.
- Editor central de 960 × 720 px quando há espaço, com navegação de Identidade, Comportamento, Provedor, Ferramentas, Skills, Permissões MCP e Notion. Conteúdo rola independente do cabeçalho e rodapé. Em telas estreitas, a navegação vira horizontal. Campos obrigatórios ocultos levam o usuário à seção e ao campo corretos.
- Tema pode ser alterado no topo nas telas amplas, reutilizando a preferência existente. Menus e configuração de aparência continuam disponíveis em telas pequenas.

## Adaptação funcional

A produção continua nos provedores CLI e serviços nativos existentes. Nenhuma mensagem, agent, sessão ou autorização foi substituída por mocks do ZIP. Aprovações, Notion, arquivos locais, skills, modelos, duração de respostas e edição permanecem nos controles reais. O uso dos provedores permanece no controle existente; não foram inseridos percentuais demonstrativos na sidebar.

Teclado, foco visível, temas claro/escuro, contraste aumentado e movimento reduzido foram considerados. A regra antiga de não adicionar gráficos à Home foi mantida: o pipeline representa a organização atual, sem série histórica inventada.

## Validação

- Compilação TypeScript/Vite e 270 testes unitários passaram.
- Electron isolado: navegação, calendário mês/semana/lista, prévias, Canvas adicionar/desfazer/selecionar, chat fixo e layouts 360/880/1440 px nos dois temas.
- Editor: navegação por seções, foco nos campos obrigatórios, rodapé visível a 360 px e persistência da autorização Notion ao reabrir.
- Fluxos: gravação com cadastro direto, associação de arquivos, especialista e reabertura sem repetição.
- Produção semiautomática e contador: aprovações preservadas e nenhuma escrita externa antes da decisão prevista.

Capturas foram feitas com dados isolados e revisadas visualmente contra a referência. Não houve inferência paga, criação de cards Notion ou publicações nas contas pessoais.

## Instalação desktop

Instalada a 0.3.49 no diretório canônico e conferidos os atalhos do desktop/menu Windows. Backup anterior: `C:\Users\pacas\Documents\MainsAgentsBackups\before-update-0.3.49-1791308247296`. Os hashes dos dados principais e editoriais permaneceram idênticos: quatro agentes (Editor de Conteúdo, Editor de Vídeo, Linkedin Agent e Criador de Carrosséis), suas 16/3/12/8 skills e nove sessões preservados.

A persistência do pacote final passou no teste Electron. SHA256 do instalador: `0f60b8c8a10151e3ca6a0c2ed91e8ac9b0d443c9ac69b12fd7f369337d3028be`. SHA256 do `app.asar` instalado: `87901ca27e7458e1385b662575bfff1e387fccf0b19b7b5086eeef8f9de49cd8`. O pacote verifica 55 módulos nativos, segue sem assinatura Authenticode e não representa uma publicação no GitHub.
