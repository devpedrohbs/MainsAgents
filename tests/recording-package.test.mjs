import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRecordingPackage,recordingReady,checklistForPackage,toggleChecklistItem,checklistProgress,sceneList} from '../src/features/production/recordingPackage.ts';

const v=(version,hash,extra={})=>({version,hash,hook:'H',cta:'C',path:{title:'T',outline:['1. Abertura','- Demonstração']},text:`fala ${version}`,improvisationTopics:['x'],thumbnailDirection:'d',...extra});
const run=(over={})=>({stage:'recording',scriptVersions:[v(1,'a'),v(2,'b')],scriptApproval:{version:2,hash:'b',approvedAt:'2026-10-07'},notion:{scriptVersion:2,scriptHash:'b'},...over});

test('builds package from latest approved version, scenes only from outline',()=>{
 const r=buildRecordingPackage(run());
 assert.ok(r.ok);
 assert.equal(r.pkg.version,2);assert.equal(r.pkg.script,'fala 2');
 assert.deepEqual(r.pkg.scenes.map(s=>s.title),['Abertura','Demonstração']);
 assert.equal(r.pkg.suggestions.length,4);
 assert.ok(r.pkg.suggestions.every(s=>s.text.includes('Abertura')||s.text.includes('Demonstração')));
 assert.ok(buildRecordingPackage(run(),false).pkg.suggestions[0].text.startsWith('Cutaway'));
 assert.deepEqual(buildRecordingPackage(run({scriptVersions:[v(2,'b',{path:{title:'T'}})]})).pkg.scenes,[]);
});

test('gate requires latest approved version and matching Notion hash',()=>{
 assert.equal(recordingReady(run()),true);
 assert.equal(buildRecordingPackage(run({scriptApproval:{version:1,hash:'a'}})).reason,'approval-not-latest');
 assert.equal(buildRecordingPackage(run({scriptApproval:{version:2,hash:'zzz'}})).reason,'approval-hash-mismatch');
 assert.equal(buildRecordingPackage(run({scriptApproval:null})).reason,'no-approval');
 assert.equal(buildRecordingPackage(run({notion:null})).reason,'notion-missing');
 assert.equal(buildRecordingPackage(run({notion:{scriptVersion:2,scriptHash:'old'}})).reason,'notion-mismatch');
 assert.equal(buildRecordingPackage(run({notion:{scriptVersion:1,scriptHash:'a'}})).reason,'notion-mismatch');
 assert.equal(buildRecordingPackage(run({scriptVersions:[]})).reason,'no-script');
});

test('checklist resets when version or hash changes and does not gate readiness',()=>{
 const p1={version:1,hash:'a'},p2={version:2,hash:'b'};
 let s=toggleChecklistItem(null,p1,'framing',true);
 s=toggleChecklistItem(s,p1,'audio',true);
 assert.deepEqual(checklistProgress(s),{done:2,total:4});
 assert.deepEqual(checklistForPackage(s,p2).items,{});
 assert.deepEqual(checklistForPackage(s,{version:1,hash:'changed'}).items,{});
 const next=toggleChecklistItem(s,p2,'light',true);
 assert.deepEqual(next.items,{light:true});assert.equal(next.version,2);
 assert.equal(recordingReady(run()),true); // ready with zero items ticked
});

test('sceneList accepts strings and ignores blanks',()=>{
 assert.deepEqual(sceneList('a\n\n* b').map(s=>s.title),['a','b']);
 assert.deepEqual(sceneList(undefined),[]);
});
