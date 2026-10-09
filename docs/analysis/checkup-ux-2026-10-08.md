# Checkup de UX e fluxo de conteúdo (0.3.56) — lista para aprovação

Data: 2026-10-08. Auditor: Claude Sonnet (somente leitura). Nada foi implementado, instalado ou executado; não houve rede, IA, Notion, publicação, commit nem subagente. Este arquivo é a única escrita.

**Base:** código-fonte atual (`package.json` = 0.3.56) e os screenshots existentes em `.mainsagents-workspaces/content-flow-integration-ui/1791423987839/` (01–07 e 06-layout-*) e `docs/analysis/content-flow-components-ui/`. As skills `apple-design` e `frontend-design` foram lidas por inteiro. **Protocolo da apple-design cumprido (segunda passada, 2026-10-08):** li **por inteiro** nove arquivos em `.agents/skills/apple-design/references/hig/`: o conjunto obrigatório (`accessibility.md`, `layout.md`, `typography.md`, `color.md`, `designing-for-macos.md`) mais `loading.md`, `feedback.md`, `buttons.md` e `entering-data.md`. Citações abaixo vêm só desses arquivos. Plataforma: app desktop Electron (Windows); as regras de macOS valem como princípio, não como convenção da plataforma. O que não tem referência é julgamento próprio e está marcado. A primeira versão deste relatório dizia ter lido só três por inteiro; foi corrigido.

**Legenda de evidência:** ✅ implementado e confirmado no código · 👁 visto em screenshot · ⚠ proposta · ❓ não validado (não executei o app, não rodei testes).

**Não repetido:** o relatório antigo de colunas/galeria já está corrigido (3/2/1 colunas) e não foi reaberto.

## Limites da auditoria

- Telas **canvas, agentes, calendário, importação de arquivo e edição (EditReview/SmartEditReview)** foram lidas só por código e por relatórios anteriores, sem screenshot novo. Nenhum achado abaixo depende delas, exceto o que está marcado ❓.
- Os screenshots 04–07 usam um vídeo de teste (barras de cor) e textos de fixture ("Revisado por mim", "Legenda aprovada para Instagram"). Avaliei estrutura e fluxo, não a estética das capas.
- Contraste não foi medido nesta rodada (já há relatórios de contraste anteriores em `docs/analysis/content-flow-*contrast*`). Nada de novo foi amostrado.
- Foco, teclado e tela cheia no desktop não foram testados ao vivo ❓.
- Não rodei testes nem build; "✅" significa "está no código", não "passou agora".

## Resumo

O fluxo ideia → roteiro → gravação → edição → capas → pacote está **coerente e bem protegido** (gates por versão/hash, orçamento com chamadas reais, capas locais sem IA, honestidade sobre referências sem análise). As lacunas que importam para quem **grava conteúdo para uma loja** estão em três pontos: (1) a gravação é só uma folha de leitura e depende do Notion, (2) a capa não permite escolher o quadro vendo o vídeo e a marca não persiste por loja, (3) o status do conteúdo na Home diverge do estágio real da produção nas etapas finais (divergência inferida do código, não reproduzida no app). **Nota geral: não atribuída.** Canvas, agentes, calendário, importação e telas de edição não foram revisados em tela, então uma nota global seria enganosa. Nas telas revisadas (roteiro, pacote de gravação, capas, pacote, referências) não vi falha Crítica pelo critério da skill, mas contraste, foco e tamanho de fonte não foram medidos; isso não é um atestado de acessibilidade.

Tese do fluxo: "tudo só avança com a sua aprovação explícita, por versão". É a coisa mais característica e deve ser mantida; as melhorias abaixo não devem enfraquecê-la.

## O que já funciona (manter)

