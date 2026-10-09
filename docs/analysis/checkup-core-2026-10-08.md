# Checkup core/reliabilidade — MainsAgents 0.3.56 (08/10/2026)

Estado: **lista para aprovação**. Nada foi implementado, instalado, commitado ou rebuildado. Auditoria somente de leitura no código atual (`package.json` = 0.3.56), com conferência de cada afirmação no fonte, não nos relatórios antigos.

## Resumo (5 linhas)

1. O núcleo de confiabilidade está sólido: revisão/`resume`/`cancel` com checagem de versão, fingerprint de preflight, recibos de publicação verificados contra o provedor, backup com validação e provider por etapa sem fallback silencioso.
2. Publicação agendada já tem consulta manual (`reconcile` + botão “Consultar resultado”); falta só atualização automática/ao abrir e aviso de falha (melhoria opcional, item 1).
3. Lacuna confirmada: **Notion é obrigatório** para iniciar e liberar a gravação; não existe modo local.
4. Diagnóstico incompleto: Whisper e navegador do Remotion são checados pelo backend, mas a UI só mostra FFmpeg/ffprobe; seleção de quadro da capa é só um campo numérico, e o uso real do Claude é descartado.
5. Wizard completo não compensa agora; um checklist “pronto para produzir?” reaproveitando preflight/diagnóstico sim. Limites no fim.

## Legenda

BUG = comportamento errado confirmado no código. LACUNA = ausência confirmada de capacidade/caminho. RISCO = plausível, **não testado**. MELHORIA = valor, sem defeito. Complexidade S/M/L. Dono: Sonnet (escopo fechado) ou Opus (decisão de arquitetura/estado).

## Itens priorizados (8)

### 1. Atualização automática do resultado de entrega agendada — MELHORIA (opcional) · S-M · Opus
- **Já implementado (consulta manual):** `reconcile` em `editorial-publication-execution.mjs:90-99` lê o provedor (`provider.read`), verifica o resultado e grava `live.status = result.status==='draft'?'approved':result.status` com novo recibo (`checkedAt`). `verifiedZernioPublication` (`zernio-publication-connector.mjs:20`) e `verifiedPublication` (`publication-connector.mjs:50`) suportam `published`/`failed`. `ContentPublications.tsx:87` expõe o botão “Consultar resultado” que aciona `reconcile`. A restrição `draft|scheduled` (`editorial-publication-execution.mjs:41`) vale só para o envio inicial (`submit`), que não reconcilia — é intencional. `Flow.tsx:103` contar `scheduled` como confirmado também é intencional.
- **O que falta (não é defeito):** a consulta é sempre manual. Não há atualização automática ao abrir a tela/entrega agendada nem notificação de falha. Não validei em runtime/rede se `reconcile` cobre todo caso de `scheduled`→`published/failed` por provedor; só li o trecho citado.
- **Proposta opcional:** ao abrir Publicações, chamar a consulta somente leitura para entregas `scheduled` vencidas (throttle) e sinalizar `failed` na UI/notificação. Sem nova escrita externa.
- **Aceite:** com provedor fake, abrir a tela atualiza `scheduled` vencida para `published`/`failed`; erro/ambíguo mantém o estado e “não confirmado”; sem escrita externa.

### 2. Notion obrigatório para produzir — LACUNA/decisão de produto · L · Opus
- **Evidência:** `production-preflight.mjs:50-52` marca `blocker` se o destino Notion não está habilitado; `production-coordinator.mjs:154-165` (etapa `notion`) só libera `recording` após o card confirmado; `:231` (`start`) exige “destino Notion”; `:278`/`:314` exigem `recordingReady` (roteiro aprovado **e** confirmado no Notion). O texto do roteiro (`:152`) promete criar o card só após aprovação.
- **Impacto:** quem não usa Notion, ou está sem conexão, não produz. O gate de roteiro com hash já existe e independe do Notion, então a dependência é de contrato, não técnica.
- **Solução/escopo:** modo “local” explícito por fluxo: aprovação do roteiro libera a gravação sem job Notion; `notion` vira etapa opcional (pular/registrar depois). Preservar hash, auditoria e o caminho Notion atual intacto.
- **Aceite:** preflight sem Notion não bloqueia no modo local e mostra o aviso; produção completa até o pacote sem tocar no Notion; trocar para Notion depois não duplica card; testes do coordenador existentes continuam verdes.
- **Nota:** é decisão sua se Notion deve continuar sendo o padrão.

