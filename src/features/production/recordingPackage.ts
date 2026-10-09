// F02 — recording package. Pure helpers; no I/O. Consumes the F01 contract
// (run.scriptVersions / scriptApproval / notion) without importing model.ts.

export interface RecordingScriptVersion {
 version:number;hash:string;hook?:string;cta?:string;
 path?:{title?:string;outline?:string[]|string};
 text?:string;improvisationTopics?:string[];thumbnailDirection?:string;
}
export interface RecordingRunInput {
 stage?:string;
 scriptVersions?:RecordingScriptVersion[];
 scriptApproval?:{version:number;hash:string;approvedAt?:string}|null;
 notion?:{scriptVersion?:number;scriptHash?:string}|null;
 /** B07: 'local' skips the Notion check (the backend `recordingReady` is the authority). Absent = Notion (legacy). */
 scriptMode?:'notion'|'local';
}

export const CHECKLIST_ITEMS=['framing','light','audio','product'] as const;
export type ChecklistItemId=typeof CHECKLIST_ITEMS[number];
export type ChecklistItems=Partial<Record<ChecklistItemId,boolean>>;
/** Persisted by the caller; always bound to the script version/hash it was ticked for. */
export interface RecordingChecklistState {version:number;hash:string;items:ChecklistItems}

export interface RecordingScene {index:number;title:string}
export interface RecordingSuggestion {id:string;sceneIndex:number;kind:'broll'|'material';text:string}
export interface RecordingPackage {
 version:number;hash:string;approvedAt?:string;
 script:string;hook:string;cta:string;pathTitle:string;
 scenes:RecordingScene[];improvisationTopics:string[];thumbnailDirection:string;
 suggestions:RecordingSuggestion[];
}
export type RecordingBlockReason='no-script'|'no-approval'|'approval-not-latest'|'approval-hash-mismatch'|'notion-missing'|'notion-mismatch';
export type RecordingPackageResult={ok:true;pkg:RecordingPackage}|{ok:false;reason:RecordingBlockReason};

export function latestScriptVersion(run:RecordingRunInput):RecordingScriptVersion|undefined{
 const list=Array.isArray(run.scriptVersions)?run.scriptVersions.filter(v=>v&&Number.isFinite(v.version)):[];
 return list.reduce<RecordingScriptVersion|undefined>((a,v)=>!a||v.version>a.version?v:a,undefined);
}

/** Gate: latest version is the approved one (same hash) and, in Notion mode, Notion holds that same version/hash. */
export function recordingGate(run:RecordingRunInput):{ok:true}|{ok:false;reason:RecordingBlockReason}{
 const latest=latestScriptVersion(run);
 if(!latest)return {ok:false,reason:'no-script'};
 const a=run.scriptApproval;
 if(!a)return {ok:false,reason:'no-approval'};
 if(a.version!==latest.version)return {ok:false,reason:'approval-not-latest'};
 if(!a.hash||a.hash!==latest.hash)return {ok:false,reason:'approval-hash-mismatch'};
 if(run.scriptMode==='local')return {ok:true};
 const n=run.notion;
 if(!n||n.scriptVersion==null||!n.scriptHash)return {ok:false,reason:'notion-missing'};
 if(n.scriptVersion!==latest.version||n.scriptHash!==latest.hash)return {ok:false,reason:'notion-mismatch'};
 return {ok:true};
}
export const recordingReady=(run:RecordingRunInput)=>recordingGate(run).ok;

const clean=(v:unknown)=>typeof v==='string'?v.trim():'';
export function sceneList(outline:unknown):RecordingScene[]{
 const raw=Array.isArray(outline)?outline:typeof outline==='string'?outline.split(/\r?\n/):[];
 return raw.map(clean).map(s=>s.replace(/^\s*(?:[-*•]|\d+[.)])\s*/,'')).filter(Boolean).map((title,i)=>({index:i+1,title}));
}

/** Generic, editable starting points derived only from the scene title (labeled as suggestions in the UI). Never names a real product. */
export function defaultSuggestions(scenes:RecordingScene[],pt=true):RecordingSuggestion[]{
 return scenes.flatMap(s=>[
  {id:`broll-${s.index}`,sceneIndex:s.index,kind:'broll' as const,
   text:pt?`Tomada de apoio da ação citada em "${s.title}".`:`Cutaway of the action mentioned in "${s.title}".`},
  {id:`material-${s.index}`,sceneIndex:s.index,kind:'material' as const,
   text:pt?`Materiais citados em "${s.title}" (liste só o que a cena menciona).`:`Materials mentioned in "${s.title}" (list only what the scene mentions).`},
 ]);
}

export function buildRecordingPackage(run:RecordingRunInput,pt=true):RecordingPackageResult{
 const gate=recordingGate(run);
 if(!gate.ok)return gate;
 const v=latestScriptVersion(run)!;
 const scenes=sceneList(v.path?.outline);
 return {ok:true,pkg:{
  version:v.version,hash:v.hash,approvedAt:run.scriptApproval?.approvedAt,
  script:clean(v.text),hook:clean(v.hook),cta:clean(v.cta),pathTitle:clean(v.path?.title),
  scenes,improvisationTopics:(v.improvisationTopics||[]).map(clean).filter(Boolean),
  thumbnailDirection:clean(v.thumbnailDirection),suggestions:defaultSuggestions(scenes,pt),
 }};
}

export const emptyChecklist=(pkg:Pick<RecordingPackage,'version'|'hash'>):RecordingChecklistState=>({version:pkg.version,hash:pkg.hash,items:{}});

/** Returns the stored checklist only if it belongs to this exact version+hash; otherwise a fresh empty one. */
export function checklistForPackage(stored:RecordingChecklistState|null|undefined,pkg:Pick<RecordingPackage,'version'|'hash'>):RecordingChecklistState{
 return stored&&stored.version===pkg.version&&stored.hash===pkg.hash?{...stored,items:{...stored.items}}:emptyChecklist(pkg);
}
export function toggleChecklistItem(stored:RecordingChecklistState|null|undefined,pkg:Pick<RecordingPackage,'version'|'hash'>,id:ChecklistItemId,checked:boolean):RecordingChecklistState{
 const base=checklistForPackage(stored,pkg);
 return {...base,items:{...base.items,[id]:checked}};
}
export const checklistProgress=(state:RecordingChecklistState)=>({done:CHECKLIST_ITEMS.filter(id=>state.items[id]===true).length,total:CHECKLIST_ITEMS.length});
