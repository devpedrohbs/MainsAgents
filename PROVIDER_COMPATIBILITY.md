# Compatibilidade de provedores — 24/09/2026 (revisado em 07/10/2026)

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

## Estado verificado no código (07/10/2026)

| Capacidade | Codex | Claude Code | Evidência |
| --- | --- | --- | --- |
| Chat e retomada | sim, via app-server | sim, `claude -p` stream-json com `--session-id`/`--resume` | `claude-code-bridge.mjs`, `codex-bridge.mjs`; testes simulados |
| MCP | com aprovação por chamada | só pelo portão local (`--permission-prompt-tool`); sem portão, `mcp__*` negado | `tests/claude-mcp-approvals.test.mjs` |
| Modelos | do runtime | lista do app, `modelsVerified: false` | `claude-code-bridge.mjs` |
| Comparação | sim, par explícito no mesmo workspace | sim | [task-07-comparison-state](docs/analysis/task-07-comparison-state.md), [task-07-comparison-ui](docs/analysis/task-07-comparison-ui.md) |

- Escolha de provedor/modelo antes de cada execução e consulta a ambos com o mesmo agente (D13) estão entregues para **chat e ideias**, validadas localmente com endpoints simulados: nova conversa sem envio, revisão antes de duas consultas, conversas antigas preservadas, padrão explícito por provedor, resposta escolhida só vira rascunho e o modo legado de dois agentes continua. A geração editorial persistente e a produção semiautomática continuam somente Codex; não há equivalência de ferramentas entre os provedores.
- Testes usam CLIs e endpoints simulados. Nenhuma execução real autenticada ou paga foi comprovada para esta revisão.
- Claude: o uso do binário oficial, sem modificação, é descrito no [modo headless](https://code.claude.com/docs/en/headless); termos e distribuição em [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance). Este projeto não coleta nem lê OAuth; não afirmamos proibição absoluta de executar o binário intacto, apenas que a distribuição pública deve conferir os termos vigentes.
