/**
 * Local offset measurement between the camera and the screen recording, from their COMMON audio only (FFmpeg + JS, no
 * service). Bounded and cancelable: at most `coarseSeconds` of each file is decoded for the coarse search and two short
 * windows for the fine/drift check; the correlation runs in small chunks that yield to the event loop.
 *
 * Signal: 8 kHz mono PCM -> 10 ms log energy -> half-wave rectified first difference (onsets) -> z-score. A steady tone or a
 * periodic signal has no unique onset pattern: its correlation has several equal peaks or no variance and is reported as
 * inconclusive, never as a measured offset.
 *
 * Result statuses: 'measured' (two windows agree within the drift tolerance, unique strong peaks), 'drift' (both windows
 * clear but disagree: a fixed offset cannot fix it), 'inconclusive' (reason), 'no-common-audio' (reason). The score is a
 * normalized correlation of the onset envelopes, NOT a calibrated probability.
 */
import {spawn} from 'node:child_process';

export const SYNC_LIMITS=Object.freeze({searchSeconds:120,coarseSeconds:200,coarseRate:25,fineRate:100,windowSeconds:40,minWindowSeconds:8,fineSearchSeconds:1,driftToleranceSeconds:0.04,minScore:0.3,minRatio:1.35,exclusionSeconds:0.5,sampleRate:8000});
const round3=value=>Math.round(value*1000)/1000;
const yieldNow=()=>new Promise(resolve=>setImmediate(resolve));
const aborted=signal=>{if(signal?.aborted)throw Object.assign(new Error('Medição cancelada.'),{code:'cancelled'});};

/** Mono 8 kHz s16 PCM of [start,start+duration) of the first audio stream (bounded by duration). */
export function decodePcm({ffmpeg='ffmpeg',path,start=0,duration,signal,timeoutMs=300000,sampleRate=SYNC_LIMITS.sampleRate}){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(Object.assign(new Error('Medição cancelada.'),{code:'cancelled'}));return;}
  // Hybrid seek: a fast input seek to 3 s before, then an exact decode-and-discard (input seeking alone can land a codec frame
  // off, e.g. 20 ms for Opus in Matroska, which would read as a false offset change).
  const at=Math.max(0,start),near=Math.max(0,at-3),args=['-nostdin','-hide_banner','-v','error','-protocol_whitelist','file,pipe',...(near>0?['-ss',String(near)]:[]),'-i',path,'-ss',String(Math.round((at-near)*1e6)/1e6),'-t',String(Math.max(0.1,duration)),'-map','0:a:0','-vn','-ac','1','-ar',String(sampleRate),'-f','s16le','pipe:1'];
  const child=spawn(ffmpeg,args,{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const chunks=[],limit=Math.ceil(duration*sampleRate*2)+65536;let size=0,stderr='',done=false;
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
  const abort=()=>{child.kill();finish(Object.assign(new Error('Medição cancelada.'),{code:'cancelled'}));};
  const timer=setTimeout(()=>{child.kill();finish(new Error('A medição do áudio excedeu o tempo limite.'));},timeoutMs);timer.unref?.();
  signal?.addEventListener('abort',abort,{once:true});
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size>limit){child.kill();finish(new Error('Áudio maior que o limite da medição.'));}else chunks.push(chunk);});
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-1500);});
  child.on('error',error=>finish(new Error(`${ffmpeg} indisponível: ${error.message}`)));
  child.on('close',code=>{if(done)return;if(code!==0){finish(new Error(`Não foi possível ler o áudio (${code}): ${stderr.slice(-300)}`));return;}const buffer=Buffer.concat(chunks),samples=new Int16Array(buffer.length>>1);for(let i=0;i<samples.length;i++)samples[i]=buffer.readInt16LE(i*2);finish(null,samples);});
 });
}

/** Onset envelope (z-scored) at `rate` Hz. Returns {values, std} (std≈0 = no structure). */
export function onsetEnvelope(samples,{sampleRate=SYNC_LIMITS.sampleRate,rate=SYNC_LIMITS.fineRate}={}){
 const hop=Math.max(1,Math.round(sampleRate/rate)),n=Math.floor(samples.length/hop),energy=new Float64Array(n);
 for(let i=0;i<n;i++){let sum=0;for(let j=i*hop,end=j+hop;j<end;j++){const v=samples[j]/32768;sum+=v*v;}energy[i]=Math.log10(1e-7+sum/hop);}
 const values=new Float64Array(n);for(let i=1;i<n;i++)values[i]=Math.max(0,energy[i]-energy[i-1]);
 let mean=0;for(const v of values)mean+=v;mean/=Math.max(1,n);let variance=0;for(const v of values)variance+=(v-mean)**2;const std=Math.sqrt(variance/Math.max(1,n));
 if(std>1e-9)for(let i=0;i<n;i++)values[i]=(values[i]-mean)/std;else values.fill(0);
 return {values,std};
}

