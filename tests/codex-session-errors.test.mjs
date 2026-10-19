import test from 'node:test';
import assert from 'node:assert/strict';
import {isMissingThreadError,isThreadNotLoadedError,readThreadOrMissing} from '../codex-session-errors.mjs';

test('only proven absence is a missing session',()=>{
 for(const value of [{code:'thread-missing',message:'x'},Error('no rollout found for thread id 019a'),Error('no persisted rollout for thread 019a'),'Thread not materialized yet'])assert.equal(isMissingThreadError(value),true,String(value?.message??value));
 for(const value of [Error('thread not loaded: 019a'),Error('invalid session id: abc'),Error('401 Unauthorized'),Error('fetch failed ECONNRESET'),Error('windows sandbox: helper_unknown_error: setup refresh had errors'),null,undefined])assert.equal(isMissingThreadError(value),false,String(value?.message??value));
 assert.equal(isThreadNotLoadedError(Error('thread not loaded: 019a')),true);
});

test('not loaded is resumed and read again; missing after resume is reported; other errors propagate',async()=>{
 const calls=[];let loaded=false;
 const read=async id=>{calls.push('read');if(!loaded)throw Error(`thread not loaded: ${id}`);return {id,turns:[]};};
 assert.deepEqual(await readThreadOrMissing(read,async()=>{calls.push('resume');loaded=true;},'t1'),{thread:{id:'t1',turns:[]}});
 assert.deepEqual(calls,['read','resume','read']);
 assert.deepEqual(await readThreadOrMissing(async()=>{throw Error('thread not loaded: t2');},async()=>{throw Error('no rollout found for thread id t2');},'t2'),{missing:true});
 assert.deepEqual(await readThreadOrMissing(async()=>{throw Error('no rollout found for thread id t3');},null,'t3'),{missing:true});
 await assert.rejects(readThreadOrMissing(async()=>{throw Error('invalid session id: t4');},async()=>{},'t4'),/invalid session id/);
 await assert.rejects(readThreadOrMissing(async()=>{throw Error('thread not loaded: t5');},async()=>{throw Error('setup refresh had errors');},'t5'),/setup refresh/);
});

test('bridge HTTP codes follow the same classes as the CLI texts',()=>{
 assert.equal(isMissingThreadError({code:'thread-missing',message:'Gone'}),true);
 assert.equal(isMissingThreadError({code:'invalid-thread-id',message:'no rollout found for thread id x'}),false,'an explicit invalid id code wins');
 assert.equal(isThreadNotLoadedError({code:'thread-not-loaded',message:'Resume this session first'}),true);
 assert.equal(isMissingThreadError(Error('thread not found: 019a')),true);
});
