import test from 'node:test';
import assert from 'node:assert/strict';
import {retakeCandidates,cutDecisionReport,retainedSpeech} from '../editor-retakes.mjs';

/**
 * Fixtures with a verifiable outcome: words are synthetic (0.3 s each, 0.05 s apart; "|n" inserts an n-second pause), so the
 * expected evidence and removal ranges are exact. They prove the detector's EVIDENCE, not the quality of the model's decision.
 */
const speech=text=>{let t=0;const words=[];for(const token of text.split(' ')){if(token.startsWith('|')){t+=Number(token.slice(1));continue;}words.push({start:Math.round(t*100)/100,end:Math.round((t+0.3)*100)/100,text:token});t+=0.35;}return words;};
const only=(text,options)=>retakeCandidates(speech(text),options);

test('a phrase started again: the aborted take is evidence to cut, the complete later take is kept (by sense, not by position)',()=>{
 const [item]=only('hoje eu vou mostrar |0.5 hoje eu vou mostrar como editar um vídeo rápido');
 assert.equal(item.kind,'repeat');assert.equal(item.confidence,'high');assert.equal(item.suggestion,'cut');
 assert.equal(item.evidence.removed,'hoje eu vou mostrar');assert.equal(item.evidence.kept,'hoje eu vou mostrar como editar um vídeo rápido');
 assert.deepEqual(item.remove,{start:0,end:1.84});assert.ok(item.remove.end<1.9,'never enters the first kept word (starts at 1.90 s)');
 // The later take is NOT more complete: the detector says so and asks for a decision instead of cutting by rule.
 const [weak]=only('o preço do plano anual é de cem reais |0.5 o preço do plano');
 assert.equal(weak.confidence,'low');assert.equal(weak.suggestion,'review');assert.match(weak.reason,/não é mais completa/);
});

test('"errei, vou falar de novo" marks the aborted take up to the restart, cue included',()=>{
 const [item]=only('o segredo é usar a luz |0.3 errei vou falar de novo |0.4 o segredo é usar a luz natural sempre');
 assert.equal(item.kind,'cue');assert.equal(item.confidence,'high');assert.equal(item.evidence.cue,'errei vou falar de novo');
 assert.equal(item.evidence.removed,'o segredo é usar a luz errei vou falar de novo');assert.equal(item.evidence.kept,'o segredo é usar a luz natural sempre');
 const english=only('the trick is light |0.3 let me say that again |0.3 the trick is natural light');assert.equal(english[0].kind,'cue');assert.equal(english[0].evidence.kept,'the trick is natural light');
});

test('a corrected number keeps the lead-in; a contrastive denial and a withdrawn correction are never errors',()=>{
 const [fix]=only('isso custa 30 reais |0.2 não 13 reais no total');
 assert.equal(fix.kind,'correction');assert.deepEqual(fix.evidence.numbers,[30,13]);assert.equal(fix.evidence.removed,'30 reais não');
 assert.ok(fix.remove.start>=0.65,'"isso custa" stays: only the wrong number goes');
 const [lead]=only('são 30 |0.3 não são 13 pessoas');assert.equal(lead.kind,'correction');assert.equal(lead.evidence.removed,'são 30 não');assert.equal(lead.evidence.kept,'são 13 pessoas');
 // "Não são 30, são 13": contrast the speaker means; nothing to cut, and 30 must not be shown as the fact.
 const denied=only('não são 30 são 13 pessoas');assert.equal(denied.length,1);assert.equal(denied[0].kind,'negated-number');assert.equal(denied[0].suggestion,'keep');assert.equal(denied[0].remove,null);assert.deepEqual(denied[0].evidence.numbers,[30,13]);
 // "São 30... quer dizer, 30 mesmo": the correction was withdrawn; keep, decide by sense.
 const [withdrawn]=only('são 30 |0.3 quer dizer 30 mesmo');assert.equal(withdrawn.kind,'correction-withdrawn');assert.equal(withdrawn.suggestion,'keep');assert.equal(withdrawn.remove,null);
});

test('intentional repetition is kept: contiguous emphasis is never a cut, a repeated word after a pause goes to review',()=>{
 const [emphasis]=only('isso é muito muito importante');assert.equal(emphasis.kind,'emphasis');assert.equal(emphasis.suggestion,'keep');assert.equal(emphasis.remove,null);
 const [pause]=only('nunca |0.5 nunca desista do seu sonho');assert.equal(pause.suggestion,'review');assert.match(pause.reason,/ênfase/);
 const [start]=only('a gente |0.4 a gente precisa conversar sobre isso hoje');assert.equal(start.kind,'false-start');assert.equal(start.suggestion,'cut');
 assert.deepEqual(only('um vídeo sem nenhuma repetição nem erro de fala aqui'),[]);
 assert.deepEqual(retakeCandidates([]),[],'no words: nothing is estimated');
});