- ✅ Gate de roteiro por versão+hash com bloqueios explicados em texto (`src/features/production/recordingPackage.ts:39-50`; textos `RecordingPackage.tsx:28-35`). 👁 `03-script-review.png`.
- ✅ Pacote de gravação com fala, hook/CTA, cenas, tópicos, direção de capa e checklist persistidos por versão (`RecordingPackage.tsx:55-98`). 👁 `04-recording-package.png`. Sugestões de B-roll marcadas como "(sugestão)", não fato.
- ✅ Capas locais: três conceitos por formato, estados "Só conceito / Exportada / Desatualizada / Aprovada", cancelamento sem lote parcial (`ThumbnailGallery.tsx:70-72`, `CoversReview.tsx:74-77`). Aviso honesto de que LinkedIn não tem preset (`CoversReview.tsx:12,56-58`). 👁 `05`, `06`.
- ✅ Orçamento com chamadas reais, sem estimar tokens/custo, e retomada que explica o que faz (`ProductionBudget.tsx:8,26,30`; `ProductionDialog.tsx:145`). Bom alinhamento com HIG `feedback.md`: "Show people when a command can't be carried out and help them understand why."
- ✅ Visão de execuções com filtro persistente por workspace (`ExecutionOverview.tsx:18-27`).
- ✅ Biblioteca de referências honesta: "Somente link · conteúdo não acessado", sem análise inventada (`inspiration.ts:241-250`). 👁 `01-references.png`.

## Lacunas priorizadas (máx. 8, duplicatas agrupadas)

Complexidade: B/M/A. "Futuro dono" é sugestão: Sonnet = apresentação/componentes com contrato fechado; Opus = contrato, persistência, coordenador, motor.

### L1 — P1 · Status do conteúdo na Home não acompanha capas, pacote e agendamento
- **Presente (✅):** `ProductionStage` do conteúdo só tem `planning | ready-to-record | recording | editing | video-review | ready | archived` (`src/features/content/model.ts:7`). O coordenador só grava `planning`, `ready-to-record` e `ready` (`production-coordinator.mjs:151,164,257,265`, e `ready` no fim); `editorial-media.mjs` grava `video-review`.
- **Divergência inferida do código (❓ não reproduzida no app; não é bug confirmado):** o `productionStage` do conteúdo nunca recebe valor para `covers-review`, `package-review` ou `schedule` (só `planning`, `ready-to-record`, `video-review` e `ready`), e `HomeProductionPipeline.tsx:9` mapeia `video-review` para a coluna **"Edição"**. Pelo código, a Home mostraria "Edição" enquanto a produção está em capas, pacote e agendamento; "Publicação" só recebe conteúdo `ready`. O coordenador confirmou que `HomeProductionPipeline.tsx:9` e `productionProgress.ts:10-17` são os pontos relevantes. Falta abrir a Home com uma produção nesses estágios para fechar.
- **Problema → ganho:** quem confere a Home vê "Edição" quando só falta aprovar capas; com a projeção pelo `run.stage`, a coluna diz onde a produção está. Base: `feedback.md`: "Consider integrating status feedback into your interface… people get important information without having to take action or leave their current context."
- **Melhoria (⚠):** projetar a coluna a partir do `run.stage` da produção ativa (a fonte que já alimenta `ExecutionOverview` e `productionProgress.ts:10-17`), com colunas "Capas e pacote" e "Agendamento", em vez de usar o campo do conteúdo. Evita novo estado persistido.
- **Critério de aceite:** com produção em `covers-review`, a Home mostra o conteúdo em "Capas e pacote"; em `schedule`/`scheduling`, em "Agendamento"; o número da coluna bate com `ExecutionOverview`; teste de projeção cobrindo todos os estágios de `productionProgress.ts` (nenhum estágio cai em coluna errada); o primeiro passo é reproduzir a divergência com um teste de projeção.
- **Prioridade/complexidade:** P1 · B · **Sonnet** (projeção pura + teste).

