import test from 'node:test';
import assert from 'node:assert/strict';
import {adoptLegacyAgentDraft,agentDraftKey,putAgentDraft,restoreAgentDraft} from '../src/features/agents/agentDrafts.ts';

const base={name:'',role:'',description:'',instructions:'',workspaceId:'space-b',tools:[],skillsDirectory:'',skills:[],disabledSkills:[],skillsInstallKey:'',avatarImage:''};

test('creation drafts are scoped by profile and workspace and never bring back another workspace',()=>{
 const a={profile:'p1',workspaceId:'space-a'},b={profile:'p1',workspaceId:'space-b'},other={profile:'p2',workspaceId:'space-a'};
 let drafts=putAgentDraft({},a,{...base,name:'Rascunho A',workspaceId:'space-a'},'t');
 assert.notEqual(agentDraftKey(a),agentDraftKey(b));assert.notEqual(agentDraftKey(a),agentDraftKey(other));
 assert.equal(restoreAgentDraft(drafts,b,base).name,'','another workspace starts empty');
 assert.equal(restoreAgentDraft(drafts,other,{...base,workspaceId:'space-a'}).name,'','another profile never sees it');
 const back=restoreAgentDraft(drafts,a,{...base,workspaceId:'space-a'});assert.equal(back.name,'Rascunho A');assert.equal(back.workspaceId,'space-a');
 // Even a corrupted/old creation draft that stored another workspace is created in the CURRENT one.
 drafts=putAgentDraft(drafts,b,{...base,name:'B',workspaceId:'space-a'},'t');assert.equal(restoreAgentDraft(drafts,b,base).workspaceId,'space-b');
 // Templates have their own slot; agents being edited too.
 assert.notEqual(agentDraftKey({...a,template:'Editor'}),agentDraftKey(a));assert.notEqual(agentDraftKey({...a,agentId:'x'}),agentDraftKey(a));
});

test('drafts survive close/reopen until saved or discarded; editing keeps the chosen workspace',()=>{
 const scope={profile:'p1',workspaceId:'space-a',agentId:'agent-1'};
 let drafts=putAgentDraft({},scope,{...base,name:'Editado',workspaceId:'space-c'},'t');
 assert.equal(restoreAgentDraft(drafts,scope,{...base,workspaceId:'space-a'}).workspaceId,'space-c','an edit may move the agent on purpose');
 drafts=putAgentDraft(drafts,scope,undefined);assert.deepEqual(drafts,{},'saved/reverted drafts are removed');
 assert.equal(putAgentDraft(drafts,scope,undefined),drafts,'no write when nothing changes');
});

test('legacy sessionStorage drafts: only an existing agent of the same workspace is adopted; shared "new" drafts never leak',()=>{
 const raw=JSON.stringify({name:'Legado',workspaceId:'space-a'});
 assert.deepEqual(adoptLegacyAgentDraft(raw,{profile:'p',workspaceId:'space-a',agentId:'agent-1',agentWorkspaceId:'space-a'}),{name:'Legado',workspaceId:'space-a'});
 assert.equal(adoptLegacyAgentDraft(raw,{profile:'p',workspaceId:'space-b',agentId:'agent-2',agentWorkspaceId:'space-b'}),undefined,'other workspace');
 assert.equal(adoptLegacyAgentDraft(raw,{profile:'p',workspaceId:'space-a'}),undefined,'legacy creation drafts were shared by every profile');
 for(const bad of [null,'','{',JSON.stringify([1]),'null'])assert.equal(adoptLegacyAgentDraft(bad,{profile:'p',workspaceId:'space-a',agentId:'agent-1'}),undefined);
});