### 3. Diagnóstico oculta Whisper e navegador do Remotion — LACUNA · S · Sonnet
- **Evidência:** `editorial-media.mjs:167` devolve `transcribe`, `animate`, `transcribeReasons`, `animateReasons`. Nenhum arquivo em `src/` consome esses campos (grep). `RuntimeDiagnostics.tsx:25/28` tipa só `{ffmpeg,ffprobe}` e `runtimeDiagnosticsView.ts:65-70` só monta linhas de FFmpeg/ffprobe, com a ação “instale o FFmpeg”.
- **O que já existe (não é lacuna):** Whisper `ggml-base` é empacotado (`package.json:130`) e validado por sha256 (`editorial-transcribe.mjs:62-63`); o Chrome/Edge do sistema é resolvido sem download (`editorial-remotion.mjs:359-370`). O gap é de **visibilidade**: se faltar Chrome/Edge ou o motor de transcrição, o usuário só descobre ao falhar a etapa. FFmpeg segue vindo do PATH (não é empacotado); só há aviso (`production-preflight.mjs:57`).
- **Solução/escopo:** adicionar linhas “Transcrição local” e “Animações (navegador)” em `mediaRow`, com os motivos já fornecidos pelo backend. Não empacotar FFmpeg nesta rodada (decisão de licença/tamanho separada).
- **Aceite:** capacidades simuladas falsas aparecem como “atenção” com motivo; tudo disponível aparece “pronto”; teste de view puro em `tests/runtime-diagnostics-view.test.mjs`.

### 4. Seleção de quadro da capa só por segundos digitados — MELHORIA · M · Sonnet (com revisão do endpoint)
- **Evidência:** `ThumbnailGallery.tsx:89-90` é um `<input type="number">`; os padrões são frações fixas da duração (`production-covers.mjs:23-26`: 0,5/0,15/0,85). `suggestCandidateFrames` (`editorial-thumbnails.mjs:694`) e `extractFramePreview` (`:728`) existem e têm tipos (`.d.mts:117,120`), mas **só aparecem em testes/scripts** — nenhum endpoint de bridge nem componente os usa (grep).
- **Impacto:** o usuário escolhe a capa às cegas; só vê o resultado depois da exportação.
- **Solução/escopo:** endpoint somente leitura que devolve quadros sugeridos e um preview pequeno por instante (já com validação de origem/hash do engine), e UI com miniaturas clicáveis que preenchem o timestamp. Sem IA.
- **Aceite:** abrir a galeria mostra até 6 sugestões; clicar atualiza o conceito e invalida artefatos antigos pela assinatura existente; preview respeita rotação/SAR; falha de FFmpeg mostra erro sem travar a edição manual.

### 5. Vídeos HDR comuns (iPhone/HLG/PQ) — RISCO, não testado · S (investigação) · Opus
- **Evidência:** nenhum tratamento de `color_trc`, `smpte2084`, `arib-std-b67`, `bt2020`, `zscale`/`tonemap` em `editorial-thumbnails.mjs`, `production-covers.mjs`, `editorial-media.mjs` (grep). Rotação e SAR são tratados (`editorial-thumbnails.mjs:611-622`, `:633`), então o autor já cuidou de orientação, não de cor.
- **Impacto possível:** quadros extraídos e capas de vídeos HDR podem sair lavados/acinzentados, e o export reencodado pode perder a sinalização. **Não verificado** — não havia vídeo HDR de exemplo e não rodei FFmpeg.
- **Solução/escopo:** primeiro um probe com 1 clipe HDR curto fornecido por você (frame + capa + export), registrando o resultado. Só depois decidir `tonemap`/aviso.
- **Aceite do probe:** relatório com `ffprobe` do clipe, quadro extraído lado a lado com o SDR e veredito objetivo.

### 6. Uso real do Claude é descartado; orçamento só conta chamadas — MELHORIA · S-M · Sonnet
- **Evidência:** `claude-code-bridge.mjs:280-285` trata o evento `result` apenas para texto e erro; `production-budget.mjs:41` devolve `tokens:'unavailable'`. A medição é por chamadas/tentativas (`production-budget.mjs:2`). O Codex tem endpoint de uso (`codex-bridge.mjs:241` + `CodexUsagePopover`), o Claude não.
- **Limite:** **não confirmei** quais campos de uso/custo o `result` do Claude CLI instalado devolve; não rodei IA. Antes de implementar, capturar um trace local real de uma chamada curta e só persistir o que vier, sem estimar.
- **Aceite:** quando o CLI informa uso, ele é guardado por chamada e exibido como “reportado pelo CLI”; quando não informa, continua “indisponível”; nada derivado/estimado.

