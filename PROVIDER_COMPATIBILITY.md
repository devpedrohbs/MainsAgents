# Compatibilidade de provedores — 24/09/2026

O login do MainsAgents, quando existir, será independente do login da IA. O app não deve ler tokens ou arquivos de sessão de CLIs. A pessoa controla suas próprias credenciais e sua cobrança.

| Provedor | Integração recomendada para este app | Login e cobrança | Assinatura de consumidor no MainsAgents | Referência oficial |
| --- | --- | --- | --- | --- |
| Codex | `codex app-server` local | Login oficial do Codex/ChatGPT no próprio runtime; os dados da conversa ficam no MainsAgents | O app-server foi criado para clientes integrados. Confirmar a situação da conta por `account/read` antes de prometer disponibilidade. | [App Server](https://developers.openai.com/pt-BR/docs/app-server) |
| Claude | Binário oficial e não modificado do Claude Code CLI, executado localmente pelo MainsAgents | A pessoa autentica no próprio CLI; o uso é cobrado diretamente pelo plano Anthropic, API ou provedor configurado no Claude Code | A integração não lê nem armazena credenciais. Antes de distribuir um produto que execute Claude Code, obter/confirmar o acordo comercial exigido pela Anthropic e manter o fluxo de autenticação original do CLI. | [CLI reference](https://code.claude.com/docs/en/cli-usage), [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance) |
| Gemini | Gemini Developer API ou Vertex AI com credencial própria do usuário | Cotas e eventual cobrança ligadas ao projeto Google do usuário | A FAQ proíbe aproveitar o OAuth do Gemini CLI por software de terceiros. Uma assinatura pessoal não deve ser apresentada como forma de pagamento da API. | [FAQ do Gemini CLI](https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/faq.md), [Chaves da API](https://ai.google.dev/gemini-api/docs/api-key) |

## Requisitos dos adaptadores

- Guardar segredos somente no processo desktop, usando o armazenamento de credenciais do sistema operacional. Nunca colocá-los em IndexedDB, backups, logs ou código do frontend.
- Mostrar a origem da cobrança e as capacidades reais antes da primeira mensagem. Não simular retomada remota se a API não a oferecer; o app pode preservar e reenviar histórico de modo explícito.
- Para Claude Code, executar o binário publicado pela Anthropic, deixar a pessoa autenticar diretamente por `claude auth login` e não ler nem intermediar tokens ou arquivos da CLI. O processo fica restrito às ferramentas selecionadas no MainsAgents; a distribuição pública ainda depende dos termos comerciais aplicáveis.
- Validar novamente estes termos no lançamento público. Uso comercial, taxas e disponibilidade de modelos podem mudar.
- Para o Codex, expor diagnóstico de instalação, autenticação e limites usando os métodos oficiais do app-server. O endpoint de saúde atual verifica somente que o processo está ativo.
