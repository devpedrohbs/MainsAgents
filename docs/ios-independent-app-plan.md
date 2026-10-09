# MainsAgents para iPhone — plano de implementação

Data: 2026-10-06. Estado: proposta de arquitetura; implementação e implantação ainda pendentes.

## Requisitos confirmados

- Uso em iPhone para preparar e gravar conteúdo da loja.
- Nenhuma dependência do computador pessoal ligado.
- Preservar o aplicativo desktop e seus dados locais.

## Arquitetura proposta

Cliente React com Capacitor para iOS, usando modelos e regras de domínio compartilhados com o desktop. A navegação mobile terá implementação própria. A gravação de vídeo precisa de integração iOS específica; não presumir que o plugin Camera de fotos oferece gravação de vídeo.

O iPhone mantém rascunhos e gravações locais. Um backend HTTPS autenticado mantém os projetos remotos, solicita execuções de IA e autoriza transferências de mídia. Vídeos ficam em armazenamento de objetos privado; metadados ficam em banco de dados. Uma fila durável entrega processamento a workers independentes do processo HTTP, incluindo FFmpeg quando necessário.

Fechar o aplicativo não interrompe trabalhos já aceitos pelo servidor. Ao reabrir, o cliente consulta o estado e os resultados. Uploads interrompidos devem poder ser retomados; operações repetidas precisam de chaves de idempotência. O original local só pode ser removido por ação explícita, após confirmação da transferência.

Os bridges atuais de Codex/Claude e o servidor local de contas não serão simplesmente expostos à internet. O mobile exige autenticação remota, autorização por usuário/loja, limites de execução e adaptador de IA no servidor. Provedor, forma de cobrança e implantação permanecem decisões abertas. Credenciais de serviço ficam no servidor.

## Primeira entrega utilizável

1. Perfil da loja: descrição, produtos, público e tom de comunicação.
2. Conteúdos: ideia, briefing, roteiro editável e estado da produção.
3. Gravação: captura de vídeo ou importação da biblioteca, reprodução e associação ao conteúdo. Fazer prova de conceito em iPhone real antes de definir o plugin.
4. Transferência: progresso, repetição segura e recuperação após perda de conexão.
5. Assistente: geração de roteiro e legenda via backend, histórico e limites de uso.
6. Entrega: baixar/compartilhar o resultado pelo sistema iOS.

Teleprompter, cortes automáticos, legendas queimadas e publicação direta entram após validar a captura, transferência e uso real. Canvas e terminal não são requisitos desta primeira entrega.

## Ordem de implementação

1. Separar contratos de plataforma e configuração de API remota, mantendo o desktop funcional.
2. Criar cliente mobile com persistência de rascunhos e backend de desenvolvimento com autenticação.
3. Concluir uma jornada vertical: conteúdo → roteiro → vídeo → upload → resultado compartilhável.
4. Integrar provedor de IA e workers com limite de gasto e recuperação de tarefas.
5. Implantar backend e armazenamento em infraestrutura independente do PC.
6. Compilar e assinar iOS em macOS/Xcode local ou CI; distribuir beta pelo TestFlight.

## Critérios de aceite

- Ela conclui a jornada usando somente o iPhone, com o PC desligado.
- Gravação/rascunho continuam disponíveis sem internet; IA e transferência indicam conexão necessária.
- Interrupção de upload não perde o original nem duplica o conteúdo.
- Trabalho remoto continua após fechar o cliente e aparece ao reabrir.
- Uma conta não acessa projetos ou vídeos de outra conta.
- Nenhuma credencial de serviço aparece no cliente, logs ou exportações.
- Permissões de câmera, microfone e biblioteca são verificadas em aparelho real.
- Resultado pode ser compartilhado pelo iOS; testes não publicam em contas pessoais.
- Testes e build do desktop continuam passando.

## Pré-requisitos e decisões abertas

- Acesso a macOS/Xcode ou CI macOS para build e assinatura.
- Conta Apple Developer para distribuição por TestFlight.
- Hospedagem, banco, armazenamento e orçamento mensal de IA/mídia.
- Tipo de loja, modelo do iPhone e duração típica das gravações.
- Se a primeira entrega exige gravação com teleprompter ou permite câmera do sistema/importação.

## Referências

- https://capacitorjs.com/docs
- https://capacitorjs.com/docs/getting-started/environment-setup
- https://developer.apple.com/testflight/
- https://developer.apple.com/tutorials/develop-in-swift/welcome-to-app-distribution
