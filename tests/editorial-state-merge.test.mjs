import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeEditorialState} from '../editorial-state-merge.mjs';
import {EditorialStateClient} from '../src/features/content/EditorialStateClient.ts';
const empty=()=>({schemaVersion:1,topics:[{id:'topic',title:'Original',status:'researching'}],contents:[],runs:[],artifacts:[],approvals:[]});
test('three-way editorial merge preserves independent local edits and worker results',()=>{
  const base=empty(),local=structuredClone(base),remote=structuredClone(base);local.topics[0].title='My edit';remote.topics[0].status='review';remote.artifacts.push({id:'answer',data:'Research'});
  const result=mergeEditorialState(base,local,remote);assert.equal(result.topics[0].title,'My edit');assert.equal(result.topics[0].status,'review');assert.equal(result.artifacts[0].id,'answer');
  remote.topics[0].title='Concurrent title';assert.throws(()=>mergeEditorialState(base,local,remote),/edits were preserved/);assert.equal(local.topics[0].title,'My edit');
});
test('a worker result that races a save merges into SQLite without dropping user changes',async()=>{
  let disk=empty(),revision=1;const client=new EditorialStateClient('/state',async(_url,init)=>{if(!init?.method)return Response.json({state:disk,revision});const input=JSON.parse(init.body);if(input.revision!==revision)return Response.json({error:'Conflict'},{status:409});disk=input.state;revision++;return Response.json({revision})});
  await client.load();disk=structuredClone(disk);disk.topics[0].status='review';disk.artifacts.push({id:'answer'});revision++;
  await client.update(state=>({...state,topics:state.topics.map(item=>({...item,title:'My edit'}))}));assert.equal(disk.topics[0].title,'My edit');assert.equal(disk.topics[0].status,'review');assert.equal(disk.artifacts[0].id,'answer');assert.equal(client.pending(),false);
});
test('conflicting worker and user edits remain pending rather than overwriting either version',async()=>{
  let disk=empty(),revision=1;const client=new EditorialStateClient('/state',async(_url,init)=>{if(!init?.method)return Response.json({state:disk,revision});return Response.json({error:'Conflict'},{status:409})});await client.load();disk=structuredClone(disk);disk.topics[0].title='Remote title';revision++;
  await assert.rejects(client.update(state=>({...state,topics:state.topics.map(item=>({...item,title:'Local title'}))})),/edits were preserved/);assert.equal(client.pending(),true);assert.equal(client.snapshot().topics[0].title,'Local title');assert.equal(disk.topics[0].title,'Remote title');await client.refresh();assert.equal(client.snapshot().topics[0].title,'Local title');
});
test('polling cannot replace an edit made while a refresh was in flight',async()=>{
  let disk=empty(),revision=1,release,delayed=false;const client=new EditorialStateClient('/state',async(_url,init)=>{if(!init?.method){if(delayed)return new Promise(resolve=>{release=()=>resolve(Response.json({state:empty(),revision:2}))});return Response.json({state:disk,revision})}const input=JSON.parse(init.body);disk=input.state;revision=3;return Response.json({revision})});await client.load();delayed=true;const refresh=client.refresh();await client.update(state=>({...state,topics:state.topics.map(item=>({...item,title:'New title'}))}));release();await refresh;assert.equal(client.snapshot().topics[0].title,'New title');assert.equal(client.revision,3);
});
