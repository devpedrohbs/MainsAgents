/**
 * Server/backup validation of the reference library stored in editorial state (`state.inspiration`).
 * Strict whitelist: references keep a link and/or an existing video asset id of the same workspace, never a file path,
 * and carry no instruction or execution field. Pure and dependency-free (also used by the renderer backup parser).
 */
const referenceKeys=['id','workspaceId','sourceUrl','sourceHost','platform','title','author','notes','tags','asset','metadataStatus','revision','createdAt','updatedAt','removedAt'];
const platforms=['instagram','tiktok','youtube','facebook','x','other'];
const text=(value,max,required=false)=>value===undefined?!required:typeof value==='string'&&value.length<=max&&(!required||value.length>0);
const time=value=>typeof value==='string'&&value.length<=40&&Number.isFinite(Date.parse(value));
function link(value){
 if(value===undefined)return true;
 if(typeof value!=='string'||value.length>2048||/\s/.test(value))return false;
 try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&url.hostname.includes('.');}catch{return false;}
}
export function validateInspirationState(state){
 const library=state?.inspiration;
 if(library===undefined)return true;
 if(!library||typeof library!=='object'||library.schemaVersion!==1||!Array.isArray(library.references)||library.references.length>5000||Object.keys(library).some(key=>!['schemaVersion','references'].includes(key)))return false;
 const ids=new Set(),assets=Array.isArray(state.assets)?state.assets:[];
 for(const item of library.references){
  if(!item||typeof item!=='object'||Object.keys(item).some(key=>!referenceKeys.includes(key)))return false;
  if(!text(item.id,120,true)||ids.has(item.id)||!text(item.workspaceId,200,true))return false;ids.add(item.id);
  if(!link(item.sourceUrl)||!text(item.sourceHost,255)||item.platform!==undefined&&!platforms.includes(item.platform))return false;
  if(!text(item.title,160)||!text(item.author,120)||!text(item.notes,4000,false)||typeof item.notes!=='string')return false;
  if(!Array.isArray(item.tags)||item.tags.length>12||item.tags.some(tag=>!text(tag,32,true)))return false;
  if(item.metadataStatus!=='not_collected'||!Number.isSafeInteger(item.revision)||item.revision<1||!time(item.createdAt)||!time(item.updatedAt)||item.removedAt!==undefined&&!time(item.removedAt))return false;
  if(item.asset!==undefined){
   if(!item.asset||typeof item.asset!=='object'||Object.keys(item.asset).some(key=>!['assetId','name'].includes(key))||!text(item.asset.assetId,200,true)||!text(item.asset.name,300))return false;
   // A removed asset is allowed (shown as unavailable); an asset of another workspace or a non-video is not.
   const asset=assets.find(entry=>entry?.id===item.asset.assetId);if(asset&&(asset.workspaceId!==item.workspaceId||asset.kind!=='video'))return false;
  }
  if(item.sourceUrl===undefined&&item.asset===undefined)return false;
 }
 return true;
}
