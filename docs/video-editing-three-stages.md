# Edição em três etapas — MainsAgents 0.3.74

Data: 23/10/2026.

Pedido do criador: revisar primeiro o vídeo com cortes; pedir o acabamento visual depois; finalizar as legendas do CapCut por último.

Implementado e instalado localmente na versão 0.3.74 em 23/10/2026. Novas edições começam por cortes; produções antigas mantêm seu comportamento e podem recomeçar pelo botão “Recomeçar em três etapas, só pelos cortes”. As skills pessoais não foram modificadas: a etapa chega pelo host e é validada antes de salvar/exportar o plano.

## 1. Corte base

- Trabalhar a partir dos brutos autorizados, com transcrição temporal e inspeção real da gravação.
- Selecionar tomadas corretas, remover erros, retomadas e pausas excessivas, preservando sentido, respiração e ênfase. Duração de silêncio, sozinha, não comprova erro.
- Entregar uma versão nova, sem motion, zoom de ênfase, painéis, títulos, efeitos de transição ou legendas gravadas. Manter o enquadramento solicitado e preservar luz e cor.
- Informar o arquivo, a duração, as decisões de corte e as dúvidas restantes. O criador pode pedir novas versões.
- Encerrar esta etapa com a versão identificada. O acabamento só começa após um pedido explícito do criador sobre essa versão.

## 2. Acabamento visual

- Usar a versão do corte base escolhida pelo criador como referência temporal.
- Receber instruções por trecho: o que explicar, qual captura mostrar, quais destaques e referências usar.
- Preservar a montagem aprovada: ordem das falas, intervalos mantidos, velocidade e duração. A etapa não deve decidir novos cortes de fala.
- Inserir motion, telas reais e apoios visuais apenas onde ajudarem a compreender o conteúdo. Reservar espaço para as futuras legendas.
- Se um efeito exigir alteração temporal ou da fala, explicar a necessidade antes de executá-lo; essa mudança exige revisão do corte base.
- Entregar uma versão visual nova e revisável. Manter os brutos e o corte base disponíveis.

## 3. Legendas do CapCut

- Gerar/exportar as legendas no CapCut sobre a versão visual final escolhida.
- Receber o SRT e a identificação do vídeo correspondente. Para conferir sincronia, é necessário o vídeo ou outro material temporal verificável.
- Corrigir reconhecimento, nomes técnicos, pontuação e divisão de blocos, preservando o que foi efetivamente dito.
- Em uma revisão só textual, manter os tempos. Ao redistribuir palavras entre blocos, conferir os novos limites no áudio; não inventar precisão por palavra.
- Devolver outro SRT para importação no CapCut. O acabamento de fonte, posição e animação das legendas ocorre no projeto do CapCut.
- Uma alteração posterior que mude a linha do tempo exige conferir novamente as legendas.

## Referência de cortes

Fonte estudada: [Captions — Six common types of cuts in film](https://captions.ai/blog/six-common-types-of-cuts-in-film), consultada em 23/10/2026.

Resumo das técnicas, em palavras próprias:

| Técnica | Princípio |
| --- | --- |
| Hard cut | Passagem direta de um plano ao próximo. |
| Jump cut | Salto perceptível entre momentos de um enquadramento semelhante. |
| Match cut | Ligação entre planos por forma, movimento ou composição. |
| Cutaway | Breve passagem para uma imagem relacionada ao assunto. |
| J-cut | O áudio seguinte começa antes da troca de imagem. |
| L-cut | O áudio anterior continua depois da troca de imagem. |

Aplicação proposta ao material do criador:

- Na primeira etapa, priorizar cortes diretos e aceitar saltos visuais deliberados quando a seleção de fala os exigir. Marcar emendas incômodas para avaliação posterior.
- Na segunda, considerar capturas reais para explicar a fala ou cobrir uma emenda. Não inserir material genérico apenas para esconder cortes.
- Usar match cuts apenas quando os planos disponíveis apresentarem uma correspondência verificável; não forçar esse efeito em toda mudança de assunto.
- Considerar J/L-cuts quando houver material e suporte a edição independente de áudio e imagem. Não aplicar um deslocamento à voz inteira para simular a técnica.
- Não há obrigação de usar todas as técnicas em um mesmo vídeo. A escolha depende da fala e das imagens disponíveis.

## Implementação e limites

- `chat-edit-intent.mjs` reconhece pedidos explícitos de visual. O host os liga à mensagem salva, ao conteúdo e à versão atual; repetir o pedido não duplica a execução.
- `edit-stages.mjs` e `editor-host.mjs` recusam motion na etapa de cortes e mudanças na montagem/voz durante o acabamento. A etapa visual usa os segmentos aprovados sobre o bruto, sem repetir a seleção de fala; o áudio aprovado é copiado para a exportação.
- `start-visual-edit` exige as instruções e a referência exata do corte atual. `cancel-visual-edit` retorna ao corte base. `finish-visual-edit` escolhe o arquivo para a etapa do CapCut, sem iniciar IA ou gravar legendas.
- A terceira etapa apresenta o editor SRT existente com apenas o vídeo final escolhido. SRTs importados por essa tela registram `targetVideo`; a associação não é anunciada como alinhamento por palavra. Trocas de versão impedem usar o alvo antigo silenciosamente.
- `editorial-smart-edit.mjs:cutFilter` continua usando os mesmos intervalos para áudio e vídeo. J/L-cuts independentes não foram implementados. O guia orienta hard/jump cuts, cutaways e match cuts conforme os materiais disponíveis, sem prometer técnicas inexistentes.
- O acabamento preserva os pacotes da voz aprovada; SFX novos são recusados nessa etapa, pois seriam descartados pela cópia do áudio. Nada é publicado ou agendado por uma decisão de edição.
- O novo fluxo está no chat, na entrada de vídeo já gravado e no envio da gravação pela produção. O botão de recomeçar permite aplicar o novo contrato a uma produção antiga por decisão explícita.

## Critérios de verificação

1. Pedir apenas cortes gera uma versão com múltiplos trechos, sem efeitos visuais ou legendas.
2. Receber/reabrir essa versão não dispara acabamento automaticamente.
3. Pedir acabamento referencia a versão escolhida e preserva sua montagem e duração; nenhuma nova seleção de fala é aceita silenciosamente.
4. Recusar, interromper ou retomar uma etapa preserva os arquivos e a associação à versão correta.
5. O SRT registra a versão de vídeo usada; correções textuais não alteram seus tempos sem necessidade explícita e conferência.
6. Nenhuma técnica é anunciada como aplicada sem evidência no plano e na exportação real.

## Evidências locais

- `tests/edit-stages.test.mjs`: FFmpeg real com decisões de IA roteirizadas; recusa de motion precoce e recorte na etapa visual, áudio comparado, replay, reinício e cancelamento com retorno ao corte base.
- `tests/content-srt.test.mjs`: SRT importado associado à versão final, sem falso alinhamento; versão antiga ou outro conteúdo recusados.
- `scripts/test-edit-stages-ui.mjs`: Electron isolado, interface real e mídia sintética. Jornada pelas três etapas, importação do SRT, associação ao vídeo, reinício, temas claro/escuro e janela de 420 px. Provedor e renderizador de motion simulados; nenhuma inferência ou edição de vídeo pessoal.
- Evidências mais recentes da interface: `.mainsagents-workspaces/edit-stages-ui/1792779108512/report.json` e capturas na mesma pasta.
