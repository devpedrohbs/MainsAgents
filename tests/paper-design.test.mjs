import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PassThrough,Writable} from 'node:stream';
import {DatabaseSync} from 'node:sqlite';
import {paperAutomaticDecision,paperDesignInstructions,validPaperDesign,withoutPaperAutomation} from '../paper-design.mjs';
import {inspectPaperDesktop} from '../paper-desktop.mjs';
import {createRuntimeActionApprovals} from '../runtime-action-approvals.mjs';
import {createClaudeCodeBridge} from '../claude-code-bridge.mjs';
import {composeImport} from '../src/data/backupFormat.ts';
import {agentDraftKey,agentDraftValuesProblem,putAgentDraft,restoreAgentDraft} from '../src/features/agents/agentDrafts.ts';

const design={enabled:true,automatic:true,fileId:'01JPAPERFILE',fileName:'Carrosséis',signature:'@pedro',visualStyle:'Azul editorial'};
const agent={providerId:'claude',mcpPermissions:['read','write','delete'],paperDesign:design};
const decide=(tool,args,who=agent,server='paper')=>paperAutomaticDecision(who,server,tool,args);
const inFile=extra=>({fileId:design.fileId,...extra});

test('the no-repeat Paper grant covers only known design operations in the selected file',()=>{
 for(const [tool,args] of [['get_guide',{topic:'paper-mcp-instructions'}],['list_resources',{}],['get_basic_info',inFile()],['get_screenshot',inFile({nodeId:'1'})],['create_page',inFile({name:'Carrossel'})],['create_artboard',inFile({name:'1',styles:{}})],['write_html',inFile({mode:'insert-children',targetNodeId:'1',html:'<p>Texto</p>'})],['update_styles',inFile({updates:[]})],['set_text_content',inFile({updates:[]})],['duplicate_nodes',inFile({nodes:[]})],['finish_working_on_nodes',inFile()],['export',inFile({nodes:{a:[{format:'png',scale:'1x'}],b:[{format:'pdf'}]}})],['export',inFile({type:'image',nodes:{a:[{format:'jpg'}]}})],['export_combined_pdf',inFile({nodeIds:['a','b']})],['write_html',inFile({mode:'replace',targetNodeId:'1',html:'<p/>'})],['set_tokens',inFile({tokens:[]})]])
  assert.ok(decide(tool,args),`${tool} should be automatic`);
 for(const [tool,args,why] of [
  ['delete_nodes',inFile({nodeIds:['1']}),'deletion'],
  ['open_file',inFile(),'changing the open file'],
  ['create_file',{name:'Novo'},'creating another file'],
  ['rename_resource',{resourceId:design.fileId,name:'x'},'renaming the file'],
  ['set_comment_thread_status',inFile({commentThreadId:'c',status:'resolved'}),'comment moderation'],
  ['future_tool',inFile(),'unrecognized operation'],
  ['update_styles',{fileId:'OTHERFILE',updates:[]},'another file'],
  ['get_basic_info',{},'implicit active file'],
  ['export',inFile({type:'video',nodes:{a:[{format:'mp4'}]}}),'video export'],
  ['export',inFile({nodes:{a:[{format:'webm'}]}}),'video format'],
  ['export',inFile({nodes:'nodes-with-exports-only'}),'page-wide export'],
  ['export',inFile({nodes:{a:[]}}),'empty export'],
  ['write_html',inFile({mode:'insert-children',targetNodeId:'1',html:'<img src="paper-gen://photo?prompt=x">'}),'paid generation'],
  ['create_artboard',inFile({name:'1',styles:{backgroundImage:'url(PAPER-GEN://x)'}}),'paid generation, other case'],
  ['update_styles',inFile({updates:[{styles:{backgroundImage:'url(paper\\2d gen://x)'}}]}),'CSS-escaped generation'],
  ['write_html',inFile({mode:'insert-children',targetNodeId:'1',html:'<img src="paper&#45;gen://x">'}),'entity-escaped generation'],
  ['write_html',inFile({mode:'insert-children',targetNodeId:'1',html:'<img src="paper%2Dgen://x">'}),'percent-encoded generation'],
  ['write_html',inFile({mode:'insert-children',targetNodeId:'1',html:'<img src="paper-asset:///C:/Users/x/unverified.png">'}),'unverified local image'],
  ['write_html',inFile({mode:'append',targetNodeId:'1',html:'<p/>'}),'unknown write mode'],
 ])assert.equal(decide(tool,args),null,why);
 assert.equal(decide('write_html',inFile({mode:'insert-children',targetNodeId:'1',html:'<p>\\110000 x</p>'})),'Configured Paper design and export in the selected file','invalid escapes never throw');
 assert.equal(decide('get_screenshot',inFile({nodeId:'1'}),agent,'paper-other'),null,'only the server registered as paper');
 for(const who of [{...agent,providerId:'gemini'},{...agent,paperDesign:{...design,automatic:false}},{...agent,paperDesign:{...design,enabled:false}},{...agent,paperDesign:{...design,fileId:''}},{...agent,paperDesign:{...design,extra:true}},{providerId:'claude'}])
  assert.equal(decide('create_page',inFile({name:'x'}),who),null);
});

