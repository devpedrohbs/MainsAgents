import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,basename} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {createInterface} from 'node:readline';
import {createDeliveryReceipts} from '../delivery-receipts.mjs';
import {inspectLocalAsset} from '../editorial-local-files.mjs';
import {createChatImageArtifacts} from '../chat-image-artifacts.mjs';
import {createVerifiedImageIndex,createPaperAssetLedger,paperExportFiles} from '../paper-image-assets.mjs';
import {recordToolResults} from '../codex-bridge.mjs';
import {scheduleTool} from '../chat-publishing.mjs';

const FILE='01M4V841P4WXN0HWA5BH326JKM';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ9sAAAAASUVORK5CYII=','base64');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
// Exactly what Paper Desktop's export tool returned on 2026-10-13 (header block + exports block).
const paperResult=entries=>({content:[{type:'text',text:JSON.stringify({file:{id:FILE,name:'Joyful olive'},contentHash:{tokens:'811c9dc5'}})},{type:'text',text:JSON.stringify({exports:entries})}]});

function fixture(profile='owner'){
 const root=mkdtempSync(join(tmpdir(),'paper-gpt-receipts-')),downloads=join(root,'Downloads'),images=join(root,'images'),generated=join(root,'generated');
 for(const dir of [downloads,images,join(generated,'thread')])mkdirSync(dir,{recursive:true});
 const db=new DatabaseSync(join(root,'state.sqlite'));
 const receipts=createDeliveryReceipts(db,{inspect:path=>inspectLocalAsset(path,{stabilityMs:0}),getCurrentProfile:()=>profile});
 const index=createVerifiedImageIndex({imagesDirectory:images,generatedRoots:[generated]});
 const ledger=createPaperAssetLedger({receipts,getCurrentProfile:()=>profile,index});
 const binding={profileId:'owner',sessionId:'s-codex',agentId:'criador',agentName:'Criador de Carrosséis',workspaceId:'space',providerId:'codex',session:{id:'s-codex',contentId:'content-1'},agent:{id:'criador',providerId:'codex',paperDesign:{enabled:true,automatic:true,fileId:FILE,fileName:'Joyful olive',signature:'',visualStyle:''}}};
 const slide=(name,byte)=>{const path=join(downloads,name);writeFileSync(path,Buffer.concat([png,Buffer.from([byte])]));return path;};
 return {root,images,generated,receipts,ledger,binding,slide,close:()=>{db.close();rmSync(root,{recursive:true,force:true});}};
}

test('the export parser reads only Paper\'s structured result, never free text',()=>{
 assert.deepEqual(paperExportFiles(paperResult([{nodeId:'3Z-0',filePath:'C:\\Users\\pacas\\Downloads\\Teste 01 — Fundo GPT.png'}])).map(file=>file.nodeId),['3Z-0']);
 assert.deepEqual(paperExportFiles({content:[{type:'text',text:'Exported to C:\\Users\\pacas\\Downloads\\fake.png'}]}),[]);
 assert.deepEqual(paperExportFiles(paperResult([{nodeId:'1-0',filePath:'relative.png'},{nodeId:'1-0',filePath:'C:\\x\\run.exe'}])),[]);
 // Claude Code hands tool_result content back as a string or as text blocks.
 assert.equal(paperExportFiles({content:JSON.stringify({exports:[{nodeId:'1-0',filePath:process.platform==='win32'?'C:\\a\\b.png':'/a/b.png'}]})}).length,1);
});

test('Paper exports become ordered, hashed receipts in the order the agent requested',async()=>{
 const f=fixture();try{
  // The tree lists "07" before "05" (the real carousel did); the call's nodes order is the carousel order.
  const one=f.slide('01 Capa.png',1),two=f.slide('02 Promessa.png',2),three=f.slide('03 Passo.png',3);
  const args={fileId:FILE,pageId:'p-2-0',nodes:{'1-0':[{format:'png',scale:'1x'}],'G-0':[{format:'png',scale:'1x'}],'19-0':[{format:'png',scale:'1x'}]}};
  const result=paperResult([{nodeId:'19-0',filePath:three},{nodeId:'1-0',filePath:one},{nodeId:'G-0',filePath:two},{nodeId:'ZZ-9',filePath:two}]);
  const issued=await f.ledger.captureExport({binding:f.binding,callId:'thread:turn:call-1',arguments:args,result});
  assert.deepEqual(issued.map(item=>[item.assetId,item.name,item.source.step]),[['1-0','01 Capa.png','1'],['G-0','02 Promessa.png','2'],['19-0','03 Passo.png','3']]);
  for(const item of issued){assert.equal(item.source.kind,'paper-export');assert.equal(item.versionId,FILE);assert.equal(item.sessionId,'s-codex');assert.equal(item.contentId,'content-1');assert.equal(item.producedBy.providerId,'codex');}
  assert.equal(issued[0].sha256,sha(Buffer.concat([png,Buffer.from([1])])));
  // A second export call is the new latest; the first stays available as history.
  await new Promise(resolve=>setTimeout(resolve,5));
  const later=await f.ledger.captureExport({binding:f.binding,callId:'thread:turn:call-2',arguments:{fileId:FILE,nodes:{'1-0':[]}},result:paperResult([{nodeId:'1-0',filePath:f.slide('01 Capa v2.png',9)}])});
  const exports=f.ledger.exports('owner',{sessionId:'s-codex'});
  assert.equal(exports.latest.callId,'thread:turn:call-2');assert.equal(exports.latest.files[0].id,later[0].id);
  assert.deepEqual(exports.previous[0].files.map(item=>item.assetId),['1-0','G-0','19-0']);
  // Receipts are re-verified against the disk before use: a file overwritten later reads as changed.
  writeFileSync(one,Buffer.from('changed'));
  assert.equal((await f.receipts.check('owner',issued[0].id)).status,'changed');
 }finally{f.close();}
});