/**
 * Normalized cross-correlation r(k) = pearson(a[i], b[i+k]) over the overlap, for k in [minLag,maxLag] (samples).
 * Cooperative: yields every few hundred lags and honors `signal`. Returns {best:{lag,score}, second:{lag,score}, refinedLag}.
 */
export async function correlate(a,b,{minLag,maxLag,minOverlap,exclusion,signal}){
 const scores=new Float64Array(maxLag-minLag+1).fill(-2);let steps=0;
 for(let k=minLag;k<=maxLag;k++){
  const i0=Math.max(0,-k),i1=Math.min(a.length,b.length-k),count=i1-i0;
  if(count>=minOverlap){let sa=0,sb=0,saa=0,sbb=0,sab=0;for(let i=i0;i<i1;i++){const x=a[i],y=b[i+k];sa+=x;sb+=y;saa+=x*x;sbb+=y*y;sab+=x*y;}
   const cov=sab-sa*sb/count,va=saa-sa*sa/count,vb=sbb-sb*sb/count;scores[k-minLag]=va>1e-9&&vb>1e-9?cov/Math.sqrt(va*vb):-2;}
  if(++steps%200===0){aborted(signal);await yieldNow();}
 }
 let best={lag:minLag,score:-2};for(let k=minLag;k<=maxLag;k++)if(scores[k-minLag]>best.score)best={lag:k,score:scores[k-minLag]};
 let second={lag:null,score:-2};for(let k=minLag;k<=maxLag;k++)if(Math.abs(k-best.lag)>exclusion&&scores[k-minLag]>second.score)second={lag:k,score:scores[k-minLag]};
 // Sub-sample peak (parabolic) when both neighbours exist.
 let refinedLag=best.lag;const i=best.lag-minLag;if(i>0&&i<scores.length-1&&scores[i-1]>-2&&scores[i+1]>-2){const y0=scores[i-1],y1=scores[i],y2=scores[i+1],den=y0-2*y1+y2;if(Math.abs(den)>1e-12)refinedLag=best.lag+Math.max(-0.5,Math.min(0.5,0.5*(y0-y2)/den));}
 return {best,second,refinedLag,atEdge:best.lag===minLag||best.lag===maxLag};
}
const resample=(values,factor)=>{const n=Math.floor(values.length/factor),out=new Float64Array(n);for(let i=0;i<n;i++){let s=0;for(let j=0;j<factor;j++)s+=values[i*factor+j];out[i]=s/factor;}return out;};

/**
 * Measures offsetSeconds (screenTime = cameraTime − offset). input: {ffmpeg, camera:{path,duration,hasAudio}, screen:{...}, signal}.
 */
