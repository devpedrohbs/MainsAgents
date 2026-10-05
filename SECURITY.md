# Segurança

Para comunicar uma vulnerabilidade, use **Security → Report a vulnerability** no repositório GitHub, se o mantenedor habilitou o recurso. Se não estiver disponível, peça um canal privado ao mantenedor por uma issue sem detalhes de exploração, credenciais ou dados pessoais. Não publique tokens ou bancos de histórico em uma issue.

## Limites atuais

O desktop inicia CLIs e ferramentas locais com as permissões do usuário. Skills são instruções; instalar uma skill não garante que seu conteúdo seja confiável. Revise a origem e os comandos solicitados.

Os chats Codex do desktop têm aprovação por chamada de servidor MCP configurado e permissões por categoria no agente. Ferramentas desconhecidas são bloqueadas quando categorias de escrita estão restritas; a classificação de nomes/contratos não certifica efeitos de código externo. Claude usa autenticação normal da CLI, com ferramentas de leitura/pesquisa, hooks/plugins de usuário desativados e MCP/escrita bloqueados. Esse mecanismo não é uma garantia universal para todos os provedores, plugins ou comandos de terminal. O terminal do Canvas executa comandos que o usuário envia explicitamente.

O serviço editorial do Notion exige uma decisão vinculada à versão e ao destino. Planejamento local e aprovação de uma entrega por rede não executam publicação. O adaptador nativo do Publora ainda está pendente.

O executor de vídeo usa FFmpeg/ffprobe pelo PATH, argumentos definidos pelo app e novos arquivos de saída. Ele não executa scripts de edição arbitrários, não sobrescreve a mídia original e não controla janelas. Use instalações confiáveis e atualizadas do FFmpeg.

O histórico é local, em SQLite no desktop e IndexedDB no modo web. Backups contêm conversas, instruções, referências e caminhos de arquivos: trate-os como dados pessoais. Eles não copiam vídeos externos nem autorizam reproduzir trabalhos importados.

Não exponha os serviços localhost em uma interface de rede pública. O modo web não deve ser tratado como serviço multiusuário hospedado.
