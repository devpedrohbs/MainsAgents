# Editor Claude: estado atual depois de E1 + E2, migração e setup (15/10/2026)

Tarefas Orca `task_bfc5bfed4426` e `task_72904754d963`. Este documento descreve o **estado atual do código**. A análise anterior à implementação está em `docs/analysis/claude-editor-quality-audit-2026-10-15.md`, que traz correções marcadas.

Atualização (`task_a3d392c5479b`): o setup abaixo foi **aplicado** no perfil real, e a **0.3.69** foi construída, instalada e aberta (`docs/analysis/claude-editor-release-2026-10-15.md`). Continuam sem acontecer: commit/push/tag, release pública, chamada de IA de edição e processamento de vídeo pessoal.

## 1. O que o Editor Claude recebe hoje

| Insumo | Estado | Evidência |
|---|---|---|
| Instruções do agente editor | **Já chegavam antes desta rodada.** `production-runtime.mjs:25` envia `runtimeFirstMessage:true`, e `makeUserPrompt` as inclui (`claude-code-bridge.mjs:145`). A auditoria inicial errou ao dizer o contrário | código |
| Skills habilitadas do agente | **Novo.** O host lê os arquivos (`editor-guidance.mjs`) e entrega em `get_context.guidance` | testes |
| Guia visual e sonoro do app | **Novo.** Texto original (`APP_GUIDE`, cerca de 2,8 KB) | `editor-guidance.mjs` |
| Transcrição por sentença | Já existia, em `get_context`, limitada a 24 000 caracteres | `editor-authoring.mjs` |
| Palavras com tempo real | **Novo:** `get_transcript_words` | testes |

Regras da orientação: o host lê os arquivos; o modelo não lê nada. Só entram `skillFiles` `.md` absolutos de `skills` fora de `disabledSkills`, depois de `realpath`, dentro de `skillsDirectory`. Limites: 16 000 bytes por arquivo e 48 000 no total, com o marcador de truncagem contado dentro do limite; o que não cabe vai para `skipped`. O payload não contém caminhos de arquivo. URLs e caminhos escritos no texto de um guia continuam texto: nunca são abertos nem executados. A orientação traz uma nota de que não concede ferramentas nem permissões. O plano continua sendo dado validado por `planSafetyProblems`, `validatePlan`, prova de fatos e QA de cenas.

## 2. `get_transcript_words` (contrato atual)

- Entrada: `{start, end, offset?}`, em segundos na linha do tempo da **fonte**. `offset` só serve para continuar uma página truncada.
- Cada palavra pertence à janela do seu **início**. Uma chamada cobre até 300 s e devolve até 800 palavras, em linhas compactas `início fim palavra`.
- Saída: `truncated`, mais `nextStart` e `nextOffset` quando há continuação. `nextOffset` conta as palavras que começam exatamente em `nextStart` e já foram devolvidas. Um `offset` maior que esse grupo é recusado (`invalid_input`).
- Garantia testada: percorrer o vídeo seguindo `(nextStart, nextOffset)` devolve cada palavra exatamente uma vez e sempre termina. Os testes cobrem um grupo de mesmo início com mais que o dobro do limite por página (1 603 palavras), palavras sobrepostas e janelas longas (1 200 s, cerca de 4 900 palavras). A correção substituiu a versão anterior, que repetia a página quando um grupo de mesmo início passava do limite.
- Qualidade declarada ao modelo: tokens do whisper.cpp, alinhamento aproximado/experimental e fim de palavra parcialmente inferido. Ele deve deixar folga nos cortes e conferir em frames/preview. Sem palavras, nada é estimado: `timing:'sentences'`, sem linhas.

## 3. Rotas reais

O host de edição só é criado em `production-coordinator.mjs` (`planAuthoredEdit`). Produção (gravado/importado) e delegação engine (`native-agent-delegations.mjs:83-85` → produção) passam por ali. O teste `production-authored-edit` cobre a delegação até o MCP com palavras e skills; o CLI é simulado, e FFmpeg, coordenador e MCP são reais.

