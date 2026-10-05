import {randomUUID} from 'node:crypto';
import {artifactHash} from './editorial-jobs.mjs';

import {publicationPlatforms,publicationPayload,validTimeZone,validatePublications} from './publication-model.mjs';
export {publicationPlatforms,publicationPayload,validTimeZone,validatePublications} from './publication-model.mjs';
const text=(value,max=100000)=>typeof value==='string'&&value.length<=max;
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));

/** Local planning/review only. Provider receipts cannot be supplied by a UI command. */
export function createEditorialPublications(db){
  const snapshot=profile=>{const row=db.prepare('SELECT revision,state_json FROM editorial_state WHERE profile_id=?').get(profile);return row?{revision:row.revision,state:JSON.parse(row.state_json)}:null;};
  return {command(profile,input){
    db.exec('BEGIN IMMEDIATE');
    try{
      const current=snapshot(profile);
      if(!current||current.revision!==input.revision)throw new Error('Editorial data changed. Reload before deciding.');
      const state=current.state,at=new Date().toISOString();state.publications??=[];
      const content=state.contents.find(item=>item.id===input.contentId);
      if(!content)throw new Error('Choose an existing content card.');
      let delivery=state.publications.find(item=>item.id===input.id&&item.contentId===content.id&&item.workspaceId===content.workspaceId);
      if(input.action==='create'){
        if(!publicationPlatforms.includes(input.platform))throw new Error('Choose a supported network.');
        if(state.publications.some(item=>item.contentId===content.id&&item.platform===input.platform))throw new Error('This content already has a delivery for that network. Open it to edit.');
        delivery={id:`publication-${randomUUID()}`,contentId:content.id,workspaceId:content.workspaceId,platform:input.platform,version:1,status:'draft',text:'',media:[],timeZone:input.timeZone||'America/Sao_Paulo',history:[],createdAt:at,updatedAt:at};
        state.publications.push(delivery);
      }else if(!delivery||artifactHash(delivery)!==artifactHash(input.expectedDelivery))throw new Error('The reviewed delivery changed. Reopen it before deciding.');
      if(!['create','edit','submit','approve','reject','revise'].includes(input.action))throw new Error('Use the publishing connector to confirm scheduling or publication.');
      if(['sending','scheduled','published'].includes(delivery.status))throw new Error('Reconcile or cancel the external delivery before changing it.');
      if(['create','edit'].includes(input.action)){
        const draft=input.draft??{};
        if(!text(draft.text)||!validTimeZone(draft.timeZone)||draft.plannedAt!==undefined&&draft.plannedAt!==''&&!date(draft.plannedAt)||!Array.isArray(draft.assetIds)||draft.assetIds.length>30)throw new Error('Enter text, valid time zone and linked files.');
        const media=[...new Set(draft.assetIds)].map(id=>{
          const asset=state.assets?.find(item=>item.id===id&&item.contentId===content.id&&item.workspaceId===content.workspaceId);
          const version=asset?.versions.find(item=>item.id===asset.currentVersionId);
          if(!asset||!version||asset.status!=='available')throw new Error('Check the linked file before selecting it.');
          return {assetId:asset.id,versionId:version.id,sha256:version.sha256};
        });
        const next={...delivery,text:draft.text.trim(),media,timeZone:draft.timeZone,plannedAt:draft.plannedAt?new Date(draft.plannedAt).toISOString():undefined};
        const changed=artifactHash(publicationPayload(delivery))!==artifactHash(publicationPayload(next));
        if(input.action==='edit'&&changed)delivery.version++;
        Object.assign(delivery,publicationPayload(next));
        if(changed){delivery.status='draft';delete delivery.receipt;}
      }else{
        if(!text(input.notes??'',5000))throw new Error('Keep review notes under 5000 characters.');
        if(input.action==='approve'&&delivery.status!=='in-review')throw new Error('Submit this version for review before approving.');
        if(['approve','submit'].includes(input.action)&&!delivery.text.trim()&&!delivery.media.length)throw new Error('Add text or a file before reviewing.');
        if(input.action==='approve')for(const ref of delivery.media){
          const asset=state.assets?.find(item=>item.id===ref.assetId&&item.contentId===content.id&&item.workspaceId===content.workspaceId);
          const version=asset?.versions.find(item=>item.id===asset.currentVersionId);
          if(asset?.status!=='available'||version?.id!==ref.versionId||version.sha256!==ref.sha256)throw new Error('A selected file changed. Edit and review the delivery again.');
        }
        delivery.status=input.action==='submit'?'in-review':input.action==='approve'?'approved':'draft';
        delivery.history.push({version:delivery.version,status:delivery.status,decision:input.action,notes:input.notes??'',payloadHash:artifactHash(publicationPayload(delivery)),payload:structuredClone(publicationPayload(delivery)),at});
        if(delivery.history.length>200)throw new Error('Review history reached its limit. Export a backup before continuing.');
      }
      delivery.updatedAt=at;
      if(!validatePublications(state))throw new Error('Invalid publication data. Saved records were preserved.');
      db.prepare('UPDATE editorial_state SET revision=?,state_json=?,updated_at=? WHERE profile_id=?').run(current.revision+1,JSON.stringify(state),at,profile);
      db.exec('COMMIT');return {revision:current.revision+1,state};
    }catch(error){db.exec('ROLLBACK');throw error;}
  }};
}
