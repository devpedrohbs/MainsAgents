import test from 'node:test';import assert from 'node:assert/strict';
import {createRecordingContent} from '../src/features/content/recordingContent.ts';
import {emptyEditorialState} from '../src/features/content/model.ts';
test('local recording content creates a linked draft without approving scripts, selecting networks or writing Notion',()=>{
 const original=emptyEditorialState(),{state,content}=createRecordingContent(original,'workspace','  My recorded video  ');
 assert.equal(original.contents.length,0);assert.equal(content.title,'My recorded video');assert.equal(content.productionStage,'recording');assert.equal(content.status,'planning');assert.equal(content.approvedScriptArtifactId,undefined);assert.deepEqual(content.platforms,[]);assert.equal(state.approvals.length,0);assert.equal(state.runs.length,0);assert.equal(state.topics[0].status,'draft');assert.equal(state.topics[0].contentId,content.id);assert.equal(content.topicId,state.topics[0].id);
 assert.throws(()=>createRecordingContent(state,'','Invalid'));assert.throws(()=>createRecordingContent(state,'workspace',' '));assert.throws(()=>createRecordingContent(state,'workspace','a'.repeat(121)));
});
