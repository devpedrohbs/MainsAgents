import test from 'node:test';
import assert from 'node:assert/strict';
import {snapRemoval,applyCandidateSelection,outputToSource,refineSilenceCandidates,remapSpeechWords,segmentsFromWordRemovals,sourceToOutput,speechEditCandidates,speechWords} from '../editorial-speech-edit.mjs';
import {cutFilter,cutReview,planHash,remapTranscript,retakeCandidates,silenceCandidates,validatePlan} from '../editorial-smart-edit.mjs';
import {assertMeasuredNoiseFloor,proposeAudioTreatment,verifyAudioCleanup} from '../editorial-audio-cleanup.mjs';
import {artifactHash} from '../editorial-jobs.mjs';

const W=(text,start,end)=>({text,start,end});
/** Synthetic measured voice track: -20 dB inside each listed range, -70 dB elsewhere (10 ms frames). */
const track=(duration,ranges)=>{const db=new Float32Array(Math.round(duration*100)).fill(-70);for(const item of ranges)for(let frame=Math.round(item.start*100);frame<Math.round(item.end*100);frame++)db[frame]=-20;return {db,speechThresholdDb:-50,noiseFloorDb:-70,hop:80,sampleRate:8000,duration,samples:new Int16Array(0)};};
const words=[W('Hoje',0.2,0.5),W('ahn',0.8,1.1),W('eu',1.4,1.55),W('eu',1.65,1.8),W('vou',1.9,2.1),W('mostrar',2.2,2.6),W('o',2.7,2.8),W('erro',3.0,3.3),W('o',3.6,3.7),W('erro',3.8,4.1),W('mais',4.2,4.4),W('comum,',4.5,4.9),W('quer',5.3,5.45),W('dizer,',5.5,5.7),W('o',5.9,6.0),W('segundo',6.1,6.5),W('erro.',6.6,7.0)];
const transcript={origin:'local-whisper',timing:'words',segments:[{start:0.2,end:7,text:'Hoje ahn eu eu vou mostrar o erro o erro mais comum, quer dizer, o segundo erro.'}],words};
const source={contentId:'c',assetId:'a',versionId:'v',sha256:'f'.repeat(64)};

test('speech candidates: fillers, repetitions and self-corrections with evidence, margins and no preselection',()=>{
  const {candidates,limitations}=speechEditCandidates({transcript,duration:8,track:track(8,words)});
  assert.deepEqual(limitations,[]);
  assert.deepEqual(candidates.map(item=>[item.id,item.kind,item.start,item.end,item.confidence,item.evidence.text]),[
    ['filler-795','filler',0.795,1.315,'high','ahn'],
    ['repetition-1395','repetition',1.395,1.565,'medium','eu'],
    ['repetition-2695','repetition',2.695,3.515,'medium','o erro'],
    ['selfCorrection-3595','selfCorrection',3.595,5.815,'low','o erro mais comum, quer dizer,']]);
  for(const item of candidates){
    assert.equal(item.selected,false);assert(Object.isFrozen(item)&&Object.isFrozen(item.evidence));
    assert.equal(item.evidence.boundary,'voice');assert.match(item.evidence.boundaryNote,/aproximados.*não garantem/);
    // Edges sit in measured quiet frames, after the previous kept word (+60 ms) and before the next one (-80 ms).
    const prev=words.filter(word=>word.end<=item.start).at(-1),next=words.find(word=>word.start>=item.end);
    if(prev)assert(item.start>=prev.end+0.06-1e-9);if(next)assert(item.end<=next.start-0.08+1e-9);
    assert(item.evidence.words.every(word=>word.start>=item.start-0.01&&word.end<=item.end+0.01),item.id);
  }
  // Deterministic: same input, same output (ids included).
  assert.deepEqual(speechEditCandidates({transcript,duration:8,track:track(8,words)}).candidates,candidates);
});

