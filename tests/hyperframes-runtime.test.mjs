import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {compositionHtml,motionSpec,createHyperframesEngine,digest,safeFile,doctorReport} from '../hyperframes-engine.mjs';
import {runMediaProcess} from '../editorial-media.mjs';
const spec={title:'Local motion',text:'Input | Study | Output',kind:'diagram',accent:'#22bbaa',background:'#121820',duration:2,width:640,height:360,fps:24};
test('motion accepts only bounded declarative data; hostile markup remains escaped text',()=>{
 assert.throws(()=>motionSpec({...spec,accent:'red; background:url(http://localhost)'}),/color/);
 assert.throws(()=>motionSpec({...spec,duration:Infinity}),/range/);
 const html=compositionHtml({...spec,title:'</script><script>fetch("http://localhost")</script>'},'/* trusted runtime */');assert.ok(html.includes('&lt;/script&gt;'));assert.equal((html.match(/<script>/g)||[]).length,2);assert.ok(html.includes("default-src 'none'"));
});
test('managed artifact roots reject traversal',async()=>{const root=await mkdtemp(join(tmpdir(),'hf-root-'));try{await assert.rejects(safeFile(root,'../'),/escaped/);}finally{await rm(root,{recursive:true,force:true});}});
const enginePath=process.env.MAINSAGENTS_HYPERFRAMES_HOME;
test('doctor report survives stderr noise and missing tools stay an actionable error',async()=>{
 const noisy="'docker' is not recognized as an internal or external command,\n"+JSON.stringify({ok:false,checks:[{name:'Node.js',ok:true},{name:'FFmpeg',ok:false},{name:'FFprobe',ok:false},{name:'Chrome',ok:true}]});
 assert.deepEqual(doctorReport(noisy).checks.map(c=>c.ok),[true,false,false,true]);
 const root=await mkdtemp(join(tmpdir(),'hf-doctor-'));try{
  const {mkdir,writeFile}=await import('node:fs/promises');await mkdir(join(root,'node_modules/hyperframes'),{recursive:true});await mkdir(join(root,'node_modules/gsap/dist'),{recursive:true});
  await writeFile(join(root,'node_modules/hyperframes/package.json'),JSON.stringify({version:'0.8.212'}));await writeFile(join(root,'node_modules/gsap/dist/gsap.min.js'),'');
  const status=await createHyperframesEngine({root,run:async()=>noisy}).status();
  assert.equal(status.status,'error');assert.match(status.message,/FFmpeg, FFprobe/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('REAL HyperFrames renders H264, exports a verified report, and decoded frames demonstrate motion',{skip:!enginePath||!existsSync(join(enginePath,'node_modules/hyperframes/package.json'))},async()=>{
 const root=await mkdtemp(join(tmpdir(),'hf-real-'));try{const engine=createHyperframesEngine({root:enginePath});const report=await engine.render(join(root,'project'),spec);assert.equal(report.engine,'hyperframes');assert.equal(report.metadata.videoCodec,'h264');assert.equal(report.metadata.hasAudio,false);
 for(const [name,time] of [['early',0],['late',1.3]])await runMediaProcess('ffmpeg',['-v','error','-ss',String(time),'-i',join(root,'project/preview.mp4'),'-frames:v','1',join(root,`${name}.png`)]);
 assert.notEqual(digest(await readFile(join(root,'early.png'))),digest(await readFile(join(root,'late.png'))));assert.equal(JSON.parse(await readFile(join(root,'project/report.json'),'utf8')).sourceSha256,report.sourceSha256);
 }finally{await rm(root,{recursive:true,force:true});}
});
