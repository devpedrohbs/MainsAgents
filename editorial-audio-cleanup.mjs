import {spawn} from 'node:child_process';
import {artifactHash} from './editorial-jobs.mjs';
import {audioTreatment,cutFilter,validateAudioTreatment} from './editorial-smart-edit.mjs';

/**
 * Local voice-treatment measurements with FFmpeg/ffprobe (no shell, bounded output, cancelable). Noise reduction is
 * only offered when a noise floor is MEASURED in detected pauses; a clean or digitally silent source reports
 * `noMeasurableNoise` instead of pretending an improvement. The original file is only read.
 */
export const audioMeasurementMethod='astats-pauses-v1';
export const audioPreferenceDefaults=Object.freeze({leveling:false,noiseReduction:false,smoothCuts:false});
const limits=Object.freeze({maxRanges:200,edgeSeconds:0.05,minQuietSeconds:0.5,maxOutput:2000000,previewMaxSeconds:30});
const round1=value=>Math.round(value*10)/10;
const finite=value=>typeof value==='number'&&Number.isFinite(value);

function runLocal(binary,args,{signal,timeoutMs=900000}={}){
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(new Error('Media operation canceled.'));return;}
    let stdout='',stderr='',done=false;const child=spawn(binary,args,{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
    const abort=()=>{child.kill();finish(new Error('Media operation canceled.'));};
    const timer=setTimeout(()=>{child.kill();finish(new Error('Audio analysis exceeded its time limit.'));},timeoutMs);timer.unref?.();
    signal?.addEventListener('abort',abort,{once:true});
    const collect=(chunk,which)=>{if(which==='out')stdout+=chunk;else stderr+=chunk;if(stdout.length+stderr.length>limits.maxOutput){child.kill();finish(new Error('Audio analysis output exceeded its limit.'));}};
    child.stdout.on('data',chunk=>collect(chunk,'out'));child.stderr.on('data',chunk=>collect(chunk,'err'));
    child.on('error',error=>finish(new Error(`${binary} unavailable: ${error.message}`)));
    child.on('close',code=>finish(code!==0?new Error(`Audio process failed (${code}): ${stderr.slice(-600)}`):null,{stdout,stderr}));
  });
}

/** First audio stream as ffprobe reports it; null when the file has no audio. */
export async function probeAudioStream({ffprobe='ffprobe',inputPath,signal}){
  const {stdout}=await runLocal(ffprobe,['-v','error','-protocol_whitelist','file,pipe','-select_streams','a:0','-show_entries','stream=channels,channel_layout,sample_rate,codec_name','-of','json',inputPath],{signal,timeoutMs:120000});
  const stream=JSON.parse(stdout).streams?.[0];if(!stream)return null;
  return {channels:Number(stream.channels)||0,channelLayout:typeof stream.channel_layout==='string'?stream.channel_layout:null,sampleRate:Number(stream.sample_rate)||0,codec:stream.codec_name??null};
}

/** Pauses shrunk by 50 ms per edge (no speech onsets/tails), longest first, capped for the filter expression. */
export function quietRanges(silences,duration){
  return (silences??[]).filter(item=>finite(item?.start)&&finite(item?.end)).map(item=>({start:Math.max(0,item.start+limits.edgeSeconds),end:Math.min(duration,item.end-limits.edgeSeconds)})).filter(item=>item.end-item.start>=0.05)
    .sort((x,y)=>(y.end-y.start)-(x.end-x.start)).slice(0,limits.maxRanges).sort((x,y)=>x.start-y.start);
}
const between=ranges=>ranges.map(item=>`between(t,${item.start.toFixed(3)},${item.end.toFixed(3)})`).join('+');