### L2 — P1 · Gravação sem teleprompter e sem caminho "sem Notion"
- **Presente (✅):** a fala aparece num `<pre>` rolável (`RecordingPackage.tsx:62`). O gate **exige** Notion confirmado na mesma versão/hash (`recordingPackage.ts:46-48`; coordenador entra em estágio `notion` ao aprovar, `production-coordinator.mjs:269`, e só vai a `recording` depois, linha 165). Sem Notion conectado não há caminho de gravação (❓ não testei o preflight sem Notion; o preflight recebe `notion:` na linha 220).
- **Lacuna (⚠):**
  1. Nada de modo de leitura para gravar: texto grande, rolagem automática com velocidade, espelhamento, tela cheia, cena atual destacada. Quem grava com celular/webcam precisa ler a fala em outra tela.
  2. A cena é só um título de uma linha (`sceneList`, `recordingPackage.ts:54-57`); não há duração, fala por cena, nem cartão de lista de tomadas para imprimir/levar.
  3. Quem não usa Notion está bloqueado. Para uma loja pequena isso é barreira de entrada.
- **Problema → ganho:** hoje a pessoa grava lendo um bloco de texto com rolagem manual; com modo de leitura grava sem tocar no mouse, e sem Notion não fica bloqueada. Base: `designing-for-macos.md`: "support full-screen mode to offer a distraction-free context" e "Handle keyboard shortcuts… keyboard-only work styles".
- **Melhoria (⚠):**
  - a) Botão "Modo gravação" (tela cheia, fonte grande, ritmo ajustável, pausa por barra de espaço), só leitura, sem rede.
  - b) Fala dividida por cena (marcadores no texto aprovado) com contagem estimada, mostrada no modo gravação. A divisão nunca altera o roteiro aprovado (hash).
  - c) Decisão de produto: opção explícita "continuar sem Notion" com registro na auditoria, mantendo o gate de versão/hash local. **Não implementar sem decisão do usuário**: muda a regra "Notion confirmado antes de gravar" aprovada em F01.
- **Critério de aceite:** (a) abrir/fechar não grava nada no estado nem chama IA; rolagem respeita `prefers-reduced-motion` (começa pausada); Esc sai. (b) o hash do roteiro não muda. (c) sem Notion, o app mostra o motivo e oferece a escolha; com a escolha, a gravação libera e a auditoria registra "sem Notion" por versão.
- **Prioridade/complexidade:** (a)+(b) P1 · M · **Sonnet**. (c) P1 · A · **Opus** (contrato do gate, coordenador, preflight, testes), **depende de decisão**.

### L3 — P1 · Escolher quadro da capa sem ver o vídeo (prévia CSS vs capa real)
- **Presente (✅):** o quadro é um campo numérico de segundos (`ThumbnailGallery.tsx:89-90`). A "prévia do conceito" é CSS: círculo tracejado de foco + título (`:74-79`), não o quadro do vídeo. A capa real só aparece depois de exportar (`:80-83`). 👁 `06-covers-exported.png`: card com círculo vazio (placeholder) **e** a capa exportada logo abaixo, mais seis campos; 👁 `06-layout-900-zoom125.png` mostra cada card passando de uma tela.
- **Problemas:**
  1. O texto avisa "O quadro abaixo é só o conceito" (`:61`), correto e honesto, mas o usuário só descobre se o quadro serve **depois de uma exportação FFmpeg** (uma por formato, com cancelamento). Escolher "segundo 1,5" no escuro é o maior atrito do pipeline de capas.
  2. A prévia CSS ocupa o espaço mais nobre do card sem informação real (um círculo), e duplica o título que já aparece na exportada.
  3. Rótulos técnicos: "Foco horizontal: 0.50", "Chamada (kicker)" (`:88,94`). Pela skill `frontend-design`: "Name things by what users will understand… not by how the system is built."
