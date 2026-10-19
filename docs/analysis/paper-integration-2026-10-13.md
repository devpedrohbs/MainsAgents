# Integração Paper para carrosséis — 13/10/2026

Worker A (Claude Code), tarefa `task_7f9c3b807fc1`. Revisei e completei o trabalho inicial que já estava na árvore e depois instalei a 0.3.63 localmente. Não houve commit, push nem release pública. Não fiz chamada de escrita ao Paper nem chamada de IA.

## O que mudou

| Arquivo | Mudança |
| --- | --- |
| `paper-design.mjs` / `.d.mts` | Validação com padrão de `fileId`. A concessão automática agora deixa fora `set_tokens`, além de exclusão, `write_html` em modo `replace`, `open_file`, `create_file`, `rename_resource`, comentários, ferramentas desconhecidas, outro arquivo, `get_basic_info` sem `fileId`, exportação de vídeo/`webm`/`mp4`, `nodes-with-exports-only` e `paper-gen` em qualquer grafia (escape CSS, entidade HTML, percent-encoding). O decodificador é limitado a 0x10FFFF e não lança exceção. O prompt lista o que continua pedindo confirmação. Foi adicionado `withoutPaperAutomation`. |
| `paper-desktop.mjs` | Inspeção somente leitura via stdio: `get_guide` → `get_basic_info({})`. Se o ID não vier nessa resposta, usa a única aba `active` de `list_resources` e confirma com `get_basic_info({fileId})`. Usa um único prazo, trata `EPIPE` no stdin, limita a saída, sempre encerra o processo e mostra erros sem caminhos nem tokens. |
| `claude-code-bridge.mjs` | Os parâmetros Paper do prompt vêm **somente** do agente salvo vinculado à sessão, lido a cada turno. A cópia enviada pelo renderer é ignorada. Sessões do editor de vídeo continuam sem Paper. |
| `src/data/backupFormat.ts` | Agentes e rascunhos importados chegam com `paperDesign.automatic=false`. No merge, o agente local é mantido. |
| `src/components/agents/AgentEditorDrawer.tsx` | O checkbox de concessão fica desabilitado até haver arquivo conectado. Conectar outro arquivo desliga a concessão. O texto lista o que continua pedindo confirmação. |
| `package.json` / lock | Versão 0.3.63. Os módulos Paper já estavam em `build.files`. |
| `README.md` | Seção "Carrosséis no Paper". |
| `tests/paper-design.test.mjs` | Novo, com 7 testes (ver abaixo). |
| `scripts/test-paper-agent-ui.mjs` | Novo. Executa Electron oculto com o renderer real. |
| `scripts/paper-agent-setup.mjs` | Novo. Faz dry-run por padrão. `--apply <dir>` faz backup e grava com CAS pelo store do app. Recusa se o app estiver aberto ou se houver rascunho do agente. |

Já estavam corretos e foram mantidos: `runtime-action-approvals.mjs` (rechecagem do binding atual, de `permittedMcpAction` e da decisão), `Agent.paperDesign`, validador de rascunho, `AiProvider`/`ChatProvider` e a injeção no Codex via binding. O hash do binding é `actionHash({agent,sessionId})`, então qualquer mudança em `paperDesign` invalida concessões pendentes.

## Esquema real do Paper

`tools/list` do CLI instalado (`paper-desktop 0.0.1`, somente leitura) **não declara `outputSchema`** para nenhuma ferramenta. A descrição de `get_basic_info` cita nome do arquivo e páginas, mas não um `fileId`. Por isso o inspetor aceita conteúdo estruturado, JSON em texto ou texto rotulado, e cai em `list_resources`. Todas as ferramentas de arquivo exigem `fileId` como argumento, o que confirma o escopo por `args.fileId`.

Com o Desktop fechado, o CLI responde, literalmente: `Paper Desktop isn't running. Tell the user to open it, then end your turn. Don't launch Paper Desktop yourself.` Esse é o erro coberto pelo teste. **O formato real da resposta de `get_basic_info` com um arquivo aberto não foi observado.** A conexão no editor ainda não foi validada ao vivo.

## Testes

- `tests/paper-design.test.mjs`: 7/7. Cobre:
  - escopo da concessão;
  - validação, prompt e agente legado;
  - binding obsoleto, incluindo mudança só de hash;
  - transporte do inspetor: ordem `initialize` → `notifications/initialized` → ferramenta, parada após guia indisponível, prazo, saída grande, `EPIPE`, ID inseguro, aba ambígua e erro sanitizado;
  - backup/rascunhos;
  - gate real do Claude: `claude-permission-mcp.mjs` via stdio + `createRuntimeActionApprovals` real (create automático; delete/outro arquivo expiram; mudança de preferência negada; sem binding, sem prompt Paper; editor sem Paper e sem gate).
- Mutações conferidas: remover a checagem de `fileId` ou a de hash faz os testes falharem.
- Suítes relacionadas: 40/40. `tsc -b` limpo.
- `npx electron scripts/test-paper-agent-ui.mjs`: PASS. O cenário:
  1. conecta usando o inspetor real com CLI roteirizado;
  2. salva arquivo, assinatura e estilo;
  3. aplica a concessão pelo binding real (create aceito, delete e outro arquivo pendentes);
  4. reinicia e mantém a configuração;
  5. conecta outro arquivo, o que desliga a concessão;
  6. restaura um rascunho incompleto de agente novo;
  7. faz capturas em 1440 px e 390 px, sem rolagem horizontal.

## Instalação 0.3.63

