import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContentWorkflowBridge } from '../content-workflow-bridge.mjs';
import { validateResearch, validateScriptOptions } from '../src/features/content/model.ts';

async function call(bridge, method, body) {
  const request=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);
  request.method=method;
  const response={status:0,data:null,writeHead(status){this.status=status},end(value){this.data=JSON.parse(value)}};
  await bridge.handle(request,response,new URL('http://127.0.0.1/api/content/state?profile=test-user'));
  return response;
}

test('editorial SQLite state survives reopening and rejects stale revisions',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'mainsagents-editorial-'));
  const dbPath=join(directory,'editorial.sqlite');
  let bridge=createContentWorkflowBridge({dbPath});
  try{
    const initial=await call(bridge,'GET');
    assert.equal(initial.status,200);
    assert.equal(initial.data.revision,0);
    const state={...initial.data.state,topics:[{id:'topic-1',workspaceId:'content',title:'AI news'}]};
    const saved=await call(bridge,'PUT',{revision:0,state});
    assert.equal(saved.status,200);
    assert.equal(saved.data.revision,1);
    const conflict=await call(bridge,'PUT',{revision:0,state:{...state,topics:[]}});
    assert.equal(conflict.status,409);
    bridge.close();
    bridge=createContentWorkflowBridge({dbPath});
    const loaded=await call(bridge,'GET');
    assert.equal(loaded.data.revision,1);
    assert.equal(loaded.data.state.topics[0].id,'topic-1');
  }finally{bridge.close();rmSync(directory,{recursive:true,force:true})}
});

test('structured research requires sources and angles',()=>{
  const valid=JSON.stringify({topics:[{title:'A tool changed',category:'AI',summary:'A concrete change with a useful explanation.',whyItMatters:'It affects a broad audience.',angles:['technical','everyday use'],sources:[{title:'Original announcement',url:'https://example.com/news'}],factualQuestions:[]}]});
  assert.equal(validateResearch(valid)[0].sources[0].url,'https://example.com/news');
  assert.throws(()=>validateResearch(valid.replace('https://example.com/news','javascript:alert(1)')),/source URL/i);
  assert.throws(()=>validateResearch('{"topics":[{"title":"Unsourced"}]}'),/sources/i);
  assert.throws(()=>validateResearch(valid,3),/at least 3/i);
});

test('script options require the choices before an approval can be shown',()=>{
  const valid={hooks:['Hook A','Hook B','Hook C'],ctas:['CTA A','CTA B'],paths:[{title:'Path A',outline:'A detailed narrative with a clear start and finish.'},{title:'Path B',outline:'Another detailed narrative with a different angle.'}],improvisationTopics:['Fact','Example'],thumbnailDirection:'Face and short headline',draftScript:'An opening that states the event and stakes, followed by context and examples. This is a full draft that a creator can adapt before approving.'};
  assert.equal(validateScriptOptions(JSON.stringify(valid)).hooks.length,3);
  assert.throws(()=>validateScriptOptions(JSON.stringify({...valid,hooks:['only one']})),/at least 3 hooks/i);
});
