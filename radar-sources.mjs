import {createHash} from 'node:crypto';

/**
 * Radar collectors: deterministic reads of free sources (no AI, no paid service). Each returns what the source said at
 * that moment; a counter the source does not expose is null, never 0. `fetch` is injectable for tests.
 * YouTube Data API v3 uses a free Google Cloud key with a fixed daily quota (no billing); RSS and Hacker News need no key.
 */
const MAX_BYTES=5_000_000,TIMEOUT_MS=15_000,UA='MainsAgent-Radar/1 (+local desktop app)';
export const YT_API='https://www.googleapis.com/youtube/v3';
export const HN_API='https://hacker-news.firebaseio.com/v0';
export const sha=value=>createHash('sha256').update(value).digest('hex').slice(0,40);

export class SourceError extends Error{
 constructor(status,code,message,{retryAt=null}={}){super(message);this.status=status;this.code=code;this.retryAt=retryAt;}
}
const num=value=>{if(value===undefined||value===null||value==='')return null;const n=Number(value);return Number.isFinite(n)&&n>=0?n:null;};

// Sources answer 5xx now and then (the YouTube channel feed even answers 404 intermittently): short retries before failing.
async function request(fetchImpl,url,options={},retries=options.retries??1){
 const result=await requestOnce(fetchImpl,url,options);
 if(!(options.retryOn??(status=>status>=500))(result.status)||retries<1||options.signal?.aborted)return result;
 await new Promise(resolve=>setTimeout(resolve,options.retryDelayMs??1500));
 return request(fetchImpl,url,options,retries-1);
}
async function requestOnce(fetchImpl,url,{signal,json=true}={}){
 let response;
 try{response=await fetchImpl(url,{headers:{'user-agent':UA,accept:json?'application/json':'application/atom+xml, application/rss+xml, application/xml, text/xml'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(TIMEOUT_MS)]):AbortSignal.timeout(TIMEOUT_MS),redirect:'follow'});}
 catch(error){if(signal?.aborted)throw error;throw new SourceError('error','network','Sem conexão com a fonte (rede indisponível ou tempo esgotado).');}
 const text=await response.text();
 if(text.length>MAX_BYTES)throw new SourceError('error','too_large','A fonte respondeu com um documento grande demais.');
 if(response.status===429){const after=Number(response.headers.get('retry-after'));throw new SourceError('limit_reached','rate_limited','A fonte limitou as requisições; nova tentativa mais tarde.',{retryAt:new Date(Date.now()+(Number.isFinite(after)&&after>0?after*1000:3_600_000)).toISOString()});}
 return {status:response.status,ok:response.ok,text};
}