test('agent drafts travel in backups: validated, re-scoped to the importing profile and pruned of missing records',async()=>{
 const {composeImport,parseBackup,safeData,dataKeys}=await import('../src/data/backupFormat.ts');
 assert(dataKeys.includes('agent-drafts'),'agent drafts are part of the exported data');
 const key=(profile,workspaceId,slot)=>JSON.stringify([profile,workspaceId,slot]),draft=(name,at='t')=>({values:{...base,name},savedAt:at});
 const exported={[key('origin','space-a','agent:a1')]:draft('Editing a1'),[key('origin','space-a','new:')]:draft('New in A'),[key('origin','space-gone','new:')]:draft('Orphan workspace'),[key('origin','space-a','agent:gone')]:draft('Orphan agent')};
 const file=parseBackup(JSON.stringify({format:'mainsagents-backup',version:1,exportedAt:'2026',data:safeData({workspaces:[{id:'space-a'}],agents:[{id:'a1',workspaceId:'space-a'}],'agent-drafts':exported})}));
 assert.deepEqual(Object.keys(file.data['agent-drafts']).length,4);
 // Replace: drafts belong to the importing profile; drafts for workspaces/agents absent from the restored data are dropped.
 const replaced=composeImport({'agent-drafts':{[key('target','space-x','new:')]:draft('Local only')}},file,'replace',{profile:'target'})['agent-drafts'];
 assert.deepEqual(Object.keys(replaced).sort(),[key('target','space-a','agent:a1'),key('target','space-a','new:')].sort());
 assert.equal(replaced[key('target','space-a','agent:a1')].values.name,'Editing a1');
 // Merge: collections are unioned, incoming drafts are added, the current profile's draft wins on the same slot.
 const current={workspaces:[{id:'space-b'}],agents:[{id:'b1',workspaceId:'space-b'}],'agent-drafts':{[key('target','space-a','new:')]:draft('Local conflict'),[key('target','space-b','agent:b1')]:draft('Local b1')}};
 const merged=composeImport(current,file,'merge',{profile:'target'})['agent-drafts'];
 assert.equal(merged[key('target','space-a','new:')].values.name,'Local conflict');
 assert.equal(merged[key('target','space-b','agent:b1')].values.name,'Local b1');
 assert.equal(merged[key('target','space-a','agent:a1')].values.name,'Editing a1');
 assert(!Object.keys(merged).some(item=>item.includes('origin')||item.includes('gone')),'no foreign profile or orphan draft');
 // A backup without drafts keeps the current ones on merge and clears them on replace.
 const plain=parseBackup(JSON.stringify({format:'mainsagents-backup',version:1,data:{workspaces:[{id:'space-b'}],agents:[]}}));
 assert.deepEqual(composeImport(current,plain,'merge',{profile:'target'})['agent-drafts'],current['agent-drafts']);
 assert.equal('agent-drafts' in composeImport(current,plain,'replace',{profile:'target'}),false);
 // Malformed drafts are refused before anything is restored.
 for(const bad of [{'not-a-scope':draft('x')},{[key('p','s','other:x')]:draft('x')},{[key('p','s','new:')]:{values:'x',savedAt:'t'}},{[key('p','s','new:')]:{values:{},savedAt:1}},['x']])
  assert.throws(()=>parseBackup(JSON.stringify({format:'mainsagents-backup',version:1,data:{'agent-drafts':bad}})),/Invalid agent drafts/);
});

