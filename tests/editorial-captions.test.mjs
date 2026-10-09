import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,readdirSync,readFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildAss,captionGeometry,captionsFromTranscript,captionsHash,captionsToSrt,CAPTION_STYLE_IDS,fontNames,getCaptionCapabilities,layoutCaptionText,missingGlyphs,parseSrt,renderBurnedCaptions,validateCaptionSegments} from '../editorial-captions.mjs';
import {hashFile,parseFontMetrics,probeMedia,resolveFont} from '../editorial-thumbnails.mjs';
import {createWhisperTranscriber} from '../editorial-transcribe.mjs';

const root=mkdtempSync(join(tmpdir(),'captions-'));
const ff=args=>execFileSync('ffmpeg',['-nostdin','-v','error','-y',...args]);
const video=(name,{size='320x568',seconds=2,audio=true,extra=[]}={})=>{const file=join(root,name);ff(['-f','lavfi','-i',`testsrc2=size=${size}:rate=24`,...(audio?['-f','lavfi','-i','sine=frequency=440:sample_rate=48000']:[]),'-t',String(seconds),'-c:v','libx264','-pix_fmt','yuv420p',...(audio?['-c:a','aac']:[]),...extra,file]);return file;};
const source=async file=>({path:file,assetId:'asset',versionId:'v1',sha256:await hashFile(file)});

test('caption rules: ordered, bounded, no overlap, no ASS markup; hash is stable and SRT round-trips',()=>{
 const ok=validateCaptionSegments([{start:0,end:1,text:'  Olá   mundo '},{start:1,end:2.5,text:'Linha 1\nLinha 2'}],3);
 assert.deepEqual(ok,[{start:0,end:1,text:'Olá mundo'},{start:1,end:2.5,text:'Linha 1\nLinha 2'}]);
 for(const [bad,pattern] of [[[{start:1,end:0.5,text:'x'}],/depois do início/],[[{start:0,end:1,text:'a'},{start:0.5,end:1.5,text:'b'}],/antes do fim da anterior/],[[{start:0,end:4,text:'x'}],/depois do fim do vídeo/],[[{start:0,end:1,text:'{\\an8}x'}],/não são aceitos/],[[{start:0,end:1,text:'a\nb\nc'}],/2 linhas/],[[{start:0,end:1,text:'   '}],/vazio/],[[{start:0,end:0.1,text:'x'}],/menos de/],[[{start:0,end:1,text:'x',style:'y'}],/campos inválidos/]])
  assert.throws(()=>validateCaptionSegments(bad,3),pattern);
 assert.equal(captionsHash(ok),captionsHash(structuredClone(ok)));assert.notEqual(captionsHash(ok),captionsHash([{...ok[0],text:'Olá'},ok[1]]));
 const srt=captionsToSrt(ok);assert.match(srt,/^﻿1\r\n00:00:00,000 --> 00:00:01,000\r\nOlá mundo/);
 assert.deepEqual(parseSrt(srt,3).map(s=>s.text),['Olá mundo','Linha 1 Linha 2']);
 assert.deepEqual(parseSrt('1\n00:00:00,500 --> 00:00:01,250\n<b>Ação</b> <font color="red">já</font>\n\n2\n00:00:01,300 --> 00:00:02,000\n\n',3),[{start:0.5,end:1.25,text:'Ação já'}],'formatting tags dropped, empty cues ignored');
 assert.throws(()=>parseSrt('1\nsem tempo\ntexto',3),/sem tempo/);
});

test('transcript → first caption version: honest warnings, proportional split marked, nothing rewritten',()=>{
 const long='esta frase é bem longa e precisa ser dividida em partes menores para caber na tela do vídeo vertical sem cortar nada';
 const result=captionsFromTranscript({timing:'sentences',segments:[{start:0,end:6,text:long},{start:6.2,end:7,text:'Obrigado {por} assistir'}]},8);
 assert.deepEqual(result.warnings,['whisper-approximate','sentence-timing','split-proportional']);
 assert(result.segments.length>=3);assert.equal(result.segments.slice(0,-1).map(s=>s.text).join(' '),long,'words kept verbatim and in order');
 assert.equal(result.segments.at(-1).text,'Obrigado por assistir','only ASS-breaking braces are removed');
 assert(result.segments.every((s,i,a)=>!i||s.start>=a[i-1].end));
 assert.deepEqual(captionsFromTranscript({timing:'words',segments:[]},5),{segments:[],warnings:['whisper-approximate','no-speech']});
});

