# Canvas: confiabilidade de estado, contexto e ações — 27/10/2026

Rodada do worker Codex/sistema-canvas sob coordenação no Orca. As correções anteriores de redimensionamento, barra compacta, navegação com Espaço e organização foram preservadas; não são contadas como entregas novas desta rodada.

## 1. Contexto e conversas isolados por workspace

**Antes:** o contexto pendente era indexado somente por `agentId`, mas resolvido usando os blocos do workspace aberto. Colisões de IDs em snapshots ou mudanças de workspace podiam resolver um bloco diferente. O chat do canvas buscava agentes globalmente e aceitava uma sessão sem validar a propriedade do agente no workspace; um bloco importado com referências estrangeiras podia mostrar a conversa de outro workspace.

**Agora:** a fila pendente usa workspace + agente, valida a existência e propriedade do agente e filtra IDs de blocos disponíveis naquele canvas. A resolução de agentes, sessões e transcrições conectadas valida o workspace contêiner e o vínculo sessão/agente. Blocos antigos sem `data.workspaceId` continuam aceitos; um campo explicitamente contraditório não autoriza acessar outra conversa. Escolher um agente explicitamente cria uma conversa nova e corrige o vínculo do bloco no workspace atual.

Notas, browser e terminal usam o workspace contêiner para suas atualizações. Visibilidade de chats é registrada por workspace. Adicionar uma resposta usa o workspace do agente, e adicionar novamente a mesma mensagem retorna o ID existente, em vez de anunciar um ID inexistente.

## 2. Exclusão com limpeza das referências operacionais

**Antes:** `setNodes` podia remover um bloco deixando suas arestas e anexações pendentes vivas. Restaurar posteriormente um bloco com o mesmo ID podia reativar uma anexação pendente que já deveria ter sido descartada.

**Agora:** `updateGraph` lê o estado persistente vivo e publica nós e arestas juntos, preservando câmera e campos extras do snapshot. Todos os caminhos de `setNodes`/`setEdges`, inclusive Delete, menu e Undo, removem arestas com pontas ausentes. A fila pendente do workspace é podada quando seus blocos desaparecem, sem mexer na fila de outro workspace. Desfazer a exclusão restaura os blocos e as arestas válidas, mas não recria essa fila pendente descartada.

**Semântica de rascunhos, confirmada pelo coordenador:** referências já salvas em rascunhos persistidos são preservadas. Se o bloco está ausente, a referência mostra o aviso de indisponibilidade e nenhum conteúdo dela é enviado; Undo pode torná-la válida novamente. Texto, skill, outros anexos e mensagens históricas não passam por limpeza. O provider não ganhou acesso de escrita a `chat-drafts`.

## 3. Desfazer sem rebobinar dados posteriores

**Antes:** cada ação guardava um snapshot completo e o Undo substituía todo o canvas. Desfazer um movimento podia apagar texto editado depois, rebobinar saída de terminal, trocar de volta o vínculo de um chat ou remover blocos adicionados por uma colaboração posterior. Ctrl+Shift+Z também executava Undo.

**Agora:** o histórico registra a operação: criação, exclusão, geometria, conexão ou agrupamento. Sua inversa afeta somente os IDs e os campos correspondentes. Geometria restaura posição/tamanho, preservando conteúdo e runtime atuais; agrupamento restaura somente os campos do grupo. Exclusão não sobrescreve um bloco mais novo que já reapareceu com o mesmo ID. Conexões novas e adições independentes permanecem.

Atalhos respeitam campos de texto, menus, diálogos modais e foco fora do canvas; Espaço em um botão mantém a ativação nativa. Ctrl+Shift+Z não executa Undo — **Redo não foi implementado**. Delete e conexão repetida têm retorno em PT-BR/EN-US; ações vazias não criam uma etapa de exclusão no histórico.

## 4. Cópias independentes de chats e terminais

**Antes:** duplicar copiava `chatSessionId`, `chatHandoffId`, `terminalExecutionId`, cursor e identidade da mensagem de origem, podendo vincular a cópia à conversa ou execução ativa do original.

