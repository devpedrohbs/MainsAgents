import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pairFixture} from './pair-fixture.mjs';
import {measureOffset,correlate,onsetEnvelope} from '../source-sync.mjs';
import {probeVideo} from '../editorial-media.mjs';

/**
 * Real FFmpeg decode + local correlation on synthetic recordings with a KNOWN offset. The common signal is non-periodic and
 * the screen copy has another gain, added noise and another codec (AAC vs Opus), so a match is not byte equality.
 * Tolerance: 25 ms (about half a frame at 24 fps); the measured bias of AAC-vs-Opus priming here is about −10 ms.
 */
const dir=mkdtempSync(join(tmpdir(),'sync-'));
const measure=async options=>{const f=await pairFixture(dir,options),[a,b]=[await probeVideo(f.camera),await probeVideo(f.screen)];return measureOffset({camera:{path:f.camera,duration:a.duration,hasAudio:a.hasAudio},screen:{path:f.screen,duration:b.duration,hasAudio:b.hasAudio}});};

test('known positive, negative and partial-overlap offsets are measured with a unique peak and checked for drift', async () => {
 for(const [name,options] of [['pos',{offsetSeconds:2.4}],['neg',{offsetSeconds:-1.7}],['partial',{offsetSeconds:15,cameraSeconds:40,screenSeconds:40}]]){
  const result=await measure({...options,name});
  assert.equal(result.status,'measured',`${name}: ${JSON.stringify(result)}`);
  assert.ok(Math.abs(result.offsetSeconds-options.offsetSeconds)<=0.025,`${name}: ${result.offsetSeconds}`);
  assert.ok(Math.abs(result.projectedDriftSeconds)<=0.04,`${name}: drift ${result.projectedDriftSeconds}`);
  assert.equal(result.windows.length,2);
 }
});

test('drift, periodic or steady audio, missing audio and short overlap are never reported as measured', async () => {
 const drift=await measure({offsetSeconds:1.2,drift:1.002,name:'drift'});assert.equal(drift.status,'drift');assert.ok(Math.abs(drift.projectedDriftSeconds)>0.04);
 assert.equal((await measure({offsetSeconds:1,periodic:true,name:'periodic'})).status,'inconclusive');
 assert.equal((await measure({offsetSeconds:1,tone:true,name:'tone'})).status,'inconclusive');
 assert.deepEqual(await measure({offsetSeconds:1,noAudio:'screen',name:'noaudio'}),{status:'no-common-audio',reason:'screen-no-audio'});
 assert.deepEqual(await measure({offsetSeconds:1,noAudio:'camera',name:'nocam'}),{status:'no-common-audio',reason:'camera-no-audio'});
 const short=await measure({offsetSeconds:30,cameraSeconds:40,screenSeconds:40,name:'short'});assert.equal(short.status,'inconclusive');assert.equal(short.reason,'overlap-short');
});

test('the correlation is cooperative and cancelable (never blocks the host loop for long)', async () => {
 const a=new Float64Array(20000).map((_,i)=>Math.sin(i*0.37)*Math.cos(i*0.011)),b=a.slice();
 const controller=new AbortController();let ticks=0;const timer=setInterval(()=>ticks++,1);
 const run=correlate(a,b,{minLag:-6000,maxLag:6000,minOverlap:2000,exclusion:50,signal:controller.signal});
 setTimeout(()=>controller.abort(),30);
 await assert.rejects(run,/cancelada/);clearInterval(timer);assert.ok(ticks>0,'the event loop ran while correlating');
 const flat=onsetEnvelope(new Int16Array(16000));assert.equal(flat.std,0);
});
