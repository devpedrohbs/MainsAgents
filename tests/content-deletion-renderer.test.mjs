import test from 'node:test';
import assert from 'node:assert/strict';
import {PersistentState} from '../src/data/PersistentState.ts';
import {sanitizeLinkedValue} from '../content-deletion-model.mjs';
import {mergeProductionSessions} from '../src/features/production/model.ts';

const at='2026-10-15T10:00:00.000Z';
const chat=(id,contentId)=>({id,agentId:'source',title:'Linkedin',...(contentId?{contentId}:{}),messages:[],createdAt:at,updatedAt:at});
function memoryStore(values){const writes=[];return {writes,readAll:async()=>structuredClone(values),write:async(key,value)=>{writes.push([key,value]);},writeSync:(key,value)=>{writes.push([key,value]);}};}

test('adopted host values replace memory without another write; the filter drops deleted chats from late updates',async()=>{
 const store=memoryStore({sessions:[chat('a','content-a'),chat('b','content-b')]});
 const state=new PersistentState(store,()=>{});await state.restore();
 let notified=0;state.subscribe('sessions',()=>notified++);
 const deleted={sessions:new Set(['a']),contents:new Set(['content-a'])};
 state.setFilter((key,value)=>sanitizeLinkedValue(key,value,deleted));
 state.adopt({sessions:[chat('b','content-b')]});
 assert.equal(store.writes.length,0,'committed by the host: never written again');assert.equal(notified,1);
 // A production poll that started before the deletion tries to bring the chat back.
 const run={id:'run-a',workspaceId:'space',contentId:'content-a',sourceSession:{...chat('a','content-a'),messages:[{id:'production:run-a:1',type:'message',role:'agent',content:'x',createdAt:at}]},editorSession:chat('a-ed','content-a')};
 state.set('sessions',current=>mergeProductionSessions(current,[run],[{id:'source',workspaceId:'space'}]));
 assert.deepEqual(state.get('sessions',[]).map(s=>s.id),['b']);
 assert.deepEqual(store.writes.at(-1)?.[1]?.map(s=>s.id)??['b'],['b']);
});
