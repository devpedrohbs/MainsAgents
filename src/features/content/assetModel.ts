import type { EditorialState } from './model';
export type AssetRole='source'|'reference'|'output';
export type AssetKind='video'|'image'|'audio'|'document';
export type AssetStatus='available'|'unchecked'|'missing'|'changed'|'unstable'|'error';
export interface LocalAssetInspection {path:string;checkedAt:string;status:'available'|'missing'|'unstable'|'error';name?:string;kind?:AssetKind;size?:number;sha256?:string;modifiedAt?:string;error?:string}
export interface AssetVersion {id:string;path:string;name:string;size:number;sha256:string;modifiedAt:string;createdAt:string}
export interface EditorialAsset {id:string;workspaceId:string;contentId:string;name:string;kind:AssetKind;role:AssetRole;sourceAssetId?:string;currentVersionId:string;versions:AssetVersion[];status:AssetStatus;checkedAt?:string;lastError?:string;createdAt:string;updatedAt:string}
export const currentAssetVersion=(asset:EditorialAsset)=>asset.versions.find(version=>version.id===asset.currentVersionId)!;
function verifiedVersion(file:LocalAssetInspection):AssetVersion {
  if(file.status!=='available'||!file.name||!file.kind||!file.sha256||file.size===undefined||!file.modifiedAt)throw new Error(file.error||'Verify a stable, readable file before adding it.');
  return {id:crypto.randomUUID(),path:file.path,name:file.name,size:file.size,sha256:file.sha256,modifiedAt:file.modifiedAt,createdAt:new Date().toISOString()};
}
export function attachAssetFiles(state:EditorialState,contentId:string,files:LocalAssetInspection[],role:AssetRole):EditorialState {
  const content=state.contents.find(item=>item.id===contentId);
  if(!content||!['source','reference','output'].includes(role))throw new Error('Choose a valid content and file role.');
  const assets=[...(state.assets??[])];
  for(const file of files){
    const version=verifiedVersion(file);
    if(assets.some(asset=>asset.contentId===contentId&&asset.workspaceId===content.workspaceId&&asset.versions.some(item=>item.sha256===version.sha256)))continue;
    const now=new Date().toISOString();
    assets.push({id:crypto.randomUUID(),contentId,workspaceId:content.workspaceId,name:version.name,kind:file.kind!,role,currentVersionId:version.id,versions:[version],status:'available',checkedAt:file.checkedAt,createdAt:now,updatedAt:now});
  }
  return {...state,assets,contents:state.contents.map(item=>item.id===contentId?{...item,assetIds:assets.filter(asset=>asset.contentId===contentId).map(asset=>asset.id)}:item)};
}
export function reviseAssetFile(state:EditorialState,assetId:string,expectedVersionId:string,file:LocalAssetInspection,relink:boolean):EditorialState {
  const asset=state.assets?.find(item=>item.id===assetId);
  if(!asset||asset.currentVersionId!==expectedVersionId)throw new Error('The file version changed. Reload before modifying it.');
  const version=verifiedVersion(file),current=currentAssetVersion(asset);
  if(state.assets!.some(item=>item.id!==asset.id&&item.contentId===asset.contentId&&item.workspaceId===asset.workspaceId&&item.versions.some(saved=>saved.sha256===version.sha256)))throw new Error('This file already belongs to another association in this content.');
  if(relink&&version.sha256!==current.sha256)throw new Error('This is a different file. Add it as a new version instead of relinking.');
  const prior=asset.versions.find(item=>item.sha256===version.sha256);
  if(!relink&&prior&&prior.id!==current.id)throw new Error('This file is already saved as an older version.');
  if(!prior&&asset.versions.length>=100)throw new Error('This asset already has 100 versions. Add a separate file.');
  const updated:EditorialAsset={...asset,name:version.name,kind:file.kind!,status:'available',checkedAt:file.checkedAt,lastError:undefined,updatedAt:new Date().toISOString(),currentVersionId:prior?.id??version.id,versions:prior?asset.versions.map(item=>item.id===prior.id?{...item,path:version.path,name:version.name,modifiedAt:version.modifiedAt}:item):[...asset.versions,version]};
  return invalidateFileReadiness({...state,assets:state.assets!.map(item=>item.id===assetId?updated:item)});
}
export function verifyAssetFiles(state:EditorialState,checks:Array<{id:string;versionId:string;inspection:LocalAssetInspection}>):EditorialState {
  return invalidateFileReadiness({...state,assets:(state.assets??[]).map(asset=>{
    const check=checks.find(item=>item.id===asset.id&&item.versionId===asset.currentVersionId);if(!check)return asset;
    const current=currentAssetVersion(asset),file=check.inspection;if(file.path!==current.path)return asset;
    const changed=file.status==='available'&&file.sha256!==current.sha256;
    return {...asset,status:changed?'changed':file.status,checkedAt:file.checkedAt,lastError:changed?'The file changed since this version was saved. Add the updated file as a new version.':file.error};
  })});
}
export function changeAssetMetadata(state:EditorialState,id:string,role:AssetRole,sourceAssetId?:string):EditorialState {
  const asset=state.assets?.find(item=>item.id===id);
  if(!asset||!['source','reference','output'].includes(role))throw new Error('Choose a valid file and role.');
  if(sourceAssetId){
    const source=state.assets?.find(item=>item.id===sourceAssetId&&item.contentId===asset.contentId&&item.workspaceId===asset.workspaceId);
    if(!source||source.id===id)throw new Error('Choose an original file from this content.');
    const visited=new Set([id]);let parent:EditorialAsset|undefined=source;
    while(parent){if(visited.has(parent.id))throw new Error('A file cannot derive from itself.');visited.add(parent.id);parent=state.assets?.find(item=>item.id===parent?.sourceAssetId);}
  }
  return {...state,assets:state.assets!.map(item=>item.id===id?{...item,role,sourceAssetId:role==='output'?sourceAssetId:undefined,updatedAt:new Date().toISOString()}:item)};
}
export function removeAsset(state:EditorialState,id:string):EditorialState {
  const assets=(state.assets??[]).filter(item=>item.id!==id).map(item=>item.sourceAssetId===id?{...item,sourceAssetId:undefined}:item);
  return invalidateFileReadiness({...state,assets,contents:state.contents.map(item=>({...item,assetIds:assets.filter(asset=>asset.contentId===item.id&&asset.workspaceId===item.workspaceId).map(asset=>asset.id)}))});
}

/** Preserve approval history, but a changed or unavailable delivered version is no longer ready. */
export function invalidateFileReadiness(state:EditorialState):EditorialState {
 return {...state,contents:state.contents.map(content=>{
  if(content.productionStage!=='ready'||!content.fileDeliveryArtifactId)return content;
  const delivery=state.artifacts.find(item=>item.id===content.fileDeliveryArtifactId&&item.type==='file-delivery');
  const data=delivery?.data as import('./model').FileDelivery|undefined;
  const valid=data?.files.every(ref=>state.assets?.some(asset=>asset.id===ref.assetId&&asset.contentId===content.id&&asset.currentVersionId===ref.versionId&&asset.status==='available'&&currentAssetVersion(asset).sha256===ref.sha256));
  return valid?content:{...content,productionStage:'video-review',updatedAt:new Date().toISOString()};
 })};
}
