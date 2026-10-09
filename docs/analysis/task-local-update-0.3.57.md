# Atualização local 0.3.57

Executar somente depois da aceitação do QA desktop desta rodada pelo coordenador.

## Resultado

Empacotar e instalar no caminho oficial `C:\Users\pacas\AppData\Local\Programs\MainsAgents`, preservando todo o histórico e alterações locais. O usuário já autorizou atualizar o app e concluir todos os itens da rodada, exceto B04. Nenhuma nova funcionalidade neste despacho.

## Responsabilidade e limites

Claude é o único editor. Pode ajustar versão, release local, scripts de verificação e relatório. Não editar mobile, contratar, publicar release ou conteúdo, chamar IA paga, acessar contas externas, fazer commit/tag/reset, apagar/mover dados originais ou reutilizar IDs de despacho anteriores. Não modificar links públicos para versão não publicada.

## Procedimento e aceitação

1. Ler `docs/analysis/local-update-0.3.56.md` e o relatório final do QA. Preservar os instaladores e recibos anteriores.
2. Atualizar para 0.3.57 sem git tag e executar `npm run desktop:dist`, incluindo build completo de Remotion e staging Whisper, `--publish never`. Não repetir suíte global se a única mudança for versão. Conferir todos os módulos de runtime no pacote.
3. Testar o app.asar final: mídia real FFmpeg/Whisper/Remotion, persistência Electron com perfil isolado e fluxo de capas empacotado. Incluir importação dos novos módulos B03/B05/B07/B09/B10/B11; um smoke real de legendas empacotadas se ainda não existir evidência. Guardar logs resumidos e hashes.
4. Antes de instalar, conferir jobs ativos e fechar graciosamente somente os processos do executável oficial, aguardando salvamento. Se usuário estiver produzindo e fechamento seguro não for possível, perguntar ao coordenador. Fazer backup SQLite por API, incluindo WAL commitado, além de arquivos/perfil, sem credenciais CLI, junctions ou caches. Registrar contagens e SHA canônico por chave sem imprimir conteúdo privado. Nenhum original deve ser apagado ou movido.
5. Validar SHA do instalador e instalar silenciosamente com Start-Process -WindowStyle Hidden -Wait, /S e /D do caminho oficial por último. Conferir exit code, versão 0.3.57.0, hash app.asar instalado igual ao recibo e atalhos.
6. Reabrir, verificar startup/nativeStorage/Main window loaded e ausência de erros críticos. Comparar estado antes/depois, justificando apenas novas preferências ou migrações esperadas. Não executar IA, Notion ou publicação reais.
7. Escrever `docs/analysis/local-update-0.3.57.md` com testes, backup, hashes, preservação e limites. Atualizar checkpoint da rodada para distinguir instalado, validado em fixture e pendente de vídeo real/iPhone. Emitir worker_done uma única vez e encerrar turno.

B06 ainda exige gravação escolhida pelo usuário. Mobile passou verificações Windows, mas Swift e iPhone ainda não foram compilados/testados. Não declarar esses fluxos completos.
