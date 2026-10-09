import type {EditCandidate, EditLimitation, ImportedTranscript, SpeechEditKind, TimeRange} from './editorial-smart-edit.mjs';
import type {VoiceTrack} from './editorial-motion-plan.mjs';

export type SpeechEditOptions = {beforeKeptSeconds: number; afterKeptSeconds: number; snapSeconds: number; maxRetakeSeconds: number; maxRetakeWords: number; emphasisPauseSeconds: number; maxWords: number};
export type SpeechWord = {index: number; start: number; end: number; text: string; key: string; punct: string};
export type SpeechFinding = {kind: SpeechEditKind; first: number; last: number; confidence: 'high' | 'medium' | 'low'; reason: string; repeatedText?: string};
export type WordCut = {start: number; end: number; boundary: 'voice' | 'transcript'; voicedSeconds?: number} | {rejected: 'unsafeBoundary' | 'noVoiceEvidence' | 'tooShort'};
/** Transcript with optional local word timings (`words`, from whisper.cpp -dtw). */
export type SpeechTranscript = (ImportedTranscript & {timing?: 'words' | 'sentences' | 'estimated'; words?: {start: number; end: number; text: string}[]}) | null;

export const speechEditKinds: readonly SpeechEditKind[];
export const speechEditDefaults: Readonly<SpeechEditOptions>;
export function speechWords(transcript: SpeechTranscript, duration: number): SpeechWord[];
export function wordCut(words: SpeechWord[], first: number, last: number, input: {duration: number; track?: VoiceTrack | null; options?: Partial<SpeechEditOptions>}): WordCut;
export function speechFindings(words: SpeechWord[], options?: Partial<SpeechEditOptions>): SpeechFinding[];
/** Legacy sentence-level possibleRetake candidates first, then speech candidates (all selected:false). */
export function speechEditCandidates(input: {transcript: SpeechTranscript; duration: number; track?: VoiceTrack | null; options?: Partial<SpeechEditOptions>}): {candidates: EditCandidate[]; limitations: EditLimitation[]; rejected?: Record<string, number>};
export function refineSilenceCandidates(candidates: readonly EditCandidate[], input: {transcript: SpeechTranscript; silences: TimeRange[]; duration: number; options?: Partial<SpeechEditOptions>}): EditCandidate[];
export function applyCandidateSelection(candidates: readonly EditCandidate[], selectedIds: readonly string[], duration: number, options?: {baseSegments?: TimeRange[]}): TimeRange[];
export function segmentsFromWordRemovals(words: SpeechWord[], removeIndexes: readonly number[], duration: number, options?: {track?: VoiceTrack | null; baseSegments?: TimeRange[]; options?: Partial<SpeechEditOptions>}): {segments: TimeRange[]; rejected: {first: number; last: number; reason: string}[]};
export function sourceToOutput(seconds: number, segments: TimeRange[]): number | null;
export function outputToSource(seconds: number, segments: TimeRange[]): number | null;
export function remapSpeechWords(words: {start: number; end: number; text: string}[], segments: TimeRange[]): {start: number; end: number; text: string; sourceStart: number; sourceEnd: number}[];
export function snapRemoval(range: {start: number; end: number}, words: SpeechWord[], options: {duration: number; track?: VoiceTrack | null; silences?: TimeRange[]; options?: Partial<SpeechEditOptions>}): {start: number; end: number; boundary: 'voice' | 'transcript' | 'silence'; voicedSeconds?: number; words: string[]} | {rejected: 'invalidRange' | 'noWordsOrSilence' | 'tooShort' | 'unsafeBoundary' | 'noVoiceEvidence'};