// ---- Minimal XML (Atom / RSS 2.0) ----
const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
export const decode=value=>String(value??'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi,(all,code)=>code[0]==='#'?String.fromCodePoint(code[1].toLowerCase()==='x'?parseInt(code.slice(2),16):Number(code.slice(1))):entities[code]??all).trim();
const blocks=(xml,tag)=>[...xml.matchAll(new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`,'g'))].map(m=>m[0]);
const inner=(xml,tag)=>{const m=xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));return m?decode(m[1]):null;};
const attr=(xml,tag,name)=>{const m=xml.match(new RegExp(`<${tag}\\s[^>]*?${name}="([^"]*)"`));return m?decode(m[1]):null;};
const iso=value=>{const t=Date.parse(value??'');return Number.isFinite(t)?new Date(t).toISOString():null;};
export function safeUrl(value){try{const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return null;url.hash='';return url.toString();}catch{return null;}}

/** YouTube channel feed: the latest ~15 uploads with view counts (likes/comments/duration are not in the feed). */
export function parseYoutubeFeed(xml){
 if(!/<feed[\s>]/.test(xml))throw new SourceError('error','parse','O feed do canal não pôde ser lido.');
 const channelTitle=inner(xml.split('<entry')[0],'title');
 return blocks(xml,'entry').map(entry=>({
  videoId:inner(entry,'yt:videoId'),channelId:inner(entry,'yt:channelId'),title:inner(entry,'title')??'',author:inner(blocks(entry,'author')[0]??'','name')??channelTitle,
  publishedAt:iso(inner(entry,'published')),views:num(attr(entry,'media:statistics','views')),likes:null,comments:null,durationSeconds:null,live:false,
 })).filter(item=>/^[\w-]{11}$/.test(item.videoId??''));
}
/** RSS 2.0 or Atom news feed. */
export function parseNewsFeed(xml,feedUrl){
 const atom=/<feed[\s>]/.test(xml);if(!atom&&!/<rss[\s>]|<rdf:RDF[\s>]/.test(xml))throw new SourceError('error','parse','O endereço não é um feed RSS/Atom válido.');
 const host=new URL(feedUrl).hostname.replace(/^www\./,'');
 return blocks(xml,atom?'entry':'item').map(entry=>{
  const link=safeUrl(atom?(attr(entry,'link','href')??inner(entry,'link')):(inner(entry,'link')??inner(entry,'guid')));
  return {url:link,title:inner(entry,'title')??'',author:host,publishedAt:iso(inner(entry,atom?'published':'pubDate')??inner(entry,'updated')??inner(entry,'dc:date')),score:null,comments:null};
 }).filter(item=>item.url&&item.title).slice(0,50);
}

// ---- YouTube ----
/** ISO 8601 duration (PT1H2M3S, P1DT2H) in seconds; null when absent (lives in progress report P0D). */
export function isoDuration(value){const m=/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value??'');if(!m)return null;const [,d,h,mi,s]=m.map(v=>Number(v??0));return d*86400+h*3600+mi*60+s;}
/** Next midnight in America/Los_Angeles, when the YouTube API daily quota resets (plus a small margin; never earlier). */
export function nextPacificMidnight(ms){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',hourCycle:'h23',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(new Date(ms)).map(part=>[part.type,part.value]));
 const elapsed=((Number(p.hour)*60+Number(p.minute))*60+Number(p.second))*1000;
 return new Date(ms-elapsed-(ms%1000)+86_400_000+5*60_000).toISOString();
}
function youtubeError(status,text,now){
 let reason='';try{const body=JSON.parse(text);reason=body?.error?.errors?.[0]?.reason??body?.error?.details?.[0]?.reason??body?.error?.status??'';}catch{}
 if(['quotaExceeded','dailyLimitExceeded','rateLimitExceeded','userRateLimitExceeded'].includes(reason))return new SourceError('limit_reached','quota_exceeded','A cota diária gratuita da YouTube API acabou; a coleta aguarda o reset (meia-noite no horário do Pacífico).',{retryAt:nextPacificMidnight(now)});
 if(['keyInvalid','API_KEY_INVALID','keyExpired','API_KEY_EXPIRED'].includes(reason)||(status===400&&/API key/i.test(text)))return new SourceError('needs_reauth','invalid_api_key','A chave da YouTube API é inválida ou expirou. Cadastre outra no Radar.');
 if(reason==='accessNotConfigured'||reason==='SERVICE_DISABLED')return new SourceError('needs_reauth','api_disabled','A YouTube Data API v3 não está ativada no projeto do Google Cloud dessa chave.');
 if(status===404||reason==='channelNotFound'||reason==='playlistNotFound')return new SourceError('error','not_found','Canal ou playlist não encontrado no YouTube.');
 return new SourceError('error',`http_${status}`,`A YouTube API respondeu ${status}${reason?` (${reason})`:''}.`);
}
export function createYoutubeApi({key,fetch:fetchImpl=fetch,clock=()=>Date.now(),signal}){
 let units=0;
 async function call(path,params,cost){
  const url=new URL(`${YT_API}/${path}`);for(const [name,value] of Object.entries({...params,key}))if(value!==undefined&&value!=='')url.searchParams.set(name,String(value));
  const response=await request(fetchImpl,url.toString(),{signal});units+=cost;
  if(!response.ok)throw youtubeError(response.status,response.text,clock());
  try{return JSON.parse(response.text);}catch{throw new SourceError('error','parse','Resposta inválida da YouTube API.');}
 }
 /** videos.list in batches of 50 (1 unit each). */
 async function videos(ids){
  const out=[];
  for(let i=0;i<ids.length;i+=50){
   const body=await call('videos',{part:'snippet,statistics,contentDetails,liveStreamingDetails',id:ids.slice(i,i+50).join(','),maxResults:50},1);
   for(const v of body.items??[])out.push({videoId:v.id,channelId:v.snippet?.channelId??null,title:v.snippet?.title??'',author:v.snippet?.channelTitle??null,publishedAt:iso(v.snippet?.publishedAt),
    views:num(v.statistics?.viewCount),likes:num(v.statistics?.likeCount),comments:num(v.statistics?.commentCount),durationSeconds:isoDuration(v.contentDetails?.duration),live:Boolean(v.liveStreamingDetails)||['live','upcoming'].includes(v.snippet?.liveBroadcastContent)});
  }
  return out;
 }
 return {
  get units(){return units;},
  /** Latest uploads of a channel with statistics: channels.list + playlistItems.list + videos.list (~3 units). */
  async channelVideos(channelId,{max=30}={}){
   const channel=(await call('channels',{part:'contentDetails,snippet',id:channelId},1)).items?.[0];
   const uploads=channel?.contentDetails?.relatedPlaylists?.uploads;if(!uploads)throw new SourceError('error','not_found','Canal não encontrado no YouTube.');
   const list=await call('playlistItems',{part:'contentDetails',playlistId:uploads,maxResults:Math.min(max,50)},1);
   return {channelTitle:channel.snippet?.title??null,videos:await videos((list.items??[]).map(i=>i.contentDetails?.videoId).filter(Boolean))};
  },
  /** Discovery: most viewed videos of the last `days` for a topic (search.list costs 100 units). */
  async search(query,{regionCode,days=7,max=25}={}){
   const body=await call('search',{part:'snippet',q:query,type:'video',order:'viewCount',publishedAfter:new Date(clock()-days*86_400_000).toISOString(),maxResults:max,regionCode},100);
   return videos((body.items??[]).map(i=>i.id?.videoId).filter(Boolean));
  },
 };
}
export async function youtubeFeed(channelId,{fetch:fetchImpl=fetch,signal,retryDelayMs}={}){
 const response=await request(fetchImpl,`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`,{signal,json:false,retries:2,retryOn:status=>status===404||status>=500,retryDelayMs});
 if(response.status===404)throw new SourceError('error','feed_unavailable','O feed do canal não respondeu (ele é instável no YouTube); confira se o ID começa com UC. Nova tentativa na próxima coleta.');
 if(!response.ok)throw new SourceError('error',`http_${response.status}`,`O feed do YouTube respondeu ${response.status}.`);
 return parseYoutubeFeed(response.text);
}

