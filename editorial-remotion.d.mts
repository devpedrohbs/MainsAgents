export const REMOTION_VERSION: string;
export const COMPOSITION_ID: string;
export const DEFAULT_BUNDLE_DIR: string;
export const LIMITS: Readonly<{title: number; name: number; role: number; cta: number; maxWidth: number; maxHeight: number; maxDurationSeconds: number; maxFps: number; minFps: number; minWindowSeconds: number}>;

export type RemotionErrorCode =
  | 'invalid_metadata' | 'invalid_animations' | 'invalid_input' | 'invalid_output' | 'output_exists'
  | 'dependency_missing' | 'bundle_missing' | 'browser_missing' | 'probe_failed' | 'metadata_mismatch'
  | 'input_changed' | 'render_failed' | 'verify_failed' | 'cancelled';
export class RemotionError extends Error {
  code: RemotionErrorCode;
  details?: unknown;
  constructor(code: RemotionErrorCode, message: string, details?: unknown);
}

/** Facts about the ALREADY CUT video, probed by the engine. */
export type VideoMetadata = {width: number; height: number; fps: number; durationSeconds: number; hasAudio: boolean};

export type AnimationSpec = {
  title?: {text: string; startSeconds?: number; durationSeconds?: number};
  lowerThird?: {name: string; role?: string; startSeconds?: number; durationSeconds?: number};
  cta?: {text: string; durationSeconds?: number};
  theme?: 'dark' | 'light';
  accent?: string;
  /** Normalized motion plan (edited timeline), see editorial-motion-plan.mjs. */
  motion?: import('./editorial-motion-plan.mjs').MotionPlan;
  /** Faixa protegida (legenda queimada), frações da altura; textos de motion nunca a invadem. */
  protect?: import('./editorial-motion-plan.mjs').MotionProtect;
};
export type TimedWindow = {from: number; to: number};
export type ResolvedAnimations = {
  theme: 'dark' | 'light';
  accent: string;
  title?: TimedWindow & {text: string};
  lowerThird?: TimedWindow & {name: string; role?: string};
  cta?: TimedWindow & {text: string};
  motion?: import('./editorial-motion-plan.mjs').MotionRenderProps;
};
export function validateMetadata(raw: unknown): VideoMetadata;
/** `assetIds` (render): ids com arquivo autorizado; cue de imagem sem id correspondente é rejeitada. */
export function resolveAnimations(raw: unknown, metadata: VideoMetadata, options?: {assetIds?: string[]}): ResolvedAnimations;
export function validateAnimations(raw: unknown, metadata: VideoMetadata, options?: {assetIds?: string[]}): ResolvedAnimations;
export const ASSET_LIMITS: Readonly<{maxAssets: number; maxBytes: number}>;
/** assetId -> caminho local JÁ autorizado pelo servidor; confere extensão, assinatura PNG/JPEG/WebP, tamanho e quantidade. */
export function validateAssetFiles(assetFiles: Record<string, string> | undefined): Promise<Record<string, string>>;

export type ProbeResult = VideoMetadata & {videoCodec: string; audioCodec?: string; audioChannels?: number; audioSampleRate?: number; audioDurationSeconds?: number};
export function resolveFfmpeg(explicit?: string): string | null;
export type FfmpegStatus = {ready: boolean; source: 'explicit' | 'path'; path?: string; version: string | null; reason: string | null};
export function checkFfmpeg(options?: {ffmpegPath?: string}): Promise<FfmpegStatus>;
export function resolveFfprobe(explicit?: string): string | null;
/** Compositor binaries directory for Remotion, rewritten from app.asar to app.asar.unpacked when packaged. */
export function resolveBinariesDirectory(explicit?: string): string | null;
export function probeVideo(file: string, options?: {ffprobePath?: string; signal?: AbortSignal}): Promise<ProbeResult>;

export type MediaServer = {port: number; url(name: string): string; close(): Promise<void>};
export function createMediaServer(files: Record<string, string>): Promise<MediaServer>;

export type BrowserResolution =
  | {status: 'ready'; source: 'explicit' | 'system' | 'remotion-cache'; path: string; chromeMode: 'chrome-for-testing' | 'headless-shell'}
  | {status: 'missing'; source: 'explicit' | 'none'; path: string | null; reason: string};
export function resolveBrowser(options?: {browserExecutable?: string}): BrowserResolution;
export function prepareRemotionBrowser(options?: {onProgress?: (p: {percent: number | null; downloadedBytes: number; totalSizeInBytes: number}) => void; signal?: AbortSignal}): Promise<unknown>;

export const REMOTION_LICENSE: Readonly<{name: string; url: string; summary: string; requiresReview: boolean}>;
export type RemotionCapabilities = {
  available: boolean;
  template: {id: string; overlays: string[]; limits: typeof LIMITS; defaults: Record<string, unknown>; inputExtensions: string[]; output: string};
  versions: Record<string, string | null>;
  bundle: {ready: boolean; path: string};
  browser: BrowserResolution;
  ffprobe: {ready: boolean; path: string | null};
  ffmpeg: FfmpegStatus;
  license: typeof REMOTION_LICENSE;
  reasons: string[];
};
export function getRemotionCapabilities(options?: {bundleDir?: string; browserExecutable?: string; ffprobePath?: string; ffmpegPath?: string}): Promise<RemotionCapabilities>;

export type RenderProgress = {phase: 'browser' | 'render' | 'verify'; progress: number};
export type RenderAnimatedVideoOptions = {
  inputPath: string;
  outputPath: string;
  metadata: VideoMetadata;
  animations: AnimationSpec;
  signal?: AbortSignal;
  onProgress?: (progress: RenderProgress) => void;
  browserExecutable?: string;
  bundleDir?: string;
  ffprobePath?: string;
  ffmpegPath?: string;
  /** Defaults to the platform compositor package outside app.asar. */
  binariesDirectory?: string;
  /** Imagens do usuário para explicativos: assetId -> caminho local resolvido/autorizado pelo servidor (nunca do cliente). */
  assetFiles?: Record<string, string>;
};
export type RenderAnimatedVideoResult = {
  outputPath: string; width: number; height: number; fps: number; durationSeconds: number; hasAudio: boolean;
  audio: {mode: 'copy' | 'encode' | 'none'; codec?: string; channels?: number; sampleRate?: number};
  browser: {source: string; path: string | null}; animations: ResolvedAnimations;
};
export function renderAnimatedVideo(options: RenderAnimatedVideoOptions): Promise<RenderAnimatedVideoResult>;
