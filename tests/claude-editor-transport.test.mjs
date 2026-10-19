import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createClaudeCodeBridge } from '../claude-code-bridge.mjs';
import { createEditorHostFixture, ffmpegAvailable, sha256 } from './editor-host-fixture.mjs';

const skip = !(await ffmpegAvailable()) && 'FFmpeg is required for real frames';

/**
 * Fixture standing in for the Claude Code CLI (no model): it reads the --mcp-config the bridge wrote, starts that
 * MCP server exactly as configured and drives a scripted native tool loop over stdio JSON-RPC, echoing tool_use /
 * tool_result lines in the stream-json shape the real CLI prints (images included).
 */
const fakeCli = String.raw`
const fs=require('node:fs'),{spawn}=require('node:child_process'),path=require('node:path');
const args=process.argv.slice(2);
const out=line=>process.stdout.write(JSON.stringify(line)+'\n');
const config=JSON.parse(fs.readFileSync(args[args.indexOf('--mcp-config')+1],'utf8'));
const settings=JSON.parse(fs.readFileSync(args[args.indexOf('--settings')+1],'utf8'));
const server=config.mcpServers.mainsagents_editor;
fs.writeFileSync(path.join(process.cwd(),'fake-cli-record.json'),JSON.stringify({args,settings,servers:Object.keys(config.mcpServers),env:server?{url:server.env.MAINSAGENTS_EDITOR_URL,token:server.env.MAINSAGENTS_EDITOR_TOKEN}:null,agents:args.includes('--agents')?JSON.parse(fs.readFileSync(args[args.indexOf('--agents')+1],'utf8')):null}));
let prompt='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>prompt+=c);
process.stdin.on('end',async()=>{
 fs.writeFileSync(path.join(process.cwd(),'fake-cli-prompt.txt'),prompt);
 const child=spawn(server.command,server.args,{env:{...process.env,...server.env},stdio:['pipe','pipe','inherit']});
 const replies=new Map();let buffer='';
 child.stdout.on('data',chunk=>{buffer+=chunk;for(let i;(i=buffer.indexOf('\n'))>=0;){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);const message=JSON.parse(line);replies.get(message.id)?.(message);}});
 let id=0;const rpc=(method,params)=>new Promise(resolve=>{const n=++id;replies.set(n,resolve);child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:n,method,params})+'\n');});
 await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'fake-claude',version:'1'}});
 const listed=(await rpc('tools/list',{})).result.tools;
 let n=0;
 const use=async(name,input)=>{
  const toolUseId='toolu_'+(++n),full='mcp__mainsagents_editor__'+name;
  out({type:'stream_event',event:{type:'content_block_start',index:0,content_block:{type:'tool_use',id:toolUseId,name:full,input:{}}}});
  const result=(await rpc('tools/call',{name,arguments:input})).result;
  const content=result.content.map(b=>b.type==='image'?{type:'image',source:{type:'base64',media_type:b.mimeType,data:b.data}}:b);
  out({type:'user',message:{role:'user',content:[{type:'tool_result',tool_use_id:toolUseId,content,is_error:!!result.isError}]}});
  return result;
 };
 const seen=[];
 const ctx=await use('get_context',{});seen.push(['context',!!ctx.structuredContent?.transcript]);
 const heard=await use('get_transcript_words',{start:0,end:3});seen.push(['words',ctx.structuredContent.transcriptInfo.wordTool,heard.structuredContent.count,heard.content[0].text.split(String.fromCharCode(10))[1]]);
 const frames=await use('get_frames',{times:[0.5,2]});seen.push(['frames',frames.content.filter(b=>b.type==='image').length]);
 await use('write_plan',{baseRevision:0,plan:{scenes:[{start:0,end:3,layers:[{kind:'kineticText',text:'Olá'}]}]}});
 const early=await use('finalize',{revision:1});seen.push(['early-final',early.structuredContent.code]);
 const preview=await use('render_preview',{revision:1,start:0,duration:1});
 const sheet=await use('contact_sheet',{target:{previewId:preview.structuredContent.previewId},start:0,end:1,count:4});seen.push(['sheet',sheet.content.filter(b=>b.type==='image').length]);
 const final=await use('finalize',{revision:1,summary:'Texto animado no início.'});seen.push(['final',final.structuredContent.status]);
 child.kill();
 const text='Edição finalizada pelo app. '+JSON.stringify({listed:listed.map(t=>t.name),seen});
 out({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text}}});
 out({type:'result',is_error:false,result:text,structured_output:{status:'finalized',finalRevision:1,summary:'Texto animado no início.'}});
});
`;

