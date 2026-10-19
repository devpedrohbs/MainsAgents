# Edição rica na primeira entrega, caminho automático do arquivo e atualização local 0.3.62 (frente C, 12/10/2026)

Orca `task_754c21a357a1` / `ctx_ae514bf088e7`. Todo o código, os testes e os scripts desta frente foram feitos pelo Claude Code. O Codex coordenou e revisou. Esta frente integra o trabalho já congelado de A (motor de storyboard e Remotion, `editing-ai-motion-engine-2026-10-12.md`; A2: bundle atômico) e de B (Claude como editor com ferramentas locais, `editing-ai-claude-authoring-2026-10-12.md`; B3: revisão). As alterações locais anteriores foram preservadas. Não houve commit, push, publicação, API paga, conta externa nem vídeo pessoal.

> O status final de testes, build, pacote e instalação está na seção 7, preenchida ao fim da rodada.

## 1. Causa comprovada da entrega "básica, sem Remotion"

Os dados reais foram lidos só como metadados: contagens, status e contagem de palavras-chave. Nenhum texto de conversa foi lido. Fonte: `~/.mainsagents/storage/workspace-state.sqlite`.

- `production_runs = 0` e `editorial_media_jobs = 0`. O pipeline de edição do app (FFmpeg + Remotion) **nunca rodou** para o usuário.
- `agent_delegation_jobs = 3` (08/10, 10/10 e 12/10 18:42). Todos são `editor-de-conteudo → editor-de-video` via `mainsagents_delegate`, com o provedor **Codex**, status `completed` e um arquivo anexado. Nos resultados, `remotion` aparece 0 vezes e `ffmpeg` aparece 1 vez em cada.

O caminho real do usuário é **chat de conteúdo → handoff → agente Editor de Vídeo**. Na 0.3.61 esse handoff era só um turno de CLI de texto: o agente cortava com FFmpeg por conta própria e devolvia prosa. Nenhum motor de motion entrava, e o Claude não via o vídeo.

Causas secundárias confirmadas no código e corrigidas:
1. `planSmartEdit`: quando o motor faltava ou o motion falhava, o motion era descartado em silêncio. As animações eram sempre os 3 overlays fixos.
2. As imagens da biblioteca (`assetFiles`) não chegavam ao `animate`. Por isso as imagens dos explicativos nunca apareciam.
3. Os padrões eram `editMode` básico na gravação e no import.
4. A UI dizia "nenhum agente vê a imagem" e mostrava o provedor do agente editor em vez de quem dirigia a edição.
5. O caminho do arquivo se perdia: o `FileDeliveryCard` só mostrava o nome, e o recibo do export de mídia não aparecia.

## 2. Arquitetura entregue (C)

```
chat de conteúdo ──mainsagents_delegate──► native-agent-delegations (rota "engine" p/ o editor de vídeo)
RecordedEntry / ProductionDialog ─────────► production-coordinator.startRecorded / command
                                             │  diretor da edição por função (padrão Claude Code; Codex/agente explícitos)
                                             ▼
                         planAuthoredEdit ── openEditorSession (B) ── editor-host (C) ── editorial-media (C)
                                             │                              │ fatos (A) · QA pré-render (A) · gate de motion
                                             │                              ▼
                                             │                   Whisper / FFmpeg / Remotion stills·prévia·MP4 (A)
                                             ▼
                        export único (requestKey) → delivery-receipts (sha256 + caminho absoluto) → mensagens nos 2 chats
```

### Pontos principais

**Handoff → motor.** Um vídeo entregue ao editor de vídeo (pelo nó do fluxo ou pela identidade do agente) passa a rodar o pipeline do app. O pedido no chat já autoriza a edição local, sem popups. O resultado vai ao LLM de origem **sem caminho**. O usuário vê o recibo nos dois chats.

**Diretor por função.** O padrão do espaço é Claude Code. A escolha é explícita e visível ("Quem dirige os cortes e o motion"), e os agentes e conversas existentes não mudam. Se o Claude estiver indisponível, a edição para e mostra o motivo, sem trocar de provedor.

**Editor com ferramentas (contrato B), integrado ao host C:**
- frames reais da fonte e da prévia;
- `write_plan` validado com:
  - cortes e storyboard de A;
  - `segmentsHash` vinculado pelo host (o modelo não consegue calculá-lo);
  - prova de fatos (`storyboardFactProblems` com transcrição, briefing e textos digitados pelo usuário);
  - **gate de motion pedido** (plano só com cortes, ou com cenas vazias, é recusado);
  - **QA pré-render** (`resolveAnimations` + `storyboardReport` de A, puros, sem render). O que o export recusaria é recusado já no `write_plan`, dentro do orçamento de revisões;
