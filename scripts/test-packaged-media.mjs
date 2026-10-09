// Packaged-engine smoke: loads the media engine FROM release/win-unpacked/resources/app.asar inside Electron and runs a
// real local journey with the packaged resources (asar.unpacked Remotion bundle/compositor, resources/tools/whispercpp).
// Does not launch the installed app or touch any personal profile. Run after `electron-builder --win dir`:
//   npx electron scripts/test-packaged-media.mjs [release/win-unpacked]
import {app} from 'electron';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';

const root=resolve(import.meta.dirname,'..'),packaged=resolve(root,process.argv.find(arg=>arg.includes('win-unpacked'))??'release/win-unpacked'),resources=join(packaged,'resources'),asar=join(resources,'app.asar');
const out=resolve(root,'.mainsagents-workspaces/packaged-media',String(Date.now()));mkdirSync(out,{recursive:true});app.setPath('userData',join(out,'electron'));
const load=name=>import(pathToFileURL(join(asar,name)).href);
app.whenReady().then(async()=>{const log=[];try{
  for(const path of [asar,join(resources,'app.asar.unpacked','dist','remotion','index.html'),join(resources,'app.asar.unpacked','node_modules','@remotion','compositor-win32-x64-msvc','ffprobe.exe'),join(resources,'tools','whispercpp','bin','Release','whisper-cli.exe'),join(resources,'tools','whispercpp','ggml-base.bin')])assert(existsSync(path),`missing packaged ${path}`);
  const {createContentWorkflowBridge}=await load('content-workflow-bridge.mjs'),{createRemotionAnimator}=await load('editorial-animate.mjs'),{createWhisperTranscriber}=await load('editorial-transcribe.mjs');
  const {inspectLocalAsset}=await load('editorial-local-files.mjs'),{runMediaProcess,probeVideo}=await load('editorial-media.mjs'),{resolveFfprobe}=await load('editorial-remotion.mjs'),{unpackedPath}=await load('editorial-animate.mjs');
  // editorial-remotion resolves the compositor ffprobe inside app.asar (not spawnable); the animator passes the unpacked copy.
  const ffprobe=unpackedPath(resolveFfprobe());assert(ffprobe.includes('app.asar.unpacked')&&existsSync(ffprobe),`unpacked ffprobe expected, got ${ffprobe}`);log.push(`remotion ffprobe ${ffprobe}`);
  const animator=createRemotionAnimator({bundleDir:join(resources,'app.asar.unpacked','dist','remotion')}),transcriber=createWhisperTranscriber({directories:[join(resources,'tools','whispercpp')]});
  const engine=await animator.animationCapabilities();assert.equal(engine.available,true,engine.reasons.join(' '));log.push(`browser ${engine.browser.source} ${engine.browser.path}`);
  const whisper=await transcriber.capabilities();assert.equal(whisper.available,true,whisper.reasons.join(' '));log.push(`whisper ${whisper.model} from resources/tools`);
  const speech=join(out,'speech.wav'),input=join(out,'original.mp4'),inspect=path=>inspectLocalAsset(path,{stabilityMs:0});
  const voice=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Add-Type -AssemblyName System.Speech;$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;$v=$s.GetInstalledVoices()|Where-Object{$_.VoiceInfo.Culture.Name -eq 'pt-BR'}|Select-Object -First 1;if(-not $v){exit 3};$b=New-Object System.Speech.Synthesis.PromptBuilder([System.Globalization.CultureInfo]'pt-BR');$b.StartVoice($v.VoiceInfo);foreach($p in ($env:SPEECH_PARTS -split '\\|')){$b.AppendText($p);$b.AppendBreak([TimeSpan]::FromMilliseconds(1600))};$b.EndVoice();$s.SetOutputToWaveFile($env:SPEECH_OUT);$s.Speak($b);$s.Dispose()"],{env:{...process.env,SPEECH_PARTS:'Teste do aplicativo empacotado|Obrigado por assistir',SPEECH_OUT:speech},windowsHide:true});
  assert.equal(voice.status,0,'Windows pt-BR voice unavailable');
  await runMediaProcess('ffmpeg',['-nostdin','-v','error','-n','-f','lavfi','-i','testsrc2=size=320x180:rate=24','-i',speech,'-shortest','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-ar','48000',input]);
  const file=await inspect(input),originalSha=file.sha256,dbPath=join(out,'state.sqlite'),at=new Date().toISOString();
  const bridge=createContentWorkflowBridge({dbPath,getCurrentProfile:()=>'packaged',mediaOptions:{inspect,transcriber,...animator}});const db=new DatabaseSync(dbPath);
  try{
    db.prepare('INSERT INTO editorial_state VALUES (?,?,?,?)').run('packaged',1,JSON.stringify({schemaVersion:1,topics:[],contents:[{id:'content',workspaceId:'space',title:'Packaged'}],runs:[],artifacts:[],approvals:[],assets:[{id:'source',workspaceId:'space',contentId:'content',name:file.name,kind:'video',role:'source',status:'available',currentVersionId:'v1',versions:[{id:'v1',...file,createdAt:at}],createdAt:at,updatedAt:at}]}),at);
    const ref={contentId:'content',assetId:'source',versionId:'v1',sha256:file.sha256};
    const caps=await bridge.media.capabilities();assert.deepEqual([caps.available,caps.animate,caps.transcribe],[true,true,true],JSON.stringify(caps));
    const {analysis}=await bridge.media.analyze('packaged',{...ref,transcript:'local',language:'pt',options:{thresholdDb:-35,minDuration:0.6,padding:0.2}});
    assert.equal(analysis.transcript.origin,'local-whisper');assert.match(analysis.transcript.segments.map(item=>item.text).join(' '),/empacotado/i);
    const preview=await bridge.media.plan('packaged',{...ref,plan:{segments:analysis.suggestedSegments,animations:[{id:'title',kind:'title',text:'App empacotado',start:0.3,duration:1.5},{id:'cta',kind:'cta',text:'Siga o canal',duration:1}]}});
    const job=bridge.media.enqueue('packaged',{mode:'advanced',authorize:true,revision:1,requestKey:'packaged',...ref,plan:preview.plan,planHash:preview.planHash}).job;
    const deadline=Date.now()+180000;let current;while(Date.now()<deadline&&!['succeeded','failed'].includes((current=bridge.media.list('packaged').find(item=>item.id===job.id)).status))await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(current.status,'succeeded',current.error);const video=await probeVideo(current.result.file.path);
    assert(Math.abs(video.duration-preview.outputDuration)<0.2&&video.hasAudio,JSON.stringify(video));
    const srt=JSON.parse(db.prepare('SELECT state_json FROM editorial_state').get().state_json).assets.find(item=>item.subtitlesForJobId===job.id);assert(srt,'SRT created');
    await runMediaProcess('ffmpeg',['-nostdin','-v','error','-n','-ss','0.8','-i',current.result.file.path,'-frames:v','1',join(out,'packaged-title.png')]);
    assert.equal(createHash('sha256').update(readFileSync(input)).digest('hex'),originalSha,'original untouched');
    log.push(`export ${analysis.metadata.duration.toFixed(2)}s -> ${video.duration.toFixed(2)}s with Remotion overlays and SRT ${srt.name}`);
  }finally{await bridge.close();db.close();}
  writeFileSync(join(out,'packaged.log'),log.join('\n'));console.log(`PACKAGED_MEDIA_OK: ${log.join(' | ')} | artifacts ${out}`);app.exit(0);
}catch(error){console.error(error);console.error(log.join('\n'));app.exit(1);}});
