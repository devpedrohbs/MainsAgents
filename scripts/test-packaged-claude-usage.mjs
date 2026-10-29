// Isolated packaged backend: synthetic account and HTTP responses; no real profile, credentials or AI calls.
import {app} from 'electron';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
const temporary=mkdtempSync(join(tmpdir(),'mains-packaged-claude-usage-'));
app.setPath('userData',temporary);
const asar=resolve(process.argv[2]||'release/r79-20261027/win-unpacked/resources/app.asar');
let server;
try{
 const {createClaudeAccountUsage}=await import(pathToFileURL(join(asar,'claude-account-usage.mjs')).href);
 const {createClaudeCodeBridge}=await import(pathToFileURL(join(asar,'claude-code-bridge.mjs')).href);
 let calls=0;
 const readAccountUsage=createClaudeAccountUsage({readAccount:async()=>({token:'fixture-token',plan:'pro'}),fetchImpl:async()=>{
  calls++;return new Response(JSON.stringify({five_hour:{utilization:51,resets_at:'2026-10-27T21:00:00Z'},seven_day:{utilization:37}}));
 }});
 const bridge=createClaudeCodeBridge({readAccountUsage,resolveCli:()=>{throw Error('No model process allowed');}});
 server=createServer((request,response)=>void bridge.handle(request,response,new URL(request.url,'http://127.0.0.1')));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url=`http://127.0.0.1:${server.address().port}/api/providers/claude/usage`;
 const usage=await (await fetch(url)).json();
 assert.equal(usage.fiveHours.usedPercent,51);assert.equal(usage.weekly.usedPercent,37);assert.equal(usage.plan,'pro');assert.equal(usage.source,'account');
 await fetch(url);assert.equal(calls,1,'sidebar and page share the backend cache');
 assert.doesNotMatch(JSON.stringify(usage),/fixture-token/);
 console.log('PACKAGED_CLAUDE_ACCOUNT_USAGE_OK');
 await new Promise(resolve=>server.close(resolve));app.exit(0);
}catch(error){console.error(error);server?.close();app.exit(1);}
