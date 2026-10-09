import type { EditorialAsset } from './assetModel';
export type TopicStatus = 'draft' | 'researching' | 'review' | 'approved' | 'rejected' | 'error';
export type ContentStatus = 'planning' | 'generating' | 'script-review' | 'script-rejected' | 'script-approved' | 'error';
export type WorkflowStage = 'research' | 'script' | 'handoff';
export type ContentFormat = 'short-video' | 'long-video' | 'carousel';
export type Platform = 'Instagram' | 'TikTok' | 'YouTube' | 'LinkedIn';
export type ProductionStage = 'planning' | 'ready-to-record' | 'recording' | 'editing' | 'video-review' | 'ready' | 'archived';
export type Priority = 'normal' | 'urgent';

export interface SourceReference { title:string; url:string }
export interface ResearchProposal {
  title:string;
  category:string;
  summary:string;
  whyItMatters:string;
  angles:string[];
  sources:SourceReference[];
  factualQuestions:string[];
}
export interface ScriptPath { title:string; outline:string }
export interface CarouselSlide {order:number;title:string;text:string;imageBrief:string;sourceUrls:string[]}
export interface CarouselDraft {slides:CarouselSlide[];caption:string;sources:SourceReference[]}
export interface ScriptOptions {
  hooks:string[];
  ctas:string[];
  paths:ScriptPath[];
  improvisationTopics:string[];
  thumbnailDirection:string;
  draftScript:string;
  carousel?:CarouselDraft;
}
export interface EditorialTopic extends ResearchProposal {
  id:string; workspaceId:string; requestId:string; inputKind:'text'|'url'|'ideas'; input:string;
  originUrl?:string; priority:Priority; status:TopicStatus; researchArtifactId?:string;
  contentId?:string; lastError?:string; createdAt:string; updatedAt:string;
}
export interface EditorialContent {
  id:string; workspaceId:string; topicId:string; title:string; format:ContentFormat; platforms:Platform[];
  status:ContentStatus; plannedAt?:string; taskId:string; scriptOptionsArtifactId?:string;
  approvedScriptArtifactId?:string; lastError?:string; createdAt:string; updatedAt:string;
  fileDeliveryArtifactId?:string;
  productionStage?:ProductionStage; assetIds?:string[];
}
export interface WorkflowRun {
  id:string; workspaceId:string; topicId:string; contentId?:string; stage:WorkflowStage;
  agentId:string; providerId:string; modelId?:string; sessionId?:string;
  input:string; outputArtifactIds:string[]; state:'running'|'completed'|'failed'|'interrupted'|'canceled';
  jobId?:string;codexThreadId?:string;
  error?:string; startedAt:string; finishedAt?:string;
}
export interface EditorialArtifact {
  id:string; workspaceId:string; topicId:string; contentId?:string; runId?:string;
  type:'research'|'script-options'|'script'|'script-draft'|'specialist-result'|'file-delivery'; version:number;
  data:ResearchProposal|ScriptOptions|ApprovedScript|SpecialistResult|FileDelivery; createdAt:string;
  source?:{sessionId:string;messageId:string;messageHash:string;agentId:string};
}
export interface ApprovedScript {
  hook:string; cta:string; path:ScriptPath; text:string; improvisationTopics:string[]; thumbnailDirection:string;
  carousel?:CarouselDraft;
}
export interface EditorialApproval {
  id:string; workspaceId:string; topicId:string; contentId?:string; artifactId:string; artifactVersion:number;
  decision:'approved'|'rejected'|'revision-requested'; notes:string; decidedAt:string;
  action?:'script-approve'|'notion-upsert'|'script-review'|'file-review';destination?:string;
}
export interface EditorialState {
  schemaVersion:1; topics:EditorialTopic[]; contents:EditorialContent[]; runs:WorkflowRun[];
  artifacts:EditorialArtifact[]; approvals:EditorialApproval[];
  assets?:EditorialAsset[];
  publications?:PublicationDelivery[];
  /** Reference library (F05). Validated on the server by editorial-inspiration.mjs. */
  inspiration?:import('./inspiration').InspirationLibraryState;
}
export type PublicationStatus='draft'|'in-review'|'approved'|'sending'|'scheduled'|'published'|'failed';
export interface PublicationMedia {assetId:string;versionId:string;sha256:string}
export interface PublicationPayload {platform:Platform;text:string;media:PublicationMedia[];cover?:PublicationMedia;plannedAt?:string;timeZone:string;networkSettings?:{contentType?:'story';shareToFeed?:boolean;tiktokSettings?:{privacy_level:string;commercialContentType:string;allow_comment:boolean;allow_duet:boolean;allow_stitch:boolean;content_preview_confirmed:boolean;express_consent_given:boolean;video_made_with_ai:boolean}}}
export interface PublicationDelivery extends PublicationPayload {
  id:string;contentId:string;workspaceId:string;version:number;status:PublicationStatus;createdAt:string;updatedAt:string;
  receipt?:{id:string;checkedAt:string;version:number;provider?:string;status?:string;scheduledAt?:string;platformPostId?:string};
  operation?:{id:string;provider:'publora'|'zernio';platform?:string;timeZone?:string;networkSettings?:PublicationPayload['networkSettings'];stage?:'uploading'|'creating'|'finalizing'|'done'|'editing'|'canceling';files?:Array<PublicationMedia&{name:string;size:number;type:'image'|'video';contentType:string}>;uploads?:Array<PublicationMedia&{name:string;type:'image'|'video';url:string;status:'pending'|'uploaded';mediaId?:string}>;phase:'preview'|'requesting'|'uncertain'|'confirmed';mode:'draft'|'schedule';accountId:string;payloadHash:string;expiresAt:string;createdAt:string;externalId?:string;cancelRequestId?:string;finalizeRequestId?:string;error?:string;arguments:{content:string;platforms:string[];scheduledTime?:string;idempotencyKey:string}};
  history:Array<{version:number;status:PublicationStatus;decision:string;notes:string;payloadHash:string;payload:PublicationPayload;at:string}>;
}
export interface EditorialJob {
  id:string;contentId:string;artifactId:string;status:'queued'|'running'|'succeeded'|'failed'|'canceled';
  attempts:number;error?:string;createdAt:string;updatedAt:string;
  result?:{pageId:string;url:string;verifiedAt:string;artifactVersion:number};
}
export interface NotionConnection {dataSourceId:string;autoSync:boolean}
export const emptyEditorialState=():EditorialState=>({schemaVersion:1,topics:[],contents:[],runs:[],artifacts:[],approvals:[]});
export const newEditorialId=(prefix:string)=>`${prefix}-${crypto.randomUUID()}`;

