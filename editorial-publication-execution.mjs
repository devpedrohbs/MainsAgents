import {randomUUID} from 'node:crypto';
import {artifactHash} from './editorial-jobs.mjs';
import {publicationPayload,validatePublications,validTimeZone} from './publication-model.mjs';
import {verifiedPublication} from './publication-connector.mjs';
import {publicationFiles,validatePublicationFiles,checkPublicationFiles} from './publication-media-upload.mjs';

/** Persist the write intent before any network operation; never auto-repeat a create. */
export function createPublicationExecution(db,{getConnector,getCurrentProfile,clock=()=>Date.now()}={}){
  db.exec('CREATE TABLE IF NOT EXISTS publication_intents (profile TEXT NOT NULL,id TEXT NOT NULL,hash TEXT NOT NULL,used INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(profile,id))');
  if(!db.prepare('PRAGMA table_info(publication_intents)').all().some(c=>c.name==='continuation_hash'))db.exec('ALTER TABLE publication_intents ADD COLUMN continuation_hash TEXT');
  db.exec('CREATE TABLE IF NOT EXISTS publication_changes (profile TEXT NOT NULL,id TEXT NOT NULL,delivery_id TEXT NOT NULL,expected_hash TEXT NOT NULL,payload_json TEXT NOT NULL,used INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(profile,id))');
  // A prior process cannot still be issuing calls after this service restarts.
  // Preserve every identifier; recovery is read-only and never repeats the write.
  for(const row of db.prepare('SELECT profile_id,revision,state_json FROM editorial_state').all()){
    const state=JSON.parse(row.state_json);let changed=false;
    for(const item of state.publications??[])if(item.operation?.phase==='requesting'){item.operation.phase='uncertain';item.operation.error='The app stopped during a provider operation. Check its result before any new write.';changed=true;}
    if(changed)db.prepare('UPDATE editorial_state SET revision=?,state_json=?,updated_at=? WHERE profile_id=? AND revision=?').run(row.revision+1,JSON.stringify(state),new Date(clock()).toISOString(),row.profile_id,row.revision);
  }
  const locks=new Set(),pending=new Set();let closing=false;
  const read=profile=>{const row=db.prepare('SELECT revision,state_json FROM editorial_state WHERE profile_id=?').get(profile);if(!row)throw Error('Open an existing content workspace.');return {revision:row.revision,state:JSON.parse(row.state_json)};};
  const active=profile=>{if(getCurrentProfile&&getCurrentProfile()!==profile)throw Error('The active profile changed. Reopen the workspace.');};
  const mutate=(profile,id,fn)=>{db.exec('BEGIN IMMEDIATE');try{const value=read(profile),delivery=value.state.publications?.find(item=>item.id===id);if(!delivery)throw Error('Delivery not found.');fn(delivery,value);if(!validatePublications(value.state))throw Error('Invalid publication data.');const at=new Date(clock()).toISOString();delivery.updatedAt=at;db.prepare('UPDATE editorial_state SET revision=?,state_json=?,updated_at=? WHERE profile_id=?').run(++value.revision,JSON.stringify(value.state),at,profile);db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}};
  const connector=(provider='publora',profile)=>{const result=getConnector?.(provider,profile);if(!result)throw Error(provider==='zernio'?'Configure the Zernio API key in calendar settings.':'Reconnect Codex CLI and configure the Publora MCP.');return result;};
  const verify=(provider,data,op)=>(provider.verify??verifiedPublication)(data,op);
  const exclusive=async(profile,id,fn)=>{active(profile);if(closing)throw Error('The publishing service is closing.');const key=`${profile}:${id}`;if(locks.has(key))throw Error('A provider operation is already running.');locks.add(key);const task=(async()=>fn())().finally(()=>{locks.delete(key);pending.delete(task)});pending.add(task);return task;};
  const continuationHash=op=>artifactHash({id:op.id,provider:op.provider,mode:op.mode,accountId:op.accountId,payloadHash:op.payloadHash,arguments:op.arguments,files:op.files,platform:op.platform,timeZone:op.timeZone,networkSettings:op.networkSettings});
  const current=(profile,id)=>read(profile).state.publications?.find(item=>item.id===id);
  const matching=(delivery,input)=>{if(artifactHash(delivery)!==artifactHash(input.expectedDelivery))throw Error('The delivery changed. Reopen it before authorizing.');};
  const submit=async(profile,id,provider,op,files)=>{
    const guard=async()=>{active(profile);const live=current(profile,id);if(live.operation?.id!==op.id||live.operation.payloadHash!==artifactHash(publicationPayload(live)))throw Error('The publication changed.');const fresh=publicationFiles(read(profile).state,live);if(artifactHash(fresh.map(({path,...f})=>f))!==artifactHash(op.files??[]))throw Error('The approved file metadata changed.');active(profile);};
    const checkpoint=async next=>{mutate(profile,id,live=>{if(live.operation?.id!==op.id)throw Error('The provider operation changed.');live.operation=structuredClone(next);});};
    try{
      await guard();await checkPublicationFiles(files);await provider.preflight?.(op);await guard();
      if(op.provider==='publora'&&files.length&&!op.externalId){op.stage='creating';await checkpoint(op);const args={...op.arguments};delete args.scheduledTime;op.externalId=await provider.create({...op,arguments:args});op.stage='uploading';await checkpoint(op);}
      if(files.length&&op.stage==='uploading'){if(!provider.media)throw Error('This provider does not support native uploads.');await provider.media(op,files,checkpoint,guard);await guard();}
      await checkPublicationFiles(files);await guard();
      if(op.mode==='schedule'&&Date.parse(op.arguments.scheduledTime)<clock()+120000)throw Error('The planned time passed during upload. No scheduling was requested.');
      if(op.provider==='publora'&&files.length){op.stage='finalizing';if(op.mode==='schedule')op.finalizeRequestId??=randomUUID();await checkpoint(op);if(op.mode==='schedule')await provider.update({...op,arguments:{...op.arguments,idempotencyKey:op.finalizeRequestId}});}
      else {op.stage='creating';await checkpoint(op);op.externalId=await provider.create(op);await checkpoint(op);}
      active(profile);const result=verify(provider,await provider.read(op.externalId),op);active(profile);
      if(result.status!==(op.mode==='draft'?'draft':'scheduled'))throw Error('The requested destination was not confirmed.');
      return mutate(profile,id,live=>{live.operation.phase='confirmed';live.operation.stage='done';delete live.operation.error;live.status=result.status==='draft'?'approved':result.status;live.receipt={id:op.externalId,provider:op.provider,version:live.version,checkedAt:new Date(clock()).toISOString(),...result};});
    }catch{mutate(profile,id,live=>{if(live.operation?.id===op.id){live.operation.phase='uncertain';live.operation.error='The result is unconfirmed. Check provider before any new write.';live.status='sending';}});throw Error('The result is unconfirmed. Check provider; do not recreate this post.');}
  };
  return {
    async close(){closing=true;await Promise.allSettled([...pending]);},
    async accounts(profile,input={}){active(profile);const selected=input.provider??'publora';if(!['publora','zernio'].includes(selected))throw Error('Unsupported publishing provider.');const accounts=await connector(selected,profile).accounts();active(profile);return {accounts:input.platform?accounts.filter(a=>(a.platform??'linkedin')===input.platform.toLowerCase()):accounts};},
    async options(profile,input){active(profile);const info=await connector('zernio',profile).options(input.accountId,input.mediaType);active(profile);return info;},
    prepare(profile,input){active(profile);return mutate(profile,input.id,(delivery,value)=>{
      if(value.revision!==input.revision)throw Error('Editorial data changed. Reload before authorizing.');matching(delivery,input);
      if(delivery.status!=='approved'||delivery.operation&&!['preview'].includes(delivery.operation.phase))throw Error('Approve a new delivery, or reconcile its existing provider operation.');
      const selected=input.provider??(delivery.platform==='LinkedIn'?'publora':'zernio');
      if(!['publora','zernio'].includes(selected)||selected==='publora'&&delivery.platform!=='LinkedIn'||!['LinkedIn','Instagram','TikTok'].includes(delivery.platform))throw Error('Choose Publora for LinkedIn or Zernio for Instagram, TikTok and LinkedIn.');
      const files=publicationFiles(value.state,delivery);validatePublicationFiles(files,delivery.platform,delivery.networkSettings);
      if(delivery.cover&&selected==='publora')throw Error('Este conector Publora não envia capa de vídeo LinkedIn. Escolha Zernio ou revise uma entrega sem capa.');
      if(!delivery.text.trim()&&!files.length)throw Error('Add text or media.');
      if(delivery.platform==='TikTok'&&(!delivery.networkSettings?.tiktokSettings?.privacy_level||!delivery.networkSettings.tiktokSettings.content_preview_confirmed||!delivery.networkSettings.tiktokSettings.express_consent_given))throw Error('Save and approve TikTok privacy and both consent fields before preparing.');
      if(typeof input.accountId!=='string'||!(selected==='publora'?/^linkedin-[A-Za-z0-9_-]{1,200}$/:/^[A-Za-z0-9_-]{1,200}$/).test(input.accountId)||!['draft','schedule'].includes(input.mode))throw Error('Choose a LinkedIn account and an explicit destination mode.');
      if(input.mode==='schedule'&&(!delivery.plannedAt||Date.parse(delivery.plannedAt)<clock()+120000))throw Error('Choose a planned time at least two minutes in the future.');
      delivery.operation={id:randomUUID(),provider:selected,...(selected==='zernio'?{platform:delivery.platform.toLowerCase(),timeZone:delivery.timeZone,...(delivery.networkSettings?{networkSettings:structuredClone(delivery.networkSettings)}:{})}:{}),files:files.map(({path,...f})=>f),phase:'preview',mode:input.mode,accountId:input.accountId,payloadHash:artifactHash(publicationPayload(delivery)),expiresAt:new Date(clock()+600000).toISOString(),arguments:{content:delivery.text,platforms:[input.accountId],...(input.mode==='schedule'?{scheduledTime:delivery.plannedAt}:{}),idempotencyKey:randomUUID()},createdAt:new Date(clock()).toISOString()};
      db.prepare('INSERT INTO publication_intents (profile,id,hash) VALUES (?,?,?)').run(profile,delivery.operation.id,artifactHash(delivery.operation));
    });},
    async execute(profile,input){return exclusive(profile,input.id,async()=>{
      let delivery=current(profile,input.id);matching(delivery,input);const op=delivery.operation;
      const intent=op&&db.prepare('SELECT hash,used FROM publication_intents WHERE profile=? AND id=?').get(profile,op.id);
      if(input.authorize!==true||!op||op.phase!=='preview'||!intent||intent.used||intent.hash!==artifactHash(op)||Date.parse(op.expiresAt)<=clock()||op.payloadHash!==artifactHash(publicationPayload(delivery)))throw Error('The authorization expired, was restored or the delivery changed. Prepare it again.');
      const provider=connector(op.provider,profile),accounts=await provider.accounts();active(profile);
      if(!accounts.some(account=>account.id===op.accountId&&(account.platform??'linkedin')===delivery.platform.toLowerCase()))throw Error('The chosen LinkedIn account is unavailable. Reconnect it before sending.');
      mutate(profile,input.id,live=>{matching(live,input);if(op.mode==='schedule'&&Date.parse(live.plannedAt)<clock()+120000)throw Error('The scheduled time is too close or has passed. Prepare a future time.');if(db.prepare('UPDATE publication_intents SET used=1,continuation_hash=? WHERE profile=? AND id=? AND used=0').run(continuationHash(op),profile,op.id).changes!==1)throw Error('This authorization was already used.');live.status='sending';live.operation.phase='requesting';live.operation.stage=op.provider==='zernio'&&live.media.length?'uploading':'creating';delete live.receipt;});
      return submit(profile,input.id,provider,structuredClone(current(profile,input.id).operation),publicationFiles(read(profile).state,delivery));
    });},
    async continue(profile,input){return exclusive(profile,input.id,async()=>{
      const delivery=current(profile,input.id);matching(delivery,input);const op=delivery.operation;
      if(input.authorize!==true||op?.phase!=='uncertain'||op.stage!=='uploading'||op.provider==='publora'&&!op.externalId||op.provider==='zernio'&&op.externalId)throw Error('Only an interrupted upload may be resumed. Check an uncertain post creation without repeating it.');
      const intent=db.prepare('SELECT used,continuation_hash FROM publication_intents WHERE profile=? AND id=?').get(profile,op.id);
      if(intent?.used!==1||intent.continuation_hash!==continuationHash(op))throw Error('This upload authorization was restored or changed. Inspect the provider before any write.');
      const provider=connector(op.provider,profile),accounts=await provider.accounts();active(profile);
      if(!accounts.some(a=>a.id===op.accountId&&(a.platform??'linkedin')===delivery.platform.toLowerCase()))throw Error('The selected account is unavailable.');
      const files=publicationFiles(read(profile).state,delivery);validatePublicationFiles(files,delivery.platform,delivery.networkSettings);await checkPublicationFiles(files);active(profile);
      mutate(profile,input.id,live=>{matching(live,input);
        if(input.mode==='draft'&&live.operation.mode==='schedule'){
          if(live.history.length>=200)throw Error('Version history is full.');
          live.version++;live.history.push({version:live.version,status:'approved',decision:'approved',notes:'Authorized upload recovery as an external draft',payloadHash:artifactHash(publicationPayload(live)),payload:publicationPayload(live),at:new Date(clock()).toISOString()});
          live.operation.mode='draft';delete live.operation.arguments.scheduledTime;
          db.prepare('UPDATE publication_intents SET continuation_hash=? WHERE profile=? AND id=?').run(continuationHash(live.operation),profile,live.operation.id);
        }
        live.operation.phase='requesting';delete live.operation.error;});
      return submit(profile,input.id,provider,structuredClone(current(profile,input.id).operation),files);
    });},
    /**
     * B10 read-only status check of a confirmed scheduled delivery. Never creates/updates/cancels externally and never
     * marks anything uncertain: a network/verification failure keeps the known `scheduled` state. Only a trusted, verified
     * receipt of `published`/`failed` is written, and only if the delivery is byte-identical to the snapshot read before the call.
     */
    async observe(profile,id){
      if(closing)return {id,state:'stopped'};if(locks.has(`${profile}:${id}`))return {id,state:'busy'};
      return exclusive(profile,id,async()=>{
        const before=current(profile,id),op=before?.operation;
        if(!before||before.status!=='scheduled'||op?.phase!=='confirmed'||typeof op.externalId!=='string')return {id,state:'skipped'};
        const snapshot=artifactHash(before);let result;
        try{const provider=connector(op.provider,profile);result=verify(provider,await provider.read(op.externalId),op);}
        catch(error){active(profile);return {id,state:'unknown',status:'scheduled',error:String(error?.message??error).slice(0,300)};}
        active(profile);
        if(result.status==='scheduled')return {id,state:'unchanged',status:'scheduled'};
        if(!['published','failed'].includes(result.status))return {id,state:'attention',status:'scheduled',external:result.status};
        try{mutate(profile,id,live=>{if(artifactHash(live)!==snapshot)throw Error('changed');live.status=result.status;live.receipt={id:op.externalId,provider:op.provider,version:live.version,checkedAt:new Date(clock()).toISOString(),...result};});}
        catch{return {id,state:'skipped',reason:'changed'};}
        return {id,state:'updated',status:result.status};
      });
    },
    async reconcile(profile,input){return exclusive(profile,input.id,async()=>{
      const delivery=current(profile,input.id);matching(delivery,input);const op=delivery.operation;
      if(!op||op.phase==='preview')throw Error('No submitted provider operation to check.');
      const id=op.externalId??input.externalId;
      if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,500}$/.test(id))throw Error('The create result has no identifier. Find the post in Publora and paste its group ID to verify it. No new post will be created.');
      try{const provider=connector(op.provider,profile),result=verify(provider,await provider.read(id),{...op,externalId:id});active(profile);
        return mutate(profile,input.id,live=>{matching(live,input);live.operation.externalId=id;live.operation.phase='confirmed';delete live.operation.error;live.status=result.status==='draft'?'approved':result.status;live.receipt={id,provider:op.provider,version:live.version,checkedAt:new Date(clock()).toISOString(),...result};});
      }catch(error){active(profile);mutate(profile,input.id,live=>{matching(live,input);live.status='sending';live.operation.phase='uncertain';live.operation.error='External state is unconfirmed or changed. Inspect Publora before any new write.';});throw error;}
    });},
    prepareChange(profile,input){active(profile);
      const value=read(profile),delivery=current(profile,input.id);matching(delivery,input);
      if(value.revision!==input.revision)throw Error('Editorial data changed. Reload before authorizing.');
      const op=delivery.operation;
      if(op?.phase!=='confirmed'||!op.externalId||!['draft','scheduled'].includes(delivery.receipt?.status))throw Error('Check a confirmed draft or scheduled delivery before editing.');
      const draft=input.draft;
      if(!draft||typeof draft.text!=='string'||!draft.text.trim()||draft.text.length>100000||!validTimeZone(draft.timeZone)||!['draft','schedule'].includes(input.mode)||input.mode==='schedule'&&(!Number.isFinite(Date.parse(draft.plannedAt))||Date.parse(draft.plannedAt)<clock()+120000))throw Error('Review text, destination and a future time before authorizing.');
      if(delivery.history.length>=200)throw Error('This delivery reached its version history limit.');
      const preview={id:randomUUID(),externalId:op.externalId,accountId:op.accountId,mode:input.mode,text:draft.text,timeZone:draft.timeZone,...(input.mode==='schedule'?{plannedAt:new Date(draft.plannedAt).toISOString()}:{}),expiresAt:new Date(clock()+600000).toISOString()};
      db.prepare('INSERT INTO publication_changes(profile,id,delivery_id,expected_hash,payload_json) VALUES (?,?,?,?,?)').run(profile,preview.id,delivery.id,artifactHash(delivery),JSON.stringify(preview));
      return {preview};
    },
    async change(profile,input){return exclusive(profile,input.id,async()=>{
      const delivery=current(profile,input.id);matching(delivery,input);
      const row=db.prepare('SELECT * FROM publication_changes WHERE profile=? AND id=? AND delivery_id=?').get(profile,input.changeId??'',input.id);
      if(input.authorize!==true||!row||row.used||row.expected_hash!==artifactHash(delivery))throw Error('This edit authorization changed or was already used. Prepare it again.');
      const preview=JSON.parse(row.payload_json),old=delivery.operation;
      if(Date.parse(preview.expiresAt)<=clock()||old?.phase!=='confirmed'||old.externalId!==preview.externalId)throw Error('The edit preview expired. Prepare it again.');
      const provider=connector(old.provider,profile),accounts=await provider.accounts();active(profile);
      if(!accounts.some(item=>item.id===preview.accountId))throw Error('The selected account is unavailable.');
      const external=verify(provider,await provider.read(preview.externalId),old);active(profile);
      if(!['draft','scheduled'].includes(external.status)||external.status!==delivery.receipt?.status)throw Error('The external post changed or is no longer editable. Check provider before editing.');
      const key=randomUUID(),at=new Date(clock()).toISOString();
      const updated=mutate(profile,input.id,(live,value)=>{
        matching(live,input);
        if(preview.mode==='schedule'&&Date.parse(preview.plannedAt)<clock()+120000)throw Error('The scheduled time is too close or has passed.');
        if(db.prepare('UPDATE publication_changes SET used=1 WHERE profile=? AND id=? AND used=0').run(profile,preview.id).changes!==1)throw Error('The edit authorization was already used.');
        live.text=preview.text;live.timeZone=preview.timeZone;live.plannedAt=preview.plannedAt;live.version++;live.status='sending';delete live.receipt;
        live.history.push({version:live.version,status:'approved',decision:'approved',notes:'Authorized provider edit',payloadHash:artifactHash(publicationPayload(live)),payload:publicationPayload(live),at});
        live.operation={...old,id:preview.id,stage:'editing',...(old.provider==='zernio'?{timeZone:live.timeZone}:{}),phase:'requesting',mode:preview.mode,accountId:preview.accountId,externalId:preview.externalId,createdAt:at,expiresAt:preview.expiresAt,payloadHash:artifactHash(publicationPayload(live)),arguments:{content:live.text,platforms:[preview.accountId],...(preview.mode==='schedule'?{scheduledTime:preview.plannedAt}:{}),idempotencyKey:key}};delete live.operation.cancelRequestId;delete live.operation.finalizeRequestId;delete live.operation.error;
      });
      const op=updated.state.publications.find(item=>item.id===input.id).operation;
      try{
        await provider.update(op);active(profile);
        const result=verify(provider,await provider.read(op.externalId),op);active(profile);
        if(result.status!==(preview.mode==='draft'?'draft':'scheduled'))throw Error('The requested destination was not confirmed.');
        return mutate(profile,input.id,live=>{if(live.operation?.id!==op.id)throw Error('The operation changed.');live.operation.phase='confirmed';delete live.operation.error;live.status=result.status==='draft'?'approved':result.status;live.receipt={id:op.externalId,provider:op.provider,version:live.version,checkedAt:new Date(clock()).toISOString(),...result};});
      }catch{
        mutate(profile,input.id,live=>{if(live.operation?.id===op.id){live.operation.phase='uncertain';live.operation.error='The edit result is unconfirmed. Check the existing post before any new write.';live.status='sending';}});
        throw Error('The edit result is unconfirmed. Check provider; the post will not be recreated.');
      }
    });},
    async cancel(profile,input){return exclusive(profile,input.id,async()=>{
      const delivery=current(profile,input.id);matching(delivery,input);const op=delivery.operation;
      if(input.authorize!==true||delivery.status!=='scheduled'||op?.phase!=='confirmed'||!op.externalId||op.cancelRequestId)throw Error('Check a confirmed scheduled delivery before authorizing cancellation.');
      const provider=connector(op.provider,profile),external=verify(provider,await provider.read(op.externalId),op);active(profile);
      if(external.status!=='scheduled')throw Error('The external post is no longer scheduled. Check its current state.');
      const key=randomUUID();mutate(profile,input.id,live=>{matching(live,input);live.status='sending';live.operation.phase='requesting';live.operation.cancelRequestId=key;});
      try{await provider.cancel(op.externalId,key);const result=verify(provider,await provider.read(op.externalId),op);active(profile);if(result.status!=='draft')throw Error('Cancellation not confirmed.');
        return mutate(profile,input.id,live=>{if(live.operation?.id!==op.id)throw Error('The operation changed.');live.operation.phase='confirmed';live.status='approved';live.receipt={id:op.externalId,provider:op.provider,version:live.version,checkedAt:new Date(clock()).toISOString(),...result};});
      }catch(error){mutate(profile,input.id,live=>{if(live.operation?.id===op.id){live.status='sending';live.operation.phase='uncertain';live.operation.error='Cancellation is unconfirmed. Check provider before retrying.';}});throw Error('Cancellation is unconfirmed. Check provider; no cancellation or create is automatically repeated.');}
    });},
  };
}
