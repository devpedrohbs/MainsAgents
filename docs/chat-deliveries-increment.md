# Entregas e aprovação no chat — 0.3.35

## Uso

Peça ao agente uma pesquisa com fontes ou opções de roteiro. Quando ele retornar o formato editorial estruturado suportado, o chat apresenta um cartão legível. Respostas comuns e formatos próprios das skills continuam como texto; a resposta original também permanece acessível no cartão.

- **Salvar entrega** guarda a pesquisa como pautas para revisão no Estúdio. Não aprova as fontes automaticamente.
- Para um roteiro, escolha um conteúdo cuja pauta já esteja aprovada no mesmo workspace. **Salvar nova versão** mantém as opções anteriores no histórico e exige revisão da nova proposta.
- **Revisar e aprovar** abre hook, CTA, caminho narrativo, texto editável, improvisos, thumbnail e observações. O botão de aprovação fica fixo; os campos rolam separadamente.
- **Enviar esta versão ao Notion** é opcional, exige destino habilitado no Estúdio e registra aprovação e trabalho no mesmo serviço já usado pela tela de Conteúdo. Um resultado confirmado vem do recibo da fila, nunca de uma promessa do agente.
- **Trabalho persistente** permite enviar o roteiro aprovado e arquivos da biblioteca a um especialista pela fila salva. Pode acompanhar, cancelar ou verificar a retomada sem sair do chat. A sessão dessa execução é própria do fluxo; não substitui os chats comuns.

## Garantias

A captura consulta agente e sessão no SQLite do desktop, verifica papel da mensagem, texto exato e conclusão da resposta. Conteúdo parcial, cancelado, com erro ou de outro perfil/workspace não é importado. A origem inclui agente, mensagem, sessão e hash, armazenados no artefato editorial e nos backups existentes. Repetir a gravação após perda de recibo não cria outra entrega. Mensagens antigas sem indicação de conclusão continuam legíveis, mas não são importadas automaticamente.

A revisão envia o snapshot exato de opções mostrado ao usuário. O serviço recusa versão, conteúdo ou destino diferentes. Salvar opções novas remove a aprovação vigente do roteiro anterior e bloqueia seu envio pendente, preservando os artefatos e decisões anteriores. Se estava apenas pronto para gravar, o conteúdo volta a planejamento; etapas manuais mais adiantadas são preservadas.

## Limites que continuam no backlog

Este incremento cobre pesquisa e opções de roteiro no desktop. Não converte prosa arbitrária, nem interpreta “aprovo” como autorização. Imagens existentes continuam renderizadas, mas novos cartões editoriais de vídeo/arquivo e decisões de rejeição/ajuste por conversa ainda precisam de implementação. O modo web continua exibindo as mensagens; captura com origem autoritativa exige desktop.

A aprovação nativa ao Notion não é um bloqueio universal de todas as ferramentas MCP de chats comuns (AUTO-05). A transferência manual editorial pode partir do chat, mas a delegação dinâmica que um agente inicia e as ligações do Canvas ainda precisam migrar para a fila (AUTO-11). Não há edição de vídeo nem publicação automática. O Editor de Vídeo continua sem controle do computador.

## Validação

127 testes automatizados e teste Electron isolado de conversa em streaming, bloqueio de resposta parcial, captura de pesquisa e roteiro, edição, aprovação, um único card Notion simulado após cliques repetidos, transferência persistida, reinício, dois temas e composer fixo em 880 px. A inspeção visual encontrou e corrigiu uma ação de aprovação fora do modal. Também se repetem os testes de regressão de Estúdio, trabalhos, arquivos, rascunhos, chat e persistência.

Nenhum teste gera na conta pessoal, escreve no Notion pessoal ou edita seus agentes. Antes de instalar, o banco e as pastas associadas às skills são copiados; a instalação é verificada por versão/hash e comparação dos dados com o backup.

Desktop 0.3.35 instalado em 04/10/2026. ASAR instalado idêntico ao pacote; banco íntegro e estado comparado sem alterações: Editor de Conteúdo (16 skills), Editor de Vídeo (3), Linkedin Agent (12), 8 sessões e 53 mensagens. O menu do Windows aponta para essa instalação. Backup desta rodada: `C:\Users\pacas\Documents\MainsAgentsBackups\before-editorial-runtime-1791137659576`. O Editor de Vídeo permanece sem ferramentas de controle do computador.
