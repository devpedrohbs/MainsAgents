# MainsAgents — backlog para uso público

Atualizado em 22/09/2026. Este arquivo contém tarefas independentes para executar em conversas futuras do Codex. A ordem abaixo evita construir novos provedores sobre uma experiência difícil de usar ou um modelo de dados frágil.

## Decisões de produto

- A conta **MainsAgents** identifica a pessoa e libera o uso do app. Cada perfil mantém os próprios dados localmente neste computador.
- O app desktop exige conta; os dados de trabalho não são sincronizados com outro computador.
- Cada sessão registra o provedor, o modelo, o identificador remoto e o modo de autenticação. Conversas antigas do Codex continuam acessíveis.
- Nunca prometer que qualquer assinatura paga funcionará dentro do MainsAgents sem confirmar o caminho de integração permitido pelo provedor. Em setembro de 2026, Codex oferece `app-server` com login ChatGPT; as regras publicadas por Anthropic e Google restringem o reaproveitamento de credenciais de assinatura em produtos de terceiros. Os adaptadores Claude e Gemini devem oferecer primeiro credenciais oficiais próprias do usuário (API ou provedor cloud), sem copiar tokens de CLIs.
- Dados de trabalho pertencem ao perfil local. Arquivos e pastas de skills não são enviados ao servidor de contas.

## Fase 1 — Usabilidade e confiança

### MA-01 · Leitura, escala e janelas [P0]

**Pedido ao Codex:** Audite o layout real do MainsAgents em Windows, corrija tipografia pequena e baixo contraste, e permita ajustar tamanho do texto e largura da sidebar e do ChatPanel. Preserve a identidade visual atual.

**Aceite:** textos principais legíveis sem depender do modo de foco; 100%, 125%, 150% e 200% de escala sem cortes; janela estreita mantém acesso ao chat e navegação; preferência de tamanho persiste; estados não dependem somente de cor.

### MA-02 · Controles reais e feedback claro [P0]

**Pedido ao Codex:** Encontre botões e configurações que parecem funcionais mas não executam ação. Implemente a ação ou remova o controle. Mostre estado real de conexão com o provedor e erros com ação de recuperação.

**Aceite:** indicador “Codex connected” acompanha o runtime real; botões de Perfil, Filter, Models, Shortcuts e toggles de Settings têm comportamento definido; falhas de persistência aparecem na interface; nenhum controle promete uma função ausente.

### MA-03 · Primeira experiência guiada [P0]

**Pedido ao Codex:** Crie onboarding curto e opcional: escolher idioma, verificar Codex, criar o primeiro agente a partir de um modelo, iniciar sessão e enviar o primeiro resultado ao Canvas. Inclua dicas contextuais nas telas vazias.

**Aceite:** uma pessoa nova produz seu primeiro resultado sem ler o README; pode pular ou reabrir o guia; ausência de CLI não bloqueia o uso local de Board e Canvas; mensagens explicam como corrigir instalação ou autenticação.

### MA-04 · Criação e edição recuperáveis [P0]

**Pedido ao Codex:** Melhore formulários e fluxos de edição de agentes, tarefas, sessões e nodes. Preserve rascunhos não enviados e ofereça desfazer para ações reversíveis.

**Aceite:** fechar um formulário com alterações avisa sobre o rascunho; campos obrigatórios são indicados e validados no lugar; tarefa abre seus próprios detalhes e conversa relacionada; excluir e mover oferecem recuperação quando possível; foco do teclado retorna ao controle que abriu o diálogo.

### MA-05 · Dados locais robustos e portabilidade [P0]

**Pedido ao Codex:** Versione o esquema do IndexedDB e crie exportação/importação de um backup completo do workspace, com validação e prévia antes de substituir ou mesclar dados.

**Aceite:** backup inclui workspaces, agentes, sessões, mensagens, tarefas, Canvas e preferências relevantes; importação nunca apaga dados silenciosamente; migrações preservam dados de instalações antigas; falhas de gravação e banco cheio têm tratamento visível.

