# Referências, motion design e edição com HyperFrames

Data: 28/10/2026. Status: proposta de produto e implementação; nenhuma integração HyperFrames foi instalada ou ativada nesta rodada.

## Direção atual do usuário — produto único, Claude editor e HyperFrames para motion

Atualização após a conversa inicial: a experiência desejada ocorre inteiramente no MainsAgents. O Claude conectado ao app conduz a edição por ferramentas locais; HyperFrames é o motor das cenas e camadas de motion. Não é necessário colocar o executável desktop do HyperFrames dentro de outra janela. Integrar seu motor e apresentar os resultados na interface própria do MainsAgents. A instalação desktop existente pode continuar no computador, sem virar uma etapa obrigatória de trabalho.

Divisão proposta: Claude pesquisa/consulta fontes, planeja roteiro e montagem, escolhe materiais disponíveis e dirige revisões; o executor de mídia monta vídeos, imagens e áudio; HyperFrames produz animações, títulos, diagramas, gráficos e cenas de motion; o MainsAgents mantém briefing, referências, fontes, versões, tarefas e prévia. Todas as ações do agente continuam rastreáveis e vinculadas ao projeto. “100% pelo Claude” significa operação por conversa com ferramentas, não que o modelo substitua o renderizador ou dispense conferência factual/editorial.

O conteúdo principal inclui notícias, curiosidades e tecnologia. Oferecer três formatos dentro da mesma jornada: apresentador + materiais de apoio; vídeo narrado sem apresentador; motion completo. Uma narração fornecida pelo usuário é um input; gerar voz é uma opção separada, com provedor, voz e autorização definidos, sem presumir capacidade já integrada.

O projeto começa com tema ou fontes/arquivos, objetivo, formato, duração e modalidade de voz. Caminho: material e fontes → roteiro → cenas planejadas → montagem e motion → prévia interna → ajustes por conversa → exportação. Gravações preservam a revisão de cortes já existente. Projetos novos a partir de roteiro precisam de uma entrada própria e não devem fingir que existe uma gravação de origem.

Para notícias, cada afirmação relevante conserva link/documento e data no projeto; o agente diferencia fato, anúncio, hipótese e interpretação. Imagens ilustrativas ou reconstruções não são apresentadas como registro real. Conhecimento de estilo persiste; fatos e fontes são verificados para a pauta atual. Mudanças no roteiro/narração podem invalidar tempos de motion e devem gerar nova revisão coerente, sem reaproveitar sincronização antiga silenciosamente.

Primeira entrega proposta: um vídeo curto de tecnologia com roteiro/voz fornecidos ou aprovados, dois materiais visuais reais e uma cena de motion criada localmente pelo HyperFrames; visualizar e pedir uma alteração totalmente no MainsAgents. Só depois expandir catálogo, pesquisa automatizada e edição visual direta.

## Objetivo

Transformar referências escolhidas pelo criador em conhecimento consultável e animações editáveis reutilizáveis. Usar a mesma biblioteca para acabamento de gravações e criação de vídeos inteiros de motion design. Manter o MainsAgents como lugar de briefing, revisão, versões e entrega; HyperFrames como ferramenta de composição e renderização.

## Evidência atual

- HyperFrames desktop encontrado em `%LOCALAPPDATA%/Programs/HyperFrames`, FileVersion `0.1.0`. Isso confirma a instalação do aplicativo; versão/compatibilidade da CLI e execução local ainda precisam ser verificadas em um projeto isolado.
- `src/features/content/inspiration.ts` já modela referências por workspace com link, vídeo local, notas e tags.
- `editor-inspiration-analysis.mjs` fornece ao agente somente transcrição e medições de tempo. Não oferece análise visual de motion; um link salvo não significa vídeo analisado.
- `editor-guidance.mjs` entrega guia e skills habilitadas ao editor; não injeta toda uma pasta de conhecimento automaticamente.
- `editor-host.mjs`, `editor-authoring.mjs` e `claude-code-bridge.mjs` já fornecem ferramentas locais de contexto, frames, plano, prévia e exportação.
- O fluxo atual é cortes → visual → SRT. Durante o visual, cortes, duração, formato e voz ficam congelados. Novos efeitos sonoros também não estão liberados nessa etapa. Esta proposta preserva esse contrato; mudanças de áudio precisam de fluxo explícito próprio.

## Fluxo de aprendizado

