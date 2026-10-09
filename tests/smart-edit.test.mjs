import test from 'node:test';
import assert from 'node:assert/strict';
import {outputTimeline,remapTranscript,toSrt,cutReview,remotionAnimations,assertAnalyzable,cutFilter,keptSegments,parseSilences,planHash,removedSegments,retakeCandidates,silenceCandidates,silenceDetectArgs,silenceOptions,smartEditLimits,validatePlan,validateTranscript} from '../editorial-smart-edit.mjs';

const source={contentId:'c',assetId:'a',versionId:'v',sha256:'f'.repeat(64)};
test('silence options, detection parsing and padded candidates stay bounded',()=>{
  assert.deepEqual(silenceOptions(),{thresholdDb:-35,minDuration:0.5,padding:0.15});
  for(const bad of [{thresholdDb:-5},{thresholdDb:NaN},{minDuration:0},{padding:2},{padding:'0.1;rm'}])assert.throws(()=>silenceOptions(bad),/Invalid silence/);
  assert.throws(()=>silenceDetectArgs('x.mp4',{thresholdDb:'-30dB,ametadata'}),/Invalid silence/);
  const args=silenceDetectArgs('C:/v/in.mp4',{thresholdDb:-40,minDuration:0.4});assert.equal(args[args.indexOf('-i')+1],'C:/v/in.mp4');assert.equal(args[args.indexOf('-af')+1],'silencedetect=noise=-40dB:duration=0.4,ametadata=mode=print:file=-');
  const silences=parseSilences('frame:1\nlavfi.silence_start=0\nlavfi.silence_end=0.8\nlavfi.silence_start=2\nlavfi.silence_end=3.5\nlavfi.silence_start=5.5\n',6);
  assert.deepEqual(silences,[{start:0,end:0.8},{start:2,end:3.5},{start:5.5,end:6}]);
  const {candidates,limitations}=silenceCandidates(silences,{duration:6,padding:0.15});
  assert.deepEqual(limitations,[]);assert.deepEqual(candidates.map(item=>[item.start,item.end]),[[0,0.65],[2.15,3.35],[5.65,6]]);
  assert(candidates.every(item=>item.kind==='silence'&&item.selected===true&&Object.isFrozen(item)));
  // A pause shorter than twice the padding plus the minimum is not offered.
  assert.equal(silenceCandidates([{start:1,end:1.3}],{duration:6,padding:0.15}).candidates.length,0);
  assert.deepEqual(silenceCandidates([{start:0,end:6}],{duration:6}),{candidates:[],limitations:['allSilent']});
  const many=Array.from({length:600},(_,index)=>({start:index*2+1,end:index*2+1.8}));
  const truncated=silenceCandidates(many,{duration:1300,padding:0.1});assert.equal(truncated.candidates.length,smartEditLimits.maxCandidates);assert.deepEqual(truncated.limitations,['candidatesTruncated']);
});
test('kept segments invert removals and plans reject non-finite, overlapping, oversized or injected input',()=>{
  assert.deepEqual(keptSegments([{start:2.15,end:3.35},{start:0,end:0.8},{start:5.65,end:6}],6),[{start:0.8,end:2.15},{start:3.35,end:5.65}]);
  const {plan,outputDuration}=validatePlan({segments:[{start:0.8,end:2.15},{start:3.35,end:5.65}]},6);
  assert.equal(outputDuration,3.65);assert.deepEqual(plan,{segments:[{start:0.8,end:2.15},{start:3.35,end:5.65}],animations:[],format:'original',normalizeAudio:false,theme:'dark'});
  assert.deepEqual(removedSegments(plan.segments,6),[{start:0,end:0.8},{start:2.15,end:3.35},{start:5.65,end:6}]);
  const bad=[{segments:[]},{segments:[{start:0,end:Infinity}]},{segments:[{start:NaN,end:1}]},{segments:[{start:'0',end:'1;rm -rf'}]},{segments:[{start:'0:a',end:1}]},{segments:[{start:0,end:2},{start:1.5,end:3}]},{segments:[{start:3,end:4},{start:0,end:1}]},{segments:[{start:0,end:0.05}]},{segments:[{start:0,end:7}]},{segments:[{start:0,end:1,extra:'[0:v]'}]},{segments:[{start:0,end:1}],format:'square'},{segments:[{start:0,end:1}],filter:'x'},{segments:Array.from({length:201},(_,i)=>({start:i*0.2,end:i*0.2+0.15}))}];
  for(const value of bad)assert.throws(()=>validatePlan(value,6),undefined,JSON.stringify(value).slice(0,80));
  const filter=cutFilter(plan.segments,{hasAudio:true});
  assert.equal(filter,'[0:v:0]trim=start=0.800000:end=2.150000,setpts=PTS-STARTPTS[v0];[0:a:0]atrim=start=0.800000:end=2.150000,asetpts=PTS-STARTPTS[a0];[0:v:0]trim=start=3.350000:end=5.650000,setpts=PTS-STARTPTS[v1];[0:a:0]atrim=start=3.350000:end=5.650000,asetpts=PTS-STARTPTS[a1];[v0][a0][v1][a1]concat=n=2:v=1:a=1[vc][ac];[vc]scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1[vout];[ac]anull[aout]');
  assert(!cutFilter(plan.segments,{hasAudio:false}).includes('atrim'));assert(!filter.includes('silenceremove'));
  const hash=planHash(source,plan);assert.equal(hash,planHash(source,structuredClone(plan)));
  assert.notEqual(hash,planHash(source,{...plan,segments:[{start:0.8,end:2.1},plan.segments[1]]}));assert.notEqual(hash,planHash({...source,sha256:'0'.repeat(64)},plan));
  assert.throws(()=>assertAnalyzable({duration:3601}),/one hour/);assert.throws(()=>assertAnalyzable({duration:NaN}),/duration/);assertAnalyzable({duration:3600});
});
test('animations match the Remotion template: one title, lower third and end-anchored CTA with bounded plain text',()=>{
  const segments=[{start:0,end:4}];
  const {plan}=validatePlan({segments,theme:'light',animations:[{id:'t1',kind:'title',text:'Abertura',start:0,duration:2},{id:'l1',kind:'lowerThird',text:'Ana',subtitle:'Editora',start:1,duration:2},{id:'c1',kind:'cta',text:'Siga',start:0,duration:1}]},10);
  assert.equal(plan.animations.length,3);assert.equal(plan.animations[2].start,3,'CTA is anchored to the end of the output');
  assert.deepEqual(remotionAnimations(plan),{theme:'light',title:{text:'Abertura',startSeconds:0,durationSeconds:2},lowerThird:{name:'Ana',role:'Editora',startSeconds:1,durationSeconds:2},cta:{text:'Siga',durationSeconds:1}});
  const bad=[{id:'x',kind:'accent',text:'a',start:0,duration:1},{id:'x',kind:'script',text:'a',start:0,duration:1},{id:'x',kind:'title',text:'<img src=x>',start:0,duration:1},{id:'x',kind:'title',text:'veja https://evil',start:0,duration:1},{id:'x',kind:'title',text:'a'.repeat(81),start:0,duration:1},{id:'x',kind:'lowerThird',text:'a'.repeat(61),start:0,duration:1},{id:'x',kind:'title',text:'ok',subtitle:'not here',start:0,duration:1},{id:'x',kind:'title',text:'bidi‮',start:0,duration:1},{id:'x',kind:'title',text:'ok',start:3.8,duration:1},{id:'x',kind:'title',text:'ok',start:0,duration:1,preset:'bold'},{id:'x',kind:'title',text:'ok',start:0,duration:1,code:'alert(1)'},{id:'../x',kind:'title',text:'ok',start:0,duration:1},{id:'x',kind:'title',text:'ok',start:0,duration:Infinity},{id:'x',kind:'cta',text:'ok',duration:5}];
  for(const item of bad)assert.throws(()=>validatePlan({segments,animations:[item]},10),undefined,JSON.stringify(item));
  assert.throws(()=>validatePlan({segments,animations:[{id:'a',kind:'title',text:'x',start:0,duration:1},{id:'b',kind:'title',text:'y',start:1,duration:1}]},10),/one title/);
  assert.throws(()=>validatePlan({segments,theme:'neon'},10),/theme/);
  assert.throws(()=>validatePlan({segments:[{start:0,end:1801}],animations:[{id:'t',kind:'title',text:'x',start:0,duration:1}]},3600),/30 minutes/);
});
test('imported transcripts are validated and only suggest unselected possible retakes',()=>{
  assert.equal(validateTranscript(undefined,10),null);
  for(const bad of [{segments:[]},{segments:[{start:0,end:20,text:'x'}]},{segments:[{start:2,end:3,text:'a'},{start:1,end:2,text:'b'}]},{segments:[{start:0,end:1,text:'a\u0000'}]},{segments:[{start:0,end:NaN,text:'a'}]}])assert.throws(()=>validateTranscript(bad,10),/Transcript/);
  const transcript=validateTranscript({segments:[{start:0,end:1.5,text:'Hoje vamos falar de'},{start:1.8,end:4,text:'Hoje vamos falar de edição local.'},{start:4.2,end:6,text:'Primeiro passo é abrir o arquivo.'},{start:6.1,end:8,text:'Depois conferimos o resultado.'}]},10);
  assert.equal(transcript.origin,'imported');
  const retakes=retakeCandidates(transcript);
  assert.equal(retakes.length,1);assert.deepEqual([retakes[0].start,retakes[0].end,retakes[0].kind,retakes[0].selected],[0,1.5,'possibleRetake',false]);
  assert.match(retakes[0].reason,/Revise/);assert(!/erro|wrong/i.test(retakes[0].label+retakes[0].reason));
});

