# Publicação integrada — 0.3.39

Prioridade desta rodada: AUTO-15, completando a passagem de uma entrega local aprovada para um destino externo verificável. AUTO-16–20 continuam para rodadas posteriores.

## Fluxo disponível

No Estúdio, abra a entrega LinkedIn de um conteúdo, revise o texto e aprove a versão. Na seção Publora:

1. **Consultar contas do Publora** faz uma leitura explícita das conexões LinkedIn ativas. Não envia o conteúdo.
2. Selecione a conta e escolha **Rascunho no Publora** ou **Agendar no horário planejado**. Agendamentos precisam estar pelo menos dois minutos no futuro.
3. **Conferir envio** salva a prévia da conta, versão, texto e horário. Ela expira em dez minutos; ainda não faz uma escrita externa.
4. **Autorizar criação do rascunho / Autorizar agendamento** envia aquela versão. O serviço salva a intenção no SQLite antes de chamar o MCP e usa uma chave de idempotência.
5. O app consulta o grupo de post e confere conta, texto, ausência de mídia, horário e estado por destino. A resposta da criação sozinha não confirma publicação. Um rascunho externo não aparece como agendamento confirmado no calendário.
6. **Consultar resultado no Publora** reconcilia o mesmo identificador sem criar outro post. Se a resposta da criação foi perdida antes de obter um identificador, encontre o grupo no Publora e informe o ID para uma consulta; o app não repete a criação.
7. **Cancelar agendamento** apresenta uma autorização separada. O serviço verifica o post e solicita sua conversão em rascunho, preservando o identificador. Só confirma o cancelamento após consultar o estado draft. Uma falha exige consulta; não repete automaticamente a escrita.

O Publora pode executar a publicação agendada enquanto o MainsAgents estiver fechado. O MainsAgents não tem rotina de consulta em segundo plano nem daemon: o usuário consulta o resultado no app. Uma consulta falha ou divergência externa retira a confirmação atual da interface, mantém o último recibo e bloqueia novas escritas dessa entrega.

## Conexão e proteção dos dados

Usa o servidor MCP chamado `publora`, já autenticado no Codex CLI. Nenhuma chave precisa ser copiada para o frontend. As chamadas usam um contexto efêmero com apenas esse servidor e ferramentas delimitadas; não iniciam turno de modelo nem usam uma conversa de agente para executar a publicação. A autorização vem dos botões nativos do usuário, separada da aprovação editorial.

Estado, prévia, identificador e recibos ficam no SQLite editorial permanente e no backup editorial. Autorizações de escrita dependem também de uma intenção nativa de uso único; um backup em outra instalação não cria essa concessão nem executa posts automaticamente. Restaurar um backup não pode apagar uma operação em andamento ou substituir o histórico de um resultado ainda incerto. Uma operação interrompida no reinício fica incerta e exige consulta, sem reenvio. O serviço recusa modificações de operações/recibos através de salvamentos genéricos do frontend. Enquanto uma entrega tiver operação externa submetida, ela não pode ser editada localmente; edição/reagendamento externos exigem incremento próprio.

Referência do contrato: [Publora MCP tools](https://docs.publora.com/mcp/tools-reference), incluindo `list_connections`, `create_post`, `get_post`, `update_post` e `idempotencyKey`.

## Validação e limites

182 testes automatizados aprovados, incluindo autorização exata/expirada, conta indisponível, concorrência, prévia restaurada/usada, perda de resposta, reinício, vinculação manual, divergência, cancelamento e reconciliação sem duplicação. O teste Electron usa contas/posts simulados e verifica seleção, prévia, autorização, estado confirmado, consulta e reinício em janela oculta. Teste de preservação com o app.asar 0.3.39 também aprovado em perfil sintético da versão anterior. Sem login em contas pessoais, postagem real, upload ou inferência paga durante o desenvolvimento.

AUTO-15 permanece **parcial**. Faltam Zernio para Instagram/TikTok, envio de mídia, requisitos próprios de cada rede, edição/reagendamento nativos e validação real autorizada com uma conta de teste. Claude/MCP, rotinas, memória, modelos de projeto, radar e benchmark não foram implementados nesta rodada. Não publicar ou agendar em contas pessoais apenas para testar.
