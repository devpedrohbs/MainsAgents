// Local update helper (no network, no AI). Never prints conversation content, credentials or tokens.
//   node scripts/local-update-backup.mjs activity               -> exit 0 idle, 3 active work (JSON summary)
//   node scripts/local-update-backup.mjs snapshot <out.json>    -> counts + canonical hashes (read-only)
//   node scripts/local-update-backup.mjs backup <dir>           -> SQLite online backup API + file copies + manifest
//   node scripts/local-update-backup.mjs compare <a.json> <b.json> [--allow-leases]
import {DatabaseSync,backup} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {cpSync,existsSync,mkdirSync,readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {basename,dirname,join,relative} from 'node:path';

const storage=join(homedir(),'.mainsagents','storage'),roaming=join(process.env.APPDATA??join(homedir(),'AppData','Roaming'),'mains-agents'),codexRuntime=join(roaming,'codex-runtime');
const databases={'storage/workspace-state.sqlite':join(storage,'workspace-state.sqlite'),'appdata/workspace-state.sqlite':join(roaming,'workspace-state.sqlite'),'appdata/editorial.sqlite':join(roaming,'editorial.sqlite'),'appdata/accounts.sqlite':join(roaming,'accounts.sqlite'),...Object.fromEntries(['state_5','thread_history_1','goals_1','memories_1','queue_1'].map(name=>[`codex-runtime/${name}.sqlite`,join(codexRuntime,`${name}.sqlite`)]))};
// Tables whose rows are only held while the app runs.
const leases=['workflow_worker_lease','agent_delegation_lease','production_lease'];
const activeStatus=/^(queued|pending|running|sending|streaming|in-?progress|starting|waiting|awaiting.*|processing|rendering|uploading|claimed)$/i;
const sha=value=>createHash('sha256').update(value).digest('hex');
const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])])):value;
const canonical=value=>{try{return JSON.stringify(sorted(JSON.parse(value)));}catch{return String(value);}};
const open=path=>new DatabaseSync(path,{readOnly:true});
const tables=db=>db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>row.name);
const walk=(dir,skip=()=>false)=>!existsSync(dir)?[]:readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{const path=join(dir,entry.name);if(skip(path,entry))return [];return entry.isDirectory()?walk(path,skip):entry.isFile()?[path]:[];});
const fileTree=(dir,skip)=>{const files=walk(dir,skip);return {count:files.length,bytes:files.reduce((sum,file)=>sum+statSync(file).size,0),sha:sha(files.map(file=>`${relative(dir,file)}:${sha(readFileSync(file))}`).sort().join('\n')).slice(0,16)};};

function skillFiles(){
 const files=new Set();if(!existsSync(databases['storage/workspace-state.sqlite']))return [];
 const db=open(databases['storage/workspace-state.sqlite']);try{
  for(const row of db.prepare("SELECT value FROM state WHERE key='agents'").all()){let agents=[];try{agents=JSON.parse(row.value);}catch{}
   for(const agent of Array.isArray(agents)?agents:[]){for(const file of Object.values(agent.skillFiles??{}))if(typeof file==='string'&&existsSync(file))files.add(file);
    if(typeof agent.skillsDirectory==='string'&&existsSync(agent.skillsDirectory))for(const file of walk(agent.skillsDirectory).filter(file=>basename(file).toLowerCase()==='skill.md'))files.add(file);}}
 }finally{db.close();}
 return [...files].sort();
}

export function snapshot(){
 const result={takenAt:new Date().toISOString(),databases:{},files:{}};
 for(const [name,path] of Object.entries(databases)){if(!existsSync(path)){result.databases[name]=null;continue;}const db=open(path);try{
  const entry={integrity:db.prepare('PRAGMA integrity_check').get().integrity_check,tables:{}};
  for(const table of tables(db))entry.tables[table]=db.prepare(`SELECT count(*) AS n FROM "${table}"`).get().n;
  if(entry.tables.state!==undefined){entry.state={};const columns=db.prepare('PRAGMA table_info(state)').all().map(column=>column.name),scope=columns.includes('profile')?"profile||'/'||key":'key';for(const row of db.prepare(`SELECT ${scope} AS k,value AS v FROM state ORDER BY 1`).all())entry.state[row.k]=sha(canonical(row.v)).slice(0,16);}
  result.databases[name]=entry;}finally{db.close();}}
 result.files['storage/images']=fileTree(join(storage,'images'));
 result.files['codex-runtime/sessions']=fileTree(join(codexRuntime,'sessions'));
 result.files.skills=Object.fromEntries(skillFiles().map((file,index)=>[`skill-${index}:${basename(dirname(file))}`,sha(readFileSync(file)).slice(0,16)]));
 return result;
}

