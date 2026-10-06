# Integração Paper ↔ MainsAgents — auditoria prática (2026-10-06)

Escopo: disponibilidade do Paper Desktop/MCP no Claude Code e no Codex e o que o MainsAgents já suporta. Auditoria somente leitura. Nenhum arquivo de autenticação foi lido e nenhum documento do Paper foi alterado.
Modelo Claude desta auditoria: `claude-opus-5-5` (Opus 5.5). Evidências: o identificador do modelo informado pelo ambiente da sessão e o comando `/model` executado nesta sessão ("Set model to Opus 5.5").

## 1. Evidências: instalado, configurado, conectado e utilizável

| Camada | Estado | Evidência |
| --- | --- | --- |
| CLI do Paper instalada | ✅ | `C:/Users/pacas/.paper/bin/paper.exe` (6,4 MB, 2026-10-01); `paper --version` → `paper 0.0.1` |
| Paper Desktop instalado e aberto | ✅ | `%LOCALAPPDATA%/Programs/Paper`; vários processos `Paper.exe` ativos; `127.0.0.1:29979` em LISTENING (PID 7108), que é o endpoint HTTP legado da documentação |
| Configurado no Claude Code (2.1.291) | ✅ | `claude mcp list` → `paper: C:/Users/pacas/.paper/bin/paper mcp - ✔ Connected` (stdio, conforme https://paper.design/docs/mcp) |
| Configurado no Codex (codex-cli 0.160.1) | ✅ | `codex mcp list` → `paper  C:/Users/pacas/.paper/bin/paper  mcp  enabled  Auth: Unsupported` (normal para stdio, sem OAuth) |
| Conectado (handshake MCP) | ✅ | `initialize` e `tools/list` read-only por stdio → `serverInfo {"name":"paper-desktop","version":"0.0.1"}` e 37 ferramentas |
| Utilizável (leitura real) | ✅ parcial | `list_resources` → `isError:false`, retornou `teamId`/`teamName` e recursos. `get_basic_info` → `"Open a Paper file to use this tool."`, porque nenhum arquivo estava aberto |
| Disponível nesta sessão do Claude Code | ❌ | As ferramentas `mcp__paper__*` não carregaram nesta sessão (provavelmente o MCP foi adicionado depois que ela começou). A documentação recomenda reiniciar a sessão do agente |
| Disponível via MainsAgents (provedor Claude) | ❌ bloqueado de propósito | `claude-code-bridge.mjs:163-170` grava `mainsagents-runtime-mcp.json` com `{mcpServers:{}}` e usa `--strict-mcp-config` e `--disallowedTools mcp__*`, além de desativar todos os plugins |
| Disponível via MainsAgents (provedor Codex) | ⚠️ não verificado | `runtime-capabilities.mjs` → `summarizeMcp` lista `paper` a partir de `config.mcp_servers`, com aprovação `each-call`. Nenhuma chamada real ao Paper pelo chat do app foi testada |

Ferramentas do Paper, conforme as anotações do próprio servidor:
- **Leitura** (`readOnlyHint`): `list_resources`, `open_file`, `get_basic_info`, `get_selection`, `get_node_info`, `get_children`, `get_tree_summary`, `get_screenshot`, `get_jsx`, `get_computed_styles`, `get_fill_image`, `find_nodes`, `get_tokens`, `get_font_family_info`, `get_guide`, comentários (`list_comment_threads`, `get_comment_thread`, `list_comment_thread_authors`), `finish_working_on_nodes`, `export` e `export_combined_pdf`.
- **Escrita/destrutivas**: `create_file`, `create_page`, `create_artboard`, `write_html`, `set_text_content`, `update_styles`, `duplicate_nodes`, `move_nodes`, `rename_*`, `create_tokens`, `set_tokens`, `set_comment_thread_status` e `delete_nodes` (`consequentialHint`). Observação: `export` está marcado como leitura, mas grava arquivos em disco; para o app, deve ser tratado como escrita.

## 2. O que o MainsAgents já suporta

- **Diagnóstico** (`runtime-capabilities.mjs`): descobre servidores MCP do Codex (`mcpServerStatus/list`), declara requisitos por skill (bloco ```` ```mainsagents-requirements ````) e marca `unsupported-provider` quando a skill exige MCP e o agente não usa Codex. A heurística `mentions` cobre `notion|apify|publora|zernio|ffmpeg`, mas **não inclui `paper`**.
- **Política** (`runtime-tool-policy.mjs`): `classifyMcpAction` conhece Notion, Zernio e Publora. Com os nomes do Paper:
  - `get_*`, `list_resources`, `find_nodes`, `export`, `open_file` e `write_html` caem em **`unknown`**;
  - `create_*`, `update_styles`, `set_*` e `rename_*` caem em `write`;
  - `delete_nodes` cai em `delete`.
  Pela regra de `permittedMcpAction`, `unknown` só é liberado quando o agente tem todas as permissões. Na prática, um agente "só leitura" não consegue nem ler do Paper.
- **Template** (`src/features/agents/agentTemplates.ts`): o "Criador de carrosséis" já manda verificar as capacidades do Paper e, se faltarem, entregar uma especificação de layout editável. Ou seja, o fallback já existe.
- **Protocolo editorial** (`editorial-protocol.mjs`): `validateScriptOptions` já devolve `thumbnailDirection`, mas nada o liga ao Paper.

## 3. Bloqueios restantes

1. Ferramentas de leitura do Paper são classificadas como `unknown`, então agentes com permissão só de leitura ficam bloqueados.
2. O provedor Claude no MainsAgents bloqueia todo MCP. Isso é uma decisão de segurança; não é um bug, e não deve ser alterado sem uma política própria.
3. O diagnóstico não reconhece `paper` nas menções de skills.
4. Falta uma evidência de leitura do Paper pelo chat Codex do app (`readVerified:false`). Para isso, um arquivo do Paper precisa estar aberto no Desktop.
5. Os limites de MCP por plano do Paper não estão documentados ("After upgrading MCP limits aren't reset"). Sessões longas também perdem a conexão, segundo a documentação; o app deve orientar a reiniciar a sessão.

## 4. Menor próxima tarefa, pronta para implementar

**Classificar as ferramentas do Paper na política e no diagnóstico de runtime.**

- Arquivos:
  - `runtime-tool-policy.mjs`: adicionar a lista de leitura do Paper (`list_resources`, `open_file`, `get_basic_info`, `get_selection`, `get_node_info`, `get_children`, `get_tree_summary`, `get_screenshot`, `get_jsx`, `get_computed_styles`, `get_fill_image`, `find_nodes`, `get_tokens`, `get_font_family_info`, `get_guide`, `list_comment_threads`, `get_comment_thread`, `list_comment_thread_authors`, `finish_working_on_nodes`) → `read`. Também mapear `write_html` e `export`/`export_combined_pdf` → `write`, e `delete_nodes` → `delete`.
  - `runtime-capabilities.mjs`: incluir `paper` na regex de `mentions`.
  - `tests/runtime-actions.test.mjs`: novos casos para essas regras.
- Aceite:
  - (a) `classifyMcpAction('get_screenshot')==='read'`, `('write_html')==='write'`, `('export')==='write'`, `('delete_nodes')==='delete'`, `('create_artboard')==='write'`;
  - (b) `permittedMcpAction({mcpPermissions:['read']},'read')` libera as leituras do Paper e continua negando `write_html`;
  - (c) uma skill que cita "Paper" mostra `paper` em `mentions`;
  - (d) `npm test` e `npm run typecheck` passam; (e) sem mudanças no `claude-code-bridge.mjs` nem em configurações do usuário; habilitar MCP no provedor Claude e escrever no Paper ficam fora do escopo.

## 5. Outras melhorias práticas de automação de conteúdo (no máximo duas)

1. **Capa no Paper a partir da `thumbnailDirection`**: no passo de capas da produção semiautomática, o agente Codex de carrossel usa `create_artboard` e `write_html` com o roteiro aprovado. Depois exporta com `export`, que exige aprovação `write`, e anexa o PNG à publicação. O fallback é a especificação de layout que o template já pede.
2. **Revisão via comentários do Paper**: ler `list_comment_threads` e `get_comment_thread`, que são só leitura, e transformar os comentários abertos em itens no Editorial Inbox. Isso fecha o ciclo de aprovação humana sem escrever no Paper.