- prévia e stills Remotion reais (só as cenas pedidas);
- `finalize` único → export local idempotente.

**Retomada e estado:**
- O estado de autoria fica preso a epoch **e** autoridade. Um ajuste, uma troca de diretor ou um accept-basic abre sessão nova, com o plano anterior só como referência.
- O checkpoint é salvo a cada evento. A sessão fechada é esquecida.
- O binding é relido do banco a cada chamada.
- Decisões que descartam o export cancelam o render antigo.

**Sem degradação silenciosa.** Quando o motion pedido não pode ser aplicado (motor ausente, falha, QA ou plano sem motion), nada é exportado, o original fica intacto e aparecem o motivo e a escolha explícita "Continuar sem motion". Não surgem novos popups por efeito ou cena.

**Handoffs repetidos:**
- A repetição do pedido **em andamento** é anexada ao mesmo run, sem segundo render.
- Todo pedido novo depois da entrega é um ajuste (nova epoch, arquivo novo), mesmo com texto igual a um pedido antigo.
- Um pedido diferente durante o render é recusado com o motivo.
- Os vínculos handoff→run ficam em `production_delegation_links`, fora da linha do run: anexar não invalida um run em andamento. Esse bug real foi achado pelo teste.
- O link só é criado com um `revise-video` bem-sucedido.
- Um chat genérico sem `contentId` reusa o conteúdo e o run do mesmo vídeo.

**Observador do handoff:**
- Só completa com recibo do **mesmo sha256** do vídeo de saída.
- Um render longo devolve ao LLM "ainda renderizando", e o observador continua acompanhando. Isso não é tratado como falha.

### Caminho automático (recibo do host)

O `delivery-receipts.mjs` emite o recibo só depois de `stat` + sha256 do arquivo final. Parciais, falhas e resultados tardios não geram recibo, e cada recibo pertence a um perfil.

Ele cobre:
- vídeo da produção;
- legendas gravadas;
- versão ajustada;
- export de mídia;
- handoff.

O recibo traz nome, caminho absoluto, tamanho, sha256, versão e `producedBy`, que é o **diretor efetivo** (por exemplo, Claude) e não o provedor antigo do agente.

**Retentativa sem re-render.** Se o recibo falhar (erro transitório), a mensagem fica e o host tenta de novo (`pendingReceipts`) até anexá-lo.

**UI:**
- `DeliveryReceiptCard`: caminho completo, copiar caminho, abrir e mostrar na pasta. Abrir e mostrar reverificam os bytes no host.
- `ContentMediaEditor` mostra o recibo do export.
- `FileDeliveryCard` mostra o caminho completo verificado e "Copiar caminho" depois que o app verificou o arquivo. O caminho escrito pelo agente nunca é tratado como entrega.

O contexto do LLM continua sem caminhos (`productionChatContext.deliveredFile` traz só nome e versão).

**Nome do arquivo.** As entregas novas se chamam `<nome-do-original>-editado-N.mp4` (antes `export-N.mp4`). Ficam sempre na pasta do job, e o original nunca é sobrescrito.

## 3. Arquivos (ownership C)

- `production-coordinator.mjs`:
  - planAuthoredEdit (epoch/autoridade, gate, QA, binding, checkpoint, forget);
  - receipts (diretor efetivo, retentativa);
  - startDelegatedEdit (links, dedup, ajuste, chat genérico);
  - dropVideoJob e textos.
- `editor-host.mjs`: fatos, `segmentsHash`, `hasVisibleMotion`, QA pré-render, `sceneIds`, binding relido, `previousPlan`, `loadCheckpoint` por autoridade.
- `editorial-media.mjs`: `sceneIds`/`maxImages` nos stills, `exportBase`.
- `native-agent-delegations.mjs`: observador com recibo do mesmo sha e detach honesto. A linha `kick()` do engine foi corrigida pelo B3, com autorização do root.
- UI:
  - `ProductionDialog.tsx` (diretor real por papel, texto do modo automático);
  - `RecordedEntry.tsx` (quem vê frames);
  - `FileDeliveryCard.tsx`;
  - `ContentMediaEditor.tsx`;
  - `features/content/model.ts` (tipo do recibo do job);
  - `productionProgress.ts`.
- Pacote:
  - `package.json`: `build.files` + 5 módulos novos (`editorial-storyboard`, `editor-authoring`, `editor-host`, `delivery-receipts`, `delivery-receipts-ipc`); `desktop:dist` roda `build-remotion-video.mjs --release` (A2); versão 0.3.62;
  - `scripts/test-packaged-media.mjs` usa `resolveRemotionBundle` (layout versionado).
- Testes e evidências: `tests/production-authored-edit.test.mjs` (novo), `scripts/editing-upgrade-evidence.mjs` (novo).

