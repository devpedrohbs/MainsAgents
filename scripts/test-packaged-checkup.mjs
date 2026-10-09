// Packaged smoke for the check-up round (B03/B05/B07/B09/B10/B11): loads the new modules FROM app.asar inside Electron,
// checks they equal the reviewed sources, and burns real captions with the packaged engine on a synthetic clip.
// No personal profile, network, AI, Notion or publication.  Usage: npx electron scripts/test-packaged-checkup.mjs [release/win-unpacked]
import {app} from 'electron';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {extractFile,listPackage} from '@electron/asar';

const root=resolve(import.meta.dirname,'..'),packaged=resolve(root,process.argv.find(arg=>arg.includes('win-unpacked'))??'release/win-unpacked'),asar=join(packaged,'resources','app.asar');
const out=resolve(root,'.mainsagents-workspaces/packaged-checkup',String(Date.now()));mkdirSync(out,{recursive:true});app.setPath('userData',join(out,'electron'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),load=name=>import(pathToFileURL(join(asar,name)).href);
const raw=fn=>{const previous=process.noAsar;process.noAsar=true;try{return fn();}finally{process.noAsar=previous;}};
const modules=['editorial-captions.mjs','editorial-transcribe.mjs','editor-inspiration-analysis.mjs','publication-status-refresh.mjs','claude-usage.mjs','production-budget.mjs','production-script.mjs','production-preflight.mjs','editorial-publication-execution.mjs','content-workflow-bridge.mjs','production-coordinator.mjs'];
app.whenReady().then(async()=>{const evidence={asar,modules:{}};try{
 evidence.asarSha256=raw(()=>sha(readFileSync(asar)));
 const listed=new Set(raw(()=>listPackage(asar)).map(entry=>entry.replace(/\\/g,'/').replace(/^\//,'')));
 for(const name of modules){assert(listed.has(name),`${name} missing from app.asar`);const hash=sha(raw(()=>extractFile(asar,name)));evidence.modules[name]=hash.slice(0,12);assert.equal(hash,sha(readFileSync(join(root,name))),`${name} differs from source`);}
 const captions=await load('editorial-captions.mjs'),analysis=await load('editor-inspiration-analysis.mjs'),refresh=await load('publication-status-refresh.mjs'),usage=await load('claude-usage.mjs'),budget=await load('production-budget.mjs'),script=await load('production-script.mjs');
 await load('editorial-transcribe.mjs');await load('production-preflight.mjs');await load('editorial-publication-execution.mjs');
 const bridge=await load('content-workflow-bridge.mjs'),coordinator=await load('production-coordinator.mjs');assert.equal(typeof bridge.createContentWorkflowBridge,'function');assert.equal(typeof coordinator.createProductionCoordinator,'function');
 // B07: absent mode = Notion (legacy); B09/B10/B11 pure contracts.
 assert.equal(script.scriptModeOf({}),'notion');assert.equal(script.scriptModeOf({scriptMode:'local'}),'local');
 assert.equal(typeof analysis.analysisPrompt,'function');assert.throws(()=>analysis.validateAnalysisResult({hook:{}},{durationSeconds:10,hasTranscript:true}));
 assert.deepEqual([...refresh.REFRESH_INTERVALS],[5,15,30,60]);assert.throws(()=>refresh.validateRefreshSettings({auto:true,intervalMinutes:7}));
 assert.equal(usage.usageFromResult({subtype:'success',is_error:false,usage:{input_tokens:10,output_tokens:5}},{model:'m'}).status,'reported');assert.equal(typeof budget.recordUsage,'function');
 // B05: real libass burn with the packaged engine; audio copied, source untouched.
 const video=join(out,'synthetic.mp4'),burned=join(out,'burned.mp4');
 const made=spawnSync('ffmpeg',['-nostdin','-v','error','-y','-f','lavfi','-i','testsrc2=size=320x568:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',video]);assert.equal(made.status,0,String(made.stderr));
 const caps=await captions.getCaptionCapabilities();assert.equal(caps.available,true,(caps.reasons??[]).join('; '));
 const before=sha(readFileSync(video)),manifest=await captions.renderBurnedCaptions({source:{path:video,assetId:'asset',versionId:'v1',sha256:before},segments:[{start:0.1,end:0.9,text:'Olá, edição'},{start:1,end:1.9,text:'Ação e coração'}],styleId:'boxed',outputPath:burned});
 assert.deepEqual([manifest.audio,manifest.output.width,manifest.output.height,manifest.output.hasAudio,manifest.source.preserved,manifest.requiresAi],['copied',320,568,true,true,false]);
 assert.equal(manifest.output.sha256,sha(readFileSync(burned)));assert.equal(sha(readFileSync(video)),before,'source untouched');
 evidence.captions={engine:captions.CAPTIONS_ENGINE_ID,outputSha:manifest.output.sha256.slice(0,12)};
 console.log('PACKAGED_CHECKUP_OK '+JSON.stringify(evidence));app.exit(0);
}catch(error){console.error(error,evidence);app.exit(1);}});
