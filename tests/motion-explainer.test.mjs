import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MOTION_PRESETS, buildMotionPlan, describeMotion, detectExplainers, explainerQuoteProblems, motionDensity, normalizeMotion, parseSpokenNumber, remapSpan, keptMap,
  resolveMotionProps, verifyExplainersAgainstTranscript
} from '../editorial-motion-plan.mjs';
import {resolveAnimations} from '../editorial-remotion.mjs';

/** Palavras com tempos a partir de um texto (fala sintética; nenhuma gravação real). */
const say = (text, {start = 0.8, length = 0.3, gap = 0.08, pause = 0.35} = {}) => {
  let t = start;
  return text.split(/\s+/).filter(Boolean).map((word) => { const item = {start: +t.toFixed(3), end: +(t + length).toFixed(3), text: word}; t += length + gap + (/[.!?]$/.test(word) ? pause : 0); return item; });
};
const whole = (words, tail = 2) => [{start: 0, end: words[words.length - 1].end + tail}];
/** Fala neutra antes/depois: um explicativo ocupa uma fração realista do vídeo (orçamento de layout por intensidade). */
const FILLER = 'Olá pessoal, hoje a conversa é sobre como editar vídeos curtos com calma e sem pressa nenhuma para quem está começando agora.';
const padded = (text) => `${FILLER} ${FILLER} ${text} ${FILLER} ${FILLER}`;

const STEPS = 'Hoje vou mostrar o método. Primeiro, grave o áudio limpo. Segundo, corte os silêncios longos. Terceiro, publique o vídeo curto. Pronto.';
const COMPARE = 'Antes eu gastava três horas editando. Agora faço tudo em vinte minutos.';
const STATS = 'Neste mês as vendas subiram 30% e os custos caíram 12%. Bom resultado.';
const PROCESS = 'Primeiro você grava. Depois o app transcreve. Em seguida corta os silêncios. Por fim exporta o vídeo.';

test('números falados: dígitos, milhar, decimal e unidade junto ao número', () => {
  assert.deepEqual(parseSpokenNumber('90%'), {value: 90, unit: '%'});
  assert.deepEqual(parseSpokenNumber('1.000'), {value: 1000});
  assert.deepEqual(parseSpokenNumber('2,5'), {value: 2.5});
  assert.deepEqual(parseSpokenNumber('R$50,'), {value: 50, unit: 'R$'});
  assert.deepEqual(parseSpokenNumber('3x'), {value: 3, unit: 'x'});
  assert.equal(parseSpokenNumber('três'), null, 'número por extenso não vira estatística');
});

test('detecção: etapas, antes/depois, números e processo saem só das palavras ditas, com tempo de revelação', () => {
  const steps = say(STEPS), [found] = detectExplainers(steps);
  assert.equal(found.type, 'steps');
  assert.deepEqual(found.visual.items, ['Grave o áudio limpo', 'Corte os silêncios longos', 'Publique o vídeo curto']);
  assert.deepEqual(found.reveal, ['Primeiro,', 'Segundo,', 'Terceiro,'].map((marker) => steps.find((word) => word.text === marker).start));
  assert.deepEqual(explainerQuoteProblems(found), []);

  const [compare] = detectExplainers(say(COMPARE));
  assert.equal(compare.type, 'compare');
  assert.deepEqual(compare.visual, {type: 'compare', before: {label: 'Antes', text: 'eu gastava três horas editando'}, after: {label: 'Agora', text: 'faço tudo em vinte minutos'}});

  const [stat] = detectExplainers(say(STATS));
  assert.equal(stat.type, 'stat');
  assert.deepEqual(stat.visual, {type: 'stat', chart: 'bar', values: [{label: 'Vendas', value: 30, unit: '%'}, {label: 'Custos', value: 12, unit: '%'}]});

  const [process] = detectExplainers(say(PROCESS));
  assert.equal(process.type, 'process');
  assert.deepEqual(process.visual.nodes, ['Você grava', 'O app transcreve', 'Corta os silêncios', 'Exporta o vídeo']);

  assert.deepEqual(detectExplainers(say('Um número solto como 90% não vira gráfico. Nem segundo lugar sem primeiro.')), [], 'sem estrutura dita, nada é criado');
});

