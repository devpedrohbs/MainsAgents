# Contribuindo com o MainsAgents

O código do projeto usa a licença MIT. Skills de terceiros, dependências e imagens podem ter licenças próprias; preserve seus avisos e não inclua imagens ou arquivos pessoais em uma contribuição.

## Preparar o ambiente

Use Windows x64, Node.js 24 e npm. Clone o repositório e execute `npm ci`. Para testes de edição de vídeo, instale FFmpeg com ffprobe e deixe ambos no PATH. Confira com `ffmpeg -version` e `ffprobe -version`.

Execute:

```powershell
npm run build
npm test
```

Os testes automatizados usam dados temporários e processos simulados para as CLIs. Os testes de mídia geram um vídeo sintético com FFmpeg. Não autentique uma conta pessoal nem publique conteúdos para validar uma alteração.

Para verificar a interface em perfis Electron separados:

```powershell
npx electron scripts/test-publications-ui.mjs
npx electron scripts/test-editorial-media-ui.mjs
npx electron scripts/test-completion-ui.mjs
npx electron scripts/test-desktop-persistence-ui.mjs
```

`npm run dev` abre o modo de desenvolvimento. `npm run desktop:dist` gera o instalador Windows em `release/`.

## Regras para alterações

- Preserve o histórico e versões. Novos campos devem aceitar os snapshots antigos e participar da validação, mesclagem, backup e restauração.
- Separe componentes React, estado, persistência e execução de ferramentas. Uma mudança de página não deve interromper uma execução nativa.
- Aprovar um roteiro não autoriza publicar. A aprovação deve identificar a versão e o efeito exatos.
- Não coloque tokens, dados de login, bancos SQLite, vídeos pessoais ou caminhos privados no Git. Use fixtures de teste.
- Mantenha PT-BR e EN-US, teclado, rolamento e composer fixo. Confira a interface compacta e os dois temas.
- O Editor de Vídeo não recebe controle do computador. Operações locais têm parâmetros delimitados e produzem um arquivo novo.

Abra uma issue com o problema e comportamento esperado antes de uma mudança ampla. No pull request, descreva o comportamento final, os testes executados e os limites conhecidos. Não marque uma integração como concluída apenas porque uma ferramenta foi encontrada no catálogo MCP.
