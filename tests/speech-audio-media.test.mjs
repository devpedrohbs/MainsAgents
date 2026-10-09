import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runMediaProcess,probeVideo} from '../editorial-media.mjs';
import {extractVoicePcm,voiceTrack} from '../editorial-motion-plan.mjs';
import {cutFilter,parseSilences,silenceDetectArgs,validatePlan} from '../editorial-smart-edit.mjs';
import {applyCandidateSelection,sourceToOutput,speechEditCandidates} from '../editorial-speech-edit.mjs';
import {assessAudio,assertMeasuredNoiseFloor,measureAudioLevels,probeAudioStream,proposeAudioTreatment,quietRanges,renderAudioPreview,verifyAudioCleanup} from '../editorial-audio-cleanup.mjs';

/**
 * Synthetic "speech": each word is a harmonic tone burst with its own pitch, separated by real pauses. Whisper-like
 * timings are passed late by 120 ms (start) / 50 ms (end) so the measured voice track has to correct them.
 */
const spoken=[['Hoje',0.30,0.70,180],['ahn',1.10,1.45,140],['eu',1.80,2.00,220],['eu',2.15,2.35,220],['vou',2.50,2.80,200],['mostrar',2.95,3.50,240],['isso.',3.65,4.10,190],['Agora',5.40,5.90,210],['sim.',6.05,6.50,170]];
const words=spoken.map(([text,start,end])=>({text,start:Math.round((start+0.12)*1000)/1000,end:Math.round((end+0.05)*1000)/1000}));
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
function voiceExpr(noise){
  const bursts=spoken.map(([,start,end,f])=>`between(t,${start},${end})*(0.35*sin(2*PI*${f}*t)+0.15*sin(4*PI*${f}*t))`).join('+');
  return `${bursts}${noise?`+${noise}*(random(0)-0.5)`:''}`;
}
async function fixture(root,name,{noise=0,channels='mono',video=true}={}){
  const path=join(root,`${name}.${video?'mp4':'m4a'}`);
  await runMediaProcess('ffmpeg',['-nostdin','-v','error','-n',...(video?['-f','lavfi','-i','testsrc2=size=64x36:rate=25']:[]),'-f','lavfi','-i',`aevalsrc='${voiceExpr(noise)}':s=48000:c=${channels}`,'-t','7',...(video?['-c:v','libx264','-pix_fmt','yuv420p']:[]),'-c:a','aac','-b:a','192k','-shortest',path]);
  return path;
}
async function render(input,output,plan,hasAudio=true){
  await runMediaProcess('ffmpeg',['-nostdin','-hide_banner','-v','error','-n','-i',input,'-filter_complex',cutFilter(plan.segments,{hasAudio,format:plan.format,normalizeAudio:plan.normalizeAudio,audio:plan.audio}),'-map','[vout]',...(hasAudio?['-map','[aout]','-c:a','aac','-ar','48000']:[]),'-c:v','libx264','-preset','veryfast','-crf','30',output],{timeoutMs:120000});
}
const track=async path=>{const pcm=await extractVoicePcm({inputPath:path,sampleRate:8000});return voiceTrack(pcm.samples,pcm.sampleRate);};
/** Measured voiced runs (>= 80 ms) in a track: the audible words. */
function voicedRuns(voice){
  const runs=[];let open=-1;
  for(let frame=0;frame<=voice.db.length;frame++){const loud=frame<voice.db.length&&voice.db[frame]>=voice.speechThresholdDb;if(loud&&open<0)open=frame;if(!loud&&open>=0){if(frame-open>=8)runs.push({start:open/100,end:frame/100});open=-1;}}
  return runs;
}