## 4. Testes

### `tests/production-authored-edit.test.mjs`: 6 casos, FFmpeg real

O que é simulado: o modelo (roteiro de chamadas de ferramenta), a transcrição (ausente) e o animator (cópia + stills FFmpeg). O que é real: o `editor-authoring` de B, o host, a mídia e os recibos.

1. Handoff do chat Codex → diretor Claude com ferramentas → plano com número inventado ("7 dicas") recusado pela prova de fatos → plano corrigido → prévia → 6 stills → export único → recibo com caminho absoluto. O recibo aparece no chat de origem genérico (via `mergeProductionSessions`) e no chat do editor, com `producedBy: claude`, original intacto e resultado do LLM sem caminho.
2. Pedido repetido durante o render: anexado, 1 turno Claude e 1 render. Depois ajustes A, B e A de novo: 4 epochs e 4 arquivos (`version` 1..4), checkpoint por epoch e autoridade, `previousPlan`.
3. Pedido diferente durante o render: recusado com o motivo.
4. Motion pedido com plano só de cortes ou com cenas vazias: recusado, nada exportado, run bloqueado com "original preservado".
5. Recibo que falha uma vez: tentado de novo sem segundo render; o handoff só completa com ele.
6. Ajuste cujo `revise-video` falha: nenhum link é criado. Repetir o mesmo job aplica o ajuste e gera um arquivo novo, nunca o anterior.

### Regressões focadas

`delegated-edit-engine`, `production-coordinator`, `delivery-receipts`, `native-delegations`, `editor-authoring`, `claude-editor-transport`, `production-editor-runtime`, `editorial-media`, `smart-edit-media`, `storyboard`, `edit-preview-media` e `motion-media`: todos verdes.

### Suíte global, build e pacote

Ver seção 7.

## 5. Evidências REAIS do pipeline (`docs/analysis/editing-ai-upgrade-2026-10-12/`)

Rodado com `node scripts/editing-upgrade-evidence.mjs <demo>`. É o caminho completo do app: bridge → coordinator → editor-authoring → editor-host → Whisper local, FFmpeg e **Remotion reais** → recibo.

O "modelo" é um roteiro **declarado** que reproduz os storyboards autorados pelo Claude na rodada A. Não houve inferência nova. A execução real do Claude CLI foi provada por B2: `claude-sonnet-5-5`, 11 turnos, 6 imagens, 3/3 cenas.

| Demo | Rota do app | Formato | Resultado | Recibo |
|---|---|---|---|---|
| `edicao-creator-9x16` | entrada gravada (UI de produção) | 1080x1920 | video-review em 92 s; 5 cenas *creator*, 4 cortes, 8,6 s removidos (34,3 → 25,7 s), áudio tratado | `90630ebc…`, `producedBy: claude`, original intacto |
| `edicao-handoff-16x9` | chat → `mainsagents_delegate` → editor de vídeo | 1280x720 | storyboard vertical **recusado no `write_plan` pela QA** (`metodo/steps captionBandOverlap`); o roteiro elevou a caixa (1 revisão); prévia, stills e MP4 em 84 s | `9c52afb6…`, `producedBy: claude`, o LLM de origem recebeu o resultado sem caminho |

**Antes da QA pré-render**, a mesma fixture horizontal só falhava no MP4 final (`qa_failed`). O run ficava **bloqueado, sem vídeo simples**, com o original preservado. Isso prova a regra de não degradar em silêncio e motivou trazer a QA para o `write_plan`.

**Cada demo contém:**
- `report.json`: ferramentas, tempos, plano, recibo e probe;
- `final.mp4`;
- `final-contact.jpg`;
- `final-sceneN.jpg`;
- `seen/`: as imagens exatas que o editor recebeu (frames da fonte, frames da prévia e stills Remotion).

**Demos A e "antes":** os três tratamentos (*creator* 9x16, *editorial* 16x9, *technical* 9x16) e o "antes" do motor legado, nos dois temas, ficam em `editing-ai-motion-engine-2026-10-12/` e não foram renderizados de novo, por decisão do root.

**Observação para A, sem bloqueio:** no *creator*, no meio da entrada, a palavra destacada "RÁPIDO" aparece parcialmente coberta pelo marcador (`final-contact.jpg`, 2º quadro). Os quadros finais são legíveis.

## 6. Limites honestos

- A QA visual do editor é interpretação do modelo. A QA medida é a de A: geometria, área segura, faixa de legenda, sobreposição e contraste. A caixa do "rosto" é heurística.
- O handoff do chat edita no enquadramento original. A ferramenta de handoff não tem campo de formato, e o 9:16 vem da UI de produção. O app não infere formato a partir do texto.
- As evidências reais usam um roteiro de ferramentas no lugar do modelo. A execução com o Claude real é a de B2.
- As fontes são do sistema (Windows).
- O caso real do usuário não foi escolhido: falta o vídeo ou link indicado por ele e a autorização específica.

