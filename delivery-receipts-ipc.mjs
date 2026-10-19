/**
 * Receipt actions for the trusted app window. The renderer only sends a receipt id; the host re-reads the file and acts
 * only when its bytes still match the receipt (sha256). Paths never come from the renderer.
 */
export const openableReceiptKinds=Object.freeze(['video','image','audio']);
export function registerDeliveryReceiptsIpc({ipcMain,shell,getWindow,getReceipts,getCurrentProfile}){
 const trusted=(event,profile)=>{
  if(event.sender!==getWindow()?.webContents||event.senderFrame&&event.senderFrame!==event.sender.mainFrame)throw new Error('Untrusted application window');
  if(typeof profile!=='string'||getCurrentProfile?.()!==profile)throw new Error('The active profile changed. Reopen the workspace.');
  const receipts=getReceipts();if(!receipts)throw new Error('Local storage is still starting.');return receipts;
 };
 const verified=async(event,profile,id)=>{const result=await trusted(event,profile).check(profile,id);if(result.status!=='available')throw new Error(result.status==='changed'?'The file changed after delivery. Ask for a new version.':result.status==='missing'?'The delivered file was moved or removed.':result.error||'The delivered file cannot be read.');return result.receipt;};
 ipcMain.handle('receipts:check',async(event,profile,id)=>{const result=await trusted(event,profile).check(profile,id);return {status:result.status};});
 ipcMain.handle('receipts:open',async(event,profile,id)=>{const receipt=await verified(event,profile,id);if(!openableReceiptKinds.includes(receipt.fileKind))throw new Error('Only verified media can be opened; use “Show in folder”.');const error=await shell.openPath(receipt.path);if(error)throw new Error(error);return true;});
 ipcMain.handle('receipts:reveal',async(event,profile,id)=>{const receipt=await verified(event,profile,id);shell.showItemInFolder(receipt.path);return true;});
}
