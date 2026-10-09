import test from 'node:test';
import assert from 'node:assert/strict';
import {createRemotionAnimator,installedBrowsers,resolveAnimationBrowser} from '../editorial-animate.mjs';
import {parseWhisperJson} from '../editorial-transcribe.mjs';
import {cutReview} from '../editorial-smart-edit.mjs';

test('the animation browser is an explicit installed path, an env override or an honest absence — never a download',async()=>{
  const env={ProgramFiles:'C:\\PF','ProgramFiles(x86)':'C:\\PF86',LOCALAPPDATA:'C:\\Local'};
  const list=installedBrowsers(env,'win32');assert.equal(list[0],'C:\\PF\\Google\\Chrome\\Application\\chrome.exe');assert(list.some(item=>item.endsWith('msedge.exe')));
  assert.deepEqual(resolveAnimationBrowser({env,platform:'win32',exists:path=>path===list[1]}),{path:list[1],source:'system'});
  assert.deepEqual(resolveAnimationBrowser({env:{...env,MAINSAGENTS_BROWSER:'D:\\chrome.exe'},platform:'win32',exists:()=>true}),{path:'D:\\chrome.exe',source:'env'});
  assert.match(resolveAnimationBrowser({browserExecutable:'X:\\nope.exe',exists:()=>false}).reason,/não existe/);
  const missing=resolveAnimationBrowser({env,platform:'win32',exists:()=>false});assert.equal(missing.path,null);assert.match(missing.reason,/não baixa navegador/);
  let rendered;const animator=createRemotionAnimator({resolveBrowser:()=>({path:'C:\\chrome.exe',source:'system'}),capabilities:async options=>({available:true,reasons:[],seen:options}),render:async input=>{rendered=input;return {}}});
  assert.deepEqual((await animator.animationCapabilities()).browser,{path:'C:\\chrome.exe',source:'system'});
  await animator.animate({inputPath:'a.mp4'});assert.equal(rendered.browserExecutable,'C:\\chrome.exe');
  const absent=createRemotionAnimator({resolveBrowser:()=>({path:null,source:'none',reason:'Nenhum Chrome'}),capabilities:async()=>{throw Error('must not probe')},render:async()=>{throw Error('must not render')}});
  assert.deepEqual(await absent.animationCapabilities(),{available:false,reasons:['Nenhum Chrome'],browser:{path:null,source:'none',reason:'Nenhum Chrome'}});
  await assert.rejects(()=>absent.animate({}),/unavailable: Nenhum Chrome/);
});

test('whisper word tokens tighten sentence bounds around pauses and audio silences decide whether a cut removes sound',()=>{
  // Real whisper.cpp shape: the sentence and its final "." token stretch over the following pause.
  const parsed=parseWhisperJson({transcription:[{offsets:{from:0,to:3580},text:' Hoje vamos falar de edição.',tokens:[{text:'[_BEG_]',offsets:{from:0,to:0}},{text:' Hoje',offsets:{from:110,to:450}},{text:' edição',offsets:{from:1810,to:2230}},{text:'.',offsets:{from:2740,to:3580}}]},{offsets:{from:3580,to:6000},text:' Tchau.',tokens:[]}]},10);
  assert.deepEqual(parsed.segments,[{start:0.11,end:2.38,text:'Hoje vamos falar de edição.'},{start:3.58,end:6,text:'Tchau.'}]);
  assert.deepEqual(parsed.speech,[{start:0.11,end:0.45},{start:1.81,end:2.23}]);
  const kept=[{start:0,end:2.42},{start:3.67,end:10}],lines=[{start:0.11,end:2.38,text:'Hoje'},{start:3.69,end:8.89,text:'drifted sentence'}];
  const pause=cutReview(kept,10,lines,[{start:2.22,end:3.87}]);assert.deepEqual([pause[0].basis,pause[0].soundSeconds,pause[0].speechSeconds,pause[0].speech],['audio',0,0,[]]);
  const widened=cutReview([{start:0,end:2},{start:5,end:10}],10,lines,[{start:2.22,end:3.87}]);assert.deepEqual([widened[0].soundSeconds,widened[0].speech],[1.35,['Hoje','drifted sentence']]);
  assert.equal(cutReview(kept,10,lines)[0].basis,'transcript');assert.equal(cutReview(kept,10,[])[0].basis,'none');
});

test('Remotion native binaries resolve outside app.asar in source and packaged layouts',async()=>{
  const {resolveBinariesDirectory,resolveFfprobe}=await import('../editorial-remotion.mjs');const {existsSync}=await import('node:fs');
  const directory=resolveBinariesDirectory();assert(directory&&existsSync(directory)&&!/[\\/]app\.asar[\\/]/.test(directory),String(directory));
  assert(!/[\\/]app\.asar[\\/]/.test(resolveFfprobe()));assert.equal(resolveBinariesDirectory('X:\\missing-binaries'),null);
});

test('a sentence crossing a removed pause becomes one caption without duplicated or lost text',async()=>{
  const {remapTranscript,toSrt}=await import('../editorial-smart-edit.mjs');
  const kept=[{start:0,end:4},{start:6,end:10}],lines=remapTranscript([{start:1,end:9,text:'Uma frase longa atravessa a pausa'},{start:9.5,end:10,text:'Fim'}],kept);
  assert.deepEqual(lines,[{start:1,end:7,text:'Uma frase longa atravessa a pausa'},{start:7.5,end:8,text:'Fim'}]);
  assert.equal((toSrt(lines).match(/Uma frase longa/g)??[]).length,1);
  // Speech only inside the removed part disappears; text kept on both sides is never dropped.
  assert.deepEqual(remapTranscript([{start:4.2,end:5.8,text:'removida'},{start:3,end:7,text:'mantida'}],kept),[{start:3,end:5,text:'mantida'}]);
});

test('special tokens, invalid token offsets and non-speech markers never become speech',()=>{
  const parsed=parseWhisperJson({transcription:[
    {offsets:{from:0,to:2000},text:' Olá.',tokens:[{text:'[_TT_150]',offsets:{from:0,to:50}},{text:' Olá',offsets:{from:200,to:600}},{text:' bad',offsets:{from:'x',to:900}},{text:'.',offsets:{from:600,to:1900}}]},
    {offsets:{from:2000,to:2600},text:' [Música]',tokens:[{text:' [Música]',offsets:{from:2000,to:2600}}]},
    {offsets:{from:NaN,to:3000},text:'quebrado',tokens:[]},
  ]},5);
  assert.deepEqual(parsed.segments,[{start:0.2,end:0.75,text:'Olá.'}]);assert.deepEqual(parsed.speech,[{start:0.2,end:0.6}]);
});