test('builder: explicativo com origem na fala, tempo editado e trecho literal; subtle não cria', () => {
  const words = say(padded(STEPS)), segments = whole(words);
  const plan = buildMotionPlan({words, wordTiming: 'words', segments, intensity: 'balanced'});
  const cue = plan.cues.find((item) => item.kind === 'explainer');
  assert.ok(cue, 'cria o explicativo');
  assert.equal(cue.layout, 'split');
  assert.equal(cue.explainer.origin, 'speech');
  assert.ok(cue.explainer.quote.startsWith('Primeiro, grave o áudio limpo.'));
  assert.ok(cue.end - cue.start >= 2 && cue.end - cue.start <= 20);
  assert.deepEqual(verifyExplainersAgainstTranscript(plan, words), {ok: true, problems: []});
  assert.deepEqual(normalizeMotion(plan, segments).cues.find((item) => item.kind === 'explainer').explainer.revealAt, cue.explainer.reveal.map((t) => +(t - 0).toFixed(3)), 'sem cortes: editado = gravação');
  assert.match(describeMotion(normalizeMotion(plan, segments)), /1 explicativo\(s\) com base no que foi dito/);
  assert.equal(buildMotionPlan({words, wordTiming: 'words', segments, intensity: 'subtle'}).cues.some((item) => item.kind === 'explainer'), false);
  assert.equal(buildMotionPlan({words, wordTiming: 'words', segments, intensity: 'balanced', explainers: false}).cues.some((item) => item.kind === 'explainer'), false);
});

test('texto numérico só com evidência: número/unidade/item fora do trecho dito é recusado; transcrição real confere o trecho', () => {
  const words = say(padded(STATS)), segments = whole(words);
  const plan = buildMotionPlan({words, wordTiming: 'words', segments, intensity: 'balanced'});
  const index = plan.cues.findIndex((item) => item.kind === 'explainer');
  assert.ok(index >= 0);
  const edit = (change) => { const copy = structuredClone(plan); change(copy.cues[index].explainer); return copy; };
  assert.throws(() => normalizeMotion(edit((e) => { e.visual.values[0].value = 45; }), segments), /número 45 não foi dito/);
  assert.throws(() => normalizeMotion(edit((e) => { e.visual.values[0].unit = 'x'; }), segments), /unidade x não foi dita/);
  assert.throws(() => normalizeMotion(edit((e) => { e.visual.values[0].label = 'Lucro'; }), segments), /não está no trecho dito/);
  // Trecho reescrito para "sustentar" um número inventado passa na coerência interna, mas não na transcrição real.
  const forged = edit((e) => { e.quote = e.quote.replace('30%', '45%'); e.visual.values[0].value = 45; });
  assert.doesNotThrow(() => normalizeMotion(forged, segments));
  const check = verifyExplainersAgainstTranscript(forged, words);
  assert.equal(check.ok, false);
  assert.match(check.problems[0].reason, /não corresponde à transcrição/);
  // Conteúdo do usuário é permitido e rotulado; imagem só como material do usuário, por id (sem caminho/URL).
  const user = edit((e) => { e.origin = 'user'; delete e.quote; delete e.quoteStart; delete e.quoteEnd; e.visual.values[0].value = 45; });
  assert.equal(normalizeMotion(user, segments).cues[index].explainer.origin, 'user');
  assert.throws(() => normalizeMotion(edit((e) => { e.visual = {type: 'image', assetId: 'logo'}; }), segments), /user-provided/);
  assert.throws(() => normalizeMotion(edit((e) => { e.origin = 'user'; delete e.quote; delete e.quoteStart; delete e.quoteEnd; delete e.reveal; e.visual = {type: 'image', assetId: 'C:/x.png'}; }), segments), /assetId/);
  assert.throws(() => normalizeMotion(edit((e) => { e.visual.values[0].label = '<b>x</b>'; }), segments), /short plain texts|label/);
});

test('explicativo pode atravessar cortes: revelações remapeadas; cortado por inteiro sai do plano', () => {
  const words = say(padded(STEPS)), last = words[words.length - 1].end;
  const plan = buildMotionPlan({words, wordTiming: 'words', segments: whole(words), intensity: 'balanced'});
  const source = plan.cues.find((item) => item.kind === 'explainer');
  const segunda = words.find((word) => word.text === 'Segundo,');
  // Corta 0,35 s de silêncio entre a etapa 1 e a 2 (pausa depois de "limpo.").
  const limpo = words.find((word) => word.text === 'limpo.');
  const segments = [{start: 0, end: limpo.end + 0.05}, {start: limpo.end + 0.4, end: last + 2}];
  const cut = normalizeMotion(plan, segments).cues.find((item) => item.id === source.id);
  assert.ok(cut, 'continua no plano');
  assert.equal(cut.start, source.start, 'início antes do corte não muda');
  assert.ok(Math.abs(cut.explainer.revealAt[1] - (segunda.start - 0.35)) < 0.002, 'etapa 2 aparece quando é dita no editado');
  assert.deepEqual(remapSpan(1, 3, keptMap([{start: 0, end: 1.5}, {start: 2, end: 5}])), {start: 1, end: 2.5});
  const removed = normalizeMotion(plan, [{start: 0, end: source.sourceStart - 0.2}, {start: source.sourceEnd + 0.2, end: last + 2}]);
  assert.equal(removed.cues.some((item) => item.id === source.id), false);
});

