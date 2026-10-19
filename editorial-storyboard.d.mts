export type Treatment = 'creator' | 'editorial' | 'technical';
export type CameraLayout = 'full' | 'split-left' | 'split-right' | 'split-top' | 'pip' | 'hidden';
export type TransitionKind = 'cut' | 'fade' | 'slide' | 'push' | 'wipe' | 'iris' | 'zoom';
export type Direction = 'left' | 'right' | 'up' | 'down';
export type BackgroundKind = 'none' | 'solid' | 'gradient' | 'grid' | 'dots';
export type LayerType = 'text' | 'counter' | 'steps' | 'process' | 'compare' | 'bars' | 'image' | 'video' | 'shape' | 'arrow' | 'callout' | 'chapter' | 'spotlight';
export type Slot = 'full' | 'panel' | 'panel-top' | 'panel-bottom' | 'top' | 'center' | 'bottom' | 'left' | 'right' | 'top-left' | 'top-right';
export type EasingName = 'linear' | 'in' | 'out' | 'inOut' | 'spring' | 'snappy';
export type EasingSpec = EasingName | {bezier: [number, number, number, number]};
export type EnterPreset = 'none' | 'fade' | 'rise' | 'drop' | 'slideLeft' | 'slideRight' | 'pop' | 'wipe' | 'blur' | 'typewriter' | 'draw';
export type ExitPreset = 'none' | 'fade' | 'sink' | 'slideLeft' | 'slideRight' | 'shrink' | 'wipe';
export type MaskKind = 'wipeLeft' | 'wipeRight' | 'wipeUp' | 'wipeDown' | 'circle' | 'diagonal';
export type TextRole = 'headline' | 'title' | 'body' | 'label' | 'caption' | 'quote';
export type TextMode = 'static' | 'words' | 'chars' | 'lines' | 'typewriter';
export type ColorToken = 'text' | 'muted' | 'accent' | 'accent2' | 'surface' | 'bg' | 'ink';
export type StatUnit = '%' | 'x' | 'k' | 'mil' | 'R$' | '$' | 'h' | 'min' | 's';
export type FactSource = 'speech' | 'brief' | 'user' | 'design';
export type SfxKind = 'whoosh' | 'pop' | 'tick';

/** Keyframe: `t` em segundos relativos ao início da camada (ou cena, para zoom de câmera); `ease` vale até o próximo. */
export type Keyframe = {t: number; v: number; ease?: EasingSpec};
export type KeyframeAt = Keyframe & {f: number};
export type Point = {x: number; y: number};
export type Box01 = {x: number; y: number; w: number; h: number};
export type LayerStyle = {color?: ColorToken; size?: 's' | 'm' | 'l' | 'xl'; weight?: 'regular' | 'bold' | 'black'; background?: 'none' | 'surface' | 'accent' | 'ink' | 'scrim'; italic?: boolean};
export type MotionPreset<P> = {preset: P; seconds?: number; ease?: EasingSpec};

