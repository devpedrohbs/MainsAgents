# Editor de Conteúdo + Editor de Vídeo

O Editor de Conteúdo coordena o processo de 18 etapas. O Editor de Vídeo recebe a direção editorial e cuida da edição técnica. O criador mantém as decisões de pauta, roteiro, vídeo base e pacote final.

## Começar

Abra uma **nova sessão** do Editor de Conteúdo depois de atualizar suas instruções. Threads Codex antigas podem continuar usando as instruções da criação. Histórico anterior deve ser preservado, não excluído.

Para planejar a semana:

> Siga o mainsagent-editor-fluxo. Quero preparar a próxima semana. Tenho estes links/ideias: [...]. Identifique o que falta, pesquise e proponha pautas antes de eu aprovar o calendário.

Para um conteúdo específico:

> Vamos trabalhar no conteúdo [ID/título]. Esta é a ideia ou fonte: [...]. Siga o fluxo e avance até a próxima decisão que depende de mim.

Use uma sessão por conteúdo no Editor de Conteúdo, uma sessão de planejamento por semana e uma sessão de edição por conteúdo no Editor de Vídeo. Mantenha o mesmo ID nos dois chats; uma sessão não recebe automaticamente o histórico da outra.

## Passagem de edição

1. Escolha a pauta e aprove uma versão do roteiro.
2. Grave e transfira os brutos para a pasta do conteúdo no PC, ou disponibilize a peça gerada com IA.
3. Ative **Colaboração entre agentes** (Subagents) nas ferramentas do Editor de Conteúdo e use Codex CLI como provedor da sessão que solicita a passagem automática.
4. Peça ao Editor de Conteúdo: **“O roteiro v1 está aprovado. Encaminhe o briefing ao Editor de Vídeo e inicie o trabalho. Estes são os caminhos dos arquivos: [...].”** A ferramenta `mainsagents_delegate` cria uma sessão independente no destino e abre os dois chats lado a lado. Também é possível usar **Enviar a outro agente** nas opções do chat ou numa resposta. O modelo do briefing está em [briefing-edicao.md](briefing-edicao.md).
5. O Editor de Vídeo confere entradas, aprovação e ferramentas. Se não puder processar, devolve o plano e a capacidade faltante. Se puder, entrega corte e arquivos versionados para revisão.
6. Revise a versão do vídeo e peça ajustes específicos, se necessário.
7. O **Retorno da edição** volta automaticamente à chamada do Editor de Conteúdo. Registre sua decisão na conversa para que ele continue com derivados e pacote final. Cada revisão pode abrir uma nova passagem e preserva o histórico anterior.

O briefing referencia os caminhos dos brutos neste computador e inclui o contexto selecionado do Canvas. Cada destino usa seu próprio provedor, modelo, instruções e skills. Fechar a janela conjunta mantém as execuções; **Interromper trabalho** cancela o par. Os chats e briefings ficam salvos e podem ser reabertos por **Ver os dois chats**. Se o app fechar durante a passagem, ela fica marcada como interrompida; não é reenviada automaticamente. As setas do Canvas representam contexto, não disparam execuções.

## Skills associadas

**Editor de Conteúdo:** mantém suas skills editoriais existentes e recebe `mainsagent-editor-fluxo`. A skill de corte técnico passa para o Editor de Vídeo; seu arquivo original permanece na pasta, desabilitado para o agente editorial.

**Editor de Vídeo:** `mainsagent-edicao-video`, `mainsagent-corte-base` e `mainsagent-contexto-editorial`. Não precisa receber radar, calendário, publicação ou scraper para executar edição técnica.

Os dois usam o mesmo contexto editorial inicial. Nesta configuração, são cópias de arquivos, não memória sincronizada. Se mudar uma preferência confirmada, atualize o contexto dos dois. Os arquivos desta pasta são fontes versionáveis; as pastas locais de skills do criador são as usadas pelo app.

A pasta `EditorDeConteudo` contém apenas arquivos `.md` diretamente na raiz. O fluxo de 18 etapas está inteiro em `mainsagent-editor-fluxo.md`; a skill do Instagram está em `instagram-scraper.md`. Pastas auxiliares e metadados anteriores foram preservados fora dela, no diretório de backups do app.

## Limites desta entrega

O envio automático está integrado ao Codex CLI por dynamic tools do app-server; o destino pode usar qualquer provedor configurado. Outros provedores como origem têm o envio manual pela interface, sem tool calling automático nesta versão. Limites: mesmo workspace, sem ciclos, até dois níveis de passagem e quatro chamadas por resposta. A passagem é limitada a 29 minutos e não continua após encerrar o aplicativo. Ela não implementa transcrição/renderização, publicação ou coleta de métricas. O runtime Codex do app continua em leitura: sem executor autorizado, o Editor de Vídeo entrega planejamento técnico, não um vídeo renderizado.

Requer MainsAgents 0.3.21 ou posterior e Codex CLI compatível com dynamic tools. Históricos antigos são preservados; ao habilitar colaboração numa sessão Codex antiga, o app cria uma thread preparada para a ferramenta e leva o histórico salvo como contexto, mantendo o identificador anterior para referência.

## Próximas capacidades do app

- Guardar etapa, arquivos, versões e aprovações de vídeo/pacote em estado estruturado.
- Oferecer transcrição e edição local em uma pasta de saída delimitada, preservando os brutos.
- Mostrar prévia, lista de cortes e revisão antes de exportações finais.
- Integrar agendamento e métricas apenas após as decisões e conexões correspondentes.
