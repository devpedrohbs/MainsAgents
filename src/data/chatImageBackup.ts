import type {AgentSession} from '../features/chat/model/Chat';
import {chatImageSource} from '../features/chat/chatImages.ts';

export async function embedChatImages(data:Record<string,unknown>,readImage:(url:string)=>Promise<string>):Promise<Record<string,unknown>> {
  const copy=structuredClone(data),cache=new Map<string,Promise<string>>();
  const embed=(url:string)=>{if(!cache.has(url))cache.set(url,readImage(url));return cache.get(url)!;};
  for(const session of (copy.sessions??[]) as AgentSession[])for(const message of session.messages){
    if(message.type!=='message')continue;
    for(const image of message.images??[]){const source=chatImageSource(image);if(source?.startsWith('/api/codex/images/'))image.dataUrl=await embed(source);}
  }
  for(const state of Object.values(copy['canvas-workspaces']??{}) as {nodes?:{data:{imageUrl?:string}}[]}[])for(const node of state.nodes??[]){
    if(node.data.imageUrl&&/^\/api\/codex\/images\/[a-f0-9]{64}\.(?:png|jpg|webp)$/.test(node.data.imageUrl))node.data.imageUrl=await embed(node.data.imageUrl);
  }
  return copy;
}

export async function readChatImageDataUrl(url:string):Promise<string>{
  const response=await fetch(url);
  if(!response.ok)throw new Error('Could not include a generated image in the backup. Reopen its chat and try again.');
  const blob=await response.blob();
  if(!['image/png','image/jpeg','image/webp'].includes(blob.type)||blob.size>32*1024*1024)throw new Error('Invalid generated image in backup.');
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Could not read a generated image for backup.'));reader.readAsDataURL(blob);});
}
