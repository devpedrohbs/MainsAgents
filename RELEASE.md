# Publicação e recuperação do MainsAgents (Windows)

## Atualização local atual — 0.3.87 (30/10/2026)

Conexão Claude Code e modelo configurado identificados no chat, sem inferência para descobrir a configuração. Modelos explícitos continuam preservados. Menu de modelos usa a camada superior do navegador para não ser cortado; Esc fecha somente o menu. Instalada sobre a 0.3.86 por NSIS silencioso, retorno 0. Nove bancos, arquivos e skills idênticos antes/depois. [Validação e limites](docs/analysis/local-update-0.3.87-2026-10-30.md).

- Instalador: `release/r87c-20261030/MainsAgents-Setup-0.3.87.exe`, SHA-256 `b010564e4023610b904d3da60cd977ad1e028b3319d126e9e5bed42a2ea8db67`.
- ASAR instalado igual ao pacote: `31ee1524515ff0a32df753061d6e625bafcef997ebee3393249a91ca1350d3eb`; FileVersion `0.3.87`, ProductVersion `0.3.87.0`.
- Suíte: 925 testes, 923 aprovados, 2 condicionais ignorados. UI focada e persistência do ASAR aprovadas; limite preexistente da comparação em janela estreita documentado no relatório. Sem commit ou publicação pública.

## Atualização local anterior — 0.3.86 (30/10/2026)

V2 completa: Caixa de entrada em duas colunas, Estúdio com abas Conversa/Etapas, Radar com lista de sinais e detalhe, link de execução no Calendário, aba Execuções no agente, "Execuções que mais consumiram" em Uso, correções de layout. `npm test`: 918 aprovados, 2 ignorados. Instalada com NSIS silencioso, retorno 0; snapshots idênticos. Detalhes: `docs/analysis/local-update-0.3.86-2026-10-30.md`.

- Instalador: `release/r86b-20261030/MainsAgents-Setup-0.3.86.exe`, SHA-256 `19ac80fab781c5ae3d0bf3abac46e09b36afba18dd8ddad093939f5d628ca2c8`.
- ASAR do pacote: `6b22ad7b195e54f48d0f148bfa2de354ddbe1c7a72f5d4aacf58c3c7275a33ab`.

## Atualização local anterior — 0.3.85 (29/10/2026)

V2 estrutural, conforme `docs/design/v2/`: barra lateral nova (Caixa de entrada, Mission Control, Execuções; grupos Conteúdo, Workspace e Equipe com estado de cada agente), Home como Mission Control, páginas novas Caixa de entrada, Execuções (lista + detalhe com plano, cascata, registros e inspetor) e Pipelines (diagrama da produção ativa com estados da última execução), Estúdio com trilha de etapas e painel de contexto. Canvas sem mudança. Typecheck aprovado; suíte de 920 testes: 918 aprovados, 2 ignorados. Instalada por NSIS silencioso por usuário, retorno 0; snapshots antes/depois idênticos (`compare --strict-leases`). Backup em `~/.mainsagents/backups/local-update-0.3.85-2026-10-29/final`. Detalhes: `docs/analysis/local-update-0.3.85-2026-10-29.md`.

- Instalador: `release/r85-20261029/MainsAgents-Setup-0.3.85.exe`, SHA-256 `224e6278b9ee657394918c2e452d62aae970a522b14bd61768d0b5d03f20ca59`.
- ASAR do pacote: `3696b0f4b455124d5ad777e4179a22357b12f518dbe47e1e8e6ac4fc7278636d`.

## Atualização local — 0.3.84 (29/10/2026)

Pacote do design V2 validado: base, páginas da equipe, Home, Estúdio, Radar e ícones de estado compartilhados; Canvas mantém o visual anterior. Typecheck, suíte de 920 testes (918 aprovados, 2 ignorados, zero falhas), os cinco testes de UI do dist e persistência do ASAR aprovados. Instalada sobre a 0.3.83 por NSIS silencioso por usuário, retorno 0, após o usuário fechar o app normalmente (salvamento verificado); FileVersion `0.3.84`, ProductVersion `0.3.84.0`, ASAR instalado idêntico ao pacote. Nove bancos, arquivos locais e skills idênticos antes/depois. [Validação e andamento](docs/analysis/local-update-0.3.84-2026-10-29.md).

- Instalador: `release/r84-20261029/MainsAgents-Setup-0.3.84.exe`, SHA-256 `9e9dc1c4aa9ac1719efb41af1547a8487cfc1aabd1fcaf066a526224a07bde6f`.
- ASAR do pacote: `7db76f6dd8492395b32f437c4d2d68b145ee4c8016906fde361014d7a0d17ad4`.

## Atualização local — 0.3.83 (29/10/2026)

Instalada sobre a 0.3.82 por NSIS silencioso por usuário, retorno 0. Adiciona espaços independentes no Canvas, migração compatível do Canvas anterior, isolamento de contexto automático por perfil/workspace/espaço e backup de todos os espaços. Remove a página Fluxo e mantém a configuração dos agentes em **Criar → Nova produção**, preservando o modelo de produção existente. [Validação, limites e preservação](docs/analysis/local-update-0.3.83-2026-10-29.md).

- Instalador: `release/r83-20261029/MainsAgents-Setup-0.3.83.exe`, SHA-256 `09a190925c6717cc08898dcc562010bb4bdbd25428e067a3558c073fd4759658`.
- ASAR instalado idêntico ao pacote: `ef4207737e7929c421c62f0069fcd51b7b58684534cd04a23667aa998e16abde`; FileVersion `0.3.83`, ProductVersion `0.3.83.0`.
- Suíte: 920 testes, 918 aprovados, 2 ignorados, zero falhas. UI de Canvas, produção, edição por etapas e persistência do pacote aprovadas; limites de duas fixtures antigas registrados no relatório. Nove bancos, 146 arquivos locais e 15 raízes de skills preservados por comparação completa antes/depois. Sem publicação pública ou commit nesta rodada.

