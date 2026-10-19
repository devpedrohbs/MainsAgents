# GPT nativo + Paper: fundos gerados para carrosséis — 2026-10-13 (worker B)

Objetivo: o mesmo agente "Criador de Carrosséis" (padrão Claude) pode abrir uma conversa GPT/Codex para gerar fundos com o
gerador de imagens **nativo** do Codex (plano ChatGPT, sem API key, sem fal/paper-gen pago), levar a imagem ao Paper como
camada de fundo substituível com textos editáveis, e entregar exportações com recibos verificados para o agendamento (A).

## Bug corrigido: provedor da sessão

`content-workflow-bridge.binding` rejeitava a sessão quando `agent.providerId` (Claude) diferia do provedor da chamada
(Codex). Uma conversa GPT aberta pelo seletor de provedor no criador perdia o vínculo: sem Paper, sem permissões MCP,
sem arquivos.

- Novo `effectiveSessionAgent(agent, session)`: o provedor vem da **sessão salva** (`session.providerId`, que o seletor
  grava), com fallback ao padrão do agente para sessões antigas. Modelo: o da sessão; o modelo Claude nunca vai para uma
  sessão Codex. Todo o resto (Paper, permissões, Notion, arquivos, skills) é a configuração salva do próprio agente.
- `binding.agent` é esse retrato efetivo; `binding.providerId` novo; o hash inclui o retrato. O agente salvo não muda
  (padrão continua Claude). Sessões Claude existentes seguem iguais.
- Retomar uma thread Codex exige que ela pertença à sessão salva (`codex-bridge` `/api/codex/sessions`).
- `sessionBinding(sessionId)` para decisões do app (cartão de agendamento).

## Transporte imagem → Paper (verificado ao vivo)

- O Paper só carrega imagem local por `<img src="paper-asset:///C:/caminho/arquivo.png">` (schema documentado do
  `write_html`). Sem data URI (limite de 64 KB da aprovação), sem URL do app (origem/token).
- O Codex já informa ao modelo onde salvou cada imagem ("Generated images are saved to … as …", campo `savedPath`). O host
  guarda uma cópia endereçada por sha256 em `~/.mainsagents/storage/images/<sha256>.png`.
- O Paper **copia** a imagem para o próprio arquivo (`backgroundImage: url(https://app.paper.design/file-assets/<fileId>/…)`,
  `cover`): o fundo sobrevive à limpeza local e é trocado com um `update_styles`. Limitação: a imagem vai para o armazenamento
  do Paper do usuário (nuvem do Paper).
- `paper-image-assets.mjs` (novo): `paperAssetUrl`, `paperAssetReferences` (todas as grafias, inclusive escapes; marca
  `complete=false` quando algo não é legível), `createVerifiedImageIndex` (só aceita a cópia do host ou o arquivo da pasta
  `generated_images` do Codex cujo conteúdo bate com uma cópia do host), `paperImageInstructions` (prompt das sessões Codex
  com Paper ativo).
- Política (arquivo de A, `paper-design.mjs`): com a produção automática, `write_html` com `paper-asset://` só é automático
  se o verificador do host aprovar todos os caminhos; o host liga `setPaperAssetVerifier(imageIndex.verify)`.

## Recibos reais de imagens e exportações

- Novas fontes de recibo: `generated-image` e `paper-export` (`delivery-receipts.mjs`, `Chat.ts`).
- Formato real do resultado do `export` do Paper (verificado):
  `{"exports":[{"nodeId":"3Z-0","filePath":"C:\\Users\\pacas\\Downloads\\Teste 01 — Fundo GPT.png"}]}` (+ bloco de cabeçalho
  `{file:{id,name},contentHash}`). O Paper nomeia pelo nome do artboard em Downloads e sobrescreve nomes iguais; o recibo é
  por sha256 e `receipts.check` acusa `changed`.
- `paperExportFiles` lê só essa estrutura (nunca texto livre). `captureExport` só grava para o `fileId` salvo do agente,
  em ordem da chamada (`nodes`), com `assetId=nodeId`, `versionId=fileId`.