### MA-06 · Instalação e atualização confiáveis [P0]

**Pedido ao Codex:** Prepare uma distribuição Windows reproduzível com instalador, atualização no mesmo diretório, migração de dados, detecção de versão e rollback. Adicione assinatura de código quando houver certificado disponível.

**Aceite:** atualizar de uma versão anterior preserva histórico e atalhos; app mostra número da versão; instalador informa falha de permissão em vez de terminar com falso sucesso; existe processo documentado de publicação e rollback; artefato é verificado antes de anunciar a versão.

## Fase 2 — Escolha de provedor de IA

### MA-07 · Contrato comum de runtime [P0]

**Pedido ao Codex:** Generalize `CodexService` para um contrato de provedor com criação/retomada de sessão, streaming, ferramentas, cancelamento, erros, autenticação e capacidades disponíveis. Migre as sessões existentes sem perder `codexThreadId`.

**Aceite:** `providerId`, `modelId`, `remoteSessionId` e capacidades ficam no modelo de sessão; UI não importa SDK/CLI diretamente; adaptadores traduzem eventos para um formato comum; sessões antigas continuam no Codex.

### MA-08 · Compatibilidade e política por provedor [P0, bloqueia MA-10/11]

**Pedido ao Codex:** Antes de integrar Claude e Gemini, valide na documentação oficial quais opções permitem que um produto desktop de terceiros execute conversas usando autenticação do usuário. Registre licença, fluxo de login, uso de assinatura, modo CLI/SDK/API, limites e custo. Não implemente extração ou reutilização de tokens OAuth.

**Aceite:** tabela datada e com links oficiais; uma opção recomendada por provedor; recursos não permitidos ficam fora da interface; decisões que dependem de autorização comercial aparecem explicitamente como pendentes.

### MA-09 · Polir conexão Codex [P1]

**Pedido ao Codex:** Complete o adaptador Codex existente com detecção da CLI, status de conta, login oficial, escolha de modelo, limites quando disponíveis e retomada de sessão após reiniciar o app.

**Aceite:** estado “não instalado”, “precisa entrar”, “conectado”, “limite atingido” ou “erro” aparece corretamente; cancelar interrompe a execução; respostas e histórico sobrevivem à reinicialização; app não armazena tokens do Codex.

### MA-10 · Adaptador Claude [P1, após MA-08]

**Pedido ao Codex:** Implemente um adaptador Claude pelo caminho permitido no MA-08, inicialmente usando chave API do próprio usuário ou provedor cloud oficial. Use CLI/SDK e assinatura apenas se a pesquisa confirmar o uso específico do MainsAgents.

**Aceite:** conexão, seleção de modelo, streaming, cancelamento, retomada quando suportada e erros claros; custo e origem da cobrança aparecem antes da primeira execução; chave fica no armazenamento seguro do sistema e nunca no frontend, logs ou backup.

### MA-11 · Adaptador Gemini [P1, após MA-08]

**Pedido ao Codex:** Implemente Gemini usando Gemini Developer API ou Vertex AI com credencial própria do usuário, respeitando a orientação oficial para integração de terceiros. Não reaproveite o login OAuth do Gemini CLI.

**Aceite:** mesmas capacidades essenciais do MA-10; app indica se usa cota gratuita ou cobrança de API; ausência de capacidade de retomada ou ferramenta é mostrada sem simular suporte; credenciais ficam fora do frontend e do backup.

### MA-12 · Seleção de IA compreensível [P1, após MA-07]

**Pedido ao Codex:** Adicione seleção de provedor/modelo ao criar agente e sessão. Mostre conexão, recursos, limites e modo de cobrança de cada opção. Permita alterar o padrão sem trocar silenciosamente uma sessão em andamento.

**Aceite:** pessoa entende qual IA responderá e quem cobrará pelo uso; sessão antiga reabre no provedor original; provedor indisponível oferece reconectar, trocar numa nova sessão ou ler histórico; Canvas e Board mantêm o vínculo com a sessão correta.

