// Isolated fixture test for ui-capture-ready.mjs: no app data, network or CLI.
import {app,BrowserWindow} from 'electron';
import assert from 'node:assert/strict';
import {waitForCaptureReady,captureReadyPng} from './ui-capture-ready.mjs';
const page=body=>'data:text/html;charset=utf-8,'+encodeURIComponent(`<!doctype html><html><body style="margin:0"><div id="root"><main style="padding:20px">Tela real</main></div>${body}</body></html>`);
app.whenReady().then(async()=>{let win;try{
 win=new BrowserWindow({show:false,width:600,height:400,webPreferences:{sandbox:true,offscreen:true,backgroundThrottling:false}});
 await win.loadURL(page('<div id="splash" style="position:fixed;inset:0;background:#fff">Splash</div>'));
 await assert.rejects(()=>waitForCaptureReady(win.webContents,{timeoutMs:600}),/Capture not ready/);
 await assert.rejects(()=>captureReadyPng(win.webContents,{timeoutMs:400}),/Capture not ready/);
 // splash fading out through the same class/removal path as app.html
 await win.webContents.executeJavaScript('document.getElementById("splash").style.transition="opacity .3s";document.getElementById("splash").style.opacity="0";setTimeout(()=>document.getElementById("splash").remove(),350)');
 const state=await waitForCaptureReady(win.webContents);assert.equal(state.splashVisible,false);
 const png=await captureReadyPng(win.webContents);assert(png.length>200);
 // hidden splash left in DOM is also accepted
 await win.loadURL(page('<div id="splash" style="position:fixed;inset:0;visibility:hidden">Splash</div>'));
 assert.equal((await waitForCaptureReady(win.webContents)).splashVisible,false);
 // empty root is not ready
 await win.loadURL('data:text/html,<div id="root"></div>');
 await assert.rejects(()=>waitForCaptureReady(win.webContents,{timeoutMs:400}),/Capture not ready/);
 console.log('UI_CAPTURE_READY_OK: visible splash rejected, hidden/removed splash accepted, empty root rejected.');
 win.destroy();app.exit(0);
}catch(error){console.error(error);if(win&&!win.isDestroyed())win.destroy();app.exit(1)}});
