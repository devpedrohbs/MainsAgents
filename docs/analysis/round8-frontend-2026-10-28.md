# Rodada 8 — frontend de Referências de edição (2026-10-28)

Tarefa: `task_07920b54b7d6` (dispatch `ctx_ce20a972342b`). Implementação real da Rodada 8 (artefato https://claude.ai/artifact/1TwZHfoiDYfHW8ELGNnhas, versão 1793206191-66bc) sobre o contrato do Codex (`src/features/references/api.ts` + `model.ts`). Sem commit, push, instalador ou build no `dist` padrão.

## O que existe agora

**Destino novo "Referências de edição"** (`#references`, item da barra lateral logo após Estúdio, rótulo PT/EN e breadcrumb traduzido) com três seções. A seção ativa fica lembrada.

1. **Referências** (`ReferenceLibrary`)
   - Pastas e subpastas: criar, renomear, criar subpasta.
   - Excluir pasta: as referências vão para "Sem pasta" e o aviso oferece **Desfazer**, que chama `folder.restore` com o `undoId`.
   - Filtros: "Todas", "Sem pasta", pasta com subárvore, tags e situação.
   - Busca em título, tags e notas.
   - Mover entre pastas pelo próprio card.
   - Faixa "N aprendizados esperando revisão" que leva direto à referência pendente.
   - Estado vazio com convite.
2. **Adicionar** (`AddReferencePanel`, painel lateral)
   - Vídeo: o host abre o seletor e guarda uma cópia gerenciada via `importReferenceVideos`; título, notas e tags seguem depois via `reference.update`.
   - Link: guarda só o endereço via `reference.link`, com aviso de que nada é baixado e detecção de link repetido.
   - Fora do app desktop, a importação fica desabilitada e explicada.
3. **Estudo** (`ReferenceStudy`)
   - **Player real** sobre a cópia gerenciada (`referenceVideoUrl`):
     - passo de quadro pelo fps medido (sem fps, usa 1/30 s e avisa "qps não informado");
     - teclado: espaço/k, ←/→, Shift+←/→ (1 s), I/O, Home/End;
     - velocidade 0,25×–2×.
   - Trechos `wanted` / `avoid` / `note` com comentário, gravados via `reference.update` com `expectedRevision`.
   - **Cobertura honesta**: marca só os instantes `examined` e `pending` que o backend informa; o resto aparece como "Não examinado".
   - Análise:
     - escolhe entre estrutura e movimento, sobre o trecho selecionado ou o vídeo inteiro;
     - só oferece agentes com `visual:true`; sem nenhum, explica como conectar um e não mostra o botão;
     - progresso real do job, com cancelar.
   - Observações:
     - evidência por quadro (`referenceFrameUrl`, clique leva ao instante), "como adaptar" e limite;
     - **Revisar e aprovar** (texto editável + perfil) → `guideline.approve`;
     - **Só nesta referência** e **Descartar** → `observation.decide`.
   - Aviso explícito: "análise concluída não é estilo aprovado".
   - Notas, título e tags editáveis, ficha do arquivo, arquivar e restaurar.
   - Importação em segundo plano: enquanto o job `import` roda, o estudo mostra "Preparando o vídeo…" com fase, progresso e cancelar; se falhar, mostra o erro em vez de dados inventados.
   - Referência só-link: tela própria com botão para adicionar o arquivo depois.
4. **Meu estilo** (`StyleGuidelines`)
   - Perfis: criar e renomear.
   - Orientações aprovadas, com origem clicável e versão.
   - Pausar ou ativar uma orientação.
   - Editar gera nova versão, com histórico.
   - Trocar o perfil de uma orientação.
   - Escrever uma orientação própria.
5. **Kit de motion** (`MotionKit`)
   - Estado do motor HyperFrames: não preparado, verificando, preparando, pronto, incompatível ou erro, cada um com o próximo passo.
   - Estudo com spec seguro (`MotionSpec`: tipo, título, texto, formato, duração, cores), via `study.create` / `study.update`.
   - **Gerar prévia** via `study.render`. Fica bloqueado e explicado enquanto o motor não está pronto.
   - Prévia em vídeo real (`studyArtifactUrl`).
   - **Aprovar para o kit** via `kit.approve`. O kit mostra a versão imutável aprovada (`versions[]`) e avisa quando o estudo mudou depois.
6. **Integração com o Estúdio, sem lista duplicada de projetos** (`ProjectEditingKnowledge` dentro de `EditStages`)
   - Aparece nas etapas Cortes e Visual da produção que já existe.
   - O usuário marca perfis, referências e peças do kit (limites 8/4/6); o botão Salvar chama `project.attach` com `expectedRevision`, e a seleção atual vem de `snapshot.projects`.
   - "Ver o que o agente recebe" mostra o manifesto real (`editingContext`).
   - Na etapa Visual, **pedir ajuste por conversa** monta alvo (vídeo inteiro ou trecho) + pedido dentro de "O que ajustar no visual". O envio continua no `revise-video` existente: cortes, voz e duração aprovados não mudam.
   - "Usar no Estúdio" no estudo leva ao Estúdio com um aviso. A referência fica em memória e já vem pré-marcada no próximo painel aberto; nada é persistido no front.

## Dados: uma fonte só

- `useEditingReferences` é a única ponte para os dados:
  - carrega o snapshot por profile+workspace;
  - toda mutação usa `referenceCommand` com a `expectedRevision` da entidade;
  - em 409 recarrega e avisa "isso mudou em outro lugar", sem tentar de novo;
  - consulta de novo só enquanto há job ativo ou o motor está verificando/preparando.
- Uma resposta que não seja snapshot `schemaVersion:1` vira o estado "indisponível nesta versão".
- `viewModel.ts` só deriva valores do snapshot (situação, pendências, cobertura, formatação de tempo). Não há storage concorrente.
- A seção ativa usa `usePersistentState`, que é só uma conveniência de interface.

## Arquivos

- **Novos:**
  - `src/pages/EditingReferences.tsx`
  - `src/components/references/{ReferenceLibrary,AddReferencePanel,ReferenceStudy,StyleGuidelines,MotionKit,ProjectEditingKnowledge,StatusChip}.tsx`
  - `src/features/references/{viewModel.ts,useEditingReferences.ts}`
  - `src/styles/editing-references.css`
  - `scripts/test-editing-references-ui.mjs`
- **Alterados** (dentro do ownership):
  - `src/app/types.ts` (`PageId 'references'`)
  - `src/app/routes.ts`
  - `src/app/App.tsx` (renderiza a página)
  - `src/app/LanguageProvider.tsx` (breadcrumb PT)
  - `src/components/layout/Sidebar.tsx`
  - `src/components/production/EditStages.tsx` (só o painel e o compositor de ajuste)
  - `src/pages/ContentStudio.tsx` (aviso de referência pronta)
- **Não tocados:** `api.ts`/`model.ts` (Codex), backend, `.mjs` da raiz, `package.json`/lock, `stateStore`, `main.tsx`. O CSS é importado pela página e pelo painel.
- **Design:** `.mainsagents-workspaces/design-round8/` agora tem `support.js` (runtime do artefato) e `captures/*.png` renderizados para conferência.

## Verificação

- `npx tsc -b`: limpo.
- Build isolado: `vite build --outDir .mainsagents-workspaces/round8-ui-build`.
- **`scripts/test-editing-references-ui.mjs`: OK.**
  - Ambiente: renderer, preload, state store e bridge reais; vídeo de 4 s gerado com ffmpeg; motor apontado para pasta vazia; agentes sem visão; nenhuma inferência.
  - Cobre:
    - navegação real e estado vazio;
    - link salvo e tela só-link;
    - import gerenciado com título e notas aplicados;
    - player com metadata real, passo de quadro por botão e teclado, I/O e trecho "Quero aproveitar" persistido;
    - estado honesto sem agente visual;
    - análise de fixture com cobertura de 5 examinados + 1 pendente;
    - aprovar (vira orientação com origem), guardar e descartar;
    - pasta, subpasta, mover, filtro pela pasta-mãe, "Sem pasta", busca, excluir e Desfazer restaurando a hierarquia e a referência;
    - Meu estilo: aprovada, manual, pausa e edição versionada;
    - Kit: motor não preparado explicado, estudo criado com spec, prévia bloqueada;
    - `project.attach` lido em `snapshot.projects`;
    - manifesto com a orientação editada e sem a pausada;
    - larguras 880 e 360 sem rolagem horizontal, claro e escuro, inglês;
    - nenhum erro no console.
  - Capturas em `.mainsagents-workspaces/editing-references-ui/<ts>/`.
- **`scripts/test-edit-stages-ui.mjs` com `MAINSAGENTS_TEST_DIST=…/round8-ui-build`: OK.** Cortes → visual → SRT preservados, e o painel aparece nas etapas.
- `npm test`: 860/865. As 3 falhas são de backend em evolução, fora dos arquivos de UI:
  - `production-authored-edit` (`approved-editing-knowledge` no allowlist de skills);
  - MCP do editor (schemas e loop).
  - Reportadas ao Codex.

## Pendências / limites honestos

- A **renderização real** de prévia e o **preparo do motor** não rodaram neste teste: ficaram fora para evitar rede e download. A UI chama `engine.prepare` e `study.render` de verdade; o Codex relata render real 10/10 no backend.
- **Análise visual real** depende de um provedor com visão (Claude via MCP `get_frames`). Neste teste ela foi semeada no banco de fixture, sem gastar inferência.
- O painel do Estúdio foi verificado dentro do diálogo de produção real, mas o teste de edit-stages não clica nele. A gravação e a leitura (`project.attach` / `projects` / manifesto) são cobertas pelo teste de referências.
- O conjunto de frames de evidência mostra miniaturas via `referenceFrameUrl`. Na fixture não há frames, então a lista fica vazia (o caso com frames depende de uma análise real).