export {parseProviderJson,validateResearch,validateScriptOptions,researchPrompt,scriptPrompt} from '../../../editorial-protocol.mjs';

export interface SpecialistResult {summary:string;outputFiles:import('./assetModel').LocalAssetInspection[];blockers:string[]}
export interface FileDelivery {summary:string;files:Array<{assetId:string;versionId:string;sha256:string;path:string;caption:string}>}
export interface VideoMetadata {duration:number;width:number;height:number;hasAudio:boolean;videoCodec:string;audioCodec?:string}
export interface MediaJob {id:string;workspaceId:string;contentId:string;assetId:string;versionId:string;inputPath:string;start:number;duration:number;status:'queued'|'running'|'succeeded'|'failed'|'interrupted'|'canceled';progress:number;error?:string;imported?:boolean;mode?:'advanced';planHash?:string;plan?:{segments:Array<{start:number;end:number}>};createdAt:string;updatedAt:string;result?:{file:import('./assetModel').LocalAssetInspection;metadata:VideoMetadata;assetId:string}}
export interface WorkflowJob {
  id:string;workspaceId:string;targetId:string;topicId:string;contentId?:string;kind:WorkflowStage;
  agent:{id:string;name:string};sourceAgent?:{id:string;name:string};
  status:'queued'|'running'|'succeeded'|'failed'|'interrupted'|'blocked'|'canceled';phase:string;attempt:number;
  threadId?:string;sessionId?:string;executionId?:string;activity?:string;prompt?:string;output:string;error?:string;
  files:Array<{assetId:string;versionId:string;path:string;sha256:string;name:string}>;
  result?:ResearchProposal[]|ScriptOptions|SpecialistResult;history:Array<{attempt:number;output:string;error?:string}>;
  events?:Array<{type:string;detail:string;at:string}>;createdAt:string;updatedAt:string;
}

