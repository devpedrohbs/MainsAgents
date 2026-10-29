# Rodada 8 — runtime de referências e HyperFrames local

Data: 28/10/2026. Worker backend: `task_a7bcbc73711a`; implementação inicial `ctx_8a84d4feaa01`, fechamento `ctx_6a33cabae634`.

## Resultado e pendências de integração

Implementados backend persistente, contrato tipado, importação nativa, análise visual Claude por imagens MCP e Codex por imagens nativas, aprovação de conhecimento, estudos/kit versionados e render HyperFrames real. O backend foi integrado à UI do outro worker e ao executor de edição existente. **Fonte backend congelada; empacotamento e instalação da 0.3.80 pertencem agora ao worker Claude `ctx_be45573668c1`. Este relatório não afirma instalação concluída. Não houve commit/push por este worker.**

Validações: 15/15 testes novos direcionados aprovados com os dois testes reais de render habilitados; build integrado, typecheck, grafo de empacotamento com 115 módulos e teste Electron da UI aprovados. Uma prova Electron separada gerou e reproduziu o MP4 real pelo endpoint de artefatos.

As duas fixtures de ferramentas MCP que falharam na suíte inicial foram atualizadas com ownership autorizado e passam. A regressão de produção authored também passa. A suíte completa final e a instalação ficam com o worker de entrega; os números da suíte inicial abaixo são histórico, não resultado final.

- `tests/editor-authoring.test.mjs:30`: incluir `get_motion_study_frames`, `submit_reference_analysis`, `get_editing_knowledge`, `motion_study` antes das ferramentas já existentes.
- `tests/claude-editor-transport.test.mjs:95`: lista read-only do reviewer também inclui `mcp__mainsagents_editor__get_motion_study_frames` e `mcp__mainsagents_editor__get_editing_knowledge` antes da lista anterior.
- A regressão inicial de skills em `production-authored-edit` foi corrigida na implementação: manifestos vazios não acrescentam orientação artificial às execuções legadas. Os testes desse arquivo voltaram a passar sem alteração de fixture.

Codex agora também pode fazer análise visual: o host autoriza apenas frames extraídos na raiz da análise, confere extensão, tamanho e SHA-256 e encaminha até 12 imagens pelo `context` da execução existente. O bridge serializa entradas reais `{type:'localImage',path}` no `turn/start`. Sandbox read-only, MCP, apps e delegação continuam desabilitados. A capacidade da UI passa a reconhecer esse adaptador; análise motion reduz a amostragem ao limite de 12 imagens. IDs explicitamente inspecionados pelo provedor e evidências temporais são validados antes de registrar cobertura. Provedores sem transporte de imagem continuam recusados.

Ferramentas de autoria motion continuam no canal editor MCP do Claude; não foram anunciadas como ferramentas nativas do Codex. Conhecimento textual aprovado e consulta HTTP continuam neutros quanto ao provedor. O teste novo usa o bridge HTTP real e um app-server programado local: comprova payload, isolamento e validação, sem inferência paga e sem alegar qualidade de uma análise de modelo real.

Fechamento focado: `node --experimental-strip-types --test --test-concurrency=1 tests/editing-references-codex.test.mjs tests/editing-references.test.mjs tests/editing-references-integration.test.mjs tests/editor-authoring.test.mjs tests/claude-editor-transport.test.mjs tests/editorial-work-bridge.test.mjs`: **30 testes, 29 pass, 1 skip, 0 falhas**. O skip é o render real condicionado ao motor; a prova real anterior continua documentada abaixo e a validação empacotada final será feita pelo worker de entrega. `npm run typecheck` e `node --check` dos três módulos alterados passaram. Os 7 cenários de `production-authored-edit.test.mjs` passaram na rodada focada anterior; nenhuma expectativa desse arquivo precisou mudar.

## Persistência e compatibilidade