test('densidade: orçamento de layout e câmera cheia entre layouts por intensidade', () => {
  const block = (i) => `Parte ${i}. Primeiro, grave o áudio limpo. Segundo, corte os silêncios longos. Depois disso muita conversa normal sobre o tema sem estrutura nenhuma aqui e ali para encher o tempo de fala do vídeo.`;
  const words = say(Array.from({length: 8}, (_, i) => block(i + 1)).join(' ')), segments = whole(words), duration = segments[0].end;
  for (const intensity of ['balanced', 'intense']) {
    const plan = buildMotionPlan({words, wordTiming: 'words', segments, intensity}), preset = MOTION_PRESETS[intensity];
    const density = motionDensity(plan, duration);
    assert.ok(density.layoutShare <= preset.maxLayoutShare + 1e-6, `${intensity}: ${density.layoutShare} <= ${preset.maxLayoutShare}`);
    assert.ok(density.cuesPerMinute <= preset.maxPerMinute + 1e-6);
    const layouts = plan.cues.filter((cue) => cue.layout !== 'camera-full');
    assert.ok(layouts.length >= 2, `${intensity}: usa explicativos`);
    for (let i = 1; i < layouts.length; i++) {
      const gap = layouts[i].start - layouts[i - 1].end;
      assert.ok(gap < 0.6 || gap >= preset.minCameraSeconds - 1e-6, `${intensity}: câmera cheia mínima entre layouts (${gap})`);
    }
  }
  assert.equal(motionDensity(buildMotionPlan({words, wordTiming: 'words', segments, intensity: 'subtle'}), duration).layoutShare, 0);
});

test('props de render: revelação em frames na mesma fase em 25 e 30 fps; transição direta entre layouts próximos; faixa protegida validada', () => {
  const words = say(padded(STEPS)), segments = whole(words), duration = segments[0].end;
  const plan = normalizeMotion(buildMotionPlan({words, wordTiming: 'words', segments, intensity: 'balanced'}), segments);
  const at = (fps) => resolveMotionProps(plan, {fps, durationSeconds: duration}).cues.find((cue) => cue.kind === 'explainer');
  const c25 = at(25), c30 = at(30);
  c25.explainer.revealFrames.forEach((frame, i) => assert.ok(Math.abs(frame / 25 - c30.explainer.revealFrames[i] / 30) <= 1 / 25 + 1e-9, 'mesmo instante em segundos'));
  assert.ok(c30.explainer.revealFrames.every((frame, i, list) => frame >= 0 && frame < c30.endFrame - c30.startFrame && (!i || frame >= list[i - 1])));
  // Duas cues de layout a 0,3 s uma da outra viram transição direta (fim da 1ª = início da 2ª).
  const user = (id, sourceStart, sourceEnd, layout) => ({id, kind: 'explainer', sourceStart, sourceEnd, start: 0, end: 0, layout, strength: 0.8, source: 'inferred', timing: 'words', reason: 'teste', signals: [],
    explainer: {origin: 'user', visual: {type: 'steps', items: ['Um item', 'Outro item']}}});
  const joined = normalizeMotion({version: 1, intensity: 'balanced', analysis: {}, cues: [user('a', 1, 4, 'split'), user('b', 4.3, 8, 'motion-focus')]}, [{start: 0, end: 10}]);
  for (const fps of [25, 30]) {
    const props = resolveMotionProps(joined, {fps, durationSeconds: 10});
    assert.equal(props.cues[0].endFrame, props.cues[1].startFrame, `${fps} fps: transição direta`);
  }
  const far = normalizeMotion({version: 1, intensity: 'balanced', analysis: {}, cues: [user('a', 1, 4, 'split'), user('b', 5, 8, 'split')]}, [{start: 0, end: 10}]);
  const props = resolveMotionProps(far, {fps: 30, durationSeconds: 10});
  assert.equal(props.cues[1].startFrame - props.cues[0].endFrame, 30, 'longe: volta à câmera cheia');
  assert.deepEqual(resolveMotionProps(far, {fps: 30, durationSeconds: 10, protect: {captionBand: {top: 0.7, bottom: 0.84}}}).protect, {captionBand: {top: 0.7, bottom: 0.84}});
  assert.throws(() => resolveMotionProps(far, {fps: 30, durationSeconds: 10, protect: {captionBand: {top: 0.9, bottom: 0.5}}}), /captionBand/);
  // Adaptador: imagem sem arquivo autorizado é recusada no render; faixa protegida chega às props.
  const meta = {width: 1080, height: 1920, fps: 30, durationSeconds: 10, hasAudio: false};
  const image = normalizeMotion({version: 1, intensity: 'balanced', analysis: {}, cues: [{...user('img', 1, 5, 'split'), explainer: {origin: 'user', visual: {type: 'image', assetId: 'grafico', caption: 'Seu material'}}}]}, [{start: 0, end: 10}]);
  assert.throws(() => resolveAnimations({motion: image}, meta, {assetIds: []}), /imagem sem arquivo autorizado/);
  assert.equal(resolveAnimations({motion: image, protect: {captionBand: {top: 0.66, bottom: 0.8}}}, meta, {assetIds: ['grafico']}).motion.protect.captionBand.top, 0.66);
});

