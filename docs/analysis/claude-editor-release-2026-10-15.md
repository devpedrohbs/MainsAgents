# Release local 0.3.69 — Editor Claude (palavras reais, orientação, migração)

Tarefa Orca `task_a3d392c5479b`. **Instalada e em execução** neste computador. Foi só uma instalação local: não houve commit, push, tag nem release pública, nenhuma chamada de IA de edição e nenhum vídeo pessoal processado.

## Resultado

- MainsAgents **0.3.69** instalado em `C:/Users/pacas/AppData/Local/Programs/MainsAgents`: FileVersion `0.3.69`, ProductVersion `0.3.69.0`, NSIS `/currentuser /S` com saída 0, sobre a 0.3.68 verificada.
- O app instalado abriu às `2026-10-15T14:03:08Z`. O `startup.log` nativo (`C:/Users/pacas/.mainsagents/storage`) registra: perfil `QDywHaiJ…`, versão 0.3.69, storage SQLite nativo, Codex bridge pronto e janela principal carregada, sem erro de renderer. Ficou uma instância aberta, com 5 processos `MainsAgents.exe` (principal + auxiliares do Electron).
- O agente real `editor-de-video-083621ee-…` agora é **Claude**:
  - modelo padrão do CLI (`modelId ""`);
  - `fileAccess` desativado, com a pasta de saída preservada;
  - ferramentas `files, canvas-context, subagents, web-search`;
  - instruções com as capacidades reais.
- Conversas novas desse agente usam o `providerId` do agente (`ChatPanel.tsx:197`). As 13 conversas existentes mantêm IDs e provedores (12 codex, 1 claude), sem renomeação.
- As duas produções paradas desse editor foram migradas para a **epoch 2**, continuam `blocked/planning-edit` e **não foram retomadas nem renderizadas**:

| Run | Revisão | Epoch | Autoridade | Checkpoint anterior |
|---|---|---|---|---|
| `production-8314f2f5-…` | 63 → 64 | 1 → 2 | `1494f848…` → `7a4f99f8…` | r3/22 chamadas, **verbatim** em `authoring.history` (sha `86e7f054…` igual antes e depois) |
| `production-9bed8ebf-…` | 16 → 17 | 1 → 2 | `1ac3ae2f…` → `f269aa2e…` | não havia |

## Ordem executada e provas

1. **Estado de partida:** `local-update-backup activity` sem processo do app, jobs ou turnos abertos. Nenhum Electron ou Orca foi encerrado. Counts antes do setup: 4 agentes, 13 chats, 241 itens (57 mensagens, 184 atividades). O run `8314f2f5` estava byte a byte igual ao recibo da r68 (rev 63, sha `d2fd900a…`).
2. **Backup completo online** em `.mainsagents-workspaces/local-update-0.3.69/backup`: 9 bancos SQLite com integridade `ok`, mais arquivos, imagens, sessões e 42 skills, sem credenciais. O backup das skills de antes da edição (`.mainsagents-workspaces/skill-backups/editor-de-video-2026-10-15`) foi preservado.
3. **Setup:**
   - Dry-run exato salvo em `setup-dry-run.txt`/`.json`.
   - `--apply` com app fechado + lease expirado. Backup `VACUUM INTO` verificado em `storage/backups/before-editor-claude-2026-10-15T13-59-10-582Z.sqlite`. CAS em agentes, runs e autoridade.
   - Tabelas alteradas, só as permitidas: `state` (linha `agents`), `agent_revisions` (13 → 14), `metadata`, `production_runs` e `production_authority`.
   - Depois do setup, todos os counts continuam iguais, assim como o sha dos 3 outros agentes, o sha das sessões e o sha de IDs/provedores.
4. **Versão:** `npm version 0.3.69 --no-git-tag-version`, sem tag. `package.json` e `package-lock.json` estão em 0.3.69.
5. **Build:**
   - `npm run build` (tsc, vite, preview, Remotion e stage do Whisper);
   - Remotion `--release`, com o bundle `13a56b63b4a7cac4` reaproveitado;
   - `check-build-files`: 93 módulos, nenhum faltando, e `editor-guidance.mjs` está no grafo;
   - electron-builder NSIS `--publish never` em `release/r69-final`;
   - `check-desktop-release` com `MAINSAGENTS_RELEASE_DIR=release/r69-final` ok.
6. **Pacote = fonte:**
   - 95 módulos da raiz e 34 arquivos de `dist` são idênticos; só o `package.json` difere, porque o builder o reescreve, como na r68.
   - Os 81 arquivos Remotion desempacotados são idênticos.
   - SHA-256 dentro do asar (prefixo), todos iguais à fonte:

