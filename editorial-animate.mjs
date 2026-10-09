import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {getRemotionCapabilities,renderAnimatedVideo,resolveFfprobe} from './editorial-remotion.mjs';

/** Native binaries cannot be spawned from inside app.asar; Electron reports them there but they live in app.asar.unpacked. */
export const unpackedPath=path=>typeof path==='string'?path.replace(/([\\/])app\.asar([\\/])/,'$1app.asar.unpacked$2'):path;

/** Installed Chrome/Edge paths checked explicitly, so a packaged app never depends on its working directory or a hidden download. */
export function installedBrowsers(env=process.env,platform=process.platform){
  if(platform==='win32')return [
    join(env.ProgramFiles??'C:\\Program Files','Google','Chrome','Application','chrome.exe'),
    join(env['ProgramFiles(x86)']??'C:\\Program Files (x86)','Google','Chrome','Application','chrome.exe'),
    ...(env.LOCALAPPDATA?[join(env.LOCALAPPDATA,'Google','Chrome','Application','chrome.exe')]:[]),
    join(env['ProgramFiles(x86)']??'C:\\Program Files (x86)','Microsoft','Edge','Application','msedge.exe'),
    join(env.ProgramFiles??'C:\\Program Files','Microsoft','Edge','Application','msedge.exe'),
  ];
  if(platform==='darwin')return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'];
  return ['/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/microsoft-edge'];
}

export function resolveAnimationBrowser({browserExecutable,env=process.env,platform=process.platform,exists=existsSync}={}){
  if(browserExecutable)return exists(browserExecutable)?{path:browserExecutable,source:'explicit'}:{path:null,source:'explicit',reason:`Navegador indicado não existe: ${browserExecutable}`};
  if(env.MAINSAGENTS_BROWSER)return exists(env.MAINSAGENTS_BROWSER)?{path:env.MAINSAGENTS_BROWSER,source:'env'}:{path:null,source:'env',reason:`MAINSAGENTS_BROWSER não existe: ${env.MAINSAGENTS_BROWSER}`};
  const found=installedBrowsers(env,platform).find(item=>exists(item));
  return found?{path:found,source:'system'}:{path:null,source:'none',reason:'Nenhum Chrome ou Edge instalado foi encontrado. Instale um deles ou defina MAINSAGENTS_BROWSER; o app não baixa navegador sozinho.'};
}

/** Media options that plug the local Remotion overlay template into editorial-media. Never downloads a browser. */
export function createRemotionAnimator({browserExecutable,bundleDir,ffprobePath,render=renderAnimatedVideo,capabilities=getRemotionCapabilities,cacheMs=60000,resolveBrowser=resolveAnimationBrowser}={}){
  let cached,checkedAt=0,browser;
  const probe=ffprobePath??unpackedPath(resolveFfprobe());
  const options=()=>{browser??=resolveBrowser({browserExecutable});return {...(browser.path?{browserExecutable:browser.path}:{}),...(bundleDir?{bundleDir}:{}),...(probe&&probe!=='ffprobe'&&probe!=='ffprobe.exe'?{ffprobePath:probe}:{})};};
  return {
    async animationCapabilities(){
      if(cached&&Date.now()-checkedAt<cacheMs)return cached;
      const resolved=options();
      if(!browser.path){cached={available:false,reasons:[browser.reason],browser};checkedAt=Date.now();return cached;}
      const value=await capabilities(resolved);
      cached={available:value.available===true,reasons:value.reasons??[],browser:{path:browser.path,source:browser.source},bundle:value.bundle,license:value.license};checkedAt=Date.now();return cached;
    },
    async animate(input){
      const resolved=options();if(!browser.path)throw new Error(`Animation render unavailable: ${browser.reason}`);
      try{return await render({...input,...resolved});}
      catch(error){throw new Error(error?.code==='cancelled'?'Media operation canceled.':`Animation render failed${error?.code?` (${error.code})`:''}: ${error?.message??error}`);}
    },
  };
}
