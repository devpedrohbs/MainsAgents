import test from 'node:test';
import assert from 'node:assert/strict';
import {lastExecution,executionModel,executionText,executionProgress,executionKind,stopSummary} from '../src/features/production/editorExecutions.ts';

const at='2026-10-14T12:00:00.000Z';
const run=(kind,extra={})=>({index:1,kind,continuation:kind==='continuation'?1:0,providerId:'claude',requestedModel:null,model:null,outcome:'completed',at,...extra});

test('the last execution is the runtime record, never the configured choice', () => {
  assert.equal(lastExecution({}),undefined);
  assert.equal(lastExecution({authoring:{executions:[]}}),undefined);
  const items=[run('initial'),run('continuation',{index:2,providerId:'codex'})];
  assert.equal(lastExecution({authoring:{executions:items}}).providerId,'codex');
});

test('a model is shown only when reported; a requested model is labelled as requested', () => {
  assert.equal(executionModel(run('initial',{model:'claude-reported'}),true),'claude-reported');
  assert.equal(executionModel(run('initial',{requestedModel:'cl-model'}),true),'cl-model (pedido; não confirmado pelo provedor)');
  assert.equal(executionModel(run('initial'),true),'modelo não informado pelo provedor');
  assert.equal(executionModel(run('initial'),false),'model not reported by the provider');
  assert.equal(executionText(run('initial',{providerId:null}),true).startsWith('provedor não registrado'),true);
});

test('outcome, turns and progress are summarised', () => {
  const limit=run('continuation',{model:'m',outcome:'turn_limit',numTurns:20,maxTurns:20,revisionBefore:2,revisionAfter:3,callsBefore:10,callsAfter:14});
  assert.equal(executionText(limit,true),'Claude Code · m · parou no limite de turnos (20/20 turnos)');
  assert.equal(executionProgress(limit,true),'revisão 2→3 · 10→14 chamada(s) de ferramenta');
  assert.equal(executionKind(limit,true),'continuação 1');
  assert.equal(executionText(run('initial',{providerId:'codex',outcome:'failed',code:'cli_error'}),false),'Codex · model not reported by the provider · failed · cli_error');
});

test('turn-limit stop: useful facts and what Resume will do', () => {
  const base={code:'editor_turn_limit',numTurns:20,maxTurns:20,calls:14,callsLeft:6,revision:3,continuationsUsed:1,maxContinuations:3,at};
  const go=stopSummary({...base,reason:'no_progress',continuable:true},true);
  assert.equal(go.facts,'20/20 turnos · revisão 3 · 14 chamada(s) de ferramenta · 6 restante(s) · continuações 1/3');
  assert.equal(go.reason,'a última execução não avançou o checkpoint');
  assert.match(go.next,/Retomar continua do checkpoint/);
  const stop=stopSummary({...base,numTurns:null,maxTurns:null,calls:null,callsLeft:null,revision:null,reason:'continuation_cap',continuable:false},false);
  assert.equal(stop.facts,'turn limit · continuations 1/3');assert.match(stop.next,/will not continue/);
});

test('resume mode: restart after a director change, checkpoint/stopped for a confirmed stop, generic otherwise', async () => {
  const {resumeMode}=await import('../src/features/production/editorExecutions.ts');
  const stop=(continuable)=>({code:'editor_turn_limit',numTurns:20,maxTurns:20,calls:1,callsLeft:1,revision:1,continuable,at});
  const base={stage:'blocked',resumeStage:'editing'};
  assert.equal(resumeMode({...base,authoring:{lastStop:stop(true)}}),'checkpoint');
  assert.equal(resumeMode({...base,stage:'paused',resumeStage:'planning-edit',authoring:{lastStop:stop(false)}}),'stopped');
  assert.equal(resumeMode({...base,authoring:{lastStop:stop(true),restartPending:{at,reason:'director-changed'}}}),'restart','a changed director never promises the old checkpoint');
  assert.equal(resumeMode({...base,authoring:{restartPending:true}}),'restart');
  assert.equal(resumeMode({...base}),undefined,'no confirmed stop: generic flow');
  assert.equal(resumeMode({...base,authoring:{lastStop:{...stop(true),code:'other'}}}),undefined);
  assert.equal(resumeMode({...base,resumeStage:'package-review',authoring:{lastStop:stop(true)}}),undefined,'other stages keep the generic flow');
  assert.equal(resumeMode({stage:'planning-edit',authoring:{lastStop:stop(true)}}),undefined);
});