1. **Adicionar referência.** Vídeo local ou trecho acessível, nome, intervalo e comentário livre; guardar fonte e versão. Link pode funcionar como marcador até que seu conteúdo esteja disponível para análise. Tutoriais entram como técnicas, separados das preferências pessoais.
2. **Analisar o trecho.** Extrair sequência de frames suficiente para acompanhar início, trajetória e término, além dos tempos e áudio/transcrição quando disponíveis. Uma captura isolada informa composição, não demonstra movimento. Registrar limitações; não inventar duração precisa, curva de animação ou efeitos que não foram observados.
3. **Confirmar o que aproveitar.** Mostrar síntese com o trecho original: o que chamou atenção, quais elementos devem inspirar o trabalho e o que evitar. O criador pode gostar do movimento, mas rejeitar cores, fonte ou intensidade do exemplo.
4. **Criar estudo curto.** Claude traduz o padrão escolhido em uma composição HyperFrames original, usando texto e assets do criador. Exibir estudo de 3–8 segundos ao lado da referência, com duração ajustada ao efeito.
5. **Salvar no kit aprovado.** Somente depois da avaliação do criador, guardar código editável, prévia, parâmetros, regras de uso e vínculo com a referência. Revisar uma peça não altera automaticamente todas as outras.

### Ficha de referência

- Identidade, workspace, fonte/arquivo/versão, trecho de origem.
- Tags úteis para busca: título, callout, diagrama, transição, UI, câmera, tipografia, ritmo.
- Comentário original do criador; aspectos desejados e rejeitados.
- Evidência visual/temporal, interpretação do agente e pontos incertos em campos distintos.
- Estado: coletada → analisada → em estudo → aprovada/arquivada.

### Item do kit de motion

- Nome simples, finalidade e situações em que usar/evitar.
- Referência e versão do estudo que recebeu aprovação.
- Projeto-fonte HyperFrames, assets locais, prévia e versão do motor usada na validação.
- Parâmetros editáveis: texto, valores, cores, imagem e outros campos suportados.
- Faixa de duração/legibilidade e composição para cada formato validado. Proporção, duração total e fps não devem ser tratados como variáveis de texto; precisam de composições/configurações próprias.
- Política de áudio explícita; não adicionar música, voz sintética ou SFX apenas porque aparecem na referência.

## Duas entradas de produção

| Entrada | Material e decisões iniciais | Caminho |
| --- | --- | --- |
| Editar gravação | Original, objetivo, formato e preferências de corte | Corte base revisado → direção visual → prévia HyperFrames → ajustes → MP4 + projeto + SRT opcional separado |
| Criar motion | Mensagem, roteiro/dados/assets, duração, formato e áudio desejado | Storyboard curto → amostra de estilo → composição HyperFrames → ajustes → MP4 + projeto; legendas quando aplicáveis |

Na gravação, a transcrição e as palavras da linha do tempo editada dão os pontos de entrada dos gráficos. Conservar a ligação com os tempos originais para auditoria. A etapa visual usa exatamente a versão do corte aprovada, sem refazer escolhas de fala ou mudar sua duração. Na criação de motion, o ritmo vem do roteiro/voz fornecida ou dos tempos planejados para uma peça sem narração.

## Jornada de cada projeto no app

1. Criar projeto escolhendo Editar gravação ou Criar motion.
2. Definir briefing, formato e áudio; escolher perfil de estilo e poucas referências relevantes.
3. Claude consulta o manual aprovado e o kit; apresenta direção visual, cenas e motivos das escolhas. Pode sugerir uma nova técnica como estudo, sem promovê-la a preferência geral.
4. Conferir direção com storyboard e uma amostra animada curta. Nesta fase de calibração isso evita decisões caras de estilo no vídeo inteiro. Para perfis já aprovados, o criador pode optar por ir direto à prévia.
5. Produzir prévia do projeto com HyperFrames e indicar sua versão, fontes e itens do kit usados.
6. Pedir ajuste por trecho: “entre 8 e 11 segundos, trocar o diagrama e diminuir o movimento”. Criar revisão e preservar o restante. O projeto completo poderá precisar de nova renderização; não prometer renderização parcial sem medição.
7. Aprovar e exportar MP4 e projeto editável; SRT quando solicitado, vinculado à versão final. Gravações seguem a política existente de SRT separado para CapCut.
8. Classificar feedback como Apenas neste projeto, Sugestão para o manual ou Nova versão do item do kit. Alterações gerais só passam a valer depois da aprovação do criador.

## Conhecimento e contexto

Manual de estilo legível em Markdown, com versões aprovadas, integrado à biblioteca de referências e ao kit. O Obsidian pode editar esses documentos opcionalmente. Metadados e seleção continuam no app, sem duas cópias concorrentes do manual. A integração de edição externa deve detectar mudanças e pedir resolução de conflitos em vez de sobrescrever.

