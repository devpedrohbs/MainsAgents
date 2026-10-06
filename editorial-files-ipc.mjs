import {assetExtensions,inspectLocalAsset} from './editorial-local-files.mjs';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {extname} from 'node:path';

/** Only the trusted application renderer can request read-only local file operations. */
export function registerEditorialFilesIpc({ipcMain,dialog,shell,getWindow,getStore,inspect=inspectLocalAsset}) {
  let busy=false;
  const context=(event,profile,contentId)=>{
    if(event.sender!==getWindow()?.webContents||event.senderFrame&&event.senderFrame!==event.sender.mainFrame)throw new Error('Untrusted application window');
    const store=getStore();if(!store||store.currentProfile()!==profile)throw new Error('The active profile changed. Reopen the workspace.');
    const state=store.workspaceSnapshot(profile).editorial.state;
    if(typeof contentId!=='string'||!state.contents.some(item=>item.id===contentId))throw new Error('Choose an existing content card.');
    return state;
  };
  const operation=(name,fn)=>ipcMain.handle(`files:${name}`,async(event,profile,contentId,...args)=>{
    context(event,profile,contentId);if(busy)throw new Error('Wait for the current file verification to finish.');busy=true;
    try{const result=await fn(event,profile,contentId,...args);context(event,profile,contentId);return result;}finally{busy=false;}
  });
  operation('preview',async(event,profile,contentId,assetId)=>{const asset=context(event,profile,contentId).assets?.find(a=>a.id===assetId&&a.contentId===contentId),v=asset?.versions.find(v=>v.id===asset.currentVersionId);if(asset?.kind!=='image'||!v||v.size>8*1024*1024)throw Error('Escolha uma imagem vinculada de até 8 MB.');const mime={'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp'}[extname(v.path).toLowerCase()];if(!mime)throw Error('Formato de prévia não suportado.');const inspected=await inspect(v.path);if(inspected.status!=='available'||inspected.sha256!==v.sha256)throw Error('A capa mudou. Confira a versão atual.');const bytes=await readFile(inspected.path);if(bytes.length>8*1024*1024||createHash('sha256').update(bytes).digest('hex')!==v.sha256||context(event,profile,contentId).assets.find(a=>a.id===assetId)?.currentVersionId!==v.id)throw Error('A capa mudou durante a leitura.');return `data:${mime};base64,${bytes.toString('base64')}`;});
  operation('select',async(event,profile,contentId,multiple)=>{
    const selection=await dialog.showOpenDialog(getWindow(),{title:'Content files',properties:multiple?['openFile','multiSelections']:['openFile'],filters:[{name:'Video, image, audio and documents',extensions:assetExtensions}]});
    context(event,profile,contentId);if(selection.canceled)return [];
    if(selection.filePaths.length>20)throw new Error('Add up to 20 files at a time.');
    const results=[];for(const path of selection.filePaths)results.push(await inspect(path));return results;
  });
  operation('inspect',async(_event,_profile,_contentId,paths)=>{
    if(!Array.isArray(paths)||!paths.length||paths.length>20||paths.some(path=>typeof path!=='string'))throw new Error('Add up to 20 local files at a time.');
    const results=[];for(const path of paths)results.push(await inspect(path));return results;
  });
  operation('verify',async(event,profile,contentId)=>{
    const state=context(event,profile,contentId),results=[];
    for(const asset of (state.assets??[]).filter(item=>item.contentId===contentId)){
      const version=asset.versions.find(item=>item.id===asset.currentVersionId);
      results.push({id:asset.id,versionId:version.id,inspection:await inspect(version.path)});
    }return results;
  });
  const showFile=async(event,profile,contentId,assetId,open)=>{
    const state=context(event,profile,contentId),asset=state.assets?.find(item=>item.id===assetId&&item.contentId===contentId);
    if(!asset)throw new Error('File association was removed.');
    const version=asset.versions.find(item=>item.id===asset.currentVersionId),file=await inspect(version.path);
    if(file.status!=='available')throw new Error(file.error);
    if(file.sha256!==version.sha256)throw new Error('This file changed. Verify it and add a new version.');
    const current=context(event,profile,contentId).assets?.find(item=>item.id===assetId);
    if(current?.currentVersionId!==version.id)throw new Error('File version changed. Verify again.');
    if(open){if(!['video','image','audio'].includes(asset.kind)||file.kind!==asset.kind)throw new Error('Only verified linked media can be opened for review.');const error=await shell.openPath(file.path);if(error)throw new Error(error);}
    else shell.showItemInFolder(file.path);return true;
  };
  operation('reveal',(event,profile,contentId,assetId)=>showFile(event,profile,contentId,assetId,false));
  operation('open',(event,profile,contentId,assetId)=>showFile(event,profile,contentId,assetId,true));
}