- **Problema → ganho:** hoje cada tentativa de quadro custa uma exportação FFmpeg; com scrubber a escolha é imediata e a exportação só confirma. Base: `entering-data.md`: "offer choices instead of requiring text entry" e "Dynamically validate field values" (o campo de segundos só valida por atributo, sem dizer a faixa); `loading.md`: "Show something as soon as possible" (o card mostra um círculo vazio até exportar).
- **Melhoria (⚠):**
  - a) Seletor de quadro real: um `<video>` do vídeo aprovado (já servido para revisão em `EditReview.tsx:74`) com barra/scrubber e botão "Usar este quadro"; o canvas mostra o quadro atual com título sobreposto **como prévia aproximada**, claramente rotulada ("prévia, a capa final sai da exportação"). Nenhuma exportação para escolher.
  - b) Substituir o círculo e os números por arrastar o ponto de foco sobre o quadro; manter sliders como teclado/acessibilidade.
  - c) Renomear "Chamada (kicker)" → "Texto de apoio (opcional)"; mostrar zoom em %.
  - d) Compactar o card: prévia ao vivo e capa exportada lado a lado (ou alternância), campos em "Ajustar" recolhível.
- **Critério de aceite:** escolher quadro não chama FFmpeg nem altera `inputsHash` até editar de fato; o rótulo "prévia" continua; a invalidação "Desatualizada" (`isStale`, `thumbnailGallery.ts:65-69`) continua intacta e coberta pelos testes atuais; teclado alcança scrubber e foco; sem regressão de `thumbnailGallery.test` (se houver); quadro fora da duração continua rejeitado (`conceptErrors`).
- **Prioridade/complexidade:** a+b P1 · M-A · **Sonnet** para o componente com contrato de `onAdjust` inalterado; **Opus** só se for preciso servir quadros/miniaturas do servidor. c+d P2 · B · Sonnet.

### L4 — P1 · Marca da loja (logo, cor, tema) e textos/títulos por workspace, não por produção
- **Presente (✅):** a marca (`theme`, `accent`, `logoAssetId`) nasce fixa `{dark, #2f6bff}` em cada produção (`production-covers.mjs:28,42`) e o rascunho é salvo **por produção e fonte** (`CoversReview.tsx:23-26`). O logo precisa estar na biblioteca **do conteúdo** (`CoversReview.tsx:35,65`). Não existe cadastro de marca no workspace (❓ busquei `brandKit|brandPreset|workspaceBrand`: nada em `src`, só `logoAssetId` em `model.ts` e `CoversReview.tsx`). Os títulos iniciais vêm de hook/tópico/CTA (`production-covers.mjs:20-27`).
- **Efeito:** uma loja que publica toda semana refaz cor, tema e logo em **cada** produção; o logo precisa ser reenviado para cada conteúdo. 👁 `05-covers-review.png`: "Sem logo" por padrão, azul genérico.
- **Problema → ganho:** a loja refaz logo, cor e tema em toda produção; com a marca no workspace a capa já sai com a identidade. Base: `entering-data.md`: "Get information from the system whenever possible… prefill fields with reasonable default values".
- **Melhoria (⚠):**
  - a) "Marca da loja" no workspace: logo (imagem verificada por sha256, como hoje), cor, tema padrão e fonte opcional; pré-preenche `covers.brand` ao criar produção. Cada produção ainda pode sobrescrever, e a aprovação continua amarrada ao `inputsHash`.
  - b) Presets de título: modelos curtos por loja ("Oferta: {produto}", "Novo: {produto}") com limite de tamanho; só preenchem o campo, o usuário confirma.
  - c) Aviso de legibilidade: título longo cortado/quebrado em 3+ linhas na capa exportada (👁 `06-covers-exported.png` quebra em três linhas no formato 9:16).
- **Critério de aceite:** nova produção traz logo/cor da marca da loja; trocar de workspace troca a marca; logo removido da biblioteca aparece como indisponível e **bloqueia** a exportação com mensagem (hoje: `Escolha um logo de imagem da biblioteca deste conteúdo.`); backup/restore preserva a marca (`backupFormat.ts`); nenhum caminho de arquivo vindo do cliente (invariante atual).
- **Prioridade/complexidade:** a P1 · A · **Opus** (esquema, backup, validação, coordenador) + **Sonnet** para a tela de marca; b/c P2 · M · Sonnet.

