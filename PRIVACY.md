# Privacidade e dados locais

O app abre sem exigir conta MainsAgents ou conexão com um servidor. O login local é opcional e serve apenas para separar perfis dentro do mesmo perfil do Windows; não sincroniza dados entre computadores. Se usado, o app inicia um serviço de autenticação apenas em `127.0.0.1`; contas, hash de senha e código de recuperação ficam neste PC. Workspaces, agentes, tarefas, sessões, mensagens e Canvas ficam em IndexedDB dentro do perfil Electron em `%APPDATA%\mains-agents`.

Ao enviar uma mensagem, o texto e o contexto de Canvas selecionado são enviados ao runtime local do provedor escolhido: Codex App Server, Claude Code CLI ou, quando configurado, uma API de terceiros. O provedor processa esses dados conforme a conta e as configurações da pessoa. O app deve mostrar o contexto antes do envio. Pastas de skills são apenas caminhos locais; o app não as inclui em backups.

O arquivo de backup exporta dados de trabalho e preferências; não inclui credenciais. Verifique o destino do arquivo, pois ele pode conter conversas e ideias privadas. Diagnósticos gerados em **Settings** contêm apenas versão, data, idioma e estado resumido da conexão. O aplicativo não registra prompts completos no log de inicialização.

Os bridges de provedores e o servidor da interface aceitam apenas conexões locais. Cada inicialização cria segredos aleatórios para proteger chamadas internas; eles não são gravados no frontend nem no backup. O Codex é executado em modo somente leitura. O Claude Code CLI é iniciado sem ler credenciais pelo MainsAgents; o app consulta `claude auth status`, enquanto o CLI autentica e mantém seus próprios transcripts locais. A execução de Claude Code também cria uma cópia do histórico no armazenamento gerenciado pelo próprio CLI.

Para apagar seus dados locais, exporte o backup desejado e remova manualmente o perfil `%APPDATA%\mains-agents`. A desinstalação normal preserva o perfil para permitir atualização ou reinstalação. Excluir a conta remove a identidade e invalida sessões no serviço de contas; os dados locais permanecem no PC até serem removidos separadamente.

Não existe serviço MainsAgents hospedado: cada instalação mantém seus dados neste computador. O serviço HTTP de contas só escuta no endereço de loopback e não aceita conexões de rede. Para usar Codex ou Claude Code, a pessoa autentica a própria instalação local da CLI. O MainsAgents não lê nem armazena tokens desses provedores.
