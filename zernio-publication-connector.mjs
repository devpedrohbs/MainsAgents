import {createZernioCalendarApi} from './publication-calendar-api.mjs';
import {uploadDestination,uploadPublicationFile} from './publication-media-upload.mjs';

const identity=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(value);
const stable=value=>JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(v=>JSON.parse(stable(v))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(stable(value[k]))])):value??null);
export function zernioBody(op){
 return {content:op.arguments.content,mediaItems:(op.uploads??[]).map(f=>({type:f.type,url:f.url})),platforms:[{platform:op.platform,accountId:op.accountId,...(op.networkSettings?{platformSpecificData:op.networkSettings}:{})}],timezone:op.timeZone,isDraft:op.mode==='draft',publishNow:false,...(op.mode==='schedule'?{scheduledFor:op.arguments.scheduledTime}:{})};
}
export function verifiedZernioPublication(data,op){
 const p=data?.post,target=p?.platforms?.[0],body=zernioBody(op),account=typeof target?.accountId==='string'?target.accountId:target?.accountId?._id;
 if((op.uploads??[]).length!==(op.files??[]).length||(op.uploads??[]).some(f=>f.status!=='uploaded')||p?._id!==op.externalId||p.content!==body.content||p.platforms?.length!==1||account!==op.accountId||target.platform!==op.platform||target.customContent!=null&&target.customContent!==body.content||target.customMedia?.length||p.mediaItems?.length!==body.mediaItems.length||!body.mediaItems.every((f,i)=>p.mediaItems[i]?.url===f.url&&p.mediaItems[i]?.type===f.type))throw Error('The Zernio post differs from the approved account, text or files.');
 for(const [key,value] of Object.entries(op.networkSettings??{}))if(stable(target.platformSpecificData?.[key])!==stable(value))throw Error('The Zernio network settings differ from the approval.');
 const status=target.status==='pending'?p.status:target.status;
 if(p.status==='draft'&&['draft','pending',undefined].includes(target.status))return {status:'draft'};
 if(p.status==='scheduled'&&status==='scheduled'&&op.arguments.scheduledTime&&Date.parse(target.scheduledFor??p.scheduledFor)===Date.parse(op.arguments.scheduledTime))return {status:'scheduled',scheduledAt:target.scheduledFor??p.scheduledFor};
 if(p.status==='published'&&status==='published'&&target.platformPostUrl)return {status:'published',platformPostId:target.platformPostUrl,scheduledAt:p.scheduledFor};
 if(p.status==='failed'||status==='failed')return {status:'failed'};
 throw Error('Zernio has not confirmed the requested final state. Check the existing post.');
}
/** Native API transport: one fixed provider, no renderer keys or arbitrary URLs. */
export function createZernioPublicationConnector(getKey,{fetchImpl=fetch}={}){
 let bound;
 const request=async(path,method='GET',body,key)=>{
  const secret=getKey();if(!secret)throw Error('Save the Zernio API key in the calendar connection settings.');
  if(bound&&bound!==secret)throw Error('Zernio credentials changed. Reopen the delivery.');bound=secret;
  let response;try{response=await fetchImpl(new URL(path,'https://zernio.com/api/v1/'),{method,redirect:'error',headers:{authorization:`Bearer ${secret}`,accept:'application/json',...(body?{'content-type':'application/json'}:{}),...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});}catch{throw Error('Zernio did not confirm the operation. Check the existing post before retrying.');}
  if(!response.ok)throw Error(`Zernio returned HTTP ${response.status}. Check connection, permissions and post requirements.`);
  let bytes=0;const chunks=[];for await(const chunk of response.body){bytes+=chunk.length;if(bytes>8_000_000)throw Error('Zernio response exceeds the size limit.');chunks.push(Buffer.from(chunk));}
  let result;try{result=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw Error('Zernio returned no verifiable JSON.');}
  if(getKey()!==secret)throw Error('Zernio credentials changed. Check the result using the original account.');return result;
 };
 const path=id=>{if(!identity(id))throw Error('Invalid Zernio post identifier.');return `posts/${encodeURIComponent(id)}`;};
 return {
  verify:verifiedZernioPublication,
  async accounts(){const secret=getKey();if(bound&&bound!==secret)throw Error('Zernio credentials changed.');bound=secret;return createZernioCalendarApi(getKey,{fetchImpl}).accounts();},
  async options(accountId,mediaType='video'){if(!identity(accountId)||!['video','photo'].includes(mediaType))throw Error('Select a TikTok account.');const info=await request(`accounts/${encodeURIComponent(accountId)}/tiktok/creator-info?mediaType=${mediaType}`);if(!Array.isArray(info.privacyLevels)||!info.postingLimits)throw Error('TikTok creator settings could not be verified.');return info;},
  async preflight(op){if(op.platform!=='tiktok')return;const info=await this.options(op.accountId,op.files?.every(f=>f.type==='image')?'photo':'video'),s=op.networkSettings?.tiktokSettings;
   if(!s||s.content_preview_confirmed!==true||s.express_consent_given!==true||!info.privacyLevels.some(p=>p.value===s.privacy_level)||!info.commercialContentTypes?.some(p=>p.value===s.commercialContentType)||s.commercialContentType==='brand_content'&&s.privacy_level==='SELF_ONLY')throw Error('Review TikTok privacy, disclosure and consent for this account.');
   for(const field of ['allow_comment','allow_duet','allow_stitch'])if(info.postingLimits.interactionSettings?.[field]?.enabled===false&&s[field]!==false)throw Error('An interaction is disabled by this TikTok account. Review the delivery settings.');
   if(info.creator?.canPostMore===false)throw Error('This TikTok account cannot accept more posts now.');
  },
  async media(op,files,checkpoint,guard){
   for(const file of files){if(op.uploads?.some(u=>u.assetId===file.assetId&&u.sha256===file.sha256&&u.status==='uploaded'))continue;
    await guard();const slot=await request('media/presign','POST',{filename:file.name,contentType:file.contentType,size:file.size});uploadDestination(slot.uploadUrl);
    const publicUrl=new URL(slot.publicUrl);if(publicUrl.protocol!=='https:'||publicUrl.hostname!=='media.zernio.com'||publicUrl.search||publicUrl.username||publicUrl.password)throw Error('Unverifiable Zernio media URL.');
    await uploadPublicationFile(file,slot.uploadUrl,{fetchImpl});await guard();
    op.uploads??=[];op.uploads.push({assetId:file.assetId,versionId:file.versionId,sha256:file.sha256,name:file.name,type:file.type,url:publicUrl.href,status:'uploaded'});await checkpoint(op);
   }
  },
  async create(op){const data=await request('posts','POST',zernioBody(op),op.arguments.idempotencyKey);if(!identity(data.post?._id))throw Error('Zernio returned no post ID. Do not create another post.');return data.post._id;},
  read(id){return request(path(id));},
  update(op){return request(path(op.externalId),'PUT',zernioBody(op));},
  cancel(id){return request(path(id),'PUT',{isDraft:true,publishNow:false});},
 };
}