**Chat × engine (restrições reais):**
- **Chat Claude:** só `Read/Glob/Grep` (com Files) e `WebSearch/WebFetch` (com web-search). Não há shell, escrita nem ferramenta de handoff na bridge Claude. Pedir "edite este vídeo" no chat produz só plano ou leitura.
- **Engine:** a edição real vem da Produção ou de um handoff do Editor de Conteúdo com arquivo de vídeo. Nela, o Claude usa só as ferramentas `mainsagents_editor`, sem nenhuma ferramenta embutida.
- **Escrita local:** só existe para agente Codex com Files (`agent-file-access.mjs:7`).

## 4. `adopt-agent-config` (nova decisão do coordenador)

`command(profile,{id,revision,requestId,action:'adopt-agent-config',authorize:true})`:

- **Pré-condições:** run em `blocked`/`paused` com `resumeStage` `planning-edit` ou `editing`, não importado e sem `outputVideo`. Uma exportação já concluída é recusada; uma exportação em fila ou rodando é cancelada como em `set-edit-director`.
- **Checagens:** `guard(p,{editorChanged:true})` confere perfil, lease, cancelamento, autoridade **antiga**, conteúdo e os agentes source/publisher (que não podem ter mudado). Só a diferença do editor é tolerada, e só quando o editor não é também source ou publisher.
- **Efeito (`adoptEditorConfigRun`, função pura exportada):**
  - re-snapshot **só** do editor, `epoch+1` e autoridade nova (`productionBindingHash`);
  - plano ativo zerado (`step`, `editPlan`, `checkpoint`, `revisions`);
  - `authoring.history` (até 5 entradas) guarda, **verbatim**, o authoring anterior (checkpoint, revisões/planos, previews, execuções), o snapshot antigo do editor, `step`, `editPlan` e a autoridade antiga;
  - `previousPlan` recebe o último plano;
  - `restartPending: agent-config-changed`.
- **O que não acontece:** nada roda antes de **Retomar**. Não há IA nem render, os brutos não são tocados e nenhuma mensagem é escrita nas conversas. Repetir com a mesma configuração não muda nada.
- **Testes:** `editor-turn-limit.test.mjs`, coordenador real com editor roteirizado. Antes da adoção, `resume` falha. Depois: autoridade nova, histórico idêntico ao authoring antigo, nenhum envio ou render, sha da fonte igual. Ao retomar, a epoch é nova e o orçamento vem cheio, sem continuação. Um run entregue é recusado, e um source alterado continua bloqueando.

## 5. Setup do agente real → Claude, com migração (**aplicado em 15/10 e 0.3.69 instalada**: ver `docs/analysis/claude-editor-release-2026-10-15.md`)

`node scripts/editor-claude-setup.mjs [--json]` é o padrão: dry-run com o estado aberto read-only. `--rehearse <pasta>` faz o ensaio numa cópia. `--apply` aplica, mas só depois da revisão. O script antigo `editor-claude-setup-dry-run.mjs` foi substituído e removido.

Diff exato do dry-run no perfil ativo real (`~/.mainsagents/storage`):

- `providerId`: `"codex"` → `"claude"`. `modelId` continua `""` (padrão do CLI).
- `fileAccess`: `{enabled:true,outputDirectory:".../VideosSemiEditados"}` → `{enabled:false, ...}`. A escrita é Codex-only, e o script valida o resultado com `agentFileAccess`.
- `tools`: `files, canvas-context, subagents` → mesma lista **+ `web-search`**.
- `instructions`: uma frase trocada ("O corte simples deve funcionar sozinho; efeitos e CapCut são opcionais." passa a dizer que a autorização cobre corte + acabamento pedido e que o criador revisa e pede ajustes). A seção "Ferramentas e saída local — 08/10/2026" é substituída por "Ferramentas reais — 15/10/2026", que descreve:
  - no chat: leitura, web, sem shell nem escrita, sem iniciar handoff;
  - na engine: `mainsagents_editor` com guia, skills e `get_transcript_words`;
  - pesquisa web sem usar mídia sem licença.
- Orientação que o editor receberá: guia do app, `mainsagent-edicao-video`, `mainsagent-corte-base` e `mainsagent-contexto-editorial`.
- Runs migrados (só estes dois, só deste editor):
  - `production-8314f2f5-…`: blocked/planning-edit, epoch 1 → 2. O histórico guarda o checkpoint r3 (22 chamadas), 3 revisões e o `previousPlan`.
  - `production-9bed8ebf-…`: blocked/planning-edit, epoch 1 → 2, sem checkpoint anterior.