- Captura: Codex por `item/completed` (`imageGeneration` e `mcpToolCall` paper/export); Claude pelo `tool_result` da chamada
  aprovada (argumentos lidos da ação aprovada, não do modelo).
- Acesso para o agendamento (A): `sessionExports` recebe **só o último lote** verificado:
  `[{path,sha256,order,nodeId,fileId,callId,receiptId}]`. Rotas: `GET /api/content/paper-exports?session=`.

## Agendamento pelo chat (contrato de A, integrado por B)

- `createChatPublishing` criado no `content-workflow-bridge` com o executor real.
- Codex: `mainsagents_schedule_post` em `dynamicTools` (threads novas, se o agente permite `schedule`); `item/tool/call` →
  `chatPublishing.call(binding do host, …)`. `account_context` liberado no MCP `publora` nativo.
- **Retomada verificada:** o app-server só aceita `dynamicTools` em `thread/start` (schema experimental) e guarda a lista no
  `session_meta.dynamic_tools` do rollout. Uma thread antiga nunca ganha a ferramenta. O host lê a lista real da thread
  (`threadDynamicToolNames`) e só então anexa as instruções; numa thread antiga o modelo é instruído a pedir uma conversa
  nova do mesmo agente, sem fingir que agendou.
- Claude: servidor MCP `mainsagents_publishing` (papel `publishing` do `claude-permission-mcp.mjs`, loopback com o token da
  execução), liberado no gate sem segunda aprovação; instruções de A no prompt.
- Rotas: `GET /api/content/chat-publishing?session=`, `POST /api/content/chat-publishing/:id/decision {hash,decision}`.

## Piloto real (autorizado)

1. **Geração nativa** pelo `startCodexBridge` do repo, runtime temporário isolado com o login ChatGPT existente (conta
   `chatgpt`, sem API key): item `imageGeneration` concluído, `savedPath` da CLI e cópia do host idênticas — PNG 1122×1402,
   2.337.856 bytes, sha256 `27a3a581722319a43fefe33ac87d48a15b11719b4833c8de431d909c977e688f`. A CLI não expõe o ID do modelo
   de imagem; nenhum é declarado.
2. **Paper**, arquivo "Joyful olive": brief publicado antes (humor *signage*, `#F4C63D`/`#E2AE24`/`#141414`, Inter 800 /
   Instrument Serif Italic / JetBrains Mono). Uma página nova "Teste — Fundo GPT nativo" com um artboard 1080×1350; o
   carrossel de 9 slides só foi lido. Fundo como camada "Fundo gerado (GPT)", textos em camadas de texto. Screenshot revisado,
   uma correção (texto sobre o traço preto), `finish_working_on_nodes`.
3. **Exportação** real: `C:\Users\pacas\Downloads\Teste 01 — Fundo GPT.png`, 1080×1350, 2.595.080 bytes, sha256
   `2e8fa45555725d58ddaea64e3c8f6871ffa8e2303a8718d2cd37c2ceb7782f9a`.

## Carrossel original (9 slides) — recibos sem reexportar

A exportação original (ação `8a3ee009…`, aprovada e concluída, sessão `session-mv71fzdn-0whx`, thread Claude `7767d1d7…`)
tem o `tool_result` real na transcrição da CLI. `scripts/paper-export-backfill.mjs` cruza ação (hash dos argumentos) ↔
`tool_use`/`tool_result` ↔ sessão/agente/provedor/thread/arquivo Paper salvos ↔ datas dos arquivos dentro da janela da
chamada, e emite os recibos com a mesma chave da captura ao vivo. Dry-run: 9 arquivos na ordem 01→09 (o resultado listava
fora de ordem). Nenhum arquivo do usuário é reescrito.

## Skill

`Documents\Skills\CriadorDeCarrosseis\paper-fundos-gpt\SKILL.md` (nova, independente; skills existentes não editadas).

## Testes