function processes(){
 const rows=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress'],{windowsHide:true,maxBuffer:32*1024*1024}).toString()||'[]');
 const children=new Map();for(const row of rows){if(!children.has(row.ParentProcessId))children.set(row.ParentProcessId,[]);children.get(row.ParentProcessId).push(row);}
 const app=rows.filter(row=>/^MainsAgents\.exe$/i.test(row.Name)),ids=new Set(app.map(row=>row.ProcessId)),tree=[];
 const visit=id=>{for(const child of children.get(id)??[])if(!ids.has(child.ProcessId)){tree.push(child);visit(child.ProcessId);}};for(const row of app)visit(row.ProcessId);
 // node_repl/code-mode hosts are idle kernels of the CLI; media tools and agent CLIs mean work in progress.
 return {appProcesses:app.length,descendants:tree.map(row=>row.Name).sort(),working:tree.filter(row=>/^(ffmpeg|ffprobe|whisper.*|claude|remotion.*|chrome-headless.*)\.exe$/i.test(row.Name)).map(row=>row.Name)};
}

function openTurns(){
 // A rollout whose last task event is "task_started" is a turn still running (or interrupted without a close event).
 const cutoff=Date.now()-6*3600_000,open=[];
 for(const file of walk(join(codexRuntime,'sessions')).filter(file=>file.endsWith('.jsonl')&&statSync(file).mtimeMs>cutoff)){
  let last=null;for(const line of readFileSync(file,'utf8').split('\n')){if(!line.includes('"task_'))continue;const kind=line.match(/"type":"(task_started|task_complete|turn_aborted)"/)?.[1];if(kind)last=kind;}
  if(last==='task_started')open.push({rollout:basename(file).slice(-46,-6),modifiedSecondsAgo:Math.round((Date.now()-statSync(file).mtimeMs)/1000)});
 }
 return open;
}

export function activity(){
 const jobs=[];
 // Every app database (not the CLI's own): queues, productions, media and publication jobs live in these.
 for(const [name,path] of Object.entries(databases).filter(([name])=>!name.startsWith('codex-runtime/')))if(existsSync(path)){const db=open(path);try{for(const table of tables(db)){const columns=db.prepare(`PRAGMA table_info("${table}")`).all().map(column=>column.name);
  if(columns.includes('status'))for(const row of db.prepare(`SELECT status,count(*) AS n FROM "${table}" GROUP BY status`).all())if(activeStatus.test(String(row.status)))jobs.push({database:name,table,status:row.status,count:row.n});
  if(table==='production_runs'&&columns.includes('data_json'))for(const row of db.prepare('SELECT data_json FROM production_runs').all()){let stage;try{stage=JSON.parse(row.data_json).stage;}catch{}if(stage&&!['paused','blocked','canceled','complete','recording','script-review','video-review','covers-review','package-review','platforms','schedule'].includes(stage))jobs.push({database:name,table,status:stage,count:1});}
  // SRT editável (0.3.70+): a transcrição Whisper de um documento roda em segundo plano (job.status dentro do JSON).
  if(table==='content_srt_documents'&&columns.includes('data_json'))for(const row of db.prepare('SELECT data_json FROM content_srt_documents').all()){let job;try{job=JSON.parse(row.data_json).job;}catch{}if(job&&activeStatus.test(String(job.status)))jobs.push({database:name,table,status:`srt-${job.status}`,count:1});}
 }}finally{db.close();}}
 const proc=processes(),turns=openTurns();
 return {checkedAt:new Date().toISOString(),active:jobs.length>0||proc.working.length>0||turns.length>0,jobs,processes:proc,openTurns:turns};
}

