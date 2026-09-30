import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('preview boot is classic JavaScript after the root element', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const root = html.indexOf('<div id="root">');
  const start = html.indexOf('<script>', root);
  const end = html.lastIndexOf('</script>');
  assert.ok(root >= 0);
  assert.ok(start > root);
  assert.ok(end < html.indexOf('</body>'));
  assert.ok(!/<script[^>]+type="module"/.test(html));
  assert.ok(!/<script[^>]+src=/.test(html));
  new vm.Script(html.slice(start + '<script>'.length, end));
});

test('blocked storage getter does not crash application module initialization', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new DOMException('Storage blocked by preview sandbox', 'SecurityError'); },
  });
  try {
    const module = await import('../src/data/IndexedDbStateStore.ts?blocked-preview');
    assert.equal(typeof module.indexedDbStateStore.read, 'function');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
});