test('nothing is recorded for another file, a failed export, or another profile',async()=>{
 const f=fixture();try{
  const path=f.slide('x.png',4),result=paperResult([{nodeId:'1-0',filePath:path}]);
  assert.deepEqual(await f.ledger.captureExport({binding:f.binding,callId:'c',arguments:{fileId:'OTHER',nodes:{'1-0':[]}},result}),[]);
  assert.deepEqual(await f.ledger.captureExport({binding:f.binding,callId:'c',arguments:{fileId:FILE,nodes:{'1-0':[]}},result:{...result,isError:true}}),[]);
  assert.deepEqual(await f.ledger.captureExport({binding:{...f.binding,profileId:'someone-else'},callId:'c',arguments:{fileId:FILE,nodes:{'1-0':[]}},result}),[]);
  assert.equal(f.ledger.exports('owner',{sessionId:'s-codex'}).latest,null);
 }finally{f.close();}
});

test('Codex item notifications record the native image and the Paper export from actual results',async()=>{
 const f=fixture();try{
  const artifacts=createChatImageArtifacts(f.images),savedPath=join(f.generated,'thread','exec-1.png');writeFileSync(savedPath,png);
  const resolveBinding=threadId=>threadId==='thread'?f.binding:null;
  recordToolResults({method:'item/completed',params:{threadId:'thread',turnId:'turn',item:{type:'imageGeneration',id:'exec-1',status:'completed',result:png.toString('base64'),savedPath}}},{imageArtifacts:artifacts,resolveBinding,paperAssets:f.ledger});
  const slide=f.slide('01 Fundo.png',7);
  recordToolResults({method:'item/completed',params:{threadId:'thread',turnId:'turn',item:{type:'mcpToolCall',id:'call-9',server:'paper',tool:'export',status:'completed',arguments:{fileId:FILE,nodes:{'3Z-0':[{format:'png',scale:'1x'}]}},result:paperResult([{nodeId:'3Z-0',filePath:slide}])}}},{imageArtifacts:artifacts,resolveBinding,paperAssets:f.ledger});
  // Unbound threads and other tools record nothing.
  recordToolResults({method:'item/completed',params:{threadId:'stranger',turnId:'t',item:{type:'mcpToolCall',id:'x',server:'paper',tool:'export',status:'completed',arguments:{fileId:FILE,nodes:{'3Z-0':[]}},result:paperResult([{nodeId:'3Z-0',filePath:slide}])}}},{imageArtifacts:artifacts,resolveBinding,paperAssets:f.ledger});
  let list=[];for(const end=Date.now()+5000;Date.now()<end&&list.length<2;await new Promise(resolve=>setTimeout(resolve,20)))list=f.receipts.list('owner',{sessionId:'s-codex'});
  const image=list.find(item=>item.source.kind==='generated-image'),exported=list.find(item=>item.source.kind==='paper-export');
  assert.equal(list.length,2);
  assert.equal(image.sha256,sha(png));assert.equal(image.source.id,'thread:exec-1');assert.match(image.path,new RegExp(`${sha(png)}\\.png$`));
  assert.equal(exported.assetId,'3Z-0');assert.equal(exported.source.id,'thread:turn:call-9');
 }finally{f.close();}
});

