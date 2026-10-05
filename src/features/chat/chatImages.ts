import type {AgentSession,ChatImageAttachment,ChatMessageItem} from './model/Chat';

export function chatImageSource(image:ChatImageAttachment):string|undefined {
  if(image.dataUrl&&/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.dataUrl))return image.dataUrl;
  if(/^\/api\/codex\/images\/[a-f0-9]{64}\.(?:png|jpg|webp)$/.test(image.url))return image.url;
  return undefined;
}

/** Text and media may arrive in either order, and history may replay a media event. */
export function attachChatImage(session:AgentSession,executionId:string,image:ChatImageAttachment):AgentSession {
  if(!chatImageSource(image))return session;
  const id=`codex-${executionId}`,existing=session.messages.find(item=>item.id===id&&item.type==='message') as ChatMessageItem|undefined;
  if(existing?.images?.some(item=>item.id===image.id))return session;
  const message:ChatMessageItem=existing?{...existing,images:[...(existing.images??[]),image]}:{id,type:'message',role:'agent',content:'',images:[image],createdAt:new Date().toISOString()};
  return {...session,messages:existing?session.messages.map(item=>item.id===id?message:item):[...session.messages,message]};
}
