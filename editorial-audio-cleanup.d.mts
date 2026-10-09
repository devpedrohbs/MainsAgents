import type {AudioTreatment, TimeRange} from './editorial-smart-edit.mjs';

export type AudioStream = {channels: number; channelLayout: string | null; sampleRate: number; codec: string | null};
export type AudioLevels = {noiseFloorDb: number | null | undefined; noisePeakDb: number | null | undefined; speechLevelDb: number | null | undefined};
/** Bound to version+sha256+method+value by `digest`; persisted server-side, never accepted from a client. */
export type NoiseMeasurement = {method: 'astats-pauses-v1'; versionId: string; sha256: string; noiseFloorDb: number; measuredSeconds: number; measuredAt: string; digest: string};
export type AudioLimitation = 'noAudio' | 'multichannel' | 'noSilenceToMeasure' | 'noMeasurableNoise';
export type AudioAssessment = {stream: AudioStream | null; noiseFloorDb: number | null; noisePeakDb?: number | null; speechLevelDb: number | null; measuredSeconds?: number; noiseReductionAvailable: boolean; reason: string; limitations: AudioLimitation[]; measurement: NoiseMeasurement | null};

export const audioMeasurementMethod: 'astats-pauses-v1';
export const audioPreferenceDefaults: Readonly<{leveling: false; noiseReduction: false; smoothCuts: false}>;
export function probeAudioStream(input: {ffprobe?: string; inputPath: string; signal?: AbortSignal}): Promise<AudioStream | null>;
export function quietRanges(silences: TimeRange[] | null | undefined, duration: number): TimeRange[];
export function audioLevelArgs(inputPath: string, ranges: TimeRange[]): string[];
export function parseAudioLevels(log: string): AudioLevels;
export function measureAudioLevels(input: {ffmpeg?: string; inputPath: string; ranges: TimeRange[]; signal?: AbortSignal}): Promise<AudioLevels>;
export function assessAudio(input: {ffmpeg?: string; ffprobe?: string; inputPath: string; silences: TimeRange[]; duration: number; versionId: string; sha256: string; signal?: AbortSignal; now?: () => string}): Promise<AudioAssessment>;
export function assertMeasuredNoiseFloor(planAudio: Partial<AudioTreatment> | undefined, stored: NoiseMeasurement | null | undefined, source: {versionId: string; sha256: string}): true;
export function proposeAudioTreatment(assessment: AudioAssessment | null, wanted?: {leveling?: boolean; noiseReduction?: boolean; smoothCuts?: boolean}): {audio: AudioTreatment; notes: string[]};
export function verifyAudioCleanup(input: {before: AudioLevels; after: AudioLevels}): {noiseFloorDeltaDb: number | null; speechLevelDeltaDb?: number | null; speechToNoiseDeltaDb?: number | null; improved: boolean; note: string};
export function audioPreviewArgs(input: {inputPath: string; outputPath: string; segments: TimeRange[]; audio?: Partial<AudioTreatment>; normalizeAudio?: boolean; fromOutput?: number; seconds?: number}): string[];
export function renderAudioPreview(input: {ffmpeg?: string; inputPath: string; outputPath: string; segments: TimeRange[]; audio?: Partial<AudioTreatment>; normalizeAudio?: boolean; fromOutput?: number; seconds?: number; signal?: AbortSignal}): Promise<{path: string; fromOutput: number; seconds: number}>;
