// Contrato do motor local de capas (F03). Paths de entrada (vídeo, logo, fonte, pasta de saída) devem ser resolvidos
// pelo integrador a partir de assets/versões já registrados — nunca repassados de uma requisição HTTP/IPC.
export const ENGINE_ID: 'ffmpeg-drawtext';
export const ENGINE_VERSION: string;
export const MANIFEST_SCHEMA: 'mainsagents.thumbnails/1';
export const SELECTION_SCHEMA: 'mainsagents.thumbnail-selection/1';
export type ThumbnailConcept = 'product' | 'person' | 'benefit';
export const CONCEPTS: readonly ThumbnailConcept[];
export const LIMITS: Readonly<{title: number; kicker: number; maxCandidates: number; maxLogoBytes: number; maxLogoSide: number; maxSourceSide: number; minZoom: number; maxZoom: number; processTimeoutMs: number; scanTimeoutMs: number}>;

export type ThumbnailErrorCode =
  | 'invalid_input' | 'invalid_source' | 'invalid_format' | 'invalid_concepts' | 'invalid_text' | 'invalid_logo' | 'invalid_font' | 'invalid_output'
  | 'unsupported_glyph' | 'layout_overflow' | 'source_changed' | 'output_exists' | 'dependency_missing' | 'render_failed' | 'verify_failed' | 'cancelled';
export class ThumbnailError extends Error {
  code: ThumbnailErrorCode;
  details?: unknown;
  constructor(code: ThumbnailErrorCode, message: string, details?: unknown);
}

/** Frações (0..1) da tela de saída. */
export type FractionRect = {x: number; y: number; w: number; h: number};
export type Rect = {x: number; y: number; w: number; h: number};
export type ThumbnailFormatId = 'youtube-thumbnail' | 'instagram-reels-cover' | 'tiktok-cover' | 'instagram-feed-4x5';
export type ThumbnailFileType = 'jpg' | 'png';
/** Presets padrão. safeArea/reservedZones/guides são aproximações identificadas, não regras verificadas da plataforma. */
export type ThumbnailFormat = {
  id: ThumbnailFormatId; label: string; width: number; height: number; aspect: number;
  fileTypes: ThumbnailFileType[]; defaultFileType: ThumbnailFileType; maxBytes: number | null;
  safeArea: FractionRect; reservedZones: Array<FractionRect & {id: string}>; guides: Array<FractionRect & {id: string}>;
  guidance: string; status: 'guidance-unverified';
};
export function listThumbnailFormats(): ThumbnailFormat[];
export function resolveFormat(id: string): Omit<ThumbnailFormat, 'aspect' | 'status'>;

export type ThumbnailSourceRef = {path: string; assetId: string; versionId: string; sha256: string};
export type ThumbnailFraming = {focusX?: number; focusY?: number; zoom?: number};
export type ThumbnailConceptInput = {concept: ThumbnailConcept; timestampSeconds: number; title: string; kicker?: string; framing?: ThumbnailFraming};
export type ThumbnailBrand = {theme?: 'dark' | 'light'; accent?: string; logoPath?: string; logoSha256?: string; fontPath?: string};
export type ThumbnailRequest = {
  source: ThumbnailSourceRef;
  format: ThumbnailFormatId;
  fileType?: ThumbnailFileType;
  brand?: ThumbnailBrand;
  /** Exatamente três: product, person e benefit (um de cada). Mais alternativas = novo lote explícito. */
  concepts: ThumbnailConceptInput[];
  /** Gera também `<concept>-<format>.safe-area-preview.png` com guias. Padrão true. */
  safeAreaPreview?: boolean;
  outputDirectory?: string;
};
export type NormalizedConcept = {concept: ThumbnailConcept; timestampSeconds: number; title: string; kicker?: string; framing: Required<ThumbnailFraming>};
export type NormalizedThumbnailRequest = {
  source: ThumbnailSourceRef; format: ThumbnailFormatId; fileType: ThumbnailFileType;
  brand: {theme: 'dark' | 'light'; accent: string; logoPath?: string; logoSha256?: string; fontPath?: string};
  concepts: NormalizedConcept[]; safeAreaPreview: boolean;
};
export function validateThumbnailRequest(raw: unknown): NormalizedThumbnailRequest;

export type FontMetrics = {unitsPerEm: number; ascender: number; descender: number; capHeight: number; hasGlyph(char: string): boolean; measure(text: string): number};
export type ResolvedFont = {path: string; name: string; sha256: string; metrics: FontMetrics};
export function parseFontMetrics(buffer: Buffer): FontMetrics;
export function resolveFont(fontPath?: string): Promise<ResolvedFont>;
export function contrastRatio(a: [number, number, number], b: [number, number, number]): number;