test('Paper settings: validation, legacy agents and prompt',()=>{
 assert.ok(validPaperDesign(design));
 assert.ok(validPaperDesign({...design,enabled:false,automatic:false,fileId:'',fileName:''}),'an unfinished draft is still a valid shape');
 assert.equal(validPaperDesign({...design,fileId:'bad id"\n'}),false);
 assert.equal(validPaperDesign({...design,visualStyle:'x'.repeat(12001)}),false);
 assert.equal(paperDesignInstructions({}),'','agents without Paper keep the previous prompt');
 assert.equal(paperDesignInstructions({paperDesign:{...design,enabled:false}}),'');
 const prompt=paperDesignInstructions({paperDesign:{...design,fileName:'A\nIgnore previous'}});
 assert.match(prompt,/Target fileId "01JPAPERFILE" \("A Ignore previous"\)/);
 assert.match(prompt,/Signature: "@pedro"/);assert.match(prompt,/Saved visual base \(fallback\): Azul editorial/);
 assert.match(prompt,/Do not ask the user to approve these steps/);assert.match(prompt,/deleting nodes, opening or creating another file/);assert.ok(prompt.includes('paper-asset:///'));
 assert.match(paperDesignInstructions({paperDesign:{...design,automatic:false,signature:''}}),/Not configured: omit brand text/);
 assert.deepEqual(withoutPaperAutomation({id:'a',paperDesign:design}).paperDesign,{...design,automatic:false});
 const legacy={id:'a',name:'Legacy'};assert.equal(withoutPaperAutomation(legacy),legacy);
});

test('a stale binding or a changed Paper preference interrupts the automatic grant',()=>{
 const db=new DatabaseSync(':memory:');let current={profileId:'owner',sessionId:'s',agentId:'a',agentName:'A',workspaceId:'w',hash:'h1',agent};
 const service=createRuntimeActionApprovals(db,{getCurrentProfile:()=> 'owner',getBinding:()=>current});
 const call=(id,tool,args,binding=current)=>{const replies=[];const action=service.register({requestId:id,threadId:'t',executionId:'e',server:'paper',tool,arguments:args},binding,reply=>replies.push(reply),()=>current);return {row:service.list('owner').find(item=>item.id===action),replies};};
 try{
  const ok=call('1','create_page',inFile({name:'Carrossel'}));
  assert.equal(ok.row.status,'approved');assert.equal(ok.row.approvalSource,'paper-preference');assert.equal(ok.replies[0].action,'accept');
  const removal=call('2','delete_nodes',inFile({nodeIds:['1']}));
  assert.equal(removal.row.status,'pending','deletion waits for the person');assert.equal(removal.replies.length,0);
  const original=current;current={...current,hash:'h1-edited'};
  assert.equal(call('2b','create_page',inFile({name:'x'}),original).row.status,'interrupted','any saved change to the agent or session revokes the grant');
  current={...original,hash:'h2',agent:{...agent,paperDesign:{...design,automatic:false}}};
  const stale=call('3','create_page',inFile({name:'x'}),original);
  assert.equal(stale.row.status,'interrupted');assert.equal(stale.replies[0].action,'decline');
  current={...original,agent:{...agent,mcpPermissions:['read']}};
  assert.equal(call('4','create_page',inFile({name:'x'})).row.status,'denied','agent MCP permissions still apply');
 }finally{service.close();db.close();}
});

