# Fluxo de design e orientação — rodada de 27/10/2026

Escopo: o fluxo principal do MainsAgents (por onde começar, como achar as áreas e como continuar um trabalho), sem mexer no Canvas, nos providers, na persistência ou no backend. Esta rodada preserva o padrão visual Dark Studio (tokens de `dark-studio.css`, painéis planos e sem sombra, ação primária neutra) e foi revisada contra as diretrizes da Apple: `sidebars.md` (Best practices), `onboarding.md` (Best practices) e `writing.md` (Best practices: "Provide clear next steps on any blank screens", "Be action oriented").

## Diagnóstico (antes)

Fiz o diagnóstico com screenshots de todas as telas no build atual (1440 px, escuro) e lendo o código das telas da minha posse.

1. **A barra lateral repetia o rótulo "Workspace" em dois grupos.** O primeiro grupo misturava Escopos com as áreas de produção, e a ordem (Visão geral, Escopos, Quadro, Estúdio, Canvas, Fluxo, Calendário) não seguia o caminho do trabalho: o Estúdio, onde tudo começa, era o 4º item, e o Calendário ficava no fim, longe do Estúdio. As dicas (`title`) só repetiam o nome do item. A HIG pede rótulos curtos e descritivos para cada grupo (`sidebars.md › Best practices`).
2. **A Visão geral de um workspace novo não dizia por onde começar.** Aparecia "Tudo em dia", "Nada em produção" e um botão "Criar agente" no cabeçalho, mas faltava a sequência real (agente → pauta → agendamento). A HIG pede próximos passos claros em telas vazias e dicas contextuais no lugar de um tutorial separado (`writing.md`, `onboarding.md`).
3. **Não havia um jeito direto de continuar um trabalho.** Sem pendências, a Visão geral não oferecia o trabalho mais recente. Além disso, os links "Abrir Estúdio" da Visão geral abriam a última visão usada do Estúdio: se o Calendário tinha ficado aberto, "Abrir Estúdio" caía no Calendário.
4. **No cabeçalho de Escopos, "Histórico de conversas" era um link sublinhado e solto**, acima do botão primário, sem relação visual com as outras ações.
5. **O cartão "Novo escopo" mostrava um quadrado vazio:** o ícone "+" existia no DOM, mas o SVG ficava sem tamanho e sem traço (`.scope-plus svg` não tinha estilo).

## Mudanças (depois)

### 1. Barra lateral com grupos por intenção (`Sidebar.tsx`)
- Os grupos agora são **Trabalho / Work** (Visão geral, Estúdio, Calendário, Quadro, Fluxo, Canvas) e **Equipe / Team** (Agentes, Escopos, Histórico). O grupo "Agentes" continua listando cada agente.
- A ordem segue o trabalho: começar, produzir, agendar e, por fim, as ferramentas de apoio.
- Cada item ganhou uma dica de uma linha no `title` (por exemplo, "Estúdio: da pauta ao roteiro e às entregas"). O `aria-label` continua só com o nome do item.
- Cada grupo é um `<nav aria-labelledby>` com o rótulo visível.

### 2. Guia "Por onde começar" na Visão geral (`Home.tsx`, `ux-flow.css`)
- São três passos reais e sequenciais:
  1. **Monte a equipe:** criar um agente.
  2. **Crie a primeira pauta:** abre o Estúdio na visão Produção.
  3. **Agende a publicação:** abre o Calendário.
- Cada passo é marcado como feito pelos dados do workspace (agentes, pautas ou conteúdos, publicações com data), nunca por um clique no guia.
- Só o passo atual tem botão. Os passos feitos mostram "Feito" com um check verde, e o contador "1 de 3" mostra o progresso.
- O guia não compete com pendências reais. Quando "Precisa de você" tem itens, o guia desce para baixo dessa lista e o botão do passo vira secundário. Sem pendências, o guia fica no topo e o passo atual é a única ação primária da página: o botão do cabeçalho vira secundário enquanto o guia está aberto.
- "Ocultar guia" vale **por workspace** (chave `overview-start-hidden:<workspaceId>`), então um workspace novo e vazio continua mostrando o próprio guia. Depois de ocultado, o guia continua acessível pelo link "Por onde começar" no cabeçalho até os três passos estarem feitos (`onboarding.md`: o tutorial deve ser opcional e fácil de reencontrar).
- O guia some sozinho quando os três passos estão concluídos.

