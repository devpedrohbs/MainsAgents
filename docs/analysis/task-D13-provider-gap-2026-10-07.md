# D13 — Lacunas reais para escolher Codex ou Claude e receber duas respostas (07/10/2026)

Pesquisa somente leitura. Nenhum adaptador foi alterado, nenhum OAuth/token foi lido e não houve chamada paga. Os fatos sobre provedores vêm das docs oficiais consultadas em 07/10/2026:

- Claude Code: [CLI reference](https://code.claude.com/docs/en/cli-reference), [model config](https://code.claude.com/docs/en/model-config), [headless](https://code.claude.com/docs/en/headless), [legal and compliance](https://code.claude.com/docs/en/legal-and-compliance).
- Codex: [app-server](https://learn.chatgpt.com/docs/app-server). O endereço developers.openai.com/codex/app-server redireciona para esse.

## O que já existe (código)

| Área | Codex | Claude Code | Onde |
| --- | --- | --- | --- |
| Conexão/login | app-server; `account/read` no diagnóstico | `claude auth status` (JSON), login feito pela pessoa com `claude auth login` | `runtime-capabilities.mjs`, `claude-code-bridge.mjs:187` |
| Modelos | `model/list` do runtime | lista fixa `sonnet`/`opus`/`haiku`, com `modelsVerified:false` | `claude-code-bridge.mjs:15` |
| Chat, streaming, cancelamento | sim | sim: `-p --output-format stream-json`, encerra o processo filho | `ClaudeCliProvider.ts`, `claude-code-bridge.mjs` |
| Retomada | `thread/resume`, `thread/read` | `--session-id` no primeiro envio, depois `--resume` | idem |
| Reconciliação após queda | `thread/read` + `matchingWorkflowTurn` | **ausente**: `readThread` lança erro | `claude-code-bridge.mjs:379` |
| MCP/aprovações | aprovação por chamada | portão local (`--permission-prompt-tool`); sem portão, `mcp__*` é negado | `claude-mcp-approvals` |
| Consulta a ambos | `agentComparison.ts`: mesmo briefing para um agente Codex e um agente Claude **distintos**, com sessões independentes e `Promise.allSettled` | | `docs/analysis/task-07-comparison-state.md` |
| Geração editorial persistente | sim | **bloqueada**: "requires a Codex agent" | `editorial-workflow-queue.mjs:36` |
| Produção semiautomática | sim (roteiro, plano, legendas, capa nativa) | **bloqueada**: o preflight D02 mostra o motivo por etapa | `production-coordinator.mjs`, `production-preflight.mjs` |

## Lacunas reais, da maior para a menor

1. **O provedor fica fixo no agente, não na execução.** `providerId` e `modelId` são campos do agente. Para comparar, hoje a pessoa precisa de dois agentes, um Codex e um Claude, com instruções e skills duplicadas. Falta escolher “gerar com Codex / Claude / ambos” para o mesmo agente na hora de iniciar, sem copiar o agente. A sessão existente já guarda o próprio `providerId` (`ChatProvider.tsx:188`), então “sessão mantém o provedor original” já está garantido.
2. **A geração editorial só aceita Codex** (`editorial-workflow-queue.mjs:36`). A fila depende de `readThread` para recuperar um turno incerto sem reenviar. O Claude CLI não oferece leitura de turno equivalente no runtime atual. Em modo `-p`, a transcrição fica em `.jsonl` local ([CLI reference](https://code.claude.com/docs/en/cli-reference), em `--resume`), mas o app não deve ler arquivos da CLI sem decisão explícita. Consequência: para Claude, uma execução incerta exige confirmação manual de reenvio. É o mesmo comportamento que `native-agent-delegations.mjs:86` já adota, e precisa ser declarado, não mascarado.
3. **Não há resposta dupla na geração editorial.** A comparação existe só no chat. Na pesquisa e no roteiro, cada execução grava um único artefato. Faltam artefatos irmãos identificados pelo provedor, com seleção que só prepara o rascunho.
4. **A lista de modelos Claude está defasada.** As docs oficiais listam os aliases `default`, `best`, `fable`, `sonnet`, `opus`, `haiku`, `sonnet[1m]`, `opus[1m]` e `opusplan`, e a resolução depende do provedor e do plano. Não existe comando documentado para listar os modelos da conta. O status correto é “aliases do provedor, não verificados”. A lista atual omite `default` e `fable`. `fable` pode cobrar créditos de uso, o que exige aviso.
5. **Esforço.** A ponte passa `CLAUDE_CODE_EFFORT_LEVEL` só para `low|medium|high|xhigh`. As docs aceitam também `max`, que depende do modelo, e a variável de ambiente tem precedência sobre `--effort`. Hoje, `max` cai silenciosamente para o padrão do modelo.
6. **As capacidades são declaradas no cliente.** `ClaudeCliProvider.getStatus` fixa `webSearch:true` e as ferramentas, mesmo em estado de erro. Falta derivar essas capacidades do servidor e marcar explicitamente o que não existe: imagem nativa (as capas da produção dependem de `image_gen` do Codex) e reconciliação.
7. **Autenticação.** As docs dizem que `claude auth status` sai com código 0 se logado e 1 se não, e expõe `authMethod`. A ponte interpreta o JSON. Usar o código de saída e `authMethod` evitaria falso “conectado”. Observação: a ponte lê `~/.claude/settings.json` só para desligar plugins, não credenciais. Manter assim.
8. **Termos.** As docs permitem executar o binário intacto com o login da própria pessoa. Proíbem oferecer login Claude.ai no app ou intermediar tokens e credenciais. O desenho atual cumpre isso. A distribuição pública ainda depende de conferir os Commercial Terms.

## Próxima implementação delimitada (proposta, uma onda)

**“Gerar com: Codex | Claude | Ambos” somente no chat de ideias/pesquisa**, sem mudar produção nem adaptadores de runtime:

1. Puro: `providerChoice` em `agentComparison.ts` para executar o mesmo agente (instruções e skills) com `providerId`/`modelId` escolhidos por envio, criando sessões novas. Uma sessão existente nunca troca de provedor.
2. “Ambos” reutiliza `createComparisonLauncher` com um agente de origem e dois provedores, com respostas identificadas e independentes. A falha de um não apaga o outro.
3. A ponte expõe `capabilities` reais por provedor: `reconcile:false`, `imageGeneration:false` para Claude, modelos como aliases não verificados, com `default`/`fable` e aviso de créditos.
4. A seleção de uma resposta só usa o fluxo existente `captureChatDelivery`, que prepara o rascunho. Nenhuma execução adicional.
5. Testes com provedores simulados: isolamento, cancelamento de um lado, falha de um lado, reabertura sem reenvio e `max` de esforço.

Fica fora desta onda: geração editorial persistente e produção com Claude. Exigem decidir a política de reconciliação sem `readThread`. A produção também precisa de capa sem `image_gen`.
