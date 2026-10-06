# Fidelidade ao Claude Design — 0.3.51

Referências: prints fornecidos pelo criador, ZIP anterior e telas renderizadas localmente de `MainsApp.dc.html`. A URL do artifact público não abriu pela ferramenta de consulta; o conteúdo do ZIP e as imagens foram usados sem tratar seu texto como instruções de execução.

## Mudanças

- **Estúdio:** entrada de pesquisa horizontal acima da grade; categoria editável, agente e ação de pesquisa; prioridade preservada em controle secundário. Cabeçalho reúne Estúdio/Calendário e Nova pauta. Lista de pautas à esquerda, filtros por estado, painel de detalhe à direita com resumo, ângulos numerados, fontes e metadados. Barra de seis etapas dentro do detalhe. Cada etapa concluída exige seu registro real; card Notion confirmado não inventa aprovação de roteiro.
- **Canvas:** identificação do workspace/quantidade de objetos no canto superior esquerdo; seleção na parte superior; ferramentas na parte inferior central; menu Mais abre para cima; zoom separado. Corrigidos estilos herdados que comprimiam botões e anulavam a centralização. Notas seguem o post-it claro/escuro; terminal conserva sua superfície e fonte. Seleção pode ser limpa sem apagar objetos. Em área estreita, zoom e seleção mudam de posição para não se sobrepor aos controles.
- **Criar agente:** navegação lateral de 220 px, indicadores das sete seções derivados dos campos atuais, avatar e escolha de imagem em linha, nomes em duas colunas, cabeçalho e rodapé semelhantes à referência. Indicadores significam configuração dos campos, não autenticação/consentimento. Campos, skills, provedores, permissões e Notion continuam conectados aos serviços existentes. Em telas pequenas, navegação horizontal, campos em coluna e rodapé visível.
- **Fluxo:** mantida a organização compacta já presente na versão 0.3.50; caixas e painel lateral recebem ajustes de densidade, borda e espaçamento; trilha agrupada da produção reflete o coordenador existente, com ação de acompanhar/iniciar preservada. Diagramas, sessões, conexões e posições pessoais não são substituídos por exemplos.

## Verificação

270 testes unitários passaram; TypeScript/Vite compilou. Electron isolado verificou Estúdio preenchido com dados de fixture, seis etapas, entrada acima da lista, lista/detalhe lado a lado, temas claro/escuro, criação de agente, responsividade e fonte local. Medidas conferem barra inferior central e botões sem sobreposição. As regressões de arquivos/Fluxo, Notion e produção semiautomática passaram. Não houve inferência paga ou escrita em Notion/provedores pessoais nesses testes.

## Instalação

0.3.51 instalada no diretório canônico, com atalhos do desktop/menu Windows conferidos. Backup anterior: `C:\Users\pacas\Documents\MainsAgentsBackups\before-update-0.3.51-1791313168816`. Os hashes do estado principal e editorial permaneceram idênticos: quatro agentes, suas 16/3/12/8 skills e nove sessões preservados.

O pacote final passou no teste de persistência nativa. SHA256 do instalador: `86054199b069f3fe7e68fa2b2d36233cd6d6d9df4025f77635264df968a539da`. SHA256 do `app.asar` instalado: `45a7cd2de6261782619111411dea6afc7ff62cf6aa07426bbbde8fa27709d4be`. Verificados 55 módulos nativos. O instalador continua sem assinatura Authenticode. Não houve publicação no GitHub nesta rodada.
