/** Round 8: IDs belong to profile + workspace; API never returns local paths. */
export interface ReferenceScope {profile:string;workspaceId:string}
export type JobStatus='queued'|'running'|'completed'|'partial'|'failed'|'cancelled'|'interrupted';
export interface ReferenceFolder {id:string;name:string;parentId:string|null;revision:number;createdAt:string;updatedAt:string}
export interface ReferenceVersion {id:string;sha256:string;name:string;size:number;duration:number;width:number;height:number;fps:number|null;createdAt:string;legacyAssetId?:string}
export interface ReferenceMarker {id:string;start:number;end:number;kind:'wanted'|'avoid'|'note';text:string}
export interface EditingReference {id:string;workspaceId:string;folderId:string|null;title:string;sourceUrl?:string;notes:string;tags:string[];markers:ReferenceMarker[];versions:ReferenceVersion[];currentVersionId:string|null;revision:number;createdAt:string;updatedAt:string;removedAt?:string;legacyId?:string}
export interface EvidenceFrame {id:string;time:number;sha256:string;width:number;height:number}
export interface ReferenceObservation {id:string;start:number;end:number;text:string;adaptation:string;frameIds:string[];limitations:string[];decision?:'keep'|'discard'|'approved'}
export interface ReferenceAnalysis {id:string;referenceId:string;versionId:string;referenceRevision:number;providerId:string;agentId:string;status:JobStatus;mode:'structure'|'motion';start:number;end:number;frames:EvidenceFrame[];coverage:{kind:'sampled';requested:[number,number];examined:number[];pending:number[]};observations:ReferenceObservation[];limitations:string[];error?:string;createdAt:string;updatedAt:string}
export interface EditingStyleProfile {id:string;name:string;revision:number;createdAt:string;updatedAt:string}
export interface EditingGuideline {id:string;profileId:string|null;text:string;enabled:boolean;revision:number;history:Array<{revision:number;text:string;enabled:boolean;at:string}>;source?:{referenceId:string;analysisId?:string;observationId?:string};createdAt:string;updatedAt:string}
export interface MotionSpec {title:string;text:string;kind:'title'|'diagram'|'callout'|'comparison';accent:string;background:string;duration:number;width:number;height:number;fps:number}
export interface StudyArtifact {id:string;kind:'video'|'frame'|'report'|'project';name:string;sha256:string;size:number}
export interface MotionStudy {id:string;title:string;referenceId?:string;versionId?:string;spec:MotionSpec;revision:number;status:JobStatus|'draft';jobId?:string;artifacts:StudyArtifact[];versions?:Array<{revision:number;spec:MotionSpec;artifacts:StudyArtifact[];createdAt:string}>;error?:string;createdAt:string;updatedAt:string}
export interface MotionKitItem {id:string;name:string;studyId:string;studyRevision:number;revision:number;createdAt:string}
export interface ReferenceJob {id:string;kind:'import'|'analysis'|'render'|'engine-prepare';targetId:string;status:JobStatus;phase:string;progress?:number;error?:string;createdAt:string;updatedAt:string}
export interface HyperframesEngine {status:'not-configured'|'checking'|'preparing'|'ready'|'incompatible'|'error';version:string|null;expectedVersion:string;message?:string;jobId?:string}
export interface ReferenceAgent {id:string;name:string;providerId:string;visual:boolean;reason?:string}
export interface ReferenceSnapshot extends ReferenceScope {schemaVersion:1;revision:number;folders:ReferenceFolder[];references:EditingReference[];analyses:ReferenceAnalysis[];profiles:EditingStyleProfile[];guidelines:EditingGuideline[];studies:MotionStudy[];kit:MotionKitItem[];jobs:ReferenceJob[];agents:ReferenceAgent[];engine:HyperframesEngine;projects?:Array<{contentId:string;referenceIds:string[];profileIds:string[];kitIds:string[];revision:number;updatedAt:string}>}
export interface EditingContextManifest {id:string;workspaceId:string;createdAt:string;referenceIds:string[];guidelines:Array<{id:string;revision:number;text:string}>;references:Array<{id:string;versionId:string|null;title:string;notes:string;markers:ReferenceMarker[];observations:ReferenceObservation[]}>;kit:Array<{id:string;studyId:string;studyRevision:number;spec:MotionSpec}>;text:string;truncated:boolean}
type Revision={id:string;expectedRevision:number};
export type ReferenceCommand=(
 | {type:'folder.create';name:string;parentId?:string|null}
 | ({type:'folder.update';name?:string;parentId?:string|null}&Revision)
 | ({type:'folder.delete'}&Revision)
 | {type:'folder.restore';undoId:string;expectedRevision:number}
 | {type:'reference.link';title:string;sourceUrl:string;folderId?:string|null;notes?:string;tags?:string[]}
 | ({type:'reference.update';title?:string;notes?:string;tags?:string[];folderId?:string|null;markers?:ReferenceMarker[];removed?:boolean;currentVersionId?:string}&Revision)
 | {type:'analysis.start';referenceId:string;versionId:string;expectedRevision:number;agentId:string;mode:'structure'|'motion';start:number;end:number}
 | {type:'job.cancel';id:string}
 | {type:'observation.decide';analysisId:string;observationId:string;decision:'keep'|'discard'}
 | {type:'profile.create';name:string}
 | ({type:'profile.update';name:string}&Revision)
 | {type:'guideline.approve';text:string;profileId?:string|null;referenceId?:string;analysisId?:string;observationId?:string}
 | ({type:'guideline.update';text?:string;enabled?:boolean;profileId?:string|null}&Revision)
 | {type:'study.create';title:string;referenceId?:string;versionId?:string;spec:MotionSpec}
 | ({type:'study.update';spec:MotionSpec;title?:string}&Revision)
 | ({type:'study.render'}&Revision)
 | {type:'kit.approve';studyId:string;expectedRevision:number;name:string}
 | {type:'project.attach';contentId:string;referenceIds:string[];profileIds?:string[];kitIds?:string[];expectedRevision?:number}
 | {type:'engine.prepare'})&{requestKey?:string};
export interface ReferenceCommandResult {snapshot:ReferenceSnapshot;entityId?:string;jobId?:string;undoId?:string}
export interface ContextSelection {referenceIds?:string[];profileIds?:string[];kitIds?:string[];executionId?:string}