## 7. Status final (suíte, build, pacote, QA, backup, instalação)

Rodado depois dos freezes A2 e B3.

**Suíte global.** `npm test` (com mocks onde o teste declara): **622/622**, 0 falhas.

**Build.**
- `tsc -b` limpo.
- `npm run build` OK: bundle Remotion versionado `13a56b63b4a7cac4`, Whisper preparado.

**Pacote 0.3.62** (`--publish never`, em diretório isolado `release/r62`):
- comandos: `build-remotion-video.mjs --release` → `check-build-files` (86 módulos, 0 faltando) → `electron-builder` → `check-desktop-release`;
- instalador `release/r62/MainsAgents-Setup-0.3.62.exe`, sha256 `31d5ddc2…3dcb`;
- `app.asar` `3a59b825077a81aadbbb7d744850f8b252d41549b54397a2786852039536a559`.

**QA do pacote** (Electron oculto, perfil descartável):
- `PACKAGED_MEDIA_OK`: render Remotion **real** a partir do asar, com bundle versionado e ffprobe/compositor em `asar.unpacked`.
- Os 9 exports novos carregam do asar (`ASAR_MODULES_OK`).
- `PACKAGED_CONTENT_SESSIONS_OK`.
- UI de entrega (runner de D, `scripts/test-editing-delivery-ui.mjs`, cliques e LLM simulados, clipboard/shell interceptados): **50/50 no dist de fonte e 50/50 no asar r62** (`--require-media-export`). Evidências em `.mainsagents-workspaces/editing-delivery-ui/`. Cobertura:
  - mesmo recibo nos chats de origem e do editor, com nome, caminho completo, sha, versão e diretor Claude Code;
  - copiar, abrir e mostrar na pasta reverificados pelo host;
  - arquivo alterado ou movido fica bloqueado;
  - prosa sem recibo não gera cartão;
  - recibo do export de mídia;
  - `FileDeliveryCard` antes e depois da verificação.
- Observação de D, sem bloqueio: um cartão aberto não reverifica sozinho; o status atualiza ao remontar.

**Backup** (app fechado, `activity` → `active:false`, 0 processos, conferido de novo antes do instalador):
- pasta: `C:\Users\pacas\Documents\MainsAgentsBackups\before-update-0.3.62-20261012-222340`;
- 9 bancos pela API de backup online do SQLite (WAL commitado), todos `integrity_check=ok`, com hashes em `manifest.json`;
- arquivos: storage (28), runtime (imagens 1, sessões 9), appdata (72) e skills (40). Credenciais e caches ficaram de fora.

**Instalação silenciosa** (`/S /D=%LOCALAPPDATA%\Programs\MainsAgents`, janela oculta):
- saída 0;
- `ProductVersion 0.3.62.0`;
- **asar instalado = recibo** (`3a59b825…`).

**Smoke oficial oculto** (perfil real):
- `startup.log` com `version=0.3.62`, `nativeStorage:true` e `Main window loaded`;
- nenhuma janela visível;
- fechamento gracioso (WM_CLOSE) → `Close storage verification: saved`, 0 processos.

**Dados.** Snapshots antes, depois de instalar, com o app aberto e depois de fechar: tudo **idêntico**. As únicas diferenças são três tabelas novas e vazias: `delivery_receipts`, `production_delegation_links` e `production_edit_directors`.

## 8. Para o usuário

1. Atualize para a 0.3.62. Os agentes, conversas e dados são preservados.
2. Peça a edição como sempre: no chat de conteúdo, "manda pro editor de vídeo" com o MP4, ou em Produção → Vídeo gravado. Não é preciso informar o caminho.
3. Em "Quem dirige os cortes e o motion" fica **Claude Code** (recomendado). Codex ou o próprio agente editor também podem ser escolhidos. A escolha vale para o espaço e não altera agentes nem conversas.
4. O Claude vê a gravação, monta cortes e storyboard explicativo, confere prévias e o app renderiza. O vídeo volta no chat com nome, **caminho completo** e os botões *Copiar caminho*, *Abrir* e *Mostrar na pasta*.
5. Para ajustar, peça no chat ("corte o começo", "título maior"). Sai uma versão nova, e as anteriores e o original continuam salvos.
6. Se o motion pedido não puder ser feito, o app mostra o motivo e oferece "Continuar sem motion". Ele nunca entrega um vídeo simples como se fosse o pedido.
7. Opcional: envie um link ou vídeo de referência de estilo, ou indique um vídeo real para um ensaio. Nada pessoal é usado sem você pedir.