- Referências continuam canônicas em `editorial_state.state_json.inspiration.references`, com os mesmos IDs e atualização de notas/títulos/tags visível nos dois caminhos. Não foi criada uma segunda lista independente de vídeos.
- `editing_reference_libraries` mantém metadados por chave `(profile_id,workspace_id)`: pastas, marcadores, versões gerenciadas, análises, orientações, estudos, kit, tarefas, desfazer e manifestos.
- `managedVideo.versionId` foi acrescentado ao contrato/validator/parser antigo. Referências com vídeo gerenciado sobrevivem à leitura/salvamento pelo estado editorial anterior.
- Cópias de vídeos ficam em `editing-references` junto ao banco. Originais não são modificados. Hashes de arquivo são conferidos; vídeos não compatíveis com o browser recebem proxy local separado.
- Importação pelo picker nativo é uma tarefa persistida, com progresso de bytes, cancelamento de streams e preparação de proxy. Não existe operação HTTP de importação por caminho arbitrário.
- Pastas/subpastas têm revisão, proteção contra ciclos e movimento por ID. Excluir pasta move referências para Sem pasta e oferece undo com revisão da biblioteca; alterações posteriores invalidam um undo que não seria seguro.
- Conhecimento aprovado tem histórico de texto/estado; guardar ou descartar observação não aprova uma regra. Aprovar observação via guideline registra a origem e a decisão.
- Estudos mantêm artefatos de revisões anteriores; kit aponta para uma revisão imutável. Uma alteração no estudo não muda o item já aprovado. Render repetido da revisão concluída reutiliza o resultado validado.
- Snapshot/restore de execução inclui `editingLibraries`; trabalho em andamento restaurado vira interrompido, sem reenvio. Ownership de execução não é restaurado como autorização. Backups antigos sem esse campo continuam aceitos.
- Restore do workspace recusa análise/import/render ativo. Os arquivos de vídeo não são embutidos no JSON de backup, assim como outros arquivos locais do app; backup/cópia dos arquivos continua necessário em migrações de máquina.

## Contrato entregue à interface

Arquivos estabilizados cedo: `src/features/references/model.ts` e `api.ts`.

- GET/POST `/api/content/editing-references?profile=...&workspaceId=...`.
- Snapshot: revisão da biblioteca, folders, references, analyses, profiles, guidelines, studies, kit, jobs, agents/capacidade visual, engine e projects/seleções anexadas.
- Comandos de pasta, referência/marcadores, análise, cancelamento, decisão de observação, estilo, estudos, kit e seleção de projeto. Entidades mutáveis usam expectedRevision; requestKey permite replay sem duplicar intenção.
- POST `/context` gera manifesto limitado, salva IDs/revisões e não concede permissões.
- GET/HEAD `/media/reference/:id/:version`, `/media/frame/:analysisId/:frameId`, `/media/study/:studyId/:artifactId`; hash conferido e Range real para reprodução/seek.
- `window.mainsAgentsDesktop.editingReferences.importVideos` é o único caminho renderer → picker → cópia gerenciada.

## Análise visual com evidência

FFmpeg extrai JPEGs temporais reais: estrutura usa 12 amostras; estudo de motion usa de 6 a 24 amostras, conforme intervalo e limite real do adaptador (Codex: até 12). Intervalos aceitos: 0,1 a 120 segundos. A API declara sempre `coverage.kind: sampled` e registra tempos examinados/pendentes. **Não afirma leitura de todos os quadros nem curva/fonte exata sem evidência.**

Claude recebe as imagens por `get_frames` do editor MCP existente; são blocos MCP `type:image` com bytes reais, não JSON de caminhos. O agente salva achados por `submit_reference_analysis`, que não aprova conhecimento. Isso preserva o schema final do CLI: report `not-finalized`, revisão 0, sem simular uma exportação de produção.

Achados são aceitos somente com tempos válidos e IDs de frames efetivamente entregues dentro do intervalo citado. Perfil, revisão da referência e hash da origem são rechecados; mudança/cancelamento impede conclusão tardia. Resultados parciais e cobertura ficam guardados para revisão explícita. Não houve inferência paga na validação: o driver de decisões dos testes foi programado e identificado como simulado; extração, bytes de imagem e serialização MCP foram reais.

