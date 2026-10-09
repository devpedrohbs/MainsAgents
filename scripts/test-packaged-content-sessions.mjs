// Packaged smoke for content sessions (0.3.58): imports production-import.mjs & co FROM app.asar inside Electron,
// checks bytes equal the reviewed sources, exercises the recorded-entry contracts and confirms the renderer bundle carries the UI/context.
// No personal profile, network, AI, Notion or publication.  Usage: npx electron scripts/test-packaged-content-sessions.mjs [release/win-unpacked]
import {app} from 'electron';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {extractFile,listPackage} from '@electron/asar';

const root=resolve(import.meta.dirname,'..'),packaged=resolve(root,process.argv.find(arg=>arg.includes('win-unpacked'))??'release/win-unpacked'),asar=join(packaged,'resources','app.asar');
const out=resolve(root,'.mainsagents-workspaces/packaged-content-sessions',String(Date.now()));mkdirSync(out,{recursive:true});app.setPath('userData',join(out,'electron'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),load=name=>import(pathToFileURL(join(asar,name)).href);
const raw=fn=>{const previous=process.noAsar;process.noAsar=true;try{return fn();}finally{process.noAsar=previous;}};
const modules=['production-import.mjs','production-preflight.mjs','production-coordinator.mjs','content-workflow-bridge.mjs'];
app.whenReady().then(async()=>{const evidence={asar,modules:{},bundle:{}};try{
 evidence.asarSha256=raw(()=>sha(readFileSync(asar)));
 const listed=new Set(raw(()=>listPackage(asar)).map(entry=>entry.replaceAll('\\','/').replace(/^\//,'')));
 for(const name of modules){assert(listed.has(name),`${name} missing from app.asar`);const hash=sha(raw(()=>extractFile(asar,name)));evidence.modules[name]=hash.slice(0,12);assert.equal(hash,sha(readFileSync(join(root,name))),`${name} differs from source`);}
 // Renderer bundle: every dist/assets file in the asar equals the built one; the JS carries the content-session UI and context markers.
 const assets=readdirSync(join(root,'dist','assets'));assert(assets.length>0);
 let js='';for(const file of assets){const inAsar=`dist/assets/${file}`;assert(listed.has(inAsar),`${inAsar} missing from app.asar`);const bytes=raw(()=>extractFile(asar,inAsar.replaceAll('/','\\')));assert.equal(sha(bytes),sha(readFileSync(join(root,inAsar))),`${inAsar} differs from build`);if(file.endsWith('.js'))js+=bytes.toString('utf8');evidence.bundle[file]=sha(bytes).slice(0,12);}
 for(const marker of ['Novo conteúdo','Ler este card','recorded-import','truncated','[arquivo local]'])assert(js.includes(marker),`renderer bundle lacks "${marker}"`);
 // Contracts, running the packaged module.
 const imp=await load('production-import.mjs'),CARD='12345678123412341234123456789abc';
 assert.equal(imp.notionPageId(`https://www.notion.so/Card-${CARD}`),CARD);assert.equal(imp.notionPageId('https://evil.example/'+CARD),null);assert.equal(imp.notionPageId('texto qualquer'),null);
 const text='Contexto colado do vídeo gravado com mais de vinte caracteres.';
 const ok=imp.validateRecordedEntry({assetId:'video-a',context:{kind:'text',text},format:'portrait',editMode:'basic'});
 assert.deepEqual([ok.context.kind,ok.format,ok.editMode],['text','portrait','basic']);
 assert.throws(()=>imp.validateRecordedEntry({assetId:'video-a',context:{kind:'text',text:'curto'}}));assert.throws(()=>imp.validateRecordedEntry({context:{kind:'text',text}}));assert.throws(()=>imp.validateRecordedEntry({assetId:'a',context:{kind:'notion',pageId:'x'}}));assert.throws(()=>imp.validateRecordedEntry({assetId:'a'}));
 assert.equal(imp.validateRecordedEntry({assetId:'a',context:{kind:'notion',pageId:CARD}}).context.pageId,CARD);
 assert.equal(imp.isRecordedEntry({entry:{kind:'recorded'}}),true);assert.equal(imp.isRecordedEntry({}),false);
 for(const action of ['save-script','approve-script','regenerate-script','enable-notion','recording-prep','video'])assert(imp.recordedBlockedActions.includes(action),action);
 const prompt=imp.recordedContextPrompt({entry:{kind:'recorded',origin:'text',context:{text}},notionRead:null});assert(prompt.includes(text)&&prompt.includes('o app não gerou'),'prompt');
 const bridge=await load('content-workflow-bridge.mjs'),coordinator=await load('production-coordinator.mjs'),preflight=await load('production-preflight.mjs');
 assert.equal(typeof bridge.createContentWorkflowBridge,'function');assert.equal(typeof coordinator.createProductionCoordinator,'function');assert.equal(typeof preflight.productionPreflight,'function');
 console.log('PACKAGED_CONTENT_SESSIONS_OK '+JSON.stringify(evidence));app.exit(0);
}catch(error){console.error(error,evidence);app.exit(1);}});