async function runBackup(dir){
 const manifest={createdAt:new Date().toISOString(),method:'node:sqlite backup() (online SQLite backup API; committed WAL included)',databases:{},copies:{}};
 if(existsSync(dir)&&readdirSync(dir).length)throw Error(`Backup folder is not empty: ${dir}`);mkdirSync(dir,{recursive:true});
 for(const [name,path] of Object.entries(databases)){if(!existsSync(path))continue;const target=join(dir,'sqlite',name);mkdirSync(dirname(target),{recursive:true});
  const source=open(path);let pages;try{pages=await backup(source,target);}finally{source.close();}
  const copy=open(target);try{const counts={};for(const table of tables(copy))counts[table]=copy.prepare(`SELECT count(*) AS n FROM "${table}"`).get().n;manifest.databases[name]={pages,integrity:copy.prepare('PRAGMA integrity_check').get().integrity_check,tables:counts,sha256:null};}finally{copy.close();}
  manifest.databases[name].sha256=sha(readFileSync(target));
 }
 const copy=(label,from,skip)=>{if(!existsSync(from))return;const to=join(dir,'files',label);cpSync(from,to,{recursive:true,filter:path=>!skip?.(path)});manifest.copies[label]=fileTree(to);};
 // Every non-database file of the local storage (images, production media, attachments); databases came through the backup API.
 copy('storage',storage,path=>/\.sqlite(-wal|-shm|-journal)?$/i.test(path));
 copy('codex-runtime-generated-images',join(codexRuntime,'generated_images'));
 copy('codex-runtime-sessions',join(codexRuntime,'sessions'));
 // Renderer/profile files of the app (Local Storage, IndexedDB, Preferences, partitions) without caches, the CLI runtime
 // (copied above), databases (backup API) or credentials (account token, cookies, auth/config, sandbox secrets).
 const appSkip=/[\\/](codex-runtime|Cache|Code Cache|GPUCache|DawnGraphiteCache|DawnWebGPUCache|Shared Dictionary|Crashpad|blob_storage)([\\/]|$)|[\\/](account\.json|auth\.json|config\.toml|Cookies(-journal)?|DevToolsActivePort|LOCK|lockfile)$|\.sandbox|\.sqlite(-wal|-shm|-journal)?$/i;
 copy('appdata-mains-agents',roaming,path=>appSkip.test(path));
 const skills=skillFiles();skills.forEach((file,index)=>{const to=join(dir,'files','skills',`${index}-${basename(dirname(file))}`,basename(file));mkdirSync(dirname(to),{recursive:true});cpSync(file,to);});
 manifest.copies.skills={count:skills.length,sources:skills.map(file=>({path:file,sha:sha(readFileSync(file)).slice(0,16)}))};
 // Credentials (auth.json, config.toml, secrets, Network/Cookies) are not copied: the installer does not touch them.
 manifest.snapshot=snapshot();writeFileSync(join(dir,'manifest.json'),JSON.stringify(manifest,null,1));
 const bad=Object.entries(manifest.databases).filter(([,entry])=>entry.integrity!=='ok');if(bad.length)throw Error(`Backup integrity failed: ${bad.map(([name])=>name).join(', ')}`);
 for(const [name,entry] of Object.entries(manifest.databases)){const live=manifest.snapshot.databases[name];for(const [table,count] of Object.entries(entry.tables))if(!leases.includes(table)&&live?.tables[table]!==count)console.warn(`note: ${name}.${table} changed during backup (${count} -> ${live?.tables[table]})`);}
 return manifest;
}

export function compare(before,after,{allowLeases=true}={}){
 const differences=[];
 for(const name of new Set([...Object.keys(before.databases),...Object.keys(after.databases)])){const a=before.databases[name],b=after.databases[name];
  if(!a||!b){if(a!==b)differences.push(`${name}: present ${!!a} -> ${!!b}`);continue;}
  if(b.integrity!=='ok')differences.push(`${name}: integrity ${b.integrity}`);
  for(const table of new Set([...Object.keys(a.tables),...Object.keys(b.tables)]))if(a.tables[table]!==b.tables[table]&&!(allowLeases&&leases.includes(table)))differences.push(`${name}.${table}: ${a.tables[table]} -> ${b.tables[table]}`);
  for(const key of new Set([...Object.keys(a.state??{}),...Object.keys(b.state??{})]))if(a.state?.[key]!==b.state?.[key])differences.push(`${name} state ${key}: changed`);}
 for(const label of ['storage/images','codex-runtime/sessions'])if(JSON.stringify(before.files[label])!==JSON.stringify(after.files[label]))differences.push(`${label}: ${JSON.stringify(before.files[label])} -> ${JSON.stringify(after.files[label])}`);
 if(JSON.stringify(before.files.skills)!==JSON.stringify(after.files.skills))differences.push('skills: changed');
 return differences;
}

if(import.meta.url===`file:///${process.argv[1].replaceAll('\\','/')}`||process.argv[1]?.endsWith('local-update-backup.mjs')){
 const [command,...args]=process.argv.slice(2);
 if(command==='activity'){const result=activity();console.log(JSON.stringify(result,null,1));process.exitCode=result.active?3:0;}
 else if(command==='snapshot'){const result=snapshot();writeFileSync(args[0],JSON.stringify(result,null,1));console.log(`snapshot ${args[0]}: ${Object.entries(result.databases).map(([name,entry])=>`${name}=${entry?.integrity??'absent'}`).join(' ')}`);}
 else if(command==='backup'){const manifest=await runBackup(args[0]);console.log(`backup ${args[0]}: ${Object.entries(manifest.databases).map(([name,entry])=>`${name} ${entry.integrity} ${entry.sha256.slice(0,12)}`).join('; ')}; copies ${Object.entries(manifest.copies).map(([name,entry])=>`${name}=${entry.count}`).join(' ')}`);}
 else if(command==='compare'){const differences=compare(JSON.parse(readFileSync(args[0],'utf8')),JSON.parse(readFileSync(args[1],'utf8')),{allowLeases:!args.includes('--strict-leases')});console.log(differences.length?differences.join('\n'):'IDENTICAL (lease rows ignored)');process.exitCode=differences.length?4:0;}
 else{console.error('usage: activity | snapshot <out> | backup <dir> | compare <a> <b>');process.exitCode=2;}
}
