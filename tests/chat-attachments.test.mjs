import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {attachmentDirectories,chatAttachments,codexImageInputs} from '../chat-attachments.mjs';
import {attachmentKind} from '../chat-attachments-ipc.mjs';

const dir=mkdtempSync(join(tmpdir(),'ma-attach-')),photo=join(dir,'capa.png'),doc=join(dir,'roteiro.pdf'),folder=join(dir,'pasta');
writeFileSync(photo,'png');writeFileSync(doc,'pdf');mkdirSync(folder);

test('only existing absolute attachments of the declared kind reach the providers',()=>{
 const items=chatAttachments([
  {kind:'image',label:'capa',content:photo},{kind:'file',label:'doc',content:doc},{kind:'folder',label:'pasta',content:folder},
  {kind:'image',label:'not an image',content:doc},{kind:'folder',label:'not a folder',content:doc},{kind:'file',label:'missing',content:join(dir,'nada.txt')},
  {kind:'file',label:'relative',content:'roteiro.pdf'},{kind:'note',label:'canvas',content:photo},{kind:'image',label:'duplicate',content:photo.toUpperCase()},
 ]);
 assert.deepEqual(items.map(item=>[item.kind,item.path]),[['image',photo],['file',doc],['folder',folder]]);
});

test('Codex gets attached images as local image input; Claude gets each attachment folder once',()=>{
 const context=[{kind:'image',content:photo},{kind:'file',content:doc},{kind:'folder',content:folder},{kind:'file',content:join(dir,'nada','x.txt')}];
 assert.deepEqual(codexImageInputs(context),[{type:'localImage',path:photo}]);
 assert.deepEqual(attachmentDirectories(context),[dir,folder]);
 assert.deepEqual(codexImageInputs(undefined),[]);
});

test('picked paths are classified by what they are on disk',()=>{
 const file={isDirectory:()=>false},directory={isDirectory:()=>true};
 assert.equal(attachmentKind('a.JPG',file),'image');assert.equal(attachmentKind('a.mov',file),'video');
 assert.equal(attachmentKind('a.xlsx',file),'file');assert.equal(attachmentKind('a.png',directory),'folder');
});
