// Props resolvidas pelo adaptador (editorial-remotion.mjs). Todos os tempos em segundos
// absolutos do vídeo já cortado; a composição só converte para frames, sem decidir nada.
export type TimedWindow = {from: number; to: number};
export type TitleOverlay = TimedWindow & {text: string};
export type LowerThirdOverlay = TimedWindow & {name: string; role?: string};
export type CtaOverlay = TimedWindow & {text: string};

/** Visual explicativo: só texto/números ditos na fala (origin speech) ou fornecidos pelo usuário (origin user). */
export type ExplainerVisual =
  | {type: 'compare'; before: {label: string; text: string}; after: {label: string; text: string}}
  | {type: 'steps'; items: string[]}
  | {type: 'stat'; chart: 'number' | 'bar'; values: {label: string; value: number; unit?: '%' | 'x' | 'k' | 'mil' | 'R$' | '$'}[]}
  | {type: 'process'; nodes: string[]}
  | {type: 'image'; assetId: string; caption?: string};
export type ExplainerProps = {visual: ExplainerVisual; origin: 'speech' | 'user'; revealFrames: number[]};

// Motion já resolvido em frames pelo adaptador (editorial-motion-plan.mjs resolveMotionProps).
export type MotionCue = {
  id: string;
  kind: 'punchIn' | 'kineticText' | 'keyPoint' | 'explainer';
  layout: 'camera-full' | 'split' | 'motion-focus';
  startFrame: number;
  endFrame: number;
  strength: number;
  scale?: number;
  text?: string;
  focus?: string;
  explainer?: ExplainerProps;
};
/** Ponto de foco no vídeo editado (frame) com centro x,y e caixa do rosto w,h opcionais, normalizados 0..1. */
export type FocusPoint = {frame: number; x: number; y: number; w?: number; h?: number};
export type ReframeProps = {mode: 'fixed' | 'manual' | 'face'; source: 'default' | 'user' | 'detected'; points: FocusPoint[]};
/** Faixa protegida (ex.: legenda queimada), frações da altura. */
export type ProtectProps = {captionBand?: {top: number; bottom: number}};
export type MotionProps = {intensity: 'off' | 'subtle' | 'balanced' | 'intense'; cues: MotionCue[]; sfx: {kind: string; at: number; gainDb: number}[]; reframe?: ReframeProps; protect?: ProtectProps};

export type OverlayVideoProps = {
  src: string;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  theme: 'dark' | 'light';
  accent: string;
  title?: TitleOverlay;
  lowerThird?: LowerThirdOverlay;
  cta?: CtaOverlay;
  motion?: MotionProps;
  /** assetId -> URL local (media server loopback no render; URL local na prévia). Nunca URL remota. */
  assets?: Record<string, string>;
};

export const COMPOSITION_ID = 'OverlayVideo';
