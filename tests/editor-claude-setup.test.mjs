import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createDesktopStateStore} from '../desktop-state-store.mjs';
import {agentSnapshot,productionBindingHash} from '../production-coordinator.mjs';
import {artifactHash} from '../editorial-jobs.mjs';
import {applyEditorClaudeSetup,planEditorClaudeSetup,tableDigests,NEW_TOOLS_SECTION} from '../scripts/editor-claude-setup.mjs';

const EDITOR='editor-de-video-083621ee-20e1-40a5-b0ce-183ec20ba16f',RUNS=['run-a','run-b'];
const instructions='Papel.\n\nO corte simples deve funcionar sozinho; efeitos e CapCut são opcionais. Resto.\n\n## Ferramentas e saída local — atualização 08/10/2026\nTexto antigo com workspace-write.';

/** A real desktop store + the coordinator's tables, seeded like a user profile (agents, chats, drafts, editorial, receipts). */
function fixture({extraRun}={}){
 const storage=mkdtempSync(join(tmpdir(),'editor-claude-setup-')),at='2026-10-15T00:00:00.000Z';
 const editor={id:EDITOR,name:'Editor de Vídeo',role:'Vídeo',workspaceId:'ws',tools:['files','canvas-context','subagents'],providerId:'codex',modelId:'',instructions,skills:[],skillFiles:{},disabledSkills:[],fileAccess:{enabled:true,outputDirectory:'C:/saida'},createdAt:at,updatedAt:at};
 const content={id:'editor-de-conteudo',name:'Editor de Conteúdo',role:'Conteúdo',workspaceId:'ws',tools:['files','subagents'],providerId:'codex',instructions:'Conteúdo.',createdAt:at,updatedAt:at};
 const other={id:'linkedin',name:'Linkedin',role:'LI',workspaceId:'ws',tools:['web-search'],providerId:'codex',instructions:'LI.',createdAt:at,updatedAt:at};
 const store=createDesktopStateStore(storage,'0.3.68');
 store.initialize('owner',{agents:[content,editor,other],sessions:[{id:'chat-1',agentId:EDITOR,providerId:'codex',title:'Conversa Codex',messages:[{id:'m1',type:'message',role:'user',content:'oi'},{id:'m2',type:'message',role:'agent',content:'olá'}]}],drafts:[{id:'d1',text:'rascunho'}],workspaces:[{id:'ws'}]});
 store.close();
 const db=new DatabaseSync(join(storage,'workspace-state.sqlite'));
 db.exec(`CREATE TABLE production_runs(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,workspace_id TEXT NOT NULL,content_id TEXT NOT NULL,revision INTEGER NOT NULL,data_json TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE production_authority(profile_id TEXT NOT NULL,run_id TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(profile_id,run_id));
  CREATE TABLE production_lease(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL,expires INTEGER NOT NULL);
  CREATE TABLE editorial_state(profile_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,state_json TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE delivery_receipts(id TEXT PRIMARY KEY,data TEXT);`);
 db.prepare('INSERT INTO editorial_state VALUES(?,?,?,?)').run('owner',3,JSON.stringify({contents:[{id:'c1',workspaceId:'ws'}],assets:[{id:'src',contentId:'c1'}]}),at);
 db.prepare('INSERT INTO delivery_receipts VALUES(?,?)').run('r1','{"sha256":"abc"}');
 db.prepare('INSERT INTO production_lease VALUES(1,?,?)').run('old-app',Date.now()-60_000);
 const run=(id,extra={})=>{const p={id,profileId:'owner',workspaceId:'ws',contentId:'c1',topic:{id:'t1'},flowId:'flow',sourceAgent:agentSnapshot(content),editorAgent:agentSnapshot(editor),publisherAgent:agentSnapshot(content),editDirector:{providerId:'claude'},stage:'blocked',resumeStage:'planning-edit',epoch:1,inputVideo:{assetId:'src',versionId:'v1',sha256:'f'.repeat(64)},editorSession:{id:'s-ed',messages:[{id:'x',role:'agent',content:'parou'}]},sourceSession:{id:'s-src',messages:[]},authoring:{epoch:1,authorityHash:'h',revisions:[{revision:1,plan:{segments:[{start:0,end:5}]},planHash:'p1'}],plan:{segments:[{start:0,end:5}]},checkpoint:{contract:'mainsagents.editor-authoring/1',revision:1,calls:9,finalized:false},previews:[{previewId:'preview-1'}]},step:{id:`${id}-planning-edit-1`},events:[],...extra};
  db.prepare('INSERT INTO production_runs VALUES(?,?,?,?,?,?,?)').run(id,'owner','ws','c1',4,JSON.stringify(p),at);db.prepare('INSERT INTO production_authority VALUES(?,?,?)').run('owner',id,productionBindingHash(p));return p;};
 const runs=Object.fromEntries(RUNS.map(id=>[id,run(id)]));if(extraRun)run('run-other',extraRun);
 db.close();
 return {storage,path:join(storage,'workspace-state.sqlite'),runs,editor,content,other};
}
const readRun=(path,id)=>{const db=new DatabaseSync(path,{readOnly:true});try{const row=db.prepare('SELECT revision,data_json FROM production_runs WHERE id=?').get(id);return {revision:row.revision,p:JSON.parse(row.data_json),authority:db.prepare('SELECT hash FROM production_authority WHERE run_id=?').get(id).hash};}finally{db.close();}};
const readAgents=path=>{const db=new DatabaseSync(path,{readOnly:true});try{return JSON.parse(db.prepare("SELECT value FROM state WHERE key='agents'").get().value);}finally{db.close();}};

