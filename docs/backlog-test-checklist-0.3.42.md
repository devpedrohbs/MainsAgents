# MainsAgents 0.3.42 — backlog e roteiro de testes

Estado em 05/10/2026. O desktop pessoal foi atualizado para 0.3.42. Os 212 testes automatizados, interfaces Electron e pacote passaram; os três agentes, skills e oito sessões foram preservados. [Relatório de verificação](validation-0.3.42.md). Teste automatizado não substitui testar seu fluxo real e seus provedores.

O usuário confirmou o funcionamento do calendário Zernio após cadastrar sua chave no aplicativo. A consulta Publora foi validada com duas conexões e zero posts. Publicação real ponta a ponta e Notion pessoal ainda não foram validados nesta rodada.

**Pronto no recorte atual** significa que o fluxo descrito está implementado, não que todos os provedores ou possibilidades estejam cobertos. **Parcial** identifica trabalho adicional necessário. **Pendente** significa que o recurso do backlog ainda não foi implementado.

Use um workspace chamado **Testes** e arquivos de exemplo para experimentar sem misturar seus conteúdos de produção. Para testar publicação, comece pelo modo rascunho; um agendamento autorizado é uma ação real do provedor.

## Recursos implementados e como testar

| ID | Recurso e estado | O que já faz | Teste manual e resultado esperado |
|---|---|---|---|
| AUTO-01 | Salvamento — pronto | Estado principal e editorial no SQLite permanente; gravação coordenada, recuperação e proteção contra sobrescrita concorrente. | Crie um agente, uma pauta e uma mensagem. Feche e abra pelo menu Windows e pelo atalho. Os mesmos registros devem continuar lá. |
| AUTO-02 | Backup — pronto no desktop | Snapshot coerente, prévia, mesclagem/substituição e recuperação. Inclui histórico e referências de skills/arquivos; segredos ficam fora do JSON. | Exporte um backup em Configurações e confira a prévia de importação. Ela deve reconhecer seus agentes e dados. Não restaure sobre seu trabalho apenas para experimentar. |
| AUTO-03 | Identidade do conteúdo — parcial | Pauta, conteúdo, tarefas, sessões, arquivos, entregas e objetos editoriais do Canvas ligados ao mesmo conteúdo. | Abra um conteúdo pelo Estúdio e seus vínculos no chat/Canvas. Deve abrir o registro correspondente. Ligações editoriais valem para objetos associados; uma nota solta não vira conteúdo automaticamente. |
| AUTO-04 | Execução persistente — parcial | Fila Node/SQLite para o fluxo editorial Codex, eventos, cancelamento e recuperação de execuções interrompidas. | Inicie uma pesquisa e navegue para outra tela. O trabalho deve continuar. Encerrar o app interrompe; ao reabrir deve apresentar recuperação, sem reenviar automaticamente. |
| AUTO-05 | Permissões e aprovações — parcial | Permissões por categoria e aprovação exata de chamadas Codex MCP; aprovação de roteiro separada de publicação. | Restrinja publicação nas permissões de um agente. Peça uma ação de publicação: ela deve ser bloqueada. Uma chamada permitida deve apresentar a ação e seus argumentos para aprovação. Não autorize uma postagem só para testar o bloqueio. |
| AUTO-06 | Roteiro aprovado → Notion — parcial | Cria/atualiza um card da base configurada, confere o resultado e guarda versão/recibo, preservando notas e histórico. | Com uma base de teste configurada, aprove um roteiro e autorize a sincronização. Confira um único card com a versão aprovada. Reconsultar/recuperar não deve criar duplicatas. A sincronização real da sua base ainda precisa de validação dedicada. |
| AUTO-07 | Home/Inbox — pronto para chats locais | Pendências, respostas não vistas, falhas, autorizações e acesso à conversa; avisos com silenciamento persistente. | Receba uma resposta enquanto está em outra tela. Abra a pendência na Home: deve levar à sessão certa e marcar o evento como visto. |
| AUTO-08 | Entregas no chat — parcial | Cartões de pesquisa, roteiro e arquivos verificáveis, com origem, versão, salvar, revisar e pedir ajustes. | Gere opções de roteiro compatíveis com o fluxo editorial, salve a entrega e peça um ajuste. A versão anterior deve continuar acessível. Prosa livre não vira um cartão estruturado por conta própria. |
| AUTO-09 | Rascunhos — pronto para chats | Texto não enviado, skill e contexto do Canvas separados por perfil/agente/sessão. | Digite sem enviar, troque de agente e reinicie. O rascunho deve voltar à sessão original. Enviar limpa somente aquele rascunho. |
| AUTO-10 | Biblioteca de arquivos — pronta | Seleção/arrastar arquivos, função original/referência/resultado, hash, origem e versões; sinaliza arquivos alterados ou ausentes. | Associe um arquivo de exemplo ao conteúdo. Altere ou mova esse arquivo e use a verificação disponível. O vínculo deve ser sinalizado, sem declarar o arquivo antigo pronto. Remover o vínculo não apaga o arquivo do PC. |
| AUTO-11 | Trabalho entre agentes — parcial | Envio manual durável, briefing/contexto/arquivos, continuidade ou nova sessão e retorno à origem; delegação automática Codex → Codex. | Use dois agentes de teste. Peça ao segundo responder uma frase específica. Confira que recebe o pedido, usa a sessão escolhida e retorna à origem. Envie outro pedido para verificar continuidade. |
| AUTO-12 | Diagnóstico de conexões — parcial | Conta/modelos/catálogo, requisitos declarados de skills, verificação de arquivos e dependências, diagnóstico Claude e teste específico de leitura Zernio. | Abra o diagnóstico do agente/provedor. Confira que distingue ferramenta descoberta, dependência ausente e leitura efetivamente confirmada. Uma skill mencionar Notion não significa que a conexão está autorizada. |
| AUTO-13 | Corte/exportação de vídeo — parcial e novas melhorias adiadas | Operação manual delimitada com FFmpeg/ffprobe, saída nova, progresso, cancelamento e verificação. | Pode pular este teste por enquanto. Sem FFmpeg instalado deve informar indisponibilidade. Com ele, um corte de vídeo de exemplo deve gerar outro arquivo, preservando o original. Não existe editor completo ou edição automática pelo especialista. |
| AUTO-14 | Entregas por rede e calendário — pronto no recorte atual | Texto/mídia e aprovação independentes por rede, histórico, planejamento com fuso; consulta dos provedores com cache local. | No mesmo conteúdo, crie duas entregas com horários diferentes. Devem manter estados independentes. No calendário selecione Zernio, escolha contas e atualize. Um horário local planejado não pode aparecer como confirmação externa. |
| AUTO-15 | Publicação integrada — parcial | LinkedIn com texto via Publora: conta, prévia, autorização, rascunho/agendamento, ID, consulta e cancelamento autorizado. Consulta de posts Publora/Zernio no calendário. | Aprove uma entrega LinkedIn sem mídia, selecione a conta e o destino **Rascunho no Publora**. Confira a prévia e só então autorize. Verifique o rascunho no provedor e consulte o resultado no app. A consulta não deve recriar o post. Instagram/TikTok ainda não têm esse envio nativo completo. |
| AUTO-21 | Distribuição Windows — entregue | MIT, documentação, contribuição, privacidade/segurança, build Windows, CI e instalador com verificação de integridade. | Confira versão 0.3.42 nas configurações, links de documentação e persistência ao reabrir. Prévia pública Windows disponível; assinatura digital opcional não configurada. Commit/push não equivalem a publicar um instalador em GitHub Releases. |

