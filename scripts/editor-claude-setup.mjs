// Setup of the real "Editor de Vídeo" agent as a Claude agent + explicit migration of ITS halted productions.
// Default: DRY-RUN (state opened read-only, nothing written). --apply writes only after: app closed (process + production
// lease), an online SQLite backup (VACUUM INTO) verified, and compare-and-swap on the agents row and on each run/authority.
// No AI call, no render, no source file touched; chats/sessions are not read or written.
// Usage: node scripts/editor-claude-setup.mjs [--storage <dir>] [--json] [--apply]
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createDesktopStateStore} from '../desktop-state-store.mjs';
import {agentFileAccess} from '../agent-file-access.mjs';
import {loadEditorGuidance} from '../editor-guidance.mjs';
import {adoptEditorConfigRun,agentSnapshot,productionBindingHash} from '../production-coordinator.mjs';
import {artifactHash} from '../editorial-jobs.mjs';

export const EDITOR_AGENT_ID='editor-de-video-083621ee-20e1-40a5-b0ce-183ec20ba16f';
export const HALTED_RUNS=Object.freeze(['production-8314f2f5-0885-4416-a249-7b4c7f263f68','production-9bed8ebf-d811-4915-9a7d-d02a63704775']);
const sha=value=>createHash('sha256').update(value).digest('hex');

// Instruction edits: exact anchors (each must match once, or the plan fails instead of guessing).
const OLD_TOOLS_SECTION_START='## Ferramentas e saída local — atualização 08/10/2026';
export const NEW_TOOLS_SECTION=`## Ferramentas reais — atualização 15/10/2026
Você roda no Claude Code. No chat, lê arquivos (Read/Glob/Grep) e pode pesquisar na web; não há shell nem escrita: não afirme que gerou, cortou ou exportou arquivos por aqui. Entregue plano com timestamps reais ou peça a edição pelo fluxo do app. Você não inicia handoffs a outros agentes por este chat; recebe os do Editor de Conteúdo.
No fluxo de edição do app (Produção ou vídeo enviado pelo Editor de Conteúdo), você usa as ferramentas mainsagents_editor: contexto com o guia visual e sonoro do app e suas skills habilitadas, palavras com tempos reais (get_transcript_words), frames, plano validado (cortes + storyboard/motion), prévias, stills por cena e uma exportação final com recibo. O app renderiza localmente e preserva o original, a luz e a cor da gravação.
Pesquisa web serve para referências; não baixe nem use mídia sem licença. A pasta C:/Users/pacas/Pictures/VideosPacas/VideosSemiEditados continua registrada, mas a escrita direta nela só existe para agente Codex com Files. A aprovação do vídeo, a publicação e o agendamento continuam com o criador.`;
const instructionEdits=[
 ['O corte simples deve funcionar sozinho; efeitos e CapCut são opcionais.','O corte deve funcionar sozinho; acabamento/motion entra quando pedido, seguindo o guia visual e sonoro. A autorização da edição cobre os cortes e o acabamento pedidos; o criador revisa a prévia/resultado e pode pedir ajustes. CapCut é opcional.'],
];
export function patchInstructions(text){
 let next=text;
 for(const [from,to] of instructionEdits){if(next.split(from).length!==2)throw Error(`Instruction anchor not found exactly once: ${from.slice(0,60)}`);next=next.replace(from,to);}
 const i=next.indexOf(OLD_TOOLS_SECTION_START);if(i<0||next.indexOf(OLD_TOOLS_SECTION_START,i+1)>=0)throw Error('Tools section (08/10/2026) not found exactly once.');
 return `${next.slice(0,i).trimEnd()}\n\n${NEW_TOOLS_SECTION}`;
}
/** The configured agent: Claude with the CLI default model, write access honestly off, existing tools + web-search. */
export function claudeEditorAgent(agent){
 const tools=[...new Set([...(agent.tools??[]),'web-search'])];
 const next={...agent,providerId:'claude',...(agent.modelId!==undefined?{modelId:''}:{}),tools,...(agent.fileAccess?{fileAccess:{...agent.fileAccess,enabled:false}}:{}),instructions:patchInstructions(agent.instructions??'')};
 agentFileAccess(next,process.cwd()); // throws if the agent would still claim write access it cannot have
 return next;
}
const lineDiff=(a,b)=>{const A=a.split('\n'),B=b.split('\n'),setA=new Set(A),setB=new Set(B);return [...A.filter(line=>!setB.has(line)).map(line=>`- ${line}`),...B.filter(line=>!setA.has(line)).map(line=>`+ ${line}`)];};
const keyDiff=(a,b)=>[...new Set([...Object.keys(a),...Object.keys(b)])].filter(key=>JSON.stringify(a[key])!==JSON.stringify(b[key])).sort();