### L5 — P2 · Biblioteca de referências: só link + tags; falta coleção, busca útil e ponte com a ideia
- **Presente (✅):** `InspirationReference` tem `sourceUrl`, `title`, `author` manual, `notes`, `tags` (até 12), `asset` local opcional, e `metadataStatus: 'not_collected'` fixo (`inspiration.ts:24-45`). Não há análise real por design: "Nada é baixado, analisado ou publicado automaticamente" (👁 `01-references.png`). "Usar como briefing" preenche a pauta sem IA (`buildBriefingContext`, `inspiration.ts:268`).
- **Lacunas (⚠):**
  1. Sem **Coleção/pasta** nem agrupamento (só tags planas). ❓ Palavras-chave de busca não persistem como coleção: a busca é um filtro de texto (👁 "Buscar referências"), sem salvar.
  2. A referência não registra **o que se aproveitou** (hook, formato, ritmo) de forma estruturada; só `notes` livres (4000 caracteres).
  3. O fluxo seguinte não mostra de qual referência a ideia saiu depois de criada (❓ não vi vínculo referência → topic/produção em `model.ts`).
  4. Uma análise real (transcrever/resumir o vídeo) **não existe e não deve ser fingida**. Qualquer proposta depende de decisão de produto/provedor e de permissão e custo conhecidos, como já registrado em `content-flow-next-backlog.md` ("avaliar um provedor… antes de automatizar descoberta").
- **Problema → ganho:** com 1 referência as tags bastam; com dezenas, coleções e o vínculo "Inspirada em…" evitam reabrir tudo para lembrar a origem de uma ideia. Julgamento próprio, sem referência HIG específica.
- **Melhoria (⚠):** coleções nomeadas (uma referência em várias), busca salva, campo "o que aproveitar" com 3 opções fixas + nota, e vínculo `referenceId` opcional na pauta/produção exibido como "Inspirada em…". Análise real **fora de escopo** até haver decisão.
- **Critério de aceite:** coleção/vínculo persistem no `EditorialState.inspiration` (validado no servidor, `editorial-inspiration.mjs`), sobrevivem a backup merge/replace, e continuam recusando campos extras; remover coleção não apaga referências; status continua "conteúdo não acessado" enquanto não houver coleta real.
- **Prioridade/complexidade:** P2 · M · **Opus** (esquema/validação/backup) + Sonnet (UI).

### L6 — P1 · Retomar/navegar produções sem confusão: status, motivo e próxima ação espalhados
- **Presente (✅):** progresso por fases (`productionProgress.ts`, com próxima ação em texto por estágio), orçamento (`ProductionBudget`), visão de execuções com filtro, retomar com verificação (`ProductionDialog.tsx:145`).
- **Atritos (julgamento próprio + código):**
  1. O diálogo empilha Progresso → Orçamento → Estágio → seção do estágio (`ProductionDialog.tsx:134-137`). O **orçamento fica antes da ação** que a pessoa precisa fazer; 👁 `04`/`07` mostram que a ação (Importar vídeo, Aprovar) fica no fim de uma rolagem longa. Base: `layout.md`: "Make essential information easy to find by giving it sufficient space… don’t obscure it by crowding it with nonessential details" e "Take advantage of progressive disclosure"; para desktop, "Avoid placing controls or critical information at the bottom of a window"; `buttons.md`: "use a button that has a prominent visual style for the most likely action in a view".
  2. "Retomar" pede uma caixa "autorizo reenviar a instrução de IA e consumir novos tokens" (`:145`), mas o orçamento diz que **tokens não são medidos**; as duas mensagens se contradizem em tom (uma promete custo, a outra declara que não o mostra).
  3. As abas do estúdio e a Home mostram a mesma produção com vocabulários diferentes (colunas "Pauta/Pesquisa/Roteiro/Gravação/Edição/Publicação" vs fases "Roteiro/Gravação/Edição/Capas e legendas/Agendamento/Concluído"). Ver L1.
  4. A ação principal do estágio atual e o botão de fechar/retomar não ficam sempre visíveis (👁 `05-covers-review.png`: aprovar só no fim da página).
