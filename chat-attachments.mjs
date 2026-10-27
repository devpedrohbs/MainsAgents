// Files the person attached to a chat message, as they reach the provider bridges (context items {kind, label, content=path}).
// Only absolute paths that still exist count; nothing is copied or uploaded. Images go to Codex as real image input, and
// Claude Code reads every attachment with its own tools once its folder is added to the run (--add-dir).
import {existsSync,statSync} from 'node:fs';
import {dirname,isAbsolute,resolve} from 'node:path';

export const IMAGE_ATTACHMENT=/\.(png|jpe?g|webp|gif)$/i;
const KINDS=new Set(['image','file','folder']);
const MAX_ATTACHMENTS=12;
const MAX_IMAGE_BYTES=20*1024*1024;

/** Attachments that are safe to hand to a provider: known kind, absolute, existing, of the declared type. */
export function chatAttachments(context){
 if(!Array.isArray(context))return [];
 const seen=new Set(),items=[];
 for(const item of context){
  if(items.length>=MAX_ATTACHMENTS)break;
  if(!item||!KINDS.has(item.kind)||typeof item.content!=='string'||!item.content||item.content.length>1024||!isAbsolute(item.content))continue;
  const path=resolve(item.content),key=path.toLowerCase();
  if(seen.has(key))continue;
  let stat;try{stat=statSync(path);}catch{continue;}
  if(item.kind==='folder'?!stat.isDirectory():!stat.isFile())continue;
  if(item.kind==='image'&&(!IMAGE_ATTACHMENT.test(path)||stat.size>MAX_IMAGE_BYTES))continue;
  seen.add(key);items.push({kind:item.kind,path});
 }
 return items;
}

/** Codex turn input for attached images (sent next to the text, which still names every path). */
export const codexImageInputs=context=>chatAttachments(context).filter(item=>item.kind==='image').map(item=>({type:'localImage',path:item.path}));

/** Folders Claude Code may read for this turn: each attached folder, or the folder that holds an attached file. */
export function attachmentDirectories(context){
 return [...new Map(chatAttachments(context).map(item=>{const dir=item.kind==='folder'?item.path:dirname(item.path);return [dir.toLowerCase(),dir];})).values()].filter(dir=>existsSync(dir)).slice(0,8);
}