**Agora:** um terminal copiado começa ocioso e sem execução, cursor, saída ou código de saída herdados; conserva a pasta, shell e texto de comando para execução manual. Um chat copiado começa sem sessão ou agente vinculado e orienta a escolher um agente para outra conversa. Nenhuma cópia inicia comando ou cria sessão automaticamente. O original permanece intacto. Novos blocos e conexões usam UUIDs.

## Arquivos exatos desta rodada

- `CLAUDE-CODE-COLLABORATION.md`: preferência atual do usuário e divisão entre orquestrador, worker Claude/design e worker Codex/sistema-canvas.
- `src/components/canvas/CanvasProvider.tsx`: escopo, contexto pendente, atualização do grafo e destino das respostas.
- `src/components/canvas/Canvas.tsx`: histórico por operação, duplicação segura, atalhos e feedback.
- `src/components/canvas/nodes/CanvasNodes.tsx`: resolução segura de sessões e contexto e atualização pelo workspace contêiner.
- `src/components/canvas/nodes/TerminalNode.tsx`: atualização pelo workspace contêiner.
- `src/components/canvas/canvasState.ts`: regras puras de propriedade, fila pendente, grafo e duplicação.
- `src/components/canvas/canvasContext.ts`: transcrições e percurso de conexões dentro do workspace.
- `src/components/canvas/canvasHistory.ts`: inversas de operações e decisão de atalhos.
- `tests/canvas-system.test.mjs`: 13 testes novos para os problemas acima.
- `scripts/test-canvas-system-ui.mjs`: fixture Electron isolada com SSE falso e bloqueio de requests externos.
- `docs/analysis/canvas-system-2026-10-27.md`: este relatório.

Não foram editados `src/main.tsx`, arquivos de aplicação/layout ou telas sob ownership de Claude, `package.json`/lock, estilos globais, backend ou scripts de release nesta rodada.

## Validação e evidências

Executado pelo worker:

```text
npm run typecheck
node --experimental-strip-types --test tests/canvas-system.test.mjs tests/canvas-geometry.test.mjs tests/canvas-browser.test.mjs tests/canvas-runtime-bridge.test.mjs tests/collaboration-canvas.test.mjs
node --check scripts/test-canvas-system-ui.mjs
git diff --check -- CLAUDE-CODE-COLLABORATION.md src/components/canvas tests/canvas-system.test.mjs scripts/test-canvas-system-ui.mjs
```

Resultado: typecheck aprovado; **28 testes aprovados**, incluindo 13 novos; sintaxe da fixture e diff aprovados. Imports de runtime dos módulos puros usam `.ts`, compatível com o strip-types dos testes existentes.

O coordenador informou a aprovação no `dist` final compartilhado de:

- `npm run build`.
- `npm test`: **841 testes, 841 aprovados, zero falhas e zero skipped**.
- `npx electron scripts/test-refined-workspace-ui.mjs`: `REFINED_WORKSPACE_UI_OK`.
- `npx electron scripts/test-canvas-interactions-ui.mjs`: `CANVAS_INTERACTIONS_UI_OK`.
- Teste de fluxo da frente Claude: `UX_FLOW_UI_OK`.
- `npx electron scripts/test-canvas-system-ui.mjs`: `CANVAS_SYSTEM_UI_OK`, saída 0.

A nova fixture verifica sessões estrangeiras bloqueadas, texto e streaming preservados pelo Undo, proteção de teclado, Delete/Undo de arestas, cópias independentes sem execução, preservação de mensagens/rascunho e recarga de outro workspace com ID de bloco repetido e câmera própria. Capturas ficam em `.mainsagents-workspaces/canvas-system-ui-test/`.

## Limites

O worker não executou build, testes Electron, commit, push, release ou instalação; build e interface ficaram exclusivamente com o coordenador. A fixture usa processos e armazenamento isolados e não verifica um provedor remoto real. Formato de persistência e snapshots existentes foram preservados, sem migração destrutiva. A leitura visual do artefato externo do Claude não faz parte desta rodada de sistema.
