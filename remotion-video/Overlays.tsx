import React from 'react';
import {Easing, OffthreadVideo, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import type {OverlayVideoProps, TimedWindow} from './types';
import {CameraLayer, MotionLayers} from './Motion';

// Somente fontes do sistema e formas CSS: sem imagens, fontes remotas ou JS fornecido pelo usuário.
const FONT = '"Segoe UI", "Helvetica Neue", Arial, system-ui, sans-serif';
const FADE_SECONDS = 0.3;

const palette = (theme: 'dark' | 'light') =>
  theme === 'light'
    ? {panel: 'rgba(255,255,255,0.92)', text: '#12151c', muted: '#4a5160'}
    : {panel: 'rgba(12,14,20,0.86)', text: '#ffffff', muted: '#c9ceda'};

// 0→1 na entrada, 1→0 na saída; determinístico por frame.
const useWindowProgress = ({from, to}: TimedWindow) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const start = Math.round(from * fps);
  const end = Math.round(to * fps);
  const fade = Math.max(1, Math.min(Math.round(FADE_SECONDS * fps), Math.floor((end - start) / 2)));
  if (frame < start || frame >= end) return 0;
  return interpolate(frame, [start, start + fade, end - fade, end], [0, 1, 1, 0], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  });
};

type OverlayProps = {props: OverlayVideoProps; unit: number};

const Title: React.FC<OverlayProps> = ({props, unit}) => {
  const overlay = props.title!;
  const progress = useWindowProgress(overlay);
  const colors = palette(props.theme);
  if (progress <= 0) return null;
  return (
    <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: progress}}>
      <div style={{
        maxWidth: '86%', padding: `${unit * 2.4}px ${unit * 4}px`, background: colors.panel, color: colors.text,
        borderBottom: `${Math.max(2, unit * 0.9)}px solid ${props.accent}`, borderRadius: unit * 1.2,
        fontFamily: FONT, fontWeight: 800, fontSize: unit * 6.4, lineHeight: 1.12, textAlign: 'center',
        transform: `translateY(${(1 - progress) * unit * 3}px)`, overflowWrap: 'anywhere'
      }}>{overlay.text}</div>
    </div>
  );
};

const LowerThird: React.FC<OverlayProps> = ({props, unit}) => {
  const overlay = props.lowerThird!;
  const progress = useWindowProgress(overlay);
  const colors = palette(props.theme);
  if (progress <= 0) return null;
  return (
    <div style={{position: 'absolute', left: '5%', bottom: '8%', maxWidth: '78%', opacity: progress, transform: `translateX(${(1 - progress) * -unit * 6}px)`, display: 'flex', fontFamily: FONT}}>
      <div style={{width: Math.max(3, unit * 1), background: props.accent, borderRadius: unit * 0.5}} />
      <div style={{padding: `${unit * 1.4}px ${unit * 2.6}px`, background: colors.panel, color: colors.text, borderRadius: `0 ${unit}px ${unit}px 0`}}>
        <div style={{fontWeight: 800, fontSize: unit * 4.2, lineHeight: 1.15, overflowWrap: 'anywhere'}}>{overlay.name}</div>
        {overlay.role ? <div style={{fontWeight: 500, fontSize: unit * 2.8, lineHeight: 1.2, color: colors.muted, overflowWrap: 'anywhere'}}>{overlay.role}</div> : null}
      </div>
    </div>
  );
};

const Cta: React.FC<OverlayProps> = ({props, unit}) => {
  const overlay = props.cta!;
  const progress = useWindowProgress(overlay);
  if (progress <= 0) return null;
  return (
    <div style={{position: 'absolute', left: 0, right: 0, bottom: '9%', display: 'flex', justifyContent: 'center', opacity: progress}}>
      <div style={{
        maxWidth: '84%', padding: `${unit * 1.8}px ${unit * 4.2}px`, background: props.accent, color: '#ffffff',
        borderRadius: unit * 5, fontFamily: FONT, fontWeight: 800, fontSize: unit * 4.6, lineHeight: 1.15, textAlign: 'center',
        transform: `translateY(${(1 - progress) * unit * 4}px) scale(${0.94 + 0.06 * progress})`, overflowWrap: 'anywhere',
        textShadow: '0 1px 2px rgba(0,0,0,0.35)'
      }}>{overlay.text}</div>
    </div>
  );
};

export const OverlayVideo: React.FC<OverlayVideoProps> = (props) => {
  const {width, height} = useVideoConfig();
  const unit = Math.min(width, height) / 100;
  return (
    <div style={{position: 'relative', width, height, background: '#000', overflow: 'hidden'}}>
      {props.motion ? (
        <>
          <MotionLayers props={props} part="backdrop" />
          <CameraLayer src={props.src} motion={props.motion} />
          <MotionLayers props={props} part="front" />
        </>
      ) : (
        <OffthreadVideo src={props.src} style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain'}} />
      )}
      {props.title ? <Title props={props} unit={unit} /> : null}
      {props.lowerThird ? <LowerThird props={props} unit={unit} /> : null}
      {props.cta ? <Cta props={props} unit={unit} /> : null}
    </div>
  );
};