export interface EditRange {start:number;end:number}
/** POST /api/content/media/review — read-only comparison of the raw recording and an automatic edit. */
/** Editable motion plan of an automatic edit (editorial-motion-plan.mjs). Anchors are on the recording; start/end on the edited video. */
export interface MotionCuePlan {id:string;kind:'punchIn'|'kineticText'|'keyPoint'|'explainer';explainer?:{visual:{type:string}&Record<string,unknown>;origin:'speech'|'user';quote?:string};sourceStart:number;sourceEnd:number;start:number;end:number;text?:string;focus?:string;layout:'camera-full'|'split'|'motion-focus';strength:number;scale?:number;source:'measured'|'inferred'|'mixed'|'user';timing:'words'|'estimated';reason:string;signals:Array<{kind:string;source:'measured'|'inferred'|'user';value?:number}>;sfx?:{kind:'whoosh'|'pop'|'tick';gainDb:number;ducked:boolean}}
export interface MotionPlan {version:1;intensity:'off'|'subtle'|'balanced'|'intense';analysis:{wordTiming:'words'|'estimated'|'none';voice:'measured'|'unavailable';limitations:string[];measuredCandidates:number;inferredCandidates:number};cues:MotionCuePlan[];reframe?:MotionReframe}
/** Framing focus (editorial-reframe.mjs): points anchored on the RECORDING timeline, x/y normalized 0..1. */
export interface MotionReframe {mode:'fixed'|'manual'|'face';source:'default'|'user'|'detected';points:Array<{t:number;x:number;y:number;w?:number;h?:number}>}
export interface EditReviewData {
  revision:number;job:{id:string;planHash:string;createdAt:string};sourceCurrent:boolean;
  source:{contentId:string;assetId:string;versionId:string;sha256:string;duration:number};
  output:{assetId:string;versionId:string;duration:number}|null;subtitles:{assetId:string;name:string}|null;
  plan:{segments:EditRange[];animations:Array<{id:string;kind:'title'|'lowerThird'|'cta';text:string;subtitle?:string;start:number;duration:number}>;format:'original'|'portrait';normalizeAudio:boolean;theme:'dark'|'light';motion?:MotionPlan;audio?:AudioTreatment};
  kept:Array<EditRange&{outputStart:number}>;cuts:Array<EditRange&{id:string;duration:number;outputAt:number;basis:'audio'|'transcript'|'none';soundSeconds:number|null;speechSeconds:number;speech:string[]}>;silenceOptions:{thresholdDb:number;minDuration:number;padding:number}|null;silences:EditRange[]|null;
  transcript:{origin:string;language?:string;timing:'words'|'sentences';segments:Array<EditRange&{text:string}>;words?:Array<EditRange&{text:string}>}|null;possibleRetakes:Array<EditRange&{id:string;label:string;reason:string}>;
  /** Pause noise floor/levels measured locally (editorial-audio-cleanup); null until measured. */
  audio?:AudioAssessment|null;
  /** Speech suggestions (fillers, repetitions, retakes, self-corrections); never pre-selected. */
  speechCandidates?:Array<EditRange&{id:string;kind:'filler'|'repetition'|'retake'|'selfCorrection';label:string;reason:string;confidence:'high'|'medium'|'low';evidence?:{text?:string;repeatedText?:string;timing?:string;boundary?:string;boundaryNote?:string}}>;
}
/** Opt-in voice treatment of an edit plan (editorial-smart-edit `plan.audio`). */
export interface AudioTreatment {leveling:boolean;noiseReduction:false|{noiseFloorDb:number};smoothCuts:boolean}
export interface AudioAssessment {stream:{channels:number;channelLayout:string|null;sampleRate:number;codec:string|null}|null;noiseFloorDb:number|null;speechLevelDb:number|null;measuredSeconds?:number;noiseReductionAvailable:boolean;reason:string;limitations:string[];measurement:{noiseFloorDb:number}|null}
/** POST /api/content/media/preview — proxy of the reviewed plan for the Remotion Player (same cut, same processed audio, renderer props). */
export interface EditPreviewData {
  revision:number;planHash:string;outputDuration:number;
  preview:{id:string;size:number;width:number;height:number;audio:'processed'|'processed-sfx'|'none';sfxSkipped:boolean};
  composition:{width:number;height:number;fps:number;durationSeconds:number;durationInFrames:number};
  props:Record<string,unknown>&{width:number;height:number;fps:number;durationSeconds:number;motion?:{cues:Array<{id:string;kind:string;startFrame:number;endFrame:number;text?:string}>;sfx:Array<{kind:string;at:number;gainDb:number}>}};
  overlays:string[];
}
