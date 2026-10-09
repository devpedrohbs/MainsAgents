import type {Reframe, ReframeRenderProps} from './editorial-reframe.mjs';

export type MotionIntensity = 'off' | 'subtle' | 'balanced' | 'intense';
export type MotionLayout = 'camera-full' | 'split' | 'motion-focus';
export type MotionCueKind = 'punchIn' | 'kineticText' | 'keyPoint' | 'explainer';
export type SfxKind = 'whoosh' | 'pop' | 'tick';
export type SignalKind = 'loudness' | 'pitch' | 'pauseBefore' | 'stretch' | 'keyword' | 'number' | 'punctuation' | 'editorHighlight' | 'structure' | 'user';
export type MotionLimitation = 'voiceUnavailable' | 'wordTimingEstimated' | 'transcriptUnavailable' | 'tooShort' | 'sfxSkipped';
/** Measured signals (loudness dB, pitch semitones, pause s, stretch ×) always carry source 'measured'; text cues carry 'inferred'. */
export type MotionSignal = {kind: SignalKind; source: 'measured' | 'inferred' | 'user'; value?: number};
export type ExplainerType = 'compare' | 'steps' | 'stat' | 'process' | 'image';
export type StatUnit = '%' | 'x' | 'k' | 'mil' | 'R$' | '$';
export type ExplainerVisual =
  | {type: 'compare'; before: {label: string; text: string}; after: {label: string; text: string}}
  | {type: 'steps'; items: string[]}
  | {type: 'stat'; chart: 'number' | 'bar'; values: {label: string; value: number; unit?: StatUnit}[]}
  | {type: 'process'; nodes: string[]}
  | {type: 'image'; assetId: string; caption?: string};
/**
 * origin 'speech': texto/números saem do `quote` literal (gravação quoteStart..quoteEnd); o servidor confirma com
 * verifyExplainersAgainstTranscript. origin 'user': conteúdo do próprio usuário (imagem sempre 'user').
 * `reveal` = tempos (gravação) em que cada item foi dito; `revealAt` = mesmos instantes no vídeo editado (derivado).
 */
export type MotionExplainer = {visual: ExplainerVisual; origin: 'speech' | 'user'; quote?: string; quoteStart?: number; quoteEnd?: number; reveal?: number[]; revealAt?: number[]};
export type MotionCue = {
  id: string; kind: MotionCueKind;
  /** Anchors on the ORIGINAL recording. */
  sourceStart: number; sourceEnd: number;
  /** Edited-video times, always re-derived from the kept segments. Explainers may span cuts; other cues never do. */
  start: number; end: number;
  text?: string; focus?: string; layout: MotionLayout; strength: number; scale?: number;
  /** 'user' = momento escolhido pelo usuário (signals só [{kind:'user',source:'user'}]). */
  source: 'measured' | 'inferred' | 'mixed' | 'user'; timing: 'words' | 'estimated'; reason: string; signals: MotionSignal[];
  sfx?: {kind: SfxKind; gainDb: number; ducked: boolean};
  /** Only on kind 'explainer'. */
  explainer?: MotionExplainer;
};
export type MotionPlan = {version: 1; intensity: MotionIntensity; analysis: {wordTiming: 'words' | 'estimated' | 'none'; voice: 'measured' | 'unavailable'; limitations: MotionLimitation[]; measuredCandidates: number; inferredCandidates: number}; cues: MotionCue[]; reframe?: Reframe};
export type MotionRenderCue = {id: string; kind: MotionCueKind; layout: MotionLayout; startFrame: number; endFrame: number; strength: number; scale?: number; text?: string; focus?: string; explainer?: {visual: ExplainerVisual; origin: 'speech' | 'user'; revealFrames: number[]}};
export type MotionProtect = {captionBand?: {top: number; bottom: number}};
export type MotionRenderProps = {intensity: MotionIntensity; cues: MotionRenderCue[]; sfx: {kind: SfxKind; at: number; gainDb: number}[]; reframe?: ReframeRenderProps; protect?: MotionProtect};
export type Word = {start: number; end: number; text: string};
export type TimeRange = {start: number; end: number};
export type VoiceTrack = {samples: Int16Array; sampleRate: number; hop: number; db: Float32Array; noiseFloorDb: number; speechThresholdDb: number; duration: number};
export type WordProsody = {loudnessDb: number | null; pitchSt: number | null; pauseBefore: number; stretch: number | null};
export type DetectedExplainer = {type: Exclude<ExplainerType, 'image'>; first: number; last: number; visual: ExplainerVisual; quote: string; quoteStart: number; quoteEnd: number; reveal: number[]};
export type MotionPreset = Readonly<{maxPerMinute: number; minGap: number; punchScale: number; kinetic: boolean; keyPoints: boolean; layoutGap: number; sfxPerMinute: number; threshold: number; sfxBaseDb: number; explainers: boolean; maxLayoutShare: number; minCameraSeconds: number}>;