// ---- News ----
export async function newsFeed(url,{fetch:fetchImpl=fetch,signal}={}){
 const response=await request(fetchImpl,url,{signal,json:false});
 if(response.status===401||response.status===403)throw new SourceError('needs_reauth',`http_${response.status}`,'O feed exige login ou bloqueou o acesso.');
 if(!response.ok)throw new SourceError('error',`http_${response.status}`,`O feed respondeu ${response.status}.`);
 return parseNewsFeed(response.text,url);
}
/** Hacker News top stories (official Firebase API, no key): points and comment counts. */
export async function hackerNews({fetch:fetchImpl=fetch,signal,max=30}={}){
 const json=async path=>{const r=await request(fetchImpl,`${HN_API}/${path}`,{signal});if(!r.ok)throw new SourceError('error',`http_${r.status}`,`O Hacker News respondeu ${r.status}.`);try{return JSON.parse(r.text);}catch{throw new SourceError('error','parse','Resposta inválida do Hacker News.');}};
 const ids=(await json('topstories.json')??[]).slice(0,max),out=[];
 for(const id of ids){
  const story=await json(`item/${Number(id)}.json`);if(!story||story.type!=='story'||story.dead||story.deleted)continue;
  out.push({url:safeUrl(story.url)??`https://news.ycombinator.com/item?id=${story.id}`,discussionUrl:`https://news.ycombinator.com/item?id=${story.id}`,title:String(story.title??''),author:story.url?new URL(story.url).hostname.replace(/^www\./,''):'news.ycombinator.com',
   publishedAt:Number.isFinite(story.time)?new Date(story.time*1000).toISOString():null,score:num(story.score),comments:num(story.descendants)});
 }
 return out;
}