/** Plan from the state as it is now (read-only). Throws with the reason when anything does not match expectations. */
export function planEditorClaudeSetup({storage,agentId=EDITOR_AGENT_ID,runIds=HALTED_RUNS,at=new Date().toISOString()}={}){
 const db=new DatabaseSync(join(storage,'workspace-state.sqlite'),{readOnly:true});
 try{
  const profile=db.prepare("SELECT value FROM metadata WHERE key='active-profile'").get()?.value;if(!profile)throw Error('No active profile.');
  const appVersion=db.prepare("SELECT value FROM metadata WHERE key='app-version'").get()?.value;
  const row=db.prepare('SELECT value FROM state WHERE profile=? AND key=?').get(profile,'agents');if(!row)throw Error('No agents saved in the active profile.');
  const agents=JSON.parse(row.value),agent=agents.find(item=>item.id===agentId);if(!agent)throw Error(`Agent ${agentId} is not in the active profile.`);
  const next={...claudeEditorAgent(agent),updatedAt:at},updatedAgents=agents.map(item=>item.id===agentId?next:item);
  const fields=keyDiff(agent,next).filter(key=>key!=='updatedAt');
  const patch=fields.map(key=>key==='instructions'?{field:key,diff:lineDiff(agent.instructions??'',next.instructions)}:{field:key,from:agent[key]??null,to:next[key]??null});
  const contents=JSON.parse(db.prepare("SELECT name FROM sqlite_master WHERE name='editorial_state'").get()?db.prepare('SELECT state_json FROM editorial_state WHERE profile_id=?').get(profile)?.state_json??'{}':'{}').contents??[];
  const runs=runIds.map(id=>{
   const found=db.prepare('SELECT revision,data_json FROM production_runs WHERE profile_id=? AND id=?').get(profile,id);if(!found)throw Error(`Run ${id} not found in the active profile.`);
   const p={...JSON.parse(found.data_json),revision:found.revision};
   if(p.editorAgent?.id!==agentId)throw Error(`Run ${id} belongs to another editor agent.`);
   if(artifactHash(p.editorAgent)!==artifactHash(agentSnapshot(agent)))throw Error(`Run ${id} saved another configuration of the editor; refusing to migrate it.`);
   // Everything else guard() checks at Resume must already hold, so migrating the editor really unblocks the run:
   // source/publisher snapshots equal their live agents (never re-snapshotted here) and the linked content still exists.
   for(const role of ['sourceAgent','publisherAgent']){const saved=p[role]??(role==='publisherAgent'?p.sourceAgent:undefined);if(!saved||saved.id===agentId)continue;const live=agents.find(item=>item.id===saved.id&&item.workspaceId===p.workspaceId);if(!live||artifactHash(agentSnapshot(live))!==artifactHash(saved))throw Error(`Run ${id}: the ${role==='sourceAgent'?'source':'publisher'} agent changed since it was authorized; this setup does not adopt other agents.`);}
   if(!contents.some(content=>content.id===p.contentId&&content.workspaceId===p.workspaceId))throw Error(`Run ${id}: its content no longer exists.`);
   const authority=db.prepare('SELECT hash FROM production_authority WHERE profile_id=? AND run_id=?').get(profile,id)?.hash;
   if(authority!==productionBindingHash(p))throw Error(`Run ${id} has no valid authority for its saved configuration.`);
   const result=adoptEditorConfigRun(p,next,{at});if(!result.changed)throw Error(`Run ${id} already matches the new configuration.`);
   const run={...result.run,revision:found.revision+1,updatedAt:at};
   return {id,stage:p.stage,resumeStage:p.resumeStage,expected:{revision:found.revision,dataSha:sha(found.data_json),authority},write:{revision:run.revision,data:JSON.stringify(run),authority:result.after.authority},
    summary:{epoch:[result.before.epoch,result.after.epoch],authority:[authority.slice(0,16),result.after.authority.slice(0,16)],changedKeys:keyDiff(p,run),historyEntry:{epoch:p.epoch,checkpoint:p.authoring?.checkpoint?{revision:p.authoring.checkpoint.revision,calls:p.authoring.checkpoint.calls,finalized:p.authoring.checkpoint.finalized===true}:null,revisions:p.authoring?.revisions?.length??0,previews:p.authoring?.previews?.length??0},previousPlan:Boolean(run.authoring.previousPlan),stageAfter:[run.stage,run.resumeStage]}};
  });
  const guidance=loadEditorGuidance(next);
  return {mode:'dry-run',storage,profile,appVersion,agentId,agentsRevision:sha(row.value),agentsBefore:agents,agentsAfter:updatedAgents,agentName:agent.name,snapshotHash:[artifactHash(agentSnapshot(agent)).slice(0,16),artifactHash(agentSnapshot(next)).slice(0,16)],patch,runs,
   untouchedAgents:agents.filter(item=>item.id!==agentId).map(item=>item.id),guidance:guidance.items.map(item=>`${item.name}${item.truncated?' (truncado)':''}`),guidanceSkipped:guidance.skipped};
 }finally{db.close();}
}

