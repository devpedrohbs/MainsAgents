const normalize=value=>Array.isArray(value)?value.map(normalize):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,normalize(value[key])])):value;
export const publicationPlatforms=['Instagram','TikTok','YouTube','LinkedIn'];
const states=['draft','in-review','approved','sending','scheduled','published','failed'];
const text=(value,max=100000)=>typeof value==='string'&&value.length<=max;
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
export function validTimeZone(value){try{new Intl.DateTimeFormat('en',{timeZone:value}).format();return typeof value==='string'&&value.length<100;}catch{return false;}}
export const publicationPayload=delivery=>({platform:delivery.platform,text:delivery.text,media:delivery.media,plannedAt:delivery.plannedAt,timeZone:delivery.timeZone,...(delivery.networkSettings?{networkSettings:delivery.networkSettings}:{})});
export function validNetworkSettings(platform,s){
 if(s===undefined)return true;
 if(!s||typeof s!=='object'||Array.isArray(s))return false;
 if(platform==='Instagram')return Object.keys(s).every(k=>['contentType','shareToFeed'].includes(k))&&(s.contentType===undefined||s.contentType==='story')&&(s.shareToFeed===undefined||typeof s.shareToFeed==='boolean');
 if(platform==='TikTok'){
  const t=s.tiktokSettings;if(Object.keys(s).length!==1||!t||typeof t!=='object'||Array.isArray(t))return false;
  const bools=['allow_comment','allow_duet','allow_stitch','content_preview_confirmed','express_consent_given','video_made_with_ai'];
  return Object.keys(t).every(k=>[...bools,'privacy_level','commercialContentType'].includes(k))&&bools.every(k=>typeof t[k]==='boolean')&&['','PUBLIC_TO_EVERYONE','MUTUAL_FOLLOW_FRIENDS','FOLLOWER_OF_CREATOR','SELF_ONLY'].includes(t.privacy_level)&&['none','brand_organic','brand_content'].includes(t.commercialContentType);
 }
 return false;
}
export function validatePublications(state){
  if(state?.publications===undefined)return true;
  if(!Array.isArray(state.publications)||state.publications.length>10000)return false;
  const ids=new Set();
  for(const item of state.publications){
    if(!item||!text(item.id,200)||!item.id||ids.has(item.id)||!publicationPlatforms.includes(item.platform)||!states.includes(item.status)||!Number.isSafeInteger(item.version)||item.version<1||!text(item.text)||!validTimeZone(item.timeZone)||item.plannedAt!==undefined&&!date(item.plannedAt)||!date(item.createdAt)||!date(item.updatedAt)||!Array.isArray(item.media)||item.media.length>30||!Array.isArray(item.history)||item.history.length>200)return false;
    if(!validNetworkSettings(item.platform,item.networkSettings))return false;
    ids.add(item.id);
    if(!state.contents?.some(content=>content.id===item.contentId&&content.workspaceId===item.workspaceId))return false;
    if(item.media.some(ref=>!text(ref.assetId,200)||!text(ref.versionId,200)||!/^[a-f0-9]{64}$/.test(ref.sha256)))return false;
    if(item.history.some(entry=>!Number.isSafeInteger(entry.version)||!states.includes(entry.status)||!text(entry.notes,5000)||!date(entry.at)||!/^[a-f0-9]{64}$/.test(entry.payloadHash)))return false;
    if(['approved','sending','scheduled','published'].includes(item.status)&&!item.history.some(entry=>entry.version===item.version&&entry.status==='approved'&&JSON.stringify(normalize(entry.payload))===JSON.stringify(normalize(publicationPayload(item)))))return false;
    if(['scheduled','published'].includes(item.status)&&(!item.receipt||!text(item.receipt.id,500)||!item.receipt.id||!date(item.receipt.checkedAt)||item.receipt.version!==item.version))return false;
    const op=item.operation;
    if(op){
      if(!text(op.id,100)||!op.id||!['publora','zernio'].includes(op.provider)||!['preview','requesting','uncertain','confirmed'].includes(op.phase)||!['draft','schedule'].includes(op.mode)||!(op.provider==='publora'?/^linkedin-[A-Za-z0-9_-]{1,200}$/:/^[A-Za-z0-9_-]{1,200}$/).test(op.accountId)||!date(op.createdAt)||!date(op.expiresAt)||!/^[a-f0-9]{64}$/.test(op.payloadHash)||!text(op.arguments?.idempotencyKey,100)||!op.arguments.idempotencyKey||op.provider==='publora'&&item.platform!=='LinkedIn'||op.provider==='zernio'&&(!['Instagram','TikTok','LinkedIn'].includes(item.platform)||op.platform!==item.platform.toLowerCase()||op.timeZone!==item.timeZone||JSON.stringify(normalize(op.networkSettings))!==JSON.stringify(normalize(item.networkSettings))))return false;
      if(op.stage!==undefined&&!['uploading','creating','finalizing','done','editing','canceling'].includes(op.stage))return false;
      if(op.files!==undefined&&(!Array.isArray(op.files)||op.files.length!==item.media.length||op.files.some((f,i)=>f.assetId!==item.media[i].assetId||f.versionId!==item.media[i].versionId||f.sha256!==item.media[i].sha256||!text(f.name,300)||!Number.isSafeInteger(f.size)||f.size<1||!['image','video'].includes(f.type)||!text(f.contentType,100))))return false;
      if(item.media.length&&!op.files)return false;
      if(op.uploads!==undefined&&(!Array.isArray(op.uploads)||op.uploads.length>item.media.length||new Set(op.uploads.map(f=>f.assetId)).size!==op.uploads.length||op.uploads.some(f=>!item.media.some(r=>r.assetId===f.assetId&&r.versionId===f.versionId&&r.sha256===f.sha256)||!['pending','uploaded'].includes(f.status)||!text(f.url,4096)||!/^https:\/\//.test(f.url)||!['image','video'].includes(f.type)||op.provider==='publora'&&!text(f.mediaId,500))))return false;
      const expected={content:item.text,platforms:[op.accountId],...(op.mode==='schedule'?{scheduledTime:item.plannedAt}:{}),idempotencyKey:op.arguments.idempotencyKey};
      if(JSON.stringify(normalize(expected))!==JSON.stringify(normalize(op.arguments))||op.mode==='schedule'&&!date(item.plannedAt)||op.externalId!==undefined&&(!text(op.externalId,500)||!op.externalId)||op.error!==undefined&&!text(op.error,5000))return false;
      if(op.finalizeRequestId!==undefined&&(!text(op.finalizeRequestId,100)||!op.finalizeRequestId))return false;
      if(op.cancelRequestId!==undefined&&(!text(op.cancelRequestId,100)||!op.cancelRequestId))return false;
      if(op.phase==='preview'&&item.status!=='approved'||['requesting','uncertain'].includes(op.phase)&&item.status!=='sending'||op.phase==='confirmed'&&(!op.externalId||item.receipt?.id!==op.externalId))return false;
    }
  }
  return true;
}
