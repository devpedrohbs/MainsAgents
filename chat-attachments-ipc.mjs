/**
 * Chat attachments for the trusted app window: native pickers (photos, any file, a folder), a small preview for each picked
 * path, and saving an image pasted from the clipboard. Files stay where they are; only a pasted image is written, into the
 * app's own folder, because it has no path yet.
 */
import {randomBytes} from 'node:crypto';
import {mkdirSync,statSync,writeFileSync} from 'node:fs';
import {basename,extname,isAbsolute,join,resolve} from 'node:path';

export const attachmentVideo=/\.(mp4|mov|m4v|mkv|webm|avi)$/i;
export const attachmentImage=/\.(png|jpe?g|webp|gif)$/i;
const pastedTypes={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'};
const MAX_PASTED=20*1024*1024,MAX_PATHS=12;

export function attachmentKind(path,stat){
 if(stat.isDirectory())return 'folder';
 return attachmentImage.test(path)?'image':attachmentVideo.test(path)?'video':'file';
}

export function registerChatAttachmentsIpc({ipcMain,dialog,nativeImage,getWindow,directory}){
 const trusted=event=>{if(event.sender!==getWindow()?.webContents||event.senderFrame&&event.senderFrame!==event.sender.mainFrame)throw new Error('Untrusted application window');};
 const pickers={
  images:{title:'Anexar fotos à conversa',properties:['openFile','multiSelections'],filters:[{name:'Imagens',extensions:['png','jpg','jpeg','webp','gif']}]},
  files:{title:'Anexar arquivos à conversa',properties:['openFile','multiSelections']},
  folder:{title:'Anexar uma pasta à conversa',properties:['openDirectory']},
 };
 ipcMain.handle('files:select-attachments',async(event,kind)=>{
  trusted(event);const options=pickers[kind];if(!options)throw new Error('Unknown attachment picker.');
  const result=await dialog.showOpenDialog(getWindow(),options);return result.canceled?[]:result.filePaths.slice(0,MAX_PATHS);
 });
 // Name, size, kind and (for images) a small JPEG preview; paths that vanished are left out.
 ipcMain.handle('files:attachment-info',(event,paths)=>{
  trusted(event);if(!Array.isArray(paths))return [];
  const items=[];
  for(const raw of paths.slice(0,MAX_PATHS)){
   if(typeof raw!=='string'||!raw||raw.length>1024||!isAbsolute(raw))continue;
   const path=resolve(raw);let stat;try{stat=statSync(path);}catch{continue;}
   const kind=attachmentKind(path,stat);let thumbnail;
   if(kind==='image'&&nativeImage){try{const image=nativeImage.createFromPath(path);if(!image.isEmpty()){const size=image.getSize(),scale=Math.min(1,160/Math.max(size.width,size.height));thumbnail=`data:image/jpeg;base64,${image.resize({width:Math.max(1,Math.round(size.width*scale)),height:Math.max(1,Math.round(size.height*scale)),quality:'good'}).toJPEG(72).toString('base64')}`;}}catch{/* no preview; the file is still attached */}}
   items.push({path,name:basename(path)||path,kind,size:kind==='folder'?undefined:stat.size,...(thumbnail?{thumbnail}:{})});
  }
  return items;
 });
 ipcMain.handle('files:save-pasted',(event,bytes,type)=>{
  trusted(event);const ext=pastedTypes[type];if(!ext)throw new Error('Only PNG, JPG, WebP or GIF images can be pasted.');
  const data=bytes instanceof Uint8Array?bytes:bytes instanceof ArrayBuffer?new Uint8Array(bytes):null;
  if(!data||!data.byteLength||data.byteLength>MAX_PASTED)throw new Error('The pasted image is empty or larger than 20 MB.');
  const folder=directory();mkdirSync(folder,{recursive:true});
  const stamp=new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
  const path=join(folder,`colado-${stamp}-${randomBytes(3).toString('hex')}.${ext}`);
  writeFileSync(path,data,{flag:'wx'});
  return extname(path)?path:'';
 });
}
