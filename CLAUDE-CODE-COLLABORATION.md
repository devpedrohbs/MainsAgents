# Contexto de colaboração

O usuário trabalha com Claude Code e Codex juntos dentro do Orca, neste mesmo projeto.

- Diretório: `C:\Users\pacas\Documents\ChatGPT\MainsAgents`.
- **Preferência persistente do usuário (reforçada em 10/10/2026): Codex é apenas orquestrador; TODO o desenvolvimento é feito pelo Claude Code.** Isso inclui código, testes, scripts, `package.json`/lockfile, empacotamento e instalação local. Codex coordena, divide ownership e revisa resultados; não edita arquivos de implementação.
- Em rodadas com vários workers Claude Code, cada um recebe ownership explícita de arquivos. Não edite arquivos de outro worker; combine contratos pela orquestração do Orca antes de integrar.
- Leia as instruções aplicáveis do projeto antes de trabalhar.
- Não reverta mudanças existentes do usuário ou de outro agente.
- Commit, push, tag ou release pública só com autorização explícita da rodada.
- Use português para conversar com o usuário.

Os handles de terminal do Orca são efêmeros e não são autoridade: após reiniciar o Orca, consulte `orca terminal list --json` ou o preâmbulo do despacho atual.