## Fase 3 — Contas e privacidade

### MA-13 · Conta MainsAgents obrigatória no desktop [P1]

**Pedido ao Codex:** Crie cadastro/login local, recuperação de acesso e sessões seguras. Exija uma conta local para usar o aplicativo desktop, sem modo visitante. A conta MainsAgents não deve pedir nem armazenar senha ou token dos provedores de IA.

**Aceite:** login é exigido no desktop; login e logout não misturam dados entre contas; cada perfil e credencial permanecem locais a este PC; serviço só escuta em loopback e não guarda histórico de trabalho.

### MA-14 · Sincronização entre dispositivos [Cancelada por decisão de produto]

O usuário esclareceu que cada pessoa deve entrar com sua própria conta para usar o app; computadores não devem se unir nem sincronizar histórico. O histórico permanece local neste computador e perfis são separados localmente por conta. Não implementar sync remoto.

### MA-15 · Privacidade e controle dos dados [P1, antes do beta público]

**Pedido ao Codex:** Implemente segurança para conta e CLIs locais: criptografia em trânsito, proteção de segredos no sistema, confirmação de envio de arquivos/contexto e política clara de retenção. Não armazenar dados de trabalho no servidor de contas.

**Aceite:** usuário consegue exportar e excluir sua conta e dados remotos; backup não contém credenciais; pastas locais de skills e arquivos não são sincronizados por padrão; logs não registram prompts completos nem segredos; revisão de segurança cobre bridge localhost e IPC do Electron.

## Fase 4 — Descoberta, qualidade e lançamento

### MA-16 · Busca global e organização [P2]

**Pedido ao Codex:** Permita buscar agentes, sessões, mensagens, tarefas e nodes em todos os workspaces, com filtros por provedor, data e tipo. Expanda a Command Palette sem perder os atalhos atuais.

**Aceite:** resultado abre o contexto certo; busca funciona com milhares de mensagens sem travar a UI; dados de outra conta nunca aparecem; busca offline cobre dados locais.

### MA-17 · Fluxos prontos para criadores [P2]

**Pedido ao Codex:** Ofereça modelos opcionais de agente e workspace para pesquisa, notícias, Instagram, TikTok, YouTube e roteiros, com exemplos de tarefa e Canvas. Evite criar dados de demonstração sem pedido.

**Aceite:** modelo explica ferramentas e resultado esperado; pode ser editado antes de criar; workspace vazio continua disponível; criar um modelo não envia dados ao provedor até o usuário executar.

### MA-18 · Qualidade, ajuda e beta [P1, antes do beta público]

**Pedido ao Codex:** Prepare documentação de usuário, solução de problemas e verificações automatizadas dos fluxos principais. Inclua diagnósticos compartilháveis sem conteúdo privado e um canal de feedback no app.

**Aceite:** instalação limpa, atualização, restauração de backup, troca de workspace, conversa Codex e uso offline são verificados em Windows; README corresponde à versão atual; relatórios de erro removem tokens e prompts; grupo piloto consegue completar o primeiro fluxo sem suporte individual.

## Ordem recomendada

1. **Beta local confiável:** MA-01 a MA-06 e MA-18.
2. **Múltiplas IAs:** MA-07 e MA-08, depois MA-09 a MA-12.
3. **Conta e privacidade local:** MA-13 e MA-15. A MA-14 foi cancelada.
4. **Expansão do produto:** MA-16 e MA-17.

## Referências para revalidar ao executar

- [Codex App Server](https://developers.openai.com/docs/app-server) e [autenticação do Codex](https://developers.openai.com/docs/auth).
- [Claude Code — legal e autenticação](https://code.claude.com/docs/en/legal-and-compliance).
- [Gemini CLI — FAQ sobre apps de terceiros](https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/faq.md) e [autenticação](https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/authentication.mdx).
- Apple HIG: [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility), [Onboarding](https://developer.apple.com/design/human-interface-guidelines/onboarding), [Generative AI](https://developer.apple.com/design/human-interface-guidelines/generative-ai).