test('dry-run: exact agent patch (Claude, CLI default model, write off, +web-search, real capabilities) and run plan; writes nothing',()=>{
 const f=fixture(),before=tableDigests(f.path),plan=planEditorClaudeSetup({storage:f.storage,runIds:RUNS});
 assert.deepEqual(tableDigests(f.path),before,'planning wrote nothing');
 assert.deepEqual(plan.patch.map(item=>item.field),['fileAccess','instructions','providerId','tools']);
 const after=plan.agentsAfter.find(agent=>agent.id===EDITOR);
 assert.deepEqual([after.providerId,after.modelId,after.fileAccess,after.tools],['claude','',{enabled:false,outputDirectory:'C:/saida'},['files','canvas-context','subagents','web-search']]);
 assert.ok(after.instructions.endsWith(NEW_TOOLS_SECTION));assert.doesNotMatch(after.instructions,/workspace-write/);
 assert.deepEqual(plan.runs.map(run=>run.summary.epoch),[[1,2],[1,2]]);
});

test('apply: backup first, only the editor agent and its 2 halted runs change; chats, drafts, editorial, receipts and other agents stay identical',()=>{
 const f=fixture({extraRun:{stage:'video-review',resumeStage:undefined}}),before=tableDigests(f.path),plan=planEditorClaudeSetup({storage:f.storage,runIds:RUNS});
 const result=applyEditorClaudeSetup(plan,{appRunning:()=>false});
 assert.ok(existsSync(result.backup));assert.deepEqual(tableDigests(result.backup),before,'backup equals the state before apply');
 assert.deepEqual(result.changedTables.sort(),['agent_revisions','metadata','production_authority','production_runs','state']);
 const agents=readAgents(f.path);
 assert.deepEqual(agents.filter(agent=>agent.id!==EDITOR),[f.content,f.other]);
 const store=createDesktopStateStore(f.storage,'0.3.68');try{assert.deepEqual(store.read('owner','sessions')[0].providerId,'codex','existing Codex chat keeps its provider (not renamed)');assert.equal(store.read('owner','sessions')[0].messages.length,2);assert.deepEqual(store.read('owner','drafts'),[{id:'d1',text:'rascunho'}]);}finally{store.close();}
 for(const id of RUNS){
  const {revision,p,authority}=readRun(f.path,id),old=f.runs[id];
  assert.equal(revision,5);assert.equal(p.epoch,2);assert.deepEqual([p.stage,p.resumeStage],['blocked','planning-edit']);
  assert.equal(artifactHash(p.editorAgent),artifactHash(agentSnapshot(agents.find(agent=>agent.id===EDITOR))),'guard: editor snapshot = live agent');
  assert.deepEqual(p.sourceAgent,old.sourceAgent);assert.equal(authority,productionBindingHash(p),'guard: authority = new binding');
  const {history,...previous}=old.authoring;assert.deepEqual(p.authoring.history.at(-1).authoring,previous,'old authoring verbatim');assert.deepEqual(p.authoring.history.at(-1).step,old.step);
  assert.deepEqual(p.authoring.previousPlan,old.authoring.plan);assert.equal(p.authoring.checkpoint,undefined);assert.deepEqual(p.editorSession,old.editorSession,'no fabricated messages');assert.deepEqual(p.inputVideo,old.inputVideo);
 }
 assert.equal(readRun(f.path,'run-other').revision,4,'runs not listed are untouched');
});

