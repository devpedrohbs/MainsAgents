import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {advanceScroll,canAutoScroll,defaultSettings,fontSize,initialReadingState,pageStep,sceneNavigation,spaceShouldToggle,speed,stepFont,stepSpeed,togglePlaying,FONT_SIZES,SPEEDS} from '../src/features/production/teleprompter.ts';
import {buildRecordingPackage} from '../src/features/production/recordingPackage.ts';

test('reading always starts paused and reduced motion never auto-scrolls',()=>{
 assert.deepEqual(initialReadingState(),{playing:false,atEnd:false});
 assert.equal(canAutoScroll(true),false);assert.equal(canAutoScroll(false),true);
 assert.equal(togglePlaying(initialReadingState(),true).playing,false,'reduced motion: toggle is a no-op');
 const on=togglePlaying(initialReadingState(),false);assert.equal(on.playing,true);assert.equal(togglePlaying(on,false).playing,false);
});

test('font and speed are clamped; speed can never step down to a silent stop',()=>{
 let s=defaultSettings();
 for(let i=0;i<20;i++)s=stepFont(s,1);assert.equal(fontSize(s),FONT_SIZES.at(-1));
 for(let i=0;i<20;i++)s=stepFont(s,-1);assert.equal(fontSize(s),FONT_SIZES[0]);
 for(let i=0;i<20;i++)s=stepSpeed(s,-1);assert.equal(speed(s),SPEEDS[1]);assert.ok(speed(s)>0);
 for(let i=0;i<20;i++)s=stepSpeed(s,1);assert.equal(speed(s),SPEEDS.at(-1));
 assert.equal(fontSize({...defaultSettings(),fontIndex:NaN}),FONT_SIZES[2],'bad persisted value falls back to the default');
 assert.equal(defaultSettings().mirror,false);
});

test('scroll advances by speed×time, clamps at the end and reports it',()=>{
 assert.deepEqual(advanceScroll(0,1000,60,1000),{position:60,reachedEnd:false});
 assert.equal(advanceScroll(990,1000,60,1000).position,1000);assert.equal(advanceScroll(990,1000,60,1000).reachedEnd,true);
 assert.equal(advanceScroll(10,-500,60,1000).position,10,'negative elapsed never rewinds');
 assert.equal(advanceScroll(0,1000,60,0).reachedEnd,true,'content shorter than the viewport ends immediately');
 assert.equal(pageStep(0,1000,1,5000),850);assert.equal(pageStep(100,1000,-1,5000),0);assert.equal(pageStep(4900,1000,1,5000),5000);
});

test('scene guide only navigates; it never edits scenes',()=>{
 const scenes=[{index:1,title:'A'},{index:2,title:'B'}],before=JSON.stringify(scenes);
 assert.equal(sceneNavigation(scenes,0,-1),0);assert.equal(sceneNavigation(scenes,0,1),1);assert.equal(sceneNavigation(scenes,1,1),1);assert.equal(sceneNavigation([],3,1),0);
 assert.equal(JSON.stringify(scenes),before);
});

test('Space toggles reading only when focus is not on a control that uses Space',()=>{
 const el=(tagName,role)=>({tagName,getAttribute:name=>name==='role'?role??null:null});
 assert.equal(spaceShouldToggle(el('DIV')),true);assert.equal(spaceShouldToggle(el('DIV','document')),true);
 for(const tag of ['BUTTON','INPUT','TEXTAREA','SELECT','A','SUMMARY'])assert.equal(spaceShouldToggle(el(tag)),false,tag);
 assert.equal(spaceShouldToggle(el('DIV','button')),false);assert.equal(spaceShouldToggle({tagName:'DIV',isContentEditable:true}),false);
});

test('the approved script and its hash are untouched by reading helpers',()=>{
 const run={stage:'recording',scriptVersions:[{version:3,hash:'h3',text:'Linha 1\n\nLinha 2',path:{outline:['1. A','2. B']}}],scriptApproval:{version:3,hash:'h3'},notion:{scriptVersion:3,scriptHash:'h3'}};
 const before=JSON.stringify(run),built=buildRecordingPackage(run);
 assert.ok(built.ok);assert.equal(built.pkg.script,'Linha 1\n\nLinha 2');assert.equal(built.pkg.hash,'h3');
 assert.equal(JSON.stringify(run),before);
});

test('reading mode source has no persistence, network or recording calls',()=>{
 for(const file of ['../src/features/production/teleprompter.ts','../src/components/production/Teleprompter.tsx']){
  const source=readFileSync(new URL(file,import.meta.url),'utf8');
  assert.doesNotMatch(source,/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|getUserMedia|MediaRecorder|getDisplayMedia|updatePersistentValue|usePersistentState/,file);
 }
});

test('scenes come only from the approved outline; no outline means no scenes (nothing invented)',()=>{
 const base={stage:'recording',scriptApproval:{version:1,hash:'h'},notion:{scriptVersion:1,scriptHash:'h'}};
 const none=buildRecordingPackage({...base,scriptVersions:[{version:1,hash:'h',text:'Fala sem tópicos'}]});
 assert.ok(none.ok);assert.deepEqual(none.pkg.scenes,[]);assert.equal(none.pkg.script,'Fala sem tópicos');
 const blank=buildRecordingPackage({...base,scriptVersions:[{version:1,hash:'h',text:'x',path:{title:'T',outline:['','  ']}}]});
 assert.deepEqual(blank.pkg.scenes,[]);
 const some=buildRecordingPackage({...base,scriptVersions:[{version:1,hash:'h',text:'x',path:{title:'T',outline:'1. Abertura\n2) Meio\n- Fim'}}]});
 assert.deepEqual(some.pkg.scenes.map(s=>s.title),['Abertura','Meio','Fim']);
});

test('scene guide source has no automatic mapping or duration estimates',()=>{
 const source=readFileSync(new URL('../src/components/production/Teleprompter.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(source,/\.split\(|indexOf\(|IntersectionObserver|scrollIntoView|durationSeconds|wordsPerMinute|wpm/i);
 assert.match(source,/Marcação manual/);
});
