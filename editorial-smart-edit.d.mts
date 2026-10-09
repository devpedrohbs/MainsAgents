export type TimeRange = {start: number; end: number};
export type SilenceOptions = {thresholdDb: number; minDuration: number; padding: number};
export type AnimationKind = 'title' | 'lowerThird' | 'cta';
export type AnimationTheme = 'dark' | 'light';
/** One per kind, times on the OUTPUT timeline. text <= 80 (lowerThird name <= 60), subtitle only for lowerThird (role <= 80). CTA start is ignored: it always closes the video. */
export type EditAnimation = {id: string; kind: AnimationKind; text: string; subtitle?: string; start?: number; duration: number};
/** Segments are KEPT intervals on the ORIGINAL timeline, ordered and non-overlapping. */
/** `motion` cues are anchored on the ORIGINAL timeline (sourceStart/sourceEnd); edited times are re-derived from `segments`. */
/** Opt-in voice treatment. `noiseReduction.noiseFloorDb` must equal a server-stored measurement of this source (editorial-audio-cleanup assertMeasuredNoiseFloor). */
export type AudioTreatment = {leveling: boolean; noiseReduction: false | {noiseFloorDb: number}; smoothCuts: boolean};
export type EditPlan = {segments: TimeRange[]; animations?: EditAnimation[]; format?: 'original' | 'portrait'; normalizeAudio?: boolean; theme?: AnimationTheme; motion?: import('./editorial-motion-plan.mjs').MotionPlan; audio?: Partial<AudioTreatment>};
/** `audio` is present only when the request carried it, so legacy plans keep the same planHash. */
export type NormalizedEditPlan = {segments: TimeRange[]; animations: (EditAnimation & {start: number})[]; theme: AnimationTheme; format: 'original' | 'portrait'; normalizeAudio: boolean; motion?: import('./editorial-motion-plan.mjs').MotionPlan; audio?: AudioTreatment};
export type SpeechEditKind = 'filler' | 'repetition' | 'retake' | 'selfCorrection';
export type SpeechEvidence = Readonly<{text: string; words: readonly Readonly<{start: number; end: number; text: string}>[]; repeatedText?: string; timing: 'words' | 'estimated'; boundary: 'voice' | 'transcript'; voicedSeconds?: number; source: 'transcript'; boundaryNote: string}>;
/** Speech kinds (editorial-speech-edit) are never selected by default and carry confidence + evidence. Silence cuts refined for emphasis carry `emphasis` (inferred, not measured). */
export type EditCandidate = Readonly<{id: string; kind: 'silence' | 'possibleRetake' | SpeechEditKind; start: number; end: number; label: string; reason: string; selected: boolean; confidence?: 'high' | 'medium' | 'low'; evidence?: SpeechEvidence; emphasis?: Readonly<{cue: 'question' | 'exclamation' | 'ellipsis' | 'colon' | 'number' | 'keyword'; source: 'inferred'; keptSeconds: number}>}>;
export type EditLimitation = 'noAudio' | 'allSilent' | 'candidatesTruncated' | 'transcriptUnavailable' | 'noSpeech' | 'transcriptionFailed' | 'wordTimingUnavailable' | 'voiceUnavailable' | 'unsafeBoundary' | 'noVoiceEvidence';
export type ImportedTranscript = Readonly<{origin: 'imported' | 'local-whisper'; engine?: string; model?: string; language?: string; cached?: boolean; createdAt?: string; segments: readonly Readonly<{start: number; end: number; text: string}>[]}>;
export type TranscriptionLanguage = 'auto' | 'pt' | 'en' | 'es' | 'fr' | 'de' | 'it';
/** POST /api/content/media/transcribe (whisper.cpp local, cached per version+language) */
export type TranscribeRequest = SourceRef & {language?: TranscriptionLanguage};
export type TranscribeResponse = {revision: number; source: SourceRef; transcript: ImportedTranscript & {noSpeech?: boolean}};
export type SourceRef = {contentId: string; assetId: string; versionId: string; sha256: string};
export type VideoMetadata = {duration: number; width: number; height: number; hasAudio: boolean; videoCodec?: string; audioCodec?: string};

/** POST /api/content/media/analyze */
export type AnalyzeRequest = SourceRef & {options?: Partial<SilenceOptions>; transcript?: 'local' | {segments: {start: number; end: number; text: string}[]}; language?: TranscriptionLanguage};
export type AnalyzeResponse = {revision: number; analysis: {source: SourceRef; metadata: VideoMetadata; options: SilenceOptions; limitations: EditLimitation[]; silences: TimeRange[]; candidates: EditCandidate[]; transcript: ImportedTranscript | null; suggestedSegments: TimeRange[]}};
/** POST /api/content/media/plan */
export type PlanRequest = SourceRef & {plan: EditPlan};
export type PlanResponse = {revision: number; versionId: string; sha256: string; plan: NormalizedEditPlan; planHash: string; outputDuration: number; sourceDuration: number; removed: TimeRange[]};
/** POST /api/content/media with mode 'advanced' */
export type AdvancedExportRequest = SourceRef & {mode: 'advanced'; authorize: true; revision: number; requestKey: string; plan: NormalizedEditPlan; planHash: string};
/** Injected overlay engine contract (editorial-media `animate` option). */
export type RemotionAnimations = {protect?: {captionBand: {top: number; bottom: number}}; motion?: import('./editorial-motion-plan.mjs').MotionPlan; theme: AnimationTheme; title?: {text: string; startSeconds: number; durationSeconds: number}; lowerThird?: {name: string; role?: string; startSeconds: number; durationSeconds: number}; cta?: {text: string; durationSeconds: number}};
export type AnimateEngine = (input: {inputPath: string; outputPath: string; animations: RemotionAnimations; metadata: {width: number; height: number; fps: number; durationSeconds: number; hasAudio: boolean}; signal: AbortSignal; onProgress: (event: number | {phase: string; progress: number}) => void}) => Promise<unknown>;