- `npm run build` → `build-remotion-video --release` → `check-build-files` (88 módulos) → `electron-builder --win nsis --publish never` em `release/r63` → `check-desktop-release`.
- Instalador `MainsAgents-Setup-0.3.63.exe`, sha256 `53c854ce…ac69b797`. `app.asar` `e7820375…08c44e20a`. `paper-design.mjs`/`paper-desktop.mjs` e o bundle novo da UI estão no asar.
- Antes de instalar: app fechado, `activity` ocioso, snapshot e backup SQLite pela API online em `.mainsagents-workspaces/local-update-0.3.63/20261013-135950/`.
- Instalação silenciosa `/S /D=%LOCALAPPDATA%\Programs\MainsAgents`: saída 0, `ProductVersion 0.3.63.0`, hash do asar instalado igual ao recibo.
- Após abrir o app: `Main window loaded` e `nativeStorage:true`. A comparação dos snapshots mostra só `agents` alterado e 1 nova revisão em `agent_revisions`. Sessões (12), demais agentes (3) e outras bases ficaram sem mudança.

## Agente local

`criador-de-carrosseis-71023a16` (perfil ativo, `my-workspace`), via `scripts/paper-agent-setup.mjs --apply`:

- provedor `codex → claude`, com `modelId` vazio (padrão do Claude CLI do usuário);
- skills 8 → 9, com `paper-carrossel` de `Documents\Skills\CriadorDeCarrosseis\paper-carrossel\SKILL.md` (worker B), mantendo as existentes;
- `paperDesign` com `enabled=false`, `automatic=false`, sem arquivo, assinatura em branco e estilo editorial azul. O Paper liga quando o usuário conectar o arquivo aberto no editor.

Backups: `agent-setup/agent-before.json`, cópia SQLite e `carrossel-direcao-visual.md`. Não havia rascunho persistido deste agente.

## Limites e próximos passos do usuário

1. Abrir o Paper Desktop e o arquivo desejado. Em **Agentes → Criador de Carrosséis → Configurar → Paper**, clicar em **Conectar arquivo aberto no Paper**, conferir o nome mostrado e salvar. Opcionalmente, ativar a opção sem confirmações repetidas.
2. Abrir uma **nova** sessão do agente. As conversas antigas continuam ligadas ao Codex: o histórico fica legível, mas novos envios nelas são recusados pelo binding do Codex.
3. Se a conexão falhar com "Não foi possível identificar o arquivo aberto", o formato real de `get_basic_info`/`list_resources` difere do esperado. Nesse caso, ajustar o parser com a resposta real.
4. Não foi feito piloto ao vivo de criação de carrossel.

## Correções de revisão: 0.3.64 (tarefa `task_8758d3f7719e`)

1. **Edições durante a conexão.** O `setPaper` antigo usava a cópia de `paperDesign` capturada no clique. Por isso, uma conexão lenta apagava assinatura e estilo digitados enquanto ela rodava.
   - Agora todas as mudanças são mescladas ao valor **atual** (`setValues(current=>…)`), inclusive o resultado da conexão.
   - O resultado é descartado se o editor fechou ou se uma conexão mais nova começou.
   - `scripts/test-paper-agent-ui.mjs` usa um inspetor com 1,2 s de atraso:
     - a assinatura e o estilo digitados durante a espera são mantidos e salvos;
     - um resultado que chega com o editor fechado não altera o agente nem cria rascunho.
   - Mutação reintroduzindo o valor capturado no clique: o teste falha em "signature typed during the lookup kept".
2. **Instrução permanente do agente.** `scripts/paper-agent-setup.mjs` agora troca a frase obsoleta "Escrever, exportar ou apagar no Paper exige aprovação a cada chamada." por uma regra que segue as configurações salvas. Também acrescenta uma única vez o bloco "Fluxo Paper (skill paper-carrossel)", que manda ler `paper-carrossel`, dá prioridade aos parâmetros salvos e proíbe inventar assinatura, usar outro arquivo ou gerar imagens pagas.
   - O script é idempotente: com tudo aplicado, não grava nada.
   - Um `paperDesign` já salvo é mantido como está; o script nunca liga a concessão.
   - Recusa gravar com o app aberto ou com rascunho do agente; o dry-run funciona com o app aberto.
3. **Pacote e instalação 0.3.64.**
   - Build em `release/r64`: instalador sha256 `1c523bf9…910db04c5`, `app.asar` `9e3dce5d…ed2755948`, 88 módulos. O bundle novo da UI está no asar.
   - O app estava ocioso (`activity` 0) e foi fechado sem forçar (`taskkill` sem `/F`). O log registrou "Close storage verification: saved".
   - Antes de instalar: snapshot e backup online em `.mainsagents-workspaces/local-update-0.3.64/20261013-140823/`.
   - Instalação silenciosa: saída 0, `ProductVersion 0.3.64.0`, asar instalado igual ao recibo.
   - Setup aplicado com o app fechado, com backup em `agent-setup/` (SQLite, `agent-before.json`). A segunda execução respondeu "Already configured: nothing written".
   - App aberto: `Main window loaded`, `nativeStorage:true`, metadata `0.3.64`.
   - Estado do agente:
     - mudaram só `instructions` e `updatedAt`;
     - as instruções citam `paper-carrossel` e não têm mais a frase obsoleta;
     - continua com Claude, 9 skills e `automatic=false`, sem arquivo e sem assinatura;
     - 4 agentes, sem rascunhos.
   - Diff dos snapshots: só `agents` e +1 em `agent_revisions`.
   - Testes rodados: UI focada (`test-paper-agent-ui.mjs`) PASS, com a mutação conferida; `tsc -b` limpo. Nenhuma outra suíte foi rodada.
   - O Paper ao vivo continua sem validação, porque o Desktop não estava aberto.
