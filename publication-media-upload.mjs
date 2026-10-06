import {open,realpath,mkdtemp,rm} from 'node:fs/promises';
import {extname,join,resolve,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {localAssetPath,inspectLocalAsset} from './editorial-local-files.mjs';

const formats={'.jpg':['image','image/jpeg'],'.jpeg':['image','image/jpeg'],'.png':['image','image/png'],'.webp':['image','image/webp'],'.mp4':['video','video/mp4'],'.mov':['video','video/quicktime'],'.webm':['video','video/webm']};
export function publicationFiles(state,delivery){
 return [...delivery.media,...(delivery.cover?[delivery.cover]:[])].map(ref=>{
  const asset=state.assets?.find(a=>a.id===ref.assetId&&a.workspaceId===delivery.workspaceId&&a.contentId===delivery.contentId),v=asset?.versions.find(v=>v.id===asset.currentVersionId);
  if(asset?.status!=='available'||v?.id!==ref.versionId||v.sha256!==ref.sha256)throw Error('A linked file changed. Review the delivery again.');
  const format=formats[extname(v.path).toLowerCase()];
  if(!format||!v.size)throw Error('Use a nonempty JPEG, PNG, WebP, MP4, MOV or WebM file.');
  return {...ref,...(ref.assetId===delivery.cover?.assetId?{purpose:'cover'}:{}),name:v.name,size:v.size,type:format[0],contentType:format[1],path:localAssetPath(v.path)};
 });
}
export function validatePublicationFiles(files,platform,settings={}){
 const covers=files.filter(f=>f.purpose==='cover');files=files.filter(f=>f.purpose!=='cover');
 if(covers.length&&(covers.length!==1||files.length!==1||files[0].type!=='video'||settings.contentType==='story'||!['image/png','image/jpeg'].includes(covers[0].contentType)||covers[0].size>8*1024*1024))throw Error('A capa deve ser PNG/JPEG até 8 MB, para uma publicação com um vídeo.');
 if(platform==='Instagram'){
  if(!files.length||files.length>10||files.some(f=>!['image/jpeg','image/png','video/mp4','video/quicktime'].includes(f.contentType)||f.size>(f.type==='image'?8:300)*1024*1024))throw Error('Instagram requires 1–10 JPEG/PNG images (8 MB each) or MP4/MOV videos (300 MB each).');
  if(settings.contentType==='story'&&(files.length!==1||files[0].size>100*1024*1024))throw Error('An Instagram Story requires one file, at most 100 MB.');
 }else if(platform==='TikTok'){
  if(!files.length||files.length>30||files.some(f=>f.size>(f.type==='image'?20:4096)*1024*1024)||files.some(f=>f.type==='video')&&(files.length!==1))throw Error('TikTok requires photos (20 MB each) or one video (4 GB). Do not mix media types.');
 }else if(platform==='LinkedIn'){
  if(files.length>9||files.some(f=>f.type==='video')&&files.length!==1||files.some(f=>f.size>(f.type==='image'?25:150)*1024*1024))throw Error('Use up to nine images (25 MB each) or one video (150 MB) for LinkedIn.');
 }else throw Error('This network is not supported by the native publishing connector.');
}
export async function checkPublicationFiles(files){
 for(const file of files){const current=await inspectLocalAsset(file.path,{stabilityMs:0});if(current.status!=='available'||current.sha256!==file.sha256||current.size!==file.size)throw Error('A file changed on disk. No post was submitted. Review its new version.');}
}
export function uploadDestination(value){
 let u;try{u=new URL(value)}catch{throw Error('Invalid provider upload destination.')}
 const h=u.hostname.toLowerCase();
 if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||!(h==='media.zernio.com'||h.endsWith('.s3.amazonaws.com')||/\.s3[.-][a-z0-9-]+\.amazonaws\.com$/.test(h)||h.endsWith('.r2.cloudflarestorage.com')))throw Error('Unsupported provider storage host. Upload was blocked.');
 return u;
}
/** Stream from a verified file handle. Signed URLs and credentials never enter saved state. */
export async function uploadPublicationFile(file,url,{fetchImpl=fetch}={}){
 const destination=uploadDestination(url);await checkPublicationFiles([file]);
 const handle=await open(localAssetPath(await realpath(file.path)),'r');
 let directory,snapshot,stream;
 try{
  const before=await handle.stat(),hash=createHash('sha256');let size=0;
  directory=await mkdtemp(join(tmpdir(),'mainsagents-approved-upload-'));snapshot=await open(join(directory,'bytes'),'wx+',0o600);
  const buffer=Buffer.allocUnsafe(64*1024);
  while(size<before.size){const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,before.size-size),null);if(!bytesRead)break;hash.update(buffer.subarray(0,bytesRead));let written=0;while(written<bytesRead){const result=await snapshot.write(buffer,written,bytesRead-written,size+written);if(!result.bytesWritten)throw Error('Could not preserve approved upload bytes.');written+=result.bytesWritten;}size+=bytesRead;}
  const copied=await handle.stat();
  if(size!==file.size||hash.digest('hex')!==file.sha256||before.size!==copied.size||before.mtimeMs!==copied.mtimeMs||before.ctimeMs!==copied.ctimeMs)throw Error('The file changed before upload. No file bytes were sent.');
  let sent=0;
  stream=Readable.from((async function*(){const buffer=Buffer.allocUnsafe(64*1024);while(sent<file.size){const {bytesRead}=await snapshot.read(buffer,0,Math.min(buffer.length,file.size-sent),sent);if(!bytesRead)break;sent+=bytesRead;yield Buffer.from(buffer.subarray(0,bytesRead));}})());
  let response;try{response=await fetchImpl(destination,{method:'PUT',redirect:'error',headers:{'content-type':file.contentType,'content-length':String(file.size)},body:stream,duplex:'half',signal:AbortSignal.timeout(600000)});}catch{stream.destroy();throw Error('Media upload was not confirmed. No automatic retry was made.');}
  if(!response.ok||sent!==file.size)throw Error('Media upload or file integrity was not confirmed.');
  await response.body?.cancel();await checkPublicationFiles([file]);
 }finally{stream?.destroy();await handle.close();await snapshot?.close();if(directory){const target=resolve(directory);if(dirname(target)!==resolve(tmpdir())||!basename(target).startsWith('mainsagents-approved-upload-'))throw Error('Unsafe upload cleanup path.');await rm(target,{recursive:true,force:true});}}
}