- Mudanças permitidas no `--apply`:
  - linha `agents` do perfil, mais uma cópia em `agent_revisions` e `metadata.last-saved-at`;
  - `production_runs` e `production_authority` dos 2 runs.
  - Qualquer outra diferença faz o apply falhar (`unexpectedChanges`).

Salvaguardas do `--apply`:
1. App fechado: nenhum processo `MainsAgents.exe`/`electron.exe` e lease de produção expirado.
2. Backup online com `VACUUM INTO` em `storage/backups/before-editor-claude-<ts>.sqlite`, igual tabela a tabela e com `integrity_check` ok, **antes** de qualquer escrita.
3. Agentes gravados pelo `desktop-state-store` com CAS na revisão.
4. Runs e autoridade em uma transação, com CAS em `revision`, sha do `data_json` e autoridade antiga.
5. **Não é uma transação única.** Primeiro o `store.write` dos agentes é confirmado; depois vem a transação dos runs. Se os runs falharem, a linha `agents` é compensada, voltando por CAS ao valor anterior. Se até a compensação falhar, o erro diz isso e aponta o backup verificado do passo 2 para restauração manual.
6. O plano recusa antes de escrever qualquer coisa se, em algum dos dois runs, o agente source ou publisher mudou desde a autorização, ou se o conteúdo ligado sumiu. Nesses casos a migração do editor não destravaria o `guard()`, e o setup não adota outros agentes. Nos dois runs reais isso não acontece: o ensaio na cópia confirma source, editor e publisher iguais aos agentes vivos, autoridade = binding novo e conteúdo presente.

Os IDs nativos e as conversas não são lidos nem escritos. Conversas Codex existentes mantêm `providerId` e não são renomeadas.

Verificação:
- `tests/editor-claude-setup.test.mjs` (fixture com store real): diff exato. O apply muda só as tabelas permitidas, e chats, mensagens, drafts, editorial, receipts e outros agentes ficam idênticos. Também testa as recusas (app aberto, lease ativo, agents alterados) e a compensação quando um run muda depois do plano.
- **Ensaio na cópia do estado real** (`--rehearse`, sem IA): os 2 runs passam nas mesmas checagens que `guard()` faz ao retomar (snapshot do editor = agente vivo, autoridade = binding novo, source/publisher inalterados, conteúdo presente). O authoring antigo e o checkpoint ficam verbatim no histórico, e as sessões e o `inputVideo` ficam intocados. Os outros agentes são idênticos, e o estado real é idêntico antes e depois (digest por tabela).

## 6. Skills pessoais

O backup anterior às edições continua em `.mainsagents-workspaces/skill-backups/editor-de-video-2026-10-15/` (4 arquivos + `SHA256SUMS.txt`) e não foi tocado nesta rodada. As skills modificadas na rodada anterior continuam como estão.

## 7. Ainda são propostas (não implementadas)

- Componentes TSX escritos pelo Claude (oficina Remotion por conteúdo). O plugin e as skills da Remotion **não foram instalados**: o authoring desabilita plugins e skills nativos, então instalar não liberaria capacidade.
- Legendas nativas dentro do storyboard/composição (hoje a legenda é aplicada na etapa de legendas, com libass).
- SFX e trilha de biblioteca licenciada do usuário (hoje: whoosh/pop/tick sintetizados).
- Presets nomeados de layout (E3) e ajuste do orçamento de revisão (E6).

## 8. Limitações

- O timestamp por palavra é experimental, e nenhuma precisão é prometida.
- Mudar o texto de uma skill muda a orientação sem trocar a autoridade. O hash fica registrado no audit `editor-guidance`.
- A compensação do apply deixa uma linha extra em `agent_revisions`, que é histórico e não altera o estado ativo.
- A checagem de "app fechado" depende de `tasklist` (Windows) e do lease. Rodar com o app aberto é recusado.
- Feito em 15/10: `--apply` no perfil real, bump para 0.3.69, build e instalação local. `editor-guidance.mjs` está no asar, idêntico à fonte.
