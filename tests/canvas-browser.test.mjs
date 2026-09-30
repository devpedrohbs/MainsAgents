import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { allowedBrowserUrl, attachCanvasBrowserPolicy, canvasBrowserPartition } from '../canvas-browser-security.mjs';

test('Canvas browser accepts websites but rejects executable protocols and the app origin', () => {
  const origin = 'http://127.0.0.1:47831';
  assert.equal(allowedBrowserUrl('https://github.com', origin), true);
  for (const url of ['file:///C:/secret', 'javascript:alert(1)', 'data:text/html,test', `${origin}/api/codex`, 'https://user:password@example.com', 'not a URL']) {
    assert.equal(allowedBrowserUrl(url, origin), false, url);
  }
});

test('Remote Canvas pages cannot inherit the app preload or gain Node access', () => {
  const host = new EventEmitter();
  attachCanvasBrowserPolicy(host, 'http://127.0.0.1:47831', () => {});
  const preferences = { preload: '/app/preload.cjs', preloadURL: 'file:///app/preload.cjs', nodeIntegration: true, sandbox: false, webSecurity: false };
  const event = { preventDefault() { assert.fail('Valid site rejected'); } };
  host.emit('will-attach-webview', event, preferences, { src: 'https://example.com', partition: canvasBrowserPartition });
  assert.equal(preferences.preload, undefined);
  assert.equal(preferences.preloadURL, undefined);
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.webSecurity, true);
  let blocked = false;
  host.emit('will-attach-webview', { preventDefault() { blocked = true; } }, {}, { src: 'https://example.com', partition: 'persist:app' });
  assert.equal(blocked, true);
});

test('Canvas guest navigation and popups cannot open local files or app internals', () => {
  const host = new EventEmitter();
  const opened = [];
  attachCanvasBrowserPolicy(host, 'http://127.0.0.1:47831', url => opened.push(url));
  const guest = new EventEmitter();
  guest.loadURL = async url => opened.push(url);
  let popupHandler;
  let permissionHandler;
  guest.session = {
    setPermissionRequestHandler(handler) { permissionHandler = handler; },
    setPermissionCheckHandler(handler) { assert.equal(handler(), false); },
  };
  guest.setWindowOpenHandler = handler => { popupHandler = handler; };
  host.emit('did-attach-webview', {}, guest);
  for (const eventName of ['will-navigate', 'will-redirect']) {
    let blocked = false;
    guest.emit(eventName, { preventDefault() { blocked = true; } }, 'file:///C:/secret');
    assert.equal(blocked, true);
  }
  assert.deepEqual(popupHandler({ url: 'https://example.com' }), { action: 'deny' });
  popupHandler({ url: 'file:///C:/secret' });
  assert.deepEqual(opened, ['https://example.com']);
  permissionHandler({}, 'media', granted => assert.equal(granted, false));
});
