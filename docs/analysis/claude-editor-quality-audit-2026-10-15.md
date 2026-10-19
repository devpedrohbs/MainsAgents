# Auditoria de qualidade — Claude como editor de vídeo (MainsAgents 0.3.68)

Data: 2026-10-15 · Tarefa Orca `task_3c6635d0f6e6` · Escopo: somente leitura. Nenhum código, teste, script, DB, configuração ou skill foi alterado. Nenhum vídeo pessoal foi processado e nenhuma inferência foi executada.

Referência: "How to Edit VIRAL Instagram Reels Using Opus 5.5" (Joseph Video Editing, 11/out/2026), a partir do resumo transcrito pelo coordenador. O guia pago **não** foi copiado; daqui só saem padrões de fluxo de trabalho.

> **Este documento é a auditoria de ANTES da implementação.** O estado atual (E1/E2, `adopt-agent-config`, setup com migração) está em `docs/analysis/claude-editor-words-guidance-2026-10-15.md`. Também foi corrigida, sem alterar o resto do texto, a afirmação de que as instruções do agente não chegavam ao editor (§6.1).
>
> **Revisão de 15/10 (tarefa `task_bfc5bfed4426`).** Depois desta auditoria, E1 e E2 foram implementados: ver `docs/analysis/claude-editor-words-guidance-2026-10-15.md`. Esta revisão corrige três pontos. (1) **Não haverá etapa obrigatória de aprovar plano ou cena**, e o código `approval_required` foi retirado da proposta: o plano automático fica consultável, e o usuário revisa a prévia/resultado e pede ajustes. (2) **Um guia pode conter URLs e caminhos legítimos como texto**: eles são lidos como referência, nunca abertos nem executados, e só o *plano* continua sem URL ou caminho. (3) Fontes e inferências agora estão separadas (§11).
> Legenda de evidência: **[código]** = verificado no arquivo e linha citados; **[coordenador]** = pesquisa ou fontes oficiais verificadas pelo coordenador; **[inferência]** = julgamento deste relatório, não medido.

---

## 1. Resumo executivo

- **Um modelo melhor ou mais treino não resolvem isso.** O Claude que edita hoje roda sem nenhuma ferramenta embutida (`claude-code-bridge.mjs:307-318`). Ele só alcança 8 ferramentas MCP de authoring e um vocabulário declarativo fechado (`editorial-storyboard.mjs:9-35`). Também recebe menos insumo do que o app já produz: o transcript chega por sentença e as palavras são descartadas (`production-coordinator.mjs:186`). Por fim, não recebe as skills nem o guia visual do perfil (`claude-code-bridge.mjs:152`, `:343`). O teto de qualidade vem desses insumos e desse vocabulário, não da inteligência do modelo.
- **Ainda não vale abrir um workspace Remotion com TSX escrito pelo Claude.** O contrato atual já tem binding de fonte, hash, recibo, isolamento por conteúdo e QA visual. Isso é exatamente o que uma pasta de TSX livre perderia. O app empacotado roda um bundle pré-compilado (`editorial-remotion.mjs:2`, `:30`) e só desempacota `@remotion/renderer` e o compositor (`package.json`, bloco `asarUnpack`, linhas ~149-150). Compilar TSX em runtime é um projeto à parte, com riscos próprios.
- **Entrega recomendada: "Editor v2" sobre `mainsagents.editor-authoring/1`.** São seis incrementos pequenos e verificáveis: transcript por palavra com marcação de falhas, um guia de estilo do perfil injetado como dado, 4 layouts-preset de referência, legendas por palavra dentro do storyboard, sons de uma biblioteca licenciada local do usuário e um orçamento de revisão maior. O usuário revisa a prévia/resultado e pede ajustes, sem uma etapa obrigatória de aprovar plano ou cena. Componentes autorados pelo Claude ficam para uma fase 2, isolada e opcional (§7).

## 2. O que a referência faz (resumo de fluxo, sem conteúdo do guia)

| # | Padrão da referência | Função |
|---|---|---|
| R1 | Guia visual permanente numa skill (cores, fontes, layouts) | Mantém o estilo consistente entre vídeos sem repetir o prompt |
| R2 | Guia sonoro e biblioteca de sons licenciada, **separados** | Sons reais e coerentes, sem síntese genérica |
| R3 | Transcript com corte de falhas (gaguejos, retomadas, repetições) | Cortes semânticos, não só por silêncio |
| R4 | Página de plano: fala à esquerda, plano visual à direita, cena por cena | Na referência, consulta antes do render. Aqui o plano fica consultável, sem aprovação obrigatória |
| R5 | Quatro layouts: captions, captions+UI, split, fullscreen | Gramática visual pequena e repetível |
| R6 | Remotion autorado pelo modelo | Liberdade gráfica fora de presets |
| R7 | Revisão e ajustes iterativos | Qualidade final vem de ciclos curtos |

