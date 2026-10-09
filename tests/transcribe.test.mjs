import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {runMediaProcess} from '../editorial-media.mjs';
import {inspectLocalAsset} from '../editorial-local-files.mjs';
import {createWhisperTranscriber,parseWhisperJson,resolveWhisper} from '../editorial-transcribe.mjs';

const inspect=path=>inspectLocalAsset(path,{stabilityMs:0});
test('whisper JSON parsing keeps timed speech and drops non-speech markers and invalid offsets',()=>{
  const parsed=parseWhisperJson({result:{language:'pt'},transcription:[{offsets:{from:2000,to:3500},text:' Segunda frase.'},{offsets:{from:0,to:1800},text:' Olá   pessoal. '},{offsets:{from:3600,to:4000},text:' [Música] '},{offsets:{from:4000,to:4100},text:' (risos)'},{offsets:{from:5000,to:4000},text:'invalid'},{offsets:{from:9000,to:9500},text:'past the end'},{offsets:{from:4200,to:4800},text:' ...'}]},6);
  assert.equal(parsed.language,'pt');
  assert.deepEqual(parsed.segments,[{start:0,end:1.8,text:'Olá pessoal.'},{start:2,end:3.5,text:'Segunda frase.'}]);
});
test('missing tools or an unknown model are reported, never replaced by a simulated transcript',async()=>{
  const root=mkdtempSync(join(tmpdir(),'whisper-tools-'));
  assert.equal(resolveWhisper({directories:[root],cli:undefined,model:undefined})?.root===root,false);
  writeFileSync(join(root,'whisper-cli.exe'),'not really');writeFileSync(join(root,'ggml-base.bin'),'tampered model');
  const transcriber=createWhisperTranscriber({directories:[root]}),capabilities=await transcriber.capabilities();
  assert.equal(capabilities.available,false);assert.match(capabilities.reasons[0],/Modelo não reconhecido/);
  await assert.rejects(()=>transcriber.transcribe({inputPath:join(root,'x.mp4'),duration:2,language:'pt'}),/unavailable/);
  await assert.rejects(()=>transcriber.transcribe({inputPath:join(root,'x.mp4'),duration:2,language:'pt;rm'}),/language/);
});

