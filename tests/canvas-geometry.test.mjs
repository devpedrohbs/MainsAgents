import test from 'node:test';
import assert from 'node:assert/strict';
import {arrangeCanvasNodes,canvasNodeSize,findCanvasPosition} from '../src/components/canvas/canvasGeometry.ts';

const node=(id,x,y,width=280,height=240)=>({id,type:'note',position:{x,y},width,height,data:{label:id}});
test('new blocks are centered in the current viewport, including negative canvas coordinates',()=>{
  const position=findCanvasPosition([],{viewport:{x:1600,y:900,zoom:.5},width:1200,height:800},'browser');
  assert.deepEqual(position,{x:-2360,y:-1260});
});
test('placement accounts for full browser bounds instead of treating it as a small note',()=>{
  const existing=node('browser',0,0,1200,900);
  const point=findCanvasPosition([existing],{viewport:{x:0,y:0,zoom:1},width:1200,height:800},'note');
  assert(point.x>=1232||point.x+280<=-32||point.y>=932||point.y+240<=-32);
});
test('tidy uses real widths and row heights while leaving other nodes and data intact',()=>{
  const nodes=[node('a',10,20,720,520),node('b',200,40,280,240),node('c',40,70,420,560),node('other',50,90)];
  const arranged=arrangeCanvasNodes(nodes,new Set(['a','b','c']),'grid');
  assert.deepEqual(arranged.slice(0,3).map(node=>node.position),[{x:10,y:20},{x:762,y:20},{x:10,y:572}]);
  assert.equal(arranged[3],nodes[3]);assert.equal(arranged[0].data,nodes[0].data);
});
test('alignment preserves the other axis and persisted sizes override measurements',()=>{
  const nodes=[node('a',10,20),node('b',200,90)];
  assert.deepEqual(arrangeCanvasNodes(nodes,new Set(['a','b']),'left').map(node=>node.position),[{x:10,y:20},{x:10,y:90}]);
  assert.deepEqual(canvasNodeSize({...nodes[0],measured:{width:200,height:180}}),{width:280,height:240});
});
