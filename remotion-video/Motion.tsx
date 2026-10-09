import React from 'react';
import {Easing, OffthreadVideo, Sequence, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import type {MotionCue, MotionProps, OverlayVideoProps, ProtectProps} from './types';
import {EASE_OUT, cameraCrop, cameraState, cardBox, clampOpts, layoutAmount, panelRect, safeArea, shapeOf, textBand} from './layout';
import {ExplainerCard} from './Explainer';

// Motion dinâmico guiado pelo plano (editorial-motion-plan.mjs). Tudo é função do frame: sem CSS transition/animation,
// sem aleatoriedade, sem assets externos. Enquadramento: trilha do plano (foco fixo, manual ou de um detector facial
// quando houver); sem trilha, o ponto focal fica no terço superior central. Textos ficam fora dele, na área segura.
const FONT = '"Segoe UI", "Helvetica Neue", Arial, system-ui, sans-serif';
/** Câmera recortada (cover) dentro do retângulo, mantendo o ponto focal visível; o punch-in amplia ao redor dele. */
export const CameraLayer: React.FC<{src: string; motion?: MotionProps}> = ({src, motion}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const {rect, amount, zoom, focus} = cameraState(motion, frame, fps, width, height);
  const {left, top, vw, vh} = cameraCrop(rect, zoom, width, height, focus);
  const radius = amount * Math.min(width, height) * 0.02;
  return (
    <div style={{position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h, overflow: 'hidden', borderRadius: radius, boxShadow: amount > 0 ? `0 ${radius}px ${radius * 3}px rgba(0,0,0,${0.35 * amount})` : undefined}}>
      <OffthreadVideo src={src} style={{position: 'absolute', left, top, width: vw, height: vh}} />
    </div>
  );
};

const numberIn = (text: string) => /(\d+(?:[.,]\d+)?)/.exec(text)?.[1];
const suffixOf = (text: string) => /\d+(?:[.,]\d+)?\s*(%|x|mil|k)/i.exec(text)?.[1] ?? '';

/** Palavras surgindo uma a uma (mola sem quique), destaque varrendo a palavra enfatizada. */
const KineticWords: React.FC<{text: string; focus?: string; size: number; accent: string; color: string; align: 'center' | 'left'}> = ({text, focus, size, accent, color, align}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const stagger = Math.max(1, Math.round(0.08 * fps));
  const words = text.split(/\s+/).filter(Boolean);
  const focusKey = focus?.toLowerCase();
  return (
    <div style={{display: 'flex', flexWrap: 'wrap', justifyContent: align === 'center' ? 'center' : 'flex-start', gap: `${size * 0.12}px ${size * 0.28}px`, fontFamily: FONT, fontWeight: 800, fontSize: size, lineHeight: 1.08, color}}>
      {words.map((word, index) => {
        const start = index * stagger;
        const isFocus = Boolean(focusKey) && word.toLowerCase().replace(/[^\p{L}\p{N}%$€£]+/gu, '') === focusKey;
        return (
          <span key={`${index}-${word}`} style={{
            position: 'relative', display: 'inline-block', padding: `0 ${size * 0.08}px`,
            opacity: interpolate(frame, [start, start + Math.round(0.12 * fps)], [0, 1], clampOpts),
            scale: interpolate(frame, [start, start + Math.round(0.3 * fps)], [0.7, 1], {...clampOpts, easing: Easing.spring({damping: 200}), output: 'perceptual-scale'}),
            translate: interpolate(frame, [start, start + Math.round(0.3 * fps)], [`0px ${size * 0.35}px`, '0px 0px'], {...clampOpts, easing: Easing.spring({damping: 200})})
          }}>
            {isFocus ? <span style={{position: 'absolute', left: 0, bottom: size * 0.06, height: size * 0.42, background: accent, borderRadius: size * 0.08, zIndex: -1,
              width: interpolate(frame, [start + Math.round(0.15 * fps), start + Math.round(0.45 * fps)], [0, 100], {...clampOpts, easing: EASE_OUT}) + '%'}} /> : null}
            {word}
          </span>
        );
      })}
    </div>
  );
};

/**
 * Fundo do painel (sob a câmera): aparece logo (sem faixa preta enquanto a câmera encolhe/volta). Em transição direta
 * entre dois layouts já começa opaco e cobre o quadro todo, para a câmera migrar de uma janela para outra sem buraco.
 */
const PanelBackdrop: React.FC<{cue: MotionCue; accent: string; theme: 'dark' | 'light'; joinedIn: boolean; protect?: ProtectProps}> = ({cue, accent, theme, joinedIn, protect}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const length = cue.endFrame - cue.startFrame, panel = panelRect(cue.layout, width, height, protect);
  // Só a ENTRADA faz o fundo aparecer; na saída ele fica opaco até a câmera voltar à tela cheia (sem faixa preta).
  const enter = joinedIn || frame >= length / 2 ? 1 : layoutAmount({...cue, startFrame: 0, endFrame: length}, frame, fps);
  const bg = theme === 'light' ? '#f4f5f8' : '#0d1018';
  return (
    <div style={{position: 'absolute', inset: 0, opacity: Math.min(1, enter * 4)}}>
      <div style={{position: 'absolute', inset: 0, background: bg}} />
      <div style={{position: 'absolute', left: panel.x, top: panel.y, width: panel.w, height: panel.h, background: `radial-gradient(120% 90% at 30% 20%, ${accent}33, ${bg} 60%)`}} />
    </div>
  );
};

const exitFade = (frame: number, length: number, fps: number) => interpolate(frame, [length - Math.max(2, Math.round(0.2 * fps)), length], [1, 0], clampOpts);

/** Tipografia cinética na área segura, fora do terço focal; sobe para o topo se tarja/CTA ocupam a base. */
const KineticText: React.FC<{cue: MotionCue; accent: string; lowBusy: boolean; protect?: ProtectProps}> = ({cue, accent, lowBusy, protect}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const safe = safeArea(width, height), band = textBand(width, height, protect), size = Math.min(width, height) / 100 * (shapeOf(width, height) === 'portrait' ? 7.4 : 6.2) * (0.9 + 0.2 * cue.strength);
  const length = cue.endFrame - cue.startFrame;
  const place: React.CSSProperties = lowBusy ? {top: band.top} : {bottom: height - band.bottom};
  return (
    <div style={{position: 'absolute', left: safe.left, width: safe.right - safe.left, ...place, display: 'flex', justifyContent: 'center', opacity: exitFade(frame, length, fps)}}>
      <div style={{maxWidth: '92%', textShadow: '0 2px 10px rgba(0,0,0,0.55)', overflowWrap: 'anywhere'}}>
        <KineticWords text={cue.text ?? ''} focus={cue.focus} size={size} accent={accent} color="#ffffff" align="center" />
      </div>
    </div>
  );
};

/** Cartão explicativo no painel (tela dividida ou motion em destaque): índice, número animado quando houver, frase cinética. */
const KeyPointCard: React.FC<{cue: MotionCue; index: number; accent: string; theme: 'dark' | 'light'; part: 'front'; protect?: ProtectProps}> = ({cue, index, accent, theme, protect}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const length = cue.endFrame - cue.startFrame;
  const box = cardBox(cue.layout, width, height, protect);
  const enter = layoutAmount({...cue, startFrame: 0, endFrame: length}, frame, fps);
  const colors = theme === 'light' ? {bg: '#f4f5f8', text: '#12151c', muted: '#4a5160'} : {bg: '#0d1018', text: '#ffffff', muted: '#aab1c2'};
  const unit = Math.min(width, height) / 100, value = numberIn(cue.text ?? '');
  const shownNumber = value ? Math.round(interpolate(frame, [Math.round(0.2 * fps), Math.round(0.9 * fps)], [0, Number(value.replace(',', '.'))], {...clampOpts, easing: EASE_OUT}) * (value.includes('.') || value.includes(',') ? 10 : 1)) / (value.includes('.') || value.includes(',') ? 10 : 1) : null;
  return (
    <div style={{position: 'absolute', inset: 0, opacity: interpolate(enter, [0.7, 1], [0, 1], clampOpts)}}>
      <div style={{position: 'absolute', left: box.left, top: box.top, width: box.right - box.left, height: box.bottom - box.top, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: unit * 2.4, padding: unit * 2, boxSizing: 'border-box',
        translate: interpolate(enter, [0, 1], [`0px ${unit * 4}px`, '0px 0px'])}}>
        <div style={{display: 'flex', alignItems: 'center', gap: unit * 1.4}}>
          <div style={{width: unit * 5, height: unit * 5, borderRadius: unit * 2.5, background: accent, color: '#fff', fontFamily: FONT, fontWeight: 800, fontSize: unit * 2.8, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>{index}</div>
          <div style={{height: Math.max(2, unit * 0.5), borderRadius: unit, background: accent, width: interpolate(frame, [Math.round(0.15 * fps), Math.round(0.7 * fps)], [0, unit * 18], {...clampOpts, easing: EASE_OUT})}} />
        </div>
        {shownNumber !== null ? <div style={{fontFamily: FONT, fontWeight: 900, fontSize: unit * 16, lineHeight: 1, color: accent, fontVariantNumeric: 'tabular-nums'}}>{String(shownNumber).replace('.', value?.includes(',') ? ',' : '.')}{suffixOf(cue.text ?? '')}</div> : null}
        <KineticWords text={cue.text ?? ''} focus={cue.focus} size={unit * (shapeOf(width, height) === 'landscape' ? 6 : 6.8)} accent={`${accent}99`} color={colors.text} align="left" />
      </div>
    </div>
  );
};

/** Camadas de motion: `backdrop` fica sob a câmera (painel do cartão), `front` acima dela. Cada cue vive na sua Sequence (premount de 1 s, como recomendam as skills Remotion). */
export const MotionLayers: React.FC<{props: OverlayVideoProps; part: 'backdrop' | 'front'}> = ({props, part}) => {
  const {fps} = useVideoConfig();
  const motion = props.motion;
  if (!motion) return null;
  const lowWindows = [props.lowerThird, props.cta].filter(Boolean).map((item) => ({from: Math.round(item!.from * fps), to: Math.round(item!.to * fps)}));
  const layoutCues = motion.cues.filter((cue) => cue.layout !== 'camera-full');
  const joinedIn = (cue: MotionCue) => layoutCues.some((other) => other !== cue && other.endFrame === cue.startFrame);
  let keyIndex = 0;
  return (
    <>
      {motion.cues.map((cue) => {
        const duration = cue.endFrame - cue.startFrame;
        if (cue.kind === 'keyPoint' || cue.kind === 'explainer') {
          keyIndex += 1;
          const name = `${cue.kind === 'keyPoint' ? 'Cartão' : 'Explicativo'} ${keyIndex}`;
          if (part === 'backdrop') return <Sequence key={cue.id} name={name} from={cue.startFrame} durationInFrames={duration} premountFor={fps}><PanelBackdrop cue={cue} accent={props.accent} theme={props.theme} joinedIn={joinedIn(cue)} protect={motion.protect} /></Sequence>;
          return <Sequence key={cue.id} name={name} from={cue.startFrame} durationInFrames={duration} premountFor={fps}>
            {cue.kind === 'keyPoint'
              ? <KeyPointCard cue={cue} index={keyIndex} accent={props.accent} theme={props.theme} part="front" protect={motion.protect} />
              : <ExplainerCard cue={cue} accent={props.accent} theme={props.theme} protect={motion.protect} assets={props.assets} />}
          </Sequence>;
        }
        if (cue.kind === 'kineticText' && part === 'front') {
          const lowBusy = lowWindows.some((window) => cue.startFrame < window.to && cue.endFrame > window.from);
          return <Sequence key={cue.id} name={`Texto ${cue.id}`} from={cue.startFrame} durationInFrames={duration} premountFor={fps}><KineticText cue={cue} accent={props.accent} lowBusy={lowBusy} protect={motion.protect} /></Sequence>;
        }
        return null;
      })}
    </>
  );
};
