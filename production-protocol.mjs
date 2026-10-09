import {parseProviderJson} from './editorial-protocol.mjs';
import {localTimeToInstant,zonedDateTime} from './publication-time.mjs';
export const productionStages=['writing','script-review','notion','recording','planning-edit','editing','video-review','platforms','preparing-package','generating-cover','covers-review','package-review','schedule','scheduling','complete','paused','blocked','canceled'];
export function validateEditPlan(raw,metadata,preferences={}){
 const p=typeof raw==='string'?parseProviderJson(raw):raw;
 if(!p||!Number.isFinite(p.start)||p.start<0||!Number.isFinite(p.duration)||p.duration<.1||p.start+p.duration>metadata.duration+.05||!['original','portrait'].includes(p.format)||typeof p.normalizeAudio!=='boolean'||!Number.isFinite(p.fadeSeconds)||p.fadeSeconds<0||p.fadeSeconds>.8||p.fadeSeconds*2>p.duration)throw Error('O especialista não devolveu um plano de edição válido.');
 if(p.format==='portrait'&&preferences.format!=='portrait')throw Error('O plano tentou recortar o vídeo sem autorização.');
 return {start:p.start,duration:p.duration,format:p.format,normalizeAudio:p.normalizeAudio,fadeSeconds:p.fadeSeconds,summary:String(p.summary??'Edição básica').slice(0,2000)};
}
export function validatePublicationPackage(raw,platforms){
 const p=typeof raw==='string'?parseProviderJson(raw):raw;
 if(!p||!Array.isArray(p.deliveries)||p.deliveries.length!==platforms.length||new Set(p.deliveries.map(x=>x.platform)).size!==platforms.length||!p.deliveries.every(x=>platforms.includes(x.platform)&&typeof x.caption==='string'&&x.caption.trim().length>0&&x.caption.length<=(x.platform==='Instagram'?2200:5000)&&typeof x.coverPrompt==='string'&&x.coverPrompt.trim()&&x.coverPrompt.length<=12000))throw Error('O agente não devolveu legenda e direção de capa para cada rede escolhida.');
 return {deliveries:p.deliveries.map(x=>({platform:x.platform,caption:x.caption.trim(),coverPrompt:x.coverPrompt.trim()}))};
}
export function parseProductionSchedule(text,zone,now=new Date()){
 const clean=text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim(),today=zonedDateTime(now.toISOString(),zone).slice(0,10);
 let day,clock;
 const iso=clean.match(/\b(\d{4}-\d{2}-\d{2})[t\s]+(\d{1,2}):(\d{2})\b/),br=clean.match(/\b(\d{2})\/(\d{2})\/(\d{4})\s+(?:as\s+)?(\d{1,2})(?::|h)(\d{2})?\b/);
 if(iso){day=iso[1];clock=`${iso[2].padStart(2,'0')}:${iso[3]}`;}
 else if(br){day=`${br[3]}-${br[2]}-${br[1]}`;clock=`${br[4].padStart(2,'0')}:${br[5]??'00'}`;}
 else{const time=clean.match(/(?:\bas\s+|\bat\s+|\b(?:amanha|tomorrow|hoje|today)\s+)(\d{1,2})(?:(?::|h)(\d{2})?)?\b/);if(!time)return null;clock=`${time[1].padStart(2,'0')}:${time[2]??'00'}`;if(/\b(amanha|tomorrow)\b/.test(clean)){const d=new Date(`${today}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+1);day=d.toISOString().slice(0,10);}else if(/\b(hoje|today)\b/.test(clean))day=today;else return null;}
 const instant=localTimeToInstant(`${day}T${clock}`,zone);if(Date.parse(instant)<now.getTime()+120000)throw Error('Escolha um horário pelo menos dois minutos no futuro.');return {plannedAt:instant,timeZone:zone,localDateTime:`${day}T${clock}`};
}
export function productionChatIntent(text){
 const s=text.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
 if(/^(aprovo|aprovar|approve) (a |esta |essa |this )?ideia[.!]?$/.test(s))return {type:'idea'};
 if(/^(aprovo|aprovar|approve) (o |este |esse |this )?video[.!]?$/.test(s))return {type:'video'};
 if(/^(aprovo|aprovar|approve) (o |este |esse |this )?(pacote|thumb e legenda|capa e legenda)[.!]?$/.test(s))return {type:'package'};
 if(/^(agende|agendar|schedule)\s+/.test(s))return {type:'schedule',text};
 if(/^(continuar|retomar|resume) (o |este |esse |this )?(fluxo|producao|production)[.!]?$/.test(s))return {type:'resume'};
 return null;
}
/** Automatic edit direction from the video editor agent. Detection, cuts and rendering stay local and validated. */
export function validateSmartEditDirection(raw,{animate=false}={}){
 const p=typeof raw==='string'?parseProviderJson(raw):raw;
 const text=(value,max)=>value===undefined||value===null||value===''?undefined:typeof value==='string'&&value.trim()&&[...value.trim()].length<=max?value.trim():null;
 const s=p?.silence??{},a=p?.animations??{};
 if(!p||typeof p.removeSilences!=='boolean'||typeof p.normalizeAudio!=='boolean'||typeof s!=='object'||typeof a!=='object'||![undefined,'dark','light'].includes(p.theme))throw Error('O especialista não devolveu uma direção de edição automática válida.');
 const silence={thresholdDb:s.thresholdDb??-35,minDuration:s.minDuration??0.6,padding:s.padding??0.2};
 if(!Number.isFinite(silence.thresholdDb)||silence.thresholdDb<-60||silence.thresholdDb>-20||!Number.isFinite(silence.minDuration)||silence.minDuration<0.3||silence.minDuration>5||!Number.isFinite(silence.padding)||silence.padding<0.05||silence.padding>0.6)throw Error('Parâmetros de silêncio fora dos limites seguros.');
 const title=text(a.title,80),cta=text(a.cta,80),name=text(a.lowerThird?.name,60),role=text(a.lowerThird?.role,80);
 if([title,cta,name,role].includes(null))throw Error('Textos de animação devem ser curtos e simples.');
 const highlights=(Array.isArray(p.highlights)?p.highlights:[]).map(item=>text(item,60)).filter(item=>item&&!/[<>{}`\\]|:\/\/|javascript:/i.test(item)).slice(0,6);
 return {silence,removeSilences:p.removeSilences,normalizeAudio:p.normalizeAudio,theme:p.theme??'dark',highlights,animations:animate?{...(title?{title}:{}),...(name?{lowerThird:{name,...(role?{role}:{})}}:{}),...(cta?{cta}:{})}:{},summary:String(p.summary??'Edição automática').slice(0,2000)};
}
/** Default overlay windows on the edited timeline; windows that do not fit short videos are dropped. */
export function smartEditAnimations(direction,outputDuration){
 const list=[],a=direction.animations;
 if(a.title&&outputDuration>=3.8)list.push({id:'title',kind:'title',text:a.title,start:0.3,duration:3});
 if(a.lowerThird&&outputDuration>=6)list.push({id:'lower-third',kind:'lowerThird',text:a.lowerThird.name,...(a.lowerThird.role?{subtitle:a.lowerThird.role}:{}),start:1.2,duration:4});
 if(a.cta&&outputDuration>=(list.length?7:3.5))list.push({id:'cta',kind:'cta',text:a.cta,start:Math.max(0,outputDuration-3),duration:3});
 return list;
}
