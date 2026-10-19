export type PreflightStage='script'|'notion'|'recording'|'edit'|'package'|'schedule';
export type PreflightLevel='ok'|'blocker'|'warning'|'unverified';
export interface PreflightCheck {id:string;stage:PreflightStage;level:PreflightLevel;message:string}
export interface PreflightAgent {id:string;name:string;workspaceId:string;providerId?:string;modelId?:string}
export interface ProviderStatus {available:boolean;auth:'connected'|'login-required'|'not-installed'|'error'|'unverified';imageGeneration:boolean;reconcile:boolean;imageFile?:boolean;/** Bound local editor tools (Claude editor authoring). */editorTools?:boolean}
export interface PreflightInput {
 workspaceId?:string;flow?:{id:string;name?:string;workspaceId:string;nodes:Array<{kind:string;agentId?:string}>};agents?:readonly PreflightAgent[];
 topic?:{id:string;workspaceId:string;status:string;title:string;updatedAt?:string};topicCurrent?:boolean;
 /** undefined = not read (unverified). */
 notion?:{autoSync?:boolean;dataSourceId?:string}|null;notionDestination?:string;
 /** B07: 'notion' (default, legacy) or 'local' (approved script releases recording without a card). */
 scriptMode?:'notion'|'local';
 /** undefined = not checked (unverified). */
 runtime?:{connected:boolean;imageFile?:boolean};
 /** Per-provider status; `available` (process/CLI present) is separate from `auth` (sign-in, checked locally without inference). */
 providers?:Partial<Record<'codex'|'claude',ProviderStatus>>;media?:{ffmpeg:boolean;ffprobe:boolean;thumbnails?:boolean;thumbnailReasons?:string[]};budget?:unknown;
 /** Editor authoring limits for a Claude editor (defaults: 2 corrections beyond the first plan, 3 previews). */
 editorLimits?:{maxRevisions?:number;maxPreviews?:number};
}
export interface PreflightReport {ready:boolean;fingerprint:string;checks:PreflightCheck[];blockers:PreflightCheck[];warnings:PreflightCheck[];unverified:PreflightCheck[]}
export const preflightStages:PreflightStage[];
export function productionPreflight(input?:PreflightInput,options?:{locale?:string}):PreflightReport;
export type EditorRoleSuggestion={status:'ok';agentId:string}|{status:'provider-unavailable';agentId:string;providerId:'claude';state:string}|{status:'suggest';agentId:string;replaces:string|null}|{status:'none'};
