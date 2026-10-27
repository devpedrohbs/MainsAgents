# Canvas — correções de uso e referências do Maestri

Implementado no projeto em 26/10/2026. Esta rodada não gera instalador nem publica release.

## Problemas encontrados e corrigidos

- A barra de seleção combinava `top` da camada de precisão com `bottom` de uma regra mais específica de páginas. Agora suas dimensões e posição são definidas juntas, com altura limitada e rolagem horizontal em telas pequenas.
- O terminal era o único bloco com redimensionador. Os nove tipos agora possuem controles nas bordas e cantos, fora do elemento que recorta o conteúdo. Os pontos de conexão também ficam fora desse recorte.
- Larguras e alturas fixas no conteúdo impediam o bloco de acompanhar seu contêiner. Notas, imagens, pesquisa, ideias, hooks, roteiros, chats e navegador agora se adaptam às dimensões externas; áreas longas têm rolagem própria.
- O duplo clique no conteúdo abria os detalhes ao selecionar texto. Agora somente o cabeçalho ou a ação Editar abre o painel.
- A busca de objetos abria um diálogo sobre a tela. Agora abre um painel compacto junto ao botão, com busca e navegação até o item.
- A criação considerava todos os blocos como pequenos retângulos e impedia posições negativas, mesmo quando a câmera estava nessa região. Agora considera tamanhos reais e o centro visível; um bloco criado fora do enquadramento recebe foco.
- A troca de workspace remonta a câmera no estado correspondente e limpa as ações temporárias.

## Como usar

- Selecione um bloco e arraste seus cantos ou bordas para aumentar ou diminuir.
- Arraste o cabeçalho para mover; o conteúdo fica livre para edição, seleção de texto e rolagem.
- Use **Editar → Largura / Altura** para medidas exatas; confirme com Enter ou saindo do campo.
- Use **Espaço + arrastar** para mover o canvas temporariamente, inclusive sobre um bloco. **H** ativa a mão; **V** volta à seleção.
- Arraste o fundo no modo de seleção para selecionar uma região; Ctrl permite selecionar vários itens.
- Com vários itens selecionados, use **Alinhar à esquerda** ou **Organizar**.
- **Ctrl+Z** desfaz criação, movimento, conexões, organização e alterações de tamanho. Os tamanhos são salvos com os objetos.

## Maestri: o que foi aproveitado e o que vem depois

As [instruções oficiais do canvas](https://www.themaestri.app/en/docs/canvas) documentam redimensionamento pelas bordas, movimento pelo cabeçalho, navegação com Espaço e organização de seleções. Esses padrões orientaram os ajustes desta rodada; a ampliação para uma janela central não foi adicionada.

O [changelog oficial para Windows](https://www.themaestri.app/en/windows/changelog), consultado em 26/10/2026, apresenta a versão 0.28.1. Para uma próxima rodada, recomendo:

1. **Layouts reutilizáveis**, inspirados nas partituras: salvar e inserir conjuntos de blocos e conexões.
2. **Grupos de agentes com alternância de conversa**, inspirados nas bands, para reduzir a quantidade de chats abertos no canvas.
3. **Prompts salvos por workspace**, com inserção rápida no chat.

Esses três recursos são recomendações, ainda não implementadas. Precisam definir como preservar sessões, referências de conteúdo e o isolamento entre workspaces.

## Validação

- `npm run typecheck`.
- `npx vite build` — compilação do renderer; não empacota o aplicativo desktop.
- 15 testes de geometria, colaboração, navegador e runtime do terminal.
- `npx electron scripts/test-canvas-interactions-ui.mjs` — armazenamento isolado, nove tipos, arraste real dos controles, aumento e redução, zoom fracionário, medidas exatas, desfazer, persistência após recarga, conexões, seleção múltipla, organização, busca, Espaço, modos claro/escuro e janelas de 360 a 1440 px. Requisições externas são bloqueadas na fixture.
- `npx electron scripts/test-refined-workspace-ui.mjs` — regressão da interface existente.

Capturas locais: `.mainsagents-workspaces/canvas-interactions-ui-test/`.

Validação final concluída em **27/10/2026**, após a retomada: verificação de tipos, build do renderer, os 15 testes e os dois percursos de interface passaram. A inspeção visual confirmou que a nota acompanha suas bordas ao encolher e que a seleção mantém apenas um contorno. Nenhum instalador foi gerado ou instalado.

## Limite da comparação visual

O [artefato do Claude fornecido](https://claude.ai/artifact/1TwZHfoiDYfHW8ELGNnhas#artboard-0b6bc07d08b3) não pôde ser aberto pela ferramenta web. A automação do Chrome foi interrompida porque a ferramenta não conseguiu verificar a URL atual. A identidade visual já presente no projeto foi preservada; não se afirma correspondência visual verificada com esse artefato.
