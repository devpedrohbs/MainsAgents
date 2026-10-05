# Calendário Publora / Zernio — 0.3.40

No Estúdio → Calendário de entregas, a seção **Posts dos provedores** permite escolher Publora ou Zernio, consultar contas, marcar as contas deste workspace e atualizar agendamentos. A navegação de mês e o fuso também se aplicam aos posts externos. Em telas estreitas, o calendário vira agenda. Clicar em um post abre texto, conta, ID, estado e instante da consulta.

## Conexão

Usa os MCPs já autenticados no Codex CLI, com nomes de servidor `publora` e `zernio`. Não exige chave API dentro do frontend nem cria um turno de IA para sincronizar. Cada clique autoriza somente a consulta específica; não há publicação, upload ou reagendamento nesse fluxo.

- Publora: `list_connections` e `list_posts` com resposta detalhada e paginação.
- Zernio: ferramentas geradas **`accounts_list_accounts`** e **`posts_list_posts`**, que expõem JSON e paginação da API. As ferramentas básicas retornam texto formatado e não são usadas como fallback silencioso.

Se o servidor não disponibilizar essa ferramenta, se o OAuth estiver vencido ou se a resposta contiver apenas prosa em vez de JSON verificável, a consulta falha e mantém o último snapshot. Em 05/10/2026 a consulta real Publora verificou duas conexões e zero posts, sem escrita. O Zernio retornou texto formatado mesmo nas ferramentas geradas, insuficiente para montar o calendário. O catálogo público Zernio também respondeu HTTP 401, apesar da documentação anunciar acesso sem credencial; não extraímos tokens nem alteramos a configuração para contornar isso.

### Alternativa API Zernio no desktop

Ao selecionar Zernio, abra **Alternativa por API do Zernio** e cadastre a chave no campo de senha. O host valida seu formato, criptografa com Electron `safeStorage` (proteção do Windows) e grava no SQLite permanente, separado por perfil. Não há fallback em texto puro, leitura da chave pelo renderer ou exportação em backup JSON. O campo é limpo após salvar. Não envie a chave pelo chat.

Com chave cadastrada, a consulta usa somente `GET https://zernio.com/api/v1/accounts` e `GET https://zernio.com/api/v1/posts`, com paginação, timeout e redirects recusados. Não envia prompts nem publica conteúdo. Remover a chave volta ao MCP. Essa alternativa foi validada com HTTP simulado; a validação real da API depende do usuário cadastrar sua chave. O backup físico conserva o segredo criptografado, mas outro computador precisa cadastrá-lo novamente.

## Persistência e limites

- Cache SQLite por perfil, workspace e provedor. Não sobrescreve agentes, mensagens, conteúdo local ou aprovações.
- As contas são escolhidas explicitamente. Posts de contas não escolhidas não entram na consulta daquele workspace.
- Consulta até 20 páginas de 100 posts, com limite total de 8 MB. Uma consulta limitada é sinalizada e não elimina registros antigos que possam ter ficado fora das páginas.
- Consulta completa substitui o snapshot desse provedor, refletindo posts removidos. Falha conserva o snapshot e sinaliza desatualização; cada item conserva a data em que foi visto.
- Horários devem conter UTC ou offset; horário ambíguo é recusado. Um registro externo não aprova uma entrega editorial local.
- Atualização manual; sem polling dos provedores, daemon, webhooks ou edição nativa de posts importados. Alterações continuam no site do provedor.
- O backup físico do SQLite inclui o cache. O backup JSON de workspace não exporta esse cache derivado: consulte novamente as contas após importar em outra instalação.

## Validação

Testes isolados cobrem paginação, limites, resposta inválida, diferenças por conta/rede, falha de conexão, concorrência, mudança de perfil, preservação e reinício. O teste Electron verifica seleção de conta, consulta explícita, detalhe do post, aviso de dados anteriores e layout compacto. Nenhum post pessoal foi criado ou agendado durante os testes.

Contratos oficiais: [Publora MCP](https://docs.publora.com/mcp/tools-reference), [Zernio MCP](https://docs.zernio.com/mcp/tools), [lista paginada Zernio](https://docs.zernio.com/posts/list-posts).

## Próxima prioridade

1. Completar envio de mídia e publicação Instagram/TikTok pelo Zernio, com autorização exata e verificação após envio.
2. Edição/reagendamento nativos com nova autorização e proteção contra duplicação.
3. Validar o fluxo real de conteúdo aprovado até agendamento, em contas escolhidas pelo usuário.
4. Rotinas/segundo plano (AUTO-16), memória (AUTO-17), projetos (AUTO-18), radar (AUTO-19) e desempenho (AUTO-20), nessa ordem.

FFmpeg e novas funções de edição de vídeo ficam adiados por decisão do usuário. A alternativa API está pronta para receber a credencial pelo armazenamento seguro do aplicativo, nunca por mensagens.
