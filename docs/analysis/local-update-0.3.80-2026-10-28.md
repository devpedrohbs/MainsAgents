# Atualização local 0.3.80 — 28/10/2026

**Instalada nesta máquina em 28/10/2026, às 17:43 (America/Sao_Paulo), sobre a 0.3.79.**

- **Instalação:** NSIS silencioso por usuário, retorno 0.
- **Conferência:** versão e hashes batem com o pacote.
- **Dados:** preservados.
- **Fora desta rodada:** release pública, commit, push e tag.

Tarefa `task_c616fb9aee77` (dispatch `ctx_be45573668c1`).

## Escopo

Entrega da **Rodada 8 — Referências de edição e motion HyperFrames**:

- [Frontend](round8-frontend-2026-10-28.md) (Claude).
- [Runtime/backend](round8-runtime-2026-10-28.md) (Codex): análise visual real, transporte visual Codex e motor HyperFrames real.

Sobre a base local, que já estava instalada, preserva:

- remover tarefas do Board;
- a página de Uso;
- o consumo da conta Claude (0.3.79);
- todas as mudanças locais anteriores.

O motion segue limitado aos quatro tipos já conhecidos: `title`, `diagram`, `callout` e `comparison`. O recurso não foi ampliado.

## Versão

| Item | Antes | Agora |
| --- | --- | --- |
| `package.json` / duas identidades do lockfile | 0.3.79 | **0.3.80** |
| Instalado: FileVersion / ProductVersion | 0.3.79 / 0.3.79.0 | **0.3.80 / 0.3.80.0** |
| ASAR instalado | `6425af8d…c260` (= `release/r79-20261027`) | `c617e6e2…4c2a` (= pacote novo) |

## Fechamento da fonte

1. O Codex enviou **FONTE CONGELADA**: transporte visual Codex, `editing-reference-analysis/runtime` e snapshots/testes.
2. Antes disso, enquanto o Codex esteve sem responder (cerca de 1h30, coordenação avisada), o Claude atualizou uma única expectativa: `tests/claude-editor-transport.test.mjs:104` (`transcript.listed`). Ela passou a incluir as quatro ferramentas MCP da Rodada 8, como o próprio Codex já tinha feito nas linhas 30 e 95.
3. **Correção pontual de integração HyperFrames (Claude)** em `hyperframes-engine.mjs`:
   - **Defeito:** `engineProcess` mistura stdout e stderr. Numa máquina **sem Docker**, `hyperframes doctor --json` escreve "'docker' is not recognized…" no stderr. O `JSON.parse` falhava e o motor ficava preso em `error: engine diagnostics unavailable`, mesmo com tudo instalado. Esta máquina tem Docker, por isso a prova anterior não pegou o caso.
   - **Correção:** `doctorReport()` lê só o relatório JSON.
   - **Teste novo:** em `tests/hyperframes-runtime.test.mjs`.
4. Inventário congelado: **1242 arquivos** (`git ls-files -co --exclude-standard`), SHA-256 `246e1f470c602013cb10ed93d354f6391c40e94492a4b50c9be3bd384ba1c188`.
   - O inventário ficou igual depois do build e de todos os testes.
   - Depois disso só mudaram este relatório, `README.md` e `RELEASE.md`, que não entram no pacote.

## Build e pacote

Pasta nova: `release/r80-final-20261028/`.

- `release/r80-20261028/` ficou com um build interrompido de propósito, quando o Codex avisou que ainda havia mudanças. Não foi usado; a remoção ficou pendente porque o Windows mantinha o `app.asar` aberto.
- `release/r80-prelim*/` são pacotes preliminares, usados só para validar o smoke novo.

| Etapa | Resultado |
| --- | --- |
| `npm run build` | TypeScript, Vite, preview, Remotion e Whisper verificado |
| `node scripts/build-remotion-video.mjs --release` | bundle `3404bdd9a71e549b` |
| `node scripts/check-build-files.mjs` | **115 módulos, nenhum ausente** |
| `electron-builder --win nsis --publish never` | `MainsAgents-Setup-0.3.80.exe` |
| `check-desktop-release.mjs` | ok, 115 módulos nativos/runtime |
| ASAR × fonte | 122 arquivos de runtime/`dist` idênticos byte a byte. Identidade e dependências do `package.json` iguais. Nada de `.mainsagents-workspaces`, `release`, `.sqlite`, lease/staging, credenciais ou `round8-runtime` |