/** Scripted Paper CLI over the same newline-delimited JSON-RPC stdio the real `paper mcp` speaks. */
function fakePaper(tools,{silent=false,flood=false}={}){
 const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.calls=[];child.order=[];child.killed=false;
 child.kill=()=>{if(child.killed)return;child.killed=true;child.stdout.end();setImmediate(()=>child.emit('close',null));};
 let buffer='';
 child.stdin=new Writable({write(chunk,_encoding,done){buffer+=chunk;for(let end;(end=buffer.indexOf('\n'))>=0;){const message=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);child.order.push(message.method);
  if(message.id===undefined||silent)continue;
  if(flood){child.stdout.write('x'.repeat(20_000));continue;}
  let result;if(message.method==='initialize')result={protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'paper-desktop',version:'0.0.1'}};
  else{child.calls.push([message.params.name,message.params.arguments]);result=tools[message.params.name]?.(message.params.arguments)??{content:[{type:'text',text:'unexpected'}],isError:true};}
  child.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result})+'\n');}done();}});
 return child;
}
const text=value=>({content:[{type:'text',text:typeof value==='string'?value:JSON.stringify(value)}]});
const guide=()=>text('# Paper guide');

test('the Paper inspector reads guide and basic info only, and confirms the file ID',async()=>{
 let child;const spawnImpl=(command,args)=>{assert.deepEqual(args,['mcp']);return child;};
 child=fakePaper({get_guide:guide,get_basic_info:()=>text({fileId:'01JPAPERFILE',fileName:'Carrosséis\u0007',pages:[]})});
 const direct=await inspectPaperDesktop({spawnImpl});
 assert.deepEqual([direct.fileId,direct.fileName],['01JPAPERFILE','Carrosséis']);
 assert.deepEqual(child.calls.map(([name])=>name),['get_guide','get_basic_info']);assert.ok(child.killed,'the CLI process is always stopped');
 // No ID in get_basic_info: the active desktop tab identifies it and get_basic_info({fileId}) confirms it.
 child=fakePaper({get_guide:guide,get_basic_info:args=>text(args.fileId?`File: Carrosséis\nPages: 1`:'File: Carrosséis\nArtboards: 0'),list_resources:()=>text({items:[{type:'file',id:'OTHER',name:'Outro',open:true},{type:'file',id:'01JPAPERFILE',name:'Carrosséis',open:true,active:true},{type:'folder',id:'f'}]})});
 const fallback=await inspectPaperDesktop({spawnImpl});
 assert.deepEqual([fallback.fileId,fallback.fileName],['01JPAPERFILE','Carrosséis']);
 assert.deepEqual(child.calls,[['get_guide',{topic:'paper-mcp-instructions'}],['get_basic_info',{}],['list_resources',{limit:50}],['get_basic_info',{fileId:'01JPAPERFILE'}]]);
 assert.ok(child.calls.every(([name])=>['get_guide','get_basic_info','list_resources'].includes(name)),'read-only tools only');
});

test('the Paper inspector fails with bounded, sanitized errors',async()=>{
 const run=(child,options={})=>inspectPaperDesktop({spawnImpl:()=>child,timeoutMs:300,...options});
 // Exact text the real CLI returns when the Desktop app is closed.
 const closed=fakePaper({get_guide:()=>({content:[{type:'text',text:"Paper Desktop isn't running. Tell the user to open it, then end your turn. Don't launch Paper Desktop yourself."}],isError:true})});
 await assert.rejects(run(closed),/Abra o Paper Desktop e um arquivo/);
 assert.deepEqual(closed.calls.map(([name])=>name),['get_guide'],'stops before get_basic_info');assert.ok(closed.killed);
 assert.deepEqual(closed.order.slice(0,3),['initialize','notifications/initialized','tools/call'],'initialized is sent after the handshake, before any tool');
 const silent=fakePaper({},{silent:true});const started=Date.now();
 await assert.rejects(run(silent),/não respondeu a tempo/);assert.ok(Date.now()-started<3000);assert.ok(silent.killed);
 const flood=fakePaper({},{flood:true});await assert.rejects(run(flood,{maxOutput:10_000}),/grande demais/);assert.ok(flood.killed);
 await assert.rejects(run(fakePaper({get_guide:guide,get_basic_info:()=>text('File: Sem ID'),list_resources:()=>text({items:[{type:'file',id:'a',active:true},{type:'file',id:'b',active:true}]})})),/identificar o arquivo aberto/,'ambiguous active tab');
 await assert.rejects(run(fakePaper({get_guide:guide,get_basic_info:()=>text({fileId:'bad id "x"\n',fileName:'x'}),list_resources:()=>text([])})),/identificar o arquivo aberto/,'an unsafe ID is never accepted');
 const leaky=fakePaper({get_guide:guide,get_basic_info:()=>({content:[{type:'text',text:'token=secret C:\\Users\\x\\config.json'}],isError:true})});
 await assert.rejects(run(leaky),error=>!/secret|config/.test(error.message));
 const closing=fakePaper({get_guide:guide});closing.stdin=new Writable({write(_c,_e,done){done();setImmediate(()=>closing.emit('close',1));}});
 await assert.rejects(run(closing),/encerrada/);
 // A Paper process that disappears mid-write (EPIPE on stdin) is a rejected inspection, not an app crash.
 const broken=fakePaper({});broken.stdin=new Writable({write(_c,_e,done){done(Object.assign(Error('write EPIPE'),{code:'EPIPE'}));}});
 await assert.rejects(run(broken),/encerrada/);
 await assert.rejects(inspectPaperDesktop({command:join(tmpdir(),'missing-paper-cli.exe')}),/Paper CLI não encontrado/);
});