test('restarted phrase keeps the last take; unsafe edges and missing voice evidence are discarded',()=>{
  const take=[W('Então',0.2,0.6),W('o',0.9,1.0),W('primeiro',1.1,1.5),W('passo',1.6,1.9),W('é',2.0,2.1),W('o',2.6,2.7),W('primeiro',2.8,3.2),W('passo',3.3,3.6),W('é',3.7,3.8),W('planejar.',3.9,4.5)];
  const found=speechEditCandidates({transcript:{segments:[{start:0.2,end:4.5,text:'x'}],words:take},duration:5,track:track(5,take)}).candidates.filter(item=>item.kind==='retake');
  assert.equal(found.length,1);assert.deepEqual([found[0].start,found[0].end],[0.895,2.515]);assert.equal(found[0].evidence.repeatedText,'o primeiro passo é');
  // "eu eu" spoken without any measured dip: there is no quiet frame for the cut edge, so nothing is offered.
  const glued=[W('Hoje',0.2,0.5),W('eu',0.7,0.85),W('eu',0.85,1.0),W('vou',1.0,1.3)];
  const unsafe=speechEditCandidates({transcript:{segments:[{start:0.2,end:1.3,text:'x'}],words:glued},duration:2,track:track(2,[{start:0.2,end:0.5},{start:0.7,end:1.3}])});
  assert.equal(unsafe.candidates.filter(item=>item.kind==='repetition').length,0);assert(unsafe.limitations.includes('unsafeBoundary'));
  // Whisper "heard" a filler where the measured audio is silent: rejected as having no voice evidence.
  const ghost=[W('Oi',0.2,0.5),W('hum',1.0,1.3),W('gente',1.8,2.2)];
  const none=speechEditCandidates({transcript:{segments:[{start:0.2,end:2.2,text:'x'}],words:ghost},duration:3,track:track(3,[ghost[0],ghost[2]])});
  assert.equal(none.candidates.length,0);assert(none.limitations.includes('noVoiceEvidence'));
  // Without a voice track the edges are transcript-only, labeled and downgraded.
  const blind=speechEditCandidates({transcript,duration:8});assert(blind.limitations.includes('voiceUnavailable'));
  assert(blind.candidates.every(item=>item.evidence.boundary==='transcript'&&item.confidence==='low'));
  // Imported transcript without word timings: only the legacy sentence-level suggestions, never word cuts.
  const sentences={origin:'imported',segments:[{start:0,end:2,text:'vamos falar de dados'},{start:2.2,end:4,text:'vamos falar de dados hoje'}]};
  const legacy=speechEditCandidates({transcript:sentences,duration:5});
  assert.deepEqual(legacy.candidates,retakeCandidates(sentences));assert.deepEqual(legacy.limitations,['wordTimingUnavailable']);
  assert.deepEqual(speechEditCandidates({transcript:null,duration:5}),{candidates:[],limitations:['transcriptUnavailable']});
});

test('emphasis pauses after ?/!/numbers are kept as inferred, other silences untouched',()=>{
  const spoken=[W('Sabe',0.1,0.4),W('por',0.5,0.7),W('quê?',0.8,1.2),W('Porque',2.6,3.0),W('sim.',3.1,3.5),W('E',5.0,5.2),W('3',6.8,7.0),W('vezes',7.1,7.5)];
  const silences=[{start:1.2,end:2.6},{start:3.5,end:5.0},{start:5.2,end:6.8}];
  const {candidates}=silenceCandidates(silences,{duration:8,padding:0.15});
  const refined=refineSilenceCandidates(candidates,{transcript:{segments:[],words:spoken},silences,duration:8});
  assert.deepEqual(refined.map(item=>[item.start,item.end,item.emphasis?.cue??null]),[[1.5,2.3,'question'],[3.65,4.85,null],[5.5,6.5,'number']]);
  assert(refined.filter(item=>item.emphasis).every(item=>item.emphasis.source==='inferred'&&/inferência editorial/.test(item.reason)&&item.selected));
  assert.equal(refined[1],candidates[1]);
  // A pause already shorter than the emphasis window is not cut at all.
  const short=silenceCandidates([{start:1.2,end:1.75}],{duration:8,padding:0.15}).candidates;
  assert.deepEqual(refineSilenceCandidates(short,{transcript:{segments:[],words:spoken},silences:[{start:1.2,end:1.75}],duration:8}),[]);
});

