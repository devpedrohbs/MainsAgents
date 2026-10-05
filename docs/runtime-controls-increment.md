# Runtime e colaboração — 0.3.36

## Aprovar ferramentas no chat

Os chats Codex do desktop aplicam uma política própria ao iniciar e retomar threads. Cada ferramenta de um servidor MCP configurado exige confirmação, inclusive leituras nesta primeira versão. Configurações anteriores de aprovação automática da CLI são sobrescritas somente naquela conversa; o arquivo de configuração e a conta da CLI não mudam.

O cartão mostra servidor, ferramenta e argumentos exatos. **Aprovar uma vez** responde ao pedido oficial `mcpServer/elicitation/request`; **Recusar** impede a chamada. A aprovação não é o recibo da operação: os estados distinguem aguardando, aprovada, executando, execução confirmada, falha e resultado não confirmado. Decisões ficam no SQLite e em **Configurações → Conexões de IA → Histórico de aprovações do chat**.

Dados alterados, agente/perfil diferente, decisão repetida, segredo solicitado ou pedido de formulário desconhecido são recusados. Fechar/reconectar interrompe as confirmações anteriores; backup guarda o histórico e nunca concede autorização de execução. Uma operação externa já iniciada pode ter ocorrido mesmo se a conexão cair: confira o destino antes de repeti-la. Não há reenvio automático de escritas incertas.

Conectores de apps/plugins ficam desativados nestas threads porque esta versão ainda não oferece revisão equivalente para todos os seus formatos. Use servidores MCP configurados na CLI. Claude permanece com ferramentas de leitura e MCP desativado; este incremento não habilita escritas por Claude. O conector editorial nativo do Notion mantém sua própria aprovação da versão e do destino.

## Agentes trabalhando juntos

Chamadas automáticas de `mainsagents_delegate` no chat principal, flutuante ou Canvas do desktop são executadas pelo serviço Node, com briefing, sessão do especialista, progresso e resposta parcial persistidos no SQLite. O frontend acompanha o trabalho e apresenta os dois chats existentes; **Criar Canvas** reutiliza essas sessões e a ligação entre elas.

A configuração do receptor é a dele, incluindo instruções e arquivos das skills habilitadas. A conexão continua na mesma sessão, inclusive quando duas chamadas chegam antes de a interface atualizar. Outra sessão pode ser solicitada explicitamente. Há limites de profundidade, ciclos, quatro chamadas por resposta de origem, uma execução por nível e até três tentativas. Arquivos ausentes, configuração alterada, outro workspace ou perfil bloqueiam a execução. O Editor de Vídeo não ganha controle do computador nem ferramentas de edição inexistentes.

Trocar de tela ou recarregar o frontend não interrompe o serviço. Fechar o aplicativo interrompe o trabalho e salva a recuperação; não existe execução com o desktop desligado. **Recuperar trabalho** consulta a thread salva; um turno concluído é recuperado sem nova geração. Se o resultado for incerto, outro envio exige a confirmação específica mostrada no cartão. Uma resposta recuperada permanece na sessão do especialista; o pedido antigo da CLI do agente de origem não é automaticamente reaberto depois de reiniciar o processo.

O recorte implementado é Codex → Codex. O envio manual antigo entre agentes e outros provedores ainda não migrou integralmente para esta fila. Não foi implementada edição de vídeo real, publicação automática, nem daemon de tarefas.

## Diagnóstico de capacidades

Em **Configurações → Conexões de IA → Verificar capacidades**, o app consulta autenticação, modelos disponíveis, catálogo e estados MCP e lê somente skills associadas aos agentes. Mostra diferenças entre login pendente, servidor desativado, descoberta falha, catálogo vazio e ferramenta encontrada. Arquivos de skills ausentes, ilegíveis ou desativados aparecem separados. Menções a Notion/Apify/Publora/FFmpeg são indicadas como menções, sem inferir dependências comprovadas.

A verificação não inicia um turno de IA e não executa uma ferramenta de negócio. Descobrir um servidor não prova acesso real à sua base ou conta; esse teste deve ser solicitado no chat e passa pela aprovação por chamada. O diagnóstico completo de requisitos declarados, Claude e execução de provas específicas de leitura continua no backlog.

## Validação

- CLI instalada com modelo Responses e servidor MCP locais determinísticos: configuração anterior automática, zero chamadas antes da decisão/ após recusa, uma chamada aprovada, hash alterado e segunda aprovação bloqueados. Sem consumo de tokens de conta.
- Transporte CLI fictício: agente de origem aguarda o especialista no serviço local, pedido MCP do receptor é revisado, resultados dos dois chats persistem sem qualquer assinante React.
- Testes de configuração, ciclos, cancelamento, reabertura, recuperação de turno concluído e preservação das escolhas locais.
- Electron oculto com perfil isolado: payload exato, recibo confirmado, dois chats conectados no Canvas, composer fixo a 880 px, diagnóstico, temas claro/escuro e reabertura sem duplicação.

Contrato oficial utilizado: [App Server](https://learn.chatgpt.com/docs/app-server) e [configuração](https://learn.chatgpt.com/docs/config-file/config-reference).

## Verificação da entrega em 04/10/2026

144 testes passaram; build e oito scripts visuais isolados passaram. Instalador 0.3.36 instalado e ASAR comparado byte a byte ao pacote. Banco pessoal comparado ao backup consistente: três agentes (16/3/12 skills), oito sessões e 53 mensagens preservados, integridade SQLite `ok`. Nenhuma inferência paga, publicação ou alteração em serviço pessoal foi usada como teste.
