export const canvasBrowserPartition = 'persist:mainsagents-canvas-browser';

export function allowedBrowserUrl(value, appOrigin) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && url.origin !== appOrigin;
  } catch { return false; }
}

export function attachCanvasBrowserPolicy(contents, appOrigin, openExternal) {
  contents.on('will-attach-webview', (event, preferences, params) => {
    if (!allowedBrowserUrl(params.src, appOrigin) || params.partition !== canvasBrowserPartition) {
      event.preventDefault();
      return;
    }
    delete preferences.preload;
    delete preferences.preloadURL;
    Object.assign(preferences, {
      nodeIntegration: false, nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false, contextIsolation: true,
      sandbox: true, webSecurity: true, webviewTag: false,
    });
  });
  contents.on('did-attach-webview', (_event, guest) => {
    guest.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    guest.session.setPermissionCheckHandler(() => false);
    const checkNavigation = (event, url) => {
      if (!allowedBrowserUrl(url, appOrigin)) event.preventDefault();
    };
    guest.on('will-navigate', checkNavigation);
    guest.on('will-redirect', checkNavigation);
    guest.setWindowOpenHandler(({ url }) => {
      // Research links that request a new tab stay in the Canvas browser.
      if (allowedBrowserUrl(url, appOrigin)) void guest.loadURL(url).catch(() => {});
      return { action: 'deny' };
    });
  });
}
