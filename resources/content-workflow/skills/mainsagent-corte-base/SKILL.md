---
name: mainsagent-corte-base
description: Preparar e, quando houver ferramentas locais, executar um corte inicial de vídeo falado usando marcador de erro e pausas, preservando os arquivos brutos e pedindo revisão do criador.
---

# Corte base por marcador e silêncio

O objetivo é entregar um vídeo que já funcione com cortes simples, sem depender de efeitos. A gravação vem do iPhone para uma pasta local por conteúdo. O marcador inicial proposto é a palavra **REFAZ**: depois de um erro, o criador fala o marcador, faz uma pausa curta e repete a frase inteira. Essa palavra e regra ainda NÃO foram aprovadas pelo criador: confirme-as no briefing antes de aplicar cortes por marcador.

## Análise

- Identifique arquivos de entrada, ordem das tomadas, duração, áudio e transcrição com timestamps. Se não houver acesso aos arquivos ou transcrição temporal, peça-os; não invente trechos nem cortes.
- Para cada `REFAZ`, localize a tentativa anterior e a frase repetida. Proponha remover a tentativa com erro, o marcador e a pausa, preservando a versão correta e uma transição natural. Se a repetição não estiver clara, marque o ponto para decisão humana.
- Sugira remoção de pausas longas que prejudiquem o ritmo. Preserve pausas de respiração, ênfase e mudança de assunto; use duração mínima configurável em vez de cortar todo silêncio.
- Entregue uma lista de cortes com início/fim, motivo, grau de confiança e trecho preservado. Aponte cortes que podem eliminar uma informação importante.

## Execução condicionada

Se o MainsAgents oferecer transcrição e processamento local, gere um **novo arquivo de corte base** e um registro de cortes; mantenha os brutos intactos. Não instale ferramentas nem suponha que FFmpeg ou transcrição já existam. Se essas capacidades não estiverem disponíveis, entregue somente o plano de edição com timestamps para aplicação manual no CapCut.

Mostre o corte base ao criador e espere aprovação da versão ou pedidos de ajuste. Não considere a coluna `Review` do Board como aprovação. O acabamento visual no CapCut vem depois, se ele quiser.

## Responsável e retorno

Esta etapa é executada pelo Editor de Vídeo a partir do Briefing de edição do Editor de Conteúdo. Preserve o ID do conteúdo e a versão do roteiro aprovado. Devolva o resultado, arquivos realmente gerados, lista de cortes e pendências para revisão do criador; depois, o Editor de Conteúdo prepara derivados e pacote. Sem ferramenta entre agentes, entregue o retorno em texto para transferência manual.
