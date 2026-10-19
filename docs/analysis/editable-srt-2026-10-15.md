# SRT editável separado do MP4 (CapCut) — 15/10/2026

Rodada para o 0.3.70 (sem bump, build de release, instalação, commit, push ou tag). Pedido do usuário: "não quero legenda já na tela; texto na tela somente se muito útil, quero animações; gostei do SRT, pode implementar". Implementado por Claude Code; o Codex coordena e revisa.

Este relatório já incorpora a **2ª rodada (correções da revisão)**; a seção "Correções da revisão" diz o que mudou em cada ponto.

## Onde o usuário usa

1. **Estúdio → conteúdo → card "Legendas SRT para o CapCut"** (abaixo de "Edição local de vídeo"). Funciona **sem nenhum vídeo** no app.
   - **Importar SRT do CapCut** → já sai dividido em blocos curtos (padrão 3 palavras; seletor 2/3/4).
   - **Gerar do vídeo (Whisper local)** a partir de qualquer vídeo do conteúdo, inclusive o editado pela produção, sem queimar legenda.
   - Tabela editável: início/fim em `m:ss.mmm`, texto, Dividir/Juntar/Remover, e "Ouvir"/"início = agora"/"fim = agora" quando há vídeo.
   - **Baixar SRT**: com edições válidas, o botão vira **"Salvar e baixar SRT"**, que salva a versão, exporta e baixa numa ação só. "Só salvar versão" é opcional. Não há etapa de aprovação de texto, estilo ou libass.
   - Recibo visível: caminho, nome, tamanho, sha256 e aviso "tempos estimados" quando for o caso; "Baixar de novo", "Mostrar arquivo" e exportações anteriores.
   - Trocar 2/3/4 → **"Dividir de novo em blocos de N palavras (mantém suas correções)"**.
   - **"Sincronizar tempos com o áudio do vídeo selecionado"** (SRT importado) usa o Whisper só para os tempos; o texto continua o do usuário. Se esse vídeo mudar depois: alerta com **"Desfazer sincronização"**.
2. **Produção → revisão do vídeo**: o mesmo editor SRT é o painel principal. O burn antigo fica em `<details>` "Avançado (não recomendado)", fechado por padrão. Ele só abre sozinho para mostrar um burn ou job já existente, nunca para iniciar. "Reabrir vídeo aprovado para legendas" virou "Avançado: …" e aponta para o SRT no Estúdio.

## Arquivos

| Arquivo | Papel |
|---|---|
| `editorial-srt.mjs` (novo, puro) | Parse do SRT como dado: linha de tempo **completa** (regex), `-->` dentro do texto é texto; aceita BOM/LF/CRLF e posição após o tempo. Também: divisão por programação dinâmica, alinhamento LCS com o Whisper, `cuesFromWords`/`wordBlocks` (geração por frases de fala), `unitsFromBlocks` (base de revisão para redividir), validação de blocos (sem limites de libass; recusa só uma linha de texto idêntica a uma linha de tempo) e `blocksToSrt` (**UTF-8 sem BOM, CRLF**). |
| `content-srt.mjs` (novo) | Serviço por perfil/conteúdo, tabela própria `content_srt_documents`, versões imutáveis com CAS `baseVersion`+`baseHash` e `basedOn`. Rascunho válido salvo junto com Baixar/Redividir/Sincronizar. Revalida perfil, conteúdo, workspace, versão e vídeo ligado (fonte ou sincronização) **antes e depois de cada await**. Ações `import`/`generate`/`align`/`unalign`/`split`/`save`/`export`/`cancel`/`file`. Publicação sem sobrescrever (hard link), com releitura de bytes e sha256. |
| `content-workflow-bridge.mjs` | (Autorizado.) Instancia o serviço e expõe `GET/POST /api/content/srt` e `GET /api/content/srt/file`; fecha o serviço no `close`. |
| `src/features/content/srtRows.ts` (novo, puro) | Linhas com ms e `unit`, validação igual à do servidor, `splitRow` com clamp, textos de aviso (sem promessa de ±0,3 s). |
| `src/features/content/srtWorkbench.ts` | Tipos e HTTP com `AbortSignal`; reexporta `srtRows.ts`. |
| `src/components/content/SrtWorkbench.tsx` + `srt-workbench.css` | Componente do Estúdio e da produção. Escopo por perfil/workspace/conteúdo (`key` no pai, e respostas tardias de outro escopo descartadas com as requisições canceladas). Todos os botões `type="button"`. Tema claro/escuro e layout estreito. |
| `src/components/content/ContentMediaEditor.tsx` | Monta o card SRT com `key` de escopo. |
| `src/components/production/CaptionReview.tsx`, `ProductionDialog.tsx` | SRT principal (com `key` de escopo), burn em "Avançado" recolhido, todos os botões `type="button"`, rótulo de "reabrir vídeo". |
| `src/features/production/captionReview.ts` | Só texto: tirou "±0,3 s" do aviso do modo palavra (agora "sem erro máximo garantido"). |
| `editor-guidance.mjs` | Guia padrão do app: título só QUANDO ajudar (não por ideia), sem transcrição da fala no visual e sem burn por padrão, SRT separado gerado/importado no Estúdio, não afirmar SRT entregue sem arquivo com recibo, prioridade para animações/telas reais, estilo novo por caixa de conteúdo. Backup: `C:\Users\pacas\Documents\MainsAgentsBackups\before-editable-srt-2026-10-15\editor-guidance.mjs`. O hash do guia só entra em auditoria (nenhum run invalidado). |
| Skills `C:\Users\pacas\Documents\Skills\EditorDeVideo\mainsagent-edicao-video\SKILL.md` e `references\revisao-tecnica.md` | Mesma regra, incluindo "um plano não é entrega"; CRLF original preservado. Backup: `C:\Users\pacas\Documents\MainsAgentsBackups\before-editable-srt-2026-10-15\skills\EditorDeVideo`. |
| `tests/content-srt.test.mjs`, `scripts/test-srt-workbench-ui.mjs` (novos), `scripts/test-captions-frames-ui.mjs` (fixture reparado + asserções do novo padrão) | Testes. |

