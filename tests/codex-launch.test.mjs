import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codexLaunch } from '../codex-bridge.mjs';

test('a native Codex executable is not passed to the JavaScript runtime',()=>{
  const launch=codexLaunch({platform:'win32',cliPath:'C:/Codex/codex.exe',nodePath:'electron.exe'});
  assert.equal(launch.command,'C:/Codex/codex.exe');
  assert.deepEqual(launch.args,['app-server','--stdio']);
});
test('the npm Codex entrypoint still runs through Node',()=>{
  const launch=codexLaunch({platform:'win32',cliPath:'C:/npm/codex.js',nodePath:'node.exe'});
  assert.equal(launch.command,'node.exe');
  assert.deepEqual(launch.args,['C:/npm/codex.js','app-server','--stdio']);
});
