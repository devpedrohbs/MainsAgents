import {useEffect,useState} from 'react';
import type {ChatImageAttachment} from '../../features/chat/model/Chat';
import {chatImageSource} from '../../features/chat/chatImages';
import {useLanguage} from '../../app/LanguageProvider';
import {FlowDialog} from '../common/FlowDialog';

export function ChatMessageImages({images,onLoad}:{images:readonly ChatImageAttachment[];onLoad?:()=>void}){
  const {locale}=useLanguage();
  const [preview,setPreview]=useState<ChatImageAttachment|null>(null);
  const title=locale==='pt-BR'?'Imagem gerada':'Generated image';
  return <>
    <div className="chat-message-images">{images.map(image=><GeneratedImage key={image.id} image={image} title={title} onOpen={()=>setPreview(image)} onLoad={onLoad}/>)}</div>
    {preview&&<FlowDialog title={title} onClose={()=>setPreview(null)}><div className="chat-image-preview"><img src={chatImageSource(preview)} alt={title}/><a href={chatImageSource(preview)} download={preview.filename}>{locale==='pt-BR'?'Baixar imagem':'Download image'}</a></div></FlowDialog>}
  </>;
}

function GeneratedImage({image,title,onOpen,onLoad}:{image:ChatImageAttachment;title:string;onOpen:()=>void;onLoad?:()=>void}){
  const {locale}=useLanguage();
  const [failed,setFailed]=useState(false),[attempt,setAttempt]=useState(0);
  const source=chatImageSource(image);
  useEffect(()=>setFailed(false),[source,attempt]);
  if(!source)return null;
  return <figure className="chat-generated-image">
    {failed?<div className="chat-image-unavailable" role="status"><span>{locale==='pt-BR'?'Não foi possível carregar esta imagem.':'Could not load this image.'}</span><button onClick={()=>setAttempt(value=>value+1)}>{locale==='pt-BR'?'Tentar novamente':'Try again'}</button></div>:<button className="chat-image-open" onClick={onOpen} aria-label={locale==='pt-BR'?'Ampliar imagem gerada':'Enlarge generated image'}><img key={attempt} src={source.startsWith('data:')?source:`${source}?retry=${attempt}`} alt={title} onLoad={onLoad} onError={()=>setFailed(true)}/></button>}
    <figcaption><span>{title} · Codex</span><a href={source} download={image.filename}>{locale==='pt-BR'?'Baixar':'Download'}</a></figcaption>
  </figure>;
}