test('speech cuts from late Whisper timings land in measured pauses and every kept word survives intact (real FFmpeg)',{timeout:180000},async()=>{
  const root=mkdtempSync(join(tmpdir(),'speech-edit-')),input=await fixture(root,'speech'),before=sha(input);
  const voice=await track(input),transcript={origin:'local-whisper',timing:'words',segments:[{start:0.42,end:6.55,text:'Hoje ahn eu eu vou mostrar isso. Agora sim.'}],words};
  const {candidates,limitations}=speechEditCandidates({transcript,duration:7,track:voice});
  assert.deepEqual(limitations,[]);
  const filler=candidates.find(item=>item.kind==='filler'),repeat=candidates.find(item=>item.kind==='repetition');
  assert(filler&&repeat,JSON.stringify(candidates));assert.equal(filler.evidence.text,'ahn');assert.equal(repeat.evidence.text,'eu');
  // The real "ahn" burst is 1.10-1.45 although Whisper said 1.22-1.50: the cut starts before the real onset and ends
  // >= 80 ms before the real onset of the next word (1.80).
  assert(filler.start<=1.10&&filler.start>=0.76,`${filler.start}`);assert(filler.end>=1.45&&filler.end<=1.72,`${filler.end}`);
  assert(repeat.start<=1.80&&repeat.end>=2.00&&repeat.end<=2.07,`${repeat.start}-${repeat.end}`);
  const segments=applyCandidateSelection(candidates,[filler.id,repeat.id],7,{baseSegments:[{start:0,end:7}]});
  const {plan,outputDuration}=validatePlan({segments,audio:{leveling:false,noiseReduction:false,smoothCuts:true}},7);
  const output=join(root,'cut.mp4');await render(input,output,plan);
  const meta=await probeVideo(output,{ffprobe:'ffprobe',run:runMediaProcess});
  assert(Math.abs(meta.duration-outputDuration)<0.08,`${meta.duration} vs ${outputDuration}`);
  const kept=voicedRuns(await track(output)),expected=spoken.filter(([text,start])=>!(text==='ahn'||text==='eu'&&start<2.1)).map(([text,start,end])=>({text,start:sourceToOutput(start,plan.segments),length:end-start}));
  assert.equal(kept.length,expected.length,JSON.stringify(kept));
  expected.forEach((word,index)=>{
    // Each kept word is where the remap says (±30 ms) and keeps its full measured length (±30 ms): nothing clipped.
    assert(Math.abs(kept[index].start-word.start)<=0.03,`${word.text} at ${kept[index].start} vs ${word.start}`);
    assert(Math.abs(kept[index].end-kept[index].start-word.length)<=0.03,`${word.text} length ${kept[index].end-kept[index].start} vs ${word.length}`);
  });
  assert.equal(sha(input),before,'the original is never modified');
});