## Atualização local anterior — 0.3.82 (29/10/2026)

Instalada sobre a 0.3.81 por NSIS silencioso por usuário, retorno 0. Remove os dois guias iniciais e sua reabertura em Configurações; adiciona exclusão de pautas no Estúdio com confirmação, isolamento, proteção de pesquisas/conteúdos vinculados e prevenção de restauração por escritas antigas. Corrige também a confirmação de exclusão de conteúdo recarregando a cada atualização do pai. [Validação e preservação](docs/analysis/local-update-0.3.82-2026-10-29.md).

- Instalador: `release/r82-20261029/MainsAgents-Setup-0.3.82.exe`, SHA-256 `670601c39f908adedba2181ea6e094c4b264fad4f0abb847f26402e5523b3902`.
- ASAR instalado idêntico ao pacote: `49362d761ea33f400e57aa4a352ea8ecfd4f06a8537e3af2f6472af3cacd39d6`; FileVersion `0.3.82`, ProductVersion `0.3.82.0`.
- Suíte: 912 testes, 910 aprovados, 2 ignorados, zero falhas; três smokes de UI e persistência do pacote aprovados. Nove bancos, 145 arquivos locais e 15 raízes de skills preservados por comparação antes/depois. Sem publicação pública ou commit nesta rodada.

## Atualização local anterior — 0.3.81 (29/10/2026)

Radar editorial instalado localmente sobre a 0.3.80, com dados preservados. [Validação e pacote](docs/analysis/local-update-0.3.81-2026-10-29.md).

## Atualização local anterior — 0.3.80 (28/10/2026)

Instalada sobre a 0.3.79 por NSIS silencioso com retorno 0. Rodada 8: Referências de edição (biblioteca, estudo com player, análise com aprovação explícita, Meu estilo, Kit de motion) e motor HyperFrames 0.8.212 local real, comprovado no host empacotado. FileVersion `0.3.80`, ProductVersion `0.3.80.0`; ASAR instalado igual ao pacote; nove bancos, 143 arquivos locais, 15 pastas de skills e mídias de referências idênticos antes/depois. [Validação, motor e backup](docs/analysis/local-update-0.3.80-2026-10-28.md).

- Instalador: `release/r80-final-20261028/MainsAgents-Setup-0.3.80.exe`, SHA-256 `1347cca571cb069d884ab604dbd3c22a2e01c65ed17e2ca774a261e488abcb6e`.
- ASAR: SHA-256 `c617e6e2124a8c43f1c1c1415cbe1a9ef5a778259d447843580b4647cdc74c2a`.
- Suíte completa 871 testes (869 aprovados, 2 renders reais ignorados na suíte e aprovados isoladamente), smokes de UI e sete smokes do pacote aprovados. Sem publicação pública ou commit nesta rodada.

## Atualização local anterior — 0.3.79 (27/10/2026)

Instalada sobre a 0.3.78 por NSIS silencioso com retorno 0. Corrige a leitura do consumo Claude: consulta somente de leitura da conta autenticada pelo Claude Code, sem iniciar modelo; limites de 5 horas e semana, cache, atualização manual, tratamento de login/falha e limpeza ao trocar de conta. FileVersion `0.3.79`, ProductVersion `0.3.79.0`; ASAR instalado igual ao pacote, nove bancos, 142 arquivos locais e 15 pastas de skills idênticos antes/depois. [Validação e backup](docs/analysis/claude-account-usage-2026-10-27.md).

- Instalador: `release/r79-20261027/MainsAgents-Setup-0.3.79.exe`, SHA-256 `1ca4e072bdd744f519e0fade1bc2e4799fc50b4b60a137a9fda2f9823f80536e`.
- ASAR: SHA-256 `6425af8dfbdad03881c7696a119e6d2e4a0c0dab01af4dfea96e87750168c260`.
- 40 testes direcionados, typecheck, build completo, interface de consumo e dois testes isolados do pacote aprovados. Sem publicação pública ou commit nesta rodada.

## Atualização local 0.3.78 (27/10/2026)

Instalada nesta máquina sobre a 0.3.77, sem publicação de release: pacote completo do checkout atual, correções de canvas e estado, fluxo visual, chat/modelos/anexos/uso e preservação da edição em três etapas. `package.json` e lockfile sincronizados. NSIS silencioso por usuário, retorno 0; FileVersion `0.3.78`, ProductVersion `0.3.78.0`; ASAR instalado idêntico ao verificado. Os nove bancos, arquivos locais e skills permaneceram logicamente idênticos; app mantido fechado, nenhum trabalho pessoal iniciado. [Relatório, limites e backup](docs/analysis/local-update-0.3.78-2026-10-27.md).

- Instalador local: `release/r78-20261027/MainsAgents-Setup-0.3.78.exe`, SHA-256 `05d1674a77fee224bcbc38b75f9263383a9244c415851b6cb2a55cc8f09042a7`.
- ASAR do pacote e instalado: SHA-256 `dcae863f9915a1a82f8dd834654809601d557d479efa9d7230582f0ef29d2e7b`.
- Build completo, quatro smokes de interface, três fixtures atualizadas e quatro verificações isoladas do pacote aprovados. Suíte geral: 843/844 na primeira execução, com a única falha transitória `EPERM` de rotação aprovada em repetição isolada, sem mudar código.

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
