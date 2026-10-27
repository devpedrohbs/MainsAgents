# Contexto de colaboração

O usuário trabalha com Claude Code e Codex juntos dentro do Orca, neste mesmo projeto.

- Diretório: `C:\Users\pacas\Documents\ChatGPT\MainsAgents`.
- **Preferência persistente atual do usuário (27/10/2026): Claude trabalha no fluxo de design e na facilidade de uso; Codex implementa melhorias de aplicação, sistema e canvas.** Esta divisão substitui a preferência de 10/10/2026 de que somente Claude implementava código.
- **Nesta sessão há um orquestrador separado**, responsável por distribuir os arquivos, evitar conflitos e executar a integração final: o worker Claude cuida de design/usabilidade e o worker Codex de sistema/canvas, dentro do ownership explícito de cada despacho.
- Cada worker recebe ownership explícita de arquivos. Não edite arquivos de outro worker; combine contratos pela orquestração do Orca antes de integrar. Build do renderer e testes de interface ficam com o coordenador enquanto os workers compartilham o checkout.
- Leia as instruções aplicáveis do projeto antes de trabalhar.
- Não reverta mudanças existentes do usuário ou de outro agente.
- Commit, push, tag ou release pública só com autorização explícita da rodada.
- Use português para conversar com o usuário.

Os handles de terminal do Orca são efêmeros e não são autoridade: após reiniciar o Orca, consulte `orca terminal list --json` ou o preâmbulo do despacho atual.
