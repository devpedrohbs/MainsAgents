# Fluxos com nome — primeira versão, 0.3.44

Na aba Fluxo, “Meus fluxos” organiza a produção em quatro caixas iniciais:

1. Agente de conteúdo: ideias, aprovações, roteiro e Notion na conversa do agente.
2. Vídeos da gravação: seleção/arraste de arquivos locais, biblioteca e briefing para o especialista.
3. Editor de vídeo: conversa do especialista, acesso ao corte/exportação manual existente e revisão do resultado.
4. Preparar publicação: conversa do agente de conteúdo e entregas reais por plataforma.

O modelo inicial se chama “Fluxo de criação de conteúdo”. É possível criar, selecionar, renomear, duplicar e remover fluxos por workspace; adicionar, renomear, arrastar e remover caixas; conectar caixas e distinguir próxima etapa de contexto. As etapas de sequência não permitem ciclos. Os fluxos, posições, conexões e sessões associadas ficam na persistência local e no backup. Duplicar cria outra organização sem herdar conteúdo ou sessões anteriores. Remover uma caixa/fluxo não apaga agentes, conversas ou arquivos.

## Como usar

- Abra Fluxo. Nas caixas, selecione seus agentes; o modelo sugere os editores de conteúdo/vídeo encontrados no workspace.
- Abra a conversa do Agente de Conteúdo para trabalhar em ideias e roteiro. As instruções e skills são as do agente existente.
- Em “Conteúdo acompanhado”, escolha o registro correspondente do Estúdio. Uma conversa já vinculada ao mesmo conteúdo pode continuar; trocar para outro conteúdo separa as sessões.
- Na caixa de gravação, adicione vídeos do PC ou arraste-os. Eles são verificados e associados como originais ao conteúdo; permanecem em sua pasta local.
- Com roteiro aprovado, fonte com colaboração habilitada e conexão da gravação ao Editor de Vídeo, use “Preparar envio ao editor”. Confira destinatário, arquivos e briefing e envie. O caminho usa a fila nativa de delegação já existente, incluindo instruções e skills do destinatário. A conversa retornada pelo especialista fica associada à caixa.
- A caixa do editor abre essa sessão e oferece o corte/exportação manual já existente. Um retorno textual não equivale a um vídeo editado. A revisão de arquivos continua disponível no Estúdio/chat.
- A caixa de publicação abre a conversa do agente de conteúdo e as entregas do mesmo conteúdo, incluindo os controles existentes de revisão, prévia, conta, rascunho/agendamento, edição e cancelamento.
- “Relações do Canvas” preserva a visualização anterior e os objetos do Canvas.

## Limites deste incremento

Este incremento entrega a organização visual e os acessos funcionais. As setas não executam todas as etapas automaticamente. Criar um fluxo não inicia inferência, sincronização do Notion nem publicação. A criação de card após aprovar apenas uma ideia, edição básica automática pelo especialista, geração/vinculação automática de capas e legendas, interpretação de horário e progressão automática pelas aprovações continuam sendo incrementos próprios do coordenador.

Os estados exibem registros reais: roteiro aprovado, gravação associada, resposta do especialista, arquivos disponíveis e recibos de agendamento. A conversa inicial e a preparação de publicação podem usar a mesma sessão do agente de conteúdo. Um arquivo recebido não é uma aprovação para publicar, e uma resposta do editor não certifica um vídeo de saída.

Nesta versão, conexões de contexto identificam relações visuais; não acrescentam todo o histórico de outra caixa ao prompt automaticamente. O briefing do envio explícito inclui o roteiro aprovado e os vídeos originais verificados.

## Validação

Testes de modelo verificam separação por workspace, conexões/ciclos, continuidade ao vincular conteúdo, duplicação sem sessões herdadas e backup/merge. O teste Electron usa renderer de produção, SQLite e inspeção de arquivo local com provedor simulado. Verifica nome, sessões, briefing, continuidade do especialista, ausência de reenvio na reabertura, tema claro/escuro e largura de 360 px. O arquivo do teste tem bytes de fixture; não demonstra uma edição ou um MP4 reproduzível. Não utiliza contas pessoais ou tokens de IA.

Build de produção e 218 testes automatizados aprovados. Regressões Electron do calendário/publicação e do layout existente passaram. O pacote nativo passou na verificação de persistência, com 49 módulos conferidos. A 0.3.44 foi instalada no desktop pessoal após backup consistente; os hashes do estado principal/editorial foram comparados, preservando três agentes, 16/3/12 skills associadas e oito sessões. Atalhos do desktop/menu Windows e o app.asar instalado foram conferidos.

SHA-256 do instalador local: `b6d03f4c256af720a94db40433243b9e5a967e92a4a3f5809e60ab9065d61edf`.

SHA-256 do app.asar instalado: `fbabff7250de2639f87381b029a0eda896c2f085d1771ac2b55de3593fff0298`.

Verificação local em 05/10/2026 (America/Sao_Paulo). Não declara publicação desta versão no GitHub Releases.