## 3. Como o Claude edita hoje: duas superfícies

### 3.1 Chat Claude comum
- Ferramentas embutidas: no máximo `WebSearch`/`WebFetch` e `Read`/`Glob`/`Grep`, conforme as ferramentas do agente (`claude-code-bridge.mjs:100-106`). Não há shell nem escrita.
- MCP: cada chamada passa pelo gate de aprovação (`claude-code-bridge.mjs:330`). As skills do agente entram por `--add-dir` (`:343`).
- **Ele não edita vídeo.** Quando um vídeo vai para o agente editor, o pedido segue pela "rota engine" (`native-agent-delegations.mjs:83-85`) e cai no fluxo de produção, que é a superfície da seção 3.2.

### 3.2 Authoring MCP restrito (o "editor" de verdade)
- Spawn: `--restricted --permission-mode dontAsk`, `--tools ""` (nenhuma ferramenta embutida), só o servidor `mainsagents_editor` (`claude-code-bridge.mjs:300-318`). Há um subagente opcional `frame-reviewer`, somente leitura (`:320-327`).
- Ferramentas (`editor-authoring.mjs:101-110`): `get_context`, `get_frames`, `contact_sheet`, `storyboard_stills`, `write_plan`, `render_preview`, `finalize`, `export_status`.
- Orçamento padrão (`editor-authoring.mjs:16`): **2 revisões, 3 previews de no máximo 10 s, 60 chamadas, 24 MB de visão, transcript de 24 000 caracteres.** A única abertura de sessão de editor passa `limits:{}` (`production-coordinator.mjs`, `planAuthoredEdit`), então os padrões valem sempre. A rota engine da delegação (`native-agent-delegations.mjs:83-85`) cria uma produção e passa pelo mesmo `planAuthoredEdit` **[código]**.
- O prompt é fixo, em PT, com estilo "creator explicativo" (`production-coordinator.mjs:211-218`). O briefing entra como referência delimitada (`:136-140`).
- Segurança e recibos (manter): binding run/epoch/autoridade/sha256 da fonte (`editor-authoring.mjs:134-142`); plano declarativo sem código, URL ou caminho (`:55-95`); QA obrigatória antes do finalize, com fonte observada, preview inspecionado e todas as cenas cobertas (`:~435-455`); recibo verificado por hash e recusado se for igual à fonte (`:158-172`); prova de fatos contra transcript e briefing (`editor-host.mjs:30-43`, `editorial-storyboard.mjs:387-405`); formato de quadro fixado pelo usuário (`editor-host.mjs:46-51`).

## 4. Matriz: pronto vs. lacuna vs. proposta

