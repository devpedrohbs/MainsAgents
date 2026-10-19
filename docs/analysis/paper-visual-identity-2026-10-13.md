# Identidade visual Paper para carrosséis — 13/10/2026

Worker B (Claude Code), tarefa `task_77812977a8bd`. Escopo: só as skills externas do Criador de Carrosséis e este relatório. Não alterei código do app, testes, `package.json` nem o SQLite. Não chamei nenhuma ferramenta do Paper, não gerei imagens e não publiquei nada.

## Entregue

- **Skill nova:** `paper-carrossel` → `C:\Users\pacas\Documents\Skills\CriadorDeCarrosseis\paper-carrossel\SKILL.md`
  - `references/identidade-visual.md`: paleta, tipografia, grade, 7 variantes de layout, regras de screenshot e QA.
  - `references/referencia-capa-foto.png` e `references/referencia-slide-tutorial.png`: cópias das duas imagens enviadas pelo criador, para servirem de contexto de leitura persistente.
  - `quick_validate.py` → `Skill is valid!`. Todos os caminhos referenciados existem. É Markdown puro, legível com Read, sem plugin.
- **Editado:** `carrossel-direcao-visual.md`. Removi a regra obrigatória de "sem cores de marca" e a de "aprovação a cada chamada no Paper". Agora o perfil Paper salvo prevalece e o fluxo aponta para `paper-carrossel`. Geração de imagem passa a exigir pedido explícito. A margem ficou em 72–80 px e o limite passou a ser de "duas famílias" de fonte.
- **Editado (uma frase):** `mainsagent-carrosseis.md`. A frase "o criador ainda não definiu cores de marca" passou a remeter ao perfil Paper salvo e à `paper-carrossel`. Também era uma regra obsoleta de "sem marca" e contradizia o perfil.
- **Não editado:** `mainsagent-contexto-editorial.md` (contexto de marca compartilhado) e as demais skills.
- **Backup exato (antes das edições):** `.mainsagents-workspaces/paper-carrossel-skill-backup-2026-10-13/CriadorDeCarrosseis/`, com `SHA256SUMS.txt`.
- **Associação:** cabe ao worker A. Ele adiciona `paper-carrossel` à lista de skills do agente no SQLite, preservando as existentes. O carregador já resolve `<pasta>/<nome>/SKILL.md` (`codex-executor-readiness.mjs:53`).

## Parâmetros extraídos das referências

Cores amostradas por pixel das capturas comprimidas, portanto aproximadas. Não identifiquei as fontes a partir dos pixels.

| Elemento | Observado | Parâmetro adotado |
| --- | --- | --- |
| Fundo dos internos | ~`#40759F` liso | `#41799F` (já no perfil salvo) |
| Marca-d'água | glifos gigantes ~`#5383A9` | forma ou palavra gigante em baixo contraste, opcional |
| Destaque | itálico serifado ~`#97CDE8` | `#A8D7E8` (perfil), em 1 ou 2 palavras do título ou trecho do corpo |
| Títulos | sans pesada branca, entrelinha apertada | 110–180 px; palavra dominante da capa 200–240 px |
| Capa | foto real em tela cheia, céu azul, sujeito no terço superior, título centralizado embaixo | variante "Capa foto"; sem foto, usar "Capa tipográfica" |
| Tutorial | screenshot real em cartão claro, anotação em caixa alta com seta, título + corpo no canto inferior esquerdo | variante "Tutorial"; recortar trecho legível em vez de encolher a tela |
| CTA | cápsula branca curta, texto escuro em caixa alta | cápsula ~90 px de altura, uma ação |
| Fica fora | logo "Mobile Editing Club", boné "fal", setas, bolinhas e avatar do Instagram | proibido na arte |

Diferença em relação à referência: o corpo de texto nela equivale a ~23 px em 1080 px de largura, pequeno para celular. Mantive o perfil salvo, com corpo de 40–48 px.

## Spec visual resumida (variantes)

1. **Capa foto:** foto em tela cheia. Linha de apoio de 72–90 px e palavra dominante de 200–240 px, centralizadas na metade inferior. Cápsula de CTA embaixo.
2. **Capa tipográfica:** fundo azul, palavra gigante e marca-d'água.
3. **Tutorial com screenshot:** cartão claro com cantos de 16–24 px no terço superior ou no meio, anotação com seta em azul claro, título com itálico seletivo e corpo de até 30 palavras embaixo à esquerda.
4. **Ideia:** só tipografia, com muito respiro.
5. **Passos/lista:** de 2 a 4 itens numerados grandes.
6. **Comparação:** duas colunas ou dois screenshots com rótulos.
7. **Encerramento:** síntese e cápsula de CTA. Assinatura só se estiver configurada; hoje está pendente, então fica omitida.

Grade: 1080 × 1350, margem de 72 px, títulos internos alinhados à esquerda e na mesma posição em todos os slides.

## Prompt de teste (copiar e colar no Criador de Carrosséis)

> Monte no Paper um carrossel de 6 slides ensinando "como conectar um MCP no Claude Code em 3 passos" para quem não é programador. Use a skill paper-carrossel. Não tenho foto para a capa, então use a capa tipográfica. Vou anexar 2 screenshots reais da tela de conectores; use só esses screenshots e, no passo sem captura, faça um slide só de texto. Exporte os slides em ordem e me diga exatamente o que foi criado.

Resultado esperado: o agente lê a skill e a identidade, pede os screenshots só se não estiverem anexados e cria uma página nova no arquivo Paper configurado, com 6 artboards nomeados em ordem e textos editáveis. Ele revisa por screenshot, exporta e relata apenas os caminhos ou links que a ferramenta devolveu. Não deve gerar imagem nem inventar uma interface.

## Sugestão futura (não implementada): agente de notícias de TI

> Agente de Notícias Tech: monitora as fontes aprovadas pelo criador e propõe pautas no formato "o que aconteceu → por que importa → o que muda na prática", sempre com link da fonte original e data do fato. Ele não publica e não cria arte. Quando o criador aprovar uma pauta para carrossel, entrega o roteiro slide a slide ao Criador de Carrosséis, que monta no Paper com `paper-carrossel`. Fontes que não foram verificadas aparecem marcadas como "a confirmar". Serviços pagos de busca ou scraping exigem escopo e custo aprovados antes.

## Pendências

- Worker A precisa associar `paper-carrossel` ao agente.
- Assinatura: aguardando resposta opcional do criador.
- Ninguém validou a skill ao vivo no Paper. A primeira execução real com o prompt acima serve de teste.
