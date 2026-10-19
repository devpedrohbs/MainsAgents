# Estilo flexível nos carrosséis Paper — 13/10/2026

Claude Code (worker), tarefa `task_938e68fe1048`. Ajuste de texto de instruções e de UI. Não houve commit, push nem release pública. Também não fiz chamada ao Paper, chamada de IA nem geração de imagem. O comportamento do modelo **não foi testado**: o que está verificado é o texto do prompt, as skills e a configuração salva.

## Regra nova

- **Base editorial (padrão):** composição editorial, hierarquia forte, títulos grandes, respiro, fotos e screenshots reais, leitura no celular, textos editáveis e slides coerentes.
- **Cores por peça:**
  - se o criador indicar uma paleta, ela vale;
  - se não indicar, o agente escolhe uma paleta coesa para o tema e diz qual usou, sem fazer perguntas desnecessárias;
  - o azul das referências originais (`#41799F`, `#A8D7E8`, `#F7F8F4`, `#173029`) aparece só como exemplo opcional.
- **Estilo pedido para um carrossel:** cores, referência ou descrição de estilo dadas para um carrossel específico substituem a base visual salva nesse carrossel. A cor do texto, o tratamento das fotos, a serifa e o CTA seguem o estilo pedido.
  - O feedback visual revisa o mesmo carrossel e mantém todos os slides coerentes.
  - Num carrossel novo, sem pedido visual, o agente volta à base.
- **Persistência:** um pedido pontual não altera a direção salva, o perfil, as instruções nem as skills. Só um pedido explícito para salvar um novo padrão muda isso, e quem salva é o usuário em Configurar → Paper.
  - Nada é gravado automaticamente.
- **Fora do visual, nada muda:** arquivo alvo, aprovações/concessão, assinatura, geração paga e honestidade de fontes e screenshots continuam como antes.
- **Referências** (pedido do coordenador): o agente só usa uma referência que consiga abrir de fato, por exemplo um caminho local legível.
  - Se não conseguir abrir, diz o que falta e segue a descrição em texto.
  - Nunca afirma ter visto uma imagem a partir de um link ou de uma legenda.
  - Não foi criado recurso de anexo.

## Arquivos

| Arquivo | Mudança |
| --- | --- |
| `paper-design.mjs` | `paperVisualStyle` reescrito como base flexível. Em `paperDesignInstructions`, o cabeçalho mantém o marcador `Current saved MainsAgents Paper carousel parameters` e acrescenta que a base visual é apenas um fallback. A linha `Visual direction:` passou a ser `Saved visual base (fallback):`, seguida de uma linha `Visual precedence:` com a regra de precedência por peça, as regras de persistência e de referência, e o escopo limitado ao visual. O código de permissões não foi alterado. |
| `src/components/agents/AgentEditorDrawer.tsx` | Botão **Usar base editorial** / **Use editorial base**. A ajuda explica que o estilo salvo é a base e que o que for pedido para um carrossel não altera essa base. |
| `scripts/paper-agent-setup.mjs` | Idempotente e com escopo restrito. Troca `visualStyle` **somente** se ele for exatamente o texto padrão anterior (hardcoded como `previousStockStyle`); um estilo personalizado é preservado. Substitui o bloco "Fluxo Paper" anterior, quando ele é exato, pela versão com "Estilo por carrossel". Se o bloco tiver sido editado pelo usuário, apenas anexa a regra uma vez. |
| `tests/paper-design.test.mjs` | Uma asserção já existente foi ajustada para o novo rótulo `Saved visual base (fallback)`. |
| `scripts/test-paper-agent-ui.mjs` | Somente a mensagem de uma asserção já existente. |
| `package.json` / lock | 0.3.65 |
| Skills em `Documents\Skills\CriadorDeCarrosseis\` | `paper-carrossel/SKILL.md`: nova description, precedência e seção "Estilo por carrossel". `references/identidade-visual.md`: base fixa, papéis de paleta, azul como exemplo opcional e remoção de branco/azul/serifa obrigatórios. `carrossel-direcao-visual.md` e `mainsagent-carrosseis.md`: frases conflitantes alinhadas. Os PNGs de referência foram mantidos. Backup: `.mainsagents-workspaces/paper-style-flex-2026-10-13/skills-before/`. |

## Validação

- `quick_validate.py paper-carrossel` → `Skill is valid!`
- `node --test tests/paper-design.test.mjs` → 7/7
- `tsc -b` limpo
- `npm run build`, depois `npx electron scripts/test-paper-agent-ui.mjs` → PASS. O estilo padrão do editor é a nova base.
- Pacote `release/r65`:
  - instalador `MainsAgents-Setup-0.3.65.exe`, sha256 `1e00a62d…b78cbf15`;
  - `app.asar` `71af212b…6625da21`;
  - 88 módulos nativos;
  - `check-desktop-release` OK;
  - o asar contém o `paper-design.mjs` novo e o bundle com "Usar base editorial".
- Instalação: o app estava fechado e `activity` ocioso, sem fechamento forçado.
  - Snapshot e backup em `.mainsagents-workspaces/local-update-0.3.65/20261013-153545/`.
  - `/S` com saída 0, `ProductVersion 0.3.65.0`, hash do asar instalado igual ao do pacote.
- Agente `criador-de-carrosseis-71023a16`: o setup foi aplicado com o app fechado, com backup em `agent-setup/`. A segunda execução retornou "Already configured: nothing written".
  - Mudaram apenas `instructions`, `paperDesign.visualStyle` (antes era o padrão exato) e `updatedAt`.
  - Continuam iguais: Claude, 9 skills, `enabled=false`, `automatic=false`, sem arquivo e sem assinatura. Não há rascunhos.
- App aberto: `Main window loaded`, `nativeStorage:true`, metadata `0.3.65`. Diff dos snapshots: só `agents` e +1 em `agent_revisions`. As 12 sessões não foram alteradas.

## Exemplos de pedido

- **Só a paleta:** "Faz o carrossel sobre Claude Code com fundo preto, texto off-white e destaque laranja `#FF6B2C`." A base de composição é mantida e só as cores mudam, de forma coerente nos slides.
- **Estilo inteiro diferente, para um carrossel:** "Esse carrossel quero estilo revista minimalista: fundo creme, tipografia serifada grande, sem cápsula, foto em P&B. Referência em `C:\Users\pacas\Pictures\ref-revista.png`." O agente abre o arquivo (ou avisa se não conseguir) e aplica o estilo só nesse carrossel.
- **Revisão:** "Deixa o verde mais escuro em todos." O agente revisa esse mesmo carrossel.
- **Novo padrão:** "Salva esse estilo como padrão." O agente orienta a salvar em Configurar → Paper e não grava nada por conta própria.

## Pendências

- O Paper continua sem arquivo conectado e sem piloto ao vivo. A obediência do modelo à precedência não foi observada em uso real.