| Capacidade | Estado atual (evidência) | Lacuna frente à referência | Classificação |
|---|---|---|---|
| Ver a fonte | `get_frames`/`contact_sheet` com frames reais (`editor-authoring.mjs:103-104`) | Nenhuma relevante | **Pronto** |
| Plano por cenas | `storyboard.scenes` (até 40) com camadas, câmera e transição (`editorial-storyboard.mjs:9-35`) | O plano automático já é consultável (revisões salvas, `currentPlan` em `get_context`). Uma página fala↔plano seria só para consulta, opcional | **Pronto (motor)** / UI opcional |
| Transcript por palavra | `editorial-transcribe.mjs:36-76` gera `words` com tempo; legendas usam (`production-caption-words.mjs`) | **O editor não recebe palavras**: `transcript=value.segments...map(({start,end,text}))` (`production-coordinator.mjs:186`). `get_context` serializa só segmentos (`editor-authoring.mjs:~343`) | **Gargalo**: proposta E1 |
| Cortes semânticos (falhas) | Cortes sugeridos vêm de silêncio medido (`production-coordinator.mjs:187-188`; nota em `editor-host.mjs:64`). Cada segmento só tem `{start,end}` (schema `:117`) | Sem marcação de repetição/retomada/gaguejo; o modelo não tem precisão de palavra para cortar | **Gargalo**: E1 |
| Guia visual permanente (R1) | 3 tratamentos fixos de fonte do sistema (`editorial-storyboard.mjs:37-60`); `style` aceita só `treatment, accent, accent2` (`:307`) | **Skills e instruções de estilo do perfil não chegam ao editor** (`claude-code-bridge.mjs:152`, `:343`). Não há fonte de marca nem paleta completa | **Gargalo**: E2 |
| Layouts (R5) | `cameraLayouts` full/split-left/split-right/split-top/pip/hidden (`:15`); slots, painéis e área segura (`:435-470`) | Não existe preset nomeado "captions / captions+UI / split / fullscreen"; o modelo recompõe a cada cena, e isso gera inconsistência | **Parcial**: E3 |
| Legendas | 3 presets libass (classic/boxed/highlight) em etapa separada, depois do export (`editorial-captions.mjs:35-37`; `production-coordinator.mjs:376-379`). O editor só reserva a faixa (`editorial-smart-edit.mjs:183-200`) | O editor não controla nem vê as legendas finais; não há legenda por palavra com destaque dentro da composição | **Parcial**: E4 |
| Assets | `image`/`video` por `assetId` da biblioteca do mesmo conteúdo e workspace (`editorial-media.mjs:102`), até 8 (`editorial-storyboard.mjs:10`) | Funciona, mas o editor não sabe o que cada asset mostra além de metadados | **Pronto** (melhoria menor) |
| Som (R2) | `sfx` com kinds `whoosh/pop/tick` sintetizados (`editorial-storyboard.mjs:32`; `editorial-remotion.mjs:163-164`, `:299`); limite de 6/min | Sem biblioteca licenciada do usuário, sem trilha e sem guia sonoro | **Lacuna**: E5 |
| Luz/cor original | Nenhum filtro de cor no pipeline (grep sem `eq=`/`lut3d`/`curves` em `editorial-media.mjs`, `editorial-remotion.mjs`, `editorial-motion-plan.mjs`) | — | **Pronto** (preservar) |
| QA visual | Obrigatória e medida pelo host (`editor-authoring.mjs` finalize ~l. 435-455; `editor-host.mjs:82-90` faz pré-QA no `write_plan`) | Ok. A cobertura é por still e não verifica ritmo nem som | **Pronto** |
| Revisões | 2 revisões e 3 previews; continuação até 3x por epoch (`editor-authoring.mjs:16`, `:24`) | É pouco para R7. Ajuste do usuário abre um epoch novo, com orçamento novo e só `previousPlan` como referência (`production-coordinator.mjs:~181`) | **Parcial**: E6 |
| Componentes livres (R6) | Bundle Remotion pré-compilado, sem TSX do usuário (`editorial-remotion.mjs:2`, `:30`, `:550`) | Liberdade gráfica limitada a 13 tipos de camada | **Fase 2** (§7) |

## 5. Gargalos reais, por impacto

1. **Insumo de fala pobre** (`production-coordinator.mjs:186`). Sem palavras, o Claude não faz o corte de falhas de R3, não sincroniza destaque palavra a palavra e não ancora cenas na fala com precisão. O dado já existe e hoje é descartado. É o maior retorno pelo menor custo.
2. **Estilo sem memória.** O editor não recebe skill nem guia (`claude-code-bridge.mjs:152`, `:343`) e só tem 3 tratamentos com fonte do sistema. Cada vídeo sai "genérico" e o usuário precisa repetir o pedido de estilo, o que viola a meta de "sem prompts repetitivos".
3. **Gramática de layout implícita.** Os blocos (camera layout + slots + texto) existem, mas não há os 4 presets nomeados. O modelo gasta revisões compondo o que deveria ser escolha de uma palavra.
4. **Legenda fora do controle do editor.** A legenda é queimada depois e o editor só reserva a faixa. "Captions+UI" e destaque por palavra, centrais na referência, não podem ser desenhados nem inspecionados pelo editor.
5. **Som sintético.** Três sons gerados não equivalem a uma biblioteca licenciada e curada.
6. **Pouca iteração.** Com 2 revisões e previews de 10 s, a QA obrigatória de todas as cenas consome quase todo o orçamento antes de qualquer ajuste criativo **[inferência]**.

Teste de hipótese "só treino/prompt": melhorar o prompt (`production-coordinator.mjs:211`) ataca apenas o item 3, e de forma parcial. Os itens 1, 2, 4 e 5 exigem que o host entregue dados ou vocabulário novos. **Treino ou prompt sozinho não basta.**