Não alterados: metadados de agentes, sessões e produções reais, `production-captions.mjs`, `production-caption-words.mjs`, `editorial-captions.mjs` (o validador de burn continua estrito e separado), `outputVideo`/`approvedVideo` e o pipeline de render/encode/motion.

## Divisão e redivisão

- Programação dinâmica por frase, com custo para: cada bloco, bloco de 1 palavra, terminar em palavra fraca (`pela`, `do`, `de`, `no`, `e`, `que`…), pontuação ou pausa no meio do bloco e pontuação solta iniciando bloco. "Eu hoje entrei pela porta do carro" → 3: `Eu hoje entrei / pela porta / do carro`; 2: `Eu hoje / entrei / pela porta / do carro`; 4: `Eu hoje entrei / pela porta do carro`.
- Tokens, acentos, pontuação e ordem são preservados (`sameWords` é verificado no servidor). Nada é truncado. Palavra gigante fica inteira. Frase com menos de 1 ms por bloco fica inteira (`cue-too-short`). Todo bloco tem pelo menos 1 ms, sem sobreposição.
- **Redividir parte da versão atual**, não da fonte: cada bloco carrega `unit` (a frase de origem). Os blocos da mesma unidade são juntados — com as correções de texto e os limites atuais de início/fim da frase — e divididos de novo. A fonte original continua guardada (`source.cues`/`source.words`) e a nova versão registra `basedOn`.
- **Limite conhecido:** dentro de uma frase, as bordas internas ajustadas à mão são recalculadas ao redividir (estimadas, ou do Whisper se houver áudio ligado). As bordas da frase são mantidas.

## Tempos (honestidade)

| Origem | Rótulo por bloco | Aviso |
|---|---|---|
| SRT por frase, sem áudio | `tempo estimado` (proporcional aos caracteres dentro da frase) | "Tempos ESTIMADOS…" em destaque. O recibo e a barra de ações dizem "contém tempos estimados". |
| SRT + "Sincronizar" com um vídeo do conteúdo (mesma versão) | `alinhado ao áudio` quando as duas pontas casam; senão `tempo estimado` | Aproximado, **sem erro máximo garantido**. Abaixo de 60% de casamento: `alignment-low`, ficam os estimados. |
| Gerar do vídeo | `tempo do Whisper` | Aproximado, sem erro máximo garantido. Palavras corrigidas que não casam com o áudio ficam com tempo estimado. |
| Editado pelo usuário | `ajustado por você` | — |
| Sincronização desfeita | o que era `aligned` vira `estimated` | `alignment-removed` |

## Correções da revisão (2ª rodada)

1. **UTF-8 sem BOM + CRLF** na exportação; a importação aceita BOM/LF/CRLF. Testes, UI e este documento atualizados.
2. **Linha de tempo completa**: `API A --> B` sobrevive a importar, dividir e exportar (como palavras). Uma linha de texto idêntica a um timestamp completo é recusada (arquivo ambíguo). O validador de burn não mudou.
3. **Correções manuais preservadas** ao redividir e ao sincronizar (base = versão atual por unidade). Rascunho válido é salvo antes de Redividir, Sincronizar ou Baixar, sem aprovação por etapa.
4. **Baixar com edições válidas** = salvar + exportar + baixar numa ação. "Salvar versão" é opcional. Todos os botões são `type="button"`.
5. **CAS/vínculo depois do I/O**:
   - A exportação revalida perfil, conteúdo, workspace, a versão mais recente (número+hash) e o vídeo ligado — fonte (gerado) **ou** sincronização (importado) — antes e depois dos awaits, inclusive no caminho idempotente.
   - Redividir recusa sincronização com vídeo que mudou.
   - O `transcribeJob` só aplica o resultado se perfil, conteúdo, workspace, documento, vídeo-alvo e versão-base não mudaram.
   - `file` (download) revalida o escopo depois da leitura.
   - SRT nunca ligado a vídeo não depende de vídeo.
