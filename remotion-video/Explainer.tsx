import React from 'react';
import {Img, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Box} from './layout';
import {EASE_OUT, cardBox, clampOpts, countUp, fitFont, flowDirection, formatStat, layoutAmount, revealAmount} from './layout';
import type {ExplainerVisual, MotionCue, ProtectProps} from './types';

// Explicativos (antes/depois, etapas, números, processo, imagem do usuário). Só exibem o que veio no plano: textos e
// números ditos na fala (validados contra a transcrição) ou fornecidos pelo usuário. Nenhum asset remoto; tudo é
// função do frame local da Sequence (mesmo resultado na prévia e no render).
const FONT = '"Segoe UI", "Helvetica Neue", Arial, system-ui, sans-serif';
type Colors = {text: string; muted: string; surface: string; line: string};
const palette = (theme: 'dark' | 'light'): Colors => (theme === 'light' ? {text: '#12151c', muted: '#5a6172', surface: 'rgba(18,21,28,0.06)', line: 'rgba(18,21,28,0.18)'} : {text: '#ffffff', muted: '#aab1c2', surface: 'rgba(255,255,255,0.07)', line: 'rgba(255,255,255,0.22)'});
const rise = (amount: number, unit: number): React.CSSProperties => ({opacity: amount, translate: `0px ${(1 - amount) * unit * 3}px`});

const Steps: React.FC<{items: string[]; reveal: number[]; box: Box; unit: number; accent: string; colors: Colors}> = ({items, reveal, box, unit, accent, colors}) => {
  const frame = useCurrentFrame(), {fps} = useVideoConfig();
  const size = fitFont(box, items.length, Math.max(...items.map((item) => item.length)) + 4, unit);
  const active = reveal.reduce((last, at, i) => (frame >= at ? i : last), 0);
  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: size * 0.55}}>
      {items.map((item, i) => {
        const amount = revealAmount(frame, reveal[i], fps), on = i === active;
        return (
          <div key={i} style={{display: 'flex', alignItems: 'center', gap: size * 0.6, ...rise(amount, unit)}}>
            <div style={{flex: 'none', width: size * 1.6, height: size * 1.6, borderRadius: size, background: on ? accent : colors.surface, border: `${Math.max(2, unit * 0.25)}px solid ${on ? accent : colors.line}`, color: on ? '#fff' : colors.muted,
              fontFamily: FONT, fontWeight: 800, fontSize: size * 0.8, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>{i + 1}</div>
            <div style={{fontFamily: FONT, fontWeight: on ? 800 : 600, fontSize: size, lineHeight: 1.15, color: on ? colors.text : colors.muted, overflowWrap: 'anywhere'}}>{item}</div>
          </div>
        );
      })}
    </div>
  );
};

const Process: React.FC<{nodes: string[]; reveal: number[]; box: Box; unit: number; accent: string; colors: Colors}> = ({nodes, reveal, box, unit, accent, colors}) => {
  const frame = useCurrentFrame(), {fps} = useVideoConfig();
  const direction = flowDirection(box, nodes.length), row = direction === 'row';
  const chars = Math.max(...nodes.map((node) => node.length));
  const size = row ? fitFont({...box, right: box.left + (box.right - box.left) / nodes.length}, 3, Math.min(chars, 14), unit, 4.4) : fitFont(box, nodes.length * 1.4, chars + 2, unit, 4.6);
  return (
    <div style={{display: 'flex', flexDirection: direction, alignItems: 'stretch', justifyContent: 'center'}}>
      {nodes.map((node, i) => {
        const amount = revealAmount(frame, reveal[i], fps);
        const link = i ? interpolate(frame, [reveal[i] - Math.round(0.15 * fps), reveal[i] + Math.round(0.2 * fps)], [0, 1], {...clampOpts, easing: EASE_OUT}) : 0;
        return (
          <React.Fragment key={i}>
            {i ? <div style={{flex: 'none', alignSelf: 'center', background: accent, borderRadius: unit, ...(row ? {width: unit * 4 * link, height: Math.max(3, unit * 0.5), margin: `0 ${unit}px`} : {height: unit * 3 * link, width: Math.max(3, unit * 0.5), margin: `${unit * 0.6}px 0`})}} /> : null}
            <div style={{flex: row ? 1 : 'none', minWidth: 0, padding: `${size * 0.5}px ${size * 0.7}px`, borderRadius: unit * 1.4, background: colors.surface, border: `${Math.max(2, unit * 0.25)}px solid ${i === nodes.length - 1 ? accent : colors.line}`,
              fontFamily: FONT, fontWeight: 700, fontSize: size, lineHeight: 1.15, color: colors.text, textAlign: 'center', overflowWrap: 'anywhere', ...rise(amount, unit)}}>{node}</div>
          </React.Fragment>
        );
      })}
    </div>
  );
};

