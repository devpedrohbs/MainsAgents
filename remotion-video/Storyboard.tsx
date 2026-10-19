import React from 'react';
import {Img, OffthreadVideo, Sequence, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {cameraRect, fitText, slotBox, textColorToken} from '../editorial-storyboard.mjs';
import type {Box, Palette, ResolvedLayer, ResolvedScene, StoryboardProps} from '../editorial-storyboard.mjs';
import {cameraCrop, focusAt} from './layout';
import {clampOpts, countValue, easingFn, layerEnvelope, revealAt, revealFramesFor, sceneTransition, storyboardCamera} from './storyboard-anim';
import type {ReframeProps, ScreenProps} from './types';
import {ScreenStage, screenAvailable} from './Screen';

// Storyboard AUTORADO: cenas → camadas → primitivas, todas dirigidas por useCurrentFrame() (keyframes/easing do
// remotion), sem CSS animation, sem aleatoriedade, sem fontes/imagens remotas. Imagens e B-roll só pelos assets
// registrados (URL loopback no render, URL local na prévia). Fundos em SVG (sem background-image/mask-image).

type Ctx = {sb: StoryboardProps; width: number; height: number; unit: number; fps: number; assets?: Record<string, string>; screen?: ScreenProps; screenSrc?: string};
/** Composição de tela efetiva no frame: modo da cena (o adaptador já resolveu o padrão do par) ou o padrão fora de cenas. */
const screenModeAt = (ctx: Ctx, scene: ResolvedScene | undefined) => (!ctx.screen ? 'off' : scene ? scene.screenMode ?? 'off' : ctx.screen.mode);
const colorOf = (palette: Palette, token: string | undefined, fallback: keyof Palette) => (token && token !== 'none' ? palette[token as keyof Palette] : palette[fallback]);
const alpha = (hex: string, a: number) => `${hex}${Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0')}`;

/** Fundo da cena (sob a câmera): sólido, degradê, grade ou pontos — em SVG, com deriva lenta determinística. */
const Backdrop: React.FC<{scene: ResolvedScene; ctx: Ctx; opacity: number}> = ({scene, ctx, opacity}) => {
  const frame = useCurrentFrame();
  const {palette} = ctx.sb, base = palette[scene.background.tone] ?? palette.bg, step = ctx.unit * 6, drift = (frame * 0.15) % step;
  if (opacity <= 0) return null;
  const kind = scene.background.kind === 'none' ? 'solid' : scene.background.kind;
  return (
    <svg width={ctx.width} height={ctx.height} style={{position: 'absolute', inset: 0, opacity}}>
      <defs>
        <radialGradient id={`g-${scene.id}`} cx="15%" cy="10%" r="70%"><stop offset="0%" stopColor={palette.accent} stopOpacity={0.1} /><stop offset="60%" stopColor={base} stopOpacity={1} /></radialGradient>
        <pattern id={`p-${scene.id}`} width={step} height={step} patternUnits="userSpaceOnUse" x={drift} y={drift}>
          {kind === 'grid' ? <path d={`M ${step} 0 L 0 0 0 ${step}`} fill="none" stroke={palette.accent} strokeOpacity={0.14} strokeWidth={Math.max(1, ctx.unit * 0.08)} /> : <circle cx={step / 2} cy={step / 2} r={Math.max(1, ctx.unit * 0.18)} fill={palette.muted} fillOpacity={0.35} />}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={base} />
      {kind === 'gradient' ? <rect width="100%" height="100%" fill={`url(#g-${scene.id})`} /> : null}
      {kind === 'grid' || kind === 'dots' ? <rect width="100%" height="100%" fill={`url(#p-${scene.id})`} /> : null}
    </svg>
  );
};

/** Câmera: recorte "cover" dentro do retângulo do layout, foco da cena/trilha e zoom por keyframes. */
const StoryCamera: React.FC<{src: string; ctx: Ctx; reframe?: ReframeProps}> = ({src, ctx, reframe}) => {
  const frame = useCurrentFrame();
  const shot = storyboardCamera(ctx.sb.scenes, frame, ctx.fps, ctx.width, ctx.height, ctx.sb.protect);
  let {rect, opacity, amount} = shot;
  const {zoom, scene} = shot;
  // Par câmera+tela: onde a cena pede tela mas a gravação da tela não existe, a câmera volta CHEIA (previsível, sem buraco).
  const mode = screenModeAt(ctx, scene);
  if (mode !== 'off' && !screenAvailable(ctx.screen, frame)) { rect = {x: 0, y: 0, w: ctx.width, h: ctx.height}; opacity = 1; amount = 0; }
  else if (mode !== 'off' && !scene) { rect = cameraRect('pip', ctx.width, ctx.height, ctx.sb.protect); opacity = mode === 'full' ? 0 : 1; amount = 1; }
  if (opacity <= 0) return null;
  const focus = scene?.camera.focus ?? focusAt(reframe, frame);
  const {left, top, vw, vh} = cameraCrop(rect, zoom, ctx.width, ctx.height, focus);
  const radius = amount * ctx.unit * 2 * (ctx.sb.fonts.radius / 1.4);
  return (
    <div style={{position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h, overflow: 'hidden', opacity, borderRadius: radius,
      boxShadow: amount > 0 ? `0 ${radius}px ${radius * 3}px rgba(0,0,0,${0.35 * amount})` : undefined, outline: ctx.sb.treatment === 'technical' && amount > 0 ? `${Math.max(1, ctx.unit * 0.15)}px solid ${alpha(ctx.sb.palette.accent, 0.6 * amount)}` : undefined}}>
      <OffthreadVideo src={src} muted style={{position: 'absolute', left, top, width: vw, height: vh}} />
    </div>
  );
};

// ---------------------------------------------------------------- primitivas

const KineticText: React.FC<{layer: Extract<ResolvedLayer, {type: 'text'}>; box: Box; ctx: Ctx; progress: number; overCamera: boolean}> = ({layer, box, ctx, progress, overCamera}) => {
  const frame = useCurrentFrame();
  const {sb, fps, unit, width, height} = ctx;
  const display = layer.role !== 'body' && layer.role !== 'caption' && layer.role !== 'label';
  const fit = fitText(layer.text, layer.role, layer.style?.size, box, width, height, sb.treatment, {display});
  const bg = layer.style?.background ?? 'none';
  const color = sb.palette[textColorToken(layer)];
  const weight = layer.style?.weight === 'regular' ? 500 : layer.style?.weight === 'black' ? 900 : display ? sb.fonts.displayWeight : 600;
  const family = display ? sb.fonts.display : sb.fonts.body;
  const marks = new Set((layer.highlight ?? []).map((word) => word.toLowerCase()));
  const emphasis = layer.emphasis ?? 'marker';
  // Criador + scrim = "sticker": cada palavra numa pílula de tinta (estilo creator), em vez de uma caixa genérica.
  const sticker = sb.treatment === 'creator' && bg === 'scrim' && layer.mode !== 'lines';
  const words = fit.text.split(/\s+/).filter(Boolean);
  const stagger = Math.max(1, Math.round((layer.mode === 'chars' ? 0.025 : 0.07) * fps));
  const shadow = overCamera && bg === 'none' ? '0 2px 12px rgba(0,0,0,0.65), 0 1px 2px rgba(0,0,0,0.8)' : undefined;
  const plain = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}%$]+/gu, '');
  const isMarked = (word: string) => [...marks].some((mark) => mark.split(/\s+/).map(plain).includes(plain(word)));
  let charIndex = 0;
  const typed = layer.mode === 'typewriter' ? Math.floor(interpolate(frame, [0, Math.max(fps * 0.4, [...fit.text].length * 0.035 * fps)], [0, [...fit.text].length], clampOpts)) : Infinity;
  const pieces = layer.mode === 'lines' ? fit.lines.map((line, i) => ({line, i})) : null;
  const inner = pieces ? pieces.map(({line, i}) => {
    const at = i * Math.round(0.18 * fps), m = interpolate(frame, [at, at + Math.round(0.35 * fps)], [0, 1], {...clampOpts, easing: easingFn('out')});
    return <div key={i} style={{clipPath: `inset(0 ${((1 - m) * 100).toFixed(2)}% 0 0)`, translate: `0px ${(1 - m) * unit * 1.5}px`}}>{line}</div>;
  }) : words.map((word, i) => {
    const at = layer.mode === 'words' ? i * stagger : 0;
    const appear = layer.mode === 'words' ? interpolate(frame, [at, at + Math.round(0.3 * fps)], [0, 1], {...clampOpts, easing: easingFn(sb.treatment === 'creator' ? 'snappy' : 'spring')}) : 1;
    const marked = isMarked(word), sweep = interpolate(frame, [at + Math.round(0.15 * fps), at + Math.round(0.5 * fps)], [0, 1], {...clampOpts, easing: easingFn('out')});
    const chars = [...word];
    const start = charIndex; charIndex += chars.length + 1;
    const content = layer.mode === 'chars' ? chars.map((c, j) => <span key={j} style={{opacity: interpolate(frame, [(start + j) * stagger, (start + j) * stagger + Math.round(0.12 * fps)], [0, 1], clampOpts)}}>{c}</span>)
      : layer.mode === 'typewriter' ? chars.slice(0, Math.max(0, typed - start)).join('') : word;
    return (
      <span key={`${i}-${word}`} style={{position: 'relative', display: 'inline-block', padding: sticker ? `${fit.size * 0.04}px ${fit.size * 0.16}px` : `0 ${fit.size * 0.06}px`, background: sticker ? sb.palette.ink : undefined, borderRadius: sticker ? fit.size * 0.14 : undefined, marginBottom: sticker ? fit.size * 0.1 : undefined, opacity: Math.min(1, appear * 1.4),
        translate: `0px ${(1 - appear) * fit.size * 0.35}px`, scale: sb.treatment === 'creator' && layer.mode === 'words' ? String(0.8 + 0.2 * appear) : undefined,
        color: marked && emphasis === 'color' ? sb.palette.accent : undefined}}>
        {marked && emphasis === 'marker' ? <span style={{position: 'absolute', left: 0, bottom: fit.size * 0.08, height: fit.size * 0.45, width: `${sweep * 100}%`, background: alpha(sb.palette.accent, sb.treatment === 'creator' ? 0.95 : 0.4), borderRadius: fit.size * 0.06, zIndex: -1}} /> : null}
        {marked && emphasis === 'underline' ? <span style={{position: 'absolute', left: 0, bottom: -fit.size * 0.04, height: Math.max(2, fit.size * 0.08), width: `${sweep * 100}%`, background: sb.palette.accent, borderRadius: fit.size}} /> : null}
        {marked && emphasis === 'box' ? <span style={{position: 'absolute', inset: `-${fit.size * 0.05}px -${fit.size * 0.02}px`, border: `${Math.max(2, fit.size * 0.06)}px solid ${sb.palette.accent}`, borderRadius: fit.size * 0.12, opacity: sweep}} /> : null}
        <span style={{position: 'relative', color: marked && emphasis === 'marker' && sb.treatment === 'creator' && sweep >= 0.45 ? sb.palette.ink : undefined}}>{content}</span>
      </span>
    );
  });
  const pad = bg === 'none' || sticker ? 0 : fit.size * 0.35;
  const background = bg === 'none' || sticker ? undefined : bg === 'scrim' ? 'rgba(0,0,0,0.55)' : sb.palette[bg];
  const justify = layer.align === 'left' ? 'flex-start' : layer.align === 'right' ? 'flex-end' : 'center';
  return (
    <div style={{width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: justify}}>
      <div style={{maxWidth: '100%', padding: pad, background, borderRadius: unit * sb.fonts.radius, fontFamily: family, fontWeight: weight, fontStyle: layer.style?.italic || layer.role === 'quote' && sb.treatment === 'editorial' ? 'italic' : undefined,
        fontSize: fit.size, lineHeight: fit.lineHeight, color, textAlign: layer.align, textShadow: shadow, letterSpacing: sb.fonts.upper && display ? '0.01em' : undefined, overflowWrap: 'break-word', opacity: layer.mode === 'static' ? progress || 1 : 1,
        display: pieces ? 'block' : 'flex', flexWrap: 'wrap', justifyContent: justify, columnGap: fit.size * 0.18}}>
        {layer.role === 'quote' ? <span style={{color: sb.palette.accent}}>“</span> : null}
        {inner}
        {layer.mode === 'typewriter' && typed < [...fit.text].length ? <span style={{opacity: Math.floor(frame / Math.round(fps / 3)) % 2 ? 0 : 1, color: sb.palette.accent}}>▍</span> : null}
        {layer.role === 'quote' ? <span style={{color: sb.palette.accent}}>”</span> : null}
      </div>
    </div>
  );
};