## Motor e segurança

- HyperFrames **0.8.212**, GSAP **3.14.2**, instalados por versão exata em `.mainsagents-workspaces/round8-runtime/engine` para prova. O app prepara seu motor gerenciado próprio, sem depender do executável desktop instalado.
- Diagnóstico real verifica Node, FFmpeg, FFprobe e Chrome; status compartilha a consulta em andamento e usa cache para não lançar processos a cada poll. No ambiente testado: Node 24.13.0, FFmpeg/FFprobe 9.0.1 e Chrome headless 152.0.7977.30.
- Preparação via Node/npm sem shell, scripts de instalação desabilitados, Chrome ensure, progresso/cancelamento e verificação final. No máximo dois renders de motion simultâneos; preparação não ocorre durante render ativo.
- O render aceita dados limitados de quatro composições: título, diagrama, callout e comparação. Cores hex, dimensões/fps/duração e textos são validados; texto é escapado. **Não executa HTML/JavaScript livre vindo de referência, modelo ou request.**
- HTML próprio e GSAP local são executados no processo/browser do motor, com CSP restrita, não no renderer privilegiado do app. Na UI a primeira integração reproduz MP4; HTML do projeto só é entregue como download com CSP sandbox/nosniff.
- Processos são iniciados com `shell:false`, argumentos separados e janela oculta. Cancelamento encerra a árvore do processo no Windows; saída é limitada. Não há chamada a conta HeyGen/cloud nem publicação.
- Mídia usa IDs e caminhos derivados em raízes gerenciadas, sem parâmetros de caminho do renderer; resolução real recusa traversal/junctions e outra workspace não pode servir o artefato. Links são somente marcadores, nunca baixados/consultados automaticamente.
- Corrigido um problema real Windows: diretórios compostos por hashes completos geravam cwd excessivamente longo, com ENOTCONN em spawn. Segmentos de armazenamento foram encurtados; o render integrado passou. Erros de pipes também recebem tratamento, sem derrubar o host.

## Contexto e ferramentas do editor

Manifesto com até 8 referências, 24 orientações e 6 itens do kit, limitado a 24 KB de texto. Prioriza perfis selecionados e conserva IDs/revisões. Manifestos ficam ligados à execução. O planejamento recebe o texto em qualquer provedor existente; o host Claude também entrega o conhecimento no contexto de edição.

Ferramentas novas: `get_editing_knowledge`, `motion_study` (create/update/render/status/attach), `get_motion_study_frames` e `submit_reference_analysis`. Somente análise de referência permite submit; só o host disponibiliza imagens/fontes. Agente não recebe operação de aprovar estilo/kit.

Agente pode criar estudo declarativo, pedir render, consultar status, inspecionar um frame verificado e anexar vídeo silencioso à biblioteca real do conteúdo. Estudos novos precisam de inspeção antes do attach; itens do kit já aprovados podem ser reutilizados. Mutação do estudo fica vinculada à execução que o criou. O asset retornado pode entrar em `storyboard.assets` e em layer de vídeo do montador existente.

Preservados cortes → visual → SRT, congelamento de ordem/duração/voz, fatos do storyboard e bloqueios de ajuste localizado. Motion não cria nem desloca voz e não libera SFX automaticamente. Recursos avançados de autoria HTML livre, reprodução exata de qualquer referência, keyframes visuais embutidos, importação automática de links e voz gerada não fazem parte desta primeira integração.

## Provas e comandos

```powershell
$env:MAINSAGENTS_HYPERFRAMES_HOME=(Resolve-Path .mainsagents-workspaces/round8-runtime/engine).Path
node --experimental-strip-types --test --test-concurrency=1 tests/editing-references.test.mjs tests/editing-references-integration.test.mjs tests/hyperframes-runtime.test.mjs
npm run typecheck
node scripts/check-build-files.mjs
npm run build
npx electron scripts/test-editing-references-ui.mjs
npx electron hyperframes-local-fixture.mjs
npm test
```