## Novidades validadas nesta rodada

- [ ] Editar/reagendar uma entrega LinkedIn confirmada usando **Conferir alteração** e **Autorizar alteração no Publora**; o ID externo deve permanecer igual e a versão aumentar.
- [ ] Habilitar atualização automática do calendário, reiniciar e conferir a preferência/intervalo.
- [ ] Digitar uma pauta, revisão de roteiro, briefing ou alteração de publicação; navegar/reiniciar e conferir o rascunho sem envio ao provedor.
- [ ] Em falha de envio/edição, usar consulta de resultado e conferir que não foi criado outro post.

A 0.3.42 foi validada localmente e na [CI Windows](https://github.com/devpedrohbs/MainsAgents/actions/runs/37351382504), com [prévia pública disponível](https://github.com/devpedrohbs/MainsAgents/releases/tag/v0.3.42). A instalação pessoal ainda aguarda o app ser fechado. Testes de escrita usados no desenvolvimento são simulados.

## O que ainda falta em recursos iniciados

- **AUTO-02:** equivalência do backup web com o histórico de trabalhos do serviço Node. O JSON guarda vínculos, não copia todos os arquivos externos nem exporta a chave API. O cache derivado do calendário é consultado novamente após importar em outra instalação.
- **AUTO-03/08:** novos tipos de entrega estruturada e ligações editoriais para formatos que ainda são prosa livre; não converter qualquer mensagem/nota em conteúdo aprovado automaticamente.
- **AUTO-04/05/11/12:** ampliar execução, reconciliação, permissões e provas de capacidade equivalentes para outros runtimes. A delegação automática continua Codex → Codex. O envio manual atende Codex/Claude, com limites de ferramentas. Claude não ganhou MCP/escrita externa por esse fluxo.
- **AUTO-06:** ampliar sincronização de outros tipos de entrega e comprovar o caminho real aprovado até o Notion, incluindo recuperação sem duplicação. Não há sincronização bidirecional completa de toda a base.
- **AUTO-09:** fechado no recorte de rascunhos editoriais: pauta, pesquisa/decisão, roteiro, revisões, briefing, entregas/alterações e parâmetros de corte, além dos chats. Credenciais e autorizações não são rascunhos.
- **AUTO-10:** observação automática de pastas, opcional. O recurso atual verifica os arquivos por ações do fluxo.
- **AUTO-13:** edição avançada, legendas, montagem e execução automática pelo Editor de Vídeo. Adiados por decisão do usuário. O especialista permanece sem controle do computador.
- **AUTO-14/15:** envio de mídia, rascunho/agendamento Zernio e opções básicas de rede implementados nesta rodada; edição/reagendamento, cancelamento e recuperação mantêm o ID. Webhooks, substituição de mídia de um post externo e opções avançadas das plataformas são extensões ainda não implementadas. A chave cadastrada serve ao calendário e às entregas que você autorizar separadamente.
- **AUTO-15:** teste real ponta a ponta, com aprovação explícita e conta/destino escolhidos. Os testes de criação/agendamento/cancelamento feitos no desenvolvimento usam provedores simulados.
- **AUTO-21:** prévia pública Windows e validação de instalação limpa entregues. Assinatura opcional exige certificado; distribuição para macOS/Linux é uma extensão futura.

## Recursos pendentes

| ID | Recurso | Como ajudará | O que falta construir |
|---|---|---|---|
| AUTO-16 | Rotinas e bandeja | Pesquisar ou preparar trabalho em horários definidos sem você enviar cada pedido. | Horário/fuso, executar agora, ativar/pausar, histórico, tratamento de horários perdidos e opção de manter o app na bandeja. |
| AUTO-17 | Memória editorial | Reaproveitar seu tom, exemplos aprovados e correções nas próximas produções. | Biblioteca pesquisável, contexto pertinente com fonte, separação por workspace e aceite das correções. Histórico de chat e skills já existem, mas não substituem essa memória. |
| AUTO-18 | Projetos e modelos reutilizáveis | Criar um fluxo com especialistas e materiais sem montar tudo novamente. | Modelos opcionais de projeto e distinção entre setas de contexto, dependência e próxima etapa. Canvas e conexões atuais não são um executor completo de workflows. |
| AUTO-19 | Radar e aprendizado | Reunir novidades, sugerir pautas e derivados e aprender com métricas disponíveis. | Fontes autorizadas, deduplicação, rotinas, plano semanal, métricas reais e limites de volume/consumo. |
| AUTO-20 | Desempenho medido | Manter o app confortável com muitos objetos, mensagens e imagens. | Benchmark reproduzível de Canvas/histórico/streaming e otimização dos gargalos demonstrados. |

## Ordem de testes recomendada

- [ ] 1. Persistência: criar registros, fechar e abrir pelos dois atalhos.
- [ ] 2. Rascunho: reiniciar sem enviar uma mensagem.
- [ ] 3. Fluxo editorial: pauta → pesquisa → roteiro → ajuste → aprovação.
- [ ] 4. Arquivos: associar, verificar e confirmar que alterações invalidam a prontidão.
- [ ] 5. Dois agentes: enviar, receber resultado e continuar a mesma sessão.
- [ ] 6. Home/Inbox: localizar e abrir uma entrega não vista.
- [ ] 7. Permissões: conferir bloqueio e aprovação exata de MCP.
- [ ] 8. Calendário: duas redes, fuso e consulta Zernio/Pub­lora; reinício mantém o snapshot.
- [ ] 9. Notion: card em base de teste, com destino/versão conferidos.
- [ ] 10. Publora: primeiro rascunho; agendamento/cancelamento somente quando desejar testar uma ação real.
- [ ] 11. Backup: exportar e conferir a prévia.

Para relatar um problema, informe o ID da tarefa, tela, passos, resultado esperado e o que aconteceu. Exemplo: “AUTO-09: digitei no chat do Linkedin Agent, fechei pelo X e, ao abrir pelo menu Windows, o rascunho estava vazio”. Não inclua chaves API ou tokens.

## Testes específicos da 0.3.42

- [ ] Associe uma imagem de teste, aprove uma entrega Instagram e selecione sua conta Zernio. Confira a prévia antes de autorizar um rascunho; nenhum post deve ser publicado.
- [ ] Confira no provedor o texto e a imagem. Edite a legenda pela ação de edição e verifique que o ID não mudou.
- [ ] Para TikTok, consulte as opções da conta e revise privacidade, divulgação e ambos os consentimentos antes da aprovação.
- [ ] Teste LinkedIn com mídia pelo Publora, começando pelo destino Rascunho.
- [ ] Se um upload falhar, reabra a entrega e utilize a retomada explícita como rascunho. Uma criação incerta deve ser consultada, nunca reenviada cegamente.

[Contratos, limites e recuperação](publication-media-and-zernio-increment.md).
