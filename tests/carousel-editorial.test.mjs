import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {validateScriptOptions,validateCarousel,carouselScript,carouselText,scriptPrompt} from '../editorial-protocol.mjs';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';

const sources=[{title:'Research reference',url:'https://example.com/research'}];
const carousel=()=>({slides:[{order:1,title:'A practical idea',text:'The documented feature can help with repetitive work.',imageBrief:'A clean desk, warm palette, vertical composition and space for editable text.',sourceUrls:[sources[0].url]},{order:2,title:'Try one small step',text:'Save this guide and review the source.',imageBrief:'A matching checklist illustration with a clear area for editable text.',sourceUrls:[]}],caption:'A practical guide. Save it for later.',sources});
const video=()=>({hooks:['One','Two','Three'],ctas:['Save','Try'],paths:[{title:'Explain',outline:'Explain a practical example in clear ordered steps.'},{title:'Story',outline:'Show the original problem and the practical result.'}],improvisationTopics:['Context','Demo'],thumbnailDirection:'Simple visual',draftScript:'A complete spoken video script with a practical example, clear explanation of the project and its result, and a closing action for the viewer.'});

test('carousel prompt/output use ordered copy and image briefs while video callers remain unchanged',()=>{
 assert.deepEqual(validateScriptOptions(JSON.stringify(video())),video());
 assert.deepEqual(validateScriptOptions(JSON.stringify(video()),{format:'long-video'}),video());
 const options=validateScriptOptions(JSON.stringify({carousel:carousel()}),{format:'carousel',sources});
 assert.deepEqual(options.carousel,carousel());assert.deepEqual(options.improvisationTopics,[]);assert.equal(options.draftScript,carouselText(carousel()));
 const prompt=scriptPrompt({sources,title:'Guide'},{format:'carousel',platforms:['Instagram']},'pt-BR');
 assert.match(prompt,/Português do Brasil/);assert.match(prompt,/imageBrief/);assert.doesNotMatch(prompt,/spoken script|improvisationTopics|video script specialist/);
 assert.match(scriptPrompt({sources},{format:'short-video',platforms:['Instagram']},'en-US'),/complete editable spoken script/);
 assert.throws(()=>validateScriptOptions(JSON.stringify(video()),{format:'carousel',sources}),/JSON object/);
});

test('carousel validation rejects malformed, duplicate, unordered, oversized or unsourced slides',()=>{
 const cases=[c=>c.slides.pop(),c=>c.slides.push(...Array.from({length:19},(_,i)=>({...c.slides[1],order:i+3}))),c=>c.slides[1].order=1,c=>c.slides.reverse(),c=>delete c.slides[0].imageBrief,c=>c.slides[0].text='x'.repeat(1801),c=>c.caption='',c=>c.sources[0].url='javascript:alert(1)',c=>c.sources.push({...c.sources[0]}),c=>c.slides[0].sourceUrls=['https://example.com/invented'],c=>c.slides[0].sourceUrls=[],c=>c.slides[0].sourceUrls.push(sources[0].url)];
 for(const change of cases){const value=structuredClone(carousel());change(value);assert.throws(()=>validateCarousel(value,sources));}
 assert.throws(()=>validateCarousel(carousel(),[{title:'Other',url:'https://example.com/other'}]),/supplied research sources/);
 const oversized=carousel();oversized.slides=Array.from({length:20},(_,i)=>({...oversized.slides[0],order:i+1,title:'t'.repeat(199),text:'t'.repeat(1790),imageBrief:'v'.repeat(2490)}));assert.throws(()=>validateCarousel(oversized,sources),/storage limit/);
 assert.equal(carouselScript(carousel()).text,carouselText(carousel()));
});

async function until(check){const end=Date.now()+3000;while(Date.now()<end){if(check())return;await new Promise(r=>setTimeout(r,5))}throw Error('Local carousel work timed out');}
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'carousel-editorial-')),path=join(dir,'state.sqlite');let output='',counter=0;
 const agent={id:'editor',name:'Editor',workspaceId:'w',providerId:'codex',instructions:'Editorial fixture',tools:['web-search']};
 const runtime={createSession:async()=>`thread-${++counter}`,resumeSession:async()=>{},readThread:async()=>({status:{type:'idle'},turns:[]}),send:async()=>({executionId:`turn-${counter}`}),events:async function*(){yield {type:'message.completed',content:output};yield {type:'execution.completed'}}};
 const bridge=createContentWorkflowBridge({dbPath:path,getRuntime:()=>runtime,getAgents:()=>[agent]}),db=new DatabaseSync(path);
 const topic={id:'topic',workspaceId:'w',inputKind:'text',input:'A useful guide',priority:'normal',status:'draft'};
 db.prepare('INSERT INTO editorial_state VALUES (?,?,?,?)').run('owner',1,JSON.stringify({schemaVersion:1,topics:[topic],contents:[],artifacts:[],approvals:[],runs:[]}),new Date().toISOString());
 const read=()=>{const row=db.prepare('SELECT revision,state_json FROM editorial_state').get();return {revision:row.revision,state:JSON.parse(row.state_json)}};
 return {bridge,db,read,setOutput:value=>output=JSON.stringify(value),enqueue:(kind,targetId)=>bridge.work.enqueue('owner',{kind,targetId,agentId:'editor',requestKey:crypto.randomUUID(),revision:read().revision}),close:async()=>{await bridge.close();db.close();rmSync(dir,{recursive:true,force:true})}};
}

