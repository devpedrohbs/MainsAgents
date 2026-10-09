import test from 'node:test';
import assert from 'node:assert/strict';
import {projectHomePipeline,columnForRunStage,runColumn,activeRunFor,pipelineColumnIds} from '../src/features/content/homePipeline.ts';

const ws='w1';
const content=(id,extra={})=>({id,title:id,topicId:`t-${id}`,workspaceId:ws,productionStage:'planning',...extra});
const run=(contentId,stage,extra={})=>({id:`r-${contentId}-${stage}`,workspaceId:ws,contentId,stage,updatedAt:'2026-10-08T10:00:00Z',...extra});
const where=(columns,id)=>pipelineColumnIds.find(column=>columns[column].some(item=>item.id===id));
const project=(contents,runs=[],topics=[])=>projectHomePipeline({contents,topics,runs,workspaceId:ws});

test('every coordinator stage lands in an explicit column (covers, package and schedule are not Editing)',()=>{
 const expected={writing:'script','script-review':'script',notion:'script',recording:'recording','planning-edit':'editing',editing:'editing','video-review':'editing',platforms:'package','preparing-package':'package','generating-cover':'package','covers-review':'package','package-review':'package',schedule:'schedule',scheduling:'schedule',complete:'published'};
 for(const [stage,column] of Object.entries(expected)){
  assert.equal(columnForRunStage(stage),column,stage);
  assert.equal(where(project([content('c')],[run('c',stage)]),'c'),column,`projected ${stage}`);
 }
});

test('a content stored as video-review but whose run is in covers-review shows in package',()=>{
 const columns=project([content('c',{productionStage:'video-review'})],[run('c','covers-review')]);
 assert.equal(where(columns,'c'),'package');assert.equal(columns.package[0].source,'run');assert.equal(columns.editing.length,0);
});

test('an active run beats a stale completed run regardless of recency',()=>{
 const done=run('c','complete',{id:'old',updatedAt:'2026-10-09T10:00:00Z'}),active=run('c','schedule',{id:'new',updatedAt:'2026-10-01T10:00:00Z'});
 assert.equal(activeRunFor('c',ws,[done,active]).id,'new');
 assert.equal(where(project([content('c',{productionStage:'ready'})],[done,active]),'c'),'schedule');
 assert.equal(where(project([content('c')],[done]),'c'),'published');
});

test('latest of several active runs wins; ties are deterministic',()=>{
 const a=run('c','recording',{id:'a',updatedAt:'2026-10-01T00:00:00Z'}),b=run('c','editing',{id:'b',updatedAt:'2026-10-02T00:00:00Z'});
 assert.equal(activeRunFor('c',ws,[a,b]).id,'b');
 const x=run('c','recording',{id:'x',updatedAt:'2026-10-01T00:00:00Z'}),y=run('c','editing',{id:'y',updatedAt:'2026-10-01T00:00:00Z'});
 assert.equal(activeRunFor('c',ws,[x,y]).id,activeRunFor('c',ws,[y,x]).id);
});

test('runs from another workspace or another content never decide',()=>{
 const other={...run('c','schedule'),workspaceId:'w2'};
 assert.equal(where(project([content('c',{productionStage:'recording'})],[other,run('d','schedule')]),'c'),'recording');
});

test('manual contents without runs keep their stored stage',()=>{
 const columns=project([content('p'),content('rec',{productionStage:'ready-to-record'}),content('ed',{productionStage:'editing'}),content('vr',{productionStage:'video-review'}),content('ok',{productionStage:'ready'}),content('gone',{productionStage:'archived'})]);
 assert.deepEqual(['p','rec','ed','vr','ok'].map(id=>where(columns,id)),['script','recording','editing','editing','published']);
 assert.equal(where(columns,'gone'),undefined);
});

test('canceled, imported-halted and unknown-stage runs fall back to the content',()=>{
 for(const r of [run('c','canceled'),run('c','blocked',{imported:true,resumeStage:'schedule'}),run('c','mystery')])
  assert.equal(where(project([content('c',{productionStage:'recording'})],[r]),'c'),'recording',r.stage);
});

test('paused and blocked runs stay at the stage where they stopped',()=>{
 assert.equal(runColumn(run('c','paused',{resumeStage:'covers-review'})),'package');
 assert.equal(runColumn(run('c','blocked',{resumeStage:'scheduling'})),'schedule');
 assert.equal(runColumn(run('c','paused',{events:[{action:'editing'}]})),'editing');
 assert.equal(runColumn(run('c','paused')),undefined,'no evidence → no invented column');
});

test('topics without content stay in ideas/research; topics owned by a content are not duplicated',()=>{
 const topics=[{id:'a',title:'A',workspaceId:ws,status:'review'},{id:'b',title:'B',workspaceId:ws,status:'researching'},{id:'c',title:'C',workspaceId:ws,status:'rejected'},{id:'t-x',title:'owned',workspaceId:ws,status:'review'},{id:'z',title:'Z',workspaceId:'w2',status:'review'}];
 const columns=project([content('x')],[],topics);
 assert.deepEqual(columns.ideas.map(i=>i.id),['a']);assert.deepEqual(columns.research.map(i=>i.id),['b']);
 assert.equal(Object.values(columns).flat().filter(i=>i.title==='owned').length,0);
});