/** Hash of every row of every table: proof of what an apply changed (and that nothing else did). */
export function tableDigests(path){
 const db=new DatabaseSync(path,{readOnly:true});
 try{return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>{const rows=db.prepare(`SELECT * FROM "${name}"`).all().map(row=>JSON.stringify(row)).sort();return [name,{rows:rows.length,sha:sha(rows.join('\n')),keys:rows.map(sha)}];}));}
 finally{db.close();}
}
/** Differences outside what this setup may change: the agents row, its agent_revisions copy, metadata.last-saved-at and the 2 runs. */
export function unexpectedChanges(before,after,plan){
 const problems=[],delta=name=>{const a=new Set(before[name]?.keys??[]),b=new Set(after[name]?.keys??[]);return {removed:[...a].filter(key=>!b.has(key)).length,added:[...b].filter(key=>!a.has(key)).length};};
 const allowed={state:[1,1],metadata:[1,1],agent_revisions:null,production_runs:[plan.runs.length,plan.runs.length],production_authority:[plan.runs.length,plan.runs.length]};
 for(const name of new Set([...Object.keys(before),...Object.keys(after)])){
  if(before[name]?.sha===after[name]?.sha)continue;
  if(!(name in allowed)){problems.push(`table ${name} changed`);continue;}
  const {removed,added}=delta(name);
  if(name==='agent_revisions'){if(added!==1||after[name].rows>50&&removed>1)problems.push('agent_revisions: expected one saved copy of the previous agents');continue;}
  const [maxRemoved,maxAdded]=allowed[name];if(removed>maxRemoved||added>maxAdded)problems.push(`${name}: ${removed} row(s) replaced, ${added} added`);
 }
 return problems;
}
export function defaultAppRunning(){
 if(process.platform!=='win32')return false;
 try{const out=execFileSync('tasklist',['/FO','CSV','/NH'],{encoding:'utf8',windowsHide:true});return /"(MainsAgents|electron)\.exe"/i.test(out);}catch{return true;}
}