test('research to carousel generation, review and approval retain edited slides, caption, briefs and immutable history',async()=>{
 const f=fixture();try{
  f.setOutput({topics:[{title:'A practical guide',category:'AI',summary:'A sourced explanation of a useful documented feature.',whyItMatters:'It can help with repetitive work.',angles:['Guide','Example'],sources,factualQuestions:[]}]});f.enqueue('research','topic');await until(()=>f.read().state.topics[0].status==='review');
  let current=f.read();current.state.topics[0].status='approved';current.state.topics[0].contentId='content';current.state.contents.push({id:'content',workspaceId:'w',topicId:'topic',title:'A practical guide',format:'carousel',platforms:['Instagram'],status:'planning'});f.db.prepare('UPDATE editorial_state SET state_json=?,revision=revision+1').run(JSON.stringify(current.state));
  f.setOutput({carousel:carousel()});f.enqueue('script','content');await until(()=>f.read().state.contents[0].status==='script-review');
  current=f.read();const generated=current.state.artifacts.find(a=>a.type==='script-options');assert.deepEqual(generated.data.carousel,carousel());
  f.bridge.deliveries.review('owner',{revision:current.revision,artifactId:generated.id,expectedArtifact:generated,decision:'revision-requested',notes:'Keep the slide sequence; refine the caption.'});
  assert.equal(f.read().state.approvals[0].notes,'Keep the slide sequence; refine the caption.');
  const edited=carousel();edited.slides[0].text='EDITED_COPY';edited.slides[0].imageBrief='EDITED_IMAGE_BRIEF';edited.caption='EDITED_CAPTION';
  const approve=value=>{const c=f.read();return f.bridge.jobs.approve('owner',{revision:c.revision,contentId:'content',scriptOptionsArtifactId:generated.id,expectedArtifact:generated,script:{...carouselScript(value),text:'stale derived text'},notes:'Reviewed copy',syncNotion:false})};
  approve(edited);approve(edited);assert.equal(f.read().state.artifacts.filter(a=>a.type==='script').length,1,'identical canonical approval does not duplicate');
  edited.caption='SECOND_CAPTION';approve(edited);
  current=f.read();const versions=current.state.artifacts.filter(a=>a.type==='script').sort((a,b)=>a.version-b.version);
  assert.equal(versions.length,2);assert.equal(versions[0].data.carousel.caption,'EDITED_CAPTION');assert.equal(versions[1].data.carousel.caption,'SECOND_CAPTION');assert.match(versions[0].data.text,/EDITED_COPY/);assert.match(versions[0].data.text,/EDITED_IMAGE_BRIEF/);assert.doesNotMatch(versions[0].data.text,/stale derived text/);assert.deepEqual(generated.data.carousel,carousel());assert.equal(current.state.contents[0].productionStage,'planning');assert.equal(f.bridge.jobs.list('owner').length,0);
  assert.throws(()=>f.bridge.jobs.approve('owner',{revision:current.revision,contentId:'content',scriptOptionsArtifactId:generated.id,script:{hook:'Legacy',cta:'Save',path:video().paths[0],text:video().draftScript,improvisationTopics:[],thumbnailDirection:'Cover'}}),/structured carousel/);
 }finally{await f.close()}
});

test('legacy stored carousel options and approvals retain the existing video-shaped payload',async()=>{
 const f=fixture();try{
  const current=f.read(),legacy=video(),script={hook:legacy.hooks[0],cta:legacy.ctas[0],path:legacy.paths[0],text:legacy.draftScript,improvisationTopics:legacy.improvisationTopics,thumbnailDirection:legacy.thumbnailDirection};
  current.state.contents=[{id:'content',workspaceId:'w',topicId:'topic',format:'carousel',scriptOptionsArtifactId:'legacy'}];current.state.artifacts=[{id:'legacy',workspaceId:'w',contentId:'content',type:'script-options',version:1,data:legacy}];f.db.prepare('UPDATE editorial_state SET state_json=?').run(JSON.stringify(current.state));
  const receipt=f.bridge.jobs.approve('owner',{revision:current.revision,contentId:'content',scriptOptionsArtifactId:'legacy',script,syncNotion:false});assert.deepEqual(receipt.state.artifacts.find(a=>a.type==='script').data,script);assert.deepEqual(receipt.state.artifacts.find(a=>a.id==='legacy').data,legacy);
 }finally{await f.close()}
});
