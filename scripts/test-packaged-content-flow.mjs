// Packaged content-flow smoke: loads the round's new modules FROM release/win-unpacked/resources/app.asar inside
// Electron (no source imports) and renders three real local covers with FFmpeg from a synthetic video.
// No personal profile, network, AI, Notion or publication. Run after `npm run desktop:dist`:
//   npx electron scripts/test-packaged-content-flow.mjs [release/win-unpacked]
import {app} from 'electron';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {extractFile,listPackage} from '@electron/asar';

const root=resolve(import.meta.dirname,'..'),packaged=resolve(root,process.argv.find(arg=>arg.includes('win-unpacked'))??'release/win-unpacked'),asar=join(packaged,'resources','app.asar');
const out=resolve(root,'.mainsagents-workspaces/packaged-content-flow',String(Date.now()));mkdirSync(out,{recursive:true});app.setPath('userData',join(out,'electron'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const load=name=>import(pathToFileURL(join(asar,name)).href);
// Electron's fs treats app.asar as a directory; raw archive reads (hash, listing, extraction) bypass that interception.
const raw=fn=>{const previous=process.noAsar;process.noAsar=true;try{return fn();}finally{process.noAsar=previous;}};
const modules=['editorial-thumbnails.mjs','production-script.mjs','production-runtime.mjs','production-covers.mjs','editorial-inspiration.mjs'];
app.whenReady().then(async()=>{const evidence={asar,modules:{}};try{
  evidence.asarSha256=raw(()=>sha(readFileSync(asar)));
  const version=JSON.parse(raw(()=>extractFile(asar,'package.json')).toString('utf8')).version;evidence.version=version;
  assert.equal(version,JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version,'asar version matches package.json');
  // 1) The five new modules are inside the archive (not unpacked or missing) and identical to the reviewed sources.
  const listed=new Set(raw(()=>listPackage(asar)).map(entry=>entry.replace(/\\/g,'/').replace(/^\//,'')));
  for(const name of modules){assert(listed.has(name),`${name} missing from app.asar`);const packedHash=sha(raw(()=>extractFile(asar,name)));evidence.modules[name]={sha256:packedHash,matchesSource:packedHash===sha(readFileSync(join(root,name)))};assert(evidence.modules[name].matchesSource,`${name} differs from source`);}
  // 2) Dynamic imports resolve from app.asar under Electron, including the coordinator graph that uses them.
  const thumbs=await load('editorial-thumbnails.mjs'),script=await load('production-script.mjs'),runtime=await load('production-runtime.mjs'),covers=await load('production-covers.mjs'),inspiration=await load('editorial-inspiration.mjs');
  const coordinator=await load('production-coordinator.mjs');assert.equal(typeof coordinator.createProductionCoordinator,'function');
  assert.deepEqual([thumbs.MANIFEST_SCHEMA,typeof thumbs.renderThumbnailSet,typeof script.migrateScriptGate,typeof runtime.productionRuntimeFor,typeof covers.initialCovers,typeof inspiration.validateInspirationState],['mainsagents.thumbnails/1','function','function','function','function','function']);
  assert.equal(runtime.providerCapabilities('claude').imageGeneration,false,'Claude stays text-only');
  const v1=script.scriptVersion({hook:'H',cta:'C',path:{title:'T',outline:'O'},text:'Texto do roteiro aprovado.'},[],'agent','2026-10-08T00:00:00.000Z');assert.match(v1.hash,/^[0-9a-f]{64}$/);
  const initial=covers.initialCovers({approvedVideo:{assetId:'a',versionId:'v',sha256:'a'.repeat(64)},platforms:['Instagram','LinkedIn'],script:{hook:'Hook',cta:'CTA'},topic:{title:'T'},editPlan:{outputDuration:3}});
  assert.throws(()=>covers.validateDestinations(initial.destinations,['Instagram','LinkedIn']),/LinkedIn/,'unverified LinkedIn preset needs confirmation');
  assert.equal(inspiration.validateInspirationState({inspiration:{schemaVersion:1,references:[{id:'r',workspaceId:'w',sourceUrl:'https://example.com/r',notes:'',tags:[],metadataStatus:'not_collected',revision:1,createdAt:'2026-10-08T00:00:00.000Z',updatedAt:'2026-10-08T00:00:00.000Z',path:'C:/x'}]}}),false,'private paths rejected');
  // 3) Real local covers with the packaged engine: synthetic video, FFmpeg from PATH, source preserved.
  const caps=await thumbs.getThumbnailCapabilities();assert.equal(caps.available,true,caps.reasons.join('; '));evidence.engine={id:caps.engine.id,version:caps.engine.version,font:caps.font?.name};
  const video=join(out,'synthetic.mp4');const {spawnSync}=await import('node:child_process');
  const made=spawnSync('ffmpeg',['-nostdin','-v','error','-y','-f','lavfi','-i','testsrc2=size=720x1280:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','3','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',video]);assert.equal(made.status,0,String(made.stderr));
  const before=sha(readFileSync(video)),coversDir=join(out,'covers');mkdirSync(coversDir);
  const manifest=await thumbs.renderThumbnailSet({source:{path:video,assetId:'asset-synthetic',versionId:'v1',sha256:before},format:'instagram-reels-cover',outputDirectory:coversDir,safeAreaPreview:false,
   concepts:[{concept:'product',timestampSeconds:1.5,title:'Produto em destaque',framing:{focusX:0.5,focusY:0.55,zoom:1.4}},{concept:'person',timestampSeconds:0.5,title:'Minha reação real',kicker:'Teste',framing:{focusX:0.5,focusY:0.4,zoom:1.2}},{concept:'benefit',timestampSeconds:2.5,title:'Economize tempo',framing:{focusX:0.5,focusY:0.5,zoom:1}}]});
  assert.equal(manifest.items.length,3);assert.equal(manifest.requiresAi,false);
  evidence.covers=[];for(const item of manifest.items){assert(existsSync(item.export.path));const fileHash=sha(readFileSync(item.export.path));assert.equal(fileHash,item.export.sha256,`${item.concept} hash`);const facts=await thumbs.probeMedia(item.export.path);assert.deepEqual([facts.width,facts.height],[1080,1920],`${item.concept} dimensions`);evidence.covers.push({concept:item.concept,sha256:fileHash,width:facts.width,height:facts.height,bytes:item.export.size});}
  assert.equal(sha(readFileSync(video)),before,'source video preserved');evidence.sourcePreserved=true;evidence.batchId=manifest.batchId;
  writeFileSync(join(out,'packaged-content-flow.json'),JSON.stringify(evidence,null,2));
  console.log(`PACKAGED_CONTENT_FLOW_OK ${JSON.stringify(evidence)}`);app.exit(0);
}catch(error){console.error(error);writeFileSync(join(out,'packaged-content-flow.json'),JSON.stringify({...evidence,error:String(error?.stack??error)},null,2));app.exit(1);}});