test('backups never restore the no-repeat Paper grant; incomplete Paper drafts persist',()=>{
 const imported={format:'mainsagents-backup',version:1,exportedAt:'',data:{workspaces:[{id:'w'}],agents:[{id:'a',workspaceId:'w',paperDesign:design},{id:'legacy',workspaceId:'w'}],'agent-drafts':{[agentDraftKey({profile:'p',workspaceId:'w',agentId:'a'})]:{savedAt:'x',values:{name:'A',paperDesign:design}}}}};
 for(const mode of ['replace','merge']){
  const result=composeImport({},imported,mode,{profile:'p'});
  assert.deepEqual(result.agents[0].paperDesign,{...design,automatic:false},mode);
  assert.deepEqual(result.agents[1],{id:'legacy',workspaceId:'w'});
  assert.equal(Object.values(result['agent-drafts'])[0].values.paperDesign.automatic,false);
 }
 const current={agents:[{id:'a',workspaceId:'w',paperDesign:design}]};
 assert.equal(composeImport(current,imported,'merge').agents[0].paperDesign.automatic,true,'a merge keeps the local agent and its local choice');
 const scope={profile:'new-profile',workspaceId:'w'},draft={name:'Carrosséis',role:'',paperDesign:{...design,automatic:false,fileId:'',fileName:''}};
 assert.equal(agentDraftValuesProblem(draft),undefined);
 const stored=JSON.parse(JSON.stringify(putAgentDraft({},scope,draft)));
 assert.deepEqual(restoreAgentDraft(stored,scope,{name:'',role:''}).paperDesign,draft.paperDesign);
});

/** Talks to the real permission MCP server exactly as Claude Code does (stdio JSON-RPC). */
async function askGate(server,toolName,input){
 const child=spawn(process.execPath,server.args,{env:{...process.env,...server.env},stdio:['pipe','pipe','inherit']});
 const replies=new Map();let buffer='';
 child.stdout.on('data',chunk=>{buffer+=chunk;for(let i;(i=buffer.indexOf('\n'))>=0;){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);const message=JSON.parse(line);replies.get(message.id)?.(message);}});
 const call=(id,method,params)=>new Promise(resolve=>{replies.set(id,resolve);child.stdin.write(`${JSON.stringify({jsonrpc:'2.0',id,method,params})}\n`);});
 try{await call(1,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}});const result=await call(2,'tools/call',{name:'approve',arguments:{tool_name:toolName,input,tool_use_id:`toolu_${Math.random()}`}});return JSON.parse(result.result.content[0].text);}
 finally{child.kill();}
}

