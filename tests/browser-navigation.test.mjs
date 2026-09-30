import test from 'node:test';
import assert from 'node:assert/strict';
import { browserDestination, browserHome } from '../src/components/canvas/browserNavigation.ts';

test('new browsers open Google and the address bar accepts normal searches', () => {
  assert.equal(browserHome, 'https://www.google.com/');
  assert.equal(browserDestination(' notícias de IA '), 'https://www.google.com/search?q=not%C3%ADcias%20de%20IA');
  assert.equal(browserDestination('example.com/docs'), 'https://example.com/docs');
  assert.equal(browserDestination('https://example.com/?q=one'), 'https://example.com/?q=one');
  assert.equal(browserDestination(''), null);
});
test('address bar rejects executable URLs and credentials', () => {
  for (const input of ['file:///C:/private','javascript:alert(1)','data:text/html,test','https://user:pass@example.com']) assert.equal(browserDestination(input), null);
});
