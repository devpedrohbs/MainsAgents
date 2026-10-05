import {createCalendarConnector} from './publication-calendar-connector.mjs';
/** Fixed read-only Zernio endpoints. Keys stay in the native host. */
export function createZernioCalendarApi(getKey,{fetchImpl=fetch}={}){
 let boundKey;
 const connector=createCalendarConnector(()=>({async call(tool,args){
  const endpoint=tool==='accounts_list_accounts'?'accounts':tool==='posts_list_posts'?'posts':null;
  if(!endpoint)throw Error('Unsupported calendar API operation.');
  const key=getKey();if(!key)throw Error('Configure the Zernio API key in the desktop app.');
  if(boundKey&&boundKey!==key)throw Error('Calendar credentials changed. Query again.');boundKey=key;
  const url=new URL(`https://zernio.com/api/v1/${endpoint}`);
  if(endpoint==='posts'){url.searchParams.set('page',String(args.page));url.searchParams.set('limit',String(args.limit));url.searchParams.set('sortBy','scheduled-asc');}
  let response;
  try{response=await fetchImpl(url,{method:'GET',redirect:'error',headers:{authorization:`Bearer ${key}`,accept:'application/json'},signal:AbortSignal.timeout(20000)});}catch{throw Error('Zernio calendar API query failed.');}
  if(!response.ok)throw Error(`Zernio calendar API returned HTTP ${response.status}. Check the key and account permissions.`);
  let bytes=0;const chunks=[];
  for await(const chunk of response.body){bytes+=chunk.length;if(bytes>8_000_000)throw Error('Zernio calendar response exceeds the size limit.');chunks.push(Buffer.from(chunk));}
  let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw Error('Zernio returned no verifiable calendar JSON.');}
  if(getKey()!==key)throw Error('Calendar credentials changed. Query again.');
  return {structuredContent:data};
 }}),'zernio');
 return {...connector,transport:'api'};
}