type LayerBase = {
  id: string; start: number; end: number; slot?: Slot; box?: Box01; z?: number;
  enter?: MotionPreset<EnterPreset>; exit?: MotionPreset<ExitPreset>;
  keyframes?: Partial<Record<'opacity' | 'x' | 'y' | 'scale' | 'rotate', Keyframe[]>>;
  mask?: {kind: MaskKind; seconds: number; ease?: EasingSpec}; style?: LayerStyle;
  /** De onde vem o conteúdo exibido: fala (transcrição), briefing, usuário ou rótulo de design (sem números). */
  source: FactSource; quote?: string;
};
export type StoryLayer = LayerBase & (
  | {type: 'text'; text: string; role: TextRole; mode: TextMode; emphasis?: 'marker' | 'underline' | 'color' | 'box'; highlight?: string[]; align: 'left' | 'center' | 'right'}
  | {type: 'counter'; value: number; from: number; unit?: StatUnit; label?: string; decimals: number}
  | {type: 'steps'; items: string[]; reveal?: number[]}
  | {type: 'process'; nodes: string[]; reveal?: number[]}
  | {type: 'compare'; before: {label: string; text: string}; after: {label: string; text: string}; reveal?: number[]}
  | {type: 'bars'; values: {label: string; value: number; unit?: StatUnit}[]; reveal?: number[]}
  | {type: 'image'; assetId: string; fit: 'cover' | 'contain'; frame: 'none' | 'card' | 'browser' | 'phone'; caption?: string; kenBurns?: {from: {scale: number; x: number; y: number}; to: {scale: number; x: number; y: number}}}
  | {type: 'video'; assetId: string; fit: 'cover' | 'contain'; frame: 'none' | 'card' | 'browser' | 'phone'; caption?: string; trimStart: number}
  | {type: 'shape'; shape: 'rect' | 'circle' | 'line' | 'ring'; fill: ColorToken | 'none'; stroke: ColorToken | 'none'}
  | {type: 'arrow'; from: Point; to: Point; color: ColorToken}
  | {type: 'callout'; text: string; target: Point}
  | {type: 'chapter'; index: number; text: string}
  | {type: 'spotlight'; target: Box01; dim: number}
);
export type StoryScene = {id: string; name?: string; start: number; end: number; camera: {layout: CameraLayout; zoom?: Keyframe[]; focus?: Point}; background: {kind: BackgroundKind; tone: 'bg' | 'surface' | 'accent' | 'ink'}; transitionIn?: {kind: TransitionKind; seconds: number; direction: Direction; ease?: EasingSpec}; layers: StoryLayer[]};
export type StoryAsset = {id: string; kind: 'image' | 'video'; sha256: string; role: 'screenshot' | 'broll' | 'photo' | 'logo' | 'diagram'; label?: string};
/** Storyboard autorado (dados, nunca código). Tempos de cena na linha do tempo EDITADA; camadas relativas à cena. */
export type Storyboard = {version: 1; title?: string; timeline: {basis: 'output'; segmentsHash?: string}; style: {treatment: Treatment; accent?: string; accent2?: string}; assets: StoryAsset[]; scenes: StoryScene[]; sfx: {kind: SfxKind; at: number; gainDb: number}[]; notes?: string};

export type ProtectBand = {captionBand?: {top: number; bottom: number}};
export type ResolvedLayer = Omit<StoryLayer, 'start' | 'end' | 'keyframes' | 'enter' | 'exit' | 'mask'> & StoryLayer & {
  fromFrame: number; toFrame: number; revealFrames?: number[];
  keyframes?: Partial<Record<'opacity' | 'x' | 'y' | 'scale' | 'rotate', KeyframeAt[]>>;
  enter?: MotionPreset<EnterPreset> & {frames: number}; exit?: MotionPreset<ExitPreset> & {frames: number}; mask?: {kind: MaskKind; seconds: number; ease?: EasingSpec; frames: number};
};
export type ResolvedScene = {id: string; name?: string; startFrame: number; endFrame: number; camera: {layout: CameraLayout; zoom?: KeyframeAt[]; focus?: Point}; background: StoryScene['background']; transitionIn?: StoryScene['transitionIn'] & {frames: number}; layers: ResolvedLayer[]; cameraFrom: CameraLayout; cameraJoinedOut: boolean; screen?: SceneScreenMode; screenMode?: SceneScreenMode};
export type SceneScreenMode = 'off' | 'full' | 'with-camera';
export type Palette = Record<ColorToken, string>;
export type StoryboardProps = {
  version: 1; treatment: Treatment; palette: Palette;
  fonts: {display: string; body: string; displayWeight: number; upper: boolean; charWidth: number; radius: number; stroke: number};
  defaults: {enter: EnterPreset; exit: ExitPreset; transition: TransitionKind; ease: EasingName};
  assets: StoryAsset[]; scenes: ResolvedScene[]; sfx: {kind: SfxKind; at: number; gainDb: number}[]; protect?: ProtectBand; dropped: {id: string; reason: string}[];
};
export type Box = {left: number; top: number; right: number; bottom: number};
export type QaIssue = {id: string; code: string; detail?: string};
export type StoryboardQa = {ok: boolean; errors: QaIssue[]; warnings: QaIssue[]; checks: {layers: number; textLayers: number; minTextUnits: number | null; minContrast: number | null; scenes: number}};

