# Revisão, entregas por rede e edição local — 0.3.37

## Revisão de roteiros

O cartão salvo no chat permite aprovar, rejeitar ou pedir ajustes. A decisão guarda a versão exata e seu comentário. Rejeitar ou pedir ajuste revoga a aprovação vigente sem apagar versões anteriores; uma escrita Notion ainda pendente perde autorização. Isso não desfaz uma escrita já concluída.

Na mesma sessão, `aprovo esse roteiro`, `rejeitar roteiro` ou `ajuste: encurte a introdução` abrem a revisão local. Se houver vários roteiros vigentes, o app pede a escolha. Texto citado ou pedidos genéricos não autorizam ações. O comando só funciona sobre opções editoriais já salvas nessa sessão; a confirmação usa a mesma fila do Estúdio, com a versão e o destino conferidos. Não gera uma nova resposta da IA.

Depois do pedido de ajuste, **Gerar nova versão com o ajuste** inicia uma execução explícita. O prompt inclui as opções anteriores e seu comentário. A fila editorial continua exigindo agente Codex. No Estúdio, **Pedir ajuste ou rejeitar** usa a mesma revisão.

## Entregas por rede

Cada conteúdo tem entregas próprias para Instagram, TikTok, YouTube e LinkedIn. Edite texto, escolha arquivos da biblioteca e defina fuso e horário planejado. Salvar alterações cria uma nova versão e revoga a aprovação da entrega alterada. Cada decisão guarda o texto e as referências de mídia revisados.

Use **Enviar para revisão** e depois **Aprovar esta entrega**, **Pedir ajuste** ou **Rejeitar**. Versão alterada ou mídia indisponível impede a aprovação. A Home mostra entregas aguardando revisão.

A aba **Calendário** agrupa os horários no fuso escolhido; em telas compactas vira agenda. Entregas sem horário aparecem separadas. Horários locais inexistentes ou ambíguos durante horário de verão são recusados.

**Aprovar não envia nem agenda.** O modelo reserva estados externos, mas a UI não permite fabricar uma confirmação. O adaptador Publora segue pendente. Entregas participam do SQLite editorial, validação, mesclagem e restauração de backups, mantendo compatibilidade com snapshots antigos.

## Edição local limitada

Associe um vídeo na biblioteca e use **Edição local de vídeo → Cortar e exportar**. Verifique duração e áudio, escolha início/duração e confirme **Autorizar e exportar este trecho**.

Usa FFmpeg/ffprobe disponíveis no PATH. Exporta um novo MP4 H.264/AAC, mantendo dimensões compatíveis com o codec. Confere hash da entrada antes/depois, duração e presença de áudio da saída antes de associar o resultado e marcar produção para revisão. O original não é sobrescrito. **Ver original** e **Revisar resultado** abrem arquivos verificados no player padrão; **Mostrar arquivo** abre a pasta.

Parâmetros, progresso e resultado ficam no SQLite, independentemente do React. Há um exportador por vez, limite de uma hora por trecho, trinta minutos por processo e três tentativas. Fechar interrompe e exige retomada explícita. Arquivos parciais não aparecem como resultados. Saídas concluídas podem ser verificadas sem recodificar. Trabalhos importados são histórico: prepare uma nova exportação para executar.

Sem controle de janelas, shell arbitrário, montagem de clipes, legendas ou acabamento automático. O agente não ganhou uma ferramenta automática de edição; esta operação é autorizada no Estúdio. CapCut pode continuar como acabamento manual.

## Base pública e validação

Licença MIT escolhida pelo mantenedor, documentação de contribuição/segurança e workflow Windows de tipos, testes, instalador e interface. CI no GitHub permanece não executado até o envio. Imagens, skills e dependências de terceiros mantêm seus termos.

- 154 testes automatizados, incluindo revisão exata, feedback no prompt, redes independentes, fuso/DST, backups, FFmpeg real, cancelamento e retomada.
- Testes Electron isolados de revisão/calendário e mídia: temas, proporções compactas, reinício, vídeo sintético com áudio e revisão por IPC confiável.
- O chat lateral agora mantém sua própria caixa no grid. Isso corrige o painel espremido na barra de navegação e a área principal sem altura em janelas estreitas. O teste verifica a largura do chat/composer e a área visível do calendário, além de conferir a captura nos dois temas.
- Oito regressões Electron anteriores também passaram: entregas no chat, biblioteca, trabalhos, persistência desktop, interação do composer, fluxo editorial, rascunhos/Inbox e controles de runtime.
- Sem inferência pessoal, escrita na base Notion pessoal ou publicação durante os testes.

O [backlog](analysis/mainsagents-automation-backlog-2026-10-02.md) distingue os limites: publicação nativa, rotinas, memória, cartões de arquivos no chat e suporte integral aos demais provedores continuam pendentes.

## Instalador verificado

Versão desktop 0.3.37 instalada e comparada ao pacote em 04/10/2026. Banco íntegro e estado principal/editorial idêntico ao backup anterior. Atalhos do desktop e do menu Iniciar apontam para a instalação atual. O aplicativo pessoal não foi aberto durante essa verificação.

SHA-256 do instalador: `b796f2768ff8ac106658d6ddb621f3671e1b585be978b71e7cc58c008c3426b6`.

SHA-256 de `app.asar`: `90d198693a931f55d1935cc6ced1f585134b0f309c8f82116e0f88939b0e3833`.
