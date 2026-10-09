import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewWords,outputTimeOf,rawTimeOf,keptShare,selectionOf,snapRemovalToWords,userCue,withUserCue,emptyMotion,focusFromRawClick,pushHistory} from '../src/features/content/editReviewModel.ts';
import {normalizeMotion} from '../editorial-motion-plan.mjs';
import {validatePlan,needsAnimation,remotionAnimations} from '../editorial-smart-edit.mjs';

const segments=[{start:0,end:2},{start:3,end:5}];
test('raw <-> edited time and kept share follow the cut',()=>{
  assert.equal(outputTimeOf(1,segments),1);assert.equal(outputTimeOf(2.5,segments),null);assert.equal(outputTimeOf(3.5,segments),2.5);
  assert.equal(rawTimeOf(2.5,segments),3.5);assert.equal(rawTimeOf(99,segments),5);
  assert.equal(keptShare({start:1.5,end:2.5},segments),0.5);assert.equal(keptShare({start:2.2,end:2.8},segments),0);
});
test('words: real timings verbatim, else evenly split and labelled estimated; selections keep the literal text',()=>{
  const real=reviewWords({segments:[],words:[{start:0,end:0.5,text:' Olá,'},{start:0.6,end:1,text:'mundo'}]});
  assert.deepEqual(real.map(w=>[w.text,w.estimated]),[['Olá,',false],['mundo',false]]);
  const est=reviewWords({segments:[{start:0,end:3,text:'um dois três'}]});assert(est.every(w=>w.estimated));assert.equal(est.at(-1).end,3);
  assert.deepEqual(selectionOf(real,1,0),{start:0,end:1,text:'Olá, mundo',first:0,last:1,estimated:false});
});
test('a transcript cut lands in the pauses around the words, never inside a word',()=>{
  const words=reviewWords({segments:[],words:[{start:0,end:0.4,text:'a'},{start:1,end:1.4,text:'b'},{start:1.5,end:1.9,text:'c'},{start:3,end:3.4,text:'d'}]});
  const cut=snapRemovalToWords(words,1,2,4);
  assert(cut.start>=0.4&&cut.start<=1,JSON.stringify(cut));assert(cut.end>=1.9&&cut.end<=3,JSON.stringify(cut));
  assert.equal(cut.start,0.85);assert.equal(cut.end,2.05);
});
test('user cues pass the motion engine with an honest origin; empty motion can carry them and a framing focus',()=>{
  const motion=withUserCue(withUserCue(undefined,userCue('punchIn',{start:3.2,end:3.6},undefined,'u1')),userCue('kineticText',{start:0.5,end:1.5},'mundo inteiro','u2'));
  const normalized=normalizeMotion({...motion,reframe:{mode:'fixed',source:'user',points:[{t:0,x:0.3,y:0.4}]}},segments);
  assert.deepEqual(normalized.cues.map(c=>[c.kind,c.source,c.text??'']),[['kineticText','user','mundo inteiro'],['punchIn','user','']]);
  assert.equal(normalized.cues[1].start,2.2,'remapped onto the edited timeline');
  const plan=validatePlan({segments,motion:{...emptyMotion(),reframe:{mode:'manual',source:'user',points:[{t:1,x:0.2,y:0.3},{t:4,x:0.7,y:0.3}]}}},5).plan;
  assert(needsAnimation(plan),'framing-only plan needs the Remotion pass');assert(remotionAnimations(plan).motion.reframe);
});
test('focus click maps the letterboxed raw picture to source coordinates',()=>{
  const box={left:0,top:0,width:400,height:400},video={width:1920,height:1080};// 400x225 picture, 87.5 px bars
  assert.equal(focusFromRawClick(box,video,{x:200,y:20}),null,'bar is outside the picture');
  assert.deepEqual(focusFromRawClick(box,video,{x:100,y:87.5+112.5}),{x:0.25,y:0.5});
  assert.deepEqual(focusFromRawClick({left:10,top:0,width:400,height:225},video,{x:410,y:0}),{x:1,y:0});
});
test('history is bounded and snapshots are independent',()=>{
  const draft={a:[1]};const history=pushHistory([],draft);draft.a.push(2);assert.deepEqual(history[0],{a:[1]});
  assert.equal(Array.from({length:60}).reduce(h=>pushHistory(h,{}),[]).length,50);
});