test('selection, undo and transcript-driven edits remap timestamps consistently',()=>{
  const {candidates}=speechEditCandidates({transcript,duration:8,track:track(8,words)});
  const base=[{start:0,end:8}],picked=applyCandidateSelection(candidates,['filler-795','repetition-1395'],8,{baseSegments:base});
  // The 80 ms quiet sliver between the two adjacent cuts is below the 0.1 s minimum segment and merges into the cut.
  assert.deepEqual(picked,[{start:0,end:0.795},{start:1.565,end:8}]);
  // Undo: deselecting returns exactly the previous plan; order of ids is irrelevant.
  assert.deepEqual(applyCandidateSelection(candidates,[],8,{baseSegments:base}),base);
  assert.deepEqual(applyCandidateSelection(candidates,['repetition-1395','filler-795'],8,{baseSegments:base}),picked);
  // Existing silence cuts in the base plan are preserved.
  const withSilence=applyCandidateSelection(candidates,['filler-795'],8,{baseSegments:[{start:0,end:7.2}]});assert.equal(withSilence.at(-1).end,7.2);
  // Editing by transcript: delete "ahn" and the first "eu" by word index.
  const list=speechWords(transcript,8),edit=segmentsFromWordRemovals(list,[1,2],8,{track:track(8,words)});
  assert.deepEqual(edit.rejected,[]);assert.deepEqual(edit.segments,[{start:0,end:0.795},{start:1.565,end:8}]);
  const remapped=remapSpeechWords(words,edit.segments);
  assert.deepEqual(remapped.map(item=>item.text).slice(0,3),['Hoje','eu','vou']);
  for(const item of remapped){assert.equal(item.start,sourceToOutput(item.sourceStart,edit.segments));assert.equal(outputToSource(item.start,edit.segments),item.sourceStart);}
  assert.equal(sourceToOutput(0.9,edit.segments),null);assert.equal(sourceToOutput(1.65,edit.segments),0.88);
  // Same mapping the subtitles use.
  assert.equal(remapTranscript([{start:1.65,end:1.8,text:'eu'}],edit.segments)[0]?.start??sourceToOutput(1.65,edit.segments),0.88);
});

test('cutReview evidence is additive and legacy output stays identical',()=>{
  const {candidates}=speechEditCandidates({transcript,duration:8,track:track(8,words)});
  const segments=applyCandidateSelection(candidates,['filler-795'],8,{baseSegments:[{start:0,end:8}]});
  const legacy=cutReview(segments,8,transcript.segments),rich=cutReview(segments,8,transcript.segments,undefined,{words,candidates});
  assert.deepEqual(Object.keys(legacy[0]),['id','start','end','duration','outputAt','basis','soundSeconds','speechSeconds','speech']);
  assert.deepEqual(rich.map(({removedWords,candidateIds,kinds,reasons,...rest})=>rest),legacy);
  assert.deepEqual(rich[0].removedWords,['ahn']);assert.deepEqual(rich[0].candidateIds,['filler-795']);assert.deepEqual(rich[0].kinds,['filler']);
});