const real=createWhisperTranscriber(),available=(await real.capabilities()).available&&process.platform==='win32';
async function speech(path,parts){
  // Windows' built-in offline voice. Text goes through an environment variable, never the command line.
  const script="Add-Type -AssemblyName System.Speech;$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;$v=$s.GetInstalledVoices()|Where-Object{$_.VoiceInfo.Culture.Name -eq 'pt-BR'}|Select-Object -First 1;if(-not $v){exit 3};$s.SelectVoice($v.VoiceInfo.Name);$b=New-Object System.Speech.Synthesis.PromptBuilder([System.Globalization.CultureInfo]'pt-BR');$b.StartVoice($v.VoiceInfo);foreach($p in ($env:SPEECH_PARTS -split '\\|')){$b.AppendText($p);$b.AppendBreak([TimeSpan]::FromMilliseconds(1400))};$b.EndVoice();$s.SetOutputToWaveFile($env:SPEECH_OUT);$s.Speak($b);$s.Dispose()";
  const {spawnSync}=await import('node:child_process');const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{env:{...process.env,SPEECH_PARTS:parts.join('|'),SPEECH_OUT:path},windowsHide:true});
  return result.status===0;
}
test('real whisper.cpp transcribes a local video once, caches it per version and suggests unselected possible retakes',{skip:available?false:'whisper.cpp or Windows speech unavailable'},async()=>{
  const root=mkdtempSync(join(tmpdir(),'whisper-real-')),wav=join(root,'speech.wav'),input=join(root,'original.mp4'),dbPath=join(root,'state.sqlite');
  if(!await speech(wav,['Hoje vamos falar de edição','Hoje vamos falar de edição automática no computador','Obrigado por assistir']))return;
  await runMediaProcess('ffmpeg',['-nostdin','-v','error','-n','-f','lavfi','-i','testsrc2=size=160x90:rate=24','-i',wav,'-shortest','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',input]);
  const file=await inspect(input),original=readFileSync(input),at=new Date().toISOString();let runs=0;
  const transcriber={capabilities:real.capabilities,transcribe:input=>{runs++;return real.transcribe(input)}};
  const bridge=createContentWorkflowBridge({dbPath,getCurrentProfile:()=>'owner',mediaOptions:{inspect,transcriber,animate:undefined}});const db=new DatabaseSync(dbPath);
  try{
    db.prepare('INSERT INTO editorial_state VALUES (?,?,?,?)').run('owner',1,JSON.stringify({schemaVersion:1,topics:[],contents:[{id:'content',workspaceId:'space',title:'Fala'}],runs:[],artifacts:[],approvals:[],assets:[{id:'source',workspaceId:'space',contentId:'content',name:file.name,kind:'video',role:'source',status:'available',currentVersionId:'v1',versions:[{id:'v1',...file,createdAt:at}],createdAt:at,updatedAt:at}]}),at);
    const ref={contentId:'content',assetId:'source',versionId:'v1',sha256:file.sha256};
    assert.equal((await bridge.media.capabilities()).transcribe,true);
    const {transcript}=await bridge.media.transcribe('owner',{...ref,language:'pt'});
    assert.equal(transcript.origin,'local-whisper');assert.equal(transcript.model,'ggml-base');assert(transcript.segments.length>=2,JSON.stringify(transcript.segments));
    const text=transcript.segments.map(item=>item.text).join(' ').toLowerCase();
    assert.match(text,/edi[çc][ãa]o/);assert.match(text,/assistir/);
    assert(transcript.segments.every((item,index,list)=>item.end>item.start&&(!index||item.start>=list[index-1].start)));
    assert.equal((await bridge.media.transcribe('owner',{...ref,language:'pt'})).transcript.cached,true);assert.equal(runs,1);
    const {analysis}=await bridge.media.analyze('owner',{...ref,transcript:'local',language:'pt',options:{thresholdDb:-40,minDuration:0.8}});
    assert.equal(runs,1);assert.equal(analysis.transcript.origin,'local-whisper');assert(!analysis.limitations.includes('transcriptUnavailable'));
    const retakes=analysis.candidates.filter(item=>item.kind==='possibleRetake');
    assert.equal(retakes.length,1,JSON.stringify(analysis.transcript.segments));assert.equal(retakes[0].selected,false);assert(retakes[0].start<1);
    // A payload claiming to be a local transcription is still treated as imported text.
    const imported=await bridge.media.analyze('owner',{...ref,transcript:{origin:'local-whisper',segments:[{start:0,end:1,text:'texto colado'}]}});
    assert.equal(imported.analysis.transcript.origin,'imported');
    await assert.rejects(()=>bridge.media.transcribe('owner',{...ref,sha256:'0'.repeat(64)}),/source version changed/);
    // Export cutting the first phrase: subtitles follow the edited timing and the review flags speech inside the cut.
    const first=transcript.segments[0],total=analysis.metadata.duration;
    const preview=await bridge.media.plan('owner',{...ref,plan:{segments:[{start:Math.min(total-0.5,first.end+0.05),end:total}]}});
    const revision=db.prepare('SELECT revision FROM editorial_state').get().revision;
    const queued=bridge.media.enqueue('owner',{mode:'advanced',authorize:true,revision,requestKey:'cut-first',...ref,plan:preview.plan,planHash:preview.planHash}).job;
    const deadline=Date.now()+30000;while(Date.now()<deadline&&!['succeeded','failed'].includes(bridge.media.list('owner').find(item=>item.id===queued.id).status))await new Promise(resolve=>setTimeout(resolve,50));
    const done=bridge.media.list('owner').find(item=>item.id===queued.id);assert.equal(done.status,'succeeded',done.error);
    const state=JSON.parse(db.prepare('SELECT state_json FROM editorial_state').get().state_json),srt=state.assets.find(item=>item.subtitlesForJobId===queued.id);
    assert(srt,'subtitle asset attached');assert.equal(srt.kind,'document');assert.match(srt.name,/\.srt$/);
    const srtText=readFileSync(srt.versions[0].path,'utf8');assert.match(srtText,/^﻿1\r\n00:00:0\d,\d{3} --> /);assert.match(srtText,/assistir/i);assert.doesNotMatch(srtText,/^Hoje vamos falar de edição\.?\r$/m);
    const review=await bridge.media.review('owner',{jobId:queued.id});
    assert.equal(review.subtitles.assetId,srt.id);assert(review.cuts[0].speechSeconds>1);assert.match(review.cuts[0].speech[0],/edi/i);
    await assert.rejects(()=>bridge.media.subtitles('owner',{jobId:queued.id}),/already exist/);
    assert.deepEqual(readFileSync(input),original);
  }finally{await bridge.close();db.close();}
});