test('Claude Paper calls go through the real gate: saved file scope runs, everything else waits; prompt follows the saved agent',async()=>{
 const root=mkdtempSync(join(tmpdir(),'mainsagents-paper-gate-')),db=new DatabaseSync(':memory:');
 let binding={profileId:'owner',sessionId:'s',agentId:'a',agentName:'Carrosséis',workspaceId:'w',hash:'h1',agent};
 const actions=createRuntimeActionApprovals(db,{getCurrentProfile:()=> 'owner',timeoutMs:400});
 const launches=[];
 const editorAuthoring={attach:()=>'editor-token',limits:()=>({maxRevisions:1,maxPreviews:1}),subscribe:()=>()=>{},detach(){},checkpoint:()=>null};
 const bridge=createClaudeCodeBridge({editorAuthoring,cwdRoot:root,resolveCli:()=>({command:'claude',prefixArgs:[]}),getApprovals:()=>({actions,claudeBinding:()=>binding}),bindingWaitMs:100,spawnImpl:(_resolved,args)=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();let prompt='';child.stdin=new Writable({write(chunk,_e,done){prompt+=chunk;done();}});child.kill=()=>child.emit('close',1);launches.push({args,child,prompt:()=>prompt});return child;}});
 try{
  // The renderer sends an older copy; the saved agent (binding) is what reaches the prompt.
  await bridge.runtime.send('8a7c3b52-6a4f-4b8e-9d1c-2f3e4a5b6c7d','Crie um carrossel',{name:'Carrosséis',tools:[],runtimeFirstMessage:true,paperDesign:{...design,fileId:'OLDFILE'}});
  const {args,child,prompt}=launches[0];
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(prompt(),/Target fileId "01JPAPERFILE"/);assert.doesNotMatch(prompt(),/OLDFILE/);
  const gate=JSON.parse(readFileSync(args[args.indexOf('--mcp-config')+1],'utf8')).mcpServers.mainsagents;
  const create=inFile({name:'Carrossel'});
  assert.deepEqual(await askGate(gate,'mcp__paper__create_page',create),{behavior:'allow',updatedInput:create});
  assert.equal((await askGate(gate,'mcp__paper__delete_nodes',inFile({nodeIds:['1']}))).behavior,'deny','deletion is not automatic and expires without a decision');
  assert.equal((await askGate(gate,'mcp__paper__update_styles',{fileId:'OTHER',updates:[]})).behavior,'deny');
  binding={...binding,hash:'h2',agent:{...agent,paperDesign:{...design,automatic:false}}};
  assert.equal((await askGate(gate,'mcp__paper__create_page',create)).behavior,'deny','the current saved preference is read on every call');
  const rows=actions.list('owner');
  assert.deepEqual(rows.filter(row=>row.status==='approved').map(row=>[row.tool,row.approvalSource]),[['create_page','paper-preference']]);
  child.emit('close',0);
  // Without a saved binding the request copy never reaches the prompt.
  const saved=binding;binding=null;
  await bridge.runtime.send('7c8c3b52-6a4f-4b8e-9d1c-2f3e4a5b6c7f','Crie um carrossel',{name:'X',tools:[],runtimeFirstMessage:true,paperDesign:design});
  await new Promise(resolve=>setImmediate(resolve));assert.doesNotMatch(launches[1].prompt(),/Paper/);launches[1].child.emit('close',0);launches.splice(1,1);binding=saved;
  // Editor (production) executions never receive the general Paper prompt or the gate, even for a Paper-enabled agent.
  binding={...binding,agent};
  await bridge.runtime.send('9b8c3b52-6a4f-4b8e-9d1c-2f3e4a5b6c7e','Edite o vídeo',{...agent,name:'Carrosséis',tools:[],runtimeFirstMessage:true,editorSessionId:'edit-1'});
  const editor=launches[1];await new Promise(resolve=>setImmediate(resolve));
  assert.doesNotMatch(editor.prompt(),/Paper/);
  assert.equal(JSON.parse(readFileSync(editor.args[editor.args.indexOf('--mcp-config')+1],'utf8')).mcpServers.mainsagents,undefined);
  assert.ok(editor.args.includes('--restricted'));
  editor.child.emit('close',0);
 }finally{actions.close();db.close();rmSync(root,{recursive:true,force:true});}
});

test('verified local images are part of the routine grant only through the host verifier',async()=>{
 const {setPaperAssetVerifier,paperAssetReferences}=await import('../paper-design.mjs');
 const html='<img src="paper-asset:///C:/Users/x/gen%20one.png"><div style="background:url(paper-asset:///C:\\Users\\x\\two.png)"></div>';
 assert.deepEqual(paperAssetReferences({html}),['C:/Users/x/gen one.png','C:/Users/x/two.png']);
 try{
  setPaperAssetVerifier(path=>({ok:path==='C:/Users/x/gen one.png'}));
  assert.equal(decide('write_html',inFile({mode:'insert-children',targetNodeId:'1',html})),null,'one unverified image keeps per-call review');
  assert.ok(decide('write_html',inFile({mode:'insert-children',targetNodeId:'1',html:'<img src="paper-asset:///C:/Users/x/gen%20one.png">'})));
 assert.deepEqual(paperAssetReferences({html:'<img src="paper-asset:///home/u/a.png">'}),['/home/u/a.png'],'POSIX paths keep their leading slash');
  assert.deepEqual(paperAssetReferences({html:'<img src="&#112;aper-asset:///C:/Users/x/gen%20one.png">'}),['C:/Users/x/gen one.png'],'entity spelling is decoded');
  assert.ok(paperAssetReferences({html:'<img src="paper-asset&colon;///C:/Users/x/gen%20one.png">'}).includes(' '),'an unparsed spelling fails closed');
  assert.equal(decide('write_html',inFile({mode:'insert-children',targetNodeId:'1',html:'<img src="paper-asset&colon;///C:/Users/x/gen%20one.png">'})),null);
 }finally{setPaperAssetVerifier(null);}
});
