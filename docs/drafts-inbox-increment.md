# Retomada do trabalho — 0.3.32

Esta rodada entrega AUTO-09 para os chats e uma primeira parte de AUTO-07, mantendo o visual aprovado. Não executa geração de IA nem publicação automaticamente.

## Rascunhos de chat

Texto não enviado, skill selecionada e referências de contexto ficam em `chat-drafts`, no estado persistente do perfil. No desktop isso usa SQLite; no navegador, IndexedDB. A identidade combina agente e sessão sem colisões por separadores. Rascunhos de conversa nova são transferidos quando a sessão é criada. O chat principal, flutuante e o chat do Canvas compartilham a mesma fonte para a mesma sessão.

Editar usa a barreira de salvamento existente. O envio limpa somente o rascunho correspondente; outra sessão permanece intacta. Excluir a sessão ou o agente limpa seus rascunhos. O exportador inclui e valida os rascunhos; merge preserva a edição local quando o mesmo rascunho existe nos dois backups. Backups antigos continuam válidos. Rascunhos voláteis ainda presentes na janela antiga são migrados ao abrir a conversa.

Contexto é guardado como vínculo ao workspace/node, sem congelar uma cópia do conteúdo. Ao abrir, o app resolve o objeto atual no workspace do agente. Um objeto removido aparece como contexto indisponível e não é enviado; no chat principal é possível remover essas referências. Não há acesso a dados de autenticação ou armazenamento de credenciais pelo módulo.

Este incremento não torna persistentes os formulários de criação de agentes/tarefas ou a edição ainda não aprovada no Estúdio. Esses formulários precisam de tratamento próprio.

## Home com próximos passos

A seção mostra pesquisa a iniciar, pesquisa para decidir, roteiro a preparar/revisar, revisão de produção e erros do fluxo, incluindo envio ao Notion. Bloqueios aparecem antes das revisões. Cada item abre sua pauta/conteúdo no Estúdio, onde a sessão, versões e recuperação já existem. A lista usa registros atuais, não uma fila duplicada de aprovações.

O workspace limita os itens. Versões antigas de pesquisa e falhas de envio de uma versão substituída não viram pendências atuais. Ao decidir a pauta ou aprovar o roteiro, a pendência deixa a lista. Falha ao consultar a fila não aparece como sucesso ou uma caixa vazia: há aviso e as pendências locais continuam acessíveis. A interface tem PT-BR/EN-US, teclado e layout compacto nos dois temas.

AUTO-07 permanece parcial: entregas não vistas, notificações nativas, silenciamento e uma Inbox abrangendo todos os chats ainda não foram implementados. As ações na Home abrem revisão; não aprovam/publicam por conta própria.

## Validação

- 97 testes automatizados e build TypeScript/Vite.
- `scripts/test-drafts-inbox-ui.mjs`: Electron oculto com preload de produção e SQLite isolado; testa encerramento imediato após editar, reabertura, skill/contexto, referência removida, outra sessão/perfil, rascunho compartilhado com Canvas, pauta correta, decisão removida e erro da fila visível. Capturas dos temas claro e escuro compacto.
- Regressões de chat, fluxo editorial e persistência desktop.
- Nenhuma chamada real de inferência, criação de card Notion ou publicação nos testes.
