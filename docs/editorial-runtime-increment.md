# Incremento editorial — 0.3.31

Registro histórico deste primeiro incremento. Pesquisa/roteiro e a transferência manual já migraram para a fila na 0.3.34; consulte [o estado atual](persistent-editorial-work-increment.md) e [o backlog atualizado](analysis/mainsagents-automation-backlog-2026-10-02.md).

O primeiro recorte torna persistentes a revisão e o envio nativo de roteiro aprovado ao Notion. Ele preserva a interface existente e usa a autenticação do Codex CLI já configurado.

## Fluxo implementado

1. Pesquisa e roteiro continuam na implementação existente. As novas sessões guardam `topicId` e, no roteiro, `contentId`.
2. No Estúdio, o usuário revisa o texto, o ID do data source e a opção de envio. O botão descreve quando também enviará ao Notion.
3. Aprovação, versão imutável e trabalho da fila entram na mesma transação SQLite. A chave única impede dois trabalhos para a mesma versão/destino.
4. O serviço Node abre uma thread efêmera do App Server e chama ferramentas MCP oficiais diretamente, sem executar um turno de IA para preencher o card.
5. O adaptador consulta a sintaxe e a estrutura da base, valida título/Status/Channel e procura a identidade do conteúdo. Uma criação registra intenção antes da chamada e ID retornado antes de continuar.
6. Uma nova versão é acrescentada ao card encontrado. Notas manuais e propriedades existentes ficam preservadas. A leitura final confere destino, identidade, marcadores e texto aprovado antes de gerar o recibo.
7. Falha fica visível com ação de verificar/tentar novamente. Se a criação teve resultado desconhecido, o adaptador procura o card e não cria outro automaticamente. Um trabalho em andamento interrompido pode retomar a verificação depois da reabertura.

## Persistência e restauração

No desktop, principal e editorial compartilham `%USERPROFILE%\.mainsagents\storage\workspace-state.sqlite`. `desktop-editorial-storage.mjs` lê o WAL legado, valida a integridade, grava uma cópia de recuperação e migra apenas uma vez. Exclusões posteriores não são revertidas por um banco antigo.

`EditorialStateClient` serializa alterações e decisões, mantém mudanças falhas em memória, reconcilia uma resposta perdida sem repetir a aprovação e participa de `SaveCoordinator`. O fechamento normal aguarda todos os módulos e não apresenta sucesso se a gravação falhar.

O backup desktop inclui estado principal, editorial, imagens e registros de execução/conexão em um snapshot. A restauração verifica revisões e faz rollback de todos os módulos se qualquer etapa falhar. Trabalhos pendentes não podem estar executando durante a restauração. Trabalhos importados exigem tentativa explícita; destinos importados começam desligados. A prévia verifica vínculos de skills locais. O JSON contém os caminhos, não arquivos externos ou vídeos. Credenciais de CLI/MCP não entram nesse exportador.

No navegador, o estado principal usa IndexedDB e o editorial usa o serviço Node. Um diário persistente permite desfazer ou concluir uma restauração interrompida antes de abrir o workspace para edição. A exportação web não inclui ainda os trabalhos do serviço Node.

## Validação

- `npm test`: 94 testes, incluindo integridade, WAL, conflito de revisão, falhas intermediárias, recuperação, checkpoints, idempotência e recusa de confirmar marcadores sem o roteiro aprovado.
- `npm run build`: TypeScript e Vite aprovados. O aviso de bundle acima de 500 kB permanece; benchmark e divisão de código estão no backlog, sem mudança de stack.
- `scripts/test-editorial-flow-ui.mjs`: Electron oculto com perfil e SQLite isolados, sem dados pessoais ou inferência. Valida edição, aprovação, falha, retry, reabertura, versão sem duplicação, etapa de produção e roteiro ligado ao Canvas.
- Regressões: `scripts/test-chat-interaction-ui.mjs` e `scripts/test-desktop-persistence-ui.mjs`.
- CLI real: inventário MCP e leitura da base Notion, sem criação ou publicação de teste na base pessoal.

## Trabalho restante

Pesquisa/roteiro ainda precisam migrar ao executor Node persistente. Cancelamento de uma escrita já iniciada exige reconciliação e não pode ser tratado como garantia de desfazer a operação. Aprovações feitas por conversa precisam gerar o mesmo evento nativo; a política deste incremento ainda não intercepta todas as ferramentas MCP dos chats. Entregas independentes por rede, biblioteca de arquivos, publicação, edição de vídeo, rotinas e Inbox continuam pendentes. O Editor de Vídeo permanece sem controle do computador.

As chamadas usadas são `thread/start` efêmero, `mcpServerStatus/list` e `mcpServer/tool/call`, conforme [Codex App Server](https://developers.openai.com/codex/app-server). O contrato instalado foi conferido com o gerador de schema da CLI. O app reutiliza a configuração MCP e não extrai tokens OAuth.
