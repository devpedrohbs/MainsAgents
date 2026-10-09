# Rodada desktop aprovada — 07/10/2026

Usuário autorizou iniciar o backlog de desktop e acrescentou escolha de geração Codex/Claude e duas opções de resposta. Projeto mobile fora do escopo.

Backlog base: desktop-backlog-proposal-2026-10-07.md. Executar em ondas, preservando histórico e direção visual Precisão.

## Primeira onda

- Sonnet 5.5: D01, capturas/testes visuais confiáveis. Propriedade scripts de UI e relatório task-D01-2026-10-07.md. Não editar app/runtime.
- Opus 5.5: D02, preflight de produção; também mapear D13, lacunas reais de escolha Claude/Codex. Propriedade production-preflight.mjs, declaração de tipos, testes preflight, integração mínima em production-coordinator.mjs/ProductionDialog.tsx/model de preflight se necessária. Sem editar Home/App/Flow ou providers/chat na primeira onda.
- Codex 6.1 Low: D03, consulta de execuções/fila com dados reais. Propriedade nova visualização e integração Home/App; somente leitura dos providers existentes. Não editar coordenador, diálogo de produção, fluxo ou scripts propriedade Sonnet.

## D13 — Escolher Codex, Claude ou consultar ambos

P1 · Grande · Opus para runtime/capacidades; Codex para UI em onda posterior. Sonnet para rótulos/testes simples após contratos.

Já existem ClaudeCliProvider e comparação de agentes. Reaproveitar, não criar adaptador paralelo. Auditar conexão/login/modelos, chat/geração editorial, retomada, cancelamento, ferramentas e aprovações. Mostrar diferenças reais; nunca oferecer equivalência de capacidades inexistente.

Comportamento alvo: escolher provedor/modelo antes de nova execução; consulta a ambos é explícita, com mesmo briefing e respostas identificadas/independentes. Falha de um não apaga o outro. Seleção de resposta apenas prepara rascunho; outra execução ou ação externa depende de pedido/autorizações aplicáveis. Sessão existente mantém provedor original; troca abre nova sessão sem perder histórico. Não exigir dois envios quando usuário escolheu só um.

Aceite: endpoints/provedores simulados verificam isolamento, cancelamento, recuperação, dois resultados, limites/erros e ausência de execução automática ao abrir/reabrir. Chamadas pagas e instalações pessoais fora dos testes. Integração real autenticada só declarada após evidência específica.

## Coordenação

Modelos confirmados por leitura dos terminais: Sonnet 5.5, Opus 5.5, GPT-6.1-Sol low. Usar terminais existentes; não iniciar novos agentes. Cada worker registra relatório e envia settlement pelo protocolo Orca. O coordenador integra/valida e define a próxima tarefa após a conclusão da atual.

Nenhuma publicação, alteração do banco pessoal, instalação do aplicativo ou release nesta rodada. Sem mudanças no projeto mobile. Não sobrescrever alterações de outros agentes. Dependências e arquivos de integração compartilhados precisam de acordo com coordenador.

## Estado após implementação e validação

Run Orca: `run_9eabdb6487a4`. Os terminais existentes foram reutilizados com modelos conferidos: Sonnet 5.5, Opus 5.5 e GPT-6.1-Sol low.

| Item | Resultado desta rodada |
| --- | --- |
| D01 | Helper de capturas confiáveis, migração dos testes pertinentes e correção da expectativa de expansão da Inbox. Validado. |
| D02 | Preflight por etapa, revalidação no servidor, fingerprint das configurações e consentimento indisponível enquanto a verificação carrega. Validado. |
| D03 | Painel de execuções na Home, filtros por workspace, navegação para a produção/sessão exata, sem execução automática. Validado. |
| D04 | Diagnóstico e explicação do desenho versus ordem fixa de execução, com preservação dos diagramas e aviso sobre produções em curso. Validado. |
| D11 | Primeiro lote: contraste/foco dos links de pré-requisito e rótulo estrutural honesto no Fluxo. Demais polimentos permanecem no backlog. |
| D12 | Documentação atualizada: separa código local, instalador público, capacidades reais e evidência simulada/real. Fechamento validado. |
| D13 | Chat: um agente com Codex, Claude ou ambos, modelos próprios e sessões independentes. Comparação antiga preservada. Validado com provedores simulados. |

**D13 não implementa Claude na geração editorial persistente nem na produção semiautomática.** Os limites de reconciliação e geração de capas estão mapeados em task-D13-provider-gap-2026-10-07.md. D05–D10 seguem planejados; a aprovação permanece registrada, mas não receberam execução nesta rodada.

Verificação final: `npm test` **298/298**, `npm run build`/TypeScript aprovados; testes Electron de escolha de provedor, comparação legada, preflight, execuções, semântica do Fluxo, produção semiautomática, fluxos persistentes, Inbox, interface refinada e persistência nativa passaram pela equipe/coordenador. A regressão do fixture de consentimento foi corrigida preservando a prova de autorização antes de iniciar. Capturas reais foram inspecionadas em temas e larguras compactas; foco nativo em janela visível e autenticação real não foram exercitados.

Entrega no código e `dist`, sem novo instalador, instalação pessoal, commit ou publicação. Histórico pessoal não foi acessado para validação. Relatórios por tarefa e imagens usam dados sintéticos.
