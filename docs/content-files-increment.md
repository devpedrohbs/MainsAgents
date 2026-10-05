# Biblioteca de arquivos por conteúdo — 0.3.33

Entrega de AUTO-10, em 04/10/2026. A biblioteca fica no **Estúdio de conteúdo**, dentro da pauta aprovada. Usa a identidade existente de conteúdo e workspace; não cria um histórico separado nem redefine agentes.

## Como testar

1. Abra ou aprove uma pauta no Estúdio. Em **Arquivos do conteúdo**, escolha Original, Referência ou Resultado.
2. Use **Adicionar arquivos** ou arraste arquivos locais do Explorador de Arquivos para a biblioteca. Aceita vídeos, imagens, áudios e documentos; até 20 arquivos por operação.
3. Feche e reabra o aplicativo. Os vínculos, nomes, funções, origem e versões permanecem no SQLite permanente.
4. Use **Verificar arquivos** para conferir disponibilidade e identidade. Ao reabrir, um arquivo anteriormente verificado aparece como “A verificar” até uma nova conferência nesta tela.
5. Se mover um arquivo, use **Localizar**. A religação exige o mesmo SHA-256 da versão corrente. Se o conteúdo do arquivo mudou, use **Nova versão**; a versão anterior permanece no histórico.
6. Ao marcar um arquivo como Resultado, selecione seu arquivo de origem na mesma pauta. Referências de outra pauta ou ciclos de origem são recusados.
7. **Mostrar na pasta** verifica novamente o arquivo antes de mostrá-lo no Explorador. **Desassociar** pede confirmação e remove somente os metadados: não apaga o arquivo do PC.

## Persistência e backup

- Metadados opcionais `EditorialState.assets` preservam compatibilidade com snapshots anteriores sem biblioteca. `EditorialContent.assetIds` relaciona os arquivos à pauta.
- Versões registram caminho, nome, tamanho, SHA-256, modificação e criação. Metadados incluem função, tipo, origem, versão corrente e último resultado da verificação.
- Usam o escritor editorial existente, com revisão otimista, fila ordenada, indicador de salvamento e barreira de fechamento. Falha ao salvar continua pendente para recuperação; não substituir o banco por dados vazios.
- Exportação inclui os metadados e caminhos de todas as versões na prévia de referências locais. O JSON **não inclui os vídeos/documentos externos**. Eles devem ser guardados separadamente.
- Restauração valida identidade, versões, propriedade do workspace e relações de origem. Os arquivos restaurados voltam a “A verificar”. Merge conserva registros locais em conflito e inclui arquivos distintos.

## Execução e limites

O Electron lê arquivos por uma API restrita à janela principal e ao perfil/conteúdo vigente, conferidos antes e depois da operação assíncrona. A leitura usa memória limitada e SHA-256; operações são serializadas. Recusa caminhos de rede/dispositivo, URLs e tipos executáveis. Nenhuma seleção copia, executa, envia ou publica arquivos.

A verificação compara tamanho, datas e identidade antes/depois da leitura e durante uma espera curta; alterações detectadas aparecem como “Em alteração”. Isso detecta atividade durante a conferência, mas não prova que uma transferência externa temporariamente parada terminou. Associar arquivos nunca inicia edição. Uma execução futura deverá revalidar o arquivo quando começar.

Na versão web, os metadados podem ser vistos, mas seleção/verificação/religação local exigem o desktop. Não há observador automático de pastas neste incremento; é uma opção futura. Não há prévia de vídeo, upload ou integração com o Editor de Vídeo nesta entrega. AUTO-11 continua pendente para conectar a delegação existente ao executor durável.

## Validação

- 102 testes automatizados: inclui leitura real, arquivo em alteração/ausente, duplicação, renomeação, novas versões, resposta atrasada, isolamento, ciclos, restauração e permissões IPC.
- Compilação TypeScript/Vite aprovada.
- Teste Electron isolado da biblioteca: seleção, **drag and drop com arquivo nativo real**, duplicata, arquivo ausente, religação recusada/correta, nova versão, reinício, conferência e remoção do vínculo mantendo o arquivo.
- Capturas e verificação de layout claro e escuro com janela compacta.
- Regressões Electron do fluxo editorial/Notion, rascunhos/Home e persistência desktop aprovadas.
- Nenhum teste consumiu inferência, criou cards na base pessoal ou alterou agentes reais.
