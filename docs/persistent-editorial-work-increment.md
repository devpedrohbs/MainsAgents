# Execução editorial persistente — 0.3.34

## Como usar

1. Conecte o Codex CLI em Configurações e use um agente Codex com Web Search para pesquisar no Estúdio de conteúdo.
2. Pesquisa e opções de roteiro entram na fila local. Você pode navegar para outras telas; a execução pertence ao serviço desktop, não ao componente React.
3. Abra **Acompanhar** em **Trabalhos e especialistas** para ler a instrução, resposta em andamento, atividades e identificadores salvos.
4. Depois de aprovar o roteiro, abra **Enviar ao especialista**. Escolha um agente de origem com Subagents habilitado e outro agente Codex no mesmo workspace. Escreva o briefing e selecione até 20 arquivos da biblioteca da pauta. O destinatário precisa de Files para receber essas referências.
5. O envio guarda a versão aprovada, briefing, instruções/skills do especialista e versões/hashes dos arquivos. Referências locais não são uploads. A sessão do mesmo conteúdo/especialista continua por padrão; **Abrir uma nova sessão** cria outra.
6. **Cancelar trabalho** guarda sua decisão antes de interromper a CLI. Resultado tardio não se transforma em sucesso. Uma interrupção não promete desfazer operações já executadas.
7. Ao reabrir depois de uma interrupção, use **Verificar e retomar**. A leitura do turno salvo pode recuperar uma resposta concluída sem nova inferência. Se não existir resposta concluída, **Reenviar instrução** pede confirmação de outra tentativa, que pode consumir seu plano. Até três tentativas por trabalho; as anteriores ficam preservadas.

O app precisa estar em execução para processar a fila. Fechá-lo não mantém um daemon trabalhando: guarda a interrupção e permite recuperação explícita na próxima abertura. Trabalhos novos que ainda não foram enviados podem permanecer na fila aguardando conexão. Importar um backup nunca reenvia instruções automaticamente.

## Implementação

- `editorial-workflow-queue.mjs`: SQLite com entrada imutável, trabalhos, sessões de fluxo, eventos, concessão temporária de um único executor e checkpoints. Criação do trabalho e mudança editorial são atômicas. A leitura/commit sempre confere perfil, workspace, configuração do agente, versão aprovada e arquivos.
- `codex-workflow-runtime.mjs`: adaptador host-only do Codex App Server, independente do React. Novas threads usam histórico `legacy` explícito; leitura de uma thread ainda sem primeira mensagem consulta metadados, sem tratar histórico ausente de uma sessão antiga como conversa vazia.
- `codex-bridge.mjs`: transporte existente, autenticação local, bloqueio de escritor por thread e notificações oficiais de streaming. A reconciliação lê a thread e procura o ID real do turno ou o marcador único da tentativa quando o recibo do envio se perdeu.
- `EditorialStateClient`: atualiza resultados do serviço e combina edições em campos diferentes. Conflitos no mesmo campo ficam pendentes com erro; uma consulta atrasada não substitui dados salvos depois que começou.
- `workflow-execution-backup.mjs`: snapshot de trabalhos, sessões e eventos junto aos registros editoriais. Restauração transacional transforma trabalho importado ativo em interrompido. Caminhos externos entram no manifesto; vídeos e histórico interno da CLI não são embutidos no JSON.
- `EditorialWorkPanel`: acompanhamento em duas colunas e formulário manual de transferência; modal com rolamento e layout empilhado em telas compactas. Não são duas instâncias de chats interativos comuns.

## Limites deste incremento

Esta fila atende **agentes Codex**. Chats Claude/Gemini continuam disponíveis, mas não usam este executor editorial. A delegação dinâmica dos chats/Canvas ainda precisa ser integrada à fila: **AUTO-11 permanece parcial**. A transferência manual do Estúdio já é persistente.

As sessões novas deste fluxo são de leitura e pesquisa, sem MCPs externos, apps, plugins ou delegação aninhada. A configuração é aplicada por sessão e o inventário MCP é conferido antes de enviar; a conta compartilhada não é reconfigurada. Web Search acompanha a ferramenta habilitada no agente. O envio nativo ao Notion continua no adaptador separado autorizado pela aprovação; os chats comuns ainda não possuem uma política universal de aprovação de MCP.

O Editor de Vídeo não ganha controle do computador nem um editor de mídia neste incremento. Pode analisar o material e entregar instruções ou impedimentos. Um resultado com arquivos é conferido no disco e associado à biblioteca; arquivo ausente ou bytes iguais aos da entrada não são aceitos como edição. Existência de arquivo não comprova uma edição feita pela IA; por isso a etapa de produção não avança automaticamente. FFmpeg, revisão audiovisual e publicação são próximos itens.

## Validação

- `npm test`: **121 testes aprovados**, incluindo recuperação após reinício, recibo perdido, turno ativo, consentimento para reenvio, cancelamento tardio, arquivos ausentes/alterados, configuração/provedor/perfil, sessão reutilizada/nova, exclusão mútua, resultados verificáveis, restauração e conflito de salvamento.
- `scripts/test-editorial-work-ui.mjs`: Electron oculto e SQLite temporário; envio manual, contexto aprovado, navegação durante execução, respostas/histórico após reabrir, mesma/nova sessão, painel largo e compacto com resposta longa e rolamento.
- `scripts/test-workflow-cli-contract.mjs`: CLI instalada, home temporário sem credenciais nem inferência; conferiu configuração, bloqueio de MCP e criação/leitura da sessão. Esse teste revelou e corrigiu incompatibilidades de chaves de configuração e materialização do histórico.
- `tests/editorial-work-bridge.test.mjs`: transporte completo com processo de CLI simulado, turn ID e notificações oficiais. Testes determinísticos não gastam tokens; não foi executado um fluxo editorial real na conta pessoal nesta rodada.
- Regressões Electron: aprovação/Notion, biblioteca de arquivos, Home/rascunhos, salvamento desktop e chat. TypeScript/Vite aprovados; aviso de bundle acima de 500 kB continua registrado para AUTO-20.

Contrato conferido no schema gerado pela CLI instalada e na [documentação oficial do Codex App Server](https://learn.chatgpt.com/docs/app-server). As chamadas de leitura não enviam outra mensagem ao modelo.

## Instalação local verificada

Em 04/10/2026, instalado `MainsAgents-Setup-0.3.34.exe` com o aplicativo fechado, sem encerrar processos. O executável instalado informa 0.3.34 e o ASAR é idêntico ao pacote gerado. O atalho do menu Windows aponta para `%LOCALAPPDATA%\Programs\MainsAgents\MainsAgents.exe`.

Backup anterior à atualização: `C:\Users\pacas\Documents\MainsAgentsBackups\before-editorial-runtime-1791133876375`. Comparação pós-instalação com o snapshot confirmou integridade SQLite e dados inalterados: Editor de Conteúdo (16 skills), Editor de Vídeo (3), Linkedin Agent (12), 8 sessões e 53 mensagens. Nenhum agente foi recriado, removido ou reconfigurado nesta atualização.
