# Verificação local da versão 0.3.42

Data: 05/10/2026.

- TypeScript e build de produção aprovados.
- 212 testes automatizados aprovados, sem falhas.
- Electron isolado: publicação/edição Publora e Zernio, mídia aprovada, calendário, rascunhos e reabertura sem duplicação.
- Electron isolado: captura/revisão de arquivos, Inbox e transferência manual Codex → Claude sem depender do renderer.
- Electron isolado: corte/exportação real de vídeo sintético com FFmpeg e revisão dos arquivos reais.
- Pacote desktop: preservação de agentes, sessões, Canvas e vínculos na atualização testada com SQLite e preload de produção.
- Instalador NSIS e fechamento de dependências nativas aprovados: 49 módulos.
- Instalação pessoal atualizada para 0.3.42; o `app.asar` instalado corresponde ao pacote conferido. Os caminhos absolutos gravados nos atalhos do desktop/menu Windows foram verificados.
- Backup consistente antes de instalar, fora do repositório. Comparação exata dos hashes do estado principal e editorial depois da instalação confirmou preservação. Permanecem três agentes, com 16/3/12 skills associadas, e oito sessões no perfil ativo.

SHA-256 do instalador local: `17893e28d84724e34407b23fdd77cadebba21a9e4351f7fc993ec1bf72f2824c`.

SHA-256 do `app.asar` local/instalado: `cbf92ab0eaca527f6ef75d13df64138cded9c530425f1b4de9d10749d55a673a`.

O instalador não possui assinatura Authenticode. Esses hashes identificam este build local; um build independente da CI pode gerar outro hash.

Os testes de envio usam contas e respostas simuladas. Não foram criados posts pessoais, agendamentos reais ou cards na base pessoal Notion nesta rodada. [Uso, limites e recuperação](publication-media-and-zernio-increment.md). [Checklist de testes manuais e pendências](backlog-test-checklist-0.3.42.md).
