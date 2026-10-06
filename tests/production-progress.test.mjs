import test from 'node:test';
import assert from 'node:assert/strict';
import {productionProgress} from '../src/features/production/productionProgress.ts';

const at='2026-10-06T12:00:00.000Z';
const run=(stage,extra={})=>({id:'p1',stage,updatedAt:at,events:[],...extra});
const ev=(...actions)=>actions.map(action=>({action,detail:'',at}));
const statuses=view=>Object.fromEntries(view.phases.map(phase=>[phase.id,phase.status]));

test('active automatic stage marks evidenced earlier phases and the current phase',()=>{
 const view=productionProgress(run('editing',{events:ev('idea-approved','notion','recording','planning-edit','editing')}),true);
 assert.equal(view.state,'active');
 assert.deepEqual(statuses(view),{script:'completed',recording:'completed',editing:'current',package:'upcoming',schedule:'upcoming',complete:'upcoming'});
 assert.match(view.nextAction,/Aguarde/);
 assert.equal(view.phases.find(phase=>phase.id==='editing').stageLabel,'Editando vídeo');
});

test('review stage waits for the user with a concrete action in both languages',()=>{
 const review=run('package-review',{events:ev('notion','recording','planning-edit','editing','video-review','platforms','preparing-package','generating-cover','package-review')});
 assert.equal(productionProgress(review,true).state,'waiting');
 assert.match(productionProgress(review,true).nextAction,/capas e legendas/);
 assert.match(productionProgress(review,false).nextAction,/covers and captions/);
});

test('earlier phases without audit evidence are unconfirmed, never assumed complete',()=>{
 const view=productionProgress(run('video-review',{events:ev('idea-approved','video-review')}),false);
 assert.deepEqual(statuses(view).recording,'unconfirmed');
 assert.equal(statuses(view).editing,'current');
 const legacy=productionProgress(run('package-review',{events:undefined}),true);
 assert.deepEqual(statuses(legacy),{script:'unconfirmed',recording:'unconfirmed',editing:'unconfirmed',package:'current',schedule:'upcoming',complete:'upcoming'});
});

test('pause uses resumeStage, surfaces the reason and stops on that phase',()=>{
 const view=productionProgress(run('paused',{resumeStage:'generating-cover',error:'App encerrado. Retome para conferir o resultado.',events:ev('notion','recording','planning-edit','editing','video-review','platforms','preparing-package','generating-cover')}),true);
 assert.equal(view.state,'paused');
 assert.equal(statuses(view).package,'stopped');
 assert.equal(view.stoppedAt,'Gerando capas');
 assert.equal(view.reason,'App encerrado. Retome para conferir o resultado.');
 assert.match(view.nextAction,/Retome/);
});

test('cancel prefers the audit trail over a stale resumeStage and imported runs are not resumable',()=>{
 const canceled=productionProgress(run('canceled',{resumeStage:'notion',events:ev('notion','blocked','recording','planning-edit','cancel')}),true);
 assert.equal(canceled.stoppedAt,'Editor preparando o plano');
 assert.equal(statuses(canceled).editing,'stopped');
 assert.match(canceled.nextAction,/nova produção/);
 const imported=productionProgress(run('blocked',{imported:true,resumeStage:'editing',events:[]}),true);
 assert.match(imported.nextAction,/Histórico importado/);
});

test('halted run without reliable location claims no stopping point',()=>{
 const view=productionProgress(run('blocked',{error:'Falha',events:ev('blocked')}),true);
 assert.equal(view.stoppedAt,undefined);
 assert.ok(view.phases.every(phase=>phase.status==='upcoming'));
});

test('unknown stage is reported honestly and complete marks every phase',()=>{
 const unknown=productionProgress(run('mystery'),false);
 assert.equal(unknown.state,'unknown');
 assert.ok(unknown.phases.every(phase=>phase.status==='upcoming'));
 assert.match(unknown.nextAction,/Unrecognized stage \(mystery\)/);
 const done=productionProgress(run('complete',{events:ev('scheduling','complete')}),true);
 assert.equal(done.state,'complete');
 assert.ok(done.phases.every(phase=>phase.status==='completed'));
 assert.equal(done.reason,undefined);
});
