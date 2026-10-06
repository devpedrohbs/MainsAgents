# Integração do design aprovado — 0.3.43

Referência: `C:/Users/pacas/Documents/FrontEndMainsAgent/Atual-0.3.42`, alterada pelo OpenDesign. Integração em 05/10/2026.

Os componentes e estilos alterados na referência foram integrados ao frontend real: sidebar com rótulos, topbar sem destinos duplicados, Home com pendências compactas, cartões de agentes, Canvas com seleção/movimentação/desfazer e calendário separado com mês, semana, lista, filtros, prévia e edição. As cores, fontes, espaçamentos, bordas e temas vêm da camada `refined-workspace.css` da referência.

Não foram importados o bridge de demonstração, o armazenamento em memória, as fixtures ou os exemplos editoriais. O app mantém SQLite, CLIs, permissões, aprovação de publicação e histórico. As capas de visualização escolhidas no calendário são temporárias, como na referência; não substituem o arquivo aprovado para publicação. Sem uma URL de imagem disponível, o card mostra “Sem capa”.

Adaptações funcionais: altura do chat lateral corrigida para manter o composer visível, foco suave seguindo o composer, abertura de conteúdos retorna à Produção mesmo após visitar o Calendário, preferência de vista incluída e validada no backup. Browser e terminal continuam acessíveis no menu de objetos do Canvas.

## Verificação

- Build TypeScript/Vite aprovado e 213 testes automatizados aprovados.
- Teste do renderer de produção: navegação, mês/semana/lista, prévia, 360/880/1440 px, temas claro/escuro, adicionar/desfazer/selecionar no Canvas e composer fixo. Screenshots revisadas visualmente.
- Regressões Electron: publicação Publora/Zernio, upload/edição/recuperação, arquivos, transferência manual entre agentes, Inbox e exportação FFmpeg com dados isolados.
- Teste do pacote nativo: preservação de dados na atualização aprovado; 49 módulos nativos verificados.
- Desktop pessoal instalado na versão 0.3.43, com backup consistente antes da instalação. Hashes do estado principal e editorial comparados antes/depois: os três agentes, skills e oito sessões foram preservados.
- Hash do instalador local: `6371f0fa52be81bec62a2682cec1ae04f1d887c547854d1035ebc8ecfe430f8a`.
- Hash do app.asar instalado: `5a9f6e320784aeef95f4a5861c1e4f5d61d20fa9129bffea8e33a258c4b74cf5`.

Os testes não utilizaram tokens de IA nem criaram publicações pessoais. Esta verificação é local; não declara publicação da versão 0.3.43 no GitHub Releases.
