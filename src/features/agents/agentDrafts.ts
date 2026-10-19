import type {AgentEditorValues,AgentProviderId,AgentTool} from './model/Agent';
import {validPaperDesign} from '../../../paper-design.mjs';
import {validPublishingAutomation} from '../../../publishing-automation.mjs';

/**
 * Unsaved agent-editor drafts, kept in the profile's persistent state (survive closing the drawer and restarting the app).
 * Scope: profile + workspace + the agent being edited, or one creation slot per workspace (and template). A draft never
 * moves to another profile, workspace or agent, and a creation draft never brings back the workspace it was started in.
 */
export const agentDraftStorageKey='agent-drafts';
export type AgentDraftMap=Record<string,{values:Partial<AgentEditorValues>;savedAt:string}>;
export interface AgentDraftScope{profile:string;workspaceId:string;agentId?:string;template?:string}

export const agentDraftKey=({profile,workspaceId,agentId,template}:AgentDraftScope)=>JSON.stringify([profile,workspaceId,agentId?`agent:${agentId}`:`new:${template??''}`]);
/** Key used before 0.3.61 (sessionStorage, shared by every profile/workspace for new agents). */
export const legacyAgentDraftKey=(agentId?:string,template?:string)=>`mainsagents:agent-draft:${agentId??template??'new'}`;

/** Draft values over the fallback; a creation draft always targets the CURRENT workspace. */
/** A persisted draft that is malformed (corrupted storage, old/foreign shape) is ignored as a whole: the editor opens on the fallback. */
export function restoreAgentDraft(drafts:AgentDraftMap,scope:AgentDraftScope,fallback:AgentEditorValues):AgentEditorValues{
 const saved:unknown=isRecord(drafts)?(drafts[agentDraftKey(scope)] as unknown as Record<string,unknown>|undefined)?.values:undefined;
 if(!isRecord(saved)||agentDraftValuesProblem(saved))return fallback;
 return {...fallback,...saved,...(scope.agentId?{}:{workspaceId:scope.workspaceId})};
}

export function putAgentDraft(drafts:AgentDraftMap,scope:AgentDraftScope,values:AgentEditorValues|undefined,at=new Date().toISOString()):AgentDraftMap{
 const key=agentDraftKey(scope);
 if(!values){if(!(key in drafts))return drafts;const {[key]:_removed,...rest}=drafts;return rest;}
 return {...drafts,[key]:{values,savedAt:at}};
}

/**
 * Legacy sessionStorage draft adopted only when it is unambiguous: an EXISTING agent of this profile (ids are unique) whose
 * draft does not point to another workspace. Legacy creation drafts ("new" or template name) were shared by every profile and
 * workspace, so they are never restored (they expire with the window session).
 */
export function adoptLegacyAgentDraft(raw:string|null,scope:AgentDraftScope&{agentWorkspaceId?:string}):Partial<AgentEditorValues>|undefined{
 if(!raw||!scope.agentId)return undefined;
 let parsed:unknown;try{parsed=JSON.parse(raw);}catch{return undefined;}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return undefined;
 const values=parsed as Partial<AgentEditorValues>;
 if(values.workspaceId&&values.workspaceId!==(scope.agentWorkspaceId??scope.workspaceId))return undefined;
 return values;
}

const isRecord=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
const draftIdentity=(key:string):[string,string,string]|null=>{
 let parsed:unknown;try{parsed=JSON.parse(key);}catch{return null;}
 return Array.isArray(parsed)&&parsed.length===3&&parsed.every(part=>typeof part==='string')&&/^(agent:.+|new:.*)$/.test(parsed[2])?parsed as [string,string,string]:null;
};

/** Backup validation: every key is a [profile, workspace, agent|creation slot] identity and every value a saved draft. */
export function validateAgentDrafts(value:unknown):value is AgentDraftMap{
 return !agentDraftsProblem(value);
}

const textFields=['name','role','description','instructions','workspaceId','skillsDirectory','skillsInstallKey','modelId','avatarImage'] as const;
const agentTools:readonly AgentTool[]=['web-search','files','canvas-context','subagents'];
const providerIds:readonly AgentProviderId[]=['codex','claude','gemini'];
const mcpPermissionValues:readonly NonNullable<AgentEditorValues['mcpPermissions']>[number][]=['read','write','schedule','publish','delete','unknown'];
const stringList=(value:unknown,allowed?:readonly string[])=>Array.isArray(value)&&value.every(item=>typeof item==='string'&&(!allowed||allowed.includes(item)));
const exactObject=(value:unknown,shape:Record<string,'boolean'|'string'>)=>isRecord(value)&&Object.keys(value).every(key=>key in shape)&&Object.entries(shape).every(([key,type])=>typeof value[key]===type);

