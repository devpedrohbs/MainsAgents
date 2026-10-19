import {localTimeToInstant,zonedDateTime} from './publication-time.mjs';

/**
 * Scheduling authority from the person's own saved chat messages (pt-BR/en, deliberately small grammar).
 * A positive request opens a pending intent; later answers without a verb ("Instagram amanhã às 18h") add facts to it;
 * a cancellation, a question about status/capability or an unrelated message closes it. Quoted text never counts.
 * Model arguments never add facts: only what the person wrote here does.
 */
const fold=text=>String(text).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
// Pasted or quoted instructions ("o cliente disse: 'agende amanhã'") are not the person's request.
const unquoted=text=>String(text).replace(/```[\s\S]*?```/g,' ').split('\n').filter(line=>!/^\s*>/.test(line)).join('\n').replace(/"[^"\n]*"|“[^”\n]*”|«[^»\n]*»|‘[^’\n]*’/g,' ').replace(/(^|[^\p{L}\p{N}])'[^'\n]+'(?![\p{L}\p{N}])/gu,'$1 ');
const verb=/\b(agend\w*|reagend\w*|program(?:e|ar|a|em)\b|schedul\w*|post(?:ar|e|a|em)\b|publi(?:car|que|ca|quem)\b)/;
const cancel=/\b(?:nao|nem|never|dont|don't|do not)\b[^.!?\n]{0,30}\b(?:agend|reagend|program|post|publi|schedul)|\b(?:cancel\w*|desist\w*|ainda nao|espera(?:r)?|aguard\w*|segura|deixa (?:pra|para) depois|not yet|hold off|stop)\b/;
const questionCue=/\b(consegue\w*|da pra|e possivel|tem como|como (?:eu )?(?:faco|faz|agendo|funciona)|voce (?:pode|sabe|consegue)|vc (?:pode|sabe|consegue)|ja (?:foi|esta|ta)|status|quais|qual|quando (?:vai|sera)|foi agendad\w*|can you|could you|how do|is it possible|did it|was it)\b/;
// A new piece of work ("faz outro carrossel pro Instagram") is never an answer to the pending schedule.
const taskCue=/\b(?:cri[ae]\w*|faz\w*|faca|gere|ger[ae]r|corrij\w*|corrig\w*|edit\w*|refa[cz]\w*|escrev\w*|adicion\w*|remov\w*|make|create|fix|write|add|remove)\b/;
// Amending the pending post ("mude a hora para 19h") still answers it, but never confirms a summary.
const changeCue=/\b(?:mud[ae]\w*|troqu\w*|troca\w*|alter\w*|change)\b/;
const confirmCue=/^\s*(sim|s|ok|okay|pode|isso|beleza|blz|certo|perfeito|yes|y|confirmo|confirmado|manda|vai)\b/;

const weekdays={domingo:0,segunda:1,terca:2,quarta:3,quinta:4,sexta:5,sabado:6,sunday:0,monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6};
const pad=value=>String(value).padStart(2,'0');
const addDays=(ymd,days)=>{const [y,m,d]=ymd.split('-').map(Number),date=new Date(Date.UTC(y,m-1,d+days));return `${date.getUTCFullYear()}-${pad(date.getUTCMonth()+1)}-${pad(date.getUTCDate())}`;};
const validDay=(y,m,d)=>{const date=new Date(Date.UTC(y,m-1,d));return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d;};

/** Facts the person stated in one message, relative to that message's own local date. */
export function extractFacts(content,{at,timeZone}){
 const text=fold(unquoted(content)),facts={};
 const platforms=[...new Set([[/\b(?:instagram|insta|ig)\b/,'Instagram'],[/\blinked ?in\b/,'LinkedIn'],[/\btik ?tok\b/,'TikTok']].filter(([re])=>re.test(text)).map(([,name])=>name))];
 if(platforms.length)facts.platforms=platforms;
 const handle=unquoted(content).match(/@([A-Za-z0-9_.]{2,30})/);if(handle)facts.account=handle[1].toLowerCase();
 const today=zonedDateTime(at,timeZone).slice(0,10),[ty,tm,td]=today.split('-').map(Number);
 let date,m;
 if(/\bdepois de amanha\b/.test(text))date=addDays(today,2);
 else if(/\b(?:amanha|tomorrow)\b/.test(text))date=addDays(today,1);
 else if(/\b(?:hoje|today|tonight)\b/.test(text))date=today;
 else if((m=text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/))&&validDay(+m[1],+m[2],+m[3]))date=`${m[1]}-${m[2]}-${m[3]}`;
 else if((m=text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\b/))){let y=m[3]?(m[3].length===2?2000+ +m[3]:+m[3]):ty;if(!m[3]&&(+m[2]<tm||+m[2]===tm&&+m[1]<td))y++;if(validDay(y,+m[2],+m[1]))date=`${y}-${pad(m[2])}-${pad(m[1])}`;}
 else if((m=text.match(/\bdia (\d{1,2})\b/))){let y=ty,mo=tm;if(+m[1]<td){mo++;if(mo>12){mo=1;y++;}}if(validDay(y,mo,+m[1]))date=`${y}-${pad(mo)}-${pad(m[1])}`;}
 else{const name=Object.keys(weekdays).find(day=>new RegExp(`\\b${day}\\b`).test(text));if(name){const current=new Date(Date.UTC(ty,tm-1,td)).getUTCDay();date=addDays(today,((weekdays[name]-current+7)%7)||7);}}
 if(date)facts.date=date;
 let hour,minute=0;
 if(/\bmeio[- ]dia\b|\bnoon\b/.test(text))hour=12;
 else if(/\bmeia[- ]noite\b|\bmidnight\b/.test(text))hour=0;
 else if((m=text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?![a-z])/)))[hour,minute]=[+m[1]%12+(m[3][0]==='p'?12:0),+(m[2]??0)];
 else if((m=text.match(/\b(\d{1,2}):(\d{2})\b/)))[hour,minute]=[+m[1],+m[2]];
 else if((m=text.match(/\b(\d{1,2})\s*h(?:oras?|s)?\s*(\d{2})?\b/)))[hour,minute]=[+m[1],+(m[2]??0)];
 else if((m=text.match(/\b(?:as|at)\s+(\d{1,2})(?::(\d{2}))?\b/)))[hour,minute]=[+m[1],+(m[2]??0)];
 if(hour!==undefined&&hour<12&&/\bda (?:tarde|noite)\b/.test(text))hour+=12;
 if(hour!==undefined&&hour<24&&minute<60)facts.time=`${pad(hour)}:${pad(minute)}`;
 return facts;
}

