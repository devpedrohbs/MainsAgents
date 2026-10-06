# Produção semiautomática compartilhada — 0.3.45

Chat e Fluxo usam o mesmo coordenador Node/SQLite. O modelo do Fluxo mantém suas caixas agrupadas; cada ideia aprovada cria uma produção separada com conteúdo, sessões, arquivos, decisões, etapas e recibos próprios. A execução não depende do componente React continuar montado.

## Percurso implementado

1. O usuário pede ideias na conversa e salva a proposta estruturada usando “Usar ideias desta conversa”, ou escolhe uma pesquisa existente no Estúdio.
2. Em “Ver produção” no chat ou “Iniciar produção” no Fluxo, seleciona a ideia e o fluxo. A aprovação informa que será gerado um roteiro e criado/atualizado um card na base Notion exibida. O destino precisa estar configurado e habilitado.
3. O agente de conteúdo gera o roteiro estruturado; o aplicativo registra um rascunho de roteiro no Notion pelo serviço nativo, mantendo identidade e checkpoints para evitar duplicação. Isso não declara que o usuário aprovou a qualidade do roteiro gerado. O card fica disponível para revisão/edição e gravação.
4. Ao associar a gravação ao conteúdo e confirmar edição básica, o coordenador consulta o card atual do Notion, verifica arquivo/versão e solicita ao Editor de Vídeo um plano JSON. O agente utiliza suas instruções e skills; não recebe controle do computador nem executa comandos arbitrários.
5. O executor FFmpeg aplica intervalo de corte, normalização de áudio, fades limitados e, quando autorizado, enquadramento vertical. Cria e verifica um arquivo novo, preservando o original. O processo aguarda revisão humana.
6. Depois de aprovar o vídeo e escolher Instagram, TikTok e/ou LinkedIn, o agente configurado para publicação prepara legendas e prompts de capa. A ferramenta nativa de imagem do Codex deve devolver imagens reais. O aplicativo prepara JPEGs de capa e as vincula às entregas por rede, separadas da mídia principal.
7. O usuário revisa/edita o pacote e aprova a versão. A produção então solicita horário, fuso, provedor e conta por rede. Aceita expressões delimitadas como “amanhã às 18h”, “hoje às 20:30” e datas completas, com confirmação da data absoluta. Horário sem data ou já passado é recusado.
8. “Conferir agendamento” é somente preparação/consulta. “Autorizar agendamentos” libera o envio exato das versões aprovadas. Cada provedor é consultado depois para confirmar o resultado; erros não recriam posts cegamente. Os recibos aparecem nas entregas e no calendário.

As aprovações também podem ser iniciadas pelo composer: “aprovo esta ideia”, “aprovo este vídeo”, “aprovo o pacote” e “agende amanhã às 18h” abrem os controles da produção correspondente. Texto de IA não equivale a aprovação técnica. Mensagens finais e contexto da produção são espelhados na conversa, preservando histórico, título e modelo escolhidos pelo usuário.

## Dependências e limites

- A execução persistente deste incremento usa agentes Codex nas caixas de conteúdo, edição e publicação. Os chats Claude existentes continuam disponíveis; esse coordenador não promete equivalência de recuperação entre runtimes.
- Notion usa o MCP autenticado do Codex. A base precisa corresponder ao mapeamento existente: Post Title, Status, Channel e tipos/estágios esperados. Campos e notas editados manualmente são preservados. O card é consultado antes do plano de vídeo e novamente antes do pacote.
- FFmpeg/ffprobe precisam estar disponíveis no computador. Não é um editor de montagem complexa, legendagem ou efeitos avançados.
- A geração de capa utiliza somente a ferramenta nativa OpenAI do Codex. Se a conta/CLI não a disponibilizar, a etapa explica o bloqueio e não inventa imagem nem utiliza API paga adicional. Não afirma um modelo específico sem confirmação da ferramenta. [Documentação oficial de geração de imagens](https://developers.openai.com/api/docs/guides/image-generation).
- Zernio envia capas: Instagram via instagramThumbnail, TikTok via video_cover_image_url e LinkedIn via thumbnail na mídia. A capa é enviada separadamente do vídeo; não vira uma segunda mídia de um post de vídeo. [Instagram](https://docs.zernio.com/platforms/instagram), [TikTok](https://docs.zernio.com/platforms/tiktok), [Uploads](https://docs.zernio.com/guides/media-uploads).
- Em algumas conexões TikTok, o Zernio incorpora a capa como frame inicial. A confirmação mostra esse comportamento. As opções de privacidade e os dois consentimentos TikTok devem ser escolhidos explicitamente.
- O conector atual Publora é LinkedIn e não implementa capa customizada de vídeo. Um pacote com capa exige Zernio; o aplicativo não descarta a capa silenciosamente. Publicações Publora anteriores continuam com seus controles existentes.
- Fechar o app pausa as etapas em andamento. Retomar confere o turno salvo e os arquivos; reenvio de instrução incerta exige decisão explícita. Configuração de agente ou versão de material alterada bloqueia a continuidade até revisão. Um backup restaura histórico, sem conceder autorização para executar trabalhos ou enviar posts.
- As caixas continuam editáveis como organização visual; o coordenador executa este percurso conhecido, não um editor genérico de qualquer DAG nem todas as possíveis rotinas/integrações do backlog.

## Validação

Testes usam SQLite, FFmpeg e arquivos/imagens reais de fixture com CLI e provedores simulados. Verificam edição sem alterar o original, capas reais normalizadas, leitura atual do Notion, espera pelas aprovações, upload de vídeo e capa separadamente, agendamentos por rede, reabertura sem duplicação, recuperação de turno concluído sem nova inferência, histórico importado sem autorização e espelhamento de sessões sem sobrescrever mensagens/modelos do usuário. O teste Electron atravessa o mesmo processo começando no Fluxo e aprovando o pacote pelo chat.

Não foram criados cards, imagens com tokens pessoais ou publicações nas contas do usuário durante os testes. A verificação de contratos simulados não substitui um teste real autorizado na sua conta.

### Instalação desktop validada

Em 5 de outubro de 2026 (America/Sao_Paulo), a versão 0.3.45 foi instalada no diretório canônico do aplicativo. Os atalhos do desktop e do menu Windows foram conferidos. Um backup SQLite consistente, com imagens e arquivos de skills, foi criado antes da instalação em `C:\Users\pacas\Documents\MainsAgentsBackups\before-update-0.3.45-1791252411937`.

- 224 testes unitários passaram, além dos testes Electron de produção semiautomática, fluxos, publicações e conclusão de tarefas.
- O teste de persistência nativa executado com o `app.asar` final passou (`PACKAGED_NATIVE_PERSISTENCE_UI_OK`).
- Os hashes do estado principal e editorial permaneceram idênticos após a instalação: três agentes (Editor de Conteúdo, Editor de Vídeo e Linkedin Agent), com 16, 3 e 12 skills respectivamente, e oito sessões preservados.
- O pacote final verifica 53 módulos nativos. SHA256 do instalador: `86a508ca98c5527aa614c5c9b782d47d5eda24aaa305e33d176effc9deab4d95`. SHA256 do `app.asar` instalado: `43e4d409cb6feb6ad4772c66af19d5d3551a48b6ed78b5252783443f42c83862`.

O instalador ainda não possui assinatura Authenticode. Esta validação é local; não representa publicação da versão 0.3.45 no GitHub nem execução bem-sucedida nas contas pessoais dos provedores.
