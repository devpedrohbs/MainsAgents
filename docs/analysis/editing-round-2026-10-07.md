# Rodada — edição semiautomática local

Autorizada pelo usuário em 07/10/2026. Foco desktop, projeto mobile fora do escopo. Priorizar Claude no desenvolvimento, com contexto novo e briefs delimitados para reduzir consumo; Codex auxilia na integração de interface. Sem chamadas pagas de IA, vídeos pessoais, publicação, instalação pessoal ou remoção dos originais.

## Ambiente verificado

- Downloads/ffmpeg-9.0.2 contém código-fonte, não executáveis.
- Binários operacionais no PATH: C:/ffmpeg/bin/ffmpeg.exe e ffprobe.exe, versão 9.0.1.
- FFmpeg tem silencedetect/silenceremove; não tem filtro Whisper neste build.
- Remotion e pacotes @remotion: versão 4.0.534 verificada no registry e documentação.
- Transcrição local será uma dependência explícita (Whisper.cpp + modelo multilíngue); nunca apresentar transcript simulado como resultado real.

## Jornada

Arquivo local verificado → detectar silêncios/transcrever → lista de sugestões com timestamps → usuário revisa trechos removidos e animações → exportar novo MP4 → conferir resultado → aprovar para produção/publicação.

Silêncios podem vir selecionados com padding para proteger fala; possíveis repetições/retomadas ficam desmarcadas para revisão. “Fala errada” não será classificada como certeza: revisão do texto e do trecho é necessária. Animações fixas: título de entrada, identificação/tarja e CTA ao final. Primeiro recorte usa overlays sobre o vídeo, sem montagem arbitrária ou código fornecido pela IA.

## Propriedade

- Opus: engine local de análise/cortes, múltiplos segmentos sincronizados, contrato/backends/media queue, testes de integridade e depois transcrição local. Não editar componentes UI/Remotion/dependências raiz.
- Sonnet: projeto de composição Remotion e adaptador local, presets delimitados, smoke render sintético. Não editar engine/rotas/componentes UI/dependências raiz; comunicar exports para integração.
- Codex 6.1 Low: editor de revisão, seleção de cortes/animações e integração React sobre contratos publicados, testes Electron próprios. Não editar backends, composição Remotion ou dependências raiz.
- Coordenador: dependências/empacotamento/build integrado, revisão de contratos, testes e documentação consolidada. Nenhum subagente adicional.

## Contrato inicial a estabilizar pelos responsáveis

Análise usa somente arquivos vinculados ao conteúdo/perfil/workspace: contentId, assetId, versionId e sha256. Opções de silêncio: thresholdDb, minDuration e padding. Resposta identifica arquivo/versão, metadata, candidatos com id/start/end/reason/label e transcrição com timestamps quando disponível. Sem áudio deve informar limitação sem inventar cortes.

Plano de corte usa intervalos **mantidos** `{start,end}` em segundos no vídeo original, ordenados, finitos, sem sobreposição e com limites de quantidade/duração. Inverter os intervalos removidos gera esse plano. Usar o mesmo plano para vídeo e áudio; não aplicar silenceremove apenas no áudio. A duração esperada da saída é a soma dos intervalos mantidos.

Exportação avançada exige revisão explícita da versão atual e hash do plano completo, incluindo animações. Resultado sempre em caminho novo, com verificação e histórico de origem; cancelamento/erro não criam entrega pronta. Exportações básicas antigas continuam compatíveis. Novos jobs/análises/planos entram no backup sem restaurar autorização de executar.

Remotion recebe o vídeo já cortado, especificação validada de overlays e metadados da saída. Não aceitar JS, HTML, URLs externas ou caminho arbitrário do renderer. Adapter deve preservar áudio, respeitar cancelamento e renderizar em arquivo temporário novo antes de verificar o resultado. Browser/cache locais explicitamente diagnosticados. Licença Remotion documentada; não contratar licença ou serviços.

Os workers devem publicar contratos exatos cedo e pedir alinhamento antes de editar arquivos fora da propriedade. Modelos/binaries locais podem ser preparados em diretório de ferramentas do projeto para testes; não tocar nos perfis pessoais de agentes.

## Aceite

- Vídeo sintético com silêncios conhecidos reduz duração conforme plano, mantendo áudio sincronizado e original idêntico.
- Usuário pode rejeitar sugestão, marcar fala e inspecionar timestamps antes de exportar.
- Transcrição indisponível aparece como tal; importação manual de transcrição temporal é caminho explícito, não substituto oculto.
- Render Remotion real produz título/tarja/CTA no vídeo e mantém áudio/duração; mostrar frames de amostra para QA.
- Arquivo alterado, plano adulterado, perfil diferente, cancelamento e reinício não permitem exportação/reenvio silencioso.
- Testes anteriores, TypeScript/build e regressões de mídia/produção passam.

## Referências oficiais

- https://www.ffmpeg.org/ffmpeg-filters.html#silencedetect
- https://www.remotion.dev/docs/renderer/render-media
- https://www.remotion.dev/docs/renderer/ensure-browser
- https://www.remotion.dev/docs/install-whisper-cpp
- https://github.com/ggml-org/whisper.cpp
- https://github.com/remotion-dev/remotion/blob/main/LICENSE.md
