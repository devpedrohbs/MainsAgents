# MainsAgents desktop — resultado da primeira rodada

Data: 07/10/2026. Código local 0.3.54. Coordenação Orca `run_9eabdb6487a4`.

## Entregas

- **Escolha de IA no chat:** “Gerar com” oferece Codex, Claude ou ambos para o mesmo agente. A escolha individual prepara nova conversa e copia o rascunho/contexto sem enviar. “Ambos” exige revisão antes das duas consultas, com provedores/modelos identificados, respostas independentes e seleção que prepara um rascunho. O agente e suas conversas antigas permanecem intactos.
- **Produção:** verificação prévia mostra bloqueios, avisos e requisitos não verificados. O servidor revalida a configuração, e mudanças nas instruções/permissões invalidam a conferência. O consentimento só pode ser marcado quando a verificação está pronta. Gravação não é exigida antes da etapa correta.
- **Execuções:** Home lista estados, etapas, agentes, motivos e atualização por workspace. Os atalhos abrem a produção e o chat corretos. Não inventa posição de fila, ETA ou progresso percentual.
- **Fluxo:** diagnóstico identifica papéis ausentes/duplicados e diferenças entre o desenho e a execução semiautomática linear. Conexões usadas no briefing manual permanecem funcionais. Visualizar não modifica nem executa o diagrama.
- **Validação e visual:** capturas esperam a interface real; Inbox expandida é testada explicitamente; links de pré-requisito ganharam contraste 6,50:1 no escuro e 5,48:1 no claro, com estilo de foco.
- **Documentação:** versões locais e públicas são separadas, com capacidades e limites por provedor.

## Evidências

- `npm test`: **298 testes aprovados**, zero falhas/cancelados/ignorados; log final em `%TEMP%/mainsagents-desktop-final-20261007-tests.log`.
- `npm run build`: TypeScript e Vite aprovados. Aviso de bundle acima de 500 KB permanece; não é falha de compilação.
- Electron com renderer real e perfis isolados: escolha de provedor, comparação legada, preflight, painel de execuções, semântica de Fluxo, produção semiautomática, fluxos persistentes, Inbox, interface refinada e persistência nativa.
- Regressão encontrada e corrigida: fixture de produção marcava consentimento antes da chegada do preflight; passou a esperar readiness e provar que zero produções existem antes da autorização. O produto também bloqueia o consentimento durante a verificação.

Relatórios detalhados: task-D01*, task-D02*, task-D03*, task-D04*, task-D11*, task-D12* e task-D13* neste diretório. Principais capturas de seleção/comparação: `.mainsagents-workspaces/provider-choice-ui/1791385738187/`; preflight e painel usam seus próprios diretórios de fixtures.

## Limites

Integração de IA validada com endpoints simulados; sem chamadas reais ou uso de contas pessoais. Claude na produção semiautomática e na fila editorial persistente ainda exige trabalho de reconciliação/capacidades; o recorte entregue é chat/ideias. Modelos do par same-agent são fixados nessa comparação; outra escolha inicia uma nova consulta.

Não houve novo instalador, instalação, commit, release nem publicação externa. A instalação existente e o banco pessoal não foram alterados. O projeto mobile ficou fora desta rodada.

Janela de teste offscreen permite verificar teclado e estilos, mas não equivale a validar o anel de foco nativo em uma janela visível. D13 foi conferida a 880px; zoom 200% foi exercitado no painel de execuções, não nessa escolha de IA. Sobreposição antiga de rótulos do Fluxo em 360px permanece registrada, sem bloquear o uso desktop.

## Próxima sequência do backlog

1. D05: fonte consistente de status entre Home, Fluxo e Estúdio.
2. D06: prévia de recuperação, distinguindo verificar, continuar e reenviar.
3. Continuação D13: geração editorial com Claude, com tratamento explícito de execução incerta e capacidades reais.
4. D07–D10: contexto editorial versionado, modelos reutilizáveis, rotinas locais e revisão de materiais.

Estas tarefas seguem planejadas; nenhuma foi anunciada como concluída nesta entrega. Os terminais do usuário permanecem disponíveis para a próxima onda.