async function collect(bridge, executionId) {
  const events = [];
  for await (const event of bridge.runtime.events(executionId)) events.push(event);
  return events;
}

test('Claude editor runs drive the real MCP server: native tool loop, real images, verified receipt', { skip }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'mainsagents-editor-cli-'));
  try {
    const fixture = await createEditorHostFixture(root);
    const cliPath = join(root, 'fake-claude.cjs'); writeFileSync(cliPath, fakeCli);
    const workspaceRoot = join(root, 'workspaces');
    const bridge = createClaudeCodeBridge({ cwdRoot: workspaceRoot, resolveCli: () => ({ command: process.execPath, prefixArgs: [cliPath] }), getApprovals: () => ({ actions: { register() { throw new Error('editor tools must not ask'); }, settle() {}, interrupt() {} }, claudeBinding: () => null }) });
    assert.equal(bridge.runtime.editorTools, true);
    const { sessionId } = bridge.runtime.openEditorSession({ binding: fixture.binding, host: fixture.host, grant: fixture.grant });
    const { executionId } = await bridge.runtime.send('8a7c3b52-6a4f-4b8e-9d1c-2f3e4a5b6c7d', 'Edite o vídeo.', { name: 'Editor', workspaceId: 'ws-1', tools: ['files', 'web-search'], skills: ['motion'], skillsDirectory: root, runtimeFirstMessage: true, editorSessionId: sessionId, editorReviewerModel: 'haiku', editorMaxTurns: 12 });
    const events = await collect(bridge, executionId);
    const record = JSON.parse(readFileSync(join(workspaceRoot, 'ws-1', 'fake-cli-record.json'), 'utf8'));
    const { args, settings } = record;

    // Permissions: only this edit's server, pre-allowed under dontAsk; no shell, no file writes, no other MCP.
    assert.deepEqual(record.servers, ['mainsagents_editor']);
    assert(args.includes('--strict-mcp-config'));
    assert.equal(args[args.indexOf('--permission-mode') + 1], 'dontAsk');
    assert(!args.includes('--permission-prompt-tool'));
    assert.equal(settings.permissions, undefined, 'no ask rule that dontAsk would turn into a denial');
    assert.equal(settings.disableAllHooks, true);
    const tools = args[args.indexOf('--tools') + 1].split(',');
    for (const forbidden of ['Bash', 'Write', 'Edit', 'NotebookEdit', 'PowerShell']) assert(!tools.includes(forbidden), forbidden);
    assert.deepEqual(tools, ['Agent'], 'no built-in web, file or shell tools; only the reviewer role');
    assert(args.includes('--restricted'));
    assert.equal(args[args.indexOf('--max-turns') + 1], '12');
    assert(!args.includes('--add-dir'));
    const allowed = args.slice(args.indexOf('--allowedTools') + 1);
    assert(allowed.includes('mcp__mainsagents_editor__*'));
    assert(!allowed.some((rule) => rule === 'mcp__*' || rule === '*'));
    assert.equal(JSON.parse(args[args.indexOf('--json-schema') + 1]).required.join(), 'status,finalRevision,summary');
    assert.deepEqual(record.agents['frame-reviewer'].tools, ['mcp__mainsagents_editor__get_context', 'mcp__mainsagents_editor__get_transcript_words', 'mcp__mainsagents_editor__get_frames', 'mcp__mainsagents_editor__contact_sheet', 'mcp__mainsagents_editor__storyboard_stills', 'mcp__mainsagents_editor__export_status']);
    assert.equal(record.agents['frame-reviewer'].model, 'haiku');

    const prompt = readFileSync(join(workspaceRoot, 'ws-1', 'fake-cli-prompt.txt'), 'utf8');
    assert.match(prompt, /MainsAgents editor tools/);
    assert.match(prompt, /at most 2 revision\(s\) and 3 preview\(s\)/);
    assert.match(prompt, /frame-reviewer/);
    const completed = events.find((event) => event.type === 'message.completed').content;
    const transcript = JSON.parse(completed.slice(completed.indexOf('{')));
    assert.deepEqual(transcript.listed, ['get_context', 'get_transcript_words', 'get_frames', 'contact_sheet', 'storyboard_stills', 'write_plan', 'render_preview', 'finalize', 'export_status']);
    assert.deepEqual(transcript.seen, [['context', true], ['words', 'get_transcript_words', 3, '0.10 0.40 Olá'], ['frames', 2], ['early-final', 'qa_required'], ['sheet', 1], ['final', 'succeeded']]);

    const started = events.filter((event) => event.type === 'tool.started');
    assert.equal(started[1].label, 'Reading spoken words...');
    assert.equal(started[2].label, 'Looking at video frames...');
    const finished = events.filter((event) => event.type === 'tool.finished');
    assert.equal(finished.length, 8, 'large image tool results are parsed, not dropped');
    assert.match(finished.find((event) => event.callId === 'toolu_5').summary, /^Refused: Render a preview/);
    assert.match(finished.at(-1).summary, /Final export verified by the host/);
    const receipt = events.find((event) => event.type === 'file.completed').receipt;
    assert.equal(receipt.path, fixture.state.finalFile);
    assert.equal(receipt.sha256, sha256(fixture.state.finalFile));
    assert.equal(events.find((event) => event.type === 'editor.report').consistent, true);
    assert(events.findIndex((event) => event.type === 'file.completed') < events.findIndex((event) => event.type === 'execution.completed'));

    // The finished process can no longer act; the run checkpoint stays available to the host.
    const late = await fetch(record.env.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${record.env.token}` }, body: JSON.stringify({ name: 'write_plan', arguments: { baseRevision: 1, plan: { scenes: [{}] } } }) }).then((response) => response.json());
    assert.equal(late.structuredContent.code, 'unbound');
    assert.equal(bridge.runtime.editorCheckpoint(sessionId).final.status, 'succeeded');
    assert.deepEqual(readdirSync(join(workspaceRoot, 'ws-1')).filter((name) => /mainsagents-runtime-(settings|mcp|agents)-/.test(name)), [], 'per-execution editor config is removed');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('normal Claude chats keep their policy and HTTP clients cannot attach an editor session', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mainsagents-editor-normal-'));
  const launches = [];
  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  const spawnImpl = (_resolved, args) => { const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.kill = () => child.emit('close', 1); launches.push({ args, child }); return child; };
  try {
    const bridge = createClaudeCodeBridge({ cwdRoot: root, resolveCli: () => ({ command: 'claude', prefixArgs: [] }), spawnImpl });
    await bridge.runtime.send('8a7c3b52-6a4f-4b8e-9d1c-2f3e4a5b6c7d', 'Oi', { name: 'Agent', tools: ['files'], runtimeFirstMessage: true });
    const { args } = launches[0];
    assert.equal(args[args.indexOf('--permission-mode') + 1], 'dontAsk');
    assert.equal(args[args.indexOf('--disallowedTools') + 1], 'mcp__*');
    assert(!args.includes('--json-schema'));
    assert(!args.join(' ').includes('mainsagents_editor'));
    assert.deepEqual(JSON.parse(readFileSync(args[args.indexOf('--settings') + 1], 'utf8')).permissions.ask, ['mcp__*']);
    assert.deepEqual(JSON.parse(readFileSync(args[args.indexOf('--mcp-config') + 1], 'utf8')), { mcpServers: {} });
    const prompt = String(launches[0].child.stdin.read() ?? '');
    assert.match(prompt, /User message:\nOi/);
    assert.doesNotMatch(prompt, /editor tools/i, 'normal chats get no editor protocol');
    launches[0].child.emit('close', 0);

    // An unknown editor session is refused before any process starts.
    await assert.rejects(bridge.runtime.send('9a7c3b52-6a4f-4b8e-9d1c-2f3e4a5b6c7d', 'Oi', { name: 'Agent', tools: [], editorSessionId: 'forged' }), /not found/);
    assert.equal(launches.length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the HTTP execution route strips editor fields', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mainsagents-editor-http-'));
  const launches = [];
  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  const { createServer } = await import('node:http');
  const spawnImpl = (_resolved, args) => { const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.kill = () => child.emit('close', 1); launches.push({ args, child }); return child; };
  const bridge = createClaudeCodeBridge({ cwdRoot: root, resolveCli: () => ({ command: 'claude', prefixArgs: [] }), spawnImpl });
  const server = createServer((request, response) => void bridge.handle(request, response, new URL(request.url, 'http://127.0.0.1')));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/providers/claude/executions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ remoteSessionId: '8a7c3b52-6a4f-4b8e-9d1c-2f3e4a5b6c7d', content: 'Oi', tools: [], editorSessionId: 'anything', firstMessage: true }) });
    assert.equal(response.status, 200);
    assert(!launches[0].args.join(' ').includes('mainsagents_editor'));
    launches[0].child.emit('close', 0);
  } finally { await new Promise((resolve) => server.close(resolve)); rmSync(root, { recursive: true, force: true }); }
});
