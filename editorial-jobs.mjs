import { createHash, randomUUID } from 'node:crypto';
import {carouselScript} from './editorial-protocol.mjs';

const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export const artifactHash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const stamp = () => new Date().toISOString();
const scriptFields = ['hook','cta','text','thumbnailDirection'];

/** A local outbox: approval, immutable input and job commit together. */
export function createEditorialJobs(db, {getConnector = () => null,authorizeDraft=()=>false} = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS editorial_jobs (
    id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,content_id TEXT NOT NULL,artifact_id TEXT NOT NULL,
    artifact_hash TEXT NOT NULL,destination TEXT NOT NULL,status TEXT NOT NULL,payload_json TEXT NOT NULL,checkpoint_json TEXT NOT NULL,
    result_json TEXT,error TEXT,attempts INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
    UNIQUE(profile_id,artifact_id,artifact_hash,destination));
    CREATE TABLE IF NOT EXISTS editorial_job_events(id INTEGER PRIMARY KEY AUTOINCREMENT,job_id TEXT NOT NULL,event TEXT NOT NULL,at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS editorial_connections(profile_id TEXT NOT NULL,workspace_id TEXT NOT NULL,config_json TEXT NOT NULL,PRIMARY KEY(profile_id,workspace_id));`);
  db.prepare("UPDATE editorial_jobs SET status='queued' WHERE status='running'").run();
  let active, closed=false;
  const event=(id,type)=>db.prepare('INSERT INTO editorial_job_events(job_id,event,at) VALUES (?,?,?)').run(id,type,stamp());
  const readState=profile=>{const row=db.prepare('SELECT revision,state_json FROM editorial_state WHERE profile_id=?').get(profile);return row?{revision:row.revision,state:JSON.parse(row.state_json)}:null;};
  const update=(id,values)=>{
    const old=db.prepare('SELECT * FROM editorial_jobs WHERE id=?').get(id);
    const next={...old,...values,updated_at:stamp()};
    db.prepare('UPDATE editorial_jobs SET status=?,checkpoint_json=?,result_json=?,error=?,attempts=?,updated_at=? WHERE id=?').run(next.status,next.checkpoint_json,next.result_json,next.error,next.attempts,next.updated_at,id);
  };
  const connection=(profile,workspaceId)=>{const row=db.prepare('SELECT config_json FROM editorial_connections WHERE profile_id=? AND workspace_id=?').get(profile,workspaceId);return row?JSON.parse(row.config_json):{dataSourceId:'',autoSync:false};};
  const authorize=row=>{
    if(closed)throw new Error('Local executor is stopping. Resume verification after reopening the app.');
    const current=readState(row.profile_id)?.state;
    const artifact=current?.artifacts.find(item=>item.id===row.artifact_id);
    const content=current?.contents.find(item=>item.id===row.content_id);
    const config=content&&connection(row.profile_id,content.workspaceId);
    if(!config?.autoSync||config.dataSourceId!==row.destination)throw new Error('The Notion destination was changed or paused. Review it before retrying.');
    if(artifact?.type==='script-draft'){if(artifactHash(artifact.data)!==row.artifact_hash||!authorizeDraft(row))throw Error('A autorização da produção para o card não é mais válida.');return;}
    if(!artifact||artifactHash(artifact.data)!==row.artifact_hash||content?.approvedScriptArtifactId!==artifact.id||!current.approvals.some(item=>item.artifactId===artifact.id&&item.artifactVersion===artifact.version&&item.decision==='approved'&&item.action==='notion-upsert'&&item.destination===row.destination))throw new Error('The approved version changed. Approve the current version before sending it to Notion.');
  };
  async function drain() {
    while(!closed){
      const row=db.prepare("SELECT * FROM editorial_jobs WHERE status='queued' ORDER BY created_at LIMIT 1").get();
      if(!row)return;
      update(row.id,{status:'running',attempts:row.attempts+1,error:null});event(row.id,'started');
      try{
        authorize(row);
        const connector=getConnector();
        if(!connector)throw new Error('Codex CLI is unavailable. Reconnect it and retry this job.');
        const payload=JSON.parse(row.payload_json);
        const previous=db.prepare("SELECT result_json FROM editorial_jobs WHERE profile_id=? AND content_id=? AND destination=? AND status='succeeded' ORDER BY updated_at DESC LIMIT 1").get(row.profile_id,row.content_id,row.destination);
        const checkpoint=JSON.parse(row.checkpoint_json);
        const result=await connector.upsert(payload,{checkpoint,previous:previous?JSON.parse(previous.result_json):undefined,authorize:()=>authorize(row),saveCheckpoint:next=>{if(closed)throw new Error('Local executor is stopping.');update(row.id,{checkpoint_json:JSON.stringify(next)});event(row.id,`checkpoint:${next.phase}`);}});
        if(closed)return;
        update(row.id,{status:'succeeded',result_json:JSON.stringify(result),error:null});event(row.id,'verified');
      }catch(error){if(!closed){update(row.id,{status:'failed',error:error instanceof Error?error.message:String(error)});event(row.id,'failed');}}
    }
  }
  const kick=()=>{if(closed||active)return;active=drain().finally(()=>{active=undefined;if(!closed&&db.prepare("SELECT id FROM editorial_jobs WHERE status='queued' LIMIT 1").get())queueMicrotask(kick);});};
  return {
    connection,
    queueDraft(profile,{contentId,artifactId,dataSourceId,productionId,notionStatus}){const current=readState(profile),content=current?.state.contents.find(item=>item.id===contentId),artifact=current?.state.artifacts.find(item=>item.id===artifactId&&item.contentId===contentId&&item.type==='script-draft');if(!content||!artifact||connection(profile,content.workspaceId).dataSourceId!==dataSourceId||notionStatus!==undefined&&notionStatus!=='Idea')throw Error('Confira o conteúdo e o destino Notion.');const id=`job-${randomUUID()}`,at=stamp(),payload={productionId,content:structuredClone(content),topic:current.state.topics.find(item=>item.id===content.topicId),artifact:structuredClone(artifact),dataSourceId,...(notionStatus?{notionStatus}:{})};db.prepare('INSERT OR IGNORE INTO editorial_jobs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,profile,content.id,artifact.id,artifactHash(artifact.data),dataSourceId,'queued',JSON.stringify(payload),'{}',null,null,0,at,at);const row=db.prepare('SELECT id FROM editorial_jobs WHERE profile_id=? AND artifact_id=? AND artifact_hash=? AND destination=?').get(profile,artifact.id,artifactHash(artifact.data),dataSourceId);kick();return row.id;},
    configure(profile,workspaceId,config){
      if(typeof workspaceId!=='string'||!workspaceId||typeof config?.autoSync!=='boolean'||typeof config.dataSourceId!=='string'||!/^$|^[a-f0-9]{32}$|^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(config.dataSourceId))throw new Error('Provide a valid Notion data source ID.');
      const id=config.dataSourceId.replaceAll('-','').toLowerCase();
      const normalized={dataSourceId:id?id.replace(/^(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})$/,'$1-$2-$3-$4-$5'):'',autoSync:config.autoSync};
      db.prepare('INSERT OR REPLACE INTO editorial_connections VALUES (?,?,?)').run(profile,workspaceId,JSON.stringify(normalized));
      return normalized;
    },
    approve(profile,{revision,contentId,scriptOptionsArtifactId,script,notes='',syncNotion=false,expectedArtifact,expectedDestination}){
      if(typeof syncNotion!=='boolean'||!script||typeof notes!=='string')throw new Error('Complete the hook, CTA, path and script before approving.');
      let receipt;
      db.exec('BEGIN IMMEDIATE');
      try{
        const current=readState(profile);
        if(!current||current.revision!==revision)throw new Error('Editorial data changed. Reload before approving.');
        const state=current.state;
        const content=state.contents.find(item=>item.id===contentId);
        if(!content||!scriptOptionsArtifactId||content.scriptOptionsArtifactId!==scriptOptionsArtifactId)throw new Error('The script options changed. Review the current version.');
        const options=state.artifacts.find(item=>item.id===scriptOptionsArtifactId);
        if(script.carousel||options?.data?.carousel){
          if(content.format!=='carousel'||!script.carousel)throw new Error('Review the structured carousel slides before approving.');
          script=carouselScript(script.carousel,state.topics.find(item=>item.id===content.topicId)?.sources);
        }else if(!scriptFields.every(field=>typeof script[field]==='string'&&script[field].length<=100_000)||!script.hook.trim()||!script.cta.trim()||script.text.trim().length<80||typeof script.path?.title!=='string'||!script.path.title.trim()||typeof script.path?.outline!=='string'||!Array.isArray(script.improvisationTopics)||!script.improvisationTopics.every(item=>typeof item==='string'))throw new Error('Complete the hook, CTA, path and script before approving.');
        if(expectedArtifact&&(!options||expectedArtifact.id!==options.id||expectedArtifact.version!==options.version||artifactHash(expectedArtifact.data)!==artifactHash(options.data)))throw new Error('The reviewed script version changed. Reopen the review before approving.');
        const config=connection(profile,content.workspaceId);
        if(syncNotion&&expectedDestination!==undefined&&expectedDestination!==config.dataSourceId)throw new Error('The reviewed Notion destination changed. Reopen the review before sending.');
        if(syncNotion&&(!config.autoSync||!config.dataSourceId))throw new Error('Select and enable a Notion destination before approving and syncing.');
        const prior=state.artifacts.find(item=>item.id===content.approvedScriptArtifactId);
        const identical=prior&&artifactHash(prior.data)===artifactHash(script);
        const artifact=identical?prior:{id:`artifact-${randomUUID()}`,workspaceId:content.workspaceId,topicId:content.topicId,contentId,type:'script',version:state.artifacts.filter(item=>item.contentId===contentId&&item.type==='script').length+1,data:script,source:options?.source,createdAt:stamp()};
        if(!identical)state.artifacts.unshift(artifact);
        const authorization=state.approvals.find(item=>item.artifactId===artifact.id&&item.action===(syncNotion?'notion-upsert':'script-approve')&&item.destination===config.dataSourceId);
        if(!authorization)state.approvals.unshift({id:`approval-${randomUUID()}`,workspaceId:content.workspaceId,topicId:content.topicId,contentId,artifactId:artifact.id,artifactVersion:artifact.version,decision:'approved',notes,decidedAt:stamp(),action:syncNotion?'notion-upsert':'script-approve',destination:config.dataSourceId});
        Object.assign(content,{status:'script-approved',approvedScriptArtifactId:artifact.id,productionStage:!content.productionStage||content.productionStage==='planning'?content.format==='carousel'?'planning':'ready-to-record':content.productionStage,updatedAt:stamp()});
        if(syncNotion){
          const id=`job-${randomUUID()}`,at=stamp();
          const payload={content:structuredClone(content),topic:state.topics.find(item=>item.id===content.topicId),artifact:structuredClone(artifact),dataSourceId:config.dataSourceId};
          const inserted=db.prepare('INSERT OR IGNORE INTO editorial_jobs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,profile,content.id,artifact.id,artifactHash(artifact.data),config.dataSourceId,'queued',JSON.stringify(payload),'{}',null,null,0,at,at);
          if(inserted.changes)event(id,'approval-recorded');
        }
        db.prepare('UPDATE editorial_state SET revision=?,state_json=?,updated_at=? WHERE profile_id=?').run(revision+1,JSON.stringify(state),stamp(),profile);
        db.exec('COMMIT');receipt={revision:revision+1,state};
      }catch(error){db.exec('ROLLBACK');throw error;}
      kick();return receipt;
    },
    list(profile){return db.prepare('SELECT * FROM editorial_jobs WHERE profile_id=? ORDER BY created_at DESC').all(profile).map(row=>({id:row.id,contentId:row.content_id,artifactId:row.artifact_id,status:row.status,attempts:row.attempts,error:row.error,createdAt:row.created_at,updatedAt:row.updated_at,result:row.result_json?JSON.parse(row.result_json):undefined}));},
    retry(profile,id){const row=db.prepare('SELECT * FROM editorial_jobs WHERE profile_id=? AND id=?').get(profile,id);if(!row||row.status!=='failed')throw new Error('This job is not available to retry.');authorize(row);update(id,{status:'queued',error:null});event(id,'retry-requested');kick();},
    cancel(profile,id){const row=db.prepare('SELECT * FROM editorial_jobs WHERE profile_id=? AND id=?').get(profile,id);if(!row||row.status!=='queued')throw new Error('Only queued work can be canceled.');update(id,{status:'canceled'});event(id,'canceled');},
    kick,
    async close(){closed=true;await active;},
  };
}
