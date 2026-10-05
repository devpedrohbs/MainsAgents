# MainsAgents — backlog derivado da auditoria

Data: 02/10/2026. Base: [auditoria](C:/Users/pacas/Documents/ChatGPT/MainsAgents/docs/analysis/mainsagents-audit-2026-10-02.md). A execução começou na versão 0.3.31; o estado abaixo distingue o que foi entregue das partes ainda pendentes.

## Distribuição pública Windows — 0.3.41

- [CI Windows aprovada no commit bc6bfb5](https://github.com/devpedrohbs/MainsAgents/actions/runs/37351382504): 199 testes, instalação limpa, interfaces e preservação do pacote.
- [Prévia pública v0.3.41](https://github.com/devpedrohbs/MainsAgents/releases/tag/v0.3.41) com instalador validado pela CI, checksum e manifesto. SHA-256 do instalador publicado: `8192a709bbbf1899ad679b7f914f2cf853eb0b8169f70ad5121b5cbdb55f54e2`.
- AUTO-21 entregue no recorte de distribuição pública Windows/MIT. Certificado de assinatura é opcional e não está configurado; outras plataformas não receberam instalador nesta rodada.
- Instalação pessoal 0.3.41 ainda aguarda o usuário fechar o app. A geração/publicação não altera a versão que está aberta no desktop.

## Fechamento de edição, calendário e rascunhos — 0.3.41

- Edição/reagendamento do mesmo post LinkedIn texto no Publora, com prévia, nova aprovação, versão persistente, leitura antes/depois, expiração e recuperação sem recriação.
- Atualização automática opcional do calendário por perfil/workspace/provedor, com intervalo persistente e preservação do cache em falhas.
- Rascunhos persistentes nos formulários editoriais, revisões, briefing, entregas, alterações externas e parâmetros de corte. Incluídos no backup JSON; sem credenciais/autorizações.
- Validação local: 199 testes e regressões Electron de publicação, rascunhos, arquivos, Inbox, handoff e preservação do pacote. [Uso e limites](../publication-edit-and-drafts-increment.md).
- Ainda parcial: mídia/publicação Zernio e suas opções de rede; validação real autorizada de escrita Notion/Publora; equivalência de runtimes externos ao recorte existente. FFmpeg avançado continua adiado; observação de pastas e sincronização Notion bidirecional são extensões opcionais, não aceites obrigatórios do primeiro recorte.

## Calendário dos provedores — 0.3.40

- Consulta manual de contas/posts Publora e Zernio pelo MCP, seleção por workspace, calendário mensal e agenda compacta, detalhes, cache SQLite por perfil, paginação e aviso de dados desatualizados. [Fluxo, contratos e limites](../provider-calendar-increment.md).
- Publora validado em leitura real: duas contas e zero posts. Zernio MCP retornou resumos insuficientes; alternativa API com chave criptografada por perfil no desktop. Em 05/10/2026 o usuário cadastrou a chave e confirmou que a consulta funcionou. Isso valida a consulta, não mídia/publicação Zernio ou edição/reagendamento nativos.
- Prioridades: mídia + publicação Zernio → edição/reagendamento → validação real autorizada → AUTO-16 → AUTO-17/18 → AUTO-19/20. FFmpeg/novas funções de edição de vídeo adiados pelo usuário em 05/10/2026.

## Publicação integrada — 0.3.39

- **AUTO-15 parcial entregue:** LinkedIn texto via Publora MCP, seleção explícita da conta, rascunho externo ou agendamento, prévia da versão exata, autorização separada, intenção SQLite de uso único, idempotência, consulta verificável e cancelamento autorizado para rascunho. Falhas, perda de identificador e mudanças externas bloqueiam reenvio automático. [Fluxo e limites](../publication-connector-increment.md).
- **Prioridade seguinte:** completar mídia e o conector Zernio (Instagram/TikTok), além de edição/reagendamento nativos. Só então iniciar AUTO-16 (rotinas), seguido de AUTO-17/18 (memória/projetos). AUTO-19/20 continuam pendentes.
- AUTO-21: a publicação de uma release pública e a assinatura opcional continuam pendentes. A validação Windows da 0.3.38 está registrada abaixo.

## Fechamento local — 0.3.38

A prioridade desta rodada foi concluir recortes iniciados antes de abrir AUTO-15–20. Detalhes e limites: [fechamento das pendências locais](../completion-increment.md).

- **AUTO-03/06/08:** identidade editorial das capturas/sessões/Canvas e cartões de arquivos entregues, com revisão exata, feedback e invalidação quando arquivos mudam. Prosa livre permanece texto; outras saídas especializadas precisam de contrato próprio.
- **AUTO-07 entregue para os chats locais:** Inbox de respostas não vistas, falhas, autorizações pendentes, acesso à sessão e avisos com silenciamento persistente. Histórico antigo começa visto; trabalhos não executam com PC/app encerrado.
- **AUTO-05 entregue no recorte Codex MCP:** matriz granular por agente, aprovação de cada chamada permitida e bloqueio conservador de ferramentas genéricas em políticas restritas. MCP/escrita Claude e equivalência de outros runtimes continuam bloqueados, não implementados.
- **AUTO-11:** envio manual comum migrou para fila nativa; especialistas Codex/Claude mantêm instruções, skills, resultado, identidade de sessão e recuperação explícita. Origem automática permanece Codex; Gemini e execução automática de FFmpeg não estão implementados.
- **AUTO-12:** requisitos declarados de skills, FFmpeg/ffprobe, diagnóstico Claude e teste real de leitura Zernio após aprovação, com recibo histórico. Demais servidores ainda precisam de contrato nativo específico; modelos/login Claude reais dependem de instalação e conta.
- **AUTO-21:** instalador 0.3.38, dependências empacotadas e hashes verificados; dados existentes preservados. [CI Windows aprovada](https://github.com/devpedrohbs/MainsAgents/actions/runs/37256301995) no commit `9b8a361`: 172 testes, instalação limpa NSIS, fluxos Electron e preservação de dados com app.asar instalado. Artefato baixado com SHA-256 conferido. Restam a publicação de uma release pública e assinatura opcional; certificado não está configurado.
- **AUTO-15–20 não iniciados nesta rodada.** Integração de publicação continua sendo o próximo incremento depois dos gates acima.

Validação: 172 testes automatizados, build, regressões Electron e exportação de vídeo sintético. Sem escrita no Notion pessoal, postagem real ou tokens pagos. O estado principal e editorial do desktop foi comparado integralmente com o backup após instalar.

## Histórico de progresso — 0.3.37


- **AUTO-01 entregue:** editorial no SQLite permanente compartilhado, migração única com cópia de recuperação, fila integrada ao salvamento/fechamento, recusa de sobrescrita concorrente e resposta inválida. Testes incluem WAL, lançadores, atraso, falha e perda do recibo de aprovação.
- **AUTO-02 entregue para o desktop:** snapshot consistente, restauração transacional de estado principal, editorial, recibos e conexões, diário de recuperação na versão web, imagens e manifesto de referências de skills. Prévia aponta vínculos ausentes; arquivos externos não são copiados no JSON. Trabalhos importados não executam automaticamente. A exportação web ainda não inclui o histórico de trabalhos do serviço Node.
- **AUTO-03 parcial:** LinkedIn, etapas de produção, identidade de conteúdo em tarefas e novas sessões editoriais, objetos de roteiro do Canvas ligados à versão aprovada. Biblioteca de arquivos entregue em AUTO-10; entregas independentes por plataforma e calendário local entregues na 0.3.37 (AUTO-14); conversas antigas permanecem preservadas.
- **AUTO-04 entregue no recorte editorial Codex (0.3.34):** pesquisa, roteiro e transferência manual usam Node/SQLite; navegar não interrompe. Entrada imutável, eventos, resposta parcial, concessão de um único executor, cancelamento e até três tentativas. Verificação recupera um turno concluído sem reenviar; um turno ativo bloqueia outro escritor; reenvio incerto exige confirmação. Fechar o desktop interrompe a execução e guarda a recuperação, sem daemon. Outros provedores ainda não migraram; a delegação automática Codex dos chats comuns ganhou uma fila nativa separada na 0.3.36, descrita em AUTO-11.
- **AUTO-05 parcial:** o caminho nativo de escrita editorial no Notion exige aprovação da ação, destino e versão vigente antes de cada escrita. Aprovar roteiro não autoriza publicar. Na 0.3.35, a revisão no chat e no Estúdio também confere o snapshot completo das opções e o destino mostrado, recusando alterações durante a decisão. Na 0.3.36, chats Codex do desktop exigem aprovação única dos argumentos exatos para cada ferramenta de servidores MCP configurados, com auditoria persistente e sem reaproveitar concessões após reinício/backup. Apps/plugins são desativados nessas threads, Claude continua sem MCP e formulários desconhecidos são recusados. Matriz granular de ações e suporte equivalente aos demais runtimes permanecem pendentes; instruções de skills não são controle técnico universal.
- **AUTO-06 parcial:** botão nativo de aprovação pode criar/atualizar e verificar um único card, guardar recibo e acrescentar versões sem apagar notas ou avançar o estágio manual. Timeout de criação é reconciliado por identidade; resultados incertos bloqueiam nova criação. Na 0.3.35, a revisão de roteiro no cartão do chat converge no mesmo serviço/evento nativo. Na 0.3.37, comandos explícitos como “aprovo esse roteiro”, “rejeito esse roteiro” e “ajuste: ...” abrem a confirmação local da versão correspondente; não autorizam diretamente uma escrita. Rejeição/ajuste preservam versões e revogam a aprovação vigente; a próxima execução usa o feedback. Outras entregas continuam pendentes. Nenhum card foi criado na base pessoal durante os testes.
- **AUTO-07 parcial (0.3.32):** Home com próximos passos editoriais do workspace, revisão da versão vigente, pesquisa/roteiro pendente, falhas e acesso direto à pauta/conteúdo no Estúdio. Pendência decidida sai da lista; falha ao consultar a fila fica visível sem ocultar revisões locais. Na 0.3.37, inclui entregas por rede aguardando revisão. Entregas não vistas, notificações/silenciamento e Inbox de todos os chats continuam pendentes.
- **AUTO-09 entregue para os chats (0.3.32):** texto não enviado, skill e referências do Canvas persistidos por perfil/agente/sessão. Chat principal/flutuante e Canvas compartilham rascunho da mesma sessão; envio e exclusão limpam somente os registros correspondentes. Contexto ausente é sinalizado; backup valida e inclui rascunhos, mantendo conflito local no merge. Formulários de criação e edição do Estúdio não fazem parte deste item.
- **AUTO-10 entregue (0.3.33):** biblioteca por conteúdo/workspace, arquivos locais por seleção ou drag and drop, funções original/referência/resultado, origem dos derivados, SHA-256 e versões. Detecta ausência/alteração, permite religação do mesmo arquivo, verifica antes de mostrar na pasta e remove somente vínculos. Metadados entram no salvamento e backup; arquivos externos permanecem no PC. Observação automática de pastas é opcional e não foi implementada.
- **AUTO-11 parcial (0.3.34):** transferência manual no Estúdio guarda briefing, versão aprovada, configuração/skills, arquivos verificados e sessão do destinatário. Mantém a sessão por conteúdo/especialista ou abre outra explicitamente; resposta estruturada e impedimentos ficam salvos e acompanhados em duas colunas. Na 0.3.35, a transferência manual editorial também parte de uma entrega aprovada no chat, com o mesmo acompanhamento/retomada. Na 0.3.36, delegação automática Codex → Codex no Chat/Canvas usa fila Node/SQLite independente do React, sessões reutilizadas, arquivos das skills do receptor, limites de profundidade/ciclo, resultados parciais, cancelamento e recuperação sem reenviar turno concluído. Fechar interrompe, sem daemon; recuperar o especialista não reabre automaticamente o pedido antigo do agente de origem. Envio manual comum e outros provedores ainda não migraram integralmente; exportação local manual verificável foi entregue no recorte de AUTO-13; delegação ainda não executa FFmpeg automaticamente. O especialista não recebe controle do computador.
- **AUTO-08 parcial (0.3.35):** cartões de pesquisa com fontes e opções de roteiro, captura autoritativa de resposta concluída no desktop, origem/hash e versões. Roteiro editável/aprovável dentro do chat, com ação fixa e destino Notion conferido. Nova proposta preserva versões anteriores e exige aprovação. Prosa livre e formatos próprios das skills permanecem texto; rejeição e pedido de ajuste por conversa foram adicionados na 0.3.37, mantendo a confirmação explícita. Cartões editoriais de vídeo/arquivos no chat continuam pendentes; a revisão de exportações locais está no Estúdio.
- **AUTO-13 entregue no recorte de corte/exportação manual (0.3.37):** detecção de FFmpeg/ffprobe, entrada e versão verificadas, intervalo delimitado, saída nova H.264/AAC, progresso, cancelamento, retomada explícita e revisão dos arquivos reais. Duração/áudio são conferidos antes de registrar o resultado; fechar interrompe e guarda o trabalho. FFmpeg deve estar instalado no PC; não está embutido no instalador. Sem controle do computador, montagem complexa, legendagem ou operação automática pelo especialista.
- **AUTO-14 entregue para planejamento e revisão local (0.3.37):** entregas independentes por rede, texto/mídia versionados, aprovação exata, histórico e calendário com fuso. Alteração revoga a aprovação; horário planejado não aparece como agendamento confirmado. Envio, confirmação externa e reconciliação dependem de AUTO-15.
- **AUTO-21 parcial (0.3.37):** MIT escolhida pelo mantenedor, contribuição, segurança, privacidade/arquitetura/release atualizados e CI Windows preparada. CI ainda não executada no GitHub; publicação de release, assinatura e validação de download público/perfil limpo permanecem pendentes.
- **AUTO-12 parcial; AUTO-15–20 pendentes**, além dos itens explicitamente restantes acima.

Validação anterior (0.3.34): build TypeScript/Vite, 121 testes automatizados, seis testes de interface Electron isolados (trabalhos, aprovação, arquivos, rascunhos/Inbox, chat e persistência). Contrato da CLI instalada testado sem inferência; streaming completo testado com processo simulado. Desktop 0.3.34 instalado e dados pessoais comparados com o backup, sem alterações. Nenhuma escrita na base Notion pessoal ou geração na conta pessoal nesta rodada. Detalhes: [execução persistente](../persistent-editorial-work-increment.md), [incremento editorial anterior](../editorial-runtime-increment.md), [rascunhos e Home](../drafts-inbox-increment.md) e [biblioteca de arquivos](../content-files-increment.md).

Na 0.3.35: 127 testes automatizados, novo teste de interface para entregas e regressões repetidas. Escopo e limites: [entregas no chat](../chat-deliveries-increment.md). Aprovação universal de MCP e delegação dinâmica persistente continuam sendo as próximas prioridades.

P0 = confiabilidade necessária para a automação; P1 = fluxo editorial utilizável; P2 = expansão e preparação pública. Esforço é relativo, não uma promessa de prazo. Cada implementação deve preservar agentes, skills, sessões e dados existentes. O Editor de Vídeo deve permanecer sem controle do computador.

## Primeiro incremento: roteiro aprovado chega ao Notion

### AUTO-01 — Salvamento editorial completo [P0 · médio]

**Pedido:** migrar `editorial.sqlite` para o diretório permanente, com migração transacional e recuperação. Registrar a fila editorial no salvamento explícito e no fechamento; mostrar falha de gravação sem falso estado de sucesso.

**Aceite:** criação de pauta e aprovação sobrevivem a fechar imediatamente; teste com gravação atrasada/falha mantém recuperação; abrir por menu, atalho e processo MSIX usa o mesmo banco; nenhuma migração abre dados vazios silenciosamente. Não voltar a importar bancos antigos sobre dados atuais.

### AUTO-02 — Backup consistente e restauração recuperável [P0 · médio]

**Pedido:** exportar um snapshot coerente do estado principal e editorial, com imagens e manifesto de arquivos/skills associados. Fazer prévia da restauração e garantir rollback ou retomada se a segunda parte falhar.

**Aceite:** teste de falha entre as duas gravações não deixa uma restauração parcial sem recuperação; alterações pendentes entram no backup ou impedem exportação com motivo claro; credenciais ficam fora; arquivos externos ausentes aparecem como vínculos a reparar. Criar backup antes de migrações.

### AUTO-03 — Identidade única do conteúdo [P1 · médio · depende de 01]

**Pedido:** evoluir o modelo existente com etapas de gravação, edição e entrega; incluir LinkedIn; associar tarefas, sessões, versões, mídia e vínculos externos ao `contentId`. Separar estado editorial, execução técnica e publicação por plataforma.

**Aceite:** a mesma ideia abre o mesmo conteúdo em Board, Chat e Canvas; sessão antiga continua acessível; conteúdo pode ter entregas com estados diferentes por rede; migração preserva artefatos e aprovações antigos.

### AUTO-04 — Executor local persistente mínimo [P0 · grande · depende de 01/03]

**Pedido:** mover a orquestração do primeiro fluxo para um serviço Node com SQLite, trabalhos, eventos, limites, cancelamento e recuperação. React apenas solicita e acompanha. Não construir inicialmente um editor genérico de workflows.

**Aceite:** navegar entre telas não interrompe o trabalho; reiniciar reconcilia execuções; trabalho bloqueado explica o motivo; eventos não desaparecem; escrita externa não é repetida cegamente após timeout; a mesma sessão não recebe escritores concorrentes.

### AUTO-05 — Aprovações vinculadas à ação e versão [P0 · grande · depende de 03/04]

**Pedido:** validar no serviço a aprovação para ações externas relevantes e sobrescritas. Apresentar conteúdo, destino e efeito; guardar versão autorizada. Aplicar o controle também ao caminho de ferramentas usado pelos agentes.

**Aceite:** roteiro aprovado não autoriza publicação; alteração do payload autorizado exige nova decisão conforme a política; chamada direta do agente não contorna uma ação pendente; rejeição, ajuste e autorização ficam no histórico. O controle precisa ser demonstrado com teste, não só instrução na skill.

### AUTO-06 — Aprovação dispara card no Notion [P1 · médio · depende de 03/04/05]

**Pedido:** registrar `scriptApproved` e atualizar/criar o card da base já configurada. Guardar `notionPageId`, versão enviada e comprovante de leitura; preservar campos editados manualmente e estados adiantados.

**Aceite:** aprovar cria um único card com roteiro/checklist e estágio correto; tentar novamente não duplica; interrupção depois de criação permite reconciliar; falha aparece com ação de retomar; botão de aprovação e aprovação pela conversa convergem no mesmo evento. Usar ambiente de teste antes de uma escrita real autorizada.

## Segundo incremento: revisão e arquivos sem caça ao chat

### AUTO-07 — Caixa de entrada e Home acionável [P1 · médio · depende de 03/04/05]

**Pedido:** reunir aprovações, entregas não vistas e bloqueios. Cada item abre o artefato correto e sua sessão, com ação principal e histórico. Preservar Home sem gráficos.

**Aceite:** aprovação de versão antiga não afeta a nova; pendência resolvida desaparece da fila; erro abre recuperação; badges representam eventos reais. Notificar apenas entregas ou decisões relevantes, com opção de silenciar.

### AUTO-08 — Entregas estruturadas dentro do chat [P1 · médio · depende de 03/05]

**Pedido:** renderizar pesquisa, roteiro e arquivos como entregas versionadas com ações de abrir conteúdo, aprovar e ajustar; manter streaming e mensagens existentes.

**Aceite:** ações identificam a versão exata; ajuste preserva a anterior; imagem/vídeo abre o arquivo real; composer continua fixo e navegável por teclado; não exibir sucesso sem resultado persistido.

### AUTO-09 — Rascunhos sobrevivem ao reinício [P1 · pequeno]

**Pedido:** substituir a dependência de `sessionStorage` por persistência local de rascunhos por perfil/agente/sessão, incluindo seleção de contexto compatível.

**Aceite:** reiniciar restaura texto não enviado; trocar agente não mistura rascunhos; enviar limpa somente o rascunho correspondente; contexto excluído é sinalizado; não persistir segredos de autenticação.

### AUTO-10 — Biblioteca de arquivos por conteúdo [P1 · médio · depende de 03]

**Pedido:** aceitar arrastar arquivos, associá-los ao conteúdo e guardar metadados, disponibilidade e versão. Opcionalmente observar uma pasta autorizada, esperando término da cópia.

**Aceite:** cópia incompleta não inicia edição; arquivo inexistente bloqueia com ação clara; detectar renomeação/duplicação por identificador ou hash; abrir conteúdo mostra origem e derivados; nenhuma associação equivale a upload/publicação automática.

### AUTO-11 — Handoff durável entre os especialistas [P1 · médio · depende de 04/10]

**Pedido:** integrar a delegação já existente à fila. Transferir briefing, versão aprovada e referências de arquivos; manter sessão vinculada do destinatário e retorno estruturado.

**Aceite:** Editor de Conteúdo envia ao Editor de Vídeo sem perder contexto após reinício; ausência de ferramenta/arquivo vira bloqueio real; limitar ciclos e chamadas; resultado inclui arquivo ou explicação de impedimento, nunca uma edição fictícia.

### AUTO-12 — Conexões e capacidades verificadas [P1 · médio]

**Pedido:** reunir diagnóstico de CLI/MCP e suas capacidades no app, distinguindo instalado, autenticado, conectado e autorizado. Indicador acompanha o provedor usado. Mostrar dependências de cada skill.

**Aceite:** teste de leitura confirma a ferramenta efetivamente disponível; ausência de MCP/edição/escrita tem motivo claro; login e quota não aparecem como o mesmo erro; cada provedor mantém seu histórico; não ampliar permissões silenciosamente.

## Terceiro incremento: edição e publicação acompanhadas

### AUTO-13 — Edição local com operações limitadas [P2 · grande · depende de 05/10/11]

**Pedido:** criar executor de mídia com detecção de FFmpeg/ffprobe e operações delimitadas de corte/exportação, arquivo de saída novo, progresso e cancelamento. Sem controle da interface do computador.

**Aceite:** arquivo de teste resulta em vídeo verificável, com duração/áudio corretos; entrada não é sobrescrita; operação indisponível vira bloqueio; revisão abre antes/depois; cancelamento não deixa resultado parcial apresentado como pronto. CapCut pode continuar como acabamento manual.

### AUTO-14 — Publicações por rede e calendário [P2 · médio · depende de 03/05]

**Pedido:** guardar rascunho, em revisão, aprovado, envio pendente, agendamento confirmado, publicado e falha por entrega/rede. Mostrar calendário com fuso e distinção visual/textual de planejado versus confirmado.

**Aceite:** `plannedAt` não aparece como agendamento confirmado; Instagram e LinkedIn do mesmo conteúdo podem ter horários/estados diferentes; mudança de mídia/texto respeita aprovação; estado não depende só de cor.

### AUTO-15 — Adaptador de publicação com confirmação [P2 · grande · depende de 04/05/14]

**Pedido:** verificar operações realmente disponíveis no Publora por MCP/API; implementar consulta, agendamento autorizado, identificação externa e reconciliação. Usar um contrato independente da UI.

**Aceite:** guardar identificador e resultado do provedor; consultar após timeout antes de reenviar; mostrar erro parcial por plataforma; não marcar publicado só porque foi enviado/agendado; cancelamento e alteração externa aparecem ao reconciliar. Validar primeiro em rascunho/teste, sem postar publicamente por teste automático.

### AUTO-16 — Rotinas locais, bandeja e retomada [P2 · grande · depende de 04/07]

**Pedido:** criar rotinas configuráveis com horário, fuso, execução manual, ativação/pausa, histórico e política de horário perdido. Implementar opção explícita de continuar na bandeja.

**Aceite:** execução manual pode validar antes de ativar; suspensão/reinício não cria várias cópias; a tela informa que PC desligado não executa trabalho local; encerrar app cancela/pausa corretamente; rotina pode aguardar aprovação sem manter a IA gerando indefinidamente.

## Expansão após o primeiro fluxo confiável

### AUTO-17 — Memória editorial pesquisável [P2 · médio · depende de 03/08]

**Pedido:** reunir exemplos aprovados, tom, preferências e correções, com tags e referências às versões. Começar com busca local; recuperar apenas contexto pertinente.

**Aceite:** fonte aparece no contexto usado; correção não altera a personalidade sem aceite; dados de outro workspace/perfil não vazam; skill, memória e histórico têm papéis explícitos; embeddings não são dependência obrigatória inicial.

### AUTO-18 — Projetos reutilizáveis e ligações semânticas [P2 · médio · depende de 03/04/11]

**Pedido:** criar modelos opcionais de projeto com especialistas, notas, arquivos e conexões. Distinguir contexto, dependência e próxima etapa no Canvas; permitir referência a conteúdo/arquivo/agente no composer.

**Aceite:** criar modelo não inicia geração/publicação; cada objeto liga ao registro correto; uma seta de contexto não executa trabalho; o fluxograma apresenta estados reais; identidade visual atual é preservada.

### AUTO-19 — Radar, derivados e aprendizado com orçamento [P2 · médio · depende de 12/16/17]

**Pedido:** criar rotinas opt-in para radar de fontes escolhidas, plano semanal, derivados de conteúdo e revisão de métricas autorizadas. Deduplicar antes da IA; limitar concorrência, tentativas e volume.

**Aceite:** fonte repetida não gera nova pauta automaticamente; escolha editorial permanece sua; métricas sem acesso aparecem indisponíveis; consumo mostra dados reais fornecidos pelo runtime, sem dólar estimado fictício; hipóteses de melhoria não viram publicação automática.

### AUTO-20 — Benchmark antes de otimizar [P2 · médio]

**Pedido:** medir Canvas grande, histórico longo e streaming com imagens; localizar custo de serialização, gravação e renderização. Otimizar o gargalo demonstrado, preservando flush e recuperação.

**Aceite:** registrar cenário/hardware e comparação antes/depois; verificar integridade após otimização; não trocar stack como solução especulativa. Terminal PTY persistente pode ser um incremento separado se houver demanda por shell interativo.

### AUTO-21 — Base pública e documentação atual [P2 · médio]

**Pedido:** atualizar arquitetura e decisões antigas do backlog; preparar licença escolhida pelo mantenedor, contribuição, segurança, CI, build Windows e exemplos sem dados pessoais. Testar download/instalação e atualização em perfil limpo.

**Aceite:** guia distingue modo web/desktop e login CLI de conta local opcional; instalação limpa chega ao primeiro resultado; exemplo não depende dos seus caminhos/credenciais; atualização preserva dados; release registra versão/hash e instruções de recuperação. Não criar sincronização entre computadores ou login hospedado obrigatório.

## Rodada de runtime — 0.3.36

- **AUTO-12 parcial:** diagnóstico real de conta/modelos/estado e catálogo MCP, somente arquivos de skills associados; distingue ausente/ilegível/desativado e não confunde descoberta com leitura de negócio confirmada. Não gera inferência. Faltam provas de leitura específicas, requisitos declarados de skills e diagnóstico aprofundado dos demais provedores.
- Os incrementos AUTO-05/11/12 estão documentados em [controles de runtime](../runtime-controls-increment.md), incluindo os limites que permanecem.
- Prioridade seguinte: completar a revisão editorial e entregas por rede (AUTO-06/08/14), preparar edição verificável com FFmpeg (AUTO-13), então adapter Publora e rotinas (AUTO-15/16). A matriz de permissão e os outros provedores dos itens 05/11/12 continuam pendências explícitas.

## Rodada de revisão, calendário e mídia — 0.3.37

Validação: 154 testes automatizados aprovados; build TypeScript/Vite; testes Electron isolados de revisão por conversa, entregas independentes, calendário/reinício e exportação real com FFmpeg. Nenhuma publicação, escrita no Notion pessoal ou inferência paga realizada. Escopo e limites: [revisão, publicações e mídia](../review-publications-media-increment.md).

Prioridade seguinte: AUTO-15 (adaptador Publora com aprovação e reconciliação), AUTO-16 (rotinas locais), depois AUTO-17/18 (memória e modelos de projeto). Permanecem os recortes de 05/07/08/11/12 e a validação pública de 21. O teste final ponta a ponta ainda depende de publicação real autorizada; não declarar o backlog inteiro concluído.

## Teste final do fluxo

Um conteúdo de teste percorre pauta → pesquisa → roteiro → aprovação → card Notion → arquivo → handoff → edição verificável → revisão → entrega por rede → agendamento autorizado → confirmação. Interromper em pelo menos três pontos e provar retomada sem perda de versão, duplicação de card ou repetição de publicação. O caminho até Notion é o primeiro marco; o restante só deve ser anunciado como disponível após validação.
