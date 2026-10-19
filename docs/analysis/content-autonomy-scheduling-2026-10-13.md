# Autonomia de conteúdo e agendamento pelo chat — 2026-10-13 (worker A)

## Diagnóstico (somente leitura)

- **Aprovações repetidas no Paper:** o agente `criador-de-carrosseis-71023a16` tem `paperDesign.enabled=true`, `automatic=false` (arquivo `01M4V841P4WXN0HWA5BH326JKM`, "Joyful olive"). Com `automatic=false`, toda chamada `write_html`/`create_artboard`/`get_screenshot`/`export`… vai para a revisão por chamada. A política já existia; faltava a preferência salva e ela ainda deixava `write_html replace` e `set_tokens` por chamada.
- **"Não há agendador":** falso para o app. A rota nativa do app (Codex app-server do runtime `%APPDATA%\mains-agents\codex-runtime`, MCP `publora` em `https://mcp.publora.com`, OAuth) foi verificada com `list_connections` e `account_context` pelo **mesmo mecanismo** de `codex-bridge.publicationMcp` (thread efêmero + `mcpServer/tool/call`): contas ativas `instagram-17841438149153192` (@eupacass) e `linkedin-aRfulrFZ5P`; plano Starter: 3 agendamentos ativos, horizonte de 7 dias (até 2026-10-20T23:59Z), 15 posts/mês. O conector claude.ai Publora mostra as mesmas contas. O `publora` local do Claude CLI ("Needs authentication") é outra conexão e não é usado pela rota nativa. Nenhum token foi copiado.
- Bloqueios reais antes desta mudança: (1) o executor nativo aceitava Publora só para LinkedIn; (2) nenhum chat (Claude ou Codex) tinha ferramenta para chegar ao executor; (3) skills diziam que agendar sempre exige aprovação separada.
- Pedido pendente do usuário ("Agora vamos agendar para postar", sessão `session-mv71fzdn-0whx`): sem rede, conta, data e hora. **Nada foi agendado.** As 9 exportações existem em `C:\Users\pacas\Downloads\01 Capa.png … 09 CTA.png` (Instagram aceita 1–10 imagens).

## O que mudou (A)

| Arquivo | Mudança |
|---|---|
| `paper-design.mjs/.d.mts` | Produção automática cobre também `write_html` `replace` e `set_tokens` no arquivo escolhido; imagens locais `paper-asset://` só automáticas se o verificador do host (B) aprovar todas (`setPaperAssetVerifier`, `paperAssetReferences`). `delete_nodes`, outro arquivo, vídeo, `paper-gen://` e operações desconhecidas continuam por chamada. Texto do prompt: "não peça aprovação desses passos"; imagens GPT pedidas → `<img src="paper-asset:///…">`. |
| `publishing-automation.mjs/.d.mts` (novo, seguro para o navegador) | Preferência por agente `publishingAutomation {enabled, provider:''|'publora'|'zernio', timeZone}`; validação; `withoutPublishingAutomation` (backup/import desliga); leituras automáticas de contas/posts Publora/Zernio com a preferência; `publishingInstructions(agent)` para o prompt. |
| `chat-publishing.mjs` (novo) | Serviço `mainsagents.chat-publishing/1` + ferramenta `mainsagents_schedule_post` (abaixo). |
| `publication-model.mjs`, `publication-connector.mjs`, `editorial-publication-execution.mjs` | Publora também para Instagram (contas `instagram-*`), verificação da plataforma do post, **ordem das mídias** conferida na leitura, `limits()` via `account_context`, mensagens genéricas de conta. |
| `runtime-tool-policy.mjs` | `create_post`/`update_post` classificados pelos argumentos (`publishNow`→publish, `scheduledTime`/`status:scheduled`→schedule, senão write); `account_context` é leitura. |
| `runtime-action-approvals.mjs` | Preferências salvas (Notion, Paper, agendamento) decidem chamadas ao vivo; auditoria `approvalSource` `paper-preference`/`notion-preference`/`publishing-preference` + `automaticReason`. |
| `Agent.ts`, `agentDrafts.ts`, `backupFormat.ts` | Campo `publishingAutomation`; rascunhos validam; backups/imports chegam com Paper automático **e** agendamento desligados. |
| `AgentEditorDrawer.tsx` | Nova seção "Agendamento" (opção, serviço, fuso, ajuda precisa); textos de Paper e Permissões MCP corrigidos. |
| `scripts/content-autonomy-migration.mjs` | Migração do agente real + skills (dry-run padrão; `--apply <backup-dir>` com app fechado, backup do SQLite/skills/agente, CAS). **Não executada em modo apply.** |
| `tests/autonomous-scheduling.test.mjs`, `tests/paper-design.test.mjs` | Testes focados (abaixo). |

