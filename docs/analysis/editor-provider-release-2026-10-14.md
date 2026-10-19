# Release local 0.3.68 — provedor e retomada da edição

Concluída pelo Codex com autorização explícita do usuário depois do limite semanal do Claude Code. Instalação local somente; sem commit, push, tag ou release pública.

## Resultado

- Escolha Codex/Claude por conversa, com histórico e rascunhos preservados e novo chat no mesmo conteúdo quando a conversa já está vinculada.
- Provedor do chat separado do diretor configurado e da execução efetivamente registrada; modelos pedidos não são apresentados como confirmados.
- Diretor/modelo por produção sem alterar o padrão do espaço. Em produção parada, escolha idêntica é no-op; escolha diferente espera Retomar e informa novo planejamento.
- Limite de turnos derivado do orçamento do host; continuação limitada por checkpoint, progresso, época e orçamento. Previews são religados e verificados antes da inspeção pendente e da exportação única.
- Diagnóstico da parada antiga apresentado somente com evidência durável, sem gravar a produção. Retomada confirmada não exige checkbox de reenvio; interrupções incertas mantêm sua autorização específica.

## Validação

- Suíte completa: 705/705; depois do último ajuste de apresentação legada: 58/58 testes afetados e typecheck.
- `PROVIDER_EDITOR_CHOICE_UI_OK` em claro, escuro e janela estreita; `SEMI_PRODUCTION_UI_OK` com renderer/SQLite/FFmpeg/Whisper/Remotion reais e provedores simulados. A exportação contém animação declarada, sem remover o bloqueio de motion do produto.
- Build completo e release Remotion `13a56b63b4a7cac4`; 92 módulos nativos acessíveis, nenhum faltando.
- Pacote em `release/r68-final`: 93 módulos explícitos da raiz, 34 arquivos do renderer e 81 do bundle Remotion idênticos ao código/build final. Sem tocar o pacote antigo travado pelo Orca.
- `PACKAGED_CONTENT_SESSIONS_OK`, `PROVIDER_EDITOR_CHOICE_UI_OK` e `CONTENT_SCOPES_UI_OK` também contra o pacote/renderer empacotado.

## Instalação e preservação

- Instalador: `release/r68-final/MainsAgents-Setup-0.3.68.exe`, SHA-256 `f6a07ef440dd19578172a39fcccffb857278e4e67d58129060fb0dec6f96fd90`.
- App instalado: `C:/Users/pacas/AppData/Local/Programs/MainsAgents/MainsAgents.exe`, FileVersion `0.3.68`, ProductVersion `0.3.68.0`. NSIS `/S /currentuser`, saída 0.
- `app.asar` instalado e validado: SHA-256 `510fe0fecc6fac25a6d33823a9dc4ef8cb50ff5474d6de72bdcaf8a31dfe1b8a`.
- Antes da instalação: nenhum processo do app, job ou turno ativo. Backup online de nove bancos SQLite, todos com integridade `ok`, além dos arquivos locais, imagens, sessões e 42 skills; nenhum arquivo de credenciais lido ou copiado pelo procedimento.
- Backup: `.mainsagents-workspaces/local-update-0.3.68/backup`. Snapshots idênticos antes/depois da instalação e depois da abertura do app, ignorando somente leases transitórios.
- Preservados 4 agentes e 13 chats: 241 itens, sendo 57 mensagens e 184 atividades. Configurações, vínculos por conteúdo, Paper e publicação preservados pelos hashes dos dados.
- Produção `production-8314f2f5-0885-4416-a249-7b4c7f263f68` permanece `blocked`, revisão 63, byte a byte igual ao backup; não foi retomada nem teve o diretor alterado. O original e a instrução de preservar luz/cor permanecem intactos.
- Startup às `2026-10-14T13:29:29Z`: versão 0.3.68, Codex bridge pronto, storage nativo SQLite e janela principal carregada. App deixado aberto em uma instância.
- GET programático sem a origem nativa foi recusado com 403; nenhum acesso alternativo foi tentado. A validação usa os testes empacotados, o startup nativo e a leitura somente leitura do estado preservado.

O vídeo pessoal ainda não foi exportado. O CLI do Claude informou limite semanal até 15/10 às 10h (America/Sao_Paulo); a atualização não consome novas tentativas dessa produção. Continuar com a mesma direção retoma o checkpoint; escolher outro diretor inicia novo planejamento explicitamente.

Recibo: `release/r68-final/MainsAgents-0.3.68-local-install-receipt.json`.
