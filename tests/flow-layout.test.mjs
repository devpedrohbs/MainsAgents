import {test} from 'node:test';
import assert from 'node:assert/strict';
import {arrangeRelations} from '../src/components/canvas/flowLayout.ts';
test('flow view preserves Canvas positions and arranges parallel branches before review',()=>{
 const nodes=['start','research','writer','visual','review'].map((id,index)=>({id,position:{x:index,y:index}}));
 const snapshot=structuredClone(nodes);
 const edges=[['start','research'],['research','writer'],['research','visual'],['writer','review'],['visual','review']].map(([source,target])=>({source,target}));
 const layout=arrangeRelations(nodes,edges),byId=new Map(layout.map(n=>[n.id,n]));
 assert.deepEqual(nodes,snapshot);
 assert.equal(byId.get('writer').position.y,byId.get('visual').position.y);
 assert.notEqual(byId.get('writer').position.x,byId.get('visual').position.x);
 assert(byId.get('review').position.y>byId.get('writer').position.y);
});
test('flow view handles cycles and missing edge endpoints without overlapping nodes',()=>{
 const nodes=['a','b','c'].map(id=>({id,position:{x:0,y:0}}));
 const layout=arrangeRelations(nodes,[{source:'a',target:'b'},{source:'b',target:'a'},{source:'missing',target:'c'}]);
 assert.equal(new Set(layout.map(n=>`${n.position.x}:${n.position.y}`)).size,3);
 assert(layout.every(n=>Number.isFinite(n.position.x)&&Number.isFinite(n.position.y)));
});
