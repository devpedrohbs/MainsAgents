import test from 'node:test';
import assert from 'node:assert/strict';
import {
 createGalleryState,defaultConcepts,updateConcept,applySource,recordArtifact,conceptSignature,isStale,selectConcept,
 canApprove,approve,isSafePreviewUrl,conceptErrors,canGenerate,
} from '../src/features/production/thumbnailGallery.ts';

const src=(versionId='v1',sha256='aa')=>({assetId:'a1',versionId,sha256});
const art=(s,state,conceptId='product',format='youtube')=>({
 conceptId,format,assetId:'out1',sha256:'ff',width:1280,height:720,sourceVersionId:s.versionId,sourceSha256:s.sha256,
 inputsSignature:conceptSignature(state.concepts.find(c=>c.id===conceptId),format,s),
});
const ready=()=>{
 const s=src();let st=createGalleryState(s,defaultConcepts(100).map(c=>({...c,title:`T ${c.id}`})));
 st=recordArtifact(st,s,art(s,st));
 return {s,st:selectConcept(st,'product')};
};

test('three visually distinct default concepts',()=>{
 const c=defaultConcepts(100);
 assert.deepEqual(c.map(x=>x.id),['product','person','benefit']);
 assert.equal(new Set(c.map(x=>JSON.stringify(x.framing))).size,3);
 assert.equal(new Set(c.map(x=>x.timestampSeconds)).size,3);
});

test('approval needs a current exported artifact; editing inputs makes it stale and withdraws approval',()=>{
 const {s,st}=ready();
 assert.equal(canApprove(st,s,'youtube',false),true);
 assert.equal(canApprove(st,s,'youtube',true),false); // busy
 assert.equal(canApprove(st,s,'reels',false),false);  // nothing exported for that format
 const approved=approve(st,s,'youtube');
 assert.equal(approved.approvedId,'product');
 for(const patch of [{title:'novo'},{kicker:'k'},{timestampSeconds:12},{framing:{focusX:.1,focusY:.5,zoom:1.2}}]){
  const edited=updateConcept(approved,'product',patch);
  assert.equal(isStale(edited,s,'product','youtube'),true,JSON.stringify(patch));
  assert.equal(edited.approvedId,null);
  assert.equal(canApprove(edited,s,'youtube',false),false);
 }
 assert.equal(approve(updateConcept(st,'product',{title:'x'}),s,'youtube').approvedId,null);
});

test('whitespace-only edits keep output current; other concepts are unaffected',()=>{
 const {s,st}=ready();
 assert.equal(isStale(updateConcept(st,'product',{title:'T product  '}),s,'product','youtube'),false);
 assert.equal(isStale(updateConcept(st,'person',{title:'z'}),s,'product','youtube'),false);
});

test('new source version invalidates selection, approval and artifacts; late results are ignored',()=>{
 const {s,st}=ready();
 const approved=approve(st,s,'youtube');
 const s2=src('v2','bb');
 const next=applySource(approved,s2);
 assert.equal(next.selectedId,null);assert.equal(next.approvedId,null);assert.deepEqual(next.artifacts,{});
 assert.equal(applySource(approved,s),approved); // same source: untouched
 const late=recordArtifact(next,s2,art(s,approved)); // produced from v1
 assert.deepEqual(late.artifacts,{});
 assert.equal(canApprove(approved,s2,'youtube',false),false);
});

test('selecting another concept clears approval of the previous one',()=>{
 const {s,st}=ready();
 const sel=selectConcept(approve(st,s,'youtube'),'person');
 assert.equal(sel.approvedId,null);
});

test('validation and generation gate',()=>{
 const [c]=defaultConcepts(60);
 assert.deepEqual(conceptErrors(c),['title']);
 assert.deepEqual(conceptErrors({...c,title:'x',timestampSeconds:70},60),['timestamp']);
 assert.equal(canGenerate({...c,title:'x'},false),true);
 assert.equal(canGenerate({...c,title:'x'},true),false);
});

test('only stream-style URLs are accepted for img',()=>{
 for(const ok of ['https://x/y.png','http://127.0.0.1:1/s/1','blob:abc','data:image/png;base64,AA'])assert.equal(isSafePreviewUrl(ok),true,ok);
 for(const bad of ['C:\\Users\\a\\b.png','c:/a.png','\\\\srv\\s\\a.png','file:///a.png','/home/a.png','',null,undefined])assert.equal(isSafePreviewUrl(bad),false,String(bad));
});