`tests/paper-gpt-provider-binding.test.mjs`, `paper-gpt-image-transport.test.mjs`, `paper-gpt-receipts.test.mjs`
(sessão Codex sob agente Claude, legado, autoridade por agente/sessão/perfil, grant do Paper pela aprovação real, só imagem
verificada automática, formato real do export, ordem, perfil/arquivo errados, notificações Codex reais, papel MCP Claude,
leitura das ferramentas da thread). `npm test` 654/654 antes dos ajustes finais; `tsc -b` limpo.

## Pacote e instalação 0.3.66 (A + B combinados)

- `package.json`/lock 0.3.66; `tsc -b` limpo; `check-build-files` 92 módulos, nenhum faltando (`chat-schedule-intent.mjs`
  de A estava fora da lista e foi incluído).
- Pacote em `release/r66-final` (não `release/r66`: o Orca, pid 3260, mantém aberto o `app.asar` de um build anterior não
  instalado em `release/r66`; o Orca não foi fechado). Instalador `MainsAgents-Setup-0.3.66.exe` sha256
  `f52583961cc3a31bbf8ca42f1c629bc3afee12cdf00f90f2ff7be08469546e80`, `app.asar` `d687c7bfd6956db8eac18b1cfe94959f7f23b3c1c69bfcc0d4eb9060a09a111f`,
  `check-desktop-release` OK. Os 13 módulos alterados no asar são idênticos às fontes.
- App fechado e ocioso (`activity`: nada ativo), sem fechamento forçado. Snapshot + backup online em
  `.mainsagents-workspaces/local-update-0.3.66/20261013-171454/` (9 SQLite íntegros, storage, skills, runtime).
- `/S`: saída 0, `ProductVersion 0.3.66.0`, asar instalado = recibo.
- Configuração (app fechado, cada passo com backup próprio e CAS):
  1. `scripts/content-autonomy-migration.mjs --apply` (A): Paper `automatic=true`, `publishingAutomation`
     `{enabled:true,provider:'publora',timeZone:'America/Sao_Paulo'}`, 4 frases de skill; reexecução "Already configured".
  2. `scripts/paper-gpt-skill-setup.mjs --apply`: skills 9 → 10 (`paper-fundos-gpt`); só `skills`/`skillFiles`/`updatedAt`.
  3. `scripts/paper-export-backfill.mjs --action 8a3ee009… --apply`: 9 recibos `paper-export` 01→09 na sessão
     `session-mv71fzdn-0whx`; reexecução não duplica. (Uma primeira tentativa caiu com segfault do `backup()` do node:sqlite
     com o handle de origem não referenciado; nada foi escrito; corrigido mantendo o handle até o fim.)
- Agente final: provedor padrão Claude, Paper "Joyful olive" automático, 10 skills, 4 agentes, 13 sessões, 0 rascunhos.
- `~/.mainsagents/storage/startup.log`: `version=0.3.66`, `Codex bridge ready`, `nativeStorage:true`, `Main window loaded`.
- Diff de snapshots: `agent_revisions` 11→13, `delivery_receipts` 0→9, tabelas novas de agendamento vazias, agentes e skills.
  Sessões e estado editorial inalterados. Nenhum post real criado.

## Como usar

- **Fundos com GPT:** no Criador de Carrosséis, "Nova conversa" → escolher GPT/Codex. A conversa usa o mesmo arquivo Paper,
  estilo e skills; peça, por exemplo, "gere um fundo abstrato amarelo para a capa e coloque no Paper". As conversas Claude
  continuam iguais (Claude não gera imagem).
- **Agendar o carrossel original:** na conversa Claude original, diga a rede, a data e a hora (por exemplo, "agende no
  Instagram amanhã às 18h"). Os 9 slides com recibo verificado são a fonte e a ordem. Plano Starter da Publora: horizonte até
  2026-10-20.

## Limitações

- Conversas Claude não geram imagem (sem ferramenta nativa); é preciso uma conversa GPT do mesmo agente.
- Threads Codex antigas não ganham a ferramenta de agendamento; conversa nova necessária.
- A cota de imagens é a do plano ChatGPT; falha/limite é mostrado como `image.failed` real.