## 6. Entrega recomendada — "Editor v2" (fase 1, sem TSX autorado)

Princípio: estender o contrato existente, sem criar superfície nova. Toda mudança passa pelos mesmos validadores, recibos e binding.

| ID | Mudança | Fronteira reutilizada | Critério verificável |
|---|---|---|---|
| E1 (**feito**) | As palavras reais da transcrição local chegam ao host. A ferramenta MCP somente leitura `get_transcript_words` lê qualquer janela da fonte, com linhas compactas, origem/qualidade e truncagem explícita (`nextStart` + `nextOffset`; a primeira versão repetia a página quando um grupo de mesmo início passava do limite, e isso foi corrigido na tarefa `task_72904754d963`). Não há detector obrigatório de falhas: os cortes continuam decisão do editor, conferida em frames/preview | `editorial-transcribe.mjs` (`words`), `production-coordinator.mjs` (`planAuthoredEdit`), `editor-host.mjs`, `editor-authoring.mjs` | Testes: palavras chegam pela rota real (delegação → coordenador → MCP); paginação com offset testada em 1 200 s e num grupo de mesmo início com mais que o dobro da página, sem pular nem repetir; sem palavras não há estimativa |
| E2 (**feito**) | Orientação de edição = guia original do app + skills **habilitadas** do agente editor, lidas pelo **host** só dos arquivos configurados (`skillFiles` dentro de `skillsDirectory`, `disabledSkills` respeitado), com limite de bytes, entregues como dado em `get_context.guidance`. URLs e caminhos no texto do guia continuam texto; nada é aberto nem executado; não concede permissão | `editor-guidance.mjs` (novo), `editor-host.mjs` `context()`, prova de fatos inalterada | Testes: skill desabilitada ou fora da pasta não entra; limites exatos com marcador; payload sem caminho de arquivo |
| E3 | `scene.layout` preset: `captions`, `captions-ui`, `split`, `fullscreen`, expandido pelo host em camera layout + slots existentes | `editorial-storyboard.mjs` (`cameraLayouts`, `slotBox`, `panelBox`), `storyboardJsonSchema` | Teste de validador: cada preset expande para uma câmera e slots válidos em 9:16 e 16:9, sem sair da área segura (`storyboardReport` qa ok) |
| E4 | Camada `captions` no storyboard (modo palavra, 1–3 palavras, destaque na palavra ativa), renderizada pelo bundle. A etapa libass continua como fallback, e o host impede legenda dupla | `production-caption-words.mjs` (agrupamento), `Storyboard.tsx`, `captionBand` | Stills mostram legenda e a palavra ativa no tempo certo (±1 frame). Export com `captions` no storyboard desativa a queima libass (teste de coordenação) |
| E5 | `sfx.kind` aceita também `assetId` de um áudio da **biblioteca local do usuário** com etiqueta de licença registrada pelo usuário. Os sintéticos continuam disponíveis. Trilha opcional com ducking local sob a voz (`sidechaincompress`) e `loudnorm` no master. Sem download nem compra | `libraryAssets` (`editorial-media.mjs:102`) estendido para `audio`, `sfxMixFilter`, limites de ganho/densidade | Teste: um asset de áudio de outro conteúdo é recusado. O mix respeita `gainDb` e o limite por minuto. O recibo de export lista os assets de áudio usados |
| E6 | Orçamento de revisão ajustado com critério (por exemplo, 3–4 revisões e previews de até 15 s, dentro de `limitRanges`, `editor-authoring.mjs:17`), **sem** subir todos os limites. O plano automático fica consultável. O usuário revisa a prévia/resultado e pede ajustes. **Não há etapa obrigatória de aprovar plano ou cena** | `normalizeEditorLimits`, checkpoint/continuação, fluxo de ajuste existente | Teste: os limites novos aparecem em `get_context.limits`. Um ajuste do usuário gera nova versão sem perder o checkpoint anterior como referência |

Ordem sugerida: **E1 → E2 → E3 → E6 → E4 → E5**. E1–E3 são dados e validadores, com risco baixo. E6 mexe em UI e fluxo. E4 e E5 mexem no render e no mix.

O que fica igual por desenho: fonte original preservada (recibo com hash diferente da fonte), nenhuma correção de cor (preserva a luz original), assets só do mesmo conteúdo e workspace, nenhuma ferramenta embutida no editor, nenhuma aprovação MCP por chamada (a autorização de produção cobre a edição, `claude-code-bridge.mjs:311`).