/** Overall RMS (all channels) inside the pauses and outside them, in one FFmpeg pass of 10 ms frames. */
export function audioLevelArgs(inputPath,ranges){
  const quiet=between(ranges);
  return ['-nostdin','-hide_banner','-v','info','-protocol_whitelist','file,pipe','-i',inputPath,'-vn','-sn','-dn','-filter_complex',
    `[0:a:0]asetnsamples=n=480:p=0,asplit[q][v];[q]aselect='${quiet}',astats@quiet=measure_perchannel=none:measure_overall=RMS_level+Peak_level[qo];[v]aselect='not(${quiet})',astats@voice=measure_perchannel=none:measure_overall=RMS_level[vo]`,
    '-map','[qo]','-f','null','-','-map','[vo]','-f','null','-'];
}
export function parseAudioLevels(log){
  const read=(name,key)=>{const match=[...String(log).matchAll(new RegExp(`\\[astats@${name} @ [^\\]]+\\] ${key} dB: (-?inf|-?[0-9.]+)`,'g'))].at(-1);if(!match)return undefined;return /inf/.test(match[1])?null:Number(match[1]);};
  return {noiseFloorDb:read('quiet','RMS level'),noisePeakDb:read('quiet','Peak level'),speechLevelDb:read('voice','RMS level')};
}

export async function measureAudioLevels({ffmpeg='ffmpeg',inputPath,ranges,signal}){
  if(!ranges.length)return {noiseFloorDb:undefined,noisePeakDb:undefined,speechLevelDb:undefined};
  const {stderr}=await runLocal(ffmpeg,audioLevelArgs(inputPath,ranges),{signal});
  return parseAudioLevels(stderr);
}

/**
 * Measures the source once. `measurement` carries a digest bound to version+sha256+method+value: the server stores it
 * and later accepts a plan's noiseFloorDb only through assertMeasuredNoiseFloor (a client claim is never a measurement).
 */
export async function assessAudio({ffmpeg='ffmpeg',ffprobe='ffprobe',inputPath,silences,duration,versionId,sha256,signal,now=()=>new Date().toISOString()}){
  const limitations=[],stream=await probeAudioStream({ffprobe,inputPath,signal});
  if(!stream)return {stream:null,noiseFloorDb:null,speechLevelDb:null,noiseReductionAvailable:false,reason:'O arquivo não tem áudio.',limitations:['noAudio'],measurement:null};
  if(stream.channels>2)limitations.push('multichannel');
  const ranges=quietRanges(silences,duration),measuredSeconds=Math.round(ranges.reduce((sum,item)=>sum+item.end-item.start,0)*1000)/1000;
  if(measuredSeconds<limits.minQuietSeconds){limitations.push('noSilenceToMeasure');return {stream,noiseFloorDb:null,speechLevelDb:null,noiseReductionAvailable:false,reason:'Sem pausas suficientes para medir o ruído de fundo; redução de ruído indisponível.',limitations,measurement:null};}
  const levels=await measureAudioLevels({ffmpeg,inputPath,ranges,signal});
  if(signal?.aborted)throw new Error('Media operation canceled.');
  const floor=levels.noiseFloorDb,available=finite(floor)&&floor>=audioTreatment.minNoiseFloorDb&&floor<=audioTreatment.maxNoiseFloorDb;
  if(!available)limitations.push('noMeasurableNoise');
  const noiseFloorDb=finite(floor)?round1(floor):null,method=audioMeasurementMethod;
  const measurement=noiseFloorDb===null?null:{method,versionId,sha256,noiseFloorDb,measuredSeconds,measuredAt:now(),digest:artifactHash({kind:'audio-noise-measurement',versionId,sha256,method,noiseFloorDb,measuredSeconds})};
  return {stream,noiseFloorDb,noisePeakDb:finite(levels.noisePeakDb)?round1(levels.noisePeakDb):null,speechLevelDb:finite(levels.speechLevelDb)?round1(levels.speechLevelDb):null,measuredSeconds,noiseReductionAvailable:available,
    reason:available?`Ruído de fundo medido em ${measuredSeconds}s de pausas: ${noiseFloorDb} dBFS RMS.`:noiseFloorDb===null?'Pausas digitalmente silenciosas: não há ruído para reduzir.':`Ruído de fundo ${noiseFloorDb} dBFS: abaixo do limite em que a redução ajudaria.`,limitations,measurement};
}