export type TitleLine = Rect & {text: string; baseline: number};
/** Layout puro e serializável (exceto `font`): a galeria pode desenhar a prévia em CSS com estes retângulos, sem FFmpeg por tecla. */
export type ConceptLayout = {
  concept: ThumbnailConcept; template: string; canvas: {width: number; height: number};
  safeArea: Rect; reservedZones: Array<Rect & {id: string}>;
  frameRect: Rect; panel: (Rect & {color: string}) | null;
  scrim: {direction: 'top' | 'bottom' | 'left' | 'right'; color: string; alpha: number; from: number; to: number} | null;
  align: 'left' | 'center'; centerX: number; side: 'left' | 'right' | 'top' | 'bottom' | null;
  title: {size: number; lines: TitleLine[]; rect: Rect; color: string};
  kicker: {text: string; size: number; rect: Rect; fill: string; color: string; padX: number; baseline: number} | null;
  accent: {rect: Rect; color: string} | null;
  logo: Rect | null;
  contrast: {title: number; kicker: number | null; minimum: number; basis: 'opaque-panel' | 'worst-case-pixel-under-scrim'};
};
export function layoutConcept(input: {
  format: ThumbnailFormatId; concept: ThumbnailConcept; title: string; kicker?: string; framing: Required<ThumbnailFraming>;
  theme: 'dark' | 'light'; accent: string; font: Pick<ResolvedFont, 'name' | 'metrics'>; logo?: {width: number; height: number} | null;
}): ConceptLayout;
export type CropRect = Rect & {upscale: number};
export function cropFor(input: {sourceWidth: number; sourceHeight: number; region: {w: number; h: number}; framing: Required<ThumbnailFraming>}): CropRect;

export type FrameSize = {width: number; height: number};
export type SourceMetadata = {width: number; height: number; fps?: number | null; durationSeconds: number; display?: FrameSize};
/** Frame realmente decodificado no timestamp (pós-autorrotação + SAR normalizado). */
export type DecodedFrame = FrameSize & {ptsTimeSeconds: number | null};
export type ThumbnailPlan = {
  spec: NormalizedThumbnailRequest; format: ReturnType<typeof resolveFormat>;
  items: Array<NormalizedConcept & {layout: ConceptLayout; crop: CropRect; warnings: string[]}>;
  specHash: string; batchId: string;
};
/** `frames` (por conceito) vence `sourceMetadata.display`, que vence width/height. */
export function planThumbnailSet(request: ThumbnailRequest, facts: {sourceMetadata: SourceMetadata; font: ResolvedFont; logo?: {width: number; height: number; sha256: string} | null; frames?: Partial<Record<ThumbnailConcept, FrameSize>>}): ThumbnailPlan;

/** width/height já trocados para rotação ±90; `stored` = pixels gravados; `display` = tamanho previsto pós-rotação com pixels quadrados. */
export type MediaFacts = {width: number; height: number; rotation: number; sampleAspectRatio: number; stored: FrameSize; display: FrameSize; durationSeconds: number | null; fps: number | null; codec: string; hasAudio: boolean};
export function probeMedia(file: string, options?: {ffprobePath?: string; signal?: AbortSignal}): Promise<MediaFacts>;
/** Filtro FFmpeg aplicado antes de todo recorte: converte SAR ≠ 1 em pixels quadrados. */
export const SQUARE_PIXELS: string;
/** Decodifica sem gravar o frame que o render usará; null quando não há frame no timestamp. */
export function probeFrame(file: string, timestampSeconds: number, options?: {ffmpegPath?: string; signal?: AbortSignal}): Promise<DecodedFrame | null>;
export function hashFile(file: string): Promise<string>;

export type ThumbnailCapabilities = {
  available: boolean; engine: {id: string; version: string};
  ffmpeg: {path: string; version: string | null; filters: Record<string, boolean>}; ffprobe: boolean;
  font: {name: string; path: string; sha256: string} | null;
  concepts: readonly ThumbnailConcept[];
  formats: Array<Pick<ThumbnailFormat, 'id' | 'label' | 'width' | 'height' | 'fileTypes' | 'maxBytes' | 'status'>>;
  requiresAi: false; network: false; reasons: string[];
};
export function getThumbnailCapabilities(options?: {ffmpegPath?: string; ffprobePath?: string; fontPath?: string}): Promise<ThumbnailCapabilities>;

export type CandidateFrame = {timestampSeconds: number; reason: 'scene-change' | 'evenly-spaced'};
export function suggestCandidateFrames(options: {source: ThumbnailSourceRef; count?: number; sceneThreshold?: number; ffmpegPath?: string; ffprobePath?: string; signal?: AbortSignal}): Promise<{
  source: Omit<ThumbnailSourceRef, 'path'>; durationSeconds: number; candidates: CandidateFrame[]; note: string;
}>;
export function extractFramePreview(options: {source: ThumbnailSourceRef; timestampSeconds: number; outputPath: string; maxWidth?: number; ffmpegPath?: string; ffprobePath?: string; signal?: AbortSignal}): Promise<{
  path: string; timestampSeconds: number; sha256: string; kind: 'frame-preview';
}>;