test('review helpers map cuts and speech onto the edited timeline and write CapCut-ready SRT',()=>{
  const kept=[{start:0,end:1.15},{start:2.35,end:3.65},{start:4.85,end:6}];
  assert.deepEqual(outputTimeline(kept).map(item=>item.outputStart),[0,1.15,2.45]);
  // A sentence split by a cut becomes one contiguous caption; speech fully inside a cut disappears.
  assert.deepEqual(remapTranscript([{start:0.2,end:1,text:'Olá'},{start:0.9,end:2.6,text:'cortada no meio'},{start:3.8,end:4.7,text:'some'},{start:5,end:5.9,text:'Tchau'}],kept),[{start:0.2,end:1,text:'Olá'},{start:0.9,end:1.4,text:'cortada no meio'},{start:2.6,end:3.5,text:'Tchau'}]);
  const cuts=cutReview(kept,6,[{start:0.9,end:2.6,text:'cortada no meio'}]);
  assert.deepEqual(cuts.map(item=>[item.start,item.end,item.outputAt,item.speechSeconds,item.speech.length]),[[1.15,2.35,1.15,1.2,1],[3.65,4.85,2.45,0,0]]);
  assert.equal(toSrt([{start:0,end:1.5,text:'Olá'},{start:61.25,end:3725.004,text:'linha\nquebrada'}]),'1\r\n00:00:00,000 --> 00:00:01,500\r\nOlá\r\n\r\n2\r\n00:01:01,250 --> 01:02:05,004\r\nlinha quebrada\r\n');
});
