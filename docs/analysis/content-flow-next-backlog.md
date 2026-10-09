# Próxima rodada: ideia, gravação e capas

Rodada aprovada pelo usuário em 07/10/2026. Desenvolvimento supervisionado no Orca, Run `run_77f9b5909968`. A atualização local 0.3.55 foi concluída e é separada desta rodada.

F01–F06 implementados e conectados ao app. Desenvolvimento por Claude Opus e Sonnet; Codex permaneceu na coordenação. Validação final: 392/392 testes, build completo e testes do percurso integrado no Electron. QA dos componentes: 31/31 etapas, zero erros de console e zero achados de contraste nos três componentes novos.

Empacotamento e atualização local 0.3.56 concluídos (`task_780ef2eb76b5`). Instalado no caminho oficial, com hash do pacote conferido também pelo coordenador, backup consistente e as 38 chaves originais de estado preservadas. Os três checks empacotados passaram, incluindo geração real de três capas a partir do módulo carregado de dentro do asar. Evidências e limites estão em [content-flow-integration-report.md](content-flow-integration-report.md) e [local-update-0.3.56.md](local-update-0.3.56.md). As seções de situação atual e tarefas abaixo registram a linha de base e o escopo aprovado, anteriores à implementação.

## Situação atual

- A ideia estruturada é capturada do chat com ação do usuário; não há descoberta automática de Reels.
- Aprovar a ideia inicia roteiro e envio ao Notion. O coordenador escolhe as primeiras opções de hook/CTA/caminho; falta uma aprovação obrigatória do roteiro antes de liberar a gravação.
- A gravação acontece fora do app; o usuário importa o vídeo.
- Edição local com Whisper, FFmpeg e Remotion já tem revisão de cortes e exportação. Tempos de transcrição são aproximados e requerem revisão.
- A direção de capa existe no roteiro. A imagem final é gerada depois da aprovação do vídeo; ainda falta seleção entre alternativas e fallback por frame/template.
- Codex/Claude/ambos estão disponíveis no chat. O coordenador de produção ainda depende do runtime Codex: selecionar Claude no chat não muda todo o pipeline.

## Fluxo desejado

Referências → ideia, promessa e conceito de capa → aprovar ideia → roteiro e plano de gravação → aprovar roteiro → Notion confirmado → gravar fora do app → importar → editar → revisar vídeo → escolher capa final → aprovar pacote → publicar mediante autorização.

## Tarefas propostas

| ID | Prioridade | Dono sugerido | Complexidade | Resultado verificável | Depende de |
|---|---|---|---|---|---|
| F01 | P1 | Claude Opus | Alta | Gate de roteiro: escolher hook/CTA, editar e aprovar uma versão; gravação só liberada para versão aprovada, com entrega ao Notion confirmada. Mudança posterior do roteiro exige nova aprovação. | — |
| F02 | P1 | Claude Sonnet | Média | Pacote de gravação ligado à versão do roteiro: fala, cenas, B-roll, produtos/materiais e checklist. Progresso visível e ação explícita de importar o vídeo. | F01 |
| F03 | P1 | Claude Opus | Alta | Três capas locais por vídeo, usando frames selecionáveis e templates diferentes; título, logo e enquadramento ajustáveis. Escolha persistida por versão/formato, original preservado e cancelamento sem entrega parcial. IA opcional, nunca necessária para exportar a capa local. | — |
| F04 | P1 | Claude Sonnet | Média | Galeria de capas com prévia por destino, comparação, seleção, ajuste de texto/frame e aprovação. Diferenciar prévia de capa final exportada. | F03 |
| F05 | P2 | Claude Sonnet | Média | Biblioteca de referências importadas por link ou vídeo autorizado: fonte, autor quando disponível, notas e tags. Conteúdo inacessível fica identificado, sem análise inventada. Sem scraping automático nesta primeira entrega. | — |
| F06 | P1 | Claude Opus | Alta | Auditar e integrar Claude no coordenador por etapa. Capabilities/preflight reais; geração de texto por Claude, ferramentas locais para mídia; imagem por IA só com provedor compatível. Sem chamadas pagas automáticas, troca silenciosa de provedor ou perda de histórico. | — |

## Divisão de arquivos e execução

- Opus possui contratos, persistência, API e coordenador. Sonnet possui componentes de apresentação e documentação dos estados, com contrato fechado primeiro.
- Começar por F01 e F03 em módulos separados. Depois F02 e F04. F06 requer coordenação explícita com F01, pois ambos podem alterar o coordenador; não editar o mesmo arquivo em paralelo.
- F05 pode seguir independentemente depois de conferir disponibilidade do Sonnet.
- Cada despacho precisa conter arquivos permitidos, invariantes, critério de aceite e evidência de teste. O coordenador valida a entrega antes da próxima dependência e antes do instalador.
- Codex permanece na coordenação e revisão leve, respeitando a preferência de economia do usuário.

## Próximas decisões de produto

Três alternativas de capa são o padrão proposto; gerar mais é uma ação explícita. Para Reels, começar por links e conteúdo autorizado; avaliar um provedor de busca/coleta com permissões e custos conhecidos antes de automatizar descoberta. Identidade visual por workspace e retorno de desempenho podem entrar numa rodada posterior.