export async function measureOffset({ffmpeg='ffmpeg',camera,screen,signal,limits=SYNC_LIMITS,decode=decodePcm}){
 const L=limits;
 if(!camera.hasAudio&&!screen.hasAudio)return {status:'no-common-audio',reason:'none-has-audio'};
 if(!camera.hasAudio)return {status:'no-common-audio',reason:'camera-no-audio'};
 if(!screen.hasAudio)return {status:'no-common-audio',reason:'screen-no-audio'};
 // Coarse: the first coarseSeconds of each, ±searchSeconds.
 const cLen=Math.min(camera.duration,L.coarseSeconds),sLen=Math.min(screen.duration,L.coarseSeconds);
 const [cPcm,sPcm]=[await decode({ffmpeg,path:camera.path,start:0,duration:cLen,signal}),await decode({ffmpeg,path:screen.path,start:0,duration:sLen,signal})];aborted(signal);
 const cEnv=onsetEnvelope(cPcm,{rate:L.fineRate}),sEnv=onsetEnvelope(sPcm,{rate:L.fineRate});
 if(cEnv.std<1e-6||sEnv.std<1e-6)return {status:'inconclusive',reason:'no-structure'};
 const factor=Math.round(L.fineRate/L.coarseRate),cc=resample(cEnv.values,factor),sc=resample(sEnv.values,factor),rate=L.fineRate/factor;
 // lag k: camera[i] ~ screen[i+k]; t_s = t_c + k/rate = t_c − offset  =>  offset = −k/rate
 const search=Math.round(L.searchSeconds*rate),coarse=await correlate(cc,sc,{minLag:-search,maxLag:search,minOverlap:Math.round(L.minWindowSeconds*rate),exclusion:Math.round(L.exclusionSeconds*rate),signal});
 const verdict=(peak,label)=>peak.best.score<L.minScore?`${label}-weak`:peak.second.score>0&&peak.best.score/peak.second.score<L.minRatio?`${label}-ambiguous`:peak.atEdge?`${label}-edge`:null;
 const coarseProblem=verdict(coarse,'coarse');
 const coarseOffset=-coarse.refinedLag/rate;
 if(coarseProblem)return {status:'inconclusive',reason:coarseProblem==='coarse-edge'?'out-of-range':coarseProblem.endsWith('weak')?'weak-correlation':'ambiguous-peak',score:round3(coarse.best.score),ratio:coarse.second.score>0?round3(coarse.best.score/coarse.second.score):null,candidateOffset:round3(coarseOffset)};
 // Overlap on the camera timeline with the coarse estimate; two fine windows (early and late) at fineRate. The screen window
 // starts exactly `pad` (a whole number of envelope frames) before the matching camera instant, so both envelope grids are
 // aligned to the estimate and never need a negative start; a second pass re-aligns them to the first fine estimate.
 const ovStart=Math.max(0,coarseOffset),ovEnd=Math.min(camera.duration,coarseOffset+screen.duration),span=ovEnd-ovStart;
 const hop=1/L.fineRate,pad=Math.round((L.fineSearchSeconds+0.5)/hop)*hop;
 if(span<2*L.minWindowSeconds+2*pad)return {status:'inconclusive',reason:'overlap-short',overlapSeconds:round3(Math.max(0,span)),candidateOffset:round3(coarseOffset)};
 const win=Math.min(L.windowSeconds,(span-2*pad)/2);
 const fineAt=async(at,guess)=>{
  const sStart=Math.max(0,at-guess-pad),sDur=Math.min(screen.duration-sStart,win+2*pad);
  const [c,s]=[await decode({ffmpeg,path:camera.path,start:at,duration:win,signal}),await decode({ffmpeg,path:screen.path,start:sStart,duration:sDur,signal})];
  const ce=onsetEnvelope(c,{rate:L.fineRate}).values,se=onsetEnvelope(s,{rate:L.fineRate}).values;
  // camera index i <-> screen index i+k with k = (at − offset − sStart)·rate  =>  offset = at − sStart − k/rate
  const expected=(at-guess-sStart)*L.fineRate,reach=Math.round(L.fineSearchSeconds*L.fineRate);
  const peak=await correlate(ce,se,{minLag:Math.round(expected)-reach,maxLag:Math.round(expected)+reach,minOverlap:Math.round(L.minWindowSeconds*L.fineRate*0.8),exclusion:Math.round(L.exclusionSeconds*L.fineRate),signal});
  return {at,peak,offset:at-sStart-peak.refinedLag/L.fineRate};
 };
 const fine=async at=>{const first=await fineAt(at,coarseOffset);return Math.abs(first.offset-coarseOffset)<L.fineSearchSeconds?fineAt(at,first.offset):first;};
 const early=await fine(ovStart+pad),late=await fine(Math.max(ovStart+pad,ovEnd-pad-win));aborted(signal);
 const problem=verdict(early.peak,'early')??verdict(late.peak,'late');
 const score=round3(Math.min(early.peak.best.score,late.peak.best.score));
 if(problem)return {status:'inconclusive',reason:problem.endsWith('weak')?'weak-correlation':problem.endsWith('edge')?'fine-edge':'ambiguous-peak',score,candidateOffset:round3(early.offset)};
 // Drift is judged over the WHOLE overlap (the measured change between the windows, extrapolated), not only between them.
 const drift=late.offset-early.offset,spanSeconds=round3(late.at-early.at),projected=drift*span/Math.max(1,late.at-early.at);
 if(Math.abs(projected)>L.driftToleranceSeconds)return {status:'drift',reason:'drift',offsetSeconds:round3(early.offset),lateOffsetSeconds:round3(late.offset),driftSeconds:round3(drift),projectedDriftSeconds:round3(projected),spanSeconds,overlapSeconds:round3(span),score};
 return {status:'measured',offsetSeconds:round3((early.offset+late.offset)/2),driftSeconds:round3(drift),projectedDriftSeconds:round3(projected),spanSeconds,overlapSeconds:round3(span),score,windows:[{at:round3(early.at),offset:round3(early.offset)},{at:round3(late.at),offset:round3(late.offset)}]};
}

/** PT reason of a non-measured result (shown to the person; manual offset is always possible). */
export const syncReasonText={
 'none-has-audio':'Nenhuma das duas gravações tem áudio; não há como medir o atraso.',
 'camera-no-audio':'A gravação da câmera não tem áudio; não há áudio comum para medir o atraso.',
 'screen-no-audio':'A gravação da tela não tem áudio; não há áudio comum para medir o atraso.',
 'no-structure':'O áudio não tem variação suficiente (silêncio ou tom contínuo) para medir o atraso.',
 'weak-correlation':'O áudio das duas gravações não parece o mesmo (correlação fraca); não dá para afirmar o atraso.',
 'ambiguous-peak':'O áudio tem padrões repetidos; mais de um atraso parece possível e nenhum foi escolhido.',
 'out-of-range':`O atraso parece maior que ±${SYNC_LIMITS.searchSeconds} s (limite da busca automática).`,
 'fine-edge':'A conferência fina do atraso não convergiu.',
 'overlap-short':'As gravações se sobrepõem por pouco tempo; não dá para conferir deriva.',
 drift:'O atraso muda ao longo da gravação (deriva). Um atraso fixo não corrige isso.',
};
