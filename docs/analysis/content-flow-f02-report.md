# F02 — Pacote de gravação (report)

Status: componente e helpers criados e testados isoladamente. **Não conectado** a ProductionDialog, rotas ou coordinator (dono: Opus ctx_6af551e8bc3f).

## Arquivos novos
- `src/features/production/recordingPackage.ts` — helpers puros.
- `src/components/production/RecordingPackage.tsx` + `recording-package.css`.
- `tests/recording-package.test.mjs` (4 testes, passam com `node --experimental-strip-types --test`).

## Import / props
```ts
import {RecordingPackage} from '../production/RecordingPackage';
<RecordingPackage run={run} pt={pt} busy={busy} ready={extraGate}
  checklist={storedChecklist} onChecklistChange={persist} onImportVideo={pickVideo}
  onSuggestionsChange={(version,hash,list)=>…} />
```
- `run`: forma F01 (`scriptVersions`, `scriptApproval`, `notion`); estrutural, não importa `model.ts`.
- `checklist`: `{version,hash,items:{framing,light,audio,product}}` guardado pelo chamador; se version/hash diferem do pacote, é ignorado (reset).

## Comportamento
- Gate (`recordingGate`/`recordingReady`): última versão = aprovada, hash igual e Notion com mesma version/hash. Falha mostra motivo (pt/en) e não renderiza pacote.
- Mostra fala aprovada, hook/CTA, cenas só de `path.outline`, improviso, thumbnail.
- Sugestões de B-roll/material: campos editáveis vazios por cena, rotulados "sugestão"; nada factual é gerado. Edições zeram ao mudar version/hash.
- Checklist (enquadramento/luz/áudio/produto) com progresso `n de 4` + `<progress>`; **não** bloqueia "pronto para gravar".
- Importar vídeo é botão explícito; desabilitado se `busy` ou gate falso. Sem câmera/teleprompter.
- Acessibilidade: fieldset/legend, labels, `role=status`, foco visível, teclado nativo; mobile via media query (sem screenshot).

## Pendente para integração
- Wire em ProductionDialog (stage `recording`), persistência do checklist por callback, ação de import.
- Tipos F01 reais podem substituir `RecordingRunInput` quando existirem em `model.ts`.
- Typecheck global e build não rodados (fora do escopo).
