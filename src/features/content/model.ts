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
export interface ScriptOptions {
  hooks:string[];
  ctas:string[];
  paths:ScriptPath[];
  improvisationTopics:string[];
  thumbnailDirection:string;
  draftScript:string;
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
  type:'research'|'script-options'|'script'|'specialist-result'|'file-delivery'; version:number;
  data:ResearchProposal|ScriptOptions|ApprovedScript|SpecialistResult|FileDelivery; createdAt:string;
  source?:{sessionId:string;messageId:string;messageHash:string;agentId:string};
}
export interface ApprovedScript {
  hook:string; cta:string; path:ScriptPath; text:string; improvisationTopics:string[]; thumbnailDirection:string;
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
}
export type PublicationStatus='draft'|'in-review'|'approved'|'sending'|'scheduled'|'published'|'failed';
export interface PublicationMedia {assetId:string;versionId:string;sha256:string}
export interface PublicationPayload {platform:Platform;text:string;media:PublicationMedia[];plannedAt?:string;timeZone:string}
export interface PublicationDelivery extends PublicationPayload {
  id:string;contentId:string;workspaceId:string;version:number;status:PublicationStatus;createdAt:string;updatedAt:string;
  receipt?:{id:string;checkedAt:string;version:number;provider?:string;status?:string;scheduledAt?:string;platformPostId?:string};
  operation?:{id:string;provider:'publora';phase:'preview'|'requesting'|'uncertain'|'confirmed';mode:'draft'|'schedule';accountId:string;payloadHash:string;expiresAt:string;createdAt:string;externalId?:string;cancelRequestId?:string;error?:string;arguments:{content:string;platforms:string[];scheduledTime?:string;idempotencyKey:string}};
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
export interface MediaJob {id:string;workspaceId:string;contentId:string;assetId:string;versionId:string;inputPath:string;start:number;duration:number;status:'queued'|'running'|'succeeded'|'failed'|'interrupted'|'canceled';progress:number;error?:string;imported?:boolean;createdAt:string;updatedAt:string;result?:{file:import('./assetModel').LocalAssetInspection;metadata:VideoMetadata;assetId:string}}
export interface WorkflowJob {
  id:string;workspaceId:string;targetId:string;topicId:string;contentId?:string;kind:WorkflowStage;
  agent:{id:string;name:string};sourceAgent?:{id:string;name:string};
  status:'queued'|'running'|'succeeded'|'failed'|'interrupted'|'blocked'|'canceled';phase:string;attempt:number;
  threadId?:string;sessionId?:string;executionId?:string;activity?:string;prompt?:string;output:string;error?:string;
  files:Array<{assetId:string;versionId:string;path:string;sha256:string;name:string}>;
  result?:ResearchProposal[]|ScriptOptions|SpecialistResult;history:Array<{attempt:number;output:string;error?:string}>;
  events?:Array<{type:string;detail:string;at:string}>;createdAt:string;updatedAt:string;
}