## Autoridade (o que dispensa confirmação)

- **Paper:** preferência salva `paperDesign.automatic=true` + `fileId` igual ao argumento da chamada; reavaliada no momento da chamada contra o agente salvo (`resolveBinding`). Nunca vem do modelo.
- **Agendamento:** `publishingAutomation.enabled=true` (preferência salva) **e** uma mensagem do próprio usuário nesta sessão pedindo para agendar/postar (lida do store pelo host, não dos argumentos) **e** legenda + arquivos já mostrados no chat (ou recibos de exportação verificados do host). Faltou algo → **um** resumo para confirmar (no chat: nova mensagem do usuário "sim/confirmo/pode agendar…" depois do resumo; ou cartão do app via `decide`). O modelo nunca confirma por si.
- Um pedido = um agendamento por rede (`request_key = hash(sessão, mensagem do pedido, rede)`); repetir devolve `already-scheduled`. Resultado incerto vira `uncertain` e nunca é reenviado. Publicar agora, apagar, alterar outros posts e outras contas não fazem parte.

## Revisão pós-review (dispatch ctx_9831b60b9437): autoridade por pedido real

- `chat-schedule-intent.mjs` (novo, sem biblioteca de NLP): classifica cada mensagem do usuário em `request | cancel | question | confirm | details | other`, ignorando texto citado (aspas, `>`, blocos de código), e extrai fatos numa gramática pequena pt-BR/en: rede (Instagram/insta/ig, LinkedIn, TikTok), `@conta`, data (hoje, amanhã, depois de amanhã, dia da semana, `dd/mm[/aaaa]`, `aaaa-mm-dd`, `dia N`) e hora (`18h`, `18h30`, `18:30`, `às 18`, `6pm`, meio-dia, meia-noite, "da tarde/noite"), sempre relativos à data local da própria mensagem no fuso salvo.
- `resolveIntent` percorre as mensagens em ordem: um pedido positivo abre a intenção; respostas sem verbo (`Instagram amanhã às 18h`, `amanhã às 18h`) somam fatos; `não agende ainda`/cancelar/esperar fecha e a ferramenta responde `stopped` (sem pedir confirmação); pergunta de status/capacidade, nova tarefa ("faz outro carrossel…", "corrija…") ou mensagem não relacionada fecha; expira em 24 h.
- Com a preferência salva, **rede, data e hora precisam ter sido ditas pelo usuário**; data/rede/conta do modelo nunca preenchem autoridade ausente (data faltando → `needs-input` pedindo só a data; rede diferente da pedida → `needs-input`). Conta: `@handle` dito, ou a única conta conectada da rede; escolha do modelo vira resumo para confirmar.
- Intenção persistida (`chat_publication_intents`) ligada ao hash do material (sha256 em ordem) na primeira chamada; outro carrossel ou arquivos modificados depois do pedido → resumo para confirmar (ou novo pedido do usuário, por exemplo "agende a versão atualizada…").
- Duplicatas: chave por (sessão, mensagem do pedido ou hash do material, rede); além disso, o mesmo material na mesma rede já enviado nesta sessão não é reenviado salvo novo pedido posterior. Repetir a chamada ou mudar argumentos devolve `already-scheduled`/`uncertain`.
- Confirmação de resumo no chat: a última mensagem do usuário depois do resumo precisa ser `confirm` ou `request`; "não…" marca `denied`; confirmar um resumo aposenta os outros pendentes da sessão.
- Correção final (ctx_28f041c37715): aspas simples ASCII também contam como citação (contrações como don't não); `@conta` só fora de citações; AM/PM tem prioridade (`6:00 PM` = 18:00, `12:00 AM` = 00:00); pedido educado completo ("Você pode agendar este carrossel no Instagram amanhã às 18h?") é pedido; pergunta de capacidade/status/tutorial continua sem autorizar.
- Antecedência mínima = a do executor (2 min; ele confere de novo após o upload), não mais 15 min.
- `paper-design.mjs`: `paperAssetReferences` decodifica entidades HTML e escapes unicode, preserva caminhos POSIX, e uma menção a paper-asset que não vira caminho falha fechada.

Achados do revisor C (`content-autonomy-review-2026-10-13.md`) resolvidos nesta rodada:
- #1–#3 (negação/pergunta/cancelamento, data/conta/fuso do modelo, intenção velha para outra rede ou carrossel): pela intenção acima; o fuso automático é sempre o salvo.
- #4 confirmação: "pode cancelar…" → `denied`; "isso não", "ok, mas mude a hora" não confirmam (ressalva, negação ou pedido de mudança nunca contam como "sim").
- #5 origem e ordem dos arquivos: o **último lote de exportação verificado pelo host** (`sessionExports`) é a fonte e a ordem canônicas; arquivos fora dele, em outra ordem ou com outro hash viram resumo para confirmar. Caminho citado pelo assistente não prova nada; sem lote, só arquivos que o próprio usuário enviou no chat contam.
- #6 leituras por outros conectores: a preferência de agendamento não aprova mais nenhuma chamada MCP (claude.ai Publora, publora/zernio do CLI podem ser outra conta); contas e status vêm de `mainsagents_schedule_post` `accounts`/`status`, mesmo transporte das escritas.

**Para B (necessário):** empacotar `chat-schedule-intent.mjs` e passar ao `createChatPublishing` `sessionExports:(profile,sessionId)=>[{path,sha256},…]` = o último lote de exportação Paper verificado da sessão, **na ordem dos slides** (ex.: `ledger.exports(profile,{sessionId}).latest.files`). Sem isso, o agendamento automático só acontece com arquivos que o usuário colou no chat; nos demais casos o usuário confirma um único resumo. Nenhuma outra mudança de contrato.

## Contrato `mainsagents.chat-publishing/1` (para B integrar)

```js
import {createChatPublishing,scheduleTool} from './chat-publishing.mjs';
import {publishingInstructions} from './publishing-automation.mjs';
const chatPublishing=createChatPublishing(editorialDb,{
  getCurrentProfile, getAgents, getSessions,          // store do host
  execution,      // a MESMA instância createPublicationExecution do content-workflow-bridge
  publications,   // createEditorialPublications(editorialDb)
  sessionExports:(profile,sessionId)=>[{path,sha256}], // opcional: recibos 'paper-export' verificados (B)
});
// Resposta para o modelo: {success:boolean, content:string(JSON com state)}
await chatPublishing.call(binding,args,{executionId,callId});
await chatPublishing.decide(binding,{requestId,hash,decision:'approve'|'deny'}); // cartão do app
chatPublishing.list(profile,sessionId);
```

- `binding` = o mesmo de `runtime-action-approvals` (`{profileId,agentId,sessionId,workspaceId,agent}`); o serviço relê agente e sessão do store.
- `args` = `scheduleTool.inputSchema`: `action: accounts|schedule|status`, `platform: Instagram|LinkedIn|TikTok`, `provider?`, `accountId?`, `caption`, `files` (1–20 caminhos absolutos em ordem), `scheduledAt` (`YYYY-MM-DDTHH:mm` local), `timeZone` (IANA; padrão da preferência), `title?`, `confirmRequestId?`.
- Estados devolvidos: `needs-input` (+`missing`, `accounts`), `blocked` (auth/limite/permissão, com ação concreta), `awaiting-confirmation` (+`requestId`,`hash`,`summary`), `scheduled` (+recibo verificado), `already-scheduled`, `failed` (nada enviado), `uncertain` (não repetir), `expired`, `denied`.
- **Codex (B, `codex-bridge`)**: incluir `scheduleTool` em `dynamicTools` para agentes Claude/Codex cujo `mcpPermissions` permite `schedule`; `item/tool/call` com `tool==='mainsagents_schedule_post'` → `chatPublishing.call(resolveBinding(threadId),params.arguments,{executionId:params.turnId,callId:params.callId})`, responder `{success,contentItems:[{type:'inputText',text:content}]}`; anexar `publishingInstructions(binding.agent)` ao texto do turno, como `paperDesignInstructions`. Liberar `account_context` em `publicationMcp` (lista `allowed` de `publora`) — sem isso o serviço bloqueia com "Could not read the publora plan limits" (falha segura).
- **Claude (B, `claude-code-bridge` + `claude-permission-mcp`)**: papel MCP `publishing` (servidor `mainsagents_publishing`) com `tools/list=[scheduleTool → {name,description,inputSchema}]`, encaminhando `{name,arguments}` ao endpoint por execução, como o papel `editor`; a ponte chama `chatPublishing.call(binding,args,{executionId,callId:toolUseId})`. Pré-permitir `mcp__mainsagents_publishing__mainsagents_schedule_post` (a autoridade é aplicada dentro do serviço). Anexar `publishingInstructions(agent)`.
- **App (B)**: `GET /api/chat-publishing?sessionId=` → `list`; `POST /api/chat-publishing/:id/decision {hash,decision}` → `decide`. Empacotar `chat-publishing.mjs` e `publishing-automation.mjs` (lista explícita `files` do `package.json`). Paper: `setPaperAssetVerifier(index.verify)` no processo que avalia aprovações.

## Configuração real (B aplica após a instalação final)

```
node scripts/content-autonomy-migration.mjs                 # dry-run (verificado: 4 patches de skill, paper false→true, publishing null→{enabled:true,provider:'publora',timeZone:'America/Sao_Paulo'})
node scripts/content-autonomy-migration.mjs --apply <dir>   # MainsAgents fechado; backup + CAS
```

Recusa se o app estiver aberto, se houver rascunho não salvo do agente ou se o Paper não estiver no arquivo `01M4V841P4WXN0HWA5BH326JKM`. Frases de skill editadas pelo usuário não são sobrescritas (relatadas como `edited-by-person`).

## Testes executados

`node --test tests/autonomous-scheduling.test.mjs` (16 após a correção final) — executor real (`createEditorialPublications` + `createPublicationExecution` + `createPublicationConnector`) com conector Publora de fixture: coleta única do que falta, agendamento em ordem sem aprovações intermediárias e recibo verificado, sem duplicata no segundo pedido, falha de auth com ação concreta e zero envios, confirmação única sem preferência (e nunca pelo modelo), material não mostrado não é enviado automaticamente, horário passado, create incerto nunca repetido, limite de 10 imagens do Instagram, horizonte/vagas do plano, backups sem a concessão. Mais os testes existentes que tocam os módulos alterados (147 no total, 0 falhas) e `tsc -b`.

## Pendências

- B: integrar hosts/empacotamento conforme o contrato; liberar `account_context`; aplicar a migração após a instalação final.
- Usuário: informar rede (Instagram @eupacass ou LinkedIn), data/hora (até 2026-10-20 no plano Starter) para o carrossel "Marca com o Claude". Nenhum post real foi criado nesta tarefa.
