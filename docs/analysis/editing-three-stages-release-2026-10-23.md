# Release local 0.3.74 — cortes, visual e SRT do CapCut

Instalada em 23/10/2026 em `C:/Users/pacas/AppData/Local/Programs/MainsAgents/MainsAgents.exe`. FileVersion `0.3.74`, ProductVersion `0.3.74.0`. Instalador local, sem publicação de release.

## Comportamento entregue

Novas edições começam com múltiplos cortes e áudio, sem motion. O criador revisa, fornece instruções e inicia o visual na produção ou com um pedido explícito no mesmo chat. O host recusa mudanças nos segmentos, ordem, formato e tratamento da voz durante o acabamento; o executor copia o áudio do corte escolhido. Cancelar um visual em andamento retorna ao corte base.

O botão de concluir o visual apresenta o editor SRT separado para o CapCut, limitado à versão final escolhida. A importação registra essa referência sem alegar alinhamento por palavra. Produções antigas continuam no contrato anterior; o botão de recomeçar aplica o fluxo novo por decisão explícita.

Guia de uso, decisões e limites: [edição em três etapas](../video-editing-three-stages.md).

## Validação

- Suíte completa com concorrência limitada: **814/814 aprovados**, em `.mainsagents-workspaces/staged-edit-tests-verified.txt`. Uma execução anterior com concorrência padrão estourou a espera de um render Remotion; o mesmo teste passou isolado e depois na suíte completa. Fixtures dos contratos antigos mantêm esse comportamento explicitamente, por injeção da fábrica de registros; as novas etapas têm testes próprios com o padrão real do app.
- Ajustes finais na classificação do pedido visual e no prompt do diretor sem ferramentas: **25/25 testes focados aprovados**, incluindo o novo caso do fallback de cortes. Nenhuma pergunta, referência citada ou intenção futura dos exemplos testados iniciou motion.
- Build completo aprovado: TypeScript, Vite, preview, Remotion e Whisper. Aviso existente de chunk grande. Verificação de módulos: **106, nenhum ausente**.
- Electron isolado: jornada pelos três passos, importação do SRT associado ao vídeo, reinício sem novos turnos, temas claro/escuro e janela de 420 px. Últimas capturas e recibo: `.mainsagents-workspaces/edit-stages-ui/1792779108512/`.
- FFmpeg real nos testes de cortes, exportação, áudio, cancelamento e retomada. Decisões dos provedores roteirizadas; o renderizador visual da jornada Electron é simulado. Não houve edição/inferência com vídeo pessoal. Os testes Remotion existentes também passaram na suíte completa.

## Pacote e instalação

- Artefatos finais: `release/r74-current/`. Tentativas anteriores de empacotamento foram preservadas; uma pasta de saída anterior apresentou bloqueio de arquivo, então a versão final foi gerada em outra pasta.
- `check-desktop-release` aprovado. **226 arquivos** do runtime e de `dist` comparados ao pacote final, sem divergências (`source-verification.json`).
- Instalador: `MainsAgents-Setup-0.3.74.exe`, SHA-256 `9916df66222a8157d316402b5bc238dea6f8641ec66afdb57adbed3ec68df8ad`.
- `app.asar` final e instalado idênticos: SHA-256 `6aafc4f281ce0d4a7083e7232aadd907e23e47d576e06c0b4f86c6ba13369209`.
- Antes de instalar: app fechado, nenhum job ativo e nenhum turno aberto. Backup online novo em `.mainsagents-workspaces/local-update-0.3.74/backup/`: nove bancos com integridade confirmada, arquivos locais e skills copiados pelo helper existente.
- NSIS silencioso por usuário, retorno **0**. Comparação dos snapshots imediatamente antes/depois: **IDENTICAL**; bancos íntegros. O app permaneceu fechado e ocioso, sem retomar produções pessoais.

## Limites

J/L-cuts com cortes independentes de áudio e vídeo continuam indisponíveis. SFX novos são recusados no acabamento que preserva o áudio aprovado. Hard/jump cuts, cutaways e match cuts são orientações condicionadas à fala e aos materiais disponíveis, sem obrigação de usar todas em cada vídeo. O acabamento e a exportação final das legendas no projeto CapCut continuam a cargo do criador.