/** Server-side provenance check for plan.audio.noiseReduction; no-op when noise reduction is off. */
export function assertMeasuredNoiseFloor(planAudio,stored,{versionId,sha256}){
  const audio=planAudio===undefined?null:validateAudioTreatment(planAudio);
  if(!audio?.noiseReduction)return true;
  if(!stored||stored.method!==audioMeasurementMethod||stored.versionId!==versionId||stored.sha256!==sha256)throw new Error('Noise reduction needs a local noise measurement of this exact source version.');
  if(stored.digest!==artifactHash({kind:'audio-noise-measurement',versionId,sha256,method:stored.method,noiseFloorDb:stored.noiseFloorDb,measuredSeconds:stored.measuredSeconds}))throw new Error('The stored noise measurement was altered. Analyze the audio again.');
  if(Math.abs(stored.noiseFloorDb-audio.noiseReduction.noiseFloorDb)>0.05)throw new Error('The plan noise floor differs from the measured one.');
  return true;
}

/** Plan audio proposal from a measurement: only what the user opted in, noise reduction only when it was measured. */
export function proposeAudioTreatment(assessment,wanted=audioPreferenceDefaults){
  const notes=[];
  const noiseReduction=wanted.noiseReduction&&assessment?.noiseReductionAvailable&&assessment.measurement?{noiseFloorDb:assessment.measurement.noiseFloorDb}:false;
  if(wanted.noiseReduction&&!noiseReduction)notes.push(assessment?.reason??'Ruído não medido.');
  return {audio:{leveling:Boolean(wanted.leveling),noiseReduction,smoothCuts:Boolean(wanted.smoothCuts)},notes};
}

/** Before/after comparison measured on files; `improved` only when the pause floor really dropped (>= 1 dB). */
export function verifyAudioCleanup({before,after}){
  if(!finite(before?.noiseFloorDb)||!finite(after?.noiseFloorDb))return {noiseFloorDeltaDb:null,improved:false,note:'Sem medição comparável de ruído.'};
  const delta=round1(after.noiseFloorDb-before.noiseFloorDb),speechDelta=finite(before.speechLevelDb)&&finite(after.speechLevelDb)?round1(after.speechLevelDb-before.speechLevelDb):null;
  // Leveling raises everything; the honest figure is the speech-to-noise gap.
  const gapDelta=speechDelta===null?null:round1(speechDelta-delta);
  const improved=gapDelta===null?delta<=-1:gapDelta>=1;
  return {noiseFloorDeltaDb:delta,speechLevelDeltaDb:speechDelta,speechToNoiseDeltaDb:gapDelta,improved,note:improved?'Redução de ruído medida nas pausas.':'Nenhuma melhora de ruído medida.'};
}

/**
 * Short processed-audio preview (WAV) of the edited timeline window [fromOutput, fromOutput+seconds): the same cutFilter
 * the export uses, so what is heard is the final processing, not an approximation. Writes only `outputPath` (-n).
 */
export function audioPreviewArgs({inputPath,outputPath,segments,audio,normalizeAudio=false,fromOutput=0,seconds=20}){
  if(!finite(fromOutput)||fromOutput<0||!finite(seconds)||seconds<=0||seconds>limits.previewMaxSeconds)throw new Error('Audio preview window must be up to 30 seconds.');
  const filter=cutFilter(segments,{hasAudio:true,normalizeAudio,audio,video:false});
  return ['-nostdin','-hide_banner','-v','error','-n','-protocol_whitelist','file,pipe','-i',inputPath,'-filter_complex',`${filter};[aout]atrim=start=${fromOutput.toFixed(3)}:duration=${seconds.toFixed(3)},asetpts=PTS-STARTPTS[prev]`,'-map','[prev]','-vn','-c:a','pcm_s16le',outputPath];
}
export async function renderAudioPreview(input){
  await runLocal(input.ffmpeg??'ffmpeg',audioPreviewArgs(input),{signal:input.signal,timeoutMs:600000});
  return {path:input.outputPath,fromOutput:input.fromOutput??0,seconds:input.seconds??20};
}
