import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startCodexBridge} from '../codex-bridge.mjs';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ9sAAAAASUVORK5CYII=';

test('official item notifications reach the chat stream and history without API keys or a generation request during recovery',async()=>{
 const root=mkdtempSync(join(tmpdir(),'mains-image-bridge-')),cli=join(root,'fake-codex.mjs'),shared=join(root,'shared');mkdirSync(shared);
 const item={type:'imageGeneration',id:'image-call',status:'completed',result:png};
 const threadId='01a0fcb7-5e86-7330-bf3b-2034c1492a89';
 writeFileSync(cli,`import{createInterface}from'node:readline';const threadId=${JSON.stringify(threadId)},item=${JSON.stringify(item)};const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;let result={};if(m.method==='thread/resume')result={thread:{id:threadId,status:{type:'idle'}}};if(m.method==='thread/read')result={thread:{id:threadId,status:{type:'idle'},turns:[{id:'mock-turn',items:[item]}]}};if(m.method==='turn/start'){result={turn:{id:'mock-turn'}};setTimeout(()=>{send({method:'item/started',params:{turnId:'mock-turn',threadId,item:{...item,status:'in_progress',result:''}}});send({method:'item/completed',params:{turnId:'mock-turn',threadId,item}});send({method:'item/completed',params:{turnId:'mock-turn',threadId,item:{type:'agentMessage',text:'Your image is ready.'}}});send({method:'turn/completed',params:{turnId:'mock-turn',threadId,turn:{id:'mock-turn',status:'completed'}}});},20);}send({id:m.id,result});});`);
 const previous=process.env.CODEX_CLI_PATH;process.env.CODEX_CLI_PATH=cli;
 let bridge;
 try{
  bridge=await startCodexBridge({port:0,cwd:root,runtimeHome:join(root,'runtime'),sharedHome:shared,imagesDirectory:join(root,'images')});
  const base=`http://127.0.0.1:${bridge.port}`,headers={'x-mainsagents-bridge-token':bridge.token,'content-type':'application/json'};
  assert.equal((await fetch(`${base}/sessions`,{headers:{}})).status,403);
  const history=await (await fetch(`${base}/api/codex/sessions/${threadId}/images`,{headers})).json();assert.equal(history.events.length,1);
  const resumed=await fetch(`${base}/api/codex/sessions`,{method:'POST',headers,body:JSON.stringify({threadId})});assert.equal(resumed.status,200);
  const start=await (await fetch(`${base}/api/codex/executions`,{method:'POST',headers,body:JSON.stringify({threadId,content:'Generate an image'})})).json();assert.equal(start.executionId,'mock-turn');
  const stream=await (await fetch(`${base}/api/codex/executions/mock-turn/events`,{headers})).text(),events=stream.trim().split('\n').map(JSON.parse);
  assert(events.some(event=>event.type==='image.completed'));assert.equal(events.at(-1).type,'execution.completed');
  const url=events.find(event=>event.type==='image.completed').image.url;
  assert.equal((await fetch(base+url)).status,403);
  const image=await fetch(base+url,{headers});assert.equal(image.headers.get('content-type'),'image/png');assert.equal(Buffer.from(await image.arrayBuffer()).toString('base64'),png);
 }finally{if(bridge)await bridge.close();if(previous===undefined)delete process.env.CODEX_CLI_PATH;else process.env.CODEX_CLI_PATH=previous;rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
