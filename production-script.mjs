import {artifactHash} from './editorial-jobs.mjs';

/**
 * Script approval gate for productions. Every saved script is an immutable version identified by the
 * hash of its data; recording is released only for the approved version whose Notion card was confirmed.
 * Any later change creates a new version and invalidates the previous approval.
 */
const text=(value,max,label,min=1)=>{if(typeof value!=='string'||value.trim().length<min||value.length>max)throw Error(`Revise ${label} do roteiro.`);return value.trim();};
const list=(value,max)=>Array.isArray(value)?value.filter(item=>typeof item==='string'&&item.trim()).map(item=>item.trim().slice(0,500)).slice(0,max):[];
/** The exact data hashed, stored in the Notion artifact and sent to later stages. */
export function scriptData(value){
 return {hook:value.hook,cta:value.cta,path:{title:value.path.title,outline:value.path.outline},text:value.text,improvisationTopics:list(value.improvisationTopics,12),thumbnailDirection:String(value.thumbnailDirection??'').slice(0,2000)};
}
export function scriptVersion(value,versions=[],source,createdAt){
 const data=scriptData(value);
 return {version:(versions.at(-1)?.version??0)+1,...data,hash:artifactHash(data),source,createdAt};
}
/** User edit: free text for hook/CTA/script, path from the agent's options or an edited title/outline. */
export function validateScriptEdit(input,options,latest){
 const path=input.path&&typeof input.path==='object'?input.path:Number.isInteger(input.pathIndex)&&options?.paths?.[input.pathIndex]?options.paths[input.pathIndex]:latest.path;
 return scriptData({hook:text(input.hook,500,'o hook'),cta:text(input.cta,500,'o CTA'),path:{title:text(path?.title,200,'o caminho'),outline:text(path?.outline,4000,'o caminho')},text:text(input.text,20000,'o texto',20),improvisationTopics:latest.improvisationTopics,thumbnailDirection:latest.thumbnailDirection});
}
/** B07: 'local' only when explicitly chosen; anything else (absent/legacy) is the Notion mode. */
export const scriptModeOf=p=>p?.scriptMode==='local'?'local':'notion';
/** Recording requires: a (non-pending) approval of the latest version, the same version in p.script, and — in Notion mode — a Notion card confirmed for it. */
export function recordingReady(p){
 const approved=p?.scriptApproval,latest=p?.scriptVersions?.at(-1);
 return !!approved&&!approved.reviewRequired&&latest?.hash===approved.hash&&!!p.script&&artifactHash(p.script)===approved.hash&&(scriptModeOf(p)==='local'||p.notion?.scriptHash===approved.hash);
}
const beforeRecording=['notion','recording','script-review'];
/**
 * Productions created before the gate (no `scriptGate`). Idempotent and side-effect free; persisted on the next write.
 * - still writing: nothing to migrate.
 * - in `notion`/`recording` (also paused/blocked there): the script becomes version 1 (legacy) WITHOUT an approval, so
 *   recording requires an explicit review. A confirmed card is bound to that hash, so approving v1 unchanged does not
 *   send a duplicate card; a card still being written finishes and then waits for review (`reviewRequired`).
 * - past recording (editing, review, package, schedule, complete, canceled): artifacts and progress are preserved and
 *   marked with a legacy approval; nothing is regenerated, re-sent to Notion or republished.
 */
export function migrateScriptGate(p){
 if(!p||p.scriptGate)return p;
 p.scriptGate=2;p.scriptVersions??=[];
 if(!p.script||typeof p.script!=='object'||typeof p.script.text!=='string')return p;
 const hash=artifactHash(p.script),at=p.createdAt??p.updatedAt,at_stage=['paused','blocked'].includes(p.stage)?p.resumeStage:p.stage;
 p.scriptVersions=[{version:1,...p.script,hash,source:'legacy',createdAt:at}];
 if(p.notion)p.notion={...p.notion,scriptVersion:1,scriptHash:hash};
 if(at_stage==='notion'&&!p.notion)p.scriptApproval={version:1,hash,approvedAt:at,legacy:true,reviewRequired:true};
 else if(beforeRecording.includes(at_stage)){if(p.stage==='recording'){p.stage='script-review';p.events=[...(p.events??[]),{action:'script-legacy-review',detail:'Produção anterior ao gate de roteiro: revise e aprove a versão 1 antes de gravar.',at:p.updatedAt??at}];}}
 else p.scriptApproval={version:1,hash,approvedAt:at,legacy:true};
 return p;
}
