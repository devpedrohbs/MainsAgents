# Revisão content-first — exclusão e ciclo de vida do conteúdo (2026-10-15)

Task `task_645bb53fbba2` · Dispatch `ctx_d8184a8a4069` · revisão **somente leitura**.
O código de exclusão durável pertence a `task_b603ccf95491` / `ctx_c12fe3658810`; este documento só orienta.

**Escopo e limites.** Li o código-fonte (arquivos citados abaixo) e a skill `.agents/skills/apple-design/SKILL.md` com 11 referências HIG: `accessibility.md`, `layout.md`, `typography.md`, `color.md`, `designing-for-macos.md`, `sidebars.md`, `alerts.md`, `undo-and-redo.md`, `lists-and-tables.md`, `feedback.md`, `writing.md`. Não abri o app, não rodei testes e não usei capturas. **Nenhum valor visual (contraste, tamanho, px) foi medido.** Os princípios HIG foram traduzidos para Electron no Windows (Esc/Enter, foco visível, diálogo modal web); convenções exclusivas do macOS, como barra de menus e Cmd-Z, não são exigidas.

## Resumo

A navegação centrada em conteúdo **já existe e é boa**: caixas por conteúdo em Sessões, `ContentScopeBar` no chat, contexto isolado por conteúdo e o cartão "Próxima ação". O problema é o **fim do ciclo de vida**: não há "Excluir conteúdo" em lugar nenhum, e excluir uma conversa ligada a uma produção dá um falso sucesso, porque o poll de produção a recria em ~1 s. Avaliação: **Problemas críticos** (perda de confiança, mas não de dados).

## Críticos (exclusão)

### C1 — Conversas de produção ressuscitam após excluir
- **O quê:** `deleteSession` (`src/features/chat/ChatProvider.tsx:153-164`) só filtra `sessions` e chama `DELETE /api/content/delegations/sessions/:id`. Nada mexe em `production_runs`. A cada 1 s, `ProductionProvider` (`src/features/production/ProductionProvider.tsx:23-24`) roda `mergeProductionSessions`, que, quando o id não existe mais, faz `result.push({...shadow, ...})` (`src/features/production/model.ts:114`) para `sourceSession`/`editorSession`/`publisherSession`. A conversa volta com as mensagens `production:*`.
- **Por quê:** `feedback.md › Best practices`: "Show people when a command can't be carried out and help them understand why."
- **Critério de aceite:** depois de "Excluir conteúdo e conversas", nenhum id de sessão do conteúdo reaparece em `sessions` após ≥3 ciclos de poll e após reiniciar o app. O backend remove ou tombstona os runs do conteúdo **antes** de a UI confirmar, e `mergeProductionSessions` ignora runs/sessões tombstonados (teste unitário: merge com run tombstonado não faz `push`).

### C2 — A UI anuncia uma exclusão que pode não ter acontecido
- **O quê:** `Sessions.tsx:300-302` chama `deleteSession` e mostra o toast "Conversa excluída" na hora. No desktop, porém, `remove()` só roda **depois** que o `fetch DELETE` responde ok (`ChatProvider.tsx:161`). Em erro, só sai um `mainsagents:persistence-error` genérico. Além disso, `ChatPanel.tsx:730` promete "Conteúdo, arquivos e produção continuam salvos" para chats de produção, que voltam (C1).
- **Por quê:** `writing.md › Best practices` ("Write clear error messages… display it as close to the problem as possible").
- **Critério de aceite:** a ação destrutiva devolve uma `Promise` com o resultado; o toast "Excluído" só aparece depois que o backend confirma; em erro, o diálogo continua aberto com uma mensagem inline (`role="alert"`) dizendo o que não foi removido e o botão "Tentar novamente". O texto de `ChatPanel.tsx:730` não fala em produção quando a conversa é papel de um run (ou passa a oferecer "Excluir o conteúdo inteiro").

### C3 — Não existe "Excluir conteúdo" fora de arquivar
- **O quê:** `ContentWorkflowProvider` só expõe `setProductionStage(…, 'archived')` (`ContentStudio.tsx:870`). O Fluxo (`Flow.tsx:153-154`) só remove o layout. Se o conteúdo fosse removido sem as conversas, elas cairiam em "Precisa de atenção · nada foi apagado" (`contentSessions.ts:60`, `contentScopes.ts:135`), ou seja, o oposto do que o criador pediu.
- **Critério de aceite:** a ação fica visível **sem a aba Fluxo** em dois pontos:
  1. **Sessões:** um menu "…" em cada `content-space-box` (`Sessions.tsx:113-131`), como irmão do botão e não dentro dele (hoje a caixa inteira é um `<button aria-pressed>`), com o item "Excluir conteúdo e conversas…".
  2. **Chat:** o mesmo item num menu ao lado do `SelectMenu` do `ContentScopeBar` (`ContentScopeBar.tsx:21-22`), só quando `kind==='content'`.

  Opcional: no Estúdio, ao lado de "Arquivado" (`ContentStudio.tsx:870`).

## Diálogo único de confirmação (especificação)

Reusar o `FlowDialog` (`src/components/common/FlowDialog.tsx`), que já prende o foco, fecha com Esc e devolve o foco ao gatilho (`:24-61`).

