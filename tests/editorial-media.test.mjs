import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {runMediaProcess,probeVideo} from '../editorial-media.mjs';
import {inspectLocalAsset} from '../editorial-local-files.mjs';
import {executionSnapshot,restoreExecution} from '../editorial-execution-backup.mjs';

const inspect=path=>inspectLocalAsset(path,{stabilityMs:0});
async function fixture(){
  const root=mkdtempSync(join(tmpdir(),'media-export-')),path=join(root,'state.sqlite'),input=join(root,'original.mp4');
  await runMediaProcess('ffmpeg',['-nostdin','-v','error','-n','-f','lavfi','-i','testsrc2=size=192x108:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','3','-c:v','libx264','-c:a','aac',input]);
  const file=await inspect(input),original=readFileSync(input),at=new Date().toISOString();
  let hold=false,calls=0,active='owner';const options={dbPath:path,getCurrentProfile:()=>active,mediaOptions:{inspect,run:async(binary,args,opts)=>{
    if(binary==='ffmpeg'&&args.includes('-progress')){calls++;if(hold)return new Promise((resolve,reject)=>{if(opts.signal.aborted)reject(new Error('Canceled'));else opts.signal.addEventListener('abort',()=>reject(new Error('Canceled')),{once:true})});}
    return runMediaProcess(binary,args,opts);
  }}};
  let bridge=createContentWorkflowBridge(options),db=new DatabaseSync(path);
  db.prepare('INSERT INTO editorial_state VALUES (?,?,?,?)').run('owner',1,JSON.stringify({schemaVersion:1,topics:[{id:'topic',workspaceId:'space'}],contents:[{id:'content',workspaceId:'space',topicId:'topic',title:'Test content'}],runs:[],artifacts:[],approvals:[],assets:[{id:'source',workspaceId:'space',contentId:'content',name:file.name,kind:'video',role:'source',status:'available',currentVersionId:'v1',versions:[{id:'v1',...file,createdAt:at}],createdAt:at,updatedAt:at}]}),at);
  const state=()=>JSON.parse(db.prepare('SELECT state_json FROM editorial_state WHERE profile_id=?').get('owner').state_json);
  const enqueue=(extra={})=>bridge.media.enqueue('owner',{revision:db.prepare('SELECT revision FROM editorial_state').get().revision,requestKey:'cut-one',contentId:'content',assetId:'source',versionId:'v1',sha256:file.sha256,start:0.5,duration:1.2,...extra});
  return {root,path,input,file,original,db,state,enqueue,get bridge(){return bridge},calls:()=>calls,hold:value=>{hold=value},profile:value=>{active=value},reopen:async()=>{await bridge.close();bridge=createContentWorkflowBridge(options)},close:async()=>{await bridge.close();db.close()}};
}
async function until(predicate){const deadline=Date.now()+10000;while(Date.now()<deadline){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,15))}throw new Error('Media work timed out');}
test('real FFmpeg cut produces verified video and audio, preserves original and attaches one result after restart',async()=>{
  const f=await fixture();try{
    assert.equal((await f.bridge.media.capabilities()).available,true);
    const metadata=await f.bridge.media.inspect('owner',{contentId:'content',assetId:'source'});assert.equal(metadata.metadata.hasAudio,true);
    const job=f.enqueue().job;assert.equal(f.enqueue().job.id,job.id);
    await until(()=>f.bridge.media.list('owner')[0].status==='succeeded');
    const result=f.bridge.media.list('owner')[0].result,video=await probeVideo(result.file.path);assert(Math.abs(video.duration-1.2)<0.2);assert.equal(video.hasAudio,true);
    assert.deepEqual(readFileSync(f.input),f.original);assert.equal(f.state().assets.length,2);assert.equal(f.state().assets[1].sourceAssetId,'source');assert.equal(f.state().contents[0].productionStage,'video-review');
    assert.equal(f.state().artifacts[0].data.outputFiles[0].sha256,result.file.sha256);
    await f.reopen();assert.equal(f.bridge.media.list('owner')[0].status,'succeeded');assert.equal(f.calls(),1);assert.equal(f.state().assets.length,2);
  }finally{await f.close()}
});
test('closing interrupts local encoding, explicit recovery rechecks inputs, and cancellation never yields a delivery',async()=>{
  const f=await fixture();try{
    f.hold(true);const job=f.enqueue().job;await until(()=>f.calls()===1);
    await f.reopen();assert.equal(f.bridge.media.list('owner')[0].status,'interrupted');assert.equal(f.state().assets.length,1);
    f.hold(false);await f.bridge.media.retry('owner',job.id);await until(()=>f.bridge.media.list('owner')[0].status==='succeeded');assert.equal(f.calls(),2);assert.equal(f.state().assets.length,2);
    f.hold(true);const canceled=f.enqueue({requestKey:'cut-two',start:0,duration:0.7}).job;await until(()=>f.calls()===3);await f.bridge.media.cancel('owner',canceled.id);
    assert.equal(f.bridge.media.list('owner').find(item=>item.id===canceled.id).status,'canceled');assert.equal(f.state().assets.length,2);
  }finally{await f.close()}
});
test('invalid intervals, changed sources, foreign profiles and imported jobs cannot silently execute',async()=>{
  const f=await fixture();try{
    assert.throws(()=>f.enqueue({duration:0}),/interval/);assert.throws(()=>f.enqueue({versionId:'other'}),/source version/);
    f.profile('other');assert.throws(()=>f.enqueue(),/profile changed/);f.profile('owner');assert.equal(f.calls(),0);
    const job=f.enqueue({duration:50}).job;await until(()=>f.bridge.media.list('owner')[0].status==='failed');assert.equal(f.calls(),0);assert.equal(f.state().assets.length,1);
    const snapshot=executionSnapshot(f.db,'owner');restoreExecution(f.db,'owner',snapshot,'replace');assert.equal(f.bridge.media.list('owner')[0].imported,true);await assert.rejects(()=>f.bridge.media.retry('owner',job.id),/Imported history/);
  }finally{await f.close()}
});