| Arquivo | SHA-256 |
|---|---|
| `editor-guidance.mjs` | `44474710fe7cd850` |
| `editor-host.mjs` | `e4502158316dfec3` |
| `editor-authoring.mjs` | `95ff52e48e25c7eb` |
| `production-coordinator.mjs` | `3e447ed288f71948` |
| `claude-code-bridge.mjs` | `3f82a95fa2a0407e` |
| `claude-permission-mcp.mjs` | `ffdd8f6a685790b6` |

   - Lista completa em `asar-hashes-release.json` e `asar-hashes-installed.json`.
7. **Probe real do Claude CLI 2.1.300** (`scripts/claude-editor-mcp-probe.mjs`, atualizado para exigir 9 ferramentas e o schema de `offset`): só `initialize` e `mcp_status`, **0 turnos**.
   - Só o servidor `mainsagents_editor`, conectado, com as 9 ferramentas.
   - `get_transcript_words.offset` servido como inteiro opcional.
   - `dontAsk`, `--restricted`, `--strict-mcp-config`, sem ferramentas embutidas.
8. **Instalação:**
   - O snapshot imediatamente antes do instalador é idêntico ao de depois do setup, e o de antes/depois do instalador também é **IDENTICAL** (leases ignorados).
   - O `app.asar` instalado tem o mesmo hash do release (`ddb41dda…`), e o pacote instalado é idêntico à fonte.
9. **Abertura:**
   - Counts iguais, runs com a mesma revisão e sha (não retomados), nenhum job ou turno ativo.
   - A única diferença de dados após abrir é o campo derivado `productionContext.lastDecision/error` das conversas ligadas às produções. É a projeção que o renderer faz do run migrado (`productionChatContext`), e agora mostra `editor-config-adopted`. Itens, IDs e provedores das conversas são idênticos (diff por chave em `sessions-diff.mjs`, sem conteúdo).
   - Nenhum acesso alternativo ao servidor local foi tentado, e não foi forjada origem nem token.

Testes: a última suíte completa passou 719/719. Depois do último ajuste de código, 68/68 afetados e typecheck passaram. Nesta rodada só mudou `scripts/claude-editor-mcp-probe.mjs`, executado com sucesso; nenhum código do app mudou depois disso.

## Artefatos

- Instalador: `release/r69-final/MainsAgents-Setup-0.3.69.exe`, SHA-256 `3f97b30563bc7f733f19e1979dfd901ea27a822f1a4f8749108ecc7231908ef2`.
- `app.asar` (release = instalado): SHA-256 `ddb41ddabafcabb034b2b48cf5d9e1b403b73410601f05036287256ddba99ecb`.
- Recibo: `release/r69-final/MainsAgents-0.3.69-local-install-receipt.json`. Verificação: `release/r69-final/MainsAgents-0.3.69-verification.json`.
- Provas em `.mainsagents-workspaces/local-update-0.3.69/`:
  - snapshots: `before-setup`, `after-setup`, `before-install`, `after-install`, `after-launch`;
  - counts: `counts-*`;
  - setup: `setup-dry-run.*`, `setup-apply.out`;
  - empacotamento e probe: `mcp-probe.json`, `release-check.json`, `packaged-compare.json`, `asar-hashes-*`, `build.log`, `package.log`;
  - backup: `backup/`.

## Limites honestos

- **O chat Claude continua sem shell e sem escrita:** lê arquivos e pesquisa na web e não inicia handoffs. A edição real acontece pela **Produção** ou por handoff do Editor de Conteúdo com o vídeo (rota engine), usando as ferramentas `mainsagents_editor`.
- O painel de trabalho editorial (`EditorialWorkPanel.tsx:31`) lista só agentes Codex como fonte. O Editor de Vídeo, agora Claude, não aparece ali, o que é coerente com o fato de ele não iniciar handoffs.
- Componentes TSX livres escritos pelo Claude, legendas dentro do storyboard e SFX/trilha de biblioteca licenciada **continuam propostas**. O plugin e as skills da Remotion não foram instalados.
- **Nenhuma melhora estética foi medida em vídeo pessoal nesta rodada.** As produções ficam paradas até o usuário apertar Retomar. Ao retomar, a epoch 2 começa uma sessão nova com orçamento novo, e o plano anterior entra como referência.
- O timestamp por palavra do whisper.cpp é experimental, e nenhuma precisão é prometida.
