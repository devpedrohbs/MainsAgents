export const REMOTION_VERSION: string;
export const COMPOSITION_ID: string;
export const DEFAULT_BUNDLE_DIR: string;
/** Layout versionado: <raiz>/versions/<sha16>/ imutável + <raiz>/current.json (troca atômica); render fixa uma versão. */
export const BUNDLE_SCHEMA: 'mainsagents.remotion-bundle/1';
export const BUNDLE_POINTER: 'current.json';
export const BUNDLE_MANIFEST: 'bundle-manifest.json';
export const BUNDLE_VERSION_PATTERN: RegExp;
export const BUNDLE_LEASE_TTL_MS: number;
export type BundleResolution = {ready: boolean; root: string; dir: string | null; layout: 'versioned' | 'flat' | null; version: string | null; sha256: string | null; reason: string | null};
/** Resolve raiz -> versão atual (ou layout plano legado com index.html). */
export function resolveRemotionBundle(bundleDir?: string): BundleResolution;
/** Hash real do conteúdo (caminhos ordenados + tamanho + sha256 por arquivo, sem bundle-manifest.json). */
export function bundleTreeSha256(dir: string): Promise<string>;
export function isPathInside(parent: string, child: string): boolean;
/** Bundle efetivamente usado no render (hash conferido); version null = layout plano legado. */
export type BundleIdentity = {sha256: string; version: string | null};
/** Fixa a versão de UM render (lease + hash conferido contra ponteiro/manifesto); chame release() ao terminar. */
export function pinRemotionBundle(bundleDir?: string): Promise<BundleIdentity & {dir: string; layout: 'versioned' | 'flat'; release(): Promise<void>}>;
export const LIMITS: Readonly<{title: number; name: number; role: number; cta: number; maxWidth: number; maxHeight: number; maxDurationSeconds: number; maxFps: number; minFps: number; minWindowSeconds: number}>;

export type RemotionErrorCode =
  | 'invalid_metadata' | 'invalid_animations' | 'invalid_input' | 'invalid_output' | 'output_exists'
  | 'dependency_missing' | 'bundle_missing' | 'browser_missing' | 'probe_failed' | 'metadata_mismatch'
  | 'input_changed' | 'render_failed' | 'verify_failed' | 'cancelled' | 'asset_hash_mismatch' | 'qa_failed';
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
  /** Storyboard autorado (editorial-storyboard.mjs). Exclusivo com title/lowerThird/cta e cues; motion só com reframe. */
  storyboard?: import('./editorial-storyboard.mjs').Storyboard;
};
export type TimedWindow = {from: number; to: number};
export type ResolvedAnimations = {
  theme: 'dark' | 'light';
  accent: string;
  title?: TimedWindow & {text: string};
  lowerThird?: TimedWindow & {name: string; role?: string};
  cta?: TimedWindow & {text: string};
  motion?: import('./editorial-motion-plan.mjs').MotionRenderProps;
  /** Storyboard resolvido em frames; seus SFX também aparecem em motion.sfx (mix local). */
  storyboard?: import('./editorial-storyboard.mjs').StoryboardProps;
};
export function validateMetadata(raw: unknown): VideoMetadata;
/** `assetIds` (render): ids com arquivo autorizado; cue de imagem sem id correspondente é rejeitada. */
export function resolveAnimations(raw: unknown, metadata: VideoMetadata, options?: {assetIds?: string[]}): ResolvedAnimations;
export function validateAnimations(raw: unknown, metadata: VideoMetadata, options?: {assetIds?: string[]}): ResolvedAnimations;
export const ASSET_LIMITS: Readonly<{maxAssets: number; maxBytes: number; maxVideoBytes: number}>;
/** Arquivo autorizado pelo SERVIDOR: caminho (legado) ou {path, sha256} — com sha256, o hash real do arquivo é conferido. */
export type AssetFileEntry = string | {path: string; sha256?: string};
/** assetId -> arquivo JÁ autorizado pelo servidor; confere extensão, assinatura (PNG/JPEG/WebP ou MP4/MOV/WebM), tamanho, quantidade e hash. */
export function validateAssetFiles(assetFiles: Record<string, AssetFileEntry> | undefined): Promise<Record<string, string>>;
export type StoryboardReport = {qa: import('./editorial-storyboard.mjs').StoryboardQa; manifest: Record<string, unknown>; contactSheetError?: string};
/** QA + manifesto do que foi aplicado (null quando não há storyboard). `cutsAt` = cortes no vídeo editado (s). */
export function storyboardReport(props: ResolvedAnimations, options: {width: number; height: number; fps: number; cutsAt?: number[]; focus?: {x: number; y: number}; assetsVerified?: string[]}): StoryboardReport | null;
/** Trecho [início, fim] em frames inclusivos dentro do vídeo; null = inteiro. */
export function resolveFrameRange(frameRange: unknown, totalFrames: number): [number, number] | null;

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
  bundle: {ready: boolean; path: string; root: string; layout: 'versioned' | 'flat' | null; version: string | null};
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
  assetFiles?: Record<string, AssetFileEntry>;
  /** Trecho de teste (frames inclusivos): renderiza só essa janela, com o áudio/SFX da mesma janela. */
  frameRange?: [number, number];
  /** 'block' (padrão): erros de QA do storyboard impedem o render (RemotionError 'qa_failed', details = relatório). */
  qaPolicy?: 'block' | 'report';
  /** Instantes de corte no vídeo editado (s), para a QA avisar transições sobre cortes. */
  cutsAt?: number[];
};
export type RenderAnimatedVideoResult = {
  outputPath: string; width: number; height: number; fps: number; durationSeconds: number; hasAudio: boolean;
  audio: {mode: 'copy' | 'encode' | 'mixed-sfx' | 'none'; codec?: string; channels?: number; sampleRate?: number};
  browser: {source: string; path: string | null}; animations: ResolvedAnimations;
  excerpt?: {frameRange: [number, number]; startSeconds: number; durationSeconds: number};
  storyboard?: StoryboardReport;
  /** Também em storyboard.manifest.bundle. */
  bundle: BundleIdentity;
};
export function renderAnimatedVideo(options: RenderAnimatedVideoOptions): Promise<RenderAnimatedVideoResult>;
export type StillsOptions = Omit<RenderAnimatedVideoOptions, 'outputPath' | 'onProgress' | 'frameRange' | 'qaPolicy'> & {
  /** Pasta (absoluta) só para os stills/contact sheet; nunca sobrescreve. */
  outDir: string;
  /** Frames explícitos; sem eles: entrada/meio/saída de cada cena do storyboard. */
  frames?: number[]; perScene?: number; scale?: number; columns?: number;
  /** Só estas cenas (cobertura incremental do revisor); `maxImages` corta a lista (1..60). */
  sceneIds?: string[]; maxImages?: number;
  /** Quadros por contact sheet (2..16, padrão 16); o storyboard inteiro vira várias folhas. */
  tileLimit?: number;
  /** Etiquetas do host (ex.: {revision, planHash}) copiadas em cada still e no stills.json. */
  tags?: Record<string, string | number>;
};
export type StillsResult = {stills: {frame: number; seconds: number; sceneId: string | null; moment: string; position: 'in' | 'mid' | 'out' | string; path: string; tags?: Record<string, string | number>}[]; contactSheet: string | null; contactSheets: {path: string; frames: number[]}[]; bundle: BundleIdentity; storyboard: StoryboardReport | null};
/** Prévia estática com a MESMA composição/props do export (renderStill), para iterar antes do MP4. */
export function renderStoryboardStills(options: StillsOptions): Promise<StillsResult>;