test('planos antigos: mesma saída de normalizeMotion/resolveMotionProps, sem chaves novas (hash preservado)', () => {
  const legacy = {version: 1, intensity: 'balanced', analysis: {wordTiming: 'words', voice: 'measured', limitations: [], measuredCandidates: 2, inferredCandidates: 1}, cues: [
    {id: 'm1', kind: 'punchIn', sourceStart: 1, sourceEnd: 1.8, start: 1, end: 1.8, layout: 'camera-full', strength: 0.7, scale: 1.08, source: 'measured', timing: 'words', reason: 'Aproximação: medido (voz +5 dB)', signals: [{kind: 'loudness', source: 'measured', value: 5}]},
    {id: 'm2', kind: 'keyPoint', sourceStart: 4, sourceEnd: 7, start: 4, end: 7, text: 'economiza 90%', focus: '90%', layout: 'split', strength: 0.8, source: 'mixed', timing: 'words', reason: 'Cartão explicativo', signals: [{kind: 'number', source: 'inferred'}], sfx: {kind: 'whoosh', gainDb: -22, ducked: true}}]};
  const normalized = normalizeMotion(legacy, [{start: 0, end: 12}]);
  assert.deepEqual(Object.keys(normalized), ['version', 'intensity', 'analysis', 'cues']);
  assert.deepEqual(normalized.cues.map((cue) => Object.keys(cue).filter((key) => ['explainer', 'reframe'].includes(key))), [[], []]);
  assert.equal(JSON.stringify(normalizeMotion(normalized, [{start: 0, end: 12}])), JSON.stringify(normalized), 'idempotente');
  const props = resolveMotionProps(normalized, {fps: 30, durationSeconds: 12});
  assert.deepEqual(Object.keys(props), ['intensity', 'cues', 'sfx']);
  assert.deepEqual(props.cues[1], {id: 'm2', kind: 'keyPoint', layout: 'split', startFrame: 120, endFrame: 210, strength: 0.8, text: 'economiza 90%', focus: '90%'});
});

test('momentos escolhidos pelo usuário: source user só com sinal user; intensidade off aceita cues manuais', () => {
  const user = {id: 'u1', kind: 'kineticText', sourceStart: 2, sourceEnd: 3.5, start: 0, end: 0, text: 'grave o áudio limpo', layout: 'camera-full', strength: 0.7, source: 'user', timing: 'words', reason: 'Escolhido por você', signals: [{kind: 'user', source: 'user'}]};
  const plan = normalizeMotion({version: 1, intensity: 'off', analysis: {}, cues: [user, {...user, id: 'u2', kind: 'punchIn', text: undefined, scale: 1.1, sourceStart: 5, sourceEnd: 6}]}, [{start: 0, end: 10}]);
  assert.equal(plan.cues.length, 2);
  assert.equal(resolveMotionProps(plan, {fps: 30, durationSeconds: 10}).cues.length, 2);
  assert.match(describeMotion(plan), /manual: 2 momento\(s\).*2 escolhido\(s\) por você/);
  assert.match(describeMotion(plan), /0 apoiado\(s\) na voz medida/, 'escolha do usuário não conta como voz medida');
  assert.throws(() => normalizeMotion({version: 1, intensity: 'off', analysis: {}, cues: [{...user, signals: [{kind: 'loudness', source: 'measured', value: 5}]}]}, [{start: 0, end: 10}]), /apart/);
  assert.throws(() => normalizeMotion({version: 1, intensity: 'off', analysis: {}, cues: [{...user, source: 'inferred'}]}, [{start: 0, end: 10}]), /apart/);
});