- **Problema → ganho:** hoje a pessoa rola para achar o botão que destrava a produção; com a ação principal no topo ela resolve e fecha.
- **Melhoria (⚠):** (a) cartão "Agora" fixo no topo do diálogo: estágio, **uma** ação principal (rótulo do próprio estágio), motivo de bloqueio; (b) orçamento recolhido num resumo de uma linha ("3 de 20 chamadas") que abre os detalhes; (c) unificar o vocabulário de fases entre Home, Execuções e diálogo; (d) texto do "Retomar" sem prometer tokens que o app não mede: "Pode repetir a instrução de IA (conta como 1 chamada)".
- **Critério de aceite:** em todos os estágios de usuário (`userStages`, `productionProgress.ts:18`) a ação principal fica visível sem rolar a 1280×720 e a 900×640/125%; as mesmas fases aparecem na Home, no diálogo e nas Execuções; o texto do orçamento e do retomar usam a mesma unidade ("chamadas").
- **Prioridade/complexidade:** P1 · M · **Sonnet** (somente apresentação; contratos intocados).

### L7 — P2 · Revisão final: resumo opcional antes de aprovar o pacote e de agendar
Esclarecimento de intenção: **aprovar o pacote** (`approve-package`, estágio `package-review`: "estas capas e legendas estão certas") e **agendar** (estágio `schedule`/`scheduling`: "publicar nestes horários e contas") são **decisões diferentes**, com gates e rótulos próprios. Este item **não** propõe fundi-las nem trata as duas como a mesma ação. É uma melhoria opcional de conforto, **não** um bug e **não** uma falha de confiança: os gates já impedem divergência de capa (`approve-package` confere a capa aprovada, segundo o relatório de integração).
- **Presente (✅):** `package-review` mostra capa + legenda por rede com "Editar esta entrega" (👁 `07-package-review.png`); `ContentPublications`/`PublicationCalendar` e checagem de entregas incertas existem; horário e contas só entram no passo seguinte.
- **Possível melhoria (⚠, opcional):**
  1. No passo de aprovar o pacote, uma visão comparativa somente leitura (rede · formato · capa · legenda), para conferir tudo de uma vez em vez de rolar cartões.
  2. No passo de agendar, confirmação com o nome exato do que ocorre ("Agendar 3 publicações") e horário/conta por rede. Cada passo mantém o seu verbo ("Aprovar pacote", "Agendar").
  3. "Editar esta entrega" tem texto pequeno em 👁 `07` (tamanho em px **não medido**). Verificação pendente, não achado: `buttons.md` dá como regra geral hit region ≥ 44×44 pt; `accessibility.md` cita 28×28 pt como padrão e 20×20 pt como mínimo no macOS.
- **Problema → ganho:** conferir três redes exige rolar três cartões; um resumo mostra tudo antes de decidir. Base: `layout.md`: "Group related items to help people find the information they want".
- **Critério de aceite:** a visão lista cada rede com a mesma capa aprovada (`assetId`/hash) e a legenda final; nenhum gate muda; "Aprovar pacote" e "Agendar" continuam passos separados; o controle "Editar esta entrega" é medido e, se menor que o mínimo, ajustado.
- **Prioridade/complexidade:** P2 · M · **Sonnet**.