/** request | cancel | question | confirm | details | other */
export function classifyMessage(content,context){
 const raw=unquoted(content),text=fold(raw);
 if(cancel.test(text))return 'cancel';
 const hasVerb=verb.test(text),facts=extractFacts(content,context),hasFacts=Object.keys(facts).length>0;
 const politeAction=hasVerb&&facts.date&&facts.time&&/\b(?:voce pode|vc pode|pode|consegue|could you|can you|would you)\b/.test(text)&&/\b(?:este|esse|esta|essa|isto|isso|this|these)\b/.test(text)&&!/\b(?:ja (?:foi|esta|ta)|status|como|how|quais|qual|foi agendad\w*|did it|was it)\b/.test(text);
 if(!politeAction&&questionCue.test(text)&&(raw.includes('?')||!hasFacts))return 'question';
 if(hasVerb)return 'request';
 if(hasFacts&&!taskCue.test(text)&&text.length<=160)return 'details';
 // "isso não", "ok, mas mude a hora": a reservation or change is never a confirmation.
 if(confirmCue.test(text)&&text.length<=60&&!/\b(?:nao|no|nope|mas|porem|but|except|exceto)\b/.test(text)&&!taskCue.test(text)&&!changeCue.test(text))return 'confirm';
 return 'other';
}

/**
 * Walks the person's messages in order and returns the open intent (or why there is none).
 * intent: {messageId, at, index, facts:{platforms?,account?,date?,time?}, localTime?}
 */
export function resolveIntent(session,{timeZone,now=Date.now(),ttlMs=24*60*60_000}={}){
 const messages=(session?.messages??[]).filter(item=>item?.type==='message'&&item.role==='user'&&typeof item.content==='string');
 let intent=null,closed=null;
 messages.forEach((message,index)=>{
  const context={at:message.createdAt,timeZone},kind=classifyMessage(message.content,context);
  if(kind==='request'){intent={messageId:message.id,at:message.createdAt,index,facts:extractFacts(message.content,context)};closed=null;return;}
  if(kind==='cancel'){if(intent||!closed)closed={kind,messageId:message.id};intent=null;return;}
  if(!intent)return;
  if(kind==='details')intent.facts={...intent.facts,...extractFacts(message.content,context)};
  else if(kind!=='confirm'){closed={kind,messageId:message.id};intent=null;}
 });
 if(intent&&now-Date.parse(intent.at)>ttlMs)return {intent:null,closed:{kind:'expired',messageId:intent.messageId}};
 if(intent?.facts.date&&intent.facts.time){try{intent.localTime=`${intent.facts.date}T${intent.facts.time}`;intent.plannedAt=localTimeToInstant(intent.localTime,timeZone);}catch{delete intent.localTime;}}
 return {intent,closed};
}
export {classifyMessage as classifyScheduleMessage};