6. **Imutabilidade**: `.partial` exclusivo e nome final via `link` (falha se existir; nunca sobrescreve). Um arquivo divergente é recusado e preservado, mesmo editado fora do app. Depois de publicar, relê os bytes e compara bytes + sha256 com o que escreveu, não só o tamanho.
7. **`splitRow`**: corte em ms inteiros dentro de [início+1, fim−1]. 2 ms vira 1 ms + 1 ms; uma palavra só ou menos de 2 ms não divide; palavra gigante não deixa metade vazia. Removidas as promessas de ±0,3 s.
8. **Escopo da UI**: `key` por perfil/workspace/conteúdo nos dois pontos de montagem, mais descarte de respostas tardias e cancelamento das requisições ao trocar de escopo; os rascunhos continuam isolados por workspace/conteúdo/documento/versão. O alerta de vídeo desatualizado vale também para SRT sincronizado (com "Desfazer sincronização"). APP_GUIDE e skill ajustados (título só quando útil; plano não é entrega).

**Follow-ups da revisão (mesma rodada, inbox lido por completo e delivery `delivery_531b43f7f102` reconhecida):**
- **Dedupe/unalign:** a deduplicação de versão ignorava os rótulos de tempo e de unidade, então "desfazer sincronização" não criava versão. Agora compara também esses rótulos, e uma mudança só de proveniência vira versão nova (mesmo hash de bytes).
- **Recibo reaproveitado:** baixar de novo o mesmo hash reutiliza o arquivo, mas o recibo passa a refletir a versão ATUAL e a estimativa atual (ex.: exportar alinhado → desfazer sincronização → baixar = `estimated: true`, `version` nova, mesmo arquivo).
- **Vídeo ligado no disco:** antes de exportar um SRT ligado a vídeo (gerado ou sincronizado), o serviço confere o sha256 REAL do arquivo no caminho registrado e revalida o vínculo depois do await. Um MP4 sobrescrito no mesmo caminho com metadados antigos é recusado; SRT independente não depende de vídeo.
- **Rascunhos por SRT:** "Descartar" e salvar/baixar limpam só o rascunho do SRT/versão atual, não mais todo o escopo do conteúdo. O rascunho de outro SRT do mesmo conteúdo sobrevive. **Defeito visual corrigido:** dentro do diálogo da produção, o botão "Importar SRT do CapCut" ficava ilegível (o estilo de `label` da produção sobrescrevia); agora tem CSS próprio.

## Fixture legado `scripts/test-captions-frames-ui.mjs` — diagnóstico e reparo

- Motivos exatos do travamento: (1) o fixture cria a ponte com `mediaOptions:{inspect,transcriber}`, **sem `animate`**. Por isso `media.capabilities()` devolve `animate:false` sem `animateReasons`, e a guarda real bloqueia o motion pedido ("o motor de animação (Remotion) está indisponível neste computador"). O bundle `dist/remotion` existe; não é falta de bundle. (2) O diretor de edição padrão real é **Claude Code**, e o fixture só tem o runtime Codex simulado ("Claude Code indisponível neste app").
- Reparo, só no fixture e sem mexer em guardas nem no comportamento real de motion: o fixture escolhe explicitamente o diretor `agent` (o Codex simulado do agente, sem IA real) e, se o bloqueio de motion aparecer, clica "Continuar sem motion", que é a escolha explícita do usuário no app.
- Resultado: o fixture passa de ponta a ponta. Ele verifica o SRT como painel principal, o "Avançado" fechado, a transcrição/burn/prévia antigos só depois de abrir o Avançado, capas e reabrir/voltar. Saída: `{"ok":true,…,"frameRequests":8,"aiCalls":3}`.

## Provas (estado atual, depois das últimas alterações)

