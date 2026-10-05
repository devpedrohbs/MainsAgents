export function validateEditorialAssets(state) {
  if (!state || typeof state !== 'object') return false;
  if (state.assets === undefined) return true;
  if (!Array.isArray(state.assets) || state.assets.length > 5000) return false;
  const ids=new Set(),text=value=>typeof value==='string'&&value.length>0;
  for(const asset of state.assets){
    if(!asset||!text(asset.id)||ids.has(asset.id)||!text(asset.contentId)||!text(asset.workspaceId)||!text(asset.name)||!['source','reference','output'].includes(asset.role)||!['video','image','audio','document'].includes(asset.kind)||!['available','unchecked','missing','changed','unstable','error'].includes(asset.status)||!text(asset.createdAt)||!text(asset.updatedAt)||!Array.isArray(asset.versions)||!asset.versions.length||asset.versions.length>100)return false;
    ids.add(asset.id);
    if(!state.contents?.some(item=>item.id===asset.contentId&&item.workspaceId===asset.workspaceId))return false;
    const versions=new Set();
    for(const version of asset.versions){if(!version||!text(version.id)||versions.has(version.id)||!text(version.path)||version.path.length>4096||!text(version.name)||!Number.isSafeInteger(version.size)||version.size<0||!/^[a-f0-9]{64}$/.test(version.sha256)||!text(version.modifiedAt)||!text(version.createdAt))return false;versions.add(version.id);}
    if(!versions.has(asset.currentVersionId))return false;
    if(asset.sourceAssetId&&!state.assets.some(item=>item.id===asset.sourceAssetId&&item.id!==asset.id&&item.contentId===asset.contentId&&item.workspaceId===asset.workspaceId))return false;
    const chain=new Set([asset.id]);let source=asset.sourceAssetId;
    while(source){if(chain.has(source))return false;chain.add(source);source=state.assets.find(item=>item.id===source)?.sourceAssetId;}
  }
  return true;
}