### 7. Onboarding: checklist “pronto para produzir?” em vez de wizard — MELHORIA · M · Sonnet (depois dos itens 2 e 3)
- **Evidência:** `WelcomeGuide.tsx` tem 2 passos, só `/api/codex/health` + criar agente (contador “x/2”); ignora Claude, FFmpeg, Notion, Whisper e contas de publicação. O preflight (`production-preflight.mjs`) e o diagnóstico já calculam quase tudo isso sem efeitos colaterais.
- **Parecer:** wizard multi-tela **não vale** agora; seria duplicar o preflight. Vale um bloco de progresso que reutilize o mesmo relatório e leve a Configurações. Branding de workspace: só existe marca por capa (`production-covers.mjs:43-47`: `theme`, `accent`, `logoAssetId`); não há perfil de marca/voz do workspace nem uso dele nos prompts — **adiar**, precisa de decisão de produto.
- **Aceite:** primeira execução mostra passos reais (provedor, agente, FFmpeg, destino de publicação) com estado ok/atenção/não verificado; nada novo faz chamada de IA.

### 8. Higiene: backups sem poda e descrição defasada — MELHORIA · S · Sonnet
- **Evidência:** a cada troca de versão grava `workspace-before-<v>-<ts>.json` sem limite (`desktop-state-store.mjs:20-24`); hoje 21 arquivos, ~2,5 MB em `~/.mainsagents/storage/backups`, então sem urgência. O backup guarda linhas de estado, não mídia. `package.json` ainda descreve “powered by Codex”.
- **Solução:** manter os N mais recentes (ex.: 10) mais o primeiro de cada minor; corrigir a descrição.
- **Aceite:** poda nunca apaga `workspace-latest.json` nem o backup da versão atual; teste com diretório temporário.

## Verificado e **sem lacuna** (não reabrir sem indício)

- **Provider por papel:** cada etapa roda no provedor do agente configurado, sem fallback (`production-runtime.mjs:3-4`, `production-preflight.mjs:29,39`). O seletor “Gerar com” do chat (`ChatPanel.tsx:741`) cria sessão com provedor próprio; a sessão apenas espelha mensagens (`production-coordinator.mjs:54`). RISCO baixo, não testado: sessão de origem com provedor diferente do agente de produção pode confundir a leitura do histórico.
- **Resume/cancel/versão:** `command` exige `p.revision===input.revision` (`production-coordinator.mjs:241`), preflight carrega fingerprint (`:233`), edição de roteiro invalida aprovação e jobs Notion pendentes (`:253-258`). Produção restaurada de backup **não** retoma sem nova autorização (`:243`) — decisão consciente.
- **Backup:** restauração recusa quando há execução ativa, operação de provedor incerta, produção em etapa automática (`desktop-state-store.mjs:67-75`) e verifica revisões esperadas (`:77-78`).
- **Publicação externa:** verificação estrita do post contra a aprovação (`zernio-publication-connector.mjs:15-23`), upload com hash antes/depois (`publication-media-upload.mjs`), estado “incerto” sem recriar post. A cobertura real é clara: nativo só LinkedIn/Instagram/TikTok, YouTube só planejamento (`ContentPublications.tsx:82`, `editorial-publication-execution.mjs:53`).
- **Conta/cloud:** o “servidor de conta” é local em `127.0.0.1` dentro do `userData` (`desktop-main.mjs:360`) e **não sincroniza dados**; Google depende de `googleClientId` (variável `MAINSAGENTS_GOOGLE_CLIENT_ID` ou `desktop-config.json`, `desktop-main.mjs:76`); o valor vazio no `desktop-config.json` do repositório **não prova** a configuração atual do ambiente/runtime, que não verifiquei (nenhum segredo lido ou impresso). A UI trata a ausência (`AccountGate.tsx:22,50`). Perder o perfil Electron perde a conta (mitigado pelo código de recuperação); os dados de trabalho ficam em `~/.mainsagents/storage`. O nome “cloud” é enganoso, mas não há defeito.
- Logs na raiz (`debug.log`, `desktop-launch.stderr.log`) são antigos (crashpad/lock de 24/09 e 06/10); `~/.mainsagents/storage/startup.log` da 0.3.56 não tem erro.

## Limites desta auditoria

- Leitura de código e grep; **não** rodei testes (suíte 392/392 de ontem mantida, sem indício de regressão), build, FFmpeg, Whisper, IA, Notion nem provedores. Nenhuma conta/rede foi acessada.
- Itens 5 e 6 dependem de dados reais (clipe HDR; trace do Claude CLI) que não existem aqui; estão marcados como não testados.
- Não li os arquivos `.tsx`/`.mjs` inteiros; algumas linhas longas foram cortadas na leitura. Números de linha são do working tree atual (há mudanças não commitadas).
- Custo/uso real não foi estimado; só o que o código já mede (chamadas) foi descrito.
- Correção de auditoria: item 1 reclassificado de LACUNA para MELHORIA após revisão do coordenador (consulta manual já existe).
- Ordem sugerida: 3 → 4 → 2 (decisão sua) → 7; 1 opcional; 5 e 6 só após dados reais; 8 quando conveniente.
