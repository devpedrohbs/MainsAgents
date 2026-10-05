import {randomUUID} from 'node:crypto';
import {artifactHash} from './editorial-jobs.mjs';
import {decodeChatDelivery} from './chat-delivery-protocol.mjs';
import {localAssetPath} from './editorial-local-files.mjs';
/** Verification occurs outside the SQLite transaction, then revision and origin are rechecked. */
export function createFileDeliveries(db,{getSessions,getAgents,getCurrentProfile,inspect}){
 const id=prefix=>`${prefix}-${randomUUID()}`;
 const profileCheck=profile=>{if(getCurrentProfile?.()!==profile)throw new Error('The active profile changed.');};
 const load=(profile,revision)=>{profileCheck(profile);const row=db.prepare('SELECT revision,state_json FROM editorial_state WHERE profile_id=?').get(profile);if(!row||row.revision!==revision)throw new Error('Editorial data changed. Reopen the delivery.');return JSON.parse(row.state_json);};
 const save=(profile,revision,state)=>{db.prepare('UPDATE editorial_state SET revision=?,state_json=?,updated_at=? WHERE profile_id=?').run(revision+1,JSON.stringify(state),new Date().toISOString(),profile);return {revision:revision+1,state};};
 function origin(profile,input){profileCheck(profile);const session=getSessions(profile)?.find(item=>item.id===input.sessionId),agent=getAgents(profile)?.find(item=>item.id===session?.agentId),message=session?.messages?.find(item=>item.id===input.messageId);if(!agent||message?.type!=='message'||message.role!=='agent'||message.deliveryState!=='completed'||message.content!==input.expectedContent)throw new Error('Only a completed persisted agent response can become a delivery.');const delivery=decodeChatDelivery(message.content);if(delivery?.kind!=='file-delivery')throw new Error('Invalid file delivery.');return {agent,message,delivery};}
 return {
  async capture(profile,input){
   const {agent,message,delivery}=origin(profile,input),initial=load(profile,input.revision);
   const content=initial.contents.find(item=>item.id===input.contentId&&item.workspaceId===agent.workspaceId);
   if(!content)throw new Error('Choose a content in the same workspace.');
   const prior=initial.artifacts.find(item=>item.source?.sessionId===input.sessionId&&item.source?.messageId===input.messageId);
   if(prior){if(prior.contentId!==content.id)throw new Error('This response already belongs to another content.');return {revision:input.revision,state:initial};}
   const checks=[];for(const file of delivery.data.files){localAssetPath(file.path);const result=await inspect(file.path);if(result.status!=='available'||!result.sha256||!result.kind)throw new Error(result.error??'A stable, readable file is required.');checks.push({...result,caption:file.caption});}
   db.exec('BEGIN IMMEDIATE');try{
    origin(profile,input);const state=load(profile,input.revision),current=state.contents.find(item=>item.id===content.id&&item.workspaceId===agent.workspaceId);
    if(!current)throw new Error('Content was removed.');
    const at=new Date().toISOString(),assets=state.assets??=[],refs=[];
    for(const file of checks){
     let asset=assets.find(item=>item.contentId===current.id&&item.workspaceId===current.workspaceId&&item.versions.some(version=>version.sha256===file.sha256));
     if(!asset){const version={id:id('version'),path:file.path,name:file.name,size:file.size,sha256:file.sha256,modifiedAt:file.modifiedAt,createdAt:at};asset={id:id('asset'),workspaceId:current.workspaceId,contentId:current.id,name:file.name,kind:file.kind,role:'output',currentVersionId:version.id,versions:[version],status:'available',checkedAt:file.checkedAt,createdAt:at,updatedAt:at};assets.push(asset);}
     const version=asset.versions.find(item=>item.sha256===file.sha256);
     if(asset.currentVersionId!==version.id)throw new Error('The returned file is an older asset version. Ask the agent for the current file.');
     refs.push({assetId:asset.id,versionId:version.id,sha256:version.sha256,path:version.path,caption:file.caption});
    }
    state.assets=assets;const artifact={id:id('artifact'),workspaceId:current.workspaceId,contentId:current.id,topicId:current.topicId,type:'file-delivery',version:state.artifacts.filter(item=>item.contentId===current.id&&item.type==='file-delivery').reduce((max,item)=>Math.max(max,item.version),0)+1,data:{summary:delivery.data.summary,files:refs},source:{sessionId:input.sessionId,messageId:input.messageId,messageHash:artifactHash(message.content),agentId:agent.id},createdAt:at};
    state.artifacts.unshift(artifact);current.fileDeliveryArtifactId=artifact.id;current.assetIds=assets.filter(item=>item.contentId===current.id).map(item=>item.id);current.updatedAt=at;if(checks.some(file=>file.kind==='video'))current.productionStage='video-review';
    const receipt=save(profile,input.revision,state);db.exec('COMMIT');return receipt;
   }catch(error){db.exec('ROLLBACK');throw error;}
  },
  async review(profile,{revision,artifactId,expectedArtifact,decision,notes=''}){
   if(!['approved','rejected','revision-requested'].includes(decision)||typeof notes!=='string'||notes.length>5000||decision==='revision-requested'&&!notes.trim())throw new Error('Choose a decision and describe requested changes.');
   const check=state=>{const artifact=state.artifacts.find(item=>item.id===artifactId&&item.type==='file-delivery'),content=state.contents.find(item=>item.id===artifact?.contentId&&item.workspaceId===artifact.workspaceId);if(!content||content.fileDeliveryArtifactId!==artifactId||artifactHash(artifact)!==artifactHash(expectedArtifact))throw new Error('The reviewed file delivery changed.');for(const ref of artifact.data.files){const asset=state.assets?.find(item=>item.id===ref.assetId&&item.contentId===content.id),version=asset?.versions.find(item=>item.id===ref.versionId);if(!version||asset.status!=='available'||asset.currentVersionId!==ref.versionId||version.sha256!==ref.sha256)throw new Error('A file association or version changed. Reopen the current delivery.');}return {artifact,content};};
   const initial=check(load(profile,revision));
   if(decision==='approved')for(const file of initial.artifact.data.files){const result=await inspect(file.path);if(result.status!=='available'||result.sha256!==file.sha256)throw new Error('A delivered file is missing or changed. Verify it before approving.');}
   db.exec('BEGIN IMMEDIATE');try{const state=load(profile,revision),{artifact,content}=check(state),at=new Date().toISOString(),previous=state.approvals.find(item=>item.artifactId===artifactId&&item.action==='file-review');if(previous?.decision===decision&&previous.notes===notes.trim()&&!(decision==='approved'&&content.productionStage==='video-review')){db.exec('COMMIT');return {revision,state};}state.approvals.unshift({id:id('approval'),workspaceId:content.workspaceId,topicId:content.topicId,contentId:content.id,artifactId,artifactVersion:artifact.version,decision,notes:notes.trim(),action:'file-review',decidedAt:at});if(content.productionStage==='video-review'&&decision==='approved')content.productionStage='ready';else if(content.productionStage==='ready'&&decision!=='approved')content.productionStage='video-review';content.updatedAt=at;const receipt=save(profile,revision,state);db.exec('COMMIT');return receipt;}catch(error){db.exec('ROLLBACK');throw error;}
  }
 };
}
