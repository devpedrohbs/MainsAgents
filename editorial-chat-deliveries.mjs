import {randomUUID} from 'node:crypto';
import {decodeChatDelivery} from './chat-delivery-protocol.mjs';
import {artifactHash} from './editorial-jobs.mjs';
import {inspectLocalAsset} from './editorial-local-files.mjs';
import {createFileDeliveries} from './editorial-file-deliveries.mjs';

/** Imports only a completed, persisted agent response. Provenance travels with backups. */
export function createChatDeliveries(db,{getSessions,getAgents,getCurrentProfile,inspect=inspectLocalAsset}={}) {
  const files=createFileDeliveries(db,{getSessions,getAgents,getCurrentProfile,inspect});
  return {
    reviewFiles:files.review,
    review(profile,{revision,artifactId,expectedArtifact,decision,notes=''}) {
      if(getCurrentProfile&&getCurrentProfile()!==profile)throw new Error('The active profile changed. Reopen the workspace.');
      if(!['rejected','revision-requested'].includes(decision)||typeof notes!=='string'||notes.trim().length>5000||decision==='revision-requested'&&!notes.trim())throw new Error('Describe the requested revision before saving.');
      db.exec('BEGIN IMMEDIATE');
      try{
        const row=db.prepare('SELECT revision,state_json FROM editorial_state WHERE profile_id=?').get(profile);
        if(!row||row.revision!==revision)throw new Error('Editorial data changed. Reload before reviewing.');
        const state=JSON.parse(row.state_json),artifact=state.artifacts.find(item=>item.id===artifactId);
        const content=state.contents.find(item=>item.id===artifact?.contentId&&item.workspaceId===artifact?.workspaceId);
        if(!content||artifact?.type!=='script-options'||content.scriptOptionsArtifactId!==artifact.id||artifactHash(artifact)!==artifactHash(expectedArtifact))throw new Error('The reviewed script version changed. Reopen the current delivery.');
        if(state.runs.some(run=>run.contentId===content.id&&run.state==='running'))throw new Error('Wait for the current work to finish before reviewing.');
        const at=new Date().toISOString();
        // Retrying a lost receipt must not add the same decision twice.
        const latest=state.approvals.find(item=>item.artifactId===artifact.id&&item.action==='script-review');
        if(!content.approvedScriptArtifactId&&latest?.decision===decision&&latest.notes===notes.trim()&&content.status===(decision==='rejected'?'script-rejected':'script-review')){db.exec('COMMIT');return {revision:row.revision,state};}
        state.approvals.unshift({id:`approval-${randomUUID()}`,workspaceId:content.workspaceId,topicId:content.topicId,contentId:content.id,artifactId:artifact.id,artifactVersion:artifact.version,decision,notes:notes.trim(),action:'script-review',decidedAt:at});
        delete content.approvedScriptArtifactId;
        content.status=decision==='rejected'?'script-rejected':'script-review';
        if(content.productionStage==='ready-to-record')content.productionStage='planning';
        content.updatedAt=at;
        db.prepare('UPDATE editorial_state SET revision=?,state_json=?,updated_at=? WHERE profile_id=?').run(revision+1,JSON.stringify(state),at,profile);
        db.exec('COMMIT');return {revision:revision+1,state};
      }catch(error){db.exec('ROLLBACK');throw error;}
    },
    capture(profile,{revision,sessionId,messageId,expectedContent,contentId}) {
      if(!getSessions||!getAgents)throw new Error('Saving chat deliveries requires the desktop app. Your message remains in the chat.');
      if(getCurrentProfile&&getCurrentProfile()!==profile)throw new Error('The active profile changed. Reopen the workspace.');
      const session=getSessions(profile)?.find(item=>item.id===sessionId);
      const agent=getAgents(profile)?.find(item=>item.id===session?.agentId);
      const message=session?.messages?.find(item=>item.id===messageId);
      if(!agent||!session||message?.type!=='message'||message.role!=='agent'||message.deliveryState!=='completed'||typeof expectedContent!=='string'||message.content!==expectedContent)throw new Error('Only a completed, saved agent response can become a delivery. Wait for the response and local save to finish.');
      const delivery=decodeChatDelivery(message.content);
      if(delivery?.kind==='file-delivery')return files.capture(profile,{revision,sessionId,messageId,expectedContent,contentId});
      if(!delivery)throw new Error('This response is not a valid research or script delivery.');
      const hash=artifactHash(message.content),at=new Date().toISOString(),id=prefix=>`${prefix}-${randomUUID()}`;
      db.exec('BEGIN IMMEDIATE');
      try {
        const row=db.prepare('SELECT revision,state_json FROM editorial_state WHERE profile_id=?').get(profile);
        if((row?.revision??0)!==revision)throw new Error('Editorial data changed. Reload before saving this delivery.');
        const state=row?JSON.parse(row.state_json):{schemaVersion:1,topics:[],contents:[],runs:[],artifacts:[],approvals:[]};
        const previous=state.artifacts.filter(item=>item.source?.sessionId===sessionId&&item.source?.messageId===messageId&&item.source?.messageHash===hash);
        // Same response always refers to the same saved delivery, even after a lost reply.
        if(previous.length){if(delivery.kind==='script-options'&&previous[0].contentId!==contentId)throw new Error('This response already belongs to another content card.');db.exec('COMMIT');return {revision:row.revision,state};}
        const source={sessionId,messageId,messageHash:hash,agentId:agent.id};
        if(delivery.kind==='research') {
          for(const proposal of delivery.data) {
            const topicId=id('topic'),artifactId=id('artifact');
            state.topics.unshift({...proposal,id:topicId,workspaceId:agent.workspaceId,requestId:topicId,inputKind:'text',input:session.title,priority:'normal',status:'review',researchArtifactId:artifactId,createdAt:at,updatedAt:at});
            state.artifacts.unshift({id:artifactId,workspaceId:agent.workspaceId,topicId,type:'research',version:1,data:proposal,source,createdAt:at});
          }
        } else {
          const content=state.contents.find(item=>item.id===contentId&&item.workspaceId===agent.workspaceId);
          const topic=content&&state.topics.find(item=>item.id===content.topicId);
          if(!content||topic?.status!=='approved')throw new Error('Choose an approved topic in this workspace before saving script options.');
          if(state.runs.some(run=>run.contentId===contentId&&run.state==='running'))throw new Error('Wait for the ongoing content work to finish before replacing the script options.');
          const artifactId=id('artifact');
          state.artifacts.unshift({id:artifactId,workspaceId:agent.workspaceId,topicId:content.topicId,contentId,type:'script-options',version:state.artifacts.filter(item=>item.contentId===contentId&&item.type==='script-options').reduce((max,item)=>Math.max(max,item.version),0)+1,data:delivery.data,source,createdAt:at});
          Object.assign(content,{scriptOptionsArtifactId:artifactId,status:'script-review',updatedAt:at});
          if(content.productionStage==='ready-to-record')content.productionStage='planning';
          // A new proposal is never an implicit approval, nor an authorization for an older queued write.
          delete content.approvedScriptArtifactId;
        }
        db.prepare('INSERT INTO editorial_state VALUES (?,?,?,?) ON CONFLICT(profile_id) DO UPDATE SET revision=excluded.revision,state_json=excluded.state_json,updated_at=excluded.updated_at').run(profile,revision+1,JSON.stringify(state),at);
        db.exec('COMMIT');return {revision:revision+1,state};
      } catch(error){db.exec('ROLLBACK');throw error;}
    },
  };
}
