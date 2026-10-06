# Tarefa 05 — Política de ações do Paper (2026-10-06)

## Mudanças
- `runtime-tool-policy.mjs`: `classifyMcpAction(tool, args, server?)` ganhou um terceiro argumento opcional e compatível com as chamadas antigas. O mapa `paperActions` só é usado quando `server` é exatamente `paper` (sem diferenciar maiúsculas). Para esse servidor, ferramenta fora do mapa vira `unknown` e nunca cai nas regras genéricas por nome, como `list_posts`, que é leitura no Zernio/Publora.
- `runtime-action-approvals.mjs`: o recibo passa `p.serverName` da própria solicitação de aprovação do Codex para a classificação (uma linha). A categoria continua gravada no payload com hash e é conferida de novo na decisão.
- `runtime-capabilities.mjs`: `paper` entra em `mentions` só com referência ao produto (`Paper Desktop`, `Paper MCP`, `paper.design`, `mcp__paper__`), não com a palavra comum "paper".

## Classificação do servidor `paper`
- **read**: `list_resources`, `get_basic_info`, `get_selection`, `get_node_info`, `get_children`, `get_tree_summary`, `get_screenshot`, `get_jsx`, `get_computed_styles`, `get_fill_image`, `find_nodes`, `get_tokens`, `get_font_family_info`, `get_guide`, `list_comment_threads`, `get_comment_thread`, `list_comment_thread_authors`.
- **write (conservador, contra o `readOnlyHint`)**:
  - `export` e `export_combined_pdf` gravam arquivos locais;
  - `open_file` muda o arquivo e a página abertos no Desktop;
  - `finish_working_on_nodes` altera o indicador de trabalho no documento.
- **write**: `write_html`, `create_file`, `create_page`, `create_artboard`, `create_tokens`, `set_tokens`, `set_text_content`, `set_comment_thread_status`, `update_styles`, `duplicate_nodes`, `move_nodes`, `rename_nodes`, `rename_pages`, `rename_resource`.
- **delete**: `delete_nodes`. Qualquer outro nome → `unknown`.

## O que não mudou
- Toda chamada continua exigindo aprovação, com os argumentos exatos e o hash. Leituras conhecidas do Paper ficam `pending` até a decisão; nada é aprovado automaticamente.
- Notion, Publora e Zernio mantêm as regras atuais (testadas com e sem servidor).
- `unknown` continua exigindo todas as permissões.
- O provedor Claude segue com MCP bloqueado (`claude-code-bridge.mjs` intocado).
- Limite: a identidade é o nome registrado na configuração do Codex. Um servidor diferente registrado como `paper` herdaria o mapa. O servidor real se identifica como `paper-desktop` no `initialize`, mas essa informação não chega na solicitação de aprovação.

## Validação
- Novos testes:
  - `tests/runtime-actions.test.mjs`: leituras do Paper ficam pendentes com categoria `read` e argumentos preservados para agente só-leitura; `get_screenshot`/`get_tokens` em outro servidor (ou sem servidor) → `unknown` e negados; exports, `open_file`, escritas, `delete_nodes` e ferramenta futura são negados; Notion, Zernio e Publora inalterados.
  - `tests/runtime-capabilities.test.mjs`: "Paper Desktop" e `mcp__paper__…` geram menção; "white paper" não gera.
- `node --experimental-strip-types --test` em claude-code-bridge, notion-automation, runtime-actions, runtime-capabilities e runtime-read-probe: 21/21 passaram.
- `npx tsc -b --pretty false`: exit 0.
- Nenhuma chamada ao Paper, escrita de configuração ou commit.