test('three generic styles scale with the displayed frame; layout measured in the real font refuses overflow instead of cutting',async()=>{
 const font=await resolveFont(),buffer=readFileSync(font.path),metrics=parseFontMetrics(buffer),names=fontNames(buffer);
 assert.deepEqual(CAPTION_STYLE_IDS,['classic','boxed','highlight']);assert(names.family.length>1);
 const portrait=captionGeometry('classic',{width:1080,height:1920}),landscape=captionGeometry('classic',{width:1920,height:1080});
 assert.equal(portrait.fontSize,landscape.fontSize,'size follows the shorter side');assert(captionGeometry('highlight',{width:1080,height:1920}).marginV>portrait.marginV);
 assert.equal(layoutCaptionText('Olá, edição automática',{metrics,fontSize:67,maxLineWidth:929}).ok,true);
 assert.equal(layoutCaptionText('palavra '.repeat(30).trim(),{metrics,fontSize:67,maxLineWidth:929}).ok,false);
 assert.throws(()=>buildAss({segments:[{start:0,end:1,text:'palavra '.repeat(30).trim()}],styleId:'classic',width:1080,height:1920,font:names,metrics}),e=>e.code==='layout_overflow');
 const ass=buildAss({segments:[{start:0,end:1.234,text:'Ação\nCoração'}],styleId:'boxed',width:1080,height:1920,font:names,metrics});
 assert.match(ass,/PlayResX: 1080\nPlayResY: 1920/);assert.match(ass,/Dialogue: 0,0:00:00\.00,0:00:01\.23,Caption,,0,0,0,,Ação\\NCoração/);assert.match(ass,new RegExp(`Style: Caption,${names.family}`));
 assert.deepEqual(missingGlyphs([{start:0,end:1,text:'ção ÁÉÍÓÚ ãõ ç'}],metrics),[],'Portuguese glyphs present');
});

test('real FFmpeg/libass burns approved captions into a new MP4: audio copied, original untouched, rotation respected',async t=>{
 const caps=await getCaptionCapabilities();if(!caps.available){t.skip(caps.reasons.join(' '));return;}
 const input=video('portrait.mp4'),before=readFileSync(input),ref=await source(input),out=join(root,'burned.mp4');let events=0;
 const manifest=await renderBurnedCaptions({source:ref,segments:[{start:0.1,end:0.9,text:'Olá, edição'},{start:1,end:1.9,text:'Ação e coração'}],styleId:'classic',outputPath:out,onProgress:()=>events++});
 assert.deepEqual([manifest.audio,manifest.output.width,manifest.output.height,manifest.output.hasAudio,manifest.source.preserved,manifest.requiresAi],['copied',320,568,true,true,false]);
 assert.equal(manifest.output.sha256,await hashFile(out));assert(Math.abs(manifest.output.durationSeconds-2)<0.15);assert(events>=1);
 assert.deepEqual(readFileSync(input),before,'original never written');
 const original=execFileSync('ffmpeg',['-v','error','-ss','0.5','-i',input,'-frames:v','1','-f','rawvideo','-pix_fmt','gray','-']),captioned=execFileSync('ffmpeg',['-v','error','-ss','0.5','-i',out,'-frames:v','1','-f','rawvideo','-pix_fmt','gray','-']);
 assert.notDeepEqual(captioned,original,'text is burned into the image');
 const audioOf=file=>execFileSync('ffmpeg',['-v','error','-i',file,'-map','0:a:0','-c','copy','-f','adts','-']);assert.deepEqual(audioOf(out),audioOf(input),'audio stream bytes preserved');
 await assert.rejects(()=>renderBurnedCaptions({source:ref,segments:[{start:0,end:1,text:'x'}],styleId:'classic',outputPath:out}),e=>e.code==='output_exists');
 await assert.rejects(()=>renderBurnedCaptions({source:ref,segments:[{start:0,end:1,text:'x'}],styleId:'loja-x',outputPath:join(root,'style.mp4')}),e=>e.code==='invalid_style');
 await assert.rejects(()=>renderBurnedCaptions({source:{...ref,sha256:'0'.repeat(64)},segments:[{start:0,end:1,text:'x'}],styleId:'classic',outputPath:join(root,'changed.mp4')}),e=>e.code==='source_changed');
 await assert.rejects(()=>renderBurnedCaptions({source:ref,segments:[{start:0,end:1,text:'Bom dia 🎉'}],styleId:'classic',outputPath:join(root,'emoji.mp4')}),e=>e.code==='unsupported_glyph'&&e.details.missing.includes('🎉'));
 // A phone video stored landscape with a 90° display rotation is captioned upright at the displayed size.
 const base=video('base.mp4',{size:'320x180'}),rotated=join(root,'rot90.mp4');ff(['-display_rotation:v:0','90','-i',base,'-c','copy',rotated]);
 const shown=await probeMedia(rotated),rot=await renderBurnedCaptions({source:await source(rotated),segments:[{start:0,end:1,text:'Em pé'}],styleId:'highlight',outputPath:join(root,'rot-out.mp4')});
 assert.deepEqual([rot.output.width,rot.output.height],[shown.display.width,shown.display.height]);assert(rot.output.height>rot.output.width);
 // Silent video: no audio track is invented.
 const silent=await renderBurnedCaptions({source:await source(video('silent.mp4',{audio:false})),segments:[{start:0,end:1,text:'Sem áudio'}],styleId:'boxed',outputPath:join(root,'silent-out.mp4')});assert.deepEqual([silent.audio,silent.output.hasAudio],['none',false]);
});