export const smartEditLimits: Readonly<{maxInputSeconds: number; maxSegments: number; maxCandidates: number; maxAnimations: number; maxAnimatedSeconds: number; minSegmentSeconds: number; maxTranscriptSegments: number; maxTextLength: number; maxTranscriptText: number}>;
export const animationKinds: readonly AnimationKind[];
export const animationThemes: readonly AnimationTheme[];
/** `source` (decoded source size) turns a user framing focus into coordinates of the cropped 9:16 frame. */
export function remotionAnimations(plan: NormalizedEditPlan, options?: {source?: {width: number; height: number}}): RemotionAnimations;
/** 9:16 crop following a user/detected focus (edited-time keyframes), or null for the legacy centred crop. */
/** Band (fractions of the height) kept free of motion text for burned captions added later. */
export function captionBand(plan: Partial<NormalizedEditPlan> | undefined, source?: {width: number; height: number}): {top: number; bottom: number};
export function portraitCrop(plan: Partial<NormalizedEditPlan> | undefined, source?: {width: number; height: number}): {filter: string; scaledWidth: number; scaledHeight: number} | null;
export function needsAnimation(plan: Partial<NormalizedEditPlan> | undefined): boolean;
/** POST /api/content/media/motion */
export type MotionRequest = SourceRef & {segments: TimeRange[]; intensity?: import('./editorial-motion-plan.mjs').MotionIntensity; highlights?: string[]; reserved?: TimeRange[]; language?: TranscriptionLanguage; transcribe?: boolean};
export type MotionResponse = {revision: number; motion: import('./editorial-motion-plan.mjs').MotionPlan; summary: string};
export const defaultSilenceOptions: Readonly<SilenceOptions>;
export function silenceOptions(input?: Partial<SilenceOptions>): SilenceOptions;
export function assertAnalyzable(metadata: {duration: number}): void;
export function silenceDetectArgs(path: string, options?: Partial<SilenceOptions>): string[];
export function parseSilences(text: string, duration: number): TimeRange[];
export function silenceCandidates(silences: TimeRange[], options: {duration: number; padding?: number}): {candidates: EditCandidate[]; limitations: EditLimitation[]};
export function validateTranscript(input: unknown, duration: number, info?: {origin?: ImportedTranscript["origin"]; engine?: string; model?: string; language?: string}): ImportedTranscript | null;
export function retakeCandidates(transcript: ImportedTranscript | null): EditCandidate[];
export function keptSegments(removed: TimeRange[], duration: number): TimeRange[];
export function validatePlan(plan: unknown, sourceDuration: number): {plan: NormalizedEditPlan; outputDuration: number};
export function removedSegments(segments: TimeRange[], duration: number): TimeRange[];
export function planHash(source: SourceRef, plan: NormalizedEditPlan): string;
/** Without `audio` the filter is the legacy one. `video:false` builds the audio-only chain (processed audio preview). */
export function cutFilter(segments: TimeRange[], options: {hasAudio: boolean; format?: 'original' | 'portrait'; normalizeAudio?: boolean; audio?: Partial<AudioTreatment>; video?: boolean; motion?: import('./editorial-motion-plan.mjs').MotionPlan; source?: {width: number; height: number}}): string;
export const audioTreatment: Readonly<{minNoiseFloorDb: number; maxNoiseFloorDb: number; reductionDb: number; highpassHz: number; cutFadeSeconds: number}>;
export function validateAudioTreatment(input: unknown): AudioTreatment;
export type CutReviewItem = {id: string; start: number; end: number; duration: number; outputAt: number; basis: 'audio' | 'transcript' | 'none'; soundSeconds: number | null; speechSeconds: number; speech: string[]};
/** With `evidence`, each cut also lists removed words and the suggestions it covers. */
export type CutReviewEvidenceItem = CutReviewItem & {removedWords: string[]; candidateIds: string[]; kinds: string[]; reasons: string[]};
export function cutReview(segments: TimeRange[], sourceDuration: number, transcriptSegments?: {start: number; end: number; text: string}[], silences?: TimeRange[]): CutReviewItem[];
export function cutReview(segments: TimeRange[], sourceDuration: number, transcriptSegments: {start: number; end: number; text: string}[], silences: TimeRange[] | undefined, evidence: {words?: {start: number; end: number; text: string}[]; candidates?: EditCandidate[]}): CutReviewEvidenceItem[];
export function outputTimeline(segments: TimeRange[]): (TimeRange & {outputStart: number})[];
export function remapTranscript(transcriptSegments: {start: number; end: number; text: string}[], segments: TimeRange[]): {start: number; end: number; text: string}[];
export function toSrt(segments: {start: number; end: number; text: string}[]): string;
