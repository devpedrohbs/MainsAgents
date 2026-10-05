import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createChatImageArtifacts,isImageGenerationItem,imageGenerationInstructions} from '../chat-image-artifacts.mjs';
import {attachChatImage,chatImageSource} from '../src/features/chat/chatImages.ts';
import {embedChatImages} from '../src/data/chatImageBackup.ts';
import {parseBackup} from '../src/data/backupFormat.ts';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ9sAAAAASUVORK5CYII=';
const generated=(type='imageGeneration')=>({type,...(type==='Extension'?{kind:'image_gen.generation'}:{}),id:'image-1',status:'completed',result:png,revisedPrompt:'An actual generated image'});

test('native images and extension images are saved identically and survive reopening the store',()=>{
 const directory=mkdtempSync(join(tmpdir(),'mains-images-'));
 try{
  const store=createChatImageArtifacts(directory),event=store.fromItem(generated(),'turn-1');
  assert.equal(event.type,'image.completed');assert.equal(store.fromItem(generated('Extension'),'turn-1').image.url,event.image.url);
  const reopened=createChatImageArtifacts(directory),file=event.image.url.split('/').at(-1);
  assert.equal(reopened.read(file).bytes.toString('base64'),png);
  assert.throws(()=>reopened.read('../account.json'),/Invalid image/);
  assert(isImageGenerationItem(generated('Extension')));
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('failed or invalid generation produces an explicit error instead of an empty image',()=>{
 const directory=mkdtempSync(join(tmpdir(),'mains-images-'));
 try{
  const store=createChatImageArtifacts(directory);
  assert.equal(store.fromItem({...generated(),status:'in_progress',result:''},'turn'),null);
  assert.equal(store.fromItem({...generated(),status:'failed',failure:{type:'usageLimitExceeded'}},'turn').type,'image.failed');
  assert.equal(store.fromItem({...generated(),result:Buffer.from('<svg/>').toString('base64')},'turn').type,'image.failed');
  assert.equal(store.fromItem({...generated(),result:'https://example.com/image.png'},'turn').type,'image.failed');
  assert.equal(store.fromItem({type:'imageView',path:'private.png'},'turn'),null);
  assert.match(imageGenerationInstructions,/separately billed API/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('media attaches before or after text, replay is idempotent, and unsafe sources are ignored',()=>{
 const image={id:'image-1',url:`/api/codex/images/${'a'.repeat(64)}.png`,mimeType:'image/png',filename:'image.png',alt:'Image'};
 const session={id:'s',agentId:'a',title:'Images',messages:[],createdAt:'now',updatedAt:'now'};
 const first=attachChatImage(session,'turn',image);
 assert.equal(first.messages[0].content,'');assert.equal(first.messages[0].images.length,1);
 assert.equal(attachChatImage(first,'turn',image),first);
 const withText={...first,messages:first.messages.map(m=>({...m,content:'Your image'}))};
 assert.equal(attachChatImage(withText,'turn',{...image,id:'image-2'}).messages[0].content,'Your image');
 assert.equal(chatImageSource({...image,url:'file:///C:/private.png'}),undefined);
 assert.equal(chatImageSource({...image,url:'https://tracker.example/img.png'}),undefined);
 assert.equal(chatImageSource({...image,dataUrl:'data:image/svg+xml;base64,PHN2Zy8+'}),image.url);
 assert.equal(attachChatImage(session,'turn',{...image,url:'javascript:alert(1)'}),session);
});

test('portable backup embeds images once for chats and Canvas without mutating live state',async()=>{
 const image={id:'image-1',url:`/api/codex/images/${'a'.repeat(64)}.png`,mimeType:'image/png',filename:'image.png',alt:'Image'};
 const original={sessions:[{id:'s',agentId:'a',title:'Image',messages:[{id:'m',type:'message',role:'agent',content:'Result',images:[image]}]}],'canvas-workspaces':{w:{nodes:[{id:'n',data:{imageUrl:image.url}}],edges:[]}}};
 let calls=0;
 const data=await embedChatImages(original,async()=>{calls++;return `data:image/png;base64,${png}`;});
 assert.equal(calls,1);assert.equal(original.sessions[0].messages[0].images[0].dataUrl,undefined);
 const backup=parseBackup(JSON.stringify({format:'mainsagents-backup',version:1,exportedAt:'now',data}));
 assert.equal(chatImageSource(backup.data.sessions[0].messages[0].images[0]),`data:image/png;base64,${png}`);
 assert.equal(backup.data['canvas-workspaces'].w.nodes[0].data.imageUrl,`data:image/png;base64,${png}`);
});
