# Fechamento das pendências locais — 0.3.38

Esta rodada completa partes iniciadas do backlog, preservando a identidade visual. Não inicia o adaptador de publicação, rotinas, memória, templates ou radar.

## Fluxos disponíveis

- **Inbox dos chats:** a Home mostra respostas ainda não vistas, falhas e autorizações pendentes de sessões existentes do workspace. Abrir a conversa marca os eventos como vistos. Avisos começam silenciados; preferências e recibos sobrevivem ao reinício e entram no backup. A primeira atualização não transforma todo o histórico antigo em notificações.
- **Entregas de arquivos:** respostas concluídas podem devolver `{"kind":"files","summary":"...","files":[{"path":"caminho local absoluto","caption":"..."}]}`. O cartão confere a existência e SHA-256 antes de salvar, associa um conteúdo e guarda a versão/origem. Abrir mídia ou mostrar um documento reconfere o arquivo real. Prosa ou caminho de arquivo inexistente não vira uma entrega pronta.
- **Revisão:** `aprovo esses arquivos`, `aprovo esse vídeo`, `rejeito esses arquivos` ou `ajuste arquivos: ...` abrem confirmação local da versão. A aprovação reconfere os bytes. Trocar/remover um vínculo ou detectar alteração retira o conteúdo do estado pronto, mantendo o histórico. Aprovar arquivos não autoriza postar nem enviar ao Notion. A validação de formato/duração de vídeo continua no executor FFmpeg; um hash não certifica um MP4 válido.
- **Identidade editorial:** captura liga a sessão ao conteúdo/pauta; envio ao Canvas prefere a origem do artefato da mensagem. Tarefas, sessão e objeto do Canvas abrem o mesmo conteúdo. Conversas antigas continuam acessíveis.
- **Envio manual entre agentes:** botão “Enviar a outro agente” usa a fila Node/SQLite no desktop, com briefing imutável, contexto, arquivos, instruções e skills do destinatário. Pode continuar a sessão ou abrir outra explicitamente. Perda do recibo não duplica o pedido; o resultado retorna uma vez à conversa de origem. Fechar a janela do chat não interrompe o serviço. Encerrar o aplicativo interrompe e guarda a recuperação; não existe daemon.
- **Especialista Claude:** pode receber trabalho de um agente Codex; o envio manual também pode partir de um agente Claude com Subagents habilitado. Seus identificadores são separados dos threads Codex. Claude usa autenticação normal da CLI, sem `--bare`, com pesquisa/leitura e sem MCP, shell, hooks/plugins de usuário ou controle do computador. Uma execução Claude incerta exige inspeção e confirmação de reenvio: não há consulta de turno equivalente à do Codex implementada aqui. A conexão automática de origem continua sendo Codex.
- **Permissões Codex MCP:** na configuração do agente há consulta, alteração, agendamento, publicação/envio, exclusão/cancelamento e ferramentas não classificadas. Cada chamada permitida ainda pede aprovação dos argumentos exatos. Ferramentas genéricas não classificadas são recusadas quando a política restringe categorias de escrita. A classificação tem contratos reconhecidos e não é uma auditoria semântica universal de código/ferramentas externas. Outros provedores não ganharam escrita MCP implicitamente.
- **Diagnóstico:** mantém descoberta separada de leitura confirmada. Nas configurações, o teste de Zernio consulta exclusivamente `accounts_list`, após autorização explícita, sem iniciar turno de IA. Guarda data e ferramenta do recibo; não cria/publica posts. Outros servidores têm catálogo e auditoria, mas ainda não têm testes nativos específicos de negócio.

## Requisitos opcionais das skills

A menção a “Notion” ou “FFmpeg” não comprova acesso. Para declarar dependências verificáveis, use um bloco dentro do Markdown associado ao agente:

````markdown
```mainsagents-requirements
{"mcp":[{"server":"zernio","tools":["accounts_list"]}],"commands":["ffmpeg","ffprobe"]}
```
````

O diagnóstico verifica ferramentas exatas no catálogo e FFmpeg/ffprobe no executor local. MCP declarado para Claude/Gemini aparece indisponível neste provedor. Autenticação real e permissão de uma conta podem mudar depois da consulta; recibos não prometem acesso futuro.

## Validação

172 testes automatizados; build TypeScript/Vite; testes Electron isolados de arquivos/revisão/Inbox, envio manual entre provedores sem React, duas conversas no Canvas, continuidade de sessões, aprovação MCP, diagnóstico, entregas editoriais, preservação durante atualização e exportação real de vídeo sintético. Nenhum teste usa contas pessoais, publicação real ou inferência paga. O transporte Claude foi testado por processo CLI simulado; disponibilidade de modelos e login real dependem da instalação/conta do usuário.

O instalador verifica a inclusão dos 41 módulos nativos e suas dependências locais. Gera SHA-256 e recibo JSON em `release/`. A instalação local 0.3.38 foi concluída, com comparação integral do estado principal e editorial antes/depois.

## Gates que permanecem

- CI executada e download/release públicos no GitHub: autenticação do mantenedor estava inválida nesta rodada. Workflow e artefatos estão preparados; publicação não foi simulada nem declarada concluída.
- Assinatura Windows: artefato local sem assinatura. Assinatura é opcional e depende de certificado do mantenedor; checksum não substitui uma assinatura.
- MCP com decisões equivalentes em Claude/outros runtimes, testes de negócio específicos para demais servidores e automação de edição pelo especialista exigem incrementos próprios. O modo atual informa/recusa capacidades ausentes.
- AUTO-15–20 seguem fora desta rodada: publicação nativa Zernio/Pub­lora com reconciliação, rotinas locais, memória, modelos de projeto, radar e benchmark.