/** Applies a plan made by planEditorClaudeSetup. Returns the backup path and the verified changes. */
export function applyEditorClaudeSetup(plan,{appRunning=defaultAppRunning,now=Date.now}={}){
 const path=join(plan.storage,'workspace-state.sqlite');
 if(appRunning())throw Error('Feche o MainsAgents antes de aplicar (processo em execução).');
 const probe=new DatabaseSync(path,{readOnly:true});
 let lease;try{lease=probe.prepare("SELECT name FROM sqlite_master WHERE name='production_lease'").get()?probe.prepare('SELECT expires FROM production_lease WHERE id=1').get():null;}finally{probe.close();}
 if(lease&&lease.expires>now())throw Error('O executor de produções ainda detém o lease: feche o MainsAgents e aguarde 30 s.');
 // Online backup, verified before anything is written.
 const backups=join(plan.storage,'backups');mkdirSync(backups,{recursive:true});
 const backup=join(backups,`before-editor-claude-${new Date(now()).toISOString().replace(/[:.]/g,'-')}.sqlite`);if(existsSync(backup))throw Error('Backup file already exists.');
 const source=new DatabaseSync(path);try{source.exec('PRAGMA busy_timeout=5000');source.prepare('VACUUM INTO ?').run(backup);}finally{source.close();}
 const before=tableDigests(path),saved=tableDigests(backup);
 if(JSON.stringify(before)!==JSON.stringify(saved))throw Error('The backup differs from the live state; nothing was written.');
 const check=new DatabaseSync(backup,{readOnly:true});try{if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Backup failed integrity_check; nothing was written.');}finally{check.close();}
 // Agents through the app's own store (CAS on the agents row; it also keeps the previous agents in agent_revisions).
 if(!plan.appVersion)throw Error('The state has no app-version; open it once with the app before applying.');
 const store=createDesktopStateStore(plan.storage,plan.appVersion);
 let written;
 try{
  if(store.currentProfile()!==plan.profile)throw Error('The active profile changed since the plan.');
  written=store.write(plan.profile,'agents',plan.agentsAfter,plan.agentsRevision);
  const db=new DatabaseSync(path);
  try{
   db.exec('PRAGMA busy_timeout=5000');db.exec('BEGIN IMMEDIATE');
   try{
    for(const run of plan.runs){
     const row=db.prepare('SELECT revision,data_json FROM production_runs WHERE profile_id=? AND id=?').get(plan.profile,run.id),authority=db.prepare('SELECT hash FROM production_authority WHERE profile_id=? AND run_id=?').get(plan.profile,run.id)?.hash;
     if(!row||row.revision!==run.expected.revision||sha(row.data_json)!==run.expected.dataSha||authority!==run.expected.authority)throw Error(`Run ${run.id} changed since the plan.`);
     db.prepare('UPDATE production_runs SET revision=?,data_json=?,updated_at=? WHERE profile_id=? AND id=? AND revision=?').run(run.write.revision,run.write.data,JSON.parse(run.write.data).updatedAt,plan.profile,run.id,run.expected.revision);
     db.prepare('UPDATE production_authority SET hash=? WHERE profile_id=? AND run_id=? AND hash=?').run(run.write.authority,plan.profile,run.id,run.expected.authority);
    }
    db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error;}
  }finally{db.close();}
 }catch(error){
  // Compensation: the runs did not move, so the agents row goes back to what it was (CAS on what this apply wrote).
  if(written)try{store.write(plan.profile,'agents',plan.agentsBefore,written.revision);}catch(restore){error.message+=` · agents NOT restored automatically (${restore.message}); restore from ${backup}`;}
  throw Object.assign(error,{backup});
 }finally{store.close();}
 const after=tableDigests(path),changed=Object.keys(after).filter(name=>after[name].sha!==before[name]?.sha),problems=unexpectedChanges(before,after,plan);
 if(problems.length)throw Object.assign(Error(`Unexpected changes after apply: ${problems.join('; ')}. Restore from ${backup}.`),{backup});
 return {mode:'applied',backup,changedTables:changed,before,after};
}

/**
 * Rehearsal on a COPY: VACUUM INTO of the real state (opened read-only), plan + apply on the copy, then the same checks guard()
 * makes at Resume (editor snapshot = live agent, authority = binding hash, source/publisher unchanged, content present) and
 * that each run's previous authoring is kept verbatim. The real state is compared before/after to prove it was not touched.
 */
export function rehearseOnCopy({storage,copyDir,at}={}){
 const real=join(storage,'workspace-state.sqlite'),realBefore=tableDigests(real);
 mkdirSync(copyDir,{recursive:true});const copy=join(copyDir,'workspace-state.sqlite');if(existsSync(copy))throw Error('Copy target already exists.');
 const source=new DatabaseSync(real,{readOnly:true});try{source.prepare('VACUUM INTO ?').run(copy);}finally{source.close();}
 const plan=planEditorClaudeSetup({storage:copyDir,at}),beforeRuns=new Map();
 {const db=new DatabaseSync(copy,{readOnly:true});try{for(const run of plan.runs)beforeRuns.set(run.id,JSON.parse(db.prepare('SELECT data_json FROM production_runs WHERE id=?').get(run.id).data_json));}finally{db.close();}}
 const result=applyEditorClaudeSetup(plan,{appRunning:()=>false});
 const db=new DatabaseSync(copy,{readOnly:true}),checks=[];
 try{
  const agents=JSON.parse(db.prepare('SELECT value FROM state WHERE profile=? AND key=?').get(plan.profile,'agents').value),live=id=>agents.find(agent=>agent.id===id);
  const editorial=JSON.parse(db.prepare('SELECT state_json FROM editorial_state WHERE profile_id=?').get(plan.profile)?.state_json??'{}');
  for(const run of plan.runs){
   const p=JSON.parse(db.prepare('SELECT data_json FROM production_runs WHERE id=?').get(run.id).data_json),old=beforeRuns.get(run.id),{history,...previous}=old.authoring??{};
   const authority=db.prepare('SELECT hash FROM production_authority WHERE profile_id=? AND run_id=?').get(plan.profile,run.id)?.hash;
   checks.push({run:run.id,
    editorSnapshotMatchesLive:artifactHash(agentSnapshot(live(p.editorAgent.id)))===artifactHash(p.editorAgent),
    sourceAndPublisherUnchangedAndLive:[['sourceAgent'],['publisherAgent']].every(([key])=>!p[key]||JSON.stringify(p[key])===JSON.stringify(old[key])&&artifactHash(agentSnapshot(live(p[key].id)))===artifactHash(p[key])),
    authorityIsNewBinding:authority===productionBindingHash(p)&&authority!==run.expected.authority,
    contentPresent:(editorial.contents??[]).some(content=>content.id===p.contentId&&content.workspaceId===p.workspaceId),
    epoch:[old.epoch,p.epoch],stage:[p.stage,p.resumeStage],
    previousAuthoringVerbatim:JSON.stringify(p.authoring.history.at(-1).authoring)===JSON.stringify(previous),
    oldCheckpointKept:JSON.stringify(p.authoring.history.at(-1).authoring.checkpoint??null)===JSON.stringify(old.authoring?.checkpoint??null),
    sessionsUntouched:JSON.stringify([p.sourceSession,p.editorSession,p.publisherSession])===JSON.stringify([old.sourceSession,old.editorSession,old.publisherSession]),
    inputVideoUntouched:JSON.stringify(p.inputVideo)===JSON.stringify(old.inputVideo)});
  }
  const otherAgentsIdentical=JSON.stringify(plan.agentsBefore.filter(agent=>agent.id!==plan.agentId))===JSON.stringify(agents.filter(agent=>agent.id!==plan.agentId));
  const realAfter=tableDigests(real);
  return {copy,backup:result.backup,changedTables:result.changedTables,otherAgentsIdentical,realStateUntouched:JSON.stringify(realBefore)===JSON.stringify(realAfter),checks};
 }finally{db.close();}
}

function printPlan(plan){
 console.log(`DRY-RUN — nothing was written (${plan.storage})`);
 console.log(`Agent ${plan.agentName} (${plan.agentId}) · snapshot ${plan.snapshotHash[0]} → ${plan.snapshotHash[1]}`);
 for(const item of plan.patch)if(item.diff){console.log(`\n[${item.field}]`);for(const line of item.diff)console.log(line);}else console.log(`[${item.field}] ${JSON.stringify(item.from)} → ${JSON.stringify(item.to)}`);
 console.log(`\nGuidance the editor would receive: ${plan.guidance.join(', ')}${plan.guidanceSkipped.length?` · skipped ${JSON.stringify(plan.guidanceSkipped)}`:''}`);
 console.log('\nRuns to migrate (adopt-agent-config, no AI/render until Resume):');
 for(const run of plan.runs)console.log(`- ${run.id} · ${run.stage}/${run.resumeStage} · epoch ${run.summary.epoch.join(' → ')} · authority ${run.summary.authority.join(' → ')} · history ${JSON.stringify(run.summary.historyEntry)} · previousPlan ${run.summary.previousPlan} · after ${run.summary.stageAfter.join('/')} · keys ${run.summary.changedKeys.join(',')}`);
 console.log(`\nOther agents untouched: ${plan.untouchedAgents.join(', ')}`);
 console.log('Allowed changes on --apply: state[agents] of this profile (+ agent_revisions backup row, metadata last-saved-at), production_runs and production_authority of the 2 runs above. Everything else must stay byte-identical.');
}

if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
 const arg=name=>{const i=process.argv.indexOf(name);return i>0?process.argv[i+1]:undefined;};
 const storage=resolve(arg('--storage')??join(homedir(),'.mainsagents','storage'));
 if(process.argv.includes('--rehearse')){console.log(JSON.stringify(rehearseOnCopy({storage,copyDir:resolve(arg('--rehearse'))}),null,2));process.exit(0);}
 const plan=planEditorClaudeSetup({storage});
 if(process.argv.includes('--json'))console.log(JSON.stringify({...plan,agentsBefore:undefined,agentsAfter:undefined,runs:plan.runs.map(run=>({id:run.id,expected:run.expected,summary:run.summary}))},null,2));else printPlan(plan);
 if(process.argv.includes('--apply')){const result=applyEditorClaudeSetup(plan);console.log(JSON.stringify({mode:result.mode,backup:result.backup,changedTables:result.changedTables},null,2));}
}