export const STORYBOARD_VERSION: 1;
export const STORYBOARD_LIMITS: Readonly<Record<string, number>>;
export const storyboardTreatments: readonly Treatment[];
export const cameraLayouts: readonly CameraLayout[];
export const transitionKinds: readonly TransitionKind[];
export const directions: readonly Direction[];
export const backgroundKinds: readonly BackgroundKind[];
export const layerTypes: readonly LayerType[];
export const slots: readonly Slot[];
export const easings: readonly (EasingName | 'bezier')[];
export const enterPresets: readonly EnterPreset[];
export const exitPresets: readonly ExitPreset[];
export const maskKinds: readonly MaskKind[];
export const textRoles: readonly TextRole[];
export const textModes: readonly TextMode[];
export const emphasisKinds: readonly string[];
export const colorTokens: readonly ColorToken[];
export const shapeKinds: readonly string[];
export const imageFrames: readonly string[];
export const statUnits: readonly StatUnit[];
export const sfxKinds: readonly SfxKind[];
export const factSources: readonly FactSource[];
export const keyframeProps: Readonly<Record<string, [number, number]>>;
export const TREATMENTS: Readonly<Record<Treatment, Readonly<{label: string; display: string; body: string; displayWeight: number; upper: boolean; charWidth: number; radius: number; stroke: number; palette: Readonly<Palette>; enter: EnterPreset; exit: ExitPreset; transition: TransitionKind; ease: EasingName; background: BackgroundKind}>>>;
export const ROLE_SIZES: Readonly<Record<TextRole, number>>;
export const SIZE_SCALE: Readonly<Record<'s' | 'm' | 'l' | 'xl', number>>;
export const MIN_READABLE_UNITS: number;
export function safeStoryText(value: unknown, max: number): boolean;
export function segmentsHash(segments: {start: number; end: number}[]): string;
export function validateStoryboard(raw: unknown, options: {outputDuration: number; segments?: {start: number; end: number}[]}): Storyboard;
export function numbersIn(value: string): number[];
export function storyboardFactProblems(storyboard: Storyboard, sources?: {transcriptText?: string; briefText?: string; userTexts?: string[]}): {id: string; reason: string}[];
export function shapeOf(width: number, height: number): 'portrait' | 'landscape' | 'square';
export function safeArea(width: number, height: number): Box;
export function avoidBand(box: Box, height: number, protect?: ProtectBand): Box;
export function cameraRect(layout: CameraLayout, width: number, height: number, protect?: ProtectBand): {x: number; y: number; w: number; h: number};
export const sceneScreenModes: readonly SceneScreenMode[];
export function applyScreenModes(props: StoryboardProps, mode: SceneScreenMode): StoryboardProps;
export function screenBox(mode: SceneScreenMode, width: number, height: number, protect?: ProtectBand): {x: number; y: number; w: number; h: number};
export function containRect(box: {x: number; y: number; w: number; h: number}, w: number, h: number): {x: number; y: number; w: number; h: number};
export function panelBox(layout: CameraLayout, width: number, height: number, protect?: ProtectBand): Box;
export function slotBox(placement: {slot?: Slot; box?: Box01}, layout: CameraLayout, width: number, height: number, protect?: ProtectBand): Box;
export function wrapLines(value: string, size: number, boxWidth: number, charWidth: number): string[];
export function fitText(value: string, role: TextRole, sizeKey: string | undefined, box: Box, width: number, height: number, treatment: Treatment, options?: {maxLines?: number; display?: boolean}): {size: number; lines: string[]; lineHeight: number; overflow: boolean; text: string; units: number};
export function resolveStoryboardProps(storyboard: unknown, options: {fps: number; durationSeconds: number; protect?: ProtectBand}): StoryboardProps;
export function contrastRatio(a: string, b: string): number;
export function storyboardQa(props: StoryboardProps, options: {width: number; height: number; fps: number; cutsAt?: number[]; focus?: Point}): StoryboardQa;
export function qaFrames(props: StoryboardProps, options?: {perScene?: number}): {sceneId: string; moment: string; frame: number}[];
export function storyboardManifest(props: StoryboardProps, options: {fps: number; qa?: StoryboardQa; assetsVerified?: string[]}): Record<string, unknown>;
export function describeStoryboard(storyboard: Storyboard): string;
/** JSON Schema draft-07 do storyboard (guia para structured output/ferramentas; a autoridade é validateStoryboard). */
export function storyboardJsonSchema(): Record<string, unknown>;
/** Token de cor do texto (mesma regra no render e na QA). */
export function textColorToken(layer: {style?: LayerStyle}): ColorToken;
/** Cenas da revisão (timeline editada) para o gate de cobertura: [{id,name?,start,end}]. */
export function storyboardScenes(storyboard: Storyboard | undefined): {id: string; name?: string; start: number; end: number}[];
