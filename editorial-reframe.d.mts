import type {TimeRange} from './editorial-motion-plan.mjs';

export type ReframeMode = 'fixed' | 'manual' | 'face';
export type ReframeSource = 'default' | 'user' | 'detected';
/** `t` = tempo da GRAVAÇÃO (âncora); `at` = tempo no vídeo editado, sempre recalculado por normalizeReframe. x,y = centro; w,h = caixa do rosto (0..1). */
export type FocusPoint = {t: number; x: number; y: number; w?: number; h?: number; at?: number};
export type FaceDetectorInfo = {name: string; version: string; sampledFps: number; coverage: number};
export type Reframe = {mode: ReframeMode; source: ReframeSource; points: FocusPoint[]; detector?: FaceDetectorInfo};
export type ReframeRenderProps = {mode: ReframeMode; source: ReframeSource; points: {frame: number; x: number; y: number; w?: number; h?: number}[]};
export type FaceBox = {x: number; y: number; w: number; h: number};
export type FaceSample = {t: number; box: FaceBox | null; score: number};
export type DetectorFrame = {t: number; rgba: Uint8ClampedArray; width: number; height: number};
/** Detector injetado (ex.: MediaPipe Face Detector com modelo/wasm LOCAIS aprovado pelo integrador). Caixa em pixels do quadro. */
export type FaceDetector = {name: string; version?: string; detect(frame: DetectorFrame): Promise<{box: {x: number; y: number; width: number; height: number}; score: number}[]> | {box: {x: number; y: number; width: number; height: number}; score: number}[]};

export const DEFAULT_FOCUS: Readonly<{x: number; y: number}>;
export const reframeModes: readonly ReframeMode[];
export const reframeSources: readonly ReframeSource[];
export const REFRAME_LIMITS: Readonly<{maxPoints: number; maxSampleFps: number; maxSeconds: number; minBox: number}>;
export function sourceToEdited(t: number, segments: TimeRange[]): number | null;
export function editedToSource(t: number, segments: TimeRange[]): number | null;
export function normalizeReframe(raw: unknown, segments: TimeRange[]): Reframe | undefined;
export function fixedReframe(focus?: {x: number; y: number}, source?: 'default' | 'user'): Reframe;
export function manualReframe(points: {t: number; x: number; y: number; w?: number; h?: number}[]): Reframe;
export function smoothFaceSamples(samples: FaceSample[], options?: {minScore?: number; deadzone?: number; maxSpeed?: number; boxEase?: number; detector?: {name: string; version: string; sampledFps: number}}): {reframe: Reframe; coverage: number; reason: string | null};
export function faceDetectorStatus(detector?: FaceDetector): {available: false; reason: string} | {available: true; name: string; version: string};
export function sampleFramesForDetection(input: {ffmpeg?: string; inputPath: string; sourceWidth: number; sourceHeight: number; fps?: number; width?: number; signal?: AbortSignal; maxSeconds?: number}): AsyncGenerator<DetectorFrame>;
export function detectFaceTrack(input: {inputPath: string; sourceWidth: number; sourceHeight: number; detector: FaceDetector; fps?: number; width?: number; ffmpeg?: string; signal?: AbortSignal; minScore?: number; sample?: typeof sampleFramesForDetection}): Promise<{reframe: Reframe; coverage: number; reason: string | null; samples: number}>;
export function reframeRenderProps(reframe: Reframe | undefined, metadata: {fps: number; durationSeconds: number}): ReframeRenderProps | undefined;
/** FFmpeg `scale,crop` que converte a proporção recortando ao redor do foco (x/y por keyframe no tempo editado). */
export function reframeCropFilter(reframe: Reframe | undefined, size: {sourceWidth: number; sourceHeight: number; width: number; height: number; maxPoints?: number}): {filter: string; scaledWidth: number; scaledHeight: number};
