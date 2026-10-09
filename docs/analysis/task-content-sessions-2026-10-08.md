# Sessões por conteúdo no mesmo agente

## Objetivo autorizado

O usuário quer trabalhar com dois ou mais conteúdos dentro do MESMO agente do MainsAgent, trocando somente a sessão. Cada conteúdo mantém conversa, vídeo, card/roteiro, decisões e etapa próprios. Ao reabrir, a sessão retoma pelo estado salvo. Também deve poder começar com um vídeo já gravado e contexto de um card Notion ou texto, entrando pela edição sem gerar ideia/roteiro/card de novo.

## Responsabilidade

Claude Opus é o único editor da implementação desktop, incluindo backend, UI e testes necessários. Coordenador faz leitura, revisão e tarefas administrativas. Mobile e branding B04 ficam fora. Não criar um agente por conteúdo, não duplicar configurações/skills, não substituir os agentes já configurados no fluxo. Reutilizar agentId e a resolução de skills/configuração existente. Uma conversa principal por conteúdo no agente de entrada; as etapas internas do fluxo podem manter seus executores já configurados.

## Comportamento esperado

1. Dentro do chat do agente: criar ou abrir uma sessão de conteúdo com nome claro. Manter chats genéricos existentes. Lista mostra conteúdo e etapa; selecionar conteúdo A/B mantém o mesmo agente, modelo, skills e fluxo. Conteúdos não são identificados apenas pelo título: vínculos persistentes e validados por perfil/workspace/contentId/sessionId.
2. Retomada: resumo baseado no estado REAL (materiais associados, última decisão, etapa, próxima ação). Mensagens da IA não avançam estado. Evitar rodar novamente roteiro, edição ou Notion ao abrir/trocar sessão. Os comandos do chat e controles de produção devem operar somente no conteúdo selecionado; respostas tardias e jobs em fila continuam vinculados à sessão original.
3. Entrada com material existente: permitir anexar/importar vídeo local e associar card Notion existente OU contexto/roteiro colado na sessão. Mostrar os vínculos e uma revisão curta antes de iniciar a edição. Ler somente o card escolhido com conexão autorizada; sem varrer workspace, criar ou atualizar card existente. Se card não for acessível, pedir texto/contexto com erro honesto. Não recriar planejamento já fornecido e não simular aprovações antigas. Registrar origem/material importado e autorização atual de edição de forma explícita e idempotente.
4. Integrar às etapas existentes de edição, legendas, capas, pacote e agendamento. Continuar respeitando revisão humana e autorizações já presentes; não publicar automaticamente. No chat deve haver indicação acionável da próxima etapa (controles existentes integrados, sem obrigar o usuário a escolher outro agente). Não prometer visão de vídeo ao Claude quando só há texto/metadados/transcrição.
5. Dois conteúdos simultâneos: históricos, rascunhos, arquivos, contexto Notion, execuções e aprovações separados. Renderizações podem usar a fila existente; não exigir processamento pesado paralelo. Troca de sessão não deve cancelar outro conteúdo nem importar contexto de sessões vizinhas. Desvincular/excluir sessão não destrói produção/arquivo sem ação explícita.

## Pistas do código atual

- `AgentSession` já tem contentId/topicId/productionContext; `ChatProvider` tem drafts por sessão, remoteSessionId e snapshot de produção.
- `production-coordinator.mjs` cria source/editor/publisher sessions e espelha resultados. Start começa em writing; action video exige recording e roteiro aprovado. Planejamento lê card ligado por readCard.
- `src/features/production/model.ts:mergeProductionSessions`, `ProductionProvider`, `ChatPanel`, lista de sessões, `ProductionDialog`, `ContentWorkflowProvider` e rotas de mídia são pontos prováveis. Inspecionar antes de alterar.
- Instalação atual 0.3.57 e 449 testes verdes. Muitas alterações locais ainda sem commit: preservar todas.

## Limites e validação

- Não tocar SQLite pessoal, históricos pessoais, credenciais, mobile, assinaturas ou publicações. Nada de IA real, Notion real, chamadas pagas, commit/tag/reset, dependências novas sem necessidade comprovada.
- Ler skill frontend-design local para a UI, preservando tokens/layout existente; sem redesign geral. Usar textos simples em português e inglês, foco/teclado e estados de erro/carregamento.
- Evidência necessária: duas sessões do MESMO agentId com skills mantidas, prompts/rascunhos/arquivos/card sem vazamento entre A/B; retomada após reinício sem repetição de job; vídeo já gravado + contexto/card simulado chega à edição sem gerar roteiro nem upsert Notion; card inacessível não inventa contexto; aprovação e respostas tardias do A não alteram B; compatibilidade de chats/produções antigos.
- Rodar testes focados e um Electron integrado com serviços externos simulados e mídia sintética/local, plus typecheck/build completo (não vite isolado: apaga bundle Remotion). Rodar npm test UMA vez no final se backend/modelos mudarem. NÃO executar laço global de todos test-*-ui.mjs: a rodada anterior já mostrou custo excessivo. Sem sleeps/tool waits acima de60s; checkpoints e leitura inbox após testes.
- Escrever relatório com comportamento, arquivos, testes e limites em `docs/analysis/content-sessions-report-2026-10-08.md`. Primeiro implementar e validar; sem NSIS/instalação neste despacho. Coordenador encaminha atualização local após aceitar QA. Emitir worker_done uma única vez, com IDs exatos do preâmbulo, e encerrar turno.