test('voice treatment: measured noise reduction only when noise exists, multichannel, no audio, cancel and preview (real FFmpeg)',{timeout:240000},async()=>{
  const root=mkdtempSync(join(tmpdir(),'audio-clean-'));
  const noisy=await fixture(root,'noisy',{noise:0.02}),clean=await fixture(root,'clean'),surround=await fixture(root,'surround',{noise:0.02,channels:'5.1'});
  const silencesOf=async path=>parseSilences(await runMediaProcess('ffmpeg',silenceDetectArgs(path,{thresholdDb:-35,minDuration:0.3}),{timeoutMs:60000}),7);
  const noisySilences=await silencesOf(noisy),before=sha(noisy);
  const assessed=await assessAudio({inputPath:noisy,silences:noisySilences,duration:7,versionId:'v1',sha256:before});
  // Uniform noise 0.02 peak-to-peak => -44.8 dBFS RMS; AAC adds a little.
  assert.equal(assessed.noiseReductionAvailable,true,assessed.reason);assert(assessed.noiseFloorDb>-48&&assessed.noiseFloorDb<-42,`${assessed.noiseFloorDb}`);
  assert.equal(assessed.measurement.versionId,'v1');assert.equal(assessed.stream.channels,1);
  const {audio}=proposeAudioTreatment(assessed,{noiseReduction:true,smoothCuts:true});
  assert.equal(assertMeasuredNoiseFloor(audio,assessed.measurement,{versionId:'v1',sha256:before}),true);
  const segments=[{start:0,end:4.4},{start:5.1,end:7}],{plan}=validatePlan({segments,audio},7),denoised=join(root,'denoised.mp4'),plain=join(root,'plain.mp4');
  await render(noisy,denoised,plan);await render(noisy,plain,validatePlan({segments},7).plan);
  const outRanges=quietRanges((await silencesOf(plain)).filter(item=>item.end-item.start>0.3),6.3);
  const levelsPlain=await measureAudioLevels({inputPath:plain,ranges:outRanges}),levelsDenoised=await measureAudioLevels({inputPath:denoised,ranges:outRanges});
  const verdict=verifyAudioCleanup({before:levelsPlain,after:levelsDenoised});
  assert.equal(verdict.improved,true,JSON.stringify({levelsPlain,levelsDenoised,verdict}));assert(verdict.noiseFloorDeltaDb<=-3,JSON.stringify(verdict));
  assert(Math.abs(levelsDenoised.speechLevelDb-levelsPlain.speechLevelDb)<1.5,'speech level kept within 1.5 dB');
  assert.equal(sha(noisy),before);
  // Clean source: pauses are digital silence, so noise reduction is not offered and cannot be forced.
  const quiet=await assessAudio({inputPath:clean,silences:await silencesOf(clean),duration:7,versionId:'v2',sha256:sha(clean)});
  assert.equal(quiet.noiseReductionAvailable,false);assert(quiet.limitations.includes('noMeasurableNoise'));
  assert.deepEqual(proposeAudioTreatment(quiet,{noiseReduction:true}).audio.noiseReduction,false);
  assert.throws(()=>assertMeasuredNoiseFloor({noiseReduction:{noiseFloorDb:-45}},quiet.measurement,{versionId:'v2',sha256:sha(clean)}),/measurement/);
  // 5.1 source: measured, treated and encoded; the real output layout is reported, not assumed.
  const surroundAssessed=await assessAudio({inputPath:surround,silences:await silencesOf(surround),duration:7,versionId:'v3',sha256:sha(surround)});
  assert.equal(surroundAssessed.stream.channels,6);assert(surroundAssessed.limitations.includes('multichannel'));assert.equal(surroundAssessed.noiseReductionAvailable,true);
  const surroundOut=join(root,'surround-out.mp4');await render(surround,surroundOut,validatePlan({segments,audio:{leveling:true,smoothCuts:true,noiseReduction:{noiseFloorDb:surroundAssessed.noiseFloorDb}}},7).plan);
  const outStream=await probeAudioStream({inputPath:surroundOut});assert.equal(outStream.channels,6,JSON.stringify(outStream));
  // No audio stream at all.
  const mute=join(root,'mute.mp4');await runMediaProcess('ffmpeg',['-nostdin','-v','error','-n','-f','lavfi','-i','testsrc2=size=64x36:rate=25','-t','2','-c:v','libx264','-pix_fmt','yuv420p',mute]);
  const none=await assessAudio({inputPath:mute,silences:[],duration:2,versionId:'v4',sha256:sha(mute)});assert.deepEqual(none.limitations,['noAudio']);assert.equal(none.measurement,null);
  // Cancellation: an aborted signal stops the measurement and nothing is reported as measured.
  const controller=new AbortController();controller.abort();
  await assert.rejects(assessAudio({inputPath:noisy,silences:noisySilences,duration:7,versionId:'v1',sha256:before,signal:controller.signal}),/canceled/);
  const late=new AbortController(),pending=measureAudioLevels({inputPath:noisy,ranges:quietRanges(noisySilences,7),signal:late.signal});late.abort();await assert.rejects(pending,/canceled/);
  // Processed-audio preview of the edited timeline (same cutFilter as the export).
  const preview=join(root,'preview.wav');await renderAudioPreview({inputPath:noisy,outputPath:preview,segments:plan.segments,audio:plan.audio,fromOutput:3,seconds:2});
  const previewMeta=await probeAudioStream({inputPath:preview});assert.equal(previewMeta.codec,'pcm_s16le');
  const previewDuration=Number((await runMediaProcess('ffprobe',['-v','error','-show_entries','format=duration','-of','csv=p=0',preview])).trim());assert(Math.abs(previewDuration-2)<0.05,`${previewDuration}`);
});