test('the Claude publishing role exposes only the scheduling tool and forwards calls to the host',async()=>{
 const calls=[];
 const server=createServer((request,response)=>{let body='';request.on('data',chunk=>body+=chunk).on('end',()=>{calls.push({url:request.url,auth:request.headers.authorization,body:JSON.parse(body)});response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({content:[{type:'text',text:'{"state":"needs-input"}'}],isError:false}));});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const child=spawn(process.execPath,['claude-permission-mcp.mjs'],{env:{...process.env,MAINSAGENTS_MCP_ROLE:'publishing',MAINSAGENTS_PUBLISHING_URL:`http://127.0.0.1:${server.address().port}/publishing`,MAINSAGENTS_PUBLISHING_TOKEN:'token-1',MAINSAGENTS_PUBLISHING_TOOLS:JSON.stringify([{name:scheduleTool.name,description:scheduleTool.description,inputSchema:scheduleTool.inputSchema}])},stdio:['pipe','pipe','inherit']});
 const replies=new Map(),lines=createInterface({input:child.stdout});lines.on('line',line=>{const message=JSON.parse(line);replies.get(message.id)?.(message);});
 const ask=(id,method,params)=>new Promise(resolve=>{replies.set(id,resolve);child.stdin.write(`${JSON.stringify({jsonrpc:'2.0',id,method,params})}\n`);});
 try{
  const init=await ask(1,'initialize',{protocolVersion:'2025-06-18'});assert.equal(init.result.serverInfo.name,'mainsagents_publishing');
  const list=await ask(2,'tools/list',{});assert.deepEqual(list.result.tools.map(tool=>tool.name),['mainsagents_schedule_post']);
  const call=await ask(3,'tools/call',{name:'mainsagents_schedule_post',arguments:{action:'status'}});
  assert.equal(call.result.isError,false);assert.deepEqual(calls,[{url:'/publishing',auth:'Bearer token-1',body:{name:'mainsagents_schedule_post',arguments:{action:'status'}}}]);
  const other=await ask(4,'tools/call',{name:'approve',arguments:{}});assert.ok(other.error,'the permission gate is not exposed in this role');
 }finally{child.kill();server.close();}
});

test('a thread\'s app tools are read from its rollout session_meta (resume cannot add tools)',async()=>{
 const {threadDynamicToolNames}=await import('../codex-runtime-home.mjs');
 const home=mkdtempSync(join(tmpdir(),'paper-gpt-rollout-')),id='01a136c4-a152-77b3-b3ea-21644e0935cc',old='01a136c4-a152-77b3-b3ea-21644e0935cd';
 try{
  mkdirSync(join(home,'sessions','2026','10','13'),{recursive:true});
  const meta=tools=>JSON.stringify({timestamp:'2026-10-13T19:36:58Z',type:'session_meta',payload:{id,dynamic_tools:tools.map(name=>({type:'function',name}))}});
  writeFileSync(join(home,'sessions','2026','10','13',`rollout-2026-10-13T16-36-58-${id}.jsonl`),`${meta(['mainsagents_delegate','mainsagents_schedule_post'])}\n{"type":"event_msg"}\n`);
  writeFileSync(join(home,'sessions','2026','10','13',`rollout-2026-10-01T10-00-00-${old}.jsonl`),`${meta(['mainsagents_delegate'])}\n`);
  assert.deepEqual(threadDynamicToolNames({home},id),['mainsagents_delegate','mainsagents_schedule_post']);
  assert.deepEqual(threadDynamicToolNames({home},old),['mainsagents_delegate']);
  assert.equal(threadDynamicToolNames({home},'00000000-0000-0000-0000-000000000000'),null);
  assert.equal(threadDynamicToolNames({home},'../escape'),null);
 }finally{rmSync(home,{recursive:true,force:true});}
});

test('scheduling receives only the latest verified export batch, in export order',async()=>{
 const {latestExportBatch}=await import('../content-workflow-bridge.mjs');
 const f=fixture();try{
  const nodes=(...ids)=>Object.fromEntries(ids.map(id=>[id,[{format:'png',scale:'1x'}]]));
  const a=f.slide('01 Capa.png',1),b=f.slide('02 Promessa.png',2);
  await f.ledger.captureExport({binding:f.binding,callId:'t:first',arguments:{fileId:FILE,nodes:nodes('1-0','G-0')},result:paperResult([{nodeId:'G-0',filePath:b},{nodeId:'1-0',filePath:a}])});
  await new Promise(resolve=>setTimeout(resolve,5));
  const c=f.slide('01 Capa v2.png',3),d=f.slide('02 Promessa v2.png',4);
  await f.ledger.captureExport({binding:f.binding,callId:'t:second',arguments:{fileId:FILE,nodes:nodes('1-0','G-0')},result:paperResult([{nodeId:'1-0',filePath:c},{nodeId:'G-0',filePath:d}])});
  const batch=latestExportBatch(f.ledger,'owner','s-codex');
  assert.deepEqual(batch.map(item=>[item.order,item.nodeId,basename(item.path),item.callId]),[[1,'1-0','01 Capa v2.png','t:second'],[2,'G-0','02 Promessa v2.png','t:second']]);
  assert.ok(batch.every(item=>/^[a-f0-9]{64}$/.test(item.sha256)&&item.fileId===FILE));
  assert.deepEqual(latestExportBatch(f.ledger,'owner','another-session'),[]);
 }finally{f.close();}
});
