import test from 'node:test';
import assert from 'node:assert/strict';
import {stepPhrase,liveRunView,finishedSteps,formatRunDuration} from '../src/features/chat/runSteps.ts';

const step=(id,label,status='done')=>({id:`codex-activity-x-${id}`,type:'activity',label,status});

test('bridge labels become short human phrases, never raw tool ids', () => {
  assert.deepEqual(stepPhrase('Searching: excel 2026',true),{live:'Buscando na web…',done:'Buscou “excel 2026”',detail:'“excel 2026”'});
  assert.equal(stepPhrase('Searching web...',true).done,'Busca feita');
  assert.equal(stepPhrase('Reading a file...',true).live,'Lendo um arquivo…');
  assert.deepEqual(stepPhrase('Using notion · notion-fetch...',true),{live:'Usando o Notion…',done:'Usou o Notion',detail:'notion fetch'});
  assert.equal(stepPhrase('Using commandExecution...',true).live,'Usando uma ferramenta…');
  assert.equal(stepPhrase('Used fileChange',true).done,'Usou uma ferramenta');
  assert.equal(stepPhrase('Thinking…',true).thinking,true);
  assert.equal(stepPhrase('Using terminal... · interrupted',false).done,'Used the terminal');
});

test('the live line follows the real steps: running, settled, writing, waiting', () => {
  assert.equal(liveRunView([],{pt:true}).label,'Pensando…');
  const searching=liveRunView([step('a','Searching: excel','running')],{pt:true});
  assert.equal(searching.label,'Buscando na web…');assert.equal(searching.detail,'“excel”');assert.deepEqual(searching.trail,[]);
  const settled=liveRunView([step('a','Searching: excel')],{pt:true});
  assert.equal(settled.label,'Busca feita · continuando');assert.deepEqual(settled.trail,['Buscou “excel”']);
  const reading=liveRunView([step('a','Searching: excel'),step('b','Reading a file...','running')],{pt:true});
  assert.equal(reading.label,'Lendo um arquivo…');assert.deepEqual(reading.trail,['Buscou “excel”']);
  assert.equal(liveRunView([step('a','Searching: excel')],{pt:true,writing:true}).label,'Escrevendo a resposta…');
  const waiting=liveRunView([step('a','Using notion · fetch...','running')],{pt:true,awaitingApproval:true});
  assert.equal(waiting.label,'Aguardando sua aprovação');assert.equal(waiting.tone,'wait');
  // Thinking events never become the headline while a real tool runs, nor enter the trail.
  const mixed=liveRunView([step('t','Thinking…'),step('c','Using terminal...','running'),step('t2','Thinking…','running')],{pt:true});
  assert.equal(mixed.label,'Usando o terminal…');assert.deepEqual(mixed.trail,[]);
});

test('finished steps skip thinking and collapse repeats; durations read at a glance', () => {
  const steps=[step('t','Thinking…'),step('a','Using terminal...'),step('b','Using terminal...'),step('c','Searching web...','error')];
  assert.deepEqual(finishedSteps(steps,true).map(item=>[item.text,item.failed]),[['Usou o terminal',false],['Busca feita',true]]);
  assert.equal(formatRunDuration(14_400),'14 s');
  assert.equal(formatRunDuration(125_000),'2 min 05 s');
  assert.equal(formatRunDuration(3_725_000),'1 h 02 min');
});
