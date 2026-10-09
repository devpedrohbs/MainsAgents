# Revisão de isolamento: sessões de conteúdo no mesmo agente (2026-10-08)

Revisão somente leitura. Nenhum código, teste ou dado foi alterado; nenhuma IA ou serviço real foi chamado; nenhum teste foi rodado. Base: spec `task-content-sessions-2026-10-08.md`, `ChatProvider.tsx`, `chatDrafts.ts`, `production/model.ts`, `production-coordinator.mjs`.

## O que já isola bem (sem ação)
- Rascunhos: chave `agentId + sessionId` (`chatDrafts.ts`), limpa na exclusão (`ChatProvider.tsx:102`).
- Eventos de streaming e respostas tardias: `applyEvent(sessionId, …)` e `updateSession(sessionId, …)` usam o id capturado em `executeMessage` (`ChatProvider.tsx:162,207,220`). Uma resposta tardia de A não escreve em B. `inFlightSessions`/`abortControllers`/`executions` são por sessão.
- Skills/instruções são globais por agente (`agent.instructions`, `agent.skills`, `skillsDirectory`, linhas 187/191). Não dependem da sessão, então A e B no mesmo agentId as mantêm. O contexto do conteúdo vem só de `session.productionContext`, `contextNodes` e `session.messages`, que são por sessão.
- Espelhamento de produção (`model.ts:47-58`): exige `shadow.contentId === run.contentId`, mesmo agente e workspace, e só mescla mensagens com prefixo `production:<runId>:`.

## Achados

### 1. Sessão filha criada por conexão/handoff troca a sessão ativa do agente destino e não herda conteúdo (médio)
- `ChatProvider.tsx:94` (`createSession` sempre chama `setActiveSessionIds`), usado em `:123` (`newConnectedSession`) e `:235` (`performHandoff`), ambos sem o parâmetro `editorial`.
- Cenário: conteúdos A e B no agente X, ambos conectados ao agente Y. Y tem a sessão de B aberta. A delega para Y com `sessionMode:'new'` (ou sem filha existente). `activeSessionIds[Y]` passa para a filha de A, e a vista de Y troca de B para A sem ação do usuário. A filha nasce sem `contentId`/`topicId`, então a lista e o "Abrir conteúdo" (`ChatPanel.tsx:463`) não a ligam a A.
- Correção sugerida: criar a filha sem ativá-la quando vem de handoff e propagar `contentId`/`topicId` da origem. Só propagar `productionContext` se for desejado.

### 2. Rascunho "novo" compartilhado entre conteúdos (baixo/médio)
- `chatDrafts.ts`: com `sessionId` indefinido a chave vira `…:new`, única por agente.
- Cenário: o usuário digita no estado sem sessão do agente X e abre "novo conteúdo A" e depois "novo conteúdo B". O mesmo texto/skill aparece nas duas criações até ser enviado ou limpo.
- Correção sugerida: ao criar sessão de conteúdo, mover o rascunho `new` para a sessão criada (ou limpá-lo) e nunca reutilizar a chave `new` em fluxo de conteúdo.

### 3. Snapshot de `session` fica velho dentro de `executeMessage` (baixo, mas crítico para "estado real")
- `ChatProvider.tsx:176,185,191`: `productionContext` e `history` vêm do objeto `session` recebido por argumento. Esse objeto foi capturado no clique e pode ficar anterior a uma atualização de `mergeProductionSessions` (como uma aprovação feita antes do envio de A). Há `await saveNow()` e `await provider.createSession` antes do `sendMessage`, o que alarga a janela.
- Cenário: o usuário aprova o roteiro de A e logo envia uma mensagem. O prompt leva a etapa antiga ("script-review"), e o modelo pode dizer que ainda falta aprovar.
- Isso afeta só o texto, não o estado. Correção sugerida: reler `sessionsRef.current.find(id)` logo antes de montar `providerContent`.

### 4. Sessão genérica reaproveitada é "adotada" pelo espelhamento (baixo)
- `model.ts:54-56`: se `old.contentId` é indefinido, a sessão com o mesmo id recebe `contentId`/`topicId` do run sem confirmação. Isso só acontece com id igual ao do shadow, então o risco é baixo. Porém, se a implementação nova reaproveitar a sessão principal do agente como `sourceSession`, a vinculação precisa ser persistente e validada (perfil/workspace/contentId/sessionId, como pede a spec). Hoje a validação é só `contentId` + agente + workspace. Falta `profileId` e uma checagem de que o `sessionId` pertence ao vínculo salvo.

### 5. Pontos não verificados nesta revisão (risco aberto)
- `remoteSessionId`/`resumeSession` (`:182-188`): o isolamento entre A e B depende do bridge Claude/Codex mapear `localSessionId` para threads distintas. Não foi lido `claude-code-bridge.mjs` em profundidade.
- Jobs em fila e `production-coordinator`: `put()` tem controle de `revision` por run (`:39`), o que é bom, mas não foi verificada a retomada após reinício sem repetir o Notion/roteiro.

## Resumo
Nenhum vazamento direto entre sessões do mesmo agente foi encontrado no caminho de envio/streaming/rascunho. Os riscos concretos são o efeito de `createSession` na sessão ativa do agente destino (1), a chave de rascunho `new` (2) e o snapshot velho (3).
