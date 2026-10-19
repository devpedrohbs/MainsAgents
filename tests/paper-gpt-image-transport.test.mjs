import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,copyFileSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createChatImageArtifacts} from '../chat-image-artifacts.mjs';
import {paperAssetUrl,paperAssetReferences,createVerifiedImageIndex,paperImageInstructions,paperGeneratedLayerName} from '../paper-image-assets.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ9sAAAAASUVORK5CYII=','base64');
const windows=process.platform==='win32';

test('paper-asset URLs use Paper\'s documented absolute-path scheme',()=>{
 if(windows){
  // Shape verified live: Paper Desktop rendered paper-asset:///C:/Users/.../<sha>.png on 2026-10-13.
  assert.equal(paperAssetUrl('C:\\Users\\pacas\\.mainsagents\\storage\\images\\abc.png'),'paper-asset:///C:/Users/pacas/.mainsagents/storage/images/abc.png');
  assert.equal(paperAssetUrl('C:\\My Files\\a#b.png'),'paper-asset:///C:/My%20Files/a%23b.png');
 }else assert.equal(paperAssetUrl('/Users/name/image.png'),'paper-asset:///Users/name/image.png');
 assert.throws(()=>paperAssetUrl('relative.png'));
});

test('every spelling of a paper-asset reference is found; unreadable ones mark the call incomplete',()=>{
 const target=windows?'C:/Images/bg.png':'/images/bg.png',normalized=join(target);
 const html=`<img layer-name="${paperGeneratedLayerName}" src="paper-asset:///${target.replace(/^\//,'')}" style="position:absolute">`;
 assert.deepEqual(paperAssetReferences({html}).paths,[normalized]);
 assert.deepEqual(paperAssetReferences({updates:[{styles:{backgroundImage:`url(paper-asset:///${target.replace(/^\//,'')})`}}]}).paths,[normalized]);
 const escaped=paperAssetReferences({html:`<img src="\\u0070aper-asset:///${target.replace(/^\//,'')}">`});
 assert.deepEqual(escaped.paths,[normalized]);assert.equal(escaped.complete,true);
 assert.equal(paperAssetReferences({html:'<img src="paper-asset://relative/x.png">'}).complete,false);
 assert.deepEqual(paperAssetReferences({html:'<div>Texto editável</div>'}),{paths:[],complete:true});
});

function library(){
 const root=mkdtempSync(join(tmpdir(),'paper-gpt-images-')),images=join(root,'images'),generated=join(root,'generated_images'),elsewhere=join(root,'elsewhere');
 for(const dir of [images,join(generated,'thread'),elsewhere])mkdirSync(dir,{recursive:true});
 const artifacts=createChatImageArtifacts(images);
 // The real Codex item shape: result (base64) + savedPath; the host keeps its own content-addressed copy.
 const savedPath=join(generated,'thread','exec-1.png');writeFileSync(savedPath,png);
 const event=artifacts.fromItem({type:'imageGeneration',id:'exec-1',status:'completed',result:png.toString('base64'),savedPath},'turn');
 return {root,images,generated,elsewhere,savedPath,hostPath:artifacts.pathForImage(event.image),index:createVerifiedImageIndex({imagesDirectory:images,generatedRoots:[generated]})};
}

test('only images the host saved from a native result are vouched for',()=>{
 const f=library();try{
  const sha=createHash('sha256').update(png).digest('hex');
  assert.deepEqual({ok:f.index.verify(f.hostPath).ok,sha:f.index.verify(f.hostPath).sha256},{ok:true,sha});
  assert.equal(f.index.verify(f.savedPath).ok,true,'the native tool output path is accepted when its bytes match the host copy');
  assert.equal(f.index.verify(f.savedPath).hostPath,f.hostPath);
  const copy=join(f.elsewhere,'copy.png');copyFileSync(f.savedPath,copy);
  assert.equal(f.index.verify(copy).ok,false,'identical bytes outside the generated folders are not a generated image');
  const unknown=join(f.generated,'thread','exec-2.png');writeFileSync(unknown,Buffer.concat([png,Buffer.from([0])]));
  assert.equal(f.index.verify(unknown).ok,false,'a file the host never saved is rejected');
  assert.equal(f.index.verify(join(f.images,'missing.png')).ok,false);
  const ok=f.index.check({html:`<img src="${paperAssetUrl(f.savedPath)}">`});
  assert.equal(ok.ok,true);assert.equal(ok.images[0].sha256,sha);
  const bad=f.index.check({html:`<img src="${paperAssetUrl(f.savedPath)}"><img src="${paperAssetUrl(copy)}">`});
  assert.equal(bad.ok,false);
  assert.equal(f.index.check({html:'<div>só texto</div>'}).ok,true);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('Codex sessions of a Paper-enabled agent get the native image to Paper instructions; others do not',()=>{
 const paperDesign={enabled:true,automatic:false,fileId:'01M4V841P4WXN0HWA5BH326JKM',fileName:'Joyful olive',signature:'',visualStyle:''};
 const text=paperImageInstructions({providerId:'codex',paperDesign});
 assert.match(text,/native image tool/);assert.match(text,/paper-asset:\/\/\//);assert.match(text,/insert-children/);
 assert.match(text,/never paper-gen:\/\//);assert.match(text,/Never send base64, data: URIs or app URLs/);assert.match(text,/never invent or guess a path/);
 assert.equal(paperImageInstructions({providerId:'claude',paperDesign}),'','Claude has no native image tool');
 assert.equal(paperImageInstructions({providerId:'codex',paperDesign:{...paperDesign,enabled:false}}),'');
});