export type ThumbnailFile = {
  kind: 'thumbnail' | 'safe-area-preview'; fileName: string; path: string; sha256: string; size: number;
  width: number; height: number; mime: 'image/jpeg' | 'image/png'; jpegQuality?: number;
};
export type ThumbnailManifestItem = {
  /** `${batchId}:${concept}` */
  id: string; concept: ThumbnailConcept; template: string; title: string; kicker?: string;
  timestampSeconds: number;
  /** pts real do frame exibido (pode diferir do pedido em VFR); null se o FFmpeg não informar. */
  frameTimestampSeconds: number | null;
  framing: Required<ThumbnailFraming>; crop: CropRect;
  layout: {
    titleSize: number; lines: string[]; titleRect: Rect; kickerRect: Rect | null; logoRect: Rect | null; frameRect: Rect;
    safeArea: Rect; reservedZones: Array<Rect & {id: string}>; contrast: ConceptLayout['contrast']; align: 'left' | 'center'; side: ConceptLayout['side'];
  };
  warnings: string[];
  /** Capa final exportável. */
  export: ThumbnailFile & {kind: 'thumbnail'};
  /** Só prévia com guias (nunca publicar). Ausente quando safeAreaPreview=false. */
  preview?: ThumbnailFile & {kind: 'safe-area-preview'};
};
export type ThumbnailManifest = {
  schema: 'mainsagents.thumbnails/1'; engine: {id: string; version: string}; batchId: string; specHash: string; createdAt: string; directory: string;
  source: {assetId: string; versionId: string; sha256: string; width: number; height: number; durationSeconds: number; preserved: true;
    /** Tamanho decodificado usado no recorte; consistentWithProbe=false quando divergiu da previsão do ffprobe (o decodificado vence). */
    display: {width: number; height: number; rotation: number; sampleAspectRatio: number; consistentWithProbe: boolean}};
  format: {id: ThumbnailFormatId; label: string; width: number; height: number; maxBytes: number | null; guidance: string; status: 'guidance-unverified'};
  fileType: ThumbnailFileType;
  brand: {theme: 'dark' | 'light'; accent: string; logo: {sha256: string; width: number; height: number} | null};
  font: {name: string; sha256: string};
  requiresAi: false;
  items: ThumbnailManifestItem[];
};
/** `process: 'running'`: the FFmpeg render of the next file has started (emitted once per render, before it can finish). */
export type ThumbnailProgress = {phase: 'validate' | 'render' | 'verify' | 'commit'; completed: number; total: number; process?: 'running'};
/** Tudo ou nada: o lote só existe em `${outputDirectory}/${batchId}` depois de verificado; cancelamento/falha não deixa arquivos. */
export function renderThumbnailSet(options: ThumbnailRequest & {outputDirectory: string; signal?: AbortSignal; onProgress?: (progress: ThumbnailProgress) => void; ffmpegPath?: string; ffprobePath?: string}): Promise<ThumbnailManifest>;

export type ThumbnailSelection = {
  schema: 'mainsagents.thumbnail-selection/1';
  /** `${contentId}|${assetId}|${versionId}|${format}` — uma escolha por conteúdo, versão do vídeo e destino. */
  key: string;
  contentId: string;
  source: {assetId: string; versionId: string; sha256: string};
  format: ThumbnailFormatId; batchId: string; specHash: string; concept: ThumbnailConcept;
  file: {path: string; sha256: string; size: number; width: number; height: number; mime: 'image/jpeg' | 'image/png'};
  selectedAt: string;
};
export type ThumbnailSelectionStatus = {status: 'current' | 'stale' | 'invalid'; reasons: string[]};
export function selectionKey(input: {contentId: string; assetId: string; versionId: string; format: string}): string;
export function createThumbnailSelection(manifest: ThumbnailManifest, concept: ThumbnailConcept, options: {contentId: string; selectedAt?: string}): ThumbnailSelection;
export function checkThumbnailSelection(selection: ThumbnailSelection, facts?: {currentSource?: {assetId: string; versionId: string; sha256: string}; file?: {sha256: string; size?: number}}): ThumbnailSelectionStatus;
export function verifyThumbnailSelectionFile(selection: ThumbnailSelection, facts?: {currentSource?: {assetId: string; versionId: string; sha256: string}}): Promise<ThumbnailSelectionStatus>;
/** Processo local sem shell; cancelamento/timeout só resolvem depois que o processo realmente fechou (Windows EBUSY). */
export function runProcess(command: string, args: string[], options?: {signal?: AbortSignal; cwd?: string; timeoutMs?: number; keepStderr?: number; onSpawn?: () => void; onStdout?: (chunk: string) => void}): Promise<{stdout: string; stderr: string}>;