const Compare: React.FC<{visual: Extract<ExplainerVisual, {type: 'compare'}>; reveal: number[]; box: Box; unit: number; accent: string; colors: Colors}> = ({visual, reveal, box, unit, accent, colors}) => {
  const frame = useCurrentFrame(), {fps} = useVideoConfig();
  const direction = flowDirection(box, 2);
  const size = direction === 'row' ? fitFont({...box, right: box.left + (box.right - box.left) / 2}, 4, Math.max(visual.before.text.length, visual.after.text.length) / 2 + 4, unit, 4.8) : fitFont(box, 5, Math.max(visual.before.text.length, visual.after.text.length) + 2, unit, 4.8);
  const side = (item: {label: string; text: string}, i: number) => {
    const amount = revealAmount(frame, reveal[i], fps), after = i === 1;
    return (
      <div key={i} style={{flex: 1, minWidth: 0, padding: size * 0.8, borderRadius: unit * 1.6, background: after ? `${accent}26` : colors.surface, border: `${Math.max(2, unit * 0.3)}px solid ${after ? accent : colors.line}`, display: 'flex', flexDirection: 'column', gap: size * 0.35, ...rise(amount, unit)}}>
        <div style={{fontFamily: FONT, fontWeight: 800, fontSize: size * 0.62, letterSpacing: '0.08em', textTransform: 'uppercase', color: after ? accent : colors.muted}}>{item.label}</div>
        <div style={{fontFamily: FONT, fontWeight: after ? 800 : 600, fontSize: size, lineHeight: 1.15, color: after ? colors.text : colors.muted, textDecoration: after ? undefined : 'none', overflowWrap: 'anywhere'}}>{item.text}</div>
      </div>
    );
  };
  const arrow = interpolate(frame, [reveal[1] - Math.round(0.2 * fps), reveal[1] + Math.round(0.2 * fps)], [0, 1], clampOpts);
  return (
    <div style={{display: 'flex', flexDirection: direction, alignItems: 'stretch', gap: unit * 1.6}}>
      {side(visual.before, 0)}
      <div style={{alignSelf: 'center', fontFamily: FONT, fontWeight: 900, fontSize: size * 1.1, color: accent, opacity: arrow, rotate: direction === 'row' ? '0deg' : '90deg'}}>{'→'}</div>
      {side(visual.after, 1)}
    </div>
  );
};

