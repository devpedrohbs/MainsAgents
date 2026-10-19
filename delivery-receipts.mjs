import {randomUUID} from 'node:crypto';
import {inspectLocalAsset,localAssetPath} from './editorial-local-files.mjs';

/**
 * Host delivery receipts: the only source of the absolute path the user sees for a finished file. A receipt is issued
 * after the host itself inspected the committed file (size + sha256), never from model text, a planned path, a partial
 * or a failed/late result. Receipts are per profile; the UI gets them inside the chat/production item they belong to.
 */
export const receiptSources=Object.freeze(['production-video','production-captions','production-adjusted','media-export','delegation','editor-tool','generated-image','paper-export']);
const text=(value,max)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f]/.test(value);
const optionalId=value=>value===undefined||text(value,200);

/** Public shape (no profile id). Old receipts without optional fields stay valid. */
export function receiptView(row){
 const {profileId:_p,...view}=row;void _p;return view;
}

/** Shape check for receipts that come back from the renderer/backup (display only; the host re-verifies before opening). */
export function validReceiptView(value){
 return !!value&&typeof value==='object'&&text(value.id,120)&&text(value.path,4096)&&/^(?:[a-z]:[\\/]|\/[^/])/i.test(value.path)&&text(value.name,512)&&/^[a-f0-9]{64}$/.test(value.sha256??'')&&Number.isSafeInteger(value.size)&&value.size>=0&&Number.isSafeInteger(value.version)&&value.version>0&&receiptSources.includes(value.source?.kind)&&text(value.createdAt,40);
}

export function createDeliveryReceipts(db,{inspect=inspectLocalAsset,getCurrentProfile}={}){
 db.exec('CREATE TABLE IF NOT EXISTS delivery_receipts(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,source_key TEXT NOT NULL,scope TEXT NOT NULL,data_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(profile_id,source_key))');
 const row=(profile,id)=>{const value=db.prepare('SELECT data_json FROM delivery_receipts WHERE profile_id=? AND id=?').get(profile,id);return value?JSON.parse(value.data_json):null;};
 const profileCheck=profile=>{if(getCurrentProfile&&getCurrentProfile()!==profile)throw new Error('The active profile changed.');};
 return {
  /**
   * Verifies `path` on disk and records it. `expectedSha256` (from the engine that produced the file) must match.
   * Idempotent per source+file: a retry/restart returns the same receipt, so the chat never shows duplicates.
   */
  async issue(profile,input={}){
   profileCheck(profile);
   const source=input.source;
   if(!source||!receiptSources.includes(source.kind)||!text(source.id,200)||!optionalId(source.step)||![input.contentId,input.workspaceId,input.sessionId,input.assetId,input.versionId].every(optionalId))throw new Error('Invalid delivery receipt request.');
   const path=localAssetPath(input.path);
   if(/\.partial(\.|$)/i.test(path))throw new Error('A partial file is never a delivery.');
   const file=await inspect(path);
   if(file.status!=='available'||!file.sha256)throw new Error(file.error||'The delivered file could not be verified.');
   if(input.expectedSha256!==undefined&&input.expectedSha256!==file.sha256)throw new Error('The delivered file differs from the verified result.');
   profileCheck(profile);
   const key=`${source.kind}:${source.id}:${source.step??''}:${file.sha256}`,prior=db.prepare('SELECT data_json FROM delivery_receipts WHERE profile_id=? AND source_key=?').get(profile,key);
   if(prior)return receiptView(JSON.parse(prior.data_json));
   const scope=input.contentId??input.sessionId??source.id;
   // Version = order of distinct delivered files in this content/chat; the same bytes delivered by two sources share it.
   const scoped=db.prepare('SELECT data_json FROM delivery_receipts WHERE profile_id=? AND scope=?').all(profile,scope).map(r=>JSON.parse(r.data_json));
   const version=input.version??scoped.find(r=>r.sha256===file.sha256)?.version??new Set(scoped.map(r=>r.sha256)).size+1;
   const producedBy=input.producedBy&&typeof input.producedBy==='object'?Object.fromEntries(['agentName','providerId','modelId'].filter(k=>text(input.producedBy[k],200)).map(k=>[k,input.producedBy[k]])):undefined;
   const receipt={id:`receipt-${randomUUID()}`,profileId:profile,schema:'mainsagents.receipt/1',source:{kind:source.kind,id:source.id,...(source.step?{step:source.step}:{})},
    ...Object.fromEntries(['contentId','workspaceId','sessionId','assetId','versionId'].filter(k=>input[k]!==undefined).map(k=>[k,input[k]])),
    name:file.name,path:file.path,size:file.size,sha256:file.sha256,fileKind:file.kind,version,...(text(input.label,200)?{label:input.label}:{}),...(producedBy&&Object.keys(producedBy).length?{producedBy}:{}),createdAt:new Date().toISOString()};
   db.prepare('INSERT OR IGNORE INTO delivery_receipts VALUES(?,?,?,?,?,?)').run(receipt.id,profile,key,scope,JSON.stringify(receipt),receipt.createdAt);
   return receiptView(JSON.parse(db.prepare('SELECT data_json FROM delivery_receipts WHERE profile_id=? AND source_key=?').get(profile,key).data_json));
  },
  get(profile,id){profileCheck(profile);const value=typeof id==='string'?row(profile,id):null;return value?receiptView(value):null;},
  list(profile,{contentId,sessionId,sourceId}={}){profileCheck(profile);return db.prepare('SELECT data_json FROM delivery_receipts WHERE profile_id=? ORDER BY created_at').all(profile).map(r=>JSON.parse(r.data_json)).filter(r=>(contentId===undefined||r.contentId===contentId)&&(sessionId===undefined||r.sessionId===sessionId)&&(sourceId===undefined||r.source.id===sourceId)).map(receiptView);},
  /** Re-reads the file: `available` only when the bytes still match the receipt. Used before open/reveal. */
  async check(profile,id){
   profileCheck(profile);const receipt=typeof id==='string'?row(profile,id):null;if(!receipt)throw Object.assign(new Error('Delivery receipt not found in this profile.'),{status:404});
   const file=await inspect(receipt.path);profileCheck(profile);
   const status=file.status==='missing'?'missing':file.status!=='available'?'unavailable':file.sha256===receipt.sha256?'available':'changed';
   return {receipt:receiptView(receipt),status,...(file.error&&status!=='available'?{error:file.error}:{})};
  },
 };
}