Cada execução recebe um pacote limitado: briefing atual, snapshot do manual/perfil, referências selecionadas e itens relevantes do kit. Guardar esse manifesto com a versão do projeto. Não carregar todos os vídeos e todo o histórico em cada conversa. Manter referências, projetos e sessões isolados por workspace/perfil, com compartilhamento explícito quando desejado.

Preferência explícita do projeto prevalece nessa peça; preferências aprovadas do criador orientam os padrões; skills HyperFrames descrevem como executar. Skills ou exemplos de terceiros não podem mudar o fluxo de aprovação, a política de áudio ou os arquivos autorizados.

## Integração local proposta

- Primeiro validar a CLI e suas dependências em projeto isolado; fixar versão compatível com as skills. O desktop instalado não prova disponibilidade da CLI no PATH.
- Ampliar o canal de ferramentas do editor existente. O host do MainsAgents executa operações específicas de criar projeto, verificar, capturar frames, gerar prévia e exportar. A CLI HyperFrames permanece um detalhe do executor, com IDs, timeouts e cancelamento.
- Usar MCP local como protocolo de ferramentas quando necessário para o Claude; ele será nosso adaptador. O MCP oficial HyperFrames é hospedado pela HeyGen e constitui outra opção de processamento/conta.
- Mostrar primeiro a prévia renderizada dentro do MainsAgents, com ajustes por chat. Edição visual interativa via SDK é uma etapa posterior, com origem/isolamento do conteúdo avaliada; não carregar scripts de composições com privilégios do desktop. Ferramentas externas podem servir à validação técnica, sem virar etapa obrigatória para o usuário.
- Capturar relatórios e artefatos do motor; só anunciar entrega quando o arquivo existir e tiver validação. Validar duração, resolução, presença de áudio, fonte, assets e legibilidade, além dos comandos de check/lint.
- Uma operação de escrita por projeto. Se o criador modificar o mesmo projeto no HyperFrames desktop, detectar a versão nova e reconciliar antes de uma revisão do agente.
- Preservar os projetos e motores anteriores. O uso de HyperFrames é registrado por projeto; falhas não devem trocar silenciosamente de motor ou reenviar trabalho.

## Primeiro piloto e ordem de implementação

**Piloto:** escolher três trechos de referência e um perfil inicial, criar três estudos — título, diagrama e destaque de tela — e aprová-los como kit inicial. Usar esse kit em uma gravação de aproximadamente 20–30 segundos e em uma peça de motion de 10–15 segundos. Os exemplos são sugestões; a escolha dos trechos cabe ao criador.

Critérios: entendimento do comentário, sem copiar conteúdo desnecessário da referência; legibilidade no formato de destino; entradas visuais sincronizadas; preservação do áudio/cortes aprovados; ajuste localizado sem alterar outras cenas; reabertura editável; exportação reproduzível e arquivos entregues. Registrar tempo de execução e consumo de IA disponível, sem estimar métricas não reportadas.

Ordem:

1. Compatibilidade local e piloto técnico isolado com material sintético.
2. Referências visuais e estudos curtos; manual e kit aprovados.
3. HyperFrames como acabamento de gravações, mantendo cortes → visual → SRT.
4. Entrada Criar motion com storyboard e kit compartilhado.
5. Ajustes visuais embutidos e sincronização com o desktop, depois de validar o fluxo básico.

## Fontes primárias consultadas

- [Brand, templates and storyboards](https://hyperframes.heygen.com/prompting/design-systems): especificação `frame.md`, variáveis, reutilização e storyboard.
- [Render from the command line](https://hyperframes.heygen.com/guides/rendering): render local, formatos, verificações e transparência. Validar o formato transparente no compositor de destino; MP4 não carrega alpha.
- [Running the CLI from an agent harness](https://hyperframes.heygen.com/developers/harness-tool-context): contexto por chamada, artefatos e locks para operações suportadas.
- [Canvas & Preview Integration](https://hyperframes.heygen.com/sdk/guides/canvas-integration): integração de prévia/seleção e requisitos de origem; não equivale a embutir o app inteiro.
- [Hosted MCP](https://hyperframes.heygen.com/guides/mcp): processamento hospedado e diferenças para projeto local.

Validação desta rodada: inspeção do código e da instalação existente, pesquisa nas fontes oficiais e documentação da proposta. Nenhuma edição de vídeo, chamada de modelo, instalação ou alteração de estado pessoal foi executada.
