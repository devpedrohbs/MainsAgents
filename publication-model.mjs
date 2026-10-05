const normalize=value=>Array.isArray(value)?value.map(normalize):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,normalize(value[key])])):value;
export const publicationPlatforms=['Instagram','TikTok','YouTube','LinkedIn'];
const states=['draft','in-review','approved','sending','scheduled','published','failed'];
const text=(value,max=100000)=>typeof value==='string'&&value.length<=max;
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
export function validTimeZone(value){try{new Intl.DateTimeFormat('en',{timeZone:value}).format();return typeof value==='string'&&value.length<100;}catch{return false;}}
export const publicationPayload=delivery=>({platform:delivery.platform,text:delivery.text,media:delivery.media,plannedAt:delivery.plannedAt,timeZone:delivery.timeZone});
export function validatePublications(state){
  if(state?.publications===undefined)return true;
  if(!Array.isArray(state.publications)||state.publications.length>10000)return false;
  const ids=new Set();
  for(const item of state.publications){
    if(!item||!text(item.id,200)||!item.id||ids.has(item.id)||!publicationPlatforms.includes(item.platform)||!states.includes(item.status)||!Number.isSafeInteger(item.version)||item.version<1||!text(item.text)||!validTimeZone(item.timeZone)||item.plannedAt!==undefined&&!date(item.plannedAt)||!date(item.createdAt)||!date(item.updatedAt)||!Array.isArray(item.media)||item.media.length>30||!Array.isArray(item.history)||item.history.length>200)return false;
    ids.add(item.id);
    if(!state.contents?.some(content=>content.id===item.contentId&&content.workspaceId===item.workspaceId))return false;
    if(item.media.some(ref=>!text(ref.assetId,200)||!text(ref.versionId,200)||!/^[a-f0-9]{64}$/.test(ref.sha256)))return false;
    if(item.history.some(entry=>!Number.isSafeInteger(entry.version)||!states.includes(entry.status)||!text(entry.notes,5000)||!date(entry.at)||!/^[a-f0-9]{64}$/.test(entry.payloadHash)))return false;
    if(['approved','sending','scheduled','published'].includes(item.status)&&!item.history.some(entry=>entry.version===item.version&&entry.status==='approved'&&JSON.stringify(normalize(entry.payload))===JSON.stringify(normalize(publicationPayload(item)))))return false;
    if(['scheduled','published'].includes(item.status)&&(!item.receipt||!text(item.receipt.id,500)||!item.receipt.id||!date(item.receipt.checkedAt)||item.receipt.version!==item.version))return false;
  }
  return true;
}