### 6.1 Fatos confirmados a partir das mensagens do coordenador

- **Trocar o provider ou a instrução não libera shell nem escrita para o Claude.** `toolAllowList` só concede `Read/Glob/Grep` (+ web) (`claude-code-bridge.mjs:100-106`). Escrita local exige um agente **Codex** com Files (`agent-file-access.mjs:7`). Ferramentas úteis para o Claude precisam vir de **MCP do host** (o caminho de E1–E6), não de desbloqueio global. Configurar o agente Claude não deve tocar em `fileAccess` (seria recusado) nem nas conversas gravadas.
- **As skills não chegavam ao authoring (as instruções do agente chegavam).** *Correção:* as instruções já entravam em todo run de edição: `production-runtime.mjs:25` envia `runtimeFirstMessage:true` e `makeUserPrompt` as inclui (`claude-code-bridge.mjs:145`). Faltavam só as skills: a bridge omite skills em editor runs (`claude-code-bridge.mjs:152`, `:343`). As skills pessoais do Editor de Vídeo (3 itens em `Documents/Skills/EditorDeVideo`, conteúdo não reproduzido aqui) foram atualizadas pela última vez em 08/10. A principal descreve só título, tarja e CTA e diz para não usar efeitos ou trilha por padrão (`mainsagent-edicao-video/SKILL.md:25`, `:45`). **Se E2 injetar esse texto sem revisão, ele vai contradizer o motion pedido.** Feito em 15/10: depois de um backup verificado por hash, a skill foi atualizada. Agora a autorização da edição cobre o corte e o acabamento pedidos, e o 08/10 foi trocado por capacidades reais.
- **Gatilhos básicos obrigatórios.** `motionRequired` recusa um plano sem motion visível (`editor-host.mjs:85`, `production-coordinator.mjs` finalExport). Junto com o prompt fixo "creator explicativo" (`:211`), isso empurra o editor para camadas genéricas. **[inferência]** Na v2, a direção criativa deveria vir da orientação (guia + skills). Não está decidido nem implementado se `motionRequired` deve mudar.
- **Prioridades alinhadas com o coordenador.** P1 = E1 (palavras e falhas) + E2 (guia "treinado" carregado como dado no `get_context`) + autonomia de cortes e motion sem gatilhos fixos (E6 com orçamento maior). P2 = oficina Remotion por conteúdo (§7) + biblioteca de áudio e referências (E5), com executor de escopo local e sem desbloqueio global.
- **Leitura visual da referência, adaptada.** Tipografia contida, uma cor de acento mutável, quatro layouts, UI pequena, legenda pequena e legível dentro da safe area, poucos destaques, criador visível no hook e no CTA, screenshots reais e fluxos de 2–4 passos, movimento curto e funcional, som ligado a eventos com a voz dominante. **Não transferir** o escurecimento, o blur ou a correção de cor da referência para a fonte: o usuário pediu luz e cor originais, e o pipeline atual já não aplica filtro de cor.
- **Fontes oficiais** (pesquisa do coordenador): Remotion para coding agents <https://www.remotion.dev/docs/ai/coding-agents> e skills <https://www.remotion.dev/docs/ai/skills>, <https://github.com/remotion-dev/skills> (o MCP antigo da Remotion está deprecated); Claude Code skills <https://code.claude.com/docs/en/skills>; filtros FFmpeg `loudnorm` e `sidechaincompress` (ducking local da trilha sob a voz) <https://ffmpeg.org/ffmpeg-filters.html>. O timestamp por palavra do whisper.cpp é **experimental**, o que é risco para E1 e E4 (ver §8).
- **Estado real.** Duas produções reais estão `blocked`. A principal está em r3 com o diretor Claude e sem export final novo. A v2 precisa de um caminho para retomar essas produções sem resetar o orçamento já gasto (E6).

## 7. Fase 2 (opcional): componentes autorados pelo Claude

Só vale a pena se, depois da fase 1, o usuário ainda apontar limites de *forma gráfica* (não de estilo nem de ritmo). Desenho mínimo seguro:
- **Oficina de componentes por conteúdo** (ou por perfil, quando o componente for reutilizado), em pasta do app isolada por conteúdo. O Claude escreve TSX numa sessão separada de "design de componente" (não na sessão de edição), com testes de props e snapshot.
- Os componentes entram num **bundle versionado e hasheado** (o mesmo esquema de `bundle-manifest.json`, `editorial-remotion.mjs:30-32`, `:550`), aprovado uma vez pelo usuário. Depois disso, a edição só referencia `componentId@hash` como mais um `layerType` declarativo, e o plano continua sendo dado.
- Riscos concretos: (a) `@remotion/bundler`/webpack não está validado no app empacotado (só o renderer está em `asarUnpack`), o que exige spike; (b) TSX arbitrário roda no Chromium do render, então precisa de sandbox sem rede e sem `fs` (hoje é garantido por construção, já que não há código do usuário); (c) tempo de build por mudança; (d) QA de estilo fica mais difícil porque presets deixam de garantir área segura e legibilidade.