export const motionIntensities: readonly MotionIntensity[];
export const motionLayouts: readonly MotionLayout[];
export const motionCueKinds: readonly MotionCueKind[];
export const explainerTypes: readonly ExplainerType[];
export const statUnits: readonly StatUnit[];
export const sfxKinds: readonly SfxKind[];
export const signalKinds: readonly SignalKind[];
export const motionLimitations: readonly MotionLimitation[];
export const MOTION_LIMITS: Readonly<{maxCues: number; maxText: number; maxReason: number; maxSignals: number; maxSeconds: number; minCueSeconds: number; maxCueSeconds: number; maxHighlights: number; voiceSampleRate: number; maxExplainerSeconds: number; maxQuote: number; maxItem: number; maxLabel: number}>;
export const MOTION_PRESETS: Readonly<Record<'subtle' | 'balanced' | 'intense', MotionPreset>>;
export const SFX_DUCK_DB: number;
export const SFX_LEAD: Readonly<Record<SfxKind, number>>;
export const LAYOUT_JOIN_SECONDS: number;
export function safeMotionText(value: unknown, max: number): boolean;
export function transcriptWords(transcript: unknown): {timing: 'words' | 'estimated' | 'none'; words: Word[]};
export function keptMap(segments: TimeRange[]): (TimeRange & {outputStart: number})[];
export function remapInterval(start: number, end: number, map: (TimeRange & {outputStart: number})[], min?: number): TimeRange | null;
export function remapSpan(start: number, end: number, map: (TimeRange & {outputStart: number})[], min?: number): TimeRange | null;
export function sourceAt(edited: number, map: (TimeRange & {outputStart: number})[]): number;
export function remapWords(words: Word[], segments: TimeRange[]): (Word & {sourceStart: number; sourceEnd: number})[];
export function voiceTrack(samples: Int16Array, sampleRate: number): VoiceTrack;
export function measuredPauses(track: VoiceTrack, minSeconds?: number): TimeRange[];
export function alignWordsToVoice(words: Word[], track: VoiceTrack): Word[];
export function pitchAt(track: VoiceTrack, seconds: number): number;
export function wordProsody(track: VoiceTrack, words: Word[]): WordProsody[];
export function extractVoicePcm(input: {ffmpeg?: string; inputPath: string; signal?: AbortSignal; maxSeconds?: number; sampleRate?: number; timeoutMs?: number}): Promise<{samples: Int16Array; sampleRate: number}>;
export function matchHighlights(words: Word[], highlights?: string[]): {first: number; last: number; phrase: string}[];
export function scoreEmphasis(words: Word[], prosody: WordProsody[] | null, options?: {highlights?: string[]}): {index: number; score: number; measured: number; inferred: number; source: 'measured' | 'inferred' | 'mixed'; signals: MotionSignal[]; highlight: {first: number; last: number; phrase: string} | null}[];
export function quoteTokens(text: unknown): string[];
export function parseSpokenNumber(token: string): {value: number; unit?: StatUnit} | null;
export function detectExplainers(words: Word[]): DetectedExplainer[];
export function explainerQuoteProblems(explainer: {visual: ExplainerVisual; quote?: string}): string[];
/** Server-side proof: quote of each spoken explainer must match the REAL transcript words in its recording window. */
export function verifyExplainersAgainstTranscript(plan: MotionPlan | undefined, words: Word[]): {ok: boolean; problems: {id: string; reason: string}[]};
export function buildMotionPlan(input: {words?: Word[]; wordTiming?: 'words' | 'estimated' | 'none'; prosody?: WordProsody[] | null; segments: TimeRange[]; intensity?: MotionIntensity; highlights?: string[]; reserved?: TimeRange[]; voice?: 'measured' | 'unavailable'; limitations?: MotionLimitation[]; explainers?: boolean; reframe?: Reframe}): MotionPlan;
export function motionDensity(plan: MotionPlan | undefined, durationSeconds: number): {cuesPerMinute: number; layoutShare: number; sfxPerMinute: number};
export function normalizeMotion(raw: unknown, segments: TimeRange[]): MotionPlan | undefined;
export function resolveMotionProps(motion: unknown, metadata: {fps: number; durationSeconds: number; protect?: MotionProtect}): MotionRenderProps | undefined;
export function synthesizeSfx(kind: SfxKind, sampleRate: number): Float32Array;
export function sfxBedWav(sfx: {kind: SfxKind; at: number; gainDb: number}[], durationSeconds: number, sampleRate: number): Buffer;
export function sfxMixFilter(input: {sampleRate: number; channels: number}): string;
export function describeMotion(motion: MotionPlan | undefined, pt?: boolean): string;