test('cancel stops FFmpeg and leaves no output or work directory',async t=>{
 if(!(await getCaptionCapabilities()).available){t.skip('libass unavailable');return;}
 const folder=mkdtempSync(join(root,'cancel-')),input=video('long.mp4',{size:'1280x720',seconds:20}),controller=new AbortController(),out=join(folder,'out.mp4');
 const pending=renderBurnedCaptions({source:await source(input),segments:[{start:0,end:5,text:'Cancelar'}],styleId:'classic',outputPath:out,signal:controller.signal,onProgress:()=>controller.abort()});
 setTimeout(()=>controller.abort(),1500);
 await assert.rejects(pending,e=>e.code==='cancelled');assert.deepEqual(readdirSync(folder),[],'no partial file and no work directory');
});

const whisper=createWhisperTranscriber(),whisperReady=(await whisper.capabilities()).available&&process.platform==='win32';
test('real local Whisper + Windows speech → reviewed first version → burned MP4 (approximate timing stays labelled)',{skip:whisperReady?false:'whisper.cpp or Windows speech unavailable'},async t=>{
 const wav=join(root,'speech.wav');
 const script="Add-Type -AssemblyName System.Speech;$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;$v=$s.GetInstalledVoices()|Where-Object{$_.VoiceInfo.Culture.Name -eq 'pt-BR'}|Select-Object -First 1;if(-not $v){exit 3};$s.SelectVoice($v.VoiceInfo.Name);$s.SetOutputToWaveFile($env:SPEECH_OUT);$s.Speak($env:SPEECH_TEXT);$s.Dispose()";
 const spoken=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{env:{...process.env,SPEECH_TEXT:'Hoje vamos falar de edição automática no computador.',SPEECH_OUT:wav},windowsHide:true});
 if(spoken.status!==0||!existsSync(wav)){t.skip('pt-BR Windows voice unavailable');return;}
 const input=join(root,'speech.mp4');ff(['-f','lavfi','-i','testsrc2=size=360x640:rate=24','-i',wav,'-shortest','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',input]);
 const media=await probeMedia(input),transcript=await whisper.transcribe({inputPath:input,duration:media.durationSeconds,language:'pt'});
 const first=captionsFromTranscript(transcript,media.durationSeconds);assert(first.segments.length>=1,JSON.stringify(transcript.segments));assert(first.warnings.includes('whisper-approximate'));
 assert.match(first.segments.map(s=>s.text).join(' ').toLowerCase(),/edi[çc][ãa]o/);
 const out=join(root,'speech-captioned.mp4'),manifest=await renderBurnedCaptions({source:await source(input),segments:first.segments,styleId:'boxed',outputPath:out});
 assert.deepEqual([manifest.audio,manifest.output.hasAudio,manifest.captions.count],['copied',true,first.segments.length]);assert(statSync(out).size>0);
});