### 3. "Continuar de onde parou" (`Home.tsx`)
- Quando nada espera o usuário, o estado "Tudo em dia" mostra o trabalho em andamento tocado mais recentemente, com o botão "Continuar".
- Só entra trabalho realmente em andamento: as colunas `schedule` (já agendado) e `published` ficam de fora.
- Todas as entradas do Estúdio pela Visão geral (Abrir Estúdio, linhas de produção, Continuar, passo 2) agora definem `studio-view=studio`, e o passo 3 define `calendar`.

### 4. Cabeçalho de Escopos (`Scopes.tsx`, `ux-flow.css`)
- "Histórico de conversas" virou um botão secundário com ícone, ao lado de "Novo escopo", dentro de `.scopes-head-actions`.

### 5. Ícone "+" do cartão Novo escopo (`scopes-usage.css`)
- `.scope-plus svg` ganhou tamanho (18 px) e traço, e o "+" aparece nos temas claro e escuro.

## Arquivos

- `src/components/layout/Sidebar.tsx`: grupos, ordem, dicas e import de `ux-flow.css`.
- `src/pages/Home.tsx`: guia, "Continuar" e entradas explícitas do Estúdio e do Calendário.
- `src/pages/Scopes.tsx`: ações do cabeçalho.
- `src/styles/scopes-usage.css`: `.scope-plus svg`.
- `src/styles/ux-flow.css` (novo): guia, "Continuar" e ações de Escopos. É importado pela barra lateral para carregar junto com o shell.
- `scripts/test-ux-flow-ui.mjs` (novo): teste de interface com perfil isolado.
- `docs/analysis/design-flow-2026-10-27.md` (este relatório).

Não alterei: Topbar, Board, Agents, Sessions, Usage, `HomeProductionPipeline.tsx` (não é usado por nenhuma tela), `overview.css`, `board-agents.css` e `history-canvas.css`. O Quadro, os Agentes e o Histórico já tinham estados vazios com uma próxima ação clara.

## Verificação

- `npx tsc -b --pretty false`: passou, sem erros.
- Build isolado, autorizado pelo coordenador, sem tocar `dist/`: `npx vite build --outDir .mainsagents-workspaces/ux-flow-build-2026-10-27 --emptyOutDir`.
- Teste de interface `scripts/test-ux-flow-ui.mjs`: **passou** (`UX_FLOW_UI_OK`) contra esse build. Comando: `UX_DIST=.mainsagents-workspaces/ux-flow-build-2026-10-27 npx electron scripts/test-ux-flow-ui.mjs`. Sem `UX_DIST`, ele usa `dist/`. O perfil é isolado em `.mainsagents-workspaces/ux-flow-ui-test`, onde ficam também os screenshots. As fixtures são determinísticas, e nenhuma verificação é pulada. O teste cobre:
  - **Barra lateral:** grupos Trabalho/Equipe, ordem dos itens, `aria-label` limpo e dica no `title`.
  - **Workspace novo:** passo 1 é o atual, o guia vem antes de "Precisa de você" no DOM, há uma única ação primária e o foco por teclado funciona.
  - **Escopos:** o "+" tem 18 px e traço, e o histórico é um botão secundário.
  - **Workspace povoado, sem pendências:** passo 3 é o atual. "Continuar" oferece o vídeo em edição, não o publicado, mesmo com o publicado sendo o mais recente. O passo 3 abre o Calendário, e "Continuar" em seguida abre o Estúdio na visão Produção, não o Calendário.
  - **Ocultar por workspace:** ocultado em "Content", o guia continua visível no workspace vazio "Outro espaço". De volta a "Content", ele segue oculto e reaparece pelo link do cabeçalho.
  - **Com uma pendência real** (pauta aguardando pesquisa): o guia fica depois da lista no DOM, o botão do passo é secundário, o "Nova tarefa" é primário e "Continuar" não aparece.
  - **Temas, larguras e idiomas:** claro e escuro, 880 e 360 px sem rolagem horizontal, e inglês ("Where to start", "Work/Team").
- Os screenshots foram revisados: `new-dark`, `populated-dark/light`, `populated-880/360`, `pending-dark`, `pending-en` e `scopes-dark`. No 360 px, o passo atual quebrava o texto ao lado do botão; corrigi para o botão ir para a linha de baixo e rodei de novo.
- O coordenador ainda deve rodar `npm run build` e as suítes existentes, como `scripts/test-refined-workspace-ui.mjs`, contra o `dist/` final.

## Fora do escopo desta rodada

- O breadcrumb do Calendário mostra "Estúdio de conteúdo". Ele vem de `Breadcrumbs.tsx` e de `routes.ts`, que não são da minha posse.
- A coluna vazia do Quadro ("Nada aqui") poderia dizer o que entra em cada coluna. O texto está em `TaskColumn.tsx`, que também não é da minha posse.
