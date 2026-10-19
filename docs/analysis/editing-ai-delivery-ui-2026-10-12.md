# Entrega de arquivo da edição — QA real Electron/React (2026-10-12)

Owner: worker D (task_dffbdcec1480). Escopo exclusivo: `scripts/test-editing-delivery-ui.mjs`, este documento e as evidências em
`.mainsagents-workspaces/editing-delivery-ui/`. Nenhum componente, pacote, core ou script existente foi alterado; nenhum build,
pacote, instalação, commit ou publicação foi feito por D.

## O que o runner prova

| Superfície | Verificação |
| --- | --- |
| Recibo do host | Recibo emitido pelo **registry real** (`content-workflow-bridge` → `delivery-receipts.mjs`, SQLite descartável) sobre um vídeo **real** gerado por FFmpeg na pasta de QA; sha256 recalculado de forma independente; tamanho, versão 1, `production-video`, `producedBy` = Editor de Vídeo / `claude`. |
| Chat de origem | `.delivery-receipt` com nome completo, caminho absoluto completo (texto e `title` idênticos ao recibo, sem corte), `v1 · <tamanho>`, prefixo do SHA-256 e "direção Editor de Vídeo (Claude Code)". Só um recibo visível. |
| Chat do editor | Mesmo recibo (mesmo `id`) e os mesmos campos visíveis. |
| Copiar caminho | `navigator.clipboard` substituído no main world: grava exatamente `receipt.path`; o clipboard do sistema (`electron.clipboard`) não é tocado. |
| Abrir / Mostrar na pasta | Passam pelo IPC real `receipts:open`/`receipts:reveal` (re-verificação no host); o `shell` é um mock que só registra `openPath`/`showItemInFolder` com o caminho do recibo. Nada abre no Explorer/player. |
| Bytes alterados | O cartão mostra "O arquivo mudou depois da entrega.", Abrir/Mostrar ficam desabilitados e uma chamada forçada ao IPC é recusada (`changed after delivery`) sem chamar o shell. |
| Arquivo movido | O cartão mostra "O arquivo foi movido ou removido.", ações desabilitadas, `reveal` forçado recusado; o arquivo volta ao lugar e o hash original é conferido. |
| Sem recibo | Uma conversa que *afirma* ter exportado `C:\Users\qa\Videos\entrega-inventada-final.mp4` não mostra cartão de entrega, nem "Verificado pelo app", e o registry não tem recibo para esse caminho. |
| Export de mídia (`ContentMediaEditor .media-job`) | Export **real** de 1,5 s pelo motor de mídia (FFmpeg) a partir de um vídeo-fonte do conteúdo; recibo `media-export` do host = bytes exportados (hash independente), arquivo novo (original intacto); o cartão mostra nome/caminho completo/`v2 · tamanho`/SHA (sem diretor, export manual); copiar/abrir usam o caminho do recibo. Sem superfície no bundle: `not-implemented` (opcional; fatal com `--require-media-export`). |
| Entrega manual (`FileDeliveryCard`) | Mensagem `{"kind":"files"}` do agente: antes de conferir mostra só o NOME (`A verificar`, nenhum `.delivery-receipt-path`, o caminho do agente nunca aparece como entregue); após "Conferir e salvar entrega" → "Salvar entrega" mostra o caminho absoluto da versão verificada, `v1`, e copiar/"Abrir mídia" usam esse caminho (shell mock). |
| Invariantes | Nenhum turno enviado a provedor, nenhum diálogo/shell/navegação/`window.open` real, nenhum `alert/confirm/prompt`, nenhum erro React. |

O que é simulado (declarado no relatório): as mensagens dos turnos do LLM que entregam o arquivo (fixtures de sessão de chat de
origem e de editor carregando o recibo real, e a mensagem de entrega manual), saúde/modelos dos provedores Codex e Claude
(`/api/codex/*`, `/api/providers/claude/{status,models}` com contrato válido; qualquer turno de chat é recusado e contado),
clipboard, shell e diálogos. O pipeline de edição
(handoff → ferramentas do editor → export → registry) é coberto pelos testes do motor de C e não é repetido aqui.

## Uso

