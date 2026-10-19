# Release local 0.3.72 — edição pelo chat e ajuste visual localizado

**Instalada, aberta, visível e verificada** em `C:/Users/pacas/AppData/Local/Programs/MainsAgents/MainsAgents.exe`, substituindo a .71 aceita. FileVersion **0.3.72**, ProductVersion **0.3.72.0**. Tarefa `task_a3d2a64d032f`, dispatch `ctx_52a2dc4b0439`.

A entrega de implementação/QA anterior foi aceita pelo root: [relatório da feature](chat-editing-semantic-local-adjustments-2026-10-16.md), **781/781 testes**, Electron isolado e render Remotion/FFmpeg real. Claude Code implementou a maior parte e parou por limite de uso; Codex adicional concluiu correções/QA e este build/instalação sob a exceção autorizada pelo usuário. Root coordenou/revisou. A preferência persistente de colaboração não foi alterada, e o diretor padrão do vídeo no produto continua **Claude Code**.

Somente release local: sem commit, push, tag, publicação, nova feature ou alteração funcional nesta tarefa. Sem subworkers, inferência, troca de conta ou contorno de quota. Nenhum vídeo pessoal foi aberto, renderizado, editado ou excluído; não foram acionados Paper, Notion, posts ou agendamentos. O app instalado recebeu somente smoke de leitura.

## O que chegou ao app

- Anexar vídeo e pedir edição explicitamente no chat Claude ou Codex inicia o motor local e devolve progresso/erro/recibo no mesmo chat, inclusive no chat do próprio Editor, sem precisar abrir Fluxo.
- Retomadas e erros são apresentados ao diretor como evidências de palavras reais, com motivos/confiança e tempos aproximados. O diretor decide semanticamente; os testes não medem qualidade cognitiva de modelo real.
- Um pedido como “Entre 12 e 18 segundos troque a animação por uma comparação” se refere ao **vídeo editado**. O ajuste preserva cortes, áudio/SFX/voz, SRT e cenas externas, com CAS de versão/plano, prévia da janela e exportação completa versionada. Há cancelar e voltar à versão anterior.
- Se uma cena atravessa a borda, o app **recusa o intervalo e exige seleção explícita de uma janela suportada**; nunca amplia escondido. A prévia cobre a janela exata, por **até 15 s** quando o trecho é maior. Referências de estilo, item 3, continuam adiadas.

## Backup e partida frescos

Provas em `.mainsagents-workspaces/local-update-0.3.72/`, usando `scripts/local-update-backup.mjs`. O app já estava fechado: activity fresco confirmou **0 processos do app, 0 jobs ativos, 0 turnos abertos**. Não foi necessário fechar ou encerrar processo algum; Orca e outros aplicativos permaneceram intactos.

1. Snapshot `before-backup.json`, auditoria `audit-before-backup.json` e `counts-before.json`, todos lidos nesta rodada; não se usaram contagens históricas como base.
2. Backup online **novo** em `backup/`, com API SQLite incluindo WAL comprometido: **9/9 bancos com integridade ok**. Cópias: storage **136**, sessões runtime **16**, imagem gerada **1**, appdata **74**, skills **42**. Credenciais não foram copiadas.
3. `backup-snapshot.json` corresponde ao snapshot de partida. Antes de instalar, `before-install.json` e a auditoria do app fechado `audit-closed-final.json` continuavam idênticos ao backup, incluindo hashes de todas as linhas/tabelas e arquivos de storage.
4. As **136 cópias de storage** e **42 cópias de skills** foram verificadas por hash. A enumeração recursiva do PowerShell encontrou seu limite de caminhos longos; a árvore inteira foi verificada com o filesystem Node, que confirmou os arquivos, sem erro de backup. Backups anteriores foram preservados.

As contagens frescas antes/depois são idênticas: **4 agentes**, **13 chats** (12 Codex, 1 Claude), **206 itens** (46 mensagens, 160 atividades), **2 produções bloqueadas**, mesmas revisões **64/17**, epochs, autorizações e hashes. O Editor de Vídeo continua Claude, com mesmas instruções, ferramentas e modelo. Rascunhos, SRTs, editorial, assets e os demais registros retêm os mesmos hashes de linha.

## Build, pacote e instalação

| Etapa | Resultado |
| --- | --- |
| `npm version 0.3.72 --no-git-tag-version` | `package.json`, lock e pacote raiz do lock em .72; sem tag. |
| `npm run build` | Exit 0: typecheck, Vite, preview, Remotion e stage Whisper. Aviso existente de chunk grande. |
| `node scripts/build-remotion-video.mjs --release` | Bundle **`13a56b63b4a7cac4` reaproveitado**, íntegro. |
| `node scripts/check-build-files.mjs` | **102 módulos alcançáveis, missing: []**; os quatro módulos novos de chat/retakes/patch estão em `build.files`. |
| `npx electron-builder --win nsis --publish never --config.directories.output=release/r72-final` | Exit 0, pasta nova. Aviso de depreciação do builder, sem falha. |
| `MAINSAGENTS_RELEASE_DIR=release/r72-final node scripts/check-desktop-release.mjs` | Exit 0, versão/hashes/arquivos/dependências presentes. |
| Pacote × fonte | **242 arquivos** comparados, **103 módulos JS da raiz**, renderer/dist correspondentes. Só o `package.json` da raiz difere pela limpeza normal do builder; `main`, versão e dependências idênticos. |
| Desempacotados/runtime | **477 arquivos**, **474 byte a byte iguais**; três `package.json` de dependências tiveram apenas metadados de publicação removidos. Campos de runtime (`main`, exports, deps, versão etc.) iguais. **19 binários nativos** e **81 arquivos Remotion** idênticos à fonte. |
| Whisper | **8 arquivos** iguais ao stage; em relação à .71, somente `MANIFEST.stagedAt` mudou, conferido sem presumir. |
| NSIS local | `/S /currentuser /D=C:\Users\pacas\AppData\Local\Programs\MainsAgents`, `Start-Process -WindowStyle Hidden`, exit **0**, **8,44 s**. |
| Release × instalado | Mesmo asar e **561/561 arquivos** do release instalados idênticos; nenhum ausente ou divergente. |