test('plan audio: legacy plans unchanged, opt-in treatment validated, loudnorm once, measured provenance enforced',()=>{
  const legacy=validatePlan({segments:[{start:0,end:4}],normalizeAudio:true},8).plan;
  assert.equal('audio' in legacy,false);
  assert.equal(planHash(source,legacy),planHash(source,validatePlan({segments:[{start:0,end:4}],normalizeAudio:true},8).plan));
  assert.equal(cutFilter(legacy.segments,{hasAudio:true,normalizeAudio:true}),'[0:v:0]trim=start=0.000000:end=4.000000,setpts=PTS-STARTPTS[v0];[0:a:0]atrim=start=0.000000:end=4.000000,asetpts=PTS-STARTPTS[a0];[v0][a0]concat=n=1:v=1:a=1[vc][ac];[vc]scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1[vout];[ac]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]');
  const {plan}=validatePlan({segments:[{start:0,end:2},{start:3,end:4}],normalizeAudio:true,audio:{leveling:true,smoothCuts:true,noiseReduction:{noiseFloorDb:-47.04}}},8);
  assert.deepEqual(plan.audio,{leveling:true,noiseReduction:{noiseFloorDb:-47},smoothCuts:true});
  assert.notEqual(planHash(source,plan),planHash(source,{...plan,audio:undefined}));
  const filter=cutFilter(plan.segments,{hasAudio:true,normalizeAudio:true,audio:plan.audio});
  assert.equal(filter.match(/loudnorm/g).length,1);assert.match(filter,/afade=t=out:st=1\.988000:d=0\.012\[a0\]/);assert.match(filter,/afade=t=in:st=0:d=0\.012\[a1\]/);assert.match(filter,/highpass=f=70,afftdn=nr=10:nf=-47,loudnorm/);
  assert.match(cutFilter(plan.segments,{hasAudio:false,audio:plan.audio}),/concat=n=2:v=1:a=0\[vc\]$|setsar=1\[vout\]$/);
  for(const bad of [{gain:3},{leveling:'yes'},{noiseReduction:true},{noiseReduction:{noiseFloorDb:-75}},{noiseReduction:{noiseFloorDb:-10}},{noiseReduction:{noiseFloorDb:-45,nr:40}}])assert.throws(()=>validatePlan({segments:[{start:0,end:4}],audio:bad},8),/audio|Noise|noise/i);
  const stored={method:'astats-pauses-v1',versionId:'v',sha256:source.sha256,noiseFloorDb:-47,measuredSeconds:3.2,measuredAt:'x'};stored.digest=artifactHash({kind:'audio-noise-measurement',versionId:'v',sha256:source.sha256,method:stored.method,noiseFloorDb:-47,measuredSeconds:3.2});
  assert.equal(assertMeasuredNoiseFloor(plan.audio,stored,source),true);
  assert.equal(assertMeasuredNoiseFloor(undefined,null,source),true);assert.equal(assertMeasuredNoiseFloor({leveling:true},null,source),true);
  assert.throws(()=>assertMeasuredNoiseFloor(plan.audio,null,source),/local noise measurement/);
  assert.throws(()=>assertMeasuredNoiseFloor(plan.audio,{...stored,sha256:'0'.repeat(64)},source),/exact source/);
  assert.throws(()=>assertMeasuredNoiseFloor(plan.audio,{...stored,noiseFloorDb:-40},source),/altered/);
  assert.throws(()=>assertMeasuredNoiseFloor({noiseReduction:{noiseFloorDb:-50}},stored,source),/differs/);
  assert.deepEqual(proposeAudioTreatment({noiseReductionAvailable:false,reason:'limpo',measurement:null},{noiseReduction:true,leveling:true}),{audio:{leveling:true,noiseReduction:false,smoothCuts:false},notes:['limpo']});
  assert.deepEqual(verifyAudioCleanup({before:{noiseFloorDb:-45,speechLevelDb:-12},after:{noiseFloorDb:-45.4,speechLevelDb:-12}}).improved,false);
  assert.deepEqual(verifyAudioCleanup({before:{noiseFloorDb:-45,speechLevelDb:-20},after:{noiseFloorDb:-40,speechLevelDb:-10}}).improved,true);
});

test('snapRemoval aligns a user range to word edges or silences and rejects guesses',()=>{
  const list=speechWords(transcript,8),voice=track(8,words);
  assert.deepEqual(snapRemoval({start:0.9,end:1.2},list,{duration:8,track:voice}),{start:0.795,end:1.315,boundary:'voice',voicedSeconds:0.3,words:['ahn']});
  assert.deepEqual(snapRemoval({start:7.2,end:7.8},list,{duration:8,silences:[{start:7,end:8}]}),{start:7.2,end:7.8,boundary:'silence',words:[]});
  assert.deepEqual(snapRemoval({start:2.25,end:2.35},list,{duration:8}),{rejected:'noWordsOrSilence'});
  assert.deepEqual(snapRemoval({start:3,end:2},list,{duration:8}),{rejected:'invalidRange'});
});
