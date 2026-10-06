import {useState} from 'react';
import {Icon} from '../common/Icon';
import {networkLogos} from '../../assets/networkLogos';

export function NetworkLogo({platform,className=''}:{platform:string;className?:string}) {
  const name=platform.toLowerCase();
  return <span className={`network-logo ${className}`} title={platform}>
    {networkLogos[name]?<img src={networkLogos[name]} alt={platform}/>:<span>{platform.slice(0,2)}</span>}
  </span>;
}

/** Only display an accessible image URL; disk paths require a separate cover. */
export function imagePreviewUrl(value?:string):string|undefined {
  if (!value) return;
  if (/^(https?:\/\/|blob:|data:image\/(png|jpeg|webp|gif|svg\+xml)[;,])/i.test(value)) return value;
  if (/^(\.?\/?images\/|\/images\/)/.test(value)) return value;
}

export function PostCover({src,title,pt=true}:{src?:string;title:string;pt?:boolean}) {
  const [failed,setFailed]=useState<string>();
  return src&&failed!==src?<img className="post-cover-image" src={src} alt={title} loading="lazy" onError={()=>setFailed(src)}/>:<span className="post-cover-empty"><Icon name="image"/><span>{pt?'Sem capa':'No cover'}</span></span>;
}

interface TileProps {id:string;title:string;platform:string;status:string;statusLabel:string;time?:string;cover?:string;pt?:boolean;onClick:()=>void;compact?:boolean;className?:string}
export function PublicationTile({id,title,platform,status,statusLabel,time,cover,pt=true,onClick,compact=false,className=''}:TileProps) {
  return <button type="button" className={`publication-tile ${compact?'compact':''} ${className}`} data-status={status} data-od-id={`post-${id}`} onClick={onClick} aria-label={`${title} · ${platform} · ${time??(pt?'Sem data':'No date')} · ${statusLabel}`}>
    <span className="post-cover"><PostCover src={cover} title={title} pt={pt}/><NetworkLogo platform={platform}/></span>
    <span className="post-tile-copy"><b>{title}</b><span className="post-tile-meta"><time>{time??(pt?'Sem data':'No date')}</time><span className="post-status"><i/>{statusLabel}</span></span></span>
  </button>;
}