test('approximate timings: candidates are bounded, deterministic and never inside a kept word',()=>{
 const words=speech(Array.from({length:120},(_,i)=>i%10===9?`frase${i} |0.4 frase${i-1}`:`palavra${i}`).join(' '));
 const a=retakeCandidates(words),b=retakeCandidates(words.slice().reverse());assert.deepEqual(a,b,'input order does not matter');
 assert.ok(retakeCandidates(words,{max:3}).length<=3);
 for(const item of only('hoje eu vou mostrar |0.5 hoje eu vou mostrar como editar')){const kept=speech('hoje eu vou mostrar |0.5 hoje eu vou mostrar como editar')[4];assert.ok(item.remove.end<=kept.start);}
});

test('declared cut decisions must match the real cuts; a boundary inside a word is a warning, never a veto',()=>{
 const words=speech('hoje eu vou mostrar |0.5 hoje eu vou mostrar como editar um vídeo'),candidates=retakeCandidates(words);
 const segments=[{start:1.84,end:5.2}];
 const ok=cutDecisionReport([{candidateId:'rt-1',start:0,end:1.84,decision:'cut',reason:'primeira tomada interrompida'}],{segments,words,candidates});
 assert.deepEqual(ok.errors,[]);assert.equal(ok.decisions[0].candidateId,'rt-1');
 const lie=cutDecisionReport([{start:2,end:3,decision:'cut',reason:'x'}],{segments,words,candidates});assert.match(lie.errors[0],/keep .*s of 2.00-3.00s/);
 assert.match(cutDecisionReport([{candidateId:'rt-99',start:0,end:1,decision:'cut',reason:'x'}],{segments,words,candidates}).errors[0],/not a candidate/);
 assert.match(cutDecisionReport([{start:0,end:1,decision:'cut',reason:'x',path:'C:\\x'}],{segments,words,candidates}).errors[0],/unknown field/);
 assert.match(cutDecisionReport([{start:0,end:1,decision:'cut',reason:''}],{segments,words,candidates}).errors[0],/reason/);
 assert.match(cutDecisionReport([{start:0,end:1,decision:'keep',reason:'ênfase intencional'}],{segments,words,candidates}).errors[0],/declared as keep, but the segments cut/);
 const midWord=cutDecisionReport([],{segments:[{start:2.05,end:5.2}],words,candidates});assert.deepEqual(midWord.errors,[]);assert.match(midWord.warnings[0],/inside the word “hoje”.*approximate/);
});

test('retained speech is what survives the cuts: a cut-out take is no longer a source for facts on screen',()=>{
 const words=speech('isso custa 30 reais |0.2 não 13 reais no total');
 const [fix]=retakeCandidates(words);
 const segments=[{start:0,end:fix.remove.start},{start:fix.remove.end,end:words.at(-1).end+0.1}];
 assert.equal(retainedSpeech({segments,words}),'isso custa 13 reais no total');
 assert.equal(retainedSpeech({segments:[{start:0,end:1}],sentences:[{start:0,end:1.5,text:'a'},{start:1.5,end:3,text:'b'}]}),'a','without word timings, sentences mostly kept');
});

test('overlapping approximate word times stay conservative; a candidate ID cannot justify an unrelated cut',()=>{
 const words=speech('hoje eu vou |0.5 hoje eu vou mostrar como editar');
 words[2].end=words[3].start+0.2;
 const uncertain=retakeCandidates(words);
 assert.ok(uncertain.every(item=>item.suggestion==='review'),'overlapping timestamps do not produce confident cut evidence');
 for(const item of uncertain)if(item.remove)for(const boundary of [item.remove.start,item.remove.end])assert.ok(!words.some(word=>word.start<boundary&&boundary<word.end),'no boundary enters a word');
 const candidates=only('hoje eu vou |0.5 hoje eu vou mostrar como editar');
 const report=cutDecisionReport([{candidateId:candidates[0].id,start:10,end:11,decision:'cut',reason:'primeira frase'}],{segments:[{start:0,end:9}],candidates});
 assert.match(report.errors[0],/does not overlap/);
});
