// Contrato do motor de legendas gravadas (B05). Paths (vídeo, fonte, saída) são resolvidos pelo integrador a partir
// de assets/versões registrados — nunca vindos de uma requisição HTTP/IPC.
export const CAPTIONS_ENGINE_ID: 'ffmpeg-libass';
export const CAPTIONS_ENGINE_VERSION: string;
export const CAPTIONS_SCHEMA: 'mainsagents.captions/1';
export const BURNED_SCHEMA: 'mainsagents.burned-captions/1';
export const CAPTION_LIMITS: Readonly<{maxSegments: number; maxText: number; maxLines: number; minDuration: number; maxDuration: number; maxVideoSeconds: number; maxSrtBytes: number; renderTimeoutMs: number}>;
export type CaptionErrorCode = 'invalid_captions' | 'invalid_timing' | 'invalid_text' | 'invalid_srt' | 'invalid_style' | 'invalid_source' | 'invalid_output' | 'invalid_font'
  | 'unsupported_glyph' | 'layout_overflow' | 'source_changed' | 'output_exists' | 'dependency_missing' | 'render_failed' | 'verify_failed' | 'cancelled';
export class CaptionError extends Error {code: CaptionErrorCode; details?: unknown; constructor(code: CaptionErrorCode, message: string, details?: unknown);}

export type CaptionStyleId = 'classic' | 'boxed' | 'highlight';
export const CAPTION_STYLE_IDS: readonly CaptionStyleId[];
export function listCaptionStyles(): Array<{id: CaptionStyleId; label: string}>;
export function validateCaptionStyle(id: unknown): CaptionStyleId;

/** Tempo em segundos na linha do tempo do vídeo legendado; texto com até 2 linhas (\n). */
export type CaptionSegment = {start: number; end: number; text: string};
export function validateCaptionSegments(raw: unknown, durationSeconds?: number): CaptionSegment[];
export function captionsHash(segments: CaptionSegment[]): string;
export function parseSrt(text: string, durationSeconds?: number): CaptionSegment[];
export function captionsToSrt(segments: CaptionSegment[]): string;
/** `warnings`: whisper-approximate (sempre), sentence-timing, split-proportional, no-speech. Nunca sincronia por palavra. */
export type CaptionWarning = 'whisper-approximate' | 'sentence-timing' | 'split-proportional' | 'no-speech';
export function captionsFromTranscript(transcript: {segments?: Array<{start: number; end: number; text: string}>; timing?: string} | null, durationSeconds: number, options?: {maxChars?: number}): {segments: CaptionSegment[]; warnings: CaptionWarning[]};

export function fontNames(buffer: Buffer): {family: string; subfamily: string};
export function captionGeometry(styleId: CaptionStyleId, size: {width: number; height: number}): {fontSize: number; marginV: number; marginH: number; outline: number; maxLineWidth: number};
export function layoutCaptionText(text: string, options: {metrics: {unitsPerEm: number; measure(text: string): number}; fontSize: number; maxLineWidth: number}): {ok: boolean; lines: string[]};
export function missingGlyphs(segments: CaptionSegment[], metrics: {hasGlyph(char: string): boolean}): string[];
export function buildAss(input: {segments: CaptionSegment[]; styleId: CaptionStyleId; width: number; height: number; font: {family: string; subfamily: string}; metrics: {unitsPerEm: number; measure(text: string): number}}): string;

export type CaptionCapabilities = {available: boolean; engine: {id: string; version: string}; subtitles: boolean; font: {name: string; sha256: string} | null; styles: Array<{id: CaptionStyleId; label: string}>; requiresAi: false; network: false; reasons: string[]};
export function getCaptionCapabilities(options?: {ffmpegPath?: string; ffprobePath?: string; fontPath?: string}): Promise<CaptionCapabilities>;

export type BurnedCaptionsManifest = {
  schema: 'mainsagents.burned-captions/1'; engine: {id: string; version: string}; createdAt: string;
  source: {assetId: string; versionId: string; sha256: string; durationSeconds: number; width: number; height: number; rotation: number; preserved: true};
  captions: {hash: string; count: number}; style: {id: CaptionStyleId}; font: {family: string; sha256: string};
  /** copied = mesmo fluxo de áudio, sem recodificar. */
  audio: 'copied' | 'reencoded' | 'none';
  output: {path: string; sha256: string; size: number; durationSeconds: number; width: number; height: number; hasAudio: boolean};
  requiresAi: false; network: false;
};
export function renderBurnedCaptions(options: {
  source: {path: string; assetId: string; versionId: string; sha256: string}; segments: CaptionSegment[]; styleId: CaptionStyleId; outputPath: string;
  fontPath?: string; ffmpegPath?: string; ffprobePath?: string; signal?: AbortSignal; onProgress?: (event: {phase: 'render' | 'verify'; progress: number}) => void;
}): Promise<BurnedCaptionsManifest>;
