export type TranscriptSegment = {start: number; end: number; text: string};
export type TranscriptWord = {start: number; end: number; text: string};
export type WhisperTranscription = {origin: 'local-whisper'; engine: 'whisper.cpp'; model: string; modelSha256: string; language: string; segments: TranscriptSegment[]; speech?: {start: number; end: number}[]; words?: TranscriptWord[]};
export type WhisperCapabilities = {available: boolean; reasons: string[]; model?: string; modelSha256?: string};
export const whisperModels: Readonly<Record<string, string>>;
export const whisperLanguages: readonly ('auto' | 'pt' | 'en' | 'es' | 'fr' | 'de' | 'it')[];
export function resolveWhisper(options?: {directories?: string[]; cli?: string; model?: string}): {cli: string; model: string; root?: string} | null;
export function parseWhisperJson(raw: unknown, duration: number): {language?: string; segments: TranscriptSegment[]; words: TranscriptWord[]; speech: {start: number; end: number}[]};
export function createWhisperTranscriber(options?: {cli?: string; model?: string; directories?: string[]; ffmpeg?: string; threads?: number; run?: (binary: string, args: string[], options?: object) => Promise<string>}): {
  capabilities(): Promise<WhisperCapabilities>;
  transcribe(input: {inputPath: string; duration: number; language?: string; signal?: AbortSignal}): Promise<WhisperTranscription>;
};