## 8. Riscos da fase 1

| Risco | Mitigação |
|---|---|
| Timestamps por palavra do whisper.cpp são experimentais (DTW, fim estimado em `editorial-transcribe.mjs:52-53`) | Usar palavras como âncora com tolerância. Validar cortes por preview. Cair para sentenças com warning, como as legendas já fazem (`production-caption-words.mjs:15-17`) |
| Guia/skill pessoal desatualizado contradiz o motion (`SKILL.md:25`) | Skill atualizada em 15/10 com backup. O host registra no audit da produção os nomes e o hash da orientação entregue |
| Transcript por palavra estoura contexto/tokens em vídeos longos | `get_transcript_words` por janela (até 300 s e 800 palavras por chamada, com `nextStart`). `get_context` continua com o transcript por sentença limitado a 24 000 caracteres |
| Heurística de falhas corta fala válida | Não foi implementada nenhuma heurística obrigatória. O editor decide com palavras e frames, e o preview confere |
| Guia vira canal de injeção | Dado delimitado, com nota explícita de que não concede ferramentas nem permissões, sem caracteres de controle e com limite de bytes. URLs e caminhos ficam como texto e nunca são abertos. O plano continua validado por `planSafetyProblems` e pelos validadores do host |
| Fonte de marca ausente na máquina | Aceitar só fontes instaladas e detectadas localmente. Na falta, cair para o tratamento e avisar em `warnings` |
| Legenda dupla (storyboard + libass) | Regra no host: storyboard com `captions` desativa a queima. Teste dedicado |
| Licença de som | Exigir etiqueta de licença na importação. Nada é baixado nem comprado pelo app |
| Mais revisões = mais custo | Limites continuam no host e configuráveis. Nada é prometido sobre custo ou tempo |

## 9. Fora de escopo e não prometido

Não há promessa de viralização, custo ou tempo. Não há compra, instalação de pacote externo nem cópia do guia pago. A implementação aguarda tarefa posterior.

## 10. Limites desta auditoria

- **Correção:** na primeira versão, o estado foi procurado na pasta `AppData/Roaming/mains-agents`, que não é usada. O estado real fica em `~/.mainsagents/storage/workspace-state.sqlite`. Na segunda tarefa ele foi lido somente para leitura: o agente `editor-de-video-083621ee-…` é Codex, com Files e escrita habilitadas, e as duas produções `blocked/planning-edit` têm diretor Claude.
- Nenhuma edição foi executada, então as afirmações de qualidade vêm do código e dos limites, não de vídeos renderizados.
- Os números de linha com "~" foram localizados por busca e podem variar algumas linhas.

## 11. Fontes e inferências

- **[código]** Todas as citações `arquivo:linha` deste relatório. As linhas com "~" foram localizadas por busca.
- **[coordenador]** Leitura visual e sonora da referência, feita a partir do resumo/walkthrough do coordenador (vídeo não reproduzido aqui; o guia pago não foi copiado). Documentação oficial verificada pelo coordenador: Remotion para coding agents <https://www.remotion.dev/docs/ai/coding-agents>, skills <https://www.remotion.dev/docs/ai/skills> e <https://github.com/remotion-dev/skills>, plugin para Claude Code <https://www.remotion.dev/docs/ai/claude-code-plugin> e geração de código <https://www.remotion.dev/docs/ai/generate> (nenhum foi instalado: o authoring desabilita plugins e skills nativos, então instalar não liberaria capacidade); skills do Claude Code <https://code.claude.com/docs/en/skills>; filtros do FFmpeg <https://ffmpeg.org/ffmpeg-filters.html>. O timestamp por palavra do whisper.cpp é experimental: DTW aproximado por token, com o fim de cada palavra inferido.
- **[inferência]** O efeito sobre a qualidade (§5 itens 3 e 6), a ordem E1→E6 e a fase 2 são julgamentos deste relatório e não foram medidos em vídeo renderizado.
