import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {runMediaProcess} from '../editorial-media.mjs';

/**
 * Synthetic camera + screen recordings with a KNOWN offset (offsetSeconds: screenTime = cameraTime − offset).
 * The common audio is a deterministic, NON-periodic "speech-like" signal (noise bursts of pseudo-random length, gap and
 * level). The screen copy gets a different gain, added noise and another encode, so the match is not byte equality.
 * Video: the camera is testsrc2 with a white "CAM" box; the screen is a 16:9 UI-like picture (smptehdbars + a moving
 * marker) with a yellow "SCREEN" box, so both are recognisable in a frame.
 */
const ffmpeg=args=>runMediaProcess('ffmpeg',['-nostdin','-v','error','-y',...args],{timeoutMs:300000});
function prng(seed){let x=seed>>>0||1;return ()=>{x^=x<<13;x>>>=0;x^=x>>17;x^=x<<5;x>>>=0;return x/4294967296;};}
/** Mono 16-bit PCM WAV of `seconds` of the common signal (48 kHz). periodic: a 2 Hz beep train instead (ambiguous on purpose). */
export function commonSignal(seconds,{seed=7,sampleRate=48000,periodic=false,tone=false}={}){
 const n=Math.round(seconds*sampleRate),data=new Int16Array(n),rand=prng(seed);
 if(tone){for(let i=0;i<n;i++)data[i]=Math.round(0.4*32767*Math.sin(2*Math.PI*440*i/sampleRate));}
 else if(periodic){for(let i=0;i<n;i++){const t=i/sampleRate,on=(t%0.5)<0.1;data[i]=on?Math.round(0.5*32767*Math.sin(2*Math.PI*1000*t)):0;}}
 else{let i=0;while(i<n){const burst=Math.round((0.06+rand()*0.35)*sampleRate),gap=Math.round((0.04+rand()*0.5)*sampleRate),level=0.15+rand()*0.6,pitch=120+rand()*180;
  for(let k=0;k<burst&&i<n;k++,i++){const env=Math.sin(Math.PI*k/burst);data[i]=Math.round(32767*level*env*(0.6*(rand()*2-1)+0.4*Math.sin(2*Math.PI*pitch*i/sampleRate)));}
  i+=gap;}}
 const header=Buffer.alloc(44);header.write('RIFF',0);header.writeUInt32LE(36+n*2,4);header.write('WAVE',8);header.write('fmt ',12);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(sampleRate,24);header.writeUInt32LE(sampleRate*2,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(n*2,40);
 return Buffer.concat([header,Buffer.from(data.buffer)]);
}
/**
 * Writes camera.mp4 and screen.(mp4|mkv) in `dir`. offsetSeconds: known offset. cameraSeconds/screenSeconds: lengths.
 * drift: playback-rate factor applied to the screen audio (e.g. 1.002 = 2 ms/s). noAudio: 'camera'|'screen'|'both'.
 */
export async function pairFixture(dir,{offsetSeconds=2.4,cameraSeconds=40,screenSeconds=40,drift=0,noAudio,periodic=false,tone=false,size='320x180',screenSize='640x360',fps=24,lead=5,name='pair'}={}){
 const master=join(dir,`${name}-master.wav`);await writeFile(master,commonSignal(lead*2+Math.max(cameraSeconds,screenSeconds)+Math.abs(offsetSeconds)+10,{periodic,tone}));
 const camera=join(dir,`${name}-camera.mp4`),screen=join(dir,`${name}-screen.mkv`);
 const camAudio=noAudio==='camera'||noAudio==='both'?[]:['-ss',String(lead),'-t',String(cameraSeconds),'-i',master];
 await ffmpeg(['-f','lavfi','-i',`testsrc2=size=${size}:rate=${fps}`,...camAudio,'-filter_complex',`[0:v]drawbox=x=8:y=8:w=60:h=24:color=white:t=fill,drawtext=text='CAM':x=14:y=12:fontsize=16:fontcolor=black[v]`,'-map','[v]',...(camAudio.length?['-map','1:a','-c:a','aac','-ar','48000']:[]),'-t',String(cameraSeconds),'-c:v','libx264','-pix_fmt','yuv420p',camera]).catch(async()=>{
  // drawtext may be unavailable (no font): fall back to boxes only.
  await ffmpeg(['-f','lavfi','-i',`testsrc2=size=${size}:rate=${fps}`,...camAudio,'-filter_complex','[0:v]drawbox=x=8:y=8:w=60:h=24:color=white:t=fill[v]','-map','[v]',...(camAudio.length?['-map','1:a','-c:a','aac','-ar','48000']:[]),'-t',String(cameraSeconds),'-c:v','libx264','-pix_fmt','yuv420p',camera]);});
 const start=lead+offsetSeconds;if(start<0)throw Error('lead too small for this offset');
 const scrAudio=noAudio==='screen'||noAudio==='both'?[]:['-ss',String(start),'-t',String(screenSeconds*(drift||1)+1),'-i',master];
 const audioChain=`[1:a]${drift?`atempo=${drift},`:''}volume=0.45[sa];anoisesrc=color=white:amplitude=0.02:sample_rate=48000:seed=3[n];[sa][n]amix=inputs=2:duration=first:normalize=0[a]`;
 await ffmpeg(['-f','lavfi','-i',`smptehdbars=size=${screenSize}:rate=30`,...scrAudio,'-filter_complex',`color=c=red:s=40x40:r=30[m];[0:v][m]overlay=x='mod(t*80,W-40)':y=H/2:eval=frame:shortest=1,drawbox=x=12:y=12:w=120:h=36:color=yellow:t=fill[v]${scrAudio.length?`;${audioChain}`:''}`,'-map','[v]',...(scrAudio.length?['-map','[a]','-c:a','libopus','-b:a','64k']:[]),'-t',String(screenSeconds),'-c:v','libx264','-pix_fmt','yuv420p',screen]);
 return {camera,screen,offsetSeconds};
}
