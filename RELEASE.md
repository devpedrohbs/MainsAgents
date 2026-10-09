# Publicação e recuperação do MainsAgents (Windows)

## Estado das versões (07/10/2026)

- **Local:** `package.json` = 0.3.57, instalado nesta máquina em 08/10/2026 (0.3.56 → 0.3.57: check-up B01–B03/B05/B07/B09–B11; estado preservado, instalador `e2e780f6…0e40d`, app.asar `80de0d37…b4e9`; detalhes em [docs/analysis/local-update-0.3.57.md](docs/analysis/local-update-0.3.57.md)). Anterior: 0.3.56, instalado nesta máquina em 07/10/2026 (0.3.55 → 0.3.56: gate de roteiro, Claude por etapa, pacote de gravação, capas locais e biblioteca de referências; estado preservado, instalador `d461084e…b7bc`, app.asar `054b22c0…7000`; detalhes em [docs/analysis/local-update-0.3.56.md](docs/analysis/local-update-0.3.56.md)). Anterior: 0.3.55 ([docs/analysis/local-update-0.3.55.md](docs/analysis/local-update-0.3.55.md)).
- **Pública:** última prévia efetivamente comprovada = [v0.3.42](https://github.com/devpedrohbs/MainsAgents/releases/tag/v0.3.42) (pré-lançamento, 05/10/2026; verificação em [docs/validation-0.3.42.md](docs/validation-0.3.42.md)). O link do README só muda após uma release nova publicada e conferida (hash, instalação, manifesto).
- **Rodada de 07/10/2026:** D02 (verificação antes de iniciar), D03 (execuções/fila), D04, escolha Codex/Claude/Ambos no chat (D13), contraste e prontidão do consentimento foram entregues e validados localmente: `npm test` 298/298, `npm run build` e `tsc` sem erros, mais as fixtures Electron de provider-choice, comparação legada, preflight, execution-overview, flow-execution, semi-production, production-flows, drafts-inbox, refined-workspace e native-persistence. Nenhum instalador novo, instalação ou release foi feito; os hashes abaixo são históricos. Nenhuma autenticação real, chamada de IA, Notion ou publicação pessoal ocorreu. Detalhes em [docs/analysis/task-D12-final-2026-10-07.md](docs/analysis/task-D12-final-2026-10-07.md).

Versão do histórico abaixo: 0.3.40. O instalador NSIS mantém o mesmo `appId`. O estado principal e editorial do desktop ficam no SQLite permanente em `%USERPROFILE%\.mainsagents\storage`, fora da instalação. O perfil Electron em `%APPDATA%\mains-agents` mantém cookies e dados auxiliares; históricos antigos foram migrados sem substituir dados atuais.

## Validação local 0.3.40

Calendário externo Publora/Zernio e alternativa API Zernio com chave criptografada. 192 testes passaram, interface Electron isolada e preservação de agentes/sessões com o app.asar empacotado. Leitura real Publora: duas conexões e zero posts; Zernio MCP retornou resumos insuficientes, por isso a API aguarda chave cadastrada no desktop. Sem publicação pessoal nos testes.

- Instalador SHA-256: `f6d175c7d0287b6d15dc0e8353a2f0a0b4a690af4bd86fd25b1ad6c99dca3832`.
- app.asar SHA-256: `9f110c429e77b20aecb7004ecbf69430fa72c01e315628bcb0e31d6fc077d7ae`.
- 47 módulos nativos verificados no empacotamento.
- Atualização sobre a instalação desktop 0.3.39: executável 0.3.40.0 e hash instalado conferidos; comparação do estado principal/editorial antes/depois sem alterações. Atalhos desktop/menu Windows apontam para a instalação oficial.

## Antes da publicação

1. Atualize a versão em `package.json` e `package-lock.json` e revise o README.
2. Rode `npm ci`, `npm run typecheck`, `npm run build` e `npm run desktop:dist` em Windows.
3. Instale a nova versão sobre a anterior em uma máquina de teste. Confirme versão em **Settings**, histórico, atalhos, importação de backup, sessão Codex e uso offline.
4. Confira `release/MainsAgents-Setup-<versão>.exe` e registre `Get-FileHash -Algorithm SHA256` do instalador antes de divulgar. Anexe o hash ao release.
5. Se houver certificado de assinatura de código, configure a assinatura no processo de build e verifique a assinatura do executável e instalador. Não publique um artefato como assinado sem essa verificação.

## Rollback

1. Exporte um backup em **Settings → Your data** antes de trocar de versão, quando possível.
2. Reinstale o último instalador validado. O instalador preserva o SQLite permanente e o perfil Electron.
3. Se o esquema de dados mudou, importe o backup criado na versão anterior. Não apague o perfil para tentar corrigir um erro de instalação.

O banco IndexedDB é atualizado de forma aditiva. Alterações futuras incompatíveis devem incluir migração testada e não devem sobrescrever dados desconhecidos.

## Limitações atuais

Não existe canal de atualização automática. A atualização é feita instalando uma versão nova sobre a anterior. O projeto não possui certificado de assinatura comercial; a assinatura pode ser configurada pelo mantenedor quando houver um certificado.


## Verificações desta rodada

Execute `npm test`, `npm run build` e os testes Electron de publicações e mídia descritos em CONTRIBUTING.md. Para FFmpeg, use vídeo sintético; não autentique nem publique com contas pessoais em testes automáticos. Feche o app antes de instalar e preserve um snapshot SQLite consistente e os diretórios de skills. Compare o estado salvo antes/depois da instalação e confirme o destino dos atalhos. Guarde o SHA-256 do instalador e do app.asar.

O workflow Windows produz um artefato de build, sem publicar automaticamente uma release. A licença do código é MIT; não substitui os termos de assets ou dependências. FFmpeg não é embutido no instalador e precisa estar no PATH para editar vídeo.

## Build local 0.3.38 validado

- Instalador: `MainsAgents-Setup-0.3.38.exe`.
- SHA-256: `4e19da87c0d3631eb8cd41f4f05900f9963034a7488d75b837f8f092a6b90f2e`.
- app.asar SHA-256: `4ac01c9294c14b6323b3aadb7493d627f4026625708406bdaba7006f02b49117`.
- Assinatura verificada: NotSigned. Nenhuma release pública foi publicada nesta rodada.
- Instalado sobre a versão anterior, com backup consistente e comparação integral do estado principal/editorial.
- O comando `npm run desktop:dist` também verifica o fechamento das dependências empacotadas e gera checksum/recibo JSON.

## Build Windows da CI validado

- Commit: `9b8a361`; [execução aprovada](https://github.com/devpedrohbs/MainsAgents/actions/runs/37256301995).
- Checkout limpo: 172 testes, build, instalação NSIS, revisão/calendário, exportação de vídeo sintético, handoff e preservação de dados passaram. O teste de persistência usa o preload, frontend e SQLite do app.asar instalado, em perfil temporário.
- Artefato `MainsAgents-Windows` baixado e conferido contra checksum e recibo.
- Instalador SHA-256: `fd77fb647f35cc95b47b5a447c41960cb081f99e04fb5104773d233c71ecba41`.
- app.asar SHA-256: `c4e11310a467af87bbf49917ac9ef830f7bfc82aa5af3c7acd9d720268b8f820`.
- Assinatura do instalador baixado: NotSigned. Este é um build independente do build local acima; seus hashes são distintos.
- Nenhuma release pública foi criada. O build usa `--publish never`; publicar uma release é uma etapa explícita separada.

## Build local 0.3.39 validado

- LinkedIn texto via Publora MCP: rascunho/agendamento, autorização separada, reconciliação sem recriar e cancelamento para rascunho. Contrato e limites em [publicação integrada](docs/publication-connector-increment.md).
- 182 testes automatizados e teste Electron de publicação com provedor simulado passaram. O teste de persistência passou usando o app.asar 0.3.39 e estado sintético da versão anterior. Nenhuma postagem em contas pessoais foi realizada.
- Instalador SHA-256: `8064058dc29ff765a193df841df3e16d3215f72cf9b8b38d9de05dd0c1a74e30`.
- app.asar SHA-256: `460ff5a8d741a9bba37da22b0651a669874fe439fad383d450f2fb6cbc4df6c0`.
- 43 módulos nativos verificados; assinatura NotSigned. A instalação pessoal do desktop não foi substituída nesta rodada.