```sh
# fontes do checkout + ./dist atual
npx electron scripts/test-editing-delivery-ui.mjs
# módulos e UI do release empacotado (lê <asar>/dist por padrão)
npx electron scripts/test-editing-delivery-ui.mjs --asar release/win-unpacked/resources/app.asar
```

| Flag | Env | Padrão |
| --- | --- | --- |
| `--asar <app.asar>` | `MAINSAGENTS_DELIVERY_ASAR` | modo source (módulos do checkout) |
| `--dist <dir>` | `MAINSAGENTS_UI_DIST` | `./dist` (source) ou `<asar>/dist` (asar) |
| `--out <dir>` | `MAINSAGENTS_DELIVERY_OUT` | `.mainsagents-workspaces/editing-delivery-ui/<modo>-<timestamp>` |
| `--require-media-export` | `MAINSAGENTS_DELIVERY_REQUIRE_MEDIA_EXPORT=1` | superfície media-export opcional |

Saída: stdout `EDITING_DELIVERY_UI_OK (<modo>): n/m checks` (exit 0) ou `EDITING_DELIVERY_UI_FAIL (<modo>): <motivo>` (exit 1);
`report.json` (checks, recibo, chamadas de shell, interceptações, superfície media-export) e PNGs 1600×1000 via `captureReadyPng`.
Toda escrita/movimentação é recusada fora da pasta de saída (que precisa estar no workdir ou no temp). Requer `ffmpeg` no PATH.
Falhas de preparação (UI sem `DeliveryReceiptCard`, asar ausente, ffmpeg ausente, recibo recusado) encerram com o mesmo marcador.

## Resultados

### Ensaio com o build anterior (antes do dist de C)

- `dist/` de 2026-10-11 e `release/win-unpacked/resources/app.asar` (0.3.61): **FAIL esperado** — o bundle não contém o
  `DeliveryReceiptCard` (`delivery-receipt-path` ausente). Antes do pré-check, o mesmo dist mostrou a mensagem de entrega sem
  cartão de recibo (evidência `dryrun-old-dist/failure.png`); as checagens de recibo do host e "sem recibo" passaram.

### Execução final

| Modo | Módulos | UI | Resultado | Evidência |
| --- | --- | --- | --- | --- |
| source | checkout | `dist/` (bundle `versions/13a56b63b4a7cac4`, build de C) | **EDITING_DELIVERY_UI_OK 50/50** | `.mainsagents-workspaces/editing-delivery-ui/source-1791855110323/` |
| asar | `release/r62/win-unpacked/resources/app.asar` (0.3.62, sha256 `3a59b825…a536a559`) | `<asar>/dist` | **EDITING_DELIVERY_UI_OK 50/50** com `--require-media-export` | `.mainsagents-workspaces/editing-delivery-ui/asar-1791855140464/` |

Cada pasta tem `report.json` (50 checks, recibos, chamadas ao shell mock, 0 interceptações reais, 0 erros de console) e 9 PNGs
1600×1000 (`01` sem recibo, `02/03` chat de origem e ações, `04` chat do editor, `06` alterado, `07` movido, `08` export de
mídia, `09/10` entrega manual antes/depois). As linhas `Error occurred in handler for 'receipts:open'/'receipts:reveal'` no
stdout são as recusas esperadas das chamadas forçadas com arquivo alterado/movido.

### Achados

- **Mock, não app**: o primeiro run travou no chat do editor (tela branca, `TypeError … reading 'find'` em `models.find`)
  porque o servidor falso respondia `{}` em `/api/providers/claude/models`. Corrigido só no mock (contrato `{models:[]}` igual ao
  `claude-code-bridge`). O backend real sempre devolve `models`; um guard no `ChatPanel` seria defensivo, não obrigatório.
- **Observação (não bloqueante)**: um `DeliveryReceiptCard` já aberto não re-verifica sozinho; o estado (alterado/movido/
  disponível) só atualiza quando o chat é reaberto. As ações continuam seguras porque o host re-verifica a cada abrir/mostrar.
- O export de mídia aparece como `v2` porque o mesmo conteúdo já tinha o recibo `v1` do vídeo final (bytes distintos no mesmo
  escopo), comportamento esperado do registry.