test('draft values are type-checked against the editor model: corrupted imports are refused, corrupted local drafts fall back',async()=>{
 const {parseBackup,composeImport}=await import('../src/data/backupFormat.ts');
 const {agentDraftValuesProblem,validateAgentDrafts}=await import('../src/features/agents/agentDrafts.ts');
 const scope={profile:'p1',workspaceId:'space-a',agentId:'a1'},key=agentDraftKey(scope),fallback={...base,name:'Saved agent',workspaceId:'space-a',providerId:'codex',tools:['files']};
 const bad={
  'numeric name':{name:123},'null tools':{tools:null},'unknown tool':{tools:['files','shell']},'tools not a list':{tools:'files'},
  'skills not text':{skills:[1]},'skills null':{skills:null},'disabled skills object':{disabledSkills:{a:1}},'skill files not paths':{skillFiles:{a:1}},
  'unknown provider':{providerId:'openai'},'null provider':{providerId:null},'unknown mcp permission':{mcpPermissions:['read','admin']},
  'file access without folder':{fileAccess:{enabled:true}},'file access extra key':{fileAccess:{enabled:true,outputDirectory:'C:/out',global:true}},'file access enabled as text':{fileAccess:{enabled:'yes',outputDirectory:'C:/out'}},
  'notion automation as list':{notionAutomation:[]},'notion source not text':{notionAutomation:{enabled:true,dataSourceId:7}},'unknown field':{superUser:true},
 };
 for(const [label,values] of Object.entries(bad)){
  assert(agentDraftValuesProblem(values),`${label} must be invalid`);
  const drafts={[key]:{values,savedAt:'t'}};assert.equal(validateAgentDrafts(drafts),false,label);
  // Import: refused before anything is restored, naming the field.
  assert.throws(()=>parseBackup(JSON.stringify({format:'mainsagents-backup',version:1,data:{'agent-drafts':drafts}})),new RegExp(`Invalid agent drafts in backup: draft .*${Object.keys(values)[0]}`),label);
  // Local storage: the editor ignores the corrupted draft and opens the saved agent (no merge of foreign types, no crash).
  const restored=restoreAgentDraft(drafts,scope,fallback);assert.deepEqual(restored,fallback,label);
  assert.equal(typeof restored.name.trim(),'string');assert(Array.isArray(restored.tools)&&restored.tools===fallback.tools);
 }
 assert.deepEqual(restoreAgentDraft(null,scope,fallback),fallback,'a corrupted draft map falls back');
 assert.deepEqual(restoreAgentDraft({[key]:{values:'x',savedAt:'t'}},scope,fallback),fallback);
 // Valid full drafts and Partials keep working; a Partial is completed by the fallback.
 const full={...base,name:'Editor',role:'Video',tools:['files','subagents'],skills:['corte'],disabledSkills:[],skillFiles:{corte:'C:/skills/corte.md'},providerId:'claude',modelId:'m',mcpPermissions:['read','publish'],notionAutomation:{enabled:false,dataSourceId:''},fileAccess:{enabled:true,outputDirectory:'C:/out'}};
 assert.equal(agentDraftValuesProblem(full),undefined);assert.equal(agentDraftValuesProblem({}),undefined);
 assert.deepEqual(restoreAgentDraft({[key]:{values:full,savedAt:'t'}},scope,fallback),{...fallback,...full});
 const partial=restoreAgentDraft({[key]:{values:{name:'Only the name'},savedAt:'t'}},scope,fallback);assert.equal(partial.name,'Only the name');assert.deepEqual(partial.tools,fallback.tools);
 const file=parseBackup(JSON.stringify({format:'mainsagents-backup',version:1,data:{workspaces:[{id:'space-a'}],agents:[{id:'a1',workspaceId:'space-a'}],'agent-drafts':{[agentDraftKey({profile:'origin',workspaceId:'space-a',agentId:'a1'})]:{values:{name:'Imported partial'},savedAt:'t'}}}}));
 // Merge keeps valid local drafts, re-keys the imported one and leaves a corrupted local entry out (it would only fall back).
 const local={[agentDraftKey({profile:'p1',workspaceId:'space-a'})]:{values:{name:'Local new'},savedAt:'t'},[agentDraftKey({profile:'p1',workspaceId:'space-a',agentId:'zz'})]:{values:{name:5},savedAt:'t'}};
 const merged=composeImport({workspaces:[{id:'space-a'}],agents:[{id:'zz',workspaceId:'space-a'}],'agent-drafts':local},file,'merge',{profile:'p1'})['agent-drafts'];
 assert.deepEqual(Object.keys(merged).sort(),[key,agentDraftKey({profile:'p1',workspaceId:'space-a'})].sort());
 assert.equal(merged[key].values.name,'Imported partial');assert.equal(merged[agentDraftKey({profile:'p1',workspaceId:'space-a'})].values.name,'Local new');
});
