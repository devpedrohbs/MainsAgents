import { open, realpath } from 'node:fs/promises';
import { basename, extname, isAbsolute, normalize } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
const kinds = { video:['.mp4','.mov','.mkv','.webm','.avi','.m4v'], image:['.png','.jpg','.jpeg','.webp','.gif','.avif','.heic'], audio:['.mp3','.wav','.m4a','.aac','.ogg','.flac'], document:['.pdf','.txt','.md','.docx','.pptx','.xlsx','.csv','.srt','.vtt'] };
export const assetExtensions = Object.values(kinds).flat().map(value => value.slice(1));
export function localAssetPath(value) {
  if (typeof value !== 'string' || value.length > 4096 || !isAbsolute(value) || /[\0\r\n]/.test(value) || /^[\\/]{2}/.test(value) || (process.platform === 'win32' && value.slice(2).includes(':'))) throw new Error('Select a local file on this computer. Network, device and executable paths are not supported.');
  const path = normalize(value);
  if (!assetExtensions.includes(extname(path).toLowerCase().slice(1))) throw new Error('This file type is not supported. Select video, image, audio or a document.');
  return path;
}
const sameFile = (a,b) => a.size===b.size && a.mtimeMs===b.mtimeMs && a.ctimeMs===b.ctimeMs && a.ino===b.ino && a.dev===b.dev;
/** Read-only, bounded memory. Does not copy, execute, upload or scan directories. */
export async function inspectLocalAsset(value, { stabilityMs=700 }={}) {
  const checkedAt=new Date().toISOString(); let handle,path;
  try {
    path=localAssetPath(value); path=localAssetPath(await realpath(path)); handle=await open(path,'r');
    const before=await handle.stat(); if(!before.isFile())throw new Error('Select a file, not a directory.');
    await delay(stabilityMs);
    if(!sameFile(before,await handle.stat()))return {path,checkedAt,status:'unstable',error:'The file is still changing. Wait for copying or export to finish, then verify again.'};
    const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024); let size=0;
    while(size<before.size){const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,before.size-size),null);if(!bytesRead)break;size+=bytesRead;hash.update(buffer.subarray(0,bytesRead));}
    const after=await handle.stat(),reopened=await open(path,'r');
    try{if(!sameFile(before,after)||!sameFile(after,await reopened.stat())||size!==before.size)return {path,checkedAt,status:'unstable',error:'The file changed during verification. Try again when copying or export has finished.'};}finally{await reopened.close();}
    const kind=Object.entries(kinds).find(([,extensions])=>extensions.includes(extname(path).toLowerCase()))[0];
    return {path,name:basename(path),kind,size,sha256:hash.digest('hex'),modifiedAt:after.mtime.toISOString(),checkedAt:new Date().toISOString(),status:'available'};
  }catch(error){return {path:path??(typeof value==='string'?value:''),checkedAt,status:error.code==='ENOENT'?'missing':'error',error:error.code==='ENOENT'?'The file was moved or removed. Locate it again.':error.code==='EACCES'||error.code==='EPERM'?'The file cannot be read. Check its permissions.':error.message};}
  finally{await handle?.close();}
}
