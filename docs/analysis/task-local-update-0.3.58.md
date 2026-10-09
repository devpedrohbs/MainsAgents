# Instalar sessões por conteúdo: 0.3.58

Executar somente depois da aceitação do relatório `content-sessions-report-2026-10-08.md` pelo coordenador. Ler esse relatório e `local-update-0.3.57.md`.

Target: projeto desktop atual e instalação oficial `C:\Users\pacas\AppData\Local\Programs\MainsAgents`. Change: empacotar e instalar a implementação já validada de sessões por conteúdo, mantendo histórico, dados e todas as alterações locais. Ownership: Claude único editor neste despacho, pode ajustar versão, scripts de smoke empacotado e relatório; sem features novas.

Constraints: sem IA/Notion/contas/publicação reais, sem mobile/B04/commit/tag/reset/deploy, sem dependências novas. Nunca apagar ou mover dados originais. Não sobrescrever instaladores/recibos anteriores nem atualizar download público não publicado. Não repetir suíte global após mudança somente de versão.

1. Atualizar versão para0.3.58 sem git tag; executar `npm run desktop:dist` completo, com Remotion/Whisper e --publish never. Conferir novos módulos de runtime e seus imports no build.files.
2. Verificar app.asar final: testes empacotados existentes de mídia, persistência e checkup; smoke específico das sessões/entrada gravada importando helper/módulos do asar final (não fonte). Usar perfis isolados e fixtures, zero serviço externo. Evidência de que os bytes do novo módulo e bundle do renderer estão no pacote final.
3. Checar trabalhos ativos e salvamento. Se o usuário estiver gravando/produzindo e houver trabalho ativo, avisar coordenador; não interromper processamento. Fechar graciosamente somente o executável oficial quando seguro. Backup SQLite por API inclui WAL commitado; copiar arquivos/perfil excluindo credenciais CLI, caches e junctions. Registrar integridade, contagens e hashes canônicos por chave sem conteúdo privado. Nenhum original apagado/movido.
4. Verificar SHA do instalador e instalar silenciosamente via Start-Process -WindowStyle Hidden -Wait, /S e /D oficial por último. Verificar exit0, versão0.3.58 e hash instalado igual ao recibo; atalhos oficiais preservados.
5. Abrir app, conferir startup/nativeStorage/Main window loaded e ausência de erro crítico. Comparar snapshots de estado antes/depois, justificando apenas mudanças esperadas, sem perda de histórico. Não abrir/envia conversas pessoais ou testar autenticação/inferência real.
6. Relatório `docs/analysis/local-update-0.3.58.md` com hashes, backup, checks, preservação e limites. Usuário poderá testar suas gravações/contas após instalação; isso não foi validado por fixtures. Emitir worker_done com IDs do preâmbulo atual e encerrar turno.