const Counter: React.FC<{layer: Extract<ResolvedLayer, {type: 'counter'}>; box: Box; ctx: Ctx}> = ({layer, box, ctx}) => {
  const frame = useCurrentFrame();
  const {sb, fps, unit} = ctx;
  const final = layer.value.toFixed(layer.decimals).replace('.', ',');
  const unitText = layer.unit ? (layer.unit === 'R$' || layer.unit === '$' ? `${layer.unit} ` : layer.unit === 'mil' ? ' mil' : layer.unit) : '';
  const chars = final.length + unitText.length, w = box.right - box.left, h = box.bottom - box.top;
  const size = Math.max(unit * 4, Math.min(h * (layer.label ? 0.62 : 0.85), w / (chars * 0.62)));
  const value = countValue(layer.from, layer.value, frame, Math.round(0.9 * fps), layer.decimals);
  const prefix = layer.unit === 'R$' || layer.unit === '$';
  return (
    <div style={{width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: unit}}>
      <div style={{fontFamily: sb.fonts.display, fontWeight: 900, fontSize: size, lineHeight: 1, color: colorOf(sb.palette, layer.style?.color, 'accent'), fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap'}}>{prefix ? unitText : ''}{value}{prefix ? '' : unitText}</div>
      {layer.label ? <div style={{fontFamily: sb.fonts.body, fontWeight: 700, fontSize: Math.max(unit * 2.6, size * 0.22), color: sb.palette.muted, textAlign: 'center', overflowWrap: 'break-word'}}>{layer.label}</div> : null}
    </div>
  );
};

const itemSize = (box: Box, rows: number, chars: number, unit: number, max = 5.2) => Math.max(unit * 2.6, Math.min(unit * max, (box.bottom - box.top) / (rows * 2.2), (box.right - box.left) / (Math.max(8, chars) * 0.56)));
const rise = (amount: number, unit: number): React.CSSProperties => ({opacity: amount, translate: `0px ${(1 - amount) * unit * 3}px`});

const Steps: React.FC<{layer: Extract<ResolvedLayer, {type: 'steps'}>; box: Box; ctx: Ctx}> = ({layer, box, ctx}) => {
  const frame = useCurrentFrame();
  const {sb, fps, unit} = ctx, length = layer.toFrame - layer.fromFrame;
  const reveal = revealFramesFor(layer.items.length, length, layer.revealFrames);
  const size = itemSize(box, layer.items.length, Math.max(...layer.items.map((item) => item.length)) + 4, unit, 6.6);
  const active = reveal.reduce((last, at, i) => (frame >= at ? i : last), 0);
  return (
    <div style={{width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: size * 0.55}}>
      {layer.items.map((item, i) => {
        const on = i === active, amount = revealAt(frame, reveal[i], fps);
        return (
          <div key={i} style={{display: 'flex', alignItems: 'center', gap: size * 0.6, ...rise(amount, unit)}}>
            <div style={{flex: 'none', width: size * 1.6, height: size * 1.6, borderRadius: sb.treatment === 'technical' ? unit * 0.6 : size, background: on ? sb.palette.accent : sb.palette.surface, border: `${Math.max(2, unit * sb.fonts.stroke)}px solid ${on ? sb.palette.accent : alpha(sb.palette.muted, 0.5)}`,
              color: on ? sb.palette.ink : sb.palette.muted, fontFamily: sb.fonts.display, fontWeight: 800, fontSize: size * 0.8, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>{sb.treatment === 'technical' ? String(i + 1).padStart(2, '0') : i + 1}</div>
            <div style={{fontFamily: sb.fonts.body, fontWeight: on ? 800 : 600, fontSize: size, lineHeight: 1.15, color: on ? sb.palette.text : sb.palette.muted, overflowWrap: 'break-word'}}>{item}</div>
          </div>
        );
      })}
    </div>
  );
};

const Process: React.FC<{layer: Extract<ResolvedLayer, {type: 'process'}>; box: Box; ctx: Ctx}> = ({layer, box, ctx}) => {
  const frame = useCurrentFrame();
  const {sb, fps, unit} = ctx, length = layer.toFrame - layer.fromFrame;
  const reveal = revealFramesFor(layer.nodes.length, length, layer.revealFrames);
  const row = (box.right - box.left) / Math.max(1, box.bottom - box.top) > 1.8 && layer.nodes.length <= 4;
  const chars = Math.max(...layer.nodes.map((node) => node.length));
  const size = row ? itemSize({...box, right: box.left + (box.right - box.left) / layer.nodes.length}, 3, Math.min(chars, 14), unit, 4.4) : itemSize(box, layer.nodes.length * 1.4, chars + 2, unit, 5.6);
  return (
    <div style={{width: '100%', height: '100%', display: 'flex', flexDirection: row ? 'row' : 'column', alignItems: row ? 'center' : 'stretch', justifyContent: 'center'}}>
      {layer.nodes.map((node, i) => {
        const amount = revealAt(frame, reveal[i], fps);
        const link = i ? interpolate(frame, [reveal[i] - Math.round(0.2 * fps), reveal[i] + Math.round(0.15 * fps)], [0, 1], {...clampOpts, easing: easingFn('out')}) : 0;
        const last = i === layer.nodes.length - 1;
        return (
          <React.Fragment key={i}>
            {i ? <div style={{flex: 'none', alignSelf: 'center', position: 'relative', ...(row ? {width: unit * 5, height: Math.max(3, unit * 0.45), margin: `0 ${unit * 0.6}px`} : {height: unit * 3.2, width: Math.max(3, unit * 0.45), margin: `${unit * 0.5}px 0`})}}>
              <div style={{position: 'absolute', left: 0, top: 0, background: sb.palette.accent, borderRadius: unit, ...(row ? {height: '100%', width: `${link * 100}%`} : {width: '100%', height: `${link * 100}%`})}} />
            </div> : null}
            <div style={{flex: row ? 1 : 'none', minWidth: 0, padding: `${size * 0.5}px ${size * 0.7}px`, borderRadius: unit * sb.fonts.radius, background: last ? alpha(sb.palette.accent, 0.18) : sb.palette.surface,
              border: `${Math.max(2, unit * sb.fonts.stroke)}px ${sb.treatment === 'technical' && !last ? 'dashed' : 'solid'} ${last ? sb.palette.accent : alpha(sb.palette.muted, 0.5)}`,
              fontFamily: sb.treatment === 'technical' ? sb.fonts.display : sb.fonts.body, fontWeight: 700, fontSize: size, lineHeight: 1.15, color: sb.palette.text, textAlign: 'center', overflowWrap: 'break-word', display: 'flex', alignItems: 'center', justifyContent: 'center', ...rise(amount, unit)}}>{node}</div>
          </React.Fragment>
        );
      })}
    </div>
  );
};

const Compare: React.FC<{layer: Extract<ResolvedLayer, {type: 'compare'}>; box: Box; ctx: Ctx}> = ({layer, box, ctx}) => {
  const frame = useCurrentFrame();
  const {sb, fps, unit} = ctx, length = layer.toFrame - layer.fromFrame;
  const reveal = revealFramesFor(2, length, layer.revealFrames);
  const row = (box.right - box.left) / Math.max(1, box.bottom - box.top) > 1.1;
  const longest = Math.max(layer.before.text.length, layer.after.text.length);
  const size = row ? itemSize({...box, right: box.left + (box.right - box.left) / 2}, 4, longest / 2 + 4, unit, 4.8) : itemSize(box, 5, longest + 2, unit, 4.8);
  const side = (item: {label: string; text: string}, i: number) => {
    const after = i === 1, amount = revealAt(frame, reveal[i], fps);
    const strike = !after ? interpolate(frame, [reveal[1], reveal[1] + Math.round(0.4 * fps)], [0, 1], {...clampOpts, easing: easingFn('out')}) : 0;
    return (
      <div key={i} style={{flex: 1, minWidth: 0, padding: size * 0.8, borderRadius: unit * sb.fonts.radius, background: after ? alpha(sb.palette.accent, 0.16) : sb.palette.surface, border: `${Math.max(2, unit * sb.fonts.stroke)}px solid ${after ? sb.palette.accent : alpha(sb.palette.muted, 0.45)}`, display: 'flex', flexDirection: 'column', gap: size * 0.35, ...rise(amount, unit)}}>
        <div style={{fontFamily: sb.fonts.body, fontWeight: 800, fontSize: size * 0.62, letterSpacing: '0.08em', textTransform: 'uppercase', color: after ? sb.palette.accent : sb.palette.muted}}>{item.label}</div>
        <div style={{position: 'relative', fontFamily: sb.fonts.display, fontWeight: after ? 800 : 600, fontSize: size, lineHeight: 1.15, color: after ? sb.palette.text : sb.palette.muted, overflowWrap: 'break-word'}}>
          {item.text}
          {!after ? <span style={{position: 'absolute', left: 0, top: '55%', height: Math.max(2, size * 0.08), width: `${strike * 100}%`, background: sb.palette.accent2}} /> : null}
        </div>
      </div>
    );
  };
  const arrow = interpolate(frame, [reveal[1] - Math.round(0.2 * fps), reveal[1] + Math.round(0.2 * fps)], [0, 1], clampOpts);
  return (
    <div style={{width: '100%', height: '100%', display: 'flex', flexDirection: row ? 'row' : 'column', alignItems: 'center', justifyContent: 'center', gap: unit * 1.6}}>
      {side(layer.before, 0)}
      <div style={{alignSelf: 'center', fontFamily: sb.fonts.body, fontWeight: 900, fontSize: size * 1.1, color: sb.palette.accent, opacity: arrow, rotate: row ? '0deg' : '90deg'}}>{'→'}</div>
      {side(layer.after, 1)}
    </div>
  );
};

const statText = (value: number, unit?: string) => {
  const text = (Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100)).replace('.', ',');
  return unit === 'R$' || unit === '$' ? `${unit} ${text}` : unit === 'mil' ? `${text} mil` : unit ? `${text}${unit}` : text;
};

const Bars: React.FC<{layer: Extract<ResolvedLayer, {type: 'bars'}>; box: Box; ctx: Ctx}> = ({layer, box, ctx}) => {
  const frame = useCurrentFrame();
  const {sb, fps, unit} = ctx, length = layer.toFrame - layer.fromFrame;
  const reveal = revealFramesFor(layer.values.length, length, layer.revealFrames);
  const max = Math.max(...layer.values.map((item) => item.value), 1e-9);
  const size = itemSize(box, layer.values.length * 2, 22, unit, 4.4);
  return (
    <div style={{width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: size * 0.7}}>
      {layer.values.map((item, i) => {
        const grow = interpolate(frame, [reveal[i], reveal[i] + Math.round(0.7 * fps)], [0, 1], {...clampOpts, easing: easingFn('out')});
        return (
          <div key={i} style={{display: 'flex', flexDirection: 'column', gap: size * 0.25, opacity: revealAt(frame, reveal[i], fps)}}>
            <div style={{display: 'flex', justifyContent: 'space-between', gap: unit, fontFamily: sb.fonts.body, fontSize: size, lineHeight: 1.1}}>
              <span style={{fontWeight: 700, color: sb.palette.text, overflowWrap: 'break-word'}}>{item.label}</span>
              <span style={{fontWeight: 900, color: i === layer.values.length - 1 ? sb.palette.accent : sb.palette.text, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontFamily: sb.fonts.display}}>{statText(item.value, item.unit)}</span>
            </div>
            <div style={{height: size * 0.7, borderRadius: sb.treatment === 'technical' ? unit * 0.3 : size, background: sb.palette.surface, overflow: 'hidden'}}>
              <div style={{height: '100%', width: `${(item.value / max) * 100 * grow}%`, borderRadius: 'inherit', background: i === layer.values.length - 1 ? sb.palette.accent : alpha(sb.palette.accent, 0.5)}} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

/** Moldura de screenshot/B-roll: cartão, navegador (barra com 3 pontos) ou celular. */
const Frame: React.FC<{kind: string; ctx: Ctx; caption?: string; children: React.ReactNode}> = ({kind, ctx, caption, children}) => {
  const {sb, unit} = ctx;
  const bar = kind === 'browser' ? unit * 3.4 : 0;
  return (
    <div style={{width: '100%', height: '100%', display: 'flex', flexDirection: 'column', gap: unit, alignItems: 'center', justifyContent: 'center'}}>
      <div style={{position: 'relative', flex: 1, minHeight: 0, width: kind === 'phone' ? undefined : '100%', aspectRatio: kind === 'phone' ? '9 / 19' : undefined, height: kind === 'phone' ? '100%' : undefined,
        borderRadius: kind === 'none' ? 0 : kind === 'phone' ? unit * 4 : unit * sb.fonts.radius, overflow: 'hidden', background: sb.palette.surface,
        border: kind === 'phone' ? `${unit * 1.1}px solid ${sb.palette.ink}` : kind === 'none' ? undefined : `${Math.max(1, unit * 0.2)}px solid ${alpha(sb.palette.muted, 0.4)}`, boxShadow: kind === 'none' ? undefined : `0 ${unit * 1.5}px ${unit * 5}px rgba(0,0,0,0.35)`}}>
        {kind === 'browser' ? <div style={{position: 'absolute', left: 0, right: 0, top: 0, height: bar, background: sb.palette.surface, display: 'flex', alignItems: 'center', gap: unit * 0.8, paddingLeft: unit * 1.4, borderBottom: `1px solid ${alpha(sb.palette.muted, 0.3)}`}}>
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => <div key={c} style={{width: unit * 1.1, height: unit * 1.1, borderRadius: unit, background: c}} />)}
        </div> : null}
        <div style={{position: 'absolute', left: 0, right: 0, top: bar, bottom: 0, overflow: 'hidden'}}>{children}</div>
      </div>
      {caption ? <div style={{fontFamily: sb.fonts.body, fontWeight: 600, fontSize: unit * 3, color: sb.palette.muted, textAlign: 'center', overflowWrap: 'break-word'}}>{caption}</div> : null}
    </div>
  );
};

const Picture: React.FC<{layer: Extract<ResolvedLayer, {type: 'image'}>; ctx: Ctx}> = ({layer, ctx}) => {
  const frame = useCurrentFrame();
  const src = ctx.assets?.[layer.assetId];
  if (!src) return null; // sem arquivo registrado nada é exibido (o adaptador já recusa o render nesse caso)
  const length = layer.toFrame - layer.fromFrame, kb = layer.kenBurns;
  const t = kb ? interpolate(frame, [0, length], [0, 1], {...clampOpts, easing: easingFn('inOut')}) : 0;
  const scale = kb ? kb.from.scale + (kb.to.scale - kb.from.scale) * t : 1, ox = kb ? kb.from.x + (kb.to.x - kb.from.x) * t : 0.5, oy = kb ? kb.from.y + (kb.to.y - kb.from.y) * t : 0.5;
  return (
    <Frame kind={layer.frame} ctx={ctx} caption={layer.caption}>
      <Img src={src} style={{width: '100%', height: '100%', objectFit: layer.fit, scale: String(scale), transformOrigin: `${ox * 100}% ${oy * 100}%`}} />
    </Frame>
  );
};

const Broll: React.FC<{layer: Extract<ResolvedLayer, {type: 'video'}>; ctx: Ctx}> = ({layer, ctx}) => {
  const src = ctx.assets?.[layer.assetId];
  if (!src) return null;
  return (
    <Frame kind={layer.frame} ctx={ctx} caption={layer.caption}>
      <OffthreadVideo src={src} muted trimBefore={Math.round(layer.trimStart * ctx.fps)} style={{width: '100%', height: '100%', objectFit: layer.fit}} />
    </Frame>
  );
};

const Shape: React.FC<{layer: Extract<ResolvedLayer, {type: 'shape'}>; box: Box; ctx: Ctx; progress: number}> = ({layer, box, ctx, progress}) => {
  const {sb, unit} = ctx, w = box.right - box.left, h = box.bottom - box.top, sw = Math.max(2, unit * sb.fonts.stroke * 2);
  const fill = layer.fill === 'none' ? 'none' : sb.palette[layer.fill], stroke = layer.stroke === 'none' ? 'none' : sb.palette[layer.stroke];
  const drawn = layer.enter?.preset === 'draw' ? progress : 1;
  return (
    <svg width={w} height={h} style={{overflow: 'visible'}}>
      {layer.shape === 'rect' ? <rect x={sw / 2} y={sw / 2} width={Math.max(0, w - sw)} height={Math.max(0, h - sw)} rx={unit * sb.fonts.radius} fill={fill} stroke={stroke} strokeWidth={sw} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - drawn} /> : null}
      {layer.shape === 'circle' ? <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - sw} ry={h / 2 - sw} fill={fill} stroke={stroke} strokeWidth={sw} /> : null}
      {layer.shape === 'ring' ? <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - sw} ry={h / 2 - sw} fill="none" stroke={fill === 'none' ? stroke : fill} strokeWidth={sw * 1.5} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - drawn} /> : null}
      {layer.shape === 'line' ? <line x1={0} y1={h / 2} x2={w * drawn} y2={h / 2} stroke={fill === 'none' ? stroke : fill} strokeWidth={sw * 1.5} strokeLinecap="round" /> : null}
    </svg>
  );
};

/** Seta desenhada progressivamente (dasharray por frame) com ponta que surge no fim. Coordenadas = frações da caixa. */
const Arrow: React.FC<{layer: Extract<ResolvedLayer, {type: 'arrow'}>; box: Box; ctx: Ctx; progress: number}> = ({layer, box, ctx, progress}) => {
  const {sb, unit} = ctx, w = box.right - box.left, h = box.bottom - box.top;
  const x1 = layer.from.x * w, y1 = layer.from.y * h, x2 = layer.to.x * w, y2 = layer.to.y * h;
  const mx = (x1 + x2) / 2 - (y2 - y1) * 0.18, my = (y1 + y2) / 2 + (x2 - x1) * 0.18, angle = Math.atan2(y2 - my, x2 - mx);
  const head = unit * 2.2, sw = Math.max(3, unit * 0.55), color = sb.palette[layer.color];
  const p = layer.enter?.preset && layer.enter.preset !== 'draw' ? 1 : progress;
  return (
    <svg width={w} height={h} style={{overflow: 'visible'}}>
      <path d={`M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} />
      <path d={`M ${x2 - head * Math.cos(angle - 0.5)} ${y2 - head * Math.sin(angle - 0.5)} L ${x2} ${y2} L ${x2 - head * Math.cos(angle + 0.5)} ${y2 - head * Math.sin(angle + 0.5)}`} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" opacity={interpolate(p, [0.85, 1], [0, 1], clampOpts)} />
    </svg>
  );
};

/** Rótulo com linha até um ponto do QUADRO (ex.: detalhe de um screenshot) e alvo pulsando (seno do frame). */
const Callout: React.FC<{layer: Extract<ResolvedLayer, {type: 'callout'}>; box: Box; ctx: Ctx; progress: number}> = ({layer, box, ctx, progress}) => {
  const frame = useCurrentFrame();
  const {sb, unit, width, height, fps} = ctx;
  const tx = layer.target.x * width - box.left, ty = layer.target.y * height - box.top, w = box.right - box.left, h = box.bottom - box.top;
  const ax = Math.max(0, Math.min(w, tx)), ay = Math.max(0, Math.min(h, ty));
  const size = Math.max(unit * 2.6, Math.min(unit * 4.2, h * 0.5, w / (Math.max(8, layer.text.length) * 0.55)));
  const pulse = 1 + 0.25 * Math.sin((frame / fps) * Math.PI * 2);
  return (
    <div style={{position: 'relative', width: '100%', height: '100%'}}>
      <svg width={w} height={h} style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
        <line x1={ax} y1={ay} x2={tx} y2={ty} stroke={sb.palette.accent} strokeWidth={Math.max(2, unit * 0.35)} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - progress} />
        <circle cx={tx} cy={ty} r={unit * 1.2 * pulse} fill="none" stroke={sb.palette.accent} strokeWidth={Math.max(2, unit * 0.3)} opacity={progress} />
        <circle cx={tx} cy={ty} r={unit * 0.55} fill={sb.palette.accent} opacity={progress} />
      </svg>
      <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
        <div style={{padding: `${size * 0.35}px ${size * 0.6}px`, background: sb.palette.ink, color: '#ffffff', border: `${Math.max(2, unit * 0.25)}px solid ${sb.palette.accent}`, borderRadius: unit * sb.fonts.radius, fontFamily: sb.fonts.body, fontWeight: 700, fontSize: size, lineHeight: 1.15, overflowWrap: 'break-word', textAlign: 'center'}}>{layer.text}</div>
      </div>
    </div>
  );
};

const Chapter: React.FC<{layer: Extract<ResolvedLayer, {type: 'chapter'}>; box: Box; ctx: Ctx}> = ({layer, box, ctx}) => {
  const frame = useCurrentFrame();
  const {sb, unit, fps, width, height} = ctx;
  const fit = fitText(layer.text, 'title', layer.style?.size, {...box, left: box.left + unit * 17}, width, height, sb.treatment, {maxLines: 1});
  const rule = interpolate(frame, [Math.round(0.1 * fps), Math.round(0.7 * fps)], [0, 1], {...clampOpts, easing: easingFn('out')});
  return (
    <div style={{width: '100%', height: '100%', display: 'flex', alignItems: 'center', gap: unit * 2}}>
      <div style={{fontFamily: sb.fonts.display, fontWeight: 900, fontSize: Math.min(unit * 11, (box.bottom - box.top) * 0.8), lineHeight: 1, color: sb.palette.accent, fontVariantNumeric: 'tabular-nums'}}>{String(layer.index).padStart(2, '0')}</div>
      <div style={{flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: unit * 0.8}}>
        <div style={{height: Math.max(2, unit * 0.35), width: `${rule * 100}%`, background: sb.palette.accent, borderRadius: unit}} />
        <div style={{fontFamily: sb.fonts.display, fontWeight: sb.fonts.displayWeight, fontSize: fit.size, lineHeight: 1.1, color: colorOf(sb.palette, layer.style?.color, 'text'), whiteSpace: 'nowrap'}}>{fit.text}</div>
      </div>
    </div>
  );
};

/** Escurece o quadro todo menos o alvo (caixa em frações do quadro): sombra gigante, sem mask-image. */
const Spotlight: React.FC<{layer: Extract<ResolvedLayer, {type: 'spotlight'}>; ctx: Ctx; progress: number}> = ({layer, ctx, progress}) => {
  const {width, height, unit, sb} = ctx, grow = (1 - progress) * unit * 6;
  const x = layer.target.x * width - grow, y = layer.target.y * height - grow, w = layer.target.w * width + grow * 2, h = layer.target.h * height + grow * 2;
  return <div style={{position: 'absolute', left: x, top: y, width: w, height: h, borderRadius: unit * 1.5, boxShadow: `0 0 0 ${Math.max(width, height) * 2}px rgba(0,0,0,${layer.dim * progress})`, outline: `${Math.max(2, unit * 0.3)}px solid ${alpha(sb.palette.accent, progress)}`}} />;
};

// ---------------------------------------------------------------- camada / cena

const Layer: React.FC<{layer: ResolvedLayer; scene: ResolvedScene; ctx: Ctx; index: number}> = ({layer, scene, ctx, index}) => {
  const frame = useCurrentFrame();
  const {sb, width, height, unit} = ctx;
  const env = layerEnvelope(layer, frame, sb.defaults, {width, height, unit});
  if (env.opacity <= 0.001) return null;
  const box = slotBox(layer, scene.camera.layout, width, height, sb.protect);
  const overCamera = scene.camera.layout === 'full';
  if (layer.type === 'spotlight') return <div style={{position: 'absolute', inset: 0, zIndex: layer.z ?? index, opacity: env.opacity}}><Spotlight layer={layer} ctx={ctx} progress={env.progress} /></div>;
  const style: React.CSSProperties = {position: 'absolute', left: box.left, top: box.top, width: box.right - box.left, height: box.bottom - box.top, zIndex: layer.z ?? index, opacity: env.opacity,
    translate: `${env.dx}px ${env.dy}px`, scale: String(env.scale), rotate: `${env.rotate}deg`, filter: env.blur > 0.05 ? `blur(${env.blur}px)` : undefined, clipPath: env.clipPath, boxSizing: 'border-box'};
  let content: React.ReactNode = null;
  switch (layer.type) {
    case 'text': content = <KineticText layer={layer} box={box} ctx={ctx} progress={env.progress} overCamera={overCamera} />; break;
    case 'counter': content = <Counter layer={layer} box={box} ctx={ctx} />; break;
    case 'steps': content = <Steps layer={layer} box={box} ctx={ctx} />; break;
    case 'process': content = <Process layer={layer} box={box} ctx={ctx} />; break;
    case 'compare': content = <Compare layer={layer} box={box} ctx={ctx} />; break;
    case 'bars': content = <Bars layer={layer} box={box} ctx={ctx} />; break;
    case 'image': content = <Picture layer={layer} ctx={ctx} />; break;
    case 'video': content = <Broll layer={layer} ctx={ctx} />; break;
    case 'shape': content = <Shape layer={layer} box={box} ctx={ctx} progress={env.progress} />; break;
    case 'arrow': content = <Arrow layer={layer} box={box} ctx={ctx} progress={env.progress} />; break;
    case 'callout': content = <Callout layer={layer} box={box} ctx={ctx} progress={env.progress} />; break;
    case 'chapter': content = <Chapter layer={layer} box={box} ctx={ctx} />; break;
    default: content = null;
  }
  return <div style={style}>{content}</div>;
};

const ScenePlate: React.FC<{scene: ResolvedScene; ctx: Ctx}> = ({scene, ctx}) => {
  const frame = useCurrentFrame();
  const t = sceneTransition(scene, frame, ctx);
  return (
    <div style={{position: 'absolute', inset: 0, opacity: t.opacity, translate: `${t.dx}px ${t.dy}px`, scale: String(t.scale), clipPath: t.clipPath}}>
      {scene.layers.map((layer, i) => (
        <Sequence key={layer.id} name={`${scene.name ?? scene.id} · ${layer.id}`} from={layer.fromFrame - scene.startFrame} durationInFrames={layer.toFrame - layer.fromFrame} layout="none">
          <Layer layer={layer} scene={scene} ctx={ctx} index={i + 1} />
        </Sequence>
      ))}
    </div>
  );
};

/** Placa de fundo de uma cena (sob a câmera), visível quando o layout tira a câmera da tela cheia. */
const PlateLayer: React.FC<{ctx: Ctx}> = ({ctx}) => {
  const frame = useCurrentFrame();
  const {plate, scene} = storyboardCamera(ctx.sb.scenes, frame, ctx.fps, ctx.width, ctx.height, ctx.sb.protect);
  if (!scene || plate <= 0) return null;
  return <Backdrop scene={scene} ctx={ctx} opacity={plate} />;
};

/** Gravação da tela sob a câmera (somente onde a cena/padrão pede tela E a trilha existe naquele frame). */
const ScreenLayer: React.FC<{ctx: Ctx}> = ({ctx}) => {
  const frame = useCurrentFrame();
  const {scene} = storyboardCamera(ctx.sb.scenes, frame, ctx.fps, ctx.width, ctx.height, ctx.sb.protect);
  const mode = screenModeAt(ctx, scene);
  if (mode === 'off' || !ctx.screen || !ctx.screenSrc || !screenAvailable(ctx.screen, frame)) return null;
  return <ScreenStage screen={ctx.screen} src={ctx.screenSrc} mode={mode} background={ctx.sb.palette.bg} protect={ctx.sb.protect} radius={ctx.unit * ctx.sb.fonts.radius} />;
};

export const StoryboardVideo: React.FC<{sb: StoryboardProps; src: string; assets?: Record<string, string>; reframe?: ReframeProps; screen?: ScreenProps; screenSrc?: string}> = ({sb, src, assets, reframe, screen, screenSrc}) => {
  const {width, height, fps} = useVideoConfig();
  const ctx: Ctx = {sb, width, height, unit: Math.min(width, height) / 100, fps, assets, ...(screen && screenSrc ? {screen, screenSrc} : {})};
  return (
    <div style={{position: 'absolute', inset: 0, background: sb.palette.bg}}>
      <PlateLayer ctx={ctx} />
      <ScreenLayer ctx={ctx} />
      <StoryCamera src={src} ctx={ctx} reframe={reframe} />
      {sb.scenes.map((scene) => (
        <Sequence key={scene.id} name={scene.name ?? scene.id} from={scene.startFrame} durationInFrames={scene.endFrame - scene.startFrame} premountFor={fps}>
          <ScenePlate scene={scene} ctx={ctx} />
        </Sequence>
      ))}
    </div>
  );
};

