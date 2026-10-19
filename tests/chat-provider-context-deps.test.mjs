import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// No ESLint (react-hooks/exhaustive-deps) in this repo: guard the ChatProvider context by hand. A callback exposed in the
// context value but missing from the useMemo deps keeps a stale closure (e.g. setSessionProvider would apply an old default
// Codex model after Settings changes it).
const source=readFileSync(new URL('../src/features/chat/ChatProvider.tsx',import.meta.url),'utf8');

test('every useCallback exposed by the chat context is a dependency of its useMemo', () => {
  const start=source.indexOf('const value=useMemo<ChatContextValue>(');
  assert.notEqual(start,-1,'context value memo found');
  const depsStart=source.indexOf('}),[',start),depsEnd=source.indexOf(']);',depsStart);
  assert.ok(depsStart>start&&depsEnd>depsStart,'deps array found');
  const body=source.slice(start,depsStart),deps=new Set(source.slice(depsStart+4,depsEnd).split(',').map(item=>item.trim()));
  const callbacks=[...source.matchAll(/const (\w+)=useCallback\(/g)].map(match=>match[1]);
  const exposed=callbacks.filter(name=>new RegExp(`[{,\\s]${name}[,}\\s:]`).test(body));
  assert.ok(exposed.includes('setSessionProvider'),'setSessionProvider is exposed');
  assert.deepEqual(exposed.filter(name=>!deps.has(name)),[],'exposed callbacks missing from the deps');
});