/**
 * Why a draft's values cannot be used by the agent editor, or undefined when they can. Every field is optional (a Partial
 * falls back to the editor defaults), but a field that is present must have the editor's type; unknown fields are refused.
 * Permissions and access settings are never repaired: an invalid one rejects the whole draft.
 */
export function agentDraftValuesProblem(values:unknown):string|undefined{
 if(!isRecord(values))return 'values must be an object';
 for(const [field,value] of Object.entries(values)){
  if((textFields as readonly string[]).includes(field)){if(typeof value!=='string')return `"${field}" must be text`;}
  else if(field==='tools'){if(!stringList(value,agentTools))return `"tools" must be a list of ${agentTools.join(', ')}`;}
  else if(field==='skills'||field==='disabledSkills'){if(!stringList(value))return `"${field}" must be a list of text`;}
  else if(field==='skillFiles'){if(!isRecord(value)||!Object.values(value).every(item=>typeof item==='string'))return '"skillFiles" must map skill names to file paths';}
  else if(field==='providerId'){if(!providerIds.includes(value as AgentProviderId))return `"providerId" must be one of ${providerIds.join(', ')}`;}
  else if(field==='mcpPermissions'){if(!stringList(value,mcpPermissionValues))return `"mcpPermissions" must be a list of ${mcpPermissionValues.join(', ')}`;}
  else if(field==='notionAutomation'){if(!exactObject(value,{enabled:'boolean',dataSourceId:'string'}))return '"notionAutomation" must be {enabled: boolean, dataSourceId: text}';}
  else if(field==='fileAccess'){if(!exactObject(value,{enabled:'boolean',outputDirectory:'string'}))return '"fileAccess" must be {enabled: boolean, outputDirectory: text}';}
  else if(field==='paperDesign'){if(!validPaperDesign(value))return '"paperDesign" must contain a valid Paper file and visual direction';}
  else if(field==='publishingAutomation'){if(!validPublishingAutomation(value))return '"publishingAutomation" must be {enabled: boolean, provider: ""|publora|zernio, timeZone: IANA zone or ""}';}
  else return `unknown field "${field}"`;
 }
 return undefined;
}

/** First problem of a whole draft map (backup import), naming the draft and field so the refusal is actionable. */
export function agentDraftsProblem(value:unknown):string|undefined{
 if(!isRecord(value))return 'agent drafts must be an object';
 for(const [key,entry] of Object.entries(value)){
  if(!draftIdentity(key))return `draft key ${JSON.stringify(key).slice(0,80)} is not a [profile, workspace, agent|new] scope`;
  if(!isRecord(entry)||typeof entry.savedAt!=='string')return `draft ${key.slice(0,80)} must have values and a savedAt text`;
  const problem=agentDraftValuesProblem(entry.values);if(problem)return `draft ${key.slice(0,80)}: ${problem}`;
 }
 return undefined;
}

/**
 * Drafts restored from a backup belong to the profile that imports it: keys are re-scoped to `profile`, and a draft whose
 * workspace (or edited agent) does not exist in the restored data is dropped, so nothing points at foreign records.
 * When two drafts land on the same key, the one already in `preferred` (the current profile's) wins.
 */
export function reindexAgentDrafts(drafts:AgentDraftMap,{profile,workspaceIds,agentIds,preferred={}}:{profile?:string;workspaceIds:ReadonlySet<string>;agentIds:ReadonlySet<string>;preferred?:AgentDraftMap}):AgentDraftMap{
 const result:AgentDraftMap={};
 for(const source of [drafts,preferred])for(const [key,entry] of Object.entries(source)){
  const identity=draftIdentity(key);if(!identity)continue;
  const [owner,workspaceId,slot]=identity;
  if(!workspaceIds.has(workspaceId)||slot.startsWith('agent:')&&!agentIds.has(slot.slice(6)))continue;
  result[JSON.stringify([profile??owner,workspaceId,slot])]=entry;
 }
 return result;
}
