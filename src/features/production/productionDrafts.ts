import {studioDraftKey} from '../content/studioDraftModel.ts';
import type {ProductionRun,ScheduleTarget} from './model';
import type {EditorialAsset} from '../content/assetModel';

export const startDraftScope=(workspace:string,flow:string,session='')=>studioDraftKey('production-start',workspace,flow,session);
export const runDraftScope=(workspace:string,run:string,step:string)=>studioDraftKey('production-run',workspace,run,step);
export function scheduleDraftScope(run:ProductionRun){
 return studioDraftKey('production-schedule',run.workspaceId,run.id,run.reviewHash??'',JSON.stringify((run.reviewDeliveries??[]).map(d=>[d.id,d.version])),JSON.stringify(run.approvedVideo??null));
}
export const validSelection=(id:string,entities:readonly {id:string}[])=>entities.some(item=>item.id===id)?id:'';
export const validNetworks=(value:readonly string[])=>[...new Set(value.filter(p=>['Instagram','TikTok','LinkedIn'].includes(p)))];
export function videoDraftValue(asset:EditorialAsset){const v=asset.versions.find(v=>v.id===asset.currentVersionId);return v?JSON.stringify({assetId:asset.id,versionId:v.id,sha256:v.sha256}):'';}
export function restoreVideo(value:string,assets:readonly EditorialAsset[]){
 if(!value)return '';
 return assets.find(a=>a.kind==='video'&&a.role==='source'&&a.status==='available'&&videoDraftValue(a)===value)?.id??'';
}
/** Whitelist preferences; consent and reviewed-media confirmation never enter a draft. */
export function draftTarget(target:ScheduleTarget):ScheduleTarget {
 const settings=target.networkSettings,t=settings?.tiktokSettings;
 return {platform:target.platform,provider:target.provider,accountId:target.accountId,
  ...(settings?{networkSettings:{...(settings.contentType==='story'?{contentType:'story' as const}:{}),...(typeof settings.shareToFeed==='boolean'?{shareToFeed:settings.shareToFeed}:{}),...(t?{tiktokSettings:{privacy_level:typeof t.privacy_level==='string'?t.privacy_level:'',commercialContentType:typeof t.commercialContentType==='string'?t.commercialContentType:'none',allow_comment:t.allow_comment===true,allow_duet:t.allow_duet===true,allow_stitch:t.allow_stitch===true,video_made_with_ai:t.video_made_with_ai===true,content_preview_confirmed:false,express_consent_given:false}}:{})}}:{})};
}
export function targetsDraftValue(targets:ScheduleTarget[]){
 // Omit confirmation keys altogether, including false, from stored data.
 return JSON.stringify(targets.map(draftTarget),(key,value)=>['content_preview_confirmed','express_consent_given'].includes(key)?undefined:value);
}
export function restoreTargets(value:string,run:ProductionRun):ScheduleTarget[]{
 let saved:unknown;try{saved=JSON.parse(value)}catch{saved=[]}
 const list=Array.isArray(saved)?saved:[];
 return (run.reviewDeliveries??[]).map(delivery=>{
  const item=list.find(t=>t&&t.platform===delivery.platform);
  const provider=item?.provider==='publora'&&delivery.platform==='LinkedIn'&&!delivery.cover?'publora':'zernio';
  const settings=item?.networkSettings&&typeof item.networkSettings==='object'?item.networkSettings:delivery.networkSettings;
  return draftTarget({platform:delivery.platform,provider,accountId:item?.provider===provider&&typeof item.accountId==='string'?item.accountId:'',networkSettings:settings});
 });
}
export function validTimeZone(zone:string,fallback='UTC'){try{new Intl.DateTimeFormat('en',{timeZone:zone});return zone}catch{return fallback}}
export function validLocalDate(value:string){
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))return '';
 const date=new Date(`${value}:00Z`);return Number.isFinite(date.getTime())&&date.toISOString().slice(0,16)===value?value:'';
}
export function scheduleFingerprint(scope:string,text:string,date:string,zone:string,targets:ScheduleTarget[]){return JSON.stringify({scope,text,date,zone,targets});}