test('apply refuses: app running, live production lease, changed agents (CAS) — and compensates the agents when a run changed',()=>{
 const f=fixture(),plan=planEditorClaudeSetup({storage:f.storage,runIds:RUNS}),before=tableDigests(f.path);
 assert.throws(()=>applyEditorClaudeSetup(plan,{appRunning:()=>true}),/Feche o MainsAgents/);
 {const db=new DatabaseSync(f.path);db.prepare('UPDATE production_lease SET expires=?').run(Date.now()+60_000);db.close();}
 assert.throws(()=>applyEditorClaudeSetup(plan,{appRunning:()=>false}),/lease/);
 {const db=new DatabaseSync(f.path);db.prepare('UPDATE production_lease SET expires=?').run(Date.now()-60_000);db.close();}
 // A run changed after planning: agents are written, the runs transaction fails, the agents go back.
 {const db=new DatabaseSync(f.path);db.prepare('UPDATE production_runs SET revision=9 WHERE id=?').run('run-b');db.close();}
 const agentsBefore=readAgents(f.path);
 assert.throws(()=>applyEditorClaudeSetup(plan,{appRunning:()=>false,now:()=>Date.now()+1}),/run-b changed since the plan/);
 assert.deepEqual(readAgents(f.path),agentsBefore,'agents compensated');assert.equal(readRun(f.path,'run-a').revision,4,'no run migrated');
 // Agents changed after planning: CAS refuses before any run is touched.
 const fresh=fixture(),stale=planEditorClaudeSetup({storage:fresh.storage,runIds:RUNS});
 const store=createDesktopStateStore(fresh.storage,'0.3.68');store.write('owner','agents',[...readAgents(fresh.path),{id:'novo',name:'Novo'}]);store.close();
 assert.throws(()=>applyEditorClaudeSetup(stale,{appRunning:()=>false}),/Newer saved data/);assert.equal(readRun(fresh.path,'run-a').revision,4);
 assert.ok(before);
});

test('plan refuses runs of another editor configuration, delivered runs and unknown agents',()=>{
 const f=fixture({extraRun:{stage:'video-review',resumeStage:undefined,outputVideo:{assetId:'out'}}});
 assert.throws(()=>planEditorClaudeSetup({storage:f.storage,runIds:['run-other']}),/exportação|vídeo exportado/);
 assert.throws(()=>planEditorClaudeSetup({storage:f.storage,agentId:'nao-existe',runIds:RUNS}),/not in the active profile/);
 const db=new DatabaseSync(f.path);const p=JSON.parse(db.prepare('SELECT data_json FROM production_runs WHERE id=?').get('run-a').data_json);p.editorAgent={...p.editorAgent,instructions:'outra'};db.prepare('UPDATE production_runs SET data_json=? WHERE id=?').run(JSON.stringify(p),'run-a');db.close();
 assert.throws(()=>planEditorClaudeSetup({storage:f.storage,runIds:RUNS}),/saved another configuration/);
});

test('plan refuses a run whose source/publisher agent changed or whose content is gone (it would still fail guard after migration)',()=>{
 const f=fixture(),store=createDesktopStateStore(f.storage,'0.3.68');
 store.write('owner','agents',readAgents(f.path).map(agent=>agent.id==='editor-de-conteudo'?{...agent,instructions:'Mudou.'}:agent));store.close();
 assert.throws(()=>planEditorClaudeSetup({storage:f.storage,runIds:RUNS}),/source agent changed/);
 const g=fixture(),db=new DatabaseSync(g.path);db.prepare('UPDATE editorial_state SET state_json=?').run(JSON.stringify({contents:[]}));db.close();
 assert.throws(()=>planEditorClaudeSetup({storage:g.storage,runIds:RUNS}),/content no longer exists/);
});
