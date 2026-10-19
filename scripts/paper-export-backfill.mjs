// Records host receipts for a Paper export that ran before export receipts existed, from the export tool's ACTUAL result.
// Sources, all cross-checked (no AI, no network, no Paper call, nothing is re-exported or overwritten):
//   1. the app's own runtime action (approved + succeeded Paper `export` call, its arguments and session),
//   2. the Claude Code CLI transcript of that session's thread: the tool_use with exactly those arguments and its tool_result,
//   3. the saved session/agent (same thread, same Paper file), and each file on disk (written during that call, then hashed).
//   node scripts/paper-export-backfill.mjs --action <runtime-action-id>                    -> dry run
//   node scripts/paper-export-backfill.mjs --action <runtime-action-id> --apply <backup-dir> -> backup, then record receipts
// Receipts use the same source key as a live capture (<thread>:<tool_use_id>), so a later live capture never duplicates them.
import {existsSync,mkdirSync,readFileSync,readdirSync,statSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync,backup} from 'node:sqlite';
import {createDesktopStateStore} from '../desktop-state-store.mjs';
import {createDeliveryReceipts} from '../delivery-receipts.mjs';
import {createPaperAssetLedger,paperExportFiles} from '../paper-image-assets.mjs';
import {effectiveSessionAgent} from '../content-workflow-bridge.mjs';
import {actionHash} from '../runtime-action-approvals.mjs';
import {inspectLocalAsset} from '../editorial-local-files.mjs';

const option=name=>{const index=process.argv.indexOf(name);return index>0?process.argv[index+1]:undefined;};
const actionId=option('--action'),backupDir=option('--apply'),apply=process.argv.includes('--apply');
if(!actionId||apply&&!backupDir)throw Error('Usage: --action <runtime-action-id> [--apply <backup-dir>]');
const storage=join(homedir(),'.mainsagents','storage'),database=join(storage,'workspace-state.sqlite');
// Clock skew between the CLI, Paper Desktop and the app log.
const skewMs=5_000,settleMs=120_000;

const read=new DatabaseSync(database,{readOnly:true});
const row=read.prepare('SELECT * FROM runtime_actions WHERE id=?').get(actionId);
const version=read.prepare("SELECT value FROM metadata WHERE key='app-version'").get()?.value;read.close();
if(!row)throw Error('Runtime action not found.');
const action={...JSON.parse(row.payload_json),status:row.status,profileId:row.profile_id,createdAt:row.created_at,updatedAt:row.updated_at};
if(action.server!=='paper'||action.tool!=='export'||action.status!=='succeeded')throw Error(`Not a succeeded Paper export (${action.server}/${action.tool}/${action.status}).`);
if(action.provider!=='claude')throw Error('Only Claude Code transcripts are supported by this backfill.');

const store=createDesktopStateStore(storage,version);
if(store.currentProfile()!==action.profileId)throw Error('The action belongs to another profile.');
const values=store.readAllVersioned(action.profileId).values;
const session=(values.sessions??[]).find(item=>item.id===action.sessionId),saved=(values.agents??[]).find(item=>item.id===action.agentId);
const agent=saved&&session&&effectiveSessionAgent(saved,session);
if(!agent||agent.providerId!=='claude'||session.remoteSessionId!==action.threadId)throw Error('The saved session no longer matches the action (agent, provider or thread changed).');
if(agent.paperDesign?.fileId!==action.arguments.fileId)throw Error('The export was not in the agent\'s saved Paper file.');

// The CLI keeps one transcript per session id under ~/.claude/projects/<cwd>/<id>.jsonl.
const projects=join(homedir(),'.claude','projects');
const transcript=readdirSync(projects).map(name=>join(projects,name,`${action.threadId}.jsonl`)).find(path=>existsSync(path));
if(!transcript)throw Error('The Claude Code transcript of this thread was not found.');
let use,result;
for(const line of readFileSync(transcript,'utf8').split('\n')){
 let message;try{message=JSON.parse(line);}catch{continue;}
 for(const block of Array.isArray(message.message?.content)?message.message.content:[]){
  if(block.type==='tool_use'&&block.name==='mcp__paper__export'&&actionHash(block.input)===actionHash(action.arguments)){if(use)throw Error('Two identical export calls in this thread; refusing to guess which one the action approved.');use=block;}
  if(use&&block.type==='tool_result'&&block.tool_use_id===use.id)result=block;
 }
}
if(!use||!result)throw Error('The approved export call or its result is missing from the transcript.');
if(result.is_error)throw Error('The export call reported an error.');
const files=paperExportFiles({content:result.content});
if(!files.length)throw Error('The export result lists no files.');
// Each file must have been written during that call (not replaced afterwards); the bytes are hashed by the receipts.
const from=Date.parse(action.createdAt)-skewMs,to=Date.parse(action.updatedAt)+settleMs;
for(const file of files){const modified=statSync(file.path).mtimeMs;if(modified<from||modified>to)throw Error(`${file.path} changed after the export (modified ${new Date(modified).toISOString()}).`);}

const binding={profileId:action.profileId,sessionId:session.id,agentId:saved.id,agentName:saved.name,workspaceId:saved.workspaceId,providerId:'claude',agent,session};
const callId=`${action.threadId}:${use.id}`;
const order=Object.keys(action.arguments.nodes);
const planned=files.filter(file=>order.includes(file.nodeId)).sort((a,b)=>order.indexOf(a.nodeId)-order.indexOf(b.nodeId));
console.log(JSON.stringify({action:actionId,session:session.id,agent:saved.id,provider:'claude',fileId:action.arguments.fileId,callId,transcript:transcript.replace(homedir(),'~'),files:planned.map((file,index)=>({order:index+1,nodeId:file.nodeId,name:file.path.split(/[\\/]/).pop()}))},null,1));
if(!apply){console.log('Dry run: nothing written.');process.exit(0);}

mkdirSync(backupDir,{recursive:true});
// Keep the source handle referenced until the online backup finishes (an unreferenced handle can be collected mid-copy).
const source=new DatabaseSync(database,{readOnly:true});
try{await backup(source,join(backupDir,'workspace-state.sqlite'));}finally{source.close();}
const db=new DatabaseSync(database);db.exec('PRAGMA busy_timeout=5000');
try{
 const receipts=createDeliveryReceipts(db,{inspect:path=>inspectLocalAsset(path),getCurrentProfile:()=>store.currentProfile()});
 const issued=await createPaperAssetLedger({receipts,getCurrentProfile:()=>store.currentProfile()}).captureExport({binding,callId,arguments:action.arguments,result:{content:result.content}});
 console.log(JSON.stringify(issued.map(item=>({order:Number(item.source.step),name:item.name,size:item.size,sha256:item.sha256,id:item.id})),null,1));
}finally{db.close();}