Resultados e artefatos:

- `final-runtime-tests.log`: 15/15, incluindo importação de cópia sem alterar original, frames reais entregues por MCP, aprovação explícita/replay, contexto, kit imutável, render e asset silencioso real do conteúdo.
- `full-suite.log`: 867 / 863 pass / 2 skip / 2 falhas de snapshots MCP, descritas acima.
- `targeted-regression.log`: produção authored voltou a passar; somente lista exata de tools estava desatualizada.
- UI no dist integrado: `.mainsagents-workspaces/editing-references-ui/1793209286154`, resultado `{ok:true,engine:not-configured}`; dados sintéticos, sem modelo real. O teste inclui uma análise semeada para exercitar revisão, explicitamente documentada no fixture do worker de UI.
- Render + reprodução: `.mainsagents-workspaces/round8-runtime/proof-1793209786578/proof.json` e `playback.png`, screenshot visualmente inspecionado com texto e diagrama visíveis.
- MP4: 3 s, 640×360, 24 fps, H.264, sem áudio, 67.245 bytes. SHA-256 `b8d2d09737013f34019348b9e718b918d2e32a1bc79240c82a30ac245143a6b8`. Dois renders da composição produziram o mesmo hash; testes também decodificam frames em tempos diferentes e verificam diferença.
- Fixture Electron usou perfil isolado, backend real, streaming por IDs, carregamento de metadata e avanço de currentTime antes de capturar. Não abriu o app pessoal nem iniciou trabalhos pessoais.

Logs citados ficam em `.mainsagents-workspaces/round8-runtime`, fora do commit. O build integrado foi feito uma vez depois do congelamento da UI; mudanças finais de backend/segurança não alteram o renderer compilado.

## Arquivos deste worker

Novos: `hyperframes-engine.mjs`, `hyperframes-local-fixture.mjs`, `editing-reference-store.mjs`, `editing-reference-runtime.mjs`, `editing-reference-analysis.mjs`, `editing-knowledge-context.mjs`, `src/features/references/api.ts`, `src/features/references/model.ts`, `tests/editing-references.test.mjs`, `tests/editing-references-integration.test.mjs`, `tests/editing-references-codex.test.mjs`, `tests/hyperframes-runtime.test.mjs` e este relatório.

Fechamento adicional autorizado: `codex-workflow-runtime.mjs`, `editing-reference-analysis.mjs`, `editing-reference-runtime.mjs`, `tests/editing-references-codex.test.mjs`, `tests/editor-authoring.test.mjs`, `tests/claude-editor-transport.test.mjs` (expectativa transcript.listed completada pelo worker Claude) e este relatório. `hyperframes-engine.mjs` e seu teste receberam também a correção de leitura do doctor com stderr pelo worker Claude durante o fechamento de entrega.

Alterados nesta rodada: `content-workflow-bridge.mjs`, `desktop-main.mjs`, `desktop-preload.cjs`, `desktop-state-store.mjs`, `editor-authoring.mjs`, `editor-host.mjs`, `editorial-execution-backup.mjs`, `editorial-inspiration.mjs`, `production-coordinator.mjs`, `src/app/desktop.d.ts`, `src/features/content/inspiration.ts` e `package.json` (inclusão dos cinco módulos do runtime no pacote).

UI/rotas/estilos e `scripts/test-editing-references-ui.mjs` pertencem ao outro worker. Mudanças preexistentes de Uso/Board/Claude account, versão/lockfile e documentação anterior foram preservadas; não são atribuídas a este backend.

Fontes primárias verificadas: [rendering](https://hyperframes.heygen.com/guides/rendering), [agent harness](https://hyperframes.heygen.com/developers/harness-tool-context), [SDK preview](https://hyperframes.heygen.com/sdk/guides/canvas-integration) e ajuda da CLI instalada `hyperframes --help`, `render --help`, `browser --help`, `doctor --json`.
