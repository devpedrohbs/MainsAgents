// Post-install check of the executor the INSTALLED app uses: loads codex-bridge.mjs from the installed app.asar, starts it on
// the app's real Codex runtime home and asks GET /api/codex/executor?refresh=1 (one sandboxed command/exec; no thread, no
// model turn, no tokens). Run only with the app CLOSED (it shares the runtime home). Prints state, timing and isolation only.
//   npx electron scripts/test-installed-executor.mjs [path\to\resources\app.asar]
import {app} from 'electron';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const asar=resolve(process.argv.find(arg=>arg.endsWith('app.asar'))??join(process.env.LOCALAPPDATA,'Programs','MainsAgents','resources','app.asar'));
const work=mkdtempSync(join(tmpdir(),'mains-installed-executor-'));app.setPath('userData',join(work,'electron'));
app.whenReady().then(async()=>{let bridge,code=1;try{
 const {startCodexBridge}=await import(pathToFileURL(join(asar,'codex-bridge.mjs')).href);
 bridge=await startCodexBridge({port:0,cwd:work,imagesDirectory:join(work,'images')});
 const ask=async refresh=>{const started=Date.now(),response=await fetch(`http://127.0.0.1:${bridge.port}/api/codex/executor${refresh?'?refresh=1':''}`,{headers:{'x-mainsagents-bridge-token':bridge.token}});const body=await response.json();return {status:response.status,seconds:Number(((Date.now()-started)/1000).toFixed(1)),state:body.state,ready:body.ready,summary:body.diagnosis?.summary,desktopIsolation:body.desktopIsolation};};
 // The first probe after a fresh app-server may wait for sandbox provisioning ("slow" is not a failure): retry a few times.
 const attempts=[];for(let i=0;i<4;i++){const result=await ask(i===0);attempts.push(result);if(result.state!=='slow')break;}
 const last=attempts.at(-1);console.log(`${last.ready?'INSTALLED_EXECUTOR_READY':'INSTALLED_EXECUTOR_NOT_READY'}${JSON.stringify({asar,attempts})}`);
 code=last.ready?0:1;
}catch(error){console.error(error);}finally{await bridge?.close().catch(()=>{});app.exit(code);}});
