import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {renderBurnedCaptions} from '../editorial-captions.mjs';
import {captionPreviewKey,captionPreviewWindow,renderCaptionPreview} from '../production-caption-preview.mjs';
import {hashFile} from '../editorial-thumbnails.mjs';

const ff=args=>execFileSync('ffmpeg',['-hide_banner','-nostdin','-v','error',...args],{windowsHide:true});
// PSNR (dB) of the frame of `b` at tb against the frame of `a` at ta (ffmpeg prints it on stderr).
function measure(a,ta,b,tb){return spawnSync('ffmpeg',['-hide_banner','-nostdin','-ss',String(ta),'-i',a,'-ss',String(tb),'-i',b,'-frames:v','1','-lavfi','[1:v][0:v]scale2ref[r][m];[m][r]psnr','-f','null','-'],{windowsHide:true,encoding:'utf8'}).stderr;}

test('caption preview window: start on a 0.1 s grid, at most 6 s, inside the video',()=>{
 assert.deepEqual(captionPreviewWindow(2.04,10),{start:2,duration:6});
 assert.deepEqual(captionPreviewWindow(9,10),{start:4,duration:6});
 assert.deepEqual(captionPreviewWindow(0,3.5),{start:0,duration:3.5});
 assert.throws(()=>captionPreviewWindow(10,10));assert.throws(()=>captionPreviewWindow(-1,10));
 const base={sourceSha256:'a'.repeat(64),captionsHash:'h1',styleId:'classic',start:2,duration:6,fontSha256:'f'};
 assert.notEqual(captionPreviewKey(base),captionPreviewKey({...base,captionsHash:'h2'}));assert.notEqual(captionPreviewKey(base),captionPreviewKey({...base,styleId:'boxed'}));assert.equal(captionPreviewKey(base),captionPreviewKey({...base}));assert.notEqual(captionPreviewKey(base),captionPreviewKey({...base,fontSha256:'g'}),'a replaced font invalidates');assert.notEqual(captionPreviewKey(base),captionPreviewKey({...base,sourceSha256:'b'.repeat(64)}),'a new edit invalidates');
});

test('preview frames match the final burned file at the same source time; the source stays intact',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'caption-preview-')),source=join(dir,'source.mp4');
 ff(['-f','lavfi','-i','testsrc2=size=640x360:rate=25','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','10','-c:v','libx264','-crf','18','-c:a','aac',source]);
 const sha256=await hashFile(source),ref={path:source,assetId:'a',versionId:'v',sha256};
 const segments=[{start:1,end:2.6,text:'Primeira legenda'},{start:3,end:4.5,text:'Ação com acentuação'},{start:5,end:7.2,text:'Terceira fala no vídeo'}];
 const final=join(dir,'final.mp4');await renderBurnedCaptions({source:ref,segments,styleId:'highlight',outputPath:final});
 const preview=join(dir,'preview.mp4'),manifest=await renderCaptionPreview({source:ref,segments,styleId:'highlight',startSeconds:2,outputPath:preview});
 assert.equal(await hashFile(source),sha256,'source untouched');assert.deepEqual(manifest.window,{start:2,duration:6});assert.equal(manifest.captions.visible,3);assert.equal(manifest.output.width,640);
 assert(!readdirSync(dir).some(name=>name.endsWith('.work')),'no work folder left');
 const value=out=>Number(/average:([\d.]+|inf)/.exec(out)?.[1]==='inf'?99:/average:([\d.]+)/.exec(out)?.[1]);
 // 3.6 s (caption 2 on screen) is preview 1.6 s. Same burned text → close to the final; clearly different from the clean source.
 // Also 2.8 s (between captions) and 5.1 s (third caption just started): same timing as the final file.
 for(const at of [3.6,2.8,5.1,7.0]){const vsFinal=value(measure(final,at,preview,Math.round((at-2)*10)/10)),vsSource=value(measure(source,at,preview,Math.round((at-2)*10)/10));
  const onScreen=segments.some(item=>at>=item.start&&at<item.end);
  assert(vsFinal>30,`low fidelity at ${at}s: ${vsFinal} dB`);if(onScreen)assert(vsFinal>vsSource+3,`caption at ${at}s should match the final burn (final ${vsFinal} dB vs clean source ${vsSource} dB)`);
  if(process.env.CAPTION_PREVIEW_EVIDENCE)console.log(`t=${at}s onScreen=${onScreen} psnr(final)=${vsFinal.toFixed(1)}dB psnr(source)=${vsSource.toFixed(1)}dB`);}
 const ctl=new AbortController();const pending=renderCaptionPreview({source:ref,segments,styleId:'classic',startSeconds:0,outputPath:join(dir,'canceled.mp4'),signal:ctl.signal});ctl.abort();
 await assert.rejects(pending);assert(!existsSync(join(dir,'canceled.mp4')),'canceled preview leaves no file');
});
