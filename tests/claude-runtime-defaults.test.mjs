import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';
import {readClaudeDefaults,claudeModelLabel} from '../claude-runtime-defaults.mjs';
import {createClaudeCodeBridge} from '../claude-code-bridge.mjs';

function fixture(t,value){const home=mkdtempSync(join(tmpdir(),'claude-defaults-'));t.after(()=>rmSync(home,{recursive:true,force:true}));mkdirSync(join(home,'.claude'));if(value!==undefined)writeFileSync(join(home,'.claude','settings.json'),typeof value==='string'?value:JSON.stringify(value));return home;}
test('reports configured model without exposing other user settings or inventing an alias version',t=>{
 const home=fixture(t,{model:'opus',env:{ANTHROPIC_API_KEY:'must-not-escape'},effortLevel:'high'});
 assert.deepEqual(readClaudeDefaults({home,env:{}}),{connectionName:'Claude Code',defaultModel:{id:'opus',name:'Claude Opus',source:'user-settings'}});
 assert.equal(claudeModelLabel('claude-sonnet-4-6-20260101'),'Claude Sonnet 4.6');
 assert.equal(claudeModelLabel('my-model-id'),'my-model-id');
});
test('environment model wins, explicit default clears overrides, fallback environment only applies without a choice',t=>{
 const home=fixture(t,{model:'opus'});
 assert.equal(readClaudeDefaults({home,env:{ANTHROPIC_MODEL:'sonnet'}}).defaultModel.id,'sonnet');
 assert.deepEqual(readClaudeDefaults({home,env:{ANTHROPIC_MODEL:'default',ANTHROPIC_DEFAULT_MODEL:'haiku'}}),{connectionName:'Claude Code'});
 const empty=fixture(t);
 assert.equal(readClaudeDefaults({home:empty,env:{ANTHROPIC_DEFAULT_MODEL:'haiku'}}).defaultModel.source,'default-environment');
});
test('uses CLAUDE_CONFIG_DIR and refreshes configuration without stale cache or any writes',t=>{
 const home=fixture(t,{model:'opus'}),config=join(home,'custom');mkdirSync(config);const path=join(config,'settings.json');
 writeFileSync(path,JSON.stringify({model:'sonnet'}));const env={CLAUDE_CONFIG_DIR:config};
 assert.equal(readClaudeDefaults({home,env}).defaultModel.id,'sonnet');
 writeFileSync(path,JSON.stringify({model:'haiku'}));assert.equal(readClaudeDefaults({home,env}).defaultModel.id,'haiku');
});
test('missing, malformed, oversized, default and non-model configuration never claim an actual model',t=>{
 for(const value of [undefined,'{bad',null,{model:'default'},{model:'<script>'},{model:42},' '.repeat(1_000_001)]){
  const home=fixture(t,value);assert.deepEqual(readClaudeDefaults({home,env:{}}),{connectionName:'Claude Code'});
 }
});
test('status exposes model metadata separately from connection state without an inference request',async()=>{
 const bridge=createClaudeCodeBridge({resolveCli:()=>null,readDefaults:()=>({connectionName:'Claude Code',defaultModel:{id:'opus',name:'Claude Opus',source:'user-settings'}}),spawnImpl:()=>{throw Error('Must never infer to resolve default model');}});
 const status=await bridge.status();assert.equal(status.state,'not-installed');assert.equal(status.connectionName,'Claude Code');assert.equal(status.defaultModel.id,'opus');
});