- `node --experimental-strip-types --test tests/content-srt.test.mjs`: **16/16**. Casos:
  - exemplo 3/2/2 e as variantes 2/4;
  - literais técnicos e `-->` no texto em todo o ciclo;
  - frase longa, palavra gigante e frase de 1 ms;
  - BOM/LF/CRLF aceitos na importação e exportação sem BOM com CRLF;
  - alinhamento empresta tempo e nunca troca texto;
  - geração e unidades;
  - `splitRow` com 2 ms, palavra gigante e palavra única;
  - **corrigir palavra e limite → baixar direto → redividir 3→2 → exportar ainda corrigido → voltar a 3 ainda corrigido**, com export anterior imutável, vídeo intacto e zero chamadas de mídia;
  - idempotência, versão obsoleta e arquivo externo divergente nunca sobrescrito;
  - releitura de bytes adulterados recusada;
  - **perfil, conteúdo ou workspace mudando DURANTE o await do export** (também no caminho idempotente e no download), sem registro e sem documento;
  - **vídeo ou perfil mudando DURANTE o job do Whisper**: nada aplicado;
  - vídeo de origem desatualizado bloqueia export e redivisão;
  - sincronização com rascunho mantém a correção; vídeo mudou → redividir e exportar recusados → desfazer → exporta; SRT independente não é afetado;
  - vínculos e rascunho inválido recusados;
  - **alinhado → exportar → desfazer → baixar mesmo hash**: mesmo arquivo, recibo com versão atual e `estimated: true`;
  - **vídeo ligado sobrescrito no disco com metadados antigos**: export recusado; SRT independente exporta.
- Afetados (`content-srt`, `caption-words`, `editorial-captions`, `production-caption-preview`, `production-coordinator`, `editor-guidance-words`, `content-workflow`, `editorial-media`): **70/70**. `npm run typecheck`: OK.
- Suíte completa `npm test`, depois de todas as alterações: **736/736**. Uma rodada anterior, antes dos follow-ups, deu 734/734.
- UI real (Electron + SQLite + FFmpeg + ponte; Whisper simulado), num build de teste fora de `dist`. Comandos: `npx vite build --outDir .mainsagents-workspaces/srt-ui-dist --emptyOutDir` e depois `MAINSAGENTS_UI_DIST=.mainsagents-workspaces/srt-ui-dist npx electron scripts/test-srt-workbench-ui.mjs`. Resultado: **ok, 4 downloads reais**.
  - Importa o SRT sem vídeo, corrige duas linhas e confirma que tempo inválido bloqueia o botão.
  - **"Salvar e baixar SRT"** baixa a v2: o download é igual ao arquivo verificado, **sem BOM**, só CRLF, com `Eu hoje entrei,` e `do carrão!`, e o sha256 aparece no recibo.
  - Baixar de novo reaproveita o mesmo arquivo, com um documento só e nenhum job de mídia.
  - **2 palavras → redividir** mantém `Eu hoje / entrei, / pela porta / do carrão!`, e "Baixar SRT (v3)" sai ainda corrigido.
  - Gerar do vídeo funciona com player sem texto sobreposto, e o sha do vídeo fica intacto.
  - **Rascunho em A → trocar para B → editar e "Salvar e baixar" B** (4º download, `Eu, hoje`) → voltar para A: o rascunho "RASCUNHO A" continua lá.
  - Todos os botões são `type=button`. A 420 px não há rolagem horizontal.
  - Capturas: `.mainsagents-workspaces/srt-workbench-ui/1792083724806/` (`srt-imported-light.png`, `srt-exported-light.png`, `srt-exported-dark.png`, `srt-generated-light.png`, `srt-narrow-light.png`, `srt-narrow-dark.png`).
- Produção (app real, fixture reparado): `MAINSAGENTS_UI_DIST=.mainsagents-workspaces/srt-ui-dist npx electron scripts/test-captions-frames-ui.mjs` → **ok** (última execução `.mainsagents-workspaces/captions-frames-ui/1792083742512/`). Captura do painel: `production-srt-default.png` na mesma pasta.

## Limites

- Tempos de SRT importado sem áudio são **estimativas**, e isso está declarado. A sincronia só faz sentido se o vídeo escolhido for o mesmo exportado pelo CapCut. Whisper/DTW é aproximado, sem erro máximo garantido. Não prometo compatibilidade com todos os modelos de legenda do CapCut: o arquivo traz só texto e tempos.
- O motor existente (`editorial-media.mjs`) corta palavras do Whisper em 40 caracteres. Isso só afeta a geração direta; o texto importado nunca é truncado.
- A troca de conteúdo com resposta lenta é coberta por código (`key` de escopo, descarte de resposta tardia e `AbortController`), não por um teste E2E dedicado.
- O download no Electron usa o diálogo padrão de salvar. O arquivo também fica em `<dados>/srt/<perfil>/<conteúdo>/srt/<título>-v<N>-<hash8>.srt` e na biblioteca do conteúdo. Uma exportação recusada depois da escrita (ex.: perfil trocado no meio) pode deixar esse arquivo verificado no disco sem registro. Ele não é sobrescrito e é reaproveitado se a mesma versão for exportada de novo.
- O burn ("Avançado") continua existindo com o fluxo antigo de aprovação; nada nele é automático.
