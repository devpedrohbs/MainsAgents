// Shared readiness + capture helper for Electron UI scripts. Observable conditions only, no blind sleeps.
const probe=`(async()=>{
 const splash=document.getElementById('splash');
 const visible=element=>{if(!element||!element.isConnected)return false;const style=getComputedStyle(element);if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)<0.01)return false;const rect=element.getBoundingClientRect();return rect.width>0&&rect.height>0};
 const root=document.getElementById('root')||document.body;
 const rect=root.getBoundingClientRect();
 await (document.fonts?.ready??Promise.resolve());
 await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 return {splashVisible:visible(splash),readyState:document.readyState,hasContent:root.children.length>0&&rect.width>0&&rect.height>0&&(root.innerText||'').trim().length>0,layout:[innerWidth,innerHeight,document.documentElement.scrollWidth,document.documentElement.scrollHeight,Math.round(rect.width),Math.round(rect.height)].join(':'),animations:document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.getTiming().iterations===1&&a.effect?.target?.closest?.('#splash')).length}
})()`;
export async function waitForCaptureReady(webContents,{timeoutMs=10000,stableFrames=3,pollMs=40}={}){
 const end=Date.now()+timeoutMs;let last='',stable=0,state;
 while(Date.now()<end){
  state=await webContents.executeJavaScript(probe);
  if(state.readyState==='complete'&&!state.splashVisible&&state.hasContent&&state.animations===0){stable=state.layout===last?stable+1:1;last=state.layout;if(stable>=stableFrames)return state}
  else{stable=0;last=''}
  await new Promise(resolve=>setTimeout(resolve,pollMs));
 }
 throw Error(`Capture not ready after ${timeoutMs}ms: ${JSON.stringify(state)}`);
}
// Waits for readiness, forces a repaint (offscreen windows) and returns PNG bytes.
export async function captureReadyPng(webContents,options){
 await waitForCaptureReady(webContents,options);
 webContents.invalidate();
 await webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
 return (await webContents.capturePage()).toPNG();
}