| Elemento | Conteúdo |
| --- | --- |
| Título | `Excluir “<título do conteúdo>”?` (`alerts.md › Content`: título específico, não "Erro"/"Atenção") |
| Prévia | Contagem por agente, já calculada em `ContentSpace.agents` (`contentScopes.ts:119,125`): "Codex · 3 conversas, Claude · 2 conversas", mais a contagem de rascunhos locais, ponteiros e itens de inbox removidos |
| Sai do app | Registro do conteúdo, as N conversas e seus históricos locais, runs/estado de produção locais, rascunhos (chat/estúdio/produção), ponteiros de escopo e caixas do Fluxo ligadas |
| Fica intacto (frase curta) | "Arquivos no disco, gravações brutas, agentes, Paper, Notion, contas e posts ou agendamentos já enviados não são tocados." Sem mencionar backups como apagados |
| Produtor ativo | Se houver run ativo, conversa respondendo ou delegação `queued/running` (`delegationBusy`, `contentScopes.ts:155`), o botão destrutivo fica **desabilitado**, com o motivo inline e a ação "Parar produção", que reusa o `cancel` de `ProductionDialog.tsx:215`. Sem auto-parar escondido |
| Botões | `Cancelar` (à esquerda) e `Excluir conteúdo e N conversas` (à direita, `danger-button`). `alerts.md › Buttons`: "Always use the title 'Cancel'…", "you don't want to make a Cancel button the default button", e use título específico ("Delete"), nunca "OK" |
| Foco inicial | Em `Cancelar`, com `data-autofocus`. Hoje o `FlowDialog` foca o primeiro `input` ou o primeiro `button`, que é o X de fechar (`FlowDialog.tsx:29-31,83`). Enter não pode disparar a exclusão sem foco explícito |
| Durante a exclusão | Botão com "Excluindo…" e `aria-busy`; Esc e Cancelar bloqueados só enquanto a requisição está em voo |
| Depois | Fecha, seleciona "Geral" e anuncia "“X” e N conversas excluídos" (`role="status"`). Se a lista ficar vazia, mostra o empty state de `Sessions.tsx:163-201` |
| Erro | Inline no diálogo: o que não saiu e "Tentar novamente". O que já saiu não é apresentado como restaurado |

**Uma confirmação só.** `feedback.md › Best practices` ("Warn people when they initiate a task that can cause data loss that's unexpected and irreversible") e `alerts.md › Best practices` ("when people take an uncommon destructive action that they can't undo, it's important to display an alert") justificam **um** aviso. Não há base para pedir um segundo nem para digitar o título. A HIG só pede confirmação dupla no modo Assistive Access do iOS (`accessibility.md › Cognitive`), que não se aplica aqui. Não existe undo (`undo-and-redo.md` fica para o futuro), então o texto não deve sugerir que dá para desfazer.

**Exclusão de conversa avulsa** (`Sessions.tsx:290-307`, `ChatPanel.tsx:728-740`): continua inline, mas, quando a conversa for papel de um run (`run.sourceSession/editorSession/publisherSession`), troque a ação por "Esta conversa conduz a produção. Exclua o conteúdo inteiro…" com link para o diálogo acima, em vez de fingir que ela sai sozinha.

## Até 3 melhorias para o criador (além da exclusão)

O que **já existe** e deve ser preservado: caixas por conteúdo com contagem por agente (`Sessions.tsx:107-138`), troca de agente dentro do mesmo conteúdo (`ContentScopeBar.tsx:26-31`), "Próxima ação" (`ContentSessionCard.tsx`), organizar com guarda contra mistura (`OrganizeChatDialog.tsx`), Codex para roteiro e Claude para edição, Paper, SRT separado e contexto isolado.

1. **Ninguém deve cair no Fluxo sem pedir** (Médio). O card "Em produção" da Visão geral leva para `flow` (`Home.tsx:125`), e "Fluxo" ocupa o nav primário (`Sidebar.tsx:13`). Aceite: o card abre Sessões com o conteúdo, ou o Estúdio; "Fluxo" vai para o grupo secundário, sem mexer no backend de orquestração. `sidebars.md › Best practices` ("let people customize the contents of a sidebar").
2. **O conteúdo vem antes das estatísticas em Sessões** (Médio). Os 3 cards de estatística (`Sessions.tsx:95-106`) ficam acima das caixas de conteúdo, e o título é "Conversas do projeto". Aceite: as caixas de conteúdo vêm primeiro, e cada caixa mostra a etapa e a próxima ação curta (reusar `nextAction` de `contentSessions.ts`) em vez de só a contagem; as estatísticas descem ou ficam recolhidas. `layout.md › Visual hierarchy` ("place the most important items near the top"); `writing.md › Best practices` ("put the most important information first").
3. **A tabela de conversas mostra menos colunas por padrão** (Baixo). A linha de Sessões tem 7 colunas, das quais Provedor, Msgs e Status repetem a linha de baixo (`Sessions.tsx:204-212,264-288`). Aceite: o padrão mostra título, agente, atualização e ações; o provedor fica no subtítulo; nada é removido de verdade. `lists-and-tables.md › Content` ("Keep item text succinct…").

## O que funciona (manter)
- Todos os textos de "nada foi movido/apagado" são honestos e específicos (`organizeProblemText`, `contentScopes.ts:237-249`): use o mesmo tom no diálogo de exclusão.
- O `FlowDialog` já resolve modalidade, Esc e devolução de foco; só falta `data-autofocus` no Cancelar.
- O botão de excluir desabilitado enquanto a conversa responde (`Sessions.tsx:296-299,333-341`) explica o motivo no `title`. Leve esse motivo para um texto visível no diálogo de conteúdo, porque tooltip não chega a quem usa só o teclado.

## Notas de plataforma (Windows/Electron)
- Ordem dos botões: a HIG pede Cancelar à esquerda e a ação à direita, o que bate com o padrão atual do app (`OrganizeChatDialog.tsx:109-113`). Fique com o padrão do app em vez de inverter para a convenção Win32.
- Atalhos: Esc cancela (já existe). Não crie atalho para excluir conteúdo.
