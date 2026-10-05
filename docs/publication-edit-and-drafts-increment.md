# Edição, calendário e rascunhos — 0.3.41

Este incremento fecha edição/reagendamento de texto LinkedIn via Publora e consulta automática opcional do calendário. Não completa upload/publicação Zernio, nem altera a decisão de adiar edição avançada de vídeo.

## Uso

1. Abra uma entrega LinkedIn com texto, já confirmada como rascunho ou agendada.
2. Escolha **Editar ou reagendar no Publora**, ajuste texto/destino/fuso/horário e **Conferir alteração**.
3. Confira a prévia e selecione **Autorizar alteração no Publora**. O mesmo post recebe uma nova versão aprovada; nenhuma recriação é feita.
4. Uma falha deixa o resultado pendente. **Consultar resultado no Publora** verifica conta, texto, horário e estado. Nunca repete automaticamente a edição.
5. No calendário, consulte suas contas antes de habilitar **Atualizar automaticamente enquanto o app está aberto**. Intervalos: 5, 15, 30 ou 60 minutos. A preferência é por perfil/workspace/provedor e sobrevive ao reinício.

Somente rascunhos e agendamentos confirmados podem ser editados. Posts publicados, em processamento, alterados externamente ou sem identificação precisam ser conferidos antes. Previews expiram em dez minutos; agendamentos exigem pelo menos dois minutos futuros. Mudanças externas são detectadas antes do envio. O horário do provedor é conferido após a edição.

## Persistência dos formulários

Os rascunhos de entrada de pauta, decisão/pesquisa, roteiro, revisão de roteiro/arquivos, briefing de transferência, entrega por rede, alteração externa e parâmetros de corte usam o armazenamento local do perfil, incluindo backup/importação. Cada rascunho se vincula ao workspace e à versão do artefato/entrega correspondente. Uma versão nova não herda automaticamente alterações da anterior. Rascunhos não constituem aprovação nem envio.

Chaves API e autorizações externas não entram nessa coleção. Destinos são conferidos novamente no serviço antes da ação. Os parâmetros de corte guardados exigem nova inspeção do arquivo ao reabrir; isso não adiciona edição avançada.

## Proteção de operações

- Intenção nativa de edição vinculada ao hash da entrega, post, conta, conteúdo, destino e prazo.
- Aprovação de uso único; transação registra a nova versão e a intenção antes da chamada externa.
- Leitura prévia recusa alterações concorrentes conhecidas e estados não editáveis.
- Identificador preservado; falhas/reinicializações deixam estado incerto, recuperável por consulta.
- Consultas automáticas usam somente as contas escolhidas, no perfil ativo; falhas preservam cache e respeitam o intervalo.
- Uma entrega confirmada atualiza seu cache de calendário quando as contas já foram escolhidas. Falha do calendário não apaga o comprovante de envio.

## Validação local

199 testes automatizados; TypeScript/Vite; interface Electron com criação aprovada simulada, alteração do mesmo post, reinício de pauta/alteração não enviada e layout compacto; arquivos/Inbox/handoff Codex→Claude; preservação com app.asar empacotado. Nenhum post pessoal criado, agendado ou alterado nesses testes. A validação real de escrita segue pendente de autorização/destino concretos.

Contrato consultado: [Publora update_post](https://docs.publora.com/mcp/tools-reference#update_post). O Windows pode exigir confirmação para um instalador sem certificado; esta versão não possui assinatura digital.