A suíte 781 não foi repetida, pois não houve alteração funcional ou falha de produto nesta tarefa. O build refez o typecheck. Os ajustes dos helpers locais de auditoria não alteraram o produto: normalização de paths Windows e classificação explícita dos metadados reescritos pelo builder.

## Comparação depois da instalação e da abertura

Imediatamente após o instalador, ainda com o app fechado: **todos os hashes de linha, schema e arquivos de storage iguais** ao snapshot final anterior à instalação.

O app foi aberto normalmente, **visível**, em `2026-10-16T02:03:43Z`. Prova Win32 de leitura: uma janela principal visível e respondendo, título “Central de controle · MainsAgents”, cinco processos no caminho instalado. Startup: `single-instance lock=true`, `version=0.3.72`, storage `desktop-sqlite`, bridges prontas e `Main window loaded`. Sem erro; somente o aviso `fs.Stats` que já existia na .71. Um GET externo sem token ao endpoint de versão recebeu **403 esperado** do guard; não houve extração de token nem bypass, e a versão foi conferida no EXE, asar e startup.

A auditoria mais detalhada detectou e verificou somente estes efeitos normais de abertura, todos registrados em `expected-startup-changes.json`:

- Uma tabela nova **`chat_edit_requests` vazia** e seus **quatro triggers `fence_chat_edit_requests*`**; nenhuma outra mudança de schema.
- `metadata.app-version`: .71 → .72, com todos os outros metadados iguais.
- Append no `startup.log`, com prefixo antigo intacto, e um novo backup automático `workspace-before-0.3.72-…json`, criado pelo store antes da atualização de versão.
- Em `account.json`, somente a porta loopback do serviço local mudou (58892 → 59319). O hash original foi reproduzido exatamente substituindo **apenas** essa porta no JSON atual: todos os campos de conta/token criptografado continuam iguais. Auth/config do runtime Codex têm os mesmos hashes.
- O timer existente de `publication_refresh` atualizou **somente `lastRunAt`**. Configuração e todo o restante do status são idênticos, **checked=0**, resultados/notices vazios; com zero candidatos, não houve chamada a `publishing.observe`, nem alteração de post/agendamento.
- As três tabelas de leases variam com o host aberto e foram ignoradas apenas nessa comparação.

Nenhum agente/provider/modelo/chat/mensagem/rascunho/SRT/produção/arquivo pessoal foi removido ou editado. As produções bloqueadas não retomaram; **0 produções pessoais novas**, ledger de pedidos novo com **0 linhas**. Activity final: **ocioso**. Não houve drift pessoal inesperado ou rollback.

## Artefatos e limites

- Instalador: `release/r72-final/MainsAgents-Setup-0.3.72.exe`, **278200397 bytes**, SHA-256 **`17719b6b59b77377d42e3fa222415808c8f197044ec0e5bf6a47e1a74d538a9c`**.
- Asar release = instalado: **90487480 bytes**, SHA-256 **`da77ea420765646b5ca5f6b98f2d5df6c2611767be9af908e4786d250e0ef338`**.
- [Recibo local](../../release/r72-final/MainsAgents-0.3.72-local-install-receipt.json) e checker `release/r72-final/MainsAgents-0.3.72-verification.json`.
- Provas locais: `backup/manifest.json`, `backup-file-verification.json`, snapshots/auditorias antes/depois, `counts-*`, `compare-*`, `expected-startup-changes.json`, `package-audit-release.json`, `package-audit-installed.json`, `installed-tree-compare.json`, `window-proof.json`, `startup-new.txt`, `build.log` e `package.log` na pasta desta atualização.

**Smoke com inferência real do Claude não executado**, após o limite de uso do worker anterior; nesta tarefa não se gastou inferência nem se tentou contornar quota. Decisões/transcrições dos testes da feature são simuladas; **Remotion/FFmpeg e arquivos renderizados são reais**. Isso comprova o motor/integração e os invariantes testados, não qualidade editorial cognitiva em vídeos reais. MP4 lossy não promete identidade pixel/framemd5 fora da janela: a prova é estrutural pré-encode, com áudio verificado separadamente.

Estado final: **MainsAgents .72 aberto, visível e ocioso; dados pessoais preservados**. A avaliação editorial real fica para o uso autorizado quando houver quota, mantendo Claude como diretor padrão.
