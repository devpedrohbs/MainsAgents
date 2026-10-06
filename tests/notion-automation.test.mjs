import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {notionAutomaticDecision,notionAutomationInstructions} from '../notion-automation-policy.mjs';
import {createRuntimeActionApprovals,actionHash} from '../runtime-action-approvals.mjs';
const source='11111111-2222-4333-8444-555555555555',other='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const agent={id:'editor',providerId:'codex',notionAutomation:{enabled:true,dataSourceId:`collection://${source}`}},create={parent:{data_source_id:source},pages:[{properties:{'Post Title':'A content idea',Status:'Idea'},content:'Review in Notion'}]};
test('configured Notion reads and Idea creation are automatic only within the authorized scope',()=>{
 for(const tool of ['notion-fetch','notion-search','notion-ai-search','notion-query-data-sources','notion-get-tool-access'])assert(notionAutomaticDecision(agent,'notion',tool,{}));
 assert(notionAutomaticDecision(agent,'notion','notion-create-pages',create));
 for(const [a,server,tool,args]of [[{...agent,notionAutomation:undefined},'notion','notion-fetch',{}],[{...agent,notionAutomation:{enabled:false,dataSourceId:source}},'notion','notion-fetch',{}],[{...agent,providerId:'claude'},'notion','notion-fetch',{}],[agent,'publora','notion-create-pages',create],[agent,'notion','notion-update-page',{page_id:'existing',properties:{Status:'Idea'}}],[agent,'notion','notion-create-pages',{...create,parent:{data_source_id:other}}],[agent,'notion','notion-create-pages',{...create,parent:{database_id:source}}],[agent,'notion','notion-create-pages',{...create,pages:[{properties:{Status:'Gravando','Post Title':'Unsafe'}}]}],[agent,'notion','notion-create-pages',{...create,pages:[{...create.pages[0],template_id:'unknown'}]}],[agent,'notion','execute_code',{}],[agent,'notion','notion-delete-page',{}],[agent,'notion','notion-create-pages',{...create,allow_async:true}]])assert.equal(notionAutomaticDecision(a,server,tool,args),null);
 assert(notionAutomationInstructions(agent).includes('Status="Idea"'));assert.equal(notionAutomationInstructions({...agent,notionAutomation:undefined}),'');
});
test('automatic exact grants are audited and confirmed; other writes still await a human and revocation/profile drift stops grants',()=>{
 const db=new DatabaseSync(':memory:');let current;const binding={profileId:'owner',agentId:'editor',agentName:'Editor',workspaceId:'content',sessionId:'chat',agent,hash:actionHash(agent)};current=binding;
 const replies=[],service=createRuntimeActionApprovals(db,{getCurrentProfile:()=> 'owner',getBinding:()=>current});
 const receive=(tool,args=create)=>service.receive({id:Math.random(),method:'mcpServer/elicitation/request',params:{threadId:'thread',turnId:'turn',serverName:'notion',mode:'form',message:`Allow the notion MCP server to run tool "${tool}"?`,_meta:{codex_approval_kind:'mcp_tool_call',tool_params:args}}},binding,r=>replies.push(r));
 try{
 const id=receive('notion-create-pages');assert.equal(replies[0].action,'accept');let row=service.list('owner').find(r=>r.id===id);assert.equal(row.status,'approved');assert.equal(row.approvalSource,'notion-preference');assert.throws(()=>service.decide('owner',id,{hash:row.hash,decision:'approve'}));
 service.observe({method:'item/completed',params:{threadId:'thread',turnId:'turn',item:{type:'mcpToolCall',server:'notion',tool:'notion-create-pages',arguments:create,result:{content:[]}}}});assert.equal(service.list('owner').find(r=>r.id===id).status,'succeeded');
 const pending=receive('notion-update-page',{page_id:'existing',properties:{Status:'Idea'}});assert.equal(service.list('owner').find(r=>r.id===pending).status,'pending');assert.equal(replies.length,1);
 current={...binding,hash:'changed',agent:{...agent,notionAutomation:{enabled:false,dataSourceId:source}}};const stopped=receive('notion-fetch',{});assert.equal(replies.at(-1).action,'decline');assert.equal(service.list('owner').find(r=>r.id===stopped).status,'interrupted');
 current=null;receive('notion-fetch',{});assert.equal(replies.at(-1).action,'decline');
 }finally{service.close();db.close();}
});
test('explicit MCP read/write restrictions also apply to automatic Notion mode',()=>{
 const db=new DatabaseSync(':memory:'),restricted={...agent,mcpPermissions:['read']},binding={profileId:'owner',agent:restricted,hash:'restricted'},replies=[],service=createRuntimeActionApprovals(db,{getCurrentProfile:()=> 'owner',getBinding:()=>binding});
 try{service.receive({id:1,method:'mcpServer/elicitation/request',params:{threadId:'t',turnId:'turn',serverName:'notion',mode:'form',message:'Allow the notion MCP server to run tool "notion-create-pages"?',_meta:{codex_approval_kind:'mcp_tool_call',tool_params:create}}},binding,r=>replies.push(r));assert.equal(replies[0].action,'decline');assert.equal(service.list('owner')[0].status,'denied');}finally{service.close();db.close();}
});