### L8 — P2 · Consistência de texto e acessibilidade nas telas novas
- **Presente (✅/👁):**
  - Termos misturados para a mesma coisa: "thumbnail" (`RecordingPackage.tsx:74`, "Direção da thumbnail"), "capa" (restante) e "cover" no código; "Hook"/"CTA" em inglês numa UI em português (`:65-66`, 👁 `04`, `03`).
  - Rótulos de seção em maiúsculas tracejadas: "REFERÊNCIAS", "1 REFERÊNCIA(S)" (👁 `01-references.png`); a `frontend-design` lista rótulo em CAIXA ALTA e "typographic labels above content" como marcas de template.
  - `Referência(s)` com plural opcional é UX de código.
  - Campo "Quadro (segundos)" aceita número cru; erro só aparece pelo atributo de validação.
- **Problema → ganho:** a mesma coisa com três nomes e erros sem faixa válida fazem a pessoa adivinhar; um glossário e erros que dizem o intervalo reduzem tentativa e erro. Base: `entering-data.md`: "Dynamically validate field values… provide feedback as soon as you detect a problem"; vocabulário consistente é julgamento próprio e `frontend-design`.
- **Melhoria (⚠):** glossário único (capa, gancho, chamada para ação ou "fala final"), plural correto, remover caixa alta onde só decora, mensagem de erro de quadro com a faixa válida ("de 0 a 12,4 s").
- **Critério de aceite:** busca por "thumbnail" não retorna rótulos visíveis em pt-BR; sem caixa alta decorativa nas telas de Estúdio; erros dizem o intervalo válido; sem regressão dos testes UI existentes (`scripts/test-content-flow-integration-ui.mjs`).
- **Prioridade/complexidade:** P2 · B · **Sonnet**.

## Itens verificados que **não** são lacunas (para evitar retrabalho)

- **Notion no pacote e no roteiro:** não é bug; é regra aprovada (F01). Só vira lacuna se o usuário decidir permitir "sem Notion" (L2c).
- **Orçamento/chamadas reais:** correto e honesto (`ProductionBudget.tsx:8,26`). Não propor estimar tokens/custo.
- **Referências sem análise:** correto. Não propor "análise por IA" sem decisão de provedor/permissão/custo.
- **Capa final vs prévia:** já diferenciadas por texto e por selo (`ThumbnailGallery.tsx:61,70-72`). O problema é só a utilidade da prévia (L3).
- **Gate de capa, hash, cancelamento, resultados atrasados:** testados em `tests/production-coordinator.test.mjs` segundo o relatório de integração; não reabrir.

## Ordem sugerida e dono futuro

| # | Item | Prio | Compl. | Dono | Depende de |
|---|---|---|---|---|---|
| L1 | Home segue o estágio real | P1 | B | Sonnet | — |
| L6 | Diálogo: "Agora" fixo, orçamento recolhido, vocabulário único | P1 | M | Sonnet | L1 (vocabulário) |
| L3 | Seletor de quadro real + card de capa compacto | P1 | M–A | Sonnet (Opus se servir quadros) | — |
| L2a/b | Modo gravação + fala por cena | P1 | M | Sonnet | — |
| L2c | Gravar sem Notion | P1 | A | Opus | **decisão do usuário** |
| L4 | Marca da loja por workspace | P1 | A | Opus + Sonnet | — |
| L5 | Coleções/vínculo de referências | P2 | M | Opus + Sonnet | — |
| L7 | Resumo opcional (aprovar pacote e agendar seguem separados) | P2 | M | Sonnet | L6 |
| L8 | Glossário/acessibilidade de texto | P2 | B | Sonnet | — |

Sugestão para aprovação: **L1 + L6 + L8** (baixo risco, só apresentação) primeiro; **L3** em seguida; **L4** e **L2c** exigem decisão e contrato antes de despachar.

## Decisões que cabem ao usuário

1. Permitir gravar sem Notion? (L2c — muda uma regra aprovada.)
2. A marca da loja deve ficar por workspace (proposto) ou por conteúdo?
3. Quer análise real de referências no futuro? Se sim, só com provedor, permissão e custo conhecidos (L5).