const Stat: React.FC<{visual: Extract<ExplainerVisual, {type: 'stat'}>; reveal: number[]; box: Box; unit: number; accent: string; colors: Colors}> = ({visual, reveal, box, unit, accent, colors}) => {
  const frame = useCurrentFrame(), {fps} = useVideoConfig();
  const max = Math.max(...visual.values.map((item) => item.value), 1e-9);
  if (visual.chart === 'number') {
    const size = fitFont(box, 2, 8 * visual.values.length, unit, 13);
    return (
      <div style={{display: 'flex', gap: unit * 3, flexWrap: 'wrap', alignItems: 'flex-end'}}>
        {visual.values.map((item, i) => (
          <div key={i} style={{...rise(revealAmount(frame, reveal[i], fps), unit)}}>
            <div style={{fontFamily: FONT, fontWeight: 900, fontSize: size, lineHeight: 1, color: accent, fontVariantNumeric: 'tabular-nums'}}>{formatStat(countUp(item.value, frame - reveal[i], fps), item.unit)}</div>
            <div style={{fontFamily: FONT, fontWeight: 700, fontSize: size * 0.32, color: colors.muted}}>{item.label}</div>
          </div>
        ))}
      </div>
    );
  }
  const size = fitFont(box, visual.values.length * 2, 22, unit, 4.4);
  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: size * 0.7}}>
      {visual.values.map((item, i) => {
        const amount = revealAmount(frame, reveal[i], fps);
        const grow = interpolate(frame, [reveal[i], reveal[i] + Math.round(0.7 * fps)], [0, 1], {...clampOpts, easing: EASE_OUT});
        return (
          <div key={i} style={{display: 'flex', flexDirection: 'column', gap: size * 0.25, opacity: amount}}>
            <div style={{display: 'flex', justifyContent: 'space-between', gap: unit, fontFamily: FONT, fontSize: size, lineHeight: 1.1}}>
              <span style={{fontWeight: 700, color: colors.text, overflowWrap: 'anywhere'}}>{item.label}</span>
              <span style={{fontWeight: 900, color: accent, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap'}}>{formatStat(countUp(item.value, frame - reveal[i], fps), item.unit)}</span>
            </div>
            <div style={{height: size * 0.7, borderRadius: size, background: colors.surface, overflow: 'hidden'}}>
              <div style={{height: '100%', width: `${(item.value / max) * 100 * grow}%`, borderRadius: size, background: accent}} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

const Picture: React.FC<{visual: Extract<ExplainerVisual, {type: 'image'}>; src?: string; box: Box; unit: number; colors: Colors}> = ({visual, src, box, unit, colors}) => {
  const frame = useCurrentFrame(), {fps} = useVideoConfig();
  if (!src) return null; // sem o arquivo do usuário não há o que mostrar (nada é buscado na rede)
  const captionSize = fitFont(box, 6, visual.caption?.length ?? 10, unit, 3.6);
  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: unit, height: box.bottom - box.top - unit * 4, ...rise(revealAmount(frame, 0, fps), unit)}}>
      <Img src={src} style={{flex: 1, minHeight: 0, width: '100%', objectFit: 'contain', borderRadius: unit * 1.2}} />
      {visual.caption ? <div style={{fontFamily: FONT, fontWeight: 600, fontSize: captionSize, color: colors.muted, textAlign: 'center', overflowWrap: 'anywhere'}}>{visual.caption}</div> : null}
    </div>
  );
};

/** Explicativo dentro da caixa do cartão (área segura, fora da câmera e da faixa da legenda). */
export const ExplainerCard: React.FC<{cue: MotionCue; accent: string; theme: 'dark' | 'light'; protect?: ProtectProps; assets?: Record<string, string>}> = ({cue, accent, theme, protect, assets}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const explainer = cue.explainer;
  if (!explainer) return null;
  const length = cue.endFrame - cue.startFrame;
  const box = cardBox(cue.layout, width, height, protect), unit = Math.min(width, height) / 100, colors = palette(theme);
  const inner = {left: box.left + unit * 2, right: box.right - unit * 2, top: box.top + unit * 2, bottom: box.bottom - unit * 2};
  const enter = layoutAmount({...cue, startFrame: 0, endFrame: length}, frame, fps);
  // Itens são revelados no instante em que foram ditos, mas nunca antes de o painel estar visível.
  const reveal = explainer.revealFrames.map((at) => Math.max(at, Math.round(0.25 * fps)));
  const visual = explainer.visual;
  return (
    <div style={{position: 'absolute', left: box.left, top: box.top, width: box.right - box.left, height: box.bottom - box.top, padding: unit * 2, boxSizing: 'border-box', overflow: 'hidden',
      display: 'flex', flexDirection: 'column', justifyContent: 'center', opacity: interpolate(enter, [0.5, 1], [0, 1], clampOpts)}}>
      {visual.type === 'steps' ? <Steps items={visual.items} reveal={reveal} box={inner} unit={unit} accent={accent} colors={colors} /> : null}
      {visual.type === 'process' ? <Process nodes={visual.nodes} reveal={reveal} box={inner} unit={unit} accent={accent} colors={colors} /> : null}
      {visual.type === 'compare' ? <Compare visual={visual} reveal={reveal} box={inner} unit={unit} accent={accent} colors={colors} /> : null}
      {visual.type === 'stat' ? <Stat visual={visual} reveal={reveal} box={inner} unit={unit} accent={accent} colors={colors} /> : null}
      {visual.type === 'image' ? <Picture visual={visual} src={assets?.[visual.assetId]} box={inner} unit={unit} colors={colors} /> : null}
    </div>
  );
};
