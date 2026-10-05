# Publicação com mídia e Zernio — 0.3.42

Este incremento completa o envio nativo de mídia no LinkedIn via Publora e a criação de rascunhos/agendamentos no Zernio para Instagram, TikTok e LinkedIn. Não utiliza um turno do modelo para chamar o provedor. Aprovar um conteúdo, consultar o calendário e autorizar um envio continuam sendo decisões diferentes.

## Como utilizar

1. No Estúdio, associe e verifique os arquivos do conteúdo.
2. Abra **Entregas por rede**, selecione os arquivos, revise o texto e o fuso/horário planejado.
3. No Instagram, escolha Feed/Reel ou Story. No TikTok, consulte as opções da conta, escolha a privacidade, interações e divulgação comercial/IA; confirme que revisou a versão e consente com o envio.
4. Salve, envie para revisão e aprove a versão.
5. Consulte as contas do provedor. LinkedIn permite escolher Publora ou Zernio; Instagram/TikTok usam Zernio. A chave Zernio é cadastrada na conexão API do Calendário, criptografada por perfil no desktop.
6. Escolha **Rascunho** ou **Agendar no horário planejado**, confira a prévia e autorize separadamente. O calendário local sozinho não publica.
7. Um recibo confirmado mostra ID, estado e data da conferência. **Editar ou reagendar** altera o mesmo post, após outra prévia/autorização, preservando a mídia e o histórico. Para trocar a mídia de um post externo já criado, esta interface ainda não oferece substituição: prepare outra entrega somente após resolver o post anterior.

O rascunho Zernio permanece no Zernio; não é o fluxo de Creator Inbox do TikTok. Não existe botão de publicação imediata neste incremento. Agendar autoriza uma publicação real futura.

## Recuperação e integridade

- Intenção de envio e autorização são registradas em SQLite antes de chamar o provedor. Restaurar um JSON não restaura permissão de escrita.
- Cada arquivo utiliza a versão e SHA-256 aprovados. O upload transmite uma cópia temporária privada dos bytes verificados, com memória limitada; a cópia é removida ao terminar. Uma mudança no original bloqueia a finalização do post.
- URLs assinadas de upload e chaves não são gravadas no estado editorial ou mostradas no chat. A chave não acompanha o backup JSON.
- Publora cria primeiro um rascunho, anexa/finaliza a mídia e só depois agenda. O recibo exige arquivos `ready`, identificadores e nomes correspondentes. Upload interrompido recupera somente slots reconhecidos como pertencentes à operação; arquivos externos desconhecidos bloqueiam a retomada para inspeção manual.
- Zernio envia a mídia antes de criar o post. Upload concluído tem checkpoint persistente. Uma criação com resposta perdida nunca é repetida automaticamente, mesmo com a chave de idempotência do provedor.
- **Retomar upload como rascunho** exige nova autorização e pode concluir sem agendar quando o horário original expirou. Essa decisão fica no histórico.
- Com ID conhecido, **Consultar resultado** verifica o mesmo post. Com criação incerta sem ID, localize o post no provedor e forneça o ID: a operação apenas consulta, não cria.
- Texto, conta, arquivos, opções da rede e horário são conferidos na leitura externa. Falha ou divergência não ganha um estado de sucesso.
- Após uma confirmação, o calendário das contas previamente selecionadas é atualizado. Uma falha nessa consulta preserva o cache e o recibo de publicação.

## Limites suportados

- Instagram: até 10 JPEG/PNG (8 MB por imagem) ou MP4/MOV (300 MB por vídeo); Story com um arquivo, vídeo até 100 MB.
- TikTok: até 30 fotos (20 MB cada) ou um vídeo (4 GB), sem misturar tipos. Privacidade e interações são conferidas novamente no creator-info da conta antes do envio. Restrições adicionais de codec, duração, proporção e conta são aplicadas pelo provedor; exporte arquivos compatíveis e confira seu resultado.
- LinkedIn: até nove imagens (25 MB cada) ou um vídeo (150 MB). Os formatos disponíveis nesta etapa são JPEG, PNG, WebP, MP4, MOV e WebM; a rede/provedor pode restringir sua aceitação.
- O upload direto aceita somente destinos HTTPS de armazenamento reconhecidos; redirecionamentos e envio de credenciais ao armazenamento são proibidos. Uma mudança de infraestrutura do provedor pode exigir atualizar essa lista.
- Instagram oferece Story e compartilhamento do Reel no feed; TikTok oferece privacidade, comentários/dueto/costura, consentimento e divulgação comercial/IA. Catálogo musical, localização, colaboradores e capas personalizadas não estão implementados.
- YouTube continua no planejamento local. Webhooks e substituição de mídia externa são extensões futuras.

## Evidência de validação

Os testes usam arquivos locais sintéticos e provedores simulados, exercitando o código nativo de API/MCP, upload por streaming, SQLite e interface Electron. Cobrem upload interrompido, alteração do original durante o PUT, retorno perdido, retomada explícita, restauração sem autorização, divergência de conta/mídia, edição/reagendamento, cancelamento e reinício sem duplicação. Não criaram posts nas contas pessoais.

O diagnóstico de MCP agora reconhece os contratos atuais de contas Zernio e Publora, exige a aprovação exata da leitura, recusa respostas sem dados verificáveis e libera a sessão temporária. Requisitos declarados das skills continuam separados de simples menções no texto.

Validação real de escrita na sua base Notion e nas suas contas sociais ainda depende de você revisar um conteúdo/destino e autorizar a ação no aplicativo. A confirmação anterior do calendário Zernio comprova leitura, não publicação. FFmpeg avançado continua adiado conforme sua decisão; Claude permanece no recorte existente de chat/handoff com leitura, sem equivalência completa de MCP/escrita e reconciliação ao Codex.