| Artefato | SHA-256 |
| --- | --- |
| `release/r80-final-20261028/MainsAgents-Setup-0.3.80.exe` | `1347cca571cb069d884ab604dbd3c22a2e01c65ed17e2ca774a261e488abcb6e` |
| `app.asar` (pacote = instalado) | `c617e6e2124a8c43f1c1c1415cbe1a9ef5a778259d447843580b4647cdc74c2a` |

O instalador não tem assinatura comercial: os hashes acima identificam esta entrega.

## Testes

Todos os testes foram rodados depois do congelamento, sobre o `dist` e o pacote finais. Logs em `.mainsagents-workspaces/update-0.3.80-*.log`.

- **Suíte completa** (`--test-concurrency=4`): **871 testes, 869 aprovados, 0 falhas, 2 ignorados**.
  - Os dois ignorados são os renders reais, que só rodam com `MAINSAGENTS_HYPERFRAMES_HOME`.
  - Rodados isoladamente com o motor preparado pelo exe empacotado, fora do repositório: **4/4 aprovados**.
  - Os dois renders reais cobrem:
    - "REAL study render → reviewable artifacts → approved kit → registered silent production asset";
    - "REAL HyperFrames renders H264…".
- **Focados** (`--test-concurrency=1`): MCP do editor, transporte Claude, `editing-references*` (incluindo `editing-references-codex`), `editorial-work-bridge`, `claude-code-bridge`, `production-authored-edit` e `hyperframes-runtime`. Resultado: **44 testes, 42 aprovados, 0 falhas, 2 ignorados** (os mesmos renders reais).
- **Smokes de UI no `dist` final** (Electron isolado, sem inferência):
  - `test-editing-references-ui.mjs` ok;
  - `test-edit-stages-ui.mjs` ok: cortes, depois visual, depois SRT.
- **Pacote real** (`release/r80-final-20261028/win-unpacked`), todos com saída 0:
  - `PACKAGED_HYPERFRAMES_OK`;
  - `PACKAGED_NATIVE_PERSISTENCE_UI_OK`;
  - `PACKAGED_MEDIA_OK`;
  - `PACKAGED_CONTENT_SESSIONS_OK`;
  - `PACKAGED_CONTENT_FLOW_OK`;
  - `PACKAGED_CLAUDE_ACCOUNT_USAGE_OK`;
  - `PACKAGED_CHECKUP_OK`.

Nenhum teste precisou ser repetido por motivo de ambiente nesta rodada.

### Motor HyperFrames no host empacotado

`scripts/test-packaged-hyperframes.mjs` é novo.

**Montagem:**

- O backend de referências é carregado **de dentro do `app.asar`**.
- O motor roda com **o `MainsAgents.exe` empacotado como Node**, o mesmo `process.execPath` do app instalado, sem `npm_execpath`.
- Perfil e raiz de motor isolados. Não usa `node_modules` do repositório nem `.mainsagents-workspaces/round8-runtime`.

**Etapas cobertas:**

1. Motor ausente aparece como `not-configured` (esperado 0.8.212), e `study.render` é recusado com 422. Não há "pronto" falso.
2. `engine.prepare` real: npm com versões exatas, Chrome do HyperFrames, conferência da versão. Resultado `ready` 0.8.212.
3. `hyperframes doctor` pelo exe empacotado: Node.js, FFmpeg, FFprobe e Chrome ok.
4. Com o PATH sem FFmpeg e sem Docker: `error` "Missing local dependencies: FFmpeg, FFprobe", que é uma ação real a tomar no app. Este passo cobre a correção do `doctorReport`.
5. Render real dos **quatro tipos** pelos comandos HTTP do bridge, com relatório `hyperframes`/0.8.212, 640×360, sem áudio:

   | Tipo | Bytes | SHA-256 (prefixo) |
   | --- | --- | --- |
   | `title` | 43601 | `4ab32283…` |
   | `diagram` | 62976 | `24f3c182…` |
   | `callout` | 44328 | `391de64f…` |
   | `comparison` | 56419 | `1dbfd04e…` |

6. Reprodução pela rota de mídia:
   - pedido parcial (Range) responde 206;
   - os bytes servidos têm o mesmo SHA do artefato registrado;
   - o Chromium decodifica 640×360/2 s, toca e faz seek;
   - a captura mostra o diagrama renderizado.

## Backup, instalação e preservação

Antes de fechar ou instalar, `scripts/local-update-backup.mjs activity` retornou `active:false`: nenhum processo do app, job ou turno aberto. O app já estava fechado e nada foi interrompido.

Backup fora do Git:

```text
C:/Users/pacas/.mainsagents/backups/local-update-0.3.80-2026-10-28/
```

**Conteúdo do backup:**

- Nove bancos pela API de backup online do SQLite, incluindo o WAL comprometido; todos com `integrity_check=ok`.
- Cópias de arquivos:
  - 143 arquivos locais (`storage`);
  - 16 de sessões do runtime;
  - 1 imagem gerada;
  - 72 do perfil, sem caches nem credenciais;
  - 42 guias/skills;
  - complemento de **15 pastas de skills com 63 arquivos**.

**Mudanças no script de backup:**

- `scripts/local-update-backup.mjs` agora também inclui no snapshot e no compare as mídias gerenciadas de Referências (`%APPDATA%/mains-agents/editing-references`) e de mídia editorial (`%APPDATA%/mains-agents/media`).
- A cópia do perfil já as abrangia.
- A auditoria por linha (`preservation-audit.mjs`, fora do checkout) também faz o hash dessas pastas.

**Instalação:**

```text
Start-Process -WindowStyle Hidden MainsAgents-Setup-0.3.80.exe /S /currentuser /D=C:\Users\pacas\AppData\Local\Programs\MainsAgents
```

| Verificação | Resultado |
| --- | --- |
| Retorno do NSIS | **0** |
| FileVersion / ProductVersion | `0.3.80` / `0.3.80.0` |
| ASAR instalado = pacote | `c617e6e2…4c2a` = `c617e6e2…4c2a` |
| Atalhos (Área de trabalho e menu Iniciar) | apontam para `C:\Users\pacas\AppData\Local\Programs\MainsAgents\MainsAgents.exe` |
| Atividade após a instalação | `active:false`, app fechado |
| Snapshot lógico (`--strict-leases`) antes da instalação × logo antes de instalar × depois de instalar × depois de preparar o motor | **IDENTICAL** |
| Auditoria de todas as linhas dos 9 bancos + 143 arquivos locais + 15 pastas de skills + mídias de referências | antes = depois = `f14c065382aa32a3a30406a128f39beb462e7b866fbb19c5e2807c4ca484894c` |

Nenhum agente, conversa, rascunho, tarefa, canvas, configuração, credencial ou skill foi editado. O perfil pessoal **não foi aberto**, e nenhum job foi iniciado.

### Motor gerenciado do usuário

Com autorização da coordenação, o motor foi preparado em `%USERPROFILE%/.mainsagents/engines/hyperframes-0.8.212`, que é o `engineRoot()` padrão. Foi usado o **`MainsAgents.exe` instalado**, com `ELECTRON_RUN_AS_NODE`, o módulo vindo do ASAR instalado e sem `npm_execpath`.

**Resultado:**

- O estado passou de `not-configured` para `ready` 0.8.212 em 8 s.
- Render de prova `comparison` 640×360/2 s, H.264, sem áudio, feito numa pasta temporária que foi apagada depois.
- `package.json` do motor: `hyperframes 0.8.212` e `gsap 3.14.2`, exatos, SHA-256 `f6d434a2…7960`.
- `package-lock.json`: SHA-256 `11ddeefa6b49084cb40ce7c514e9de3b7ae4d807f83a310629ecdfd2fe2723fb`.
- Tamanho: cerca de 120 MB.
- O Chrome do HyperFrames fica no cache do próprio HyperFrames (`~/.cache/hyperframes`).
- Recibo: `installed-engine-proof.json`, na pasta de backup.

Nada foi feito no HyperFrames desktop, em contas, na nuvem ou com inferência paga.

## Limites honestos

- **Análise visual real** de referência depende de um provedor com visão: Claude pelo canal do editor, ou Codex com até 12 imagens. Nenhuma inferência foi executada aqui. As ferramentas de motion por agente continuam só no canal do editor Claude.
- O `doctor` do HyperFrames consulta a versão mais recente no npm (aparece como "latest" no diagnóstico).
- As dependências transitivas do motor seguem o lock gerado no preparo, registrado acima. Só os dois pacotes diretos têm versão exata no comando de instalação.
- FFmpeg e FFprobe vêm do PATH do sistema, como na mídia editorial existente. Sem eles, o app mostra `error` com as dependências que faltam, e não "pronto".
- O instalador continua sem assinatura comercial (`NotSigned`).
- O app instalado não foi aberto para testes, para não retomar produções do usuário. A interface das Referências foi verificada no `dist` final e o backend no ASAR final.
- Sem `git add`, commit, push, tag ou release pública.
