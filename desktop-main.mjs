import {createZernioPublicationConnector} from './zernio-publication-connector.mjs';
import { setDesktopDiagnosticWriter } from './desktop-diagnostics.mjs';
import { app, BrowserWindow, dialog, ipcMain, safeStorage, session, shell, Notification } from 'electron';
import { attachCanvasBrowserPolicy } from './canvas-browser-security.mjs';
import { desktopStorageDirectory, openDesktopWorkspaceStore } from './desktop-storage-location.mjs';
import { findSkills } from './skill-discovery.mjs';
import { parseSkillInstallCommand, skillInstallArgs } from './skill-install-command.mjs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize, isAbsolute } from 'node:path';
import { startCodexBridge } from './codex-bridge.mjs';
import { createChatImageArtifacts } from './chat-image-artifacts.mjs';
import { createExternalProviderBridge } from './external-providers.mjs';
import { createClaudeCodeBridge } from './claude-code-bridge.mjs';
import { createCanvasRuntimeBridge } from './canvas-runtime-bridge.mjs';
import { createAccountServer } from './cloud-server.mjs';
import { openDesktopEditorialBridge } from './desktop-editorial-storage.mjs';
import { createNotionEditorialConnector } from './notion-editorial-connector.mjs';
import {createPublicationConnector} from './publication-connector.mjs';
import {createCalendarConnector} from './publication-calendar-connector.mjs';
import {createZernioCalendarApi} from './publication-calendar-api.mjs';
import {inspectBackupFileLinks} from './backup-file-links.mjs';
import {registerEditorialFilesIpc} from './editorial-files-ipc.mjs';

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

let mainWindow;
let webServer;
let codexBridge;
let accountServer;
let contentWorkflowBridge;
let shuttingDown = false;
const appToken=randomBytes(32).toString('hex');
function authorized(request){const supplied=String(request.headers['x-mainsagents-app-token']??'');return supplied.length===appToken.length&&timingSafeEqual(Buffer.from(supplied),Buffer.from(appToken));}

function logStartup(message) {
  try {
    const directory=desktopStorageDirectory(app.getPath('home'));
    mkdirSync(directory, { recursive: true });
    appendFileSync(join(directory, 'startup.log'), `${new Date().toISOString()} ${message}\n`);
  } catch {}
}
setDesktopDiagnosticWriter(logStartup);

function openExternalLink(url) {
  if (!/^https:\/\//i.test(url)) return;
  void shell.openExternal(url).catch((error) => {
    logStartup(`Could not open external browser: ${error instanceof Error ? error.message : String(error)}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      void dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'MainsAgents',
        message: 'Não foi possível abrir o navegador externo. / Could not open the external browser.',
        detail: 'Verifique o navegador padrão do Windows e tente novamente. / Check your default Windows browser and try again.',
      }).catch((dialogError) => logStartup(`Browser error dialog failed: ${String(dialogError)}`));
    }
  });
}

const accountConfigPath=()=>join(app.getPath('userData'),'account.json');
function googleClientId(){if(process.env.MAINSAGENTS_GOOGLE_CLIENT_ID)return process.env.MAINSAGENTS_GOOGLE_CLIENT_ID;try{return String(JSON.parse(readFileSync(join(app.getAppPath(),'desktop-config.json'),'utf8')).googleClientId??'')}catch{return ''}}
function readAccountConfig(){try{return JSON.parse(readFileSync(accountConfigPath(),'utf8'))}catch{return {serverUrl:'',encryptedToken:'',email:'',userId:''}}}
function writeAccountConfig(config){mkdirSync(app.getPath('userData'),{recursive:true});writeFileSync(accountConfigPath(),JSON.stringify(config),{mode:0o600})}
function accountToken(config){if(!config.encryptedToken)return '';if(!safeStorage.isEncryptionAvailable())throw new Error('Secure credential storage is unavailable');return safeStorage.decryptString(Buffer.from(config.encryptedToken,'base64'))}
const providerKeysPath=()=>join(app.getPath('userData'),'provider-keys.json');
function readProviderKeys(){try{return JSON.parse(readFileSync(providerKeysPath(),'utf8'))}catch{return {}}}
function writeProviderKeys(keys){mkdirSync(app.getPath('userData'),{recursive:true});writeFileSync(providerKeysPath(),JSON.stringify(keys),{mode:0o600})}
function getProviderKey(provider){const encrypted=readProviderKeys()[provider];if(!encrypted)return '';if(!safeStorage.isEncryptionAvailable())throw new Error('Secure credential storage is unavailable');return safeStorage.decryptString(Buffer.from(encrypted,'base64'))}
const externalProviders=createExternalProviderBridge({getKey:getProviderKey});
const claudeCodeBridge=createClaudeCodeBridge({cwdRoot:join(app.getPath('documents'),'MainsAgents Workspace','Claude')});
const canvasRuntimeBridge=createCanvasRuntimeBridge({cwdRoot:join(app.getPath('documents'),'MainsAgents Workspace','Canvas')});
ipcMain.handle('provider:save-key',(event,provider,key)=>{assertTrustedSender(event);if(provider!=='gemini'||typeof key!=='string'||key.length<12||key.length>512)throw new Error('Invalid provider key');if(!safeStorage.isEncryptionAvailable())throw new Error('Secure credential storage is unavailable');writeProviderKeys({...readProviderKeys(),[provider]:safeStorage.encryptString(key).toString('base64')});return {saved:true}});
ipcMain.handle('provider:remove-key',(event,provider)=>{assertTrustedSender(event);if(provider!=='gemini')throw new Error('Unknown provider');const keys=readProviderKeys();delete keys[provider];writeProviderKeys(keys);return {saved:false}});
for(const action of ['status','save','remove'])ipcMain.handle(`calendar:key:${action}`,(event,profile,key)=>{
 assertTrustedSender(event);if(!desktopStateStore||profile!==desktopStateStore.currentProfile())throw Error('Active profile changed.');
 if(!contentWorkflowBridge)throw Error('Calendar storage is unavailable.');
 return contentWorkflowBridge.calendarCredentials[action](profile,key);
});
function saveAccountToken(config,rawToken,email,userId){if(!safeStorage.isEncryptionAvailable())throw new Error('Secure credential storage is unavailable');writeAccountConfig({...config,encryptedToken:safeStorage.encryptString(rawToken).toString('base64'),email,userId});desktopStateStore?.selectProfile(userId)}
async function accountRequest(path,method='GET',data,authenticated=true){const config=readAccountConfig();if(!config.serverUrl)throw new Error('Configure the account service first');const raw=authenticated?accountToken(config):'';if(authenticated&&!raw)throw new Error('Sign in to MainsAgents first');const response=await fetch(`${config.serverUrl}${path}`,{method,redirect:'error',headers:{'content-type':'application/json',...(raw?{authorization:`Bearer ${raw}`}:{})},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(30000)});const result=await response.json().catch(()=>({error:'Invalid account service response'}));if(!response.ok)throw new Error(result.error??`Account service returned ${response.status}`);return result}

async function signInWithGoogle(){
  const clientId=googleClientId();
  if(!clientId)throw new Error('Google sign-in needs to be configured by the app developer.');
  const verifier=randomBytes(48).toString('base64url');
  const challenge=createHash('sha256').update(verifier).digest('base64url');
  const state=randomBytes(24).toString('base64url');
  const nonce=randomBytes(24).toString('base64url');
  let callbackServer;
  let redirectUri;
  let timeout;
  try{
    const authResult=await new Promise((resolve,reject)=>{
      callbackServer=createServer((request,response)=>{
        const callbackUrl=new URL(request.url??'/', 'http://127.0.0.1');
        if(callbackUrl.pathname!=='/oauth2/callback'){response.writeHead(404);response.end();return}
        if(callbackUrl.searchParams.get('state')!==state){response.writeHead(400,{'content-type':'text/plain; charset=utf-8'});response.end('Sign-in request did not match. Return to MainsAgents and try again.');reject(new Error('Google sign-in state validation failed'));return}
        const oauthError=callbackUrl.searchParams.get('error');
        const code=callbackUrl.searchParams.get('code');
        response.writeHead(oauthError?400:200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
        response.end(`<html><meta charset="utf-8"><title>MainsAgents</title><body style="font:16px system-ui;max-width:520px;margin:15vh auto;padding:24px;color:#181818"><h1>${oauthError?'Sign-in cancelled':'You can return to MainsAgents'}</h1><p>${oauthError?'Google sign-in was cancelled.':'Your Google account was verified. This browser window can be closed.'}</p></body></html>`);
        if(oauthError)reject(new Error('Google sign-in was cancelled.'));
        else if(code)resolve({code,redirectUri});
        else reject(new Error('Google did not return an authorization code.'));
      });
      callbackServer.once('error',reject);
      callbackServer.listen(0,'127.0.0.1',()=>{
        const address=callbackServer.address();
        if(!address||typeof address==='string'){reject(new Error('Could not open the Google sign-in callback.'));return}
        redirectUri=`http://127.0.0.1:${address.port}/oauth2/callback`;
        const authorization=new URL('https://accounts.google.com/o/oauth2/v2/auth');
        authorization.searchParams.set('client_id',clientId);authorization.searchParams.set('redirect_uri',redirectUri);authorization.searchParams.set('response_type','code');authorization.searchParams.set('scope','openid email profile');authorization.searchParams.set('state',state);authorization.searchParams.set('nonce',nonce);authorization.searchParams.set('code_challenge',challenge);authorization.searchParams.set('code_challenge_method','S256');authorization.searchParams.set('prompt','select_account');
        timeout=setTimeout(()=>reject(new Error('Google sign-in timed out. Please try again.')),5*60_000);
        void shell.openExternal(authorization.toString()).catch(reject);
      });
    });
    const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,code:authResult.code,code_verifier:verifier,grant_type:'authorization_code',redirect_uri:authResult.redirectUri}),signal:AbortSignal.timeout(15000)});
    const tokenData=await tokenResponse.json();
    if(!tokenResponse.ok||typeof tokenData.id_token!=='string')throw new Error('Google could not complete sign-in. Please try again.');
    const result=await accountRequest('/api/auth/google','POST',{idToken:tokenData.id_token,nonce},false);
    saveAccountToken(readAccountConfig(),result.token,result.email,result.userId);
    return {email:result.email,userId:result.userId,recoveryCode:result.recoveryCode};
  }catch(error){
    if(error instanceof Error)throw error;
    throw new Error(String(error));
  } finally {
    if(timeout)clearTimeout(timeout);
    if(callbackServer?.listening)callbackServer.close();
  }
}

ipcMain.handle('account:status',async(event)=>{assertTrustedSender(event);const config=readAccountConfig();if(!config.serverUrl)return {configured:false,signedIn:false};if(!config.encryptedToken)return {configured:true,signedIn:false,serverUrl:config.serverUrl};try{const account=await accountRequest('/api/auth/me');return {configured:true,signedIn:true,serverUrl:config.serverUrl,email:account.email,userId:account.userId}}catch(error){return {configured:true,signedIn:false,serverUrl:config.serverUrl,error:error.message}}});
ipcMain.handle('account:google-configured',(event)=>{assertTrustedSender(event);return Boolean(googleClientId())});
ipcMain.handle('account:google-sign-in',async(event)=>{assertTrustedSender(event);return signInWithGoogle()});
ipcMain.handle('account:register',async(event,email,password)=>{assertTrustedSender(event);const result=await accountRequest('/api/auth/register','POST',{email,password},false);saveAccountToken(readAccountConfig(),result.token,result.email,result.userId);return {email:result.email,userId:result.userId,recoveryCode:result.recoveryCode}});
ipcMain.handle('account:login',async(event,email,password)=>{assertTrustedSender(event);const result=await accountRequest('/api/auth/login','POST',{email,password},false);saveAccountToken(readAccountConfig(),result.token,result.email,result.userId);return {email:result.email,userId:result.userId}});
ipcMain.handle('account:recover',async(event,email,recoveryCode,newPassword)=>{assertTrustedSender(event);const result=await accountRequest('/api/auth/recover','POST',{email,recoveryCode,newPassword},false);saveAccountToken(readAccountConfig(),result.token,result.email,result.userId);return {email:result.email,userId:result.userId,recoveryCode:result.recoveryCode}});
ipcMain.handle('account:logout',async(event)=>{assertTrustedSender(event);try{await accountRequest('/api/auth/logout','POST')}finally{writeAccountConfig({...readAccountConfig(),encryptedToken:'',email:'',userId:''});desktopStateStore?.selectProfile('default')}return {signedIn:false}});
ipcMain.handle('account:delete-account',async(event,password)=>{assertTrustedSender(event);const result=await accountRequest('/api/auth/account','DELETE',{password});writeAccountConfig({...readAccountConfig(),encryptedToken:'',email:'',userId:''});desktopStateStore?.selectProfile('default');return result});

function installSkill(selection, cwd) {
  let executable = 'npx';
  let args = skillInstallArgs(selection);
  if (process.platform === 'win32') {
    const npxCommand = execFileSync('where.exe', ['npx.cmd'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).find(Boolean);
    if (!npxCommand) throw new Error('npx was not found. Install Node.js before installing skills.');
    const nodeDirectory = dirname(npxCommand.trim());
    executable = join(nodeDirectory, 'node.exe');
    args = [join(nodeDirectory, 'node_modules', 'npm', 'bin', 'npx-cli.js'), ...skillInstallArgs(selection)];
  }
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true, shell: false });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Skill installation timed out.')); }, 120000);
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(output) : reject(new Error(output.trim() || `Skill installer exited with code ${code}`));
    });
  });
}

function assertTrustedSender(event){if(event.sender!==mainWindow?.webContents)throw new Error('Untrusted application window');}

ipcMain.handle('skills:select-directory', async (event) => {
  assertTrustedSender(event);
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Select skills folder', properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths[0]) return null;
  const directory = result.filePaths[0];
  return { directory, skills: findSkills(directory) };
});

ipcMain.handle('skills:refresh-directory', (event, directory) => {
  assertTrustedSender(event);
  if(typeof directory!=='string'||!isAbsolute(directory)||!existsSync(directory)||!statSync(directory).isDirectory())throw new Error('The skills folder is unavailable. Choose an existing folder.');
  return {directory,skills:findSkills(directory)};
});

ipcMain.handle('skills:install', async (event, value, agentKey, selectedDirectory) => {
  assertTrustedSender(event);
  const selection=parseSkillInstallCommand(value);
  const rawAgentKey=String(agentKey??'agent');
  const agentDirectory=rawAgentKey.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)||'agent';
  if(selectedDirectory && (typeof selectedDirectory!=='string'||!isAbsolute(selectedDirectory)||!existsSync(selectedDirectory)||!statSync(selectedDirectory).isDirectory()))throw new Error('The skills folder is unavailable. Choose an existing folder.');
  const projectDirectory = selectedDirectory || join(app.getPath('documents'), 'MainsAgents Skills',agentDirectory);
  mkdirSync(projectDirectory, { recursive: true });
  await installSkill(selection, projectDirectory);
  const directory = projectDirectory;
  return { directory, skills: findSkills(directory) };
});

function proxyToCodex(clientRequest, clientResponse, bridge) {
  const proxy = httpRequest({
    hostname: '127.0.0.1',
    port:bridge.port,
    path: clientRequest.url,
    method: clientRequest.method,
    headers: { ...clientRequest.headers, 'x-mainsagents-bridge-token':bridge.token },
  }, (response) => {
    clientResponse.writeHead(response.statusCode ?? 502, response.headers);
    response.pipe(clientResponse);
  });
  proxy.on('error', (error) => {
    if (!clientResponse.headersSent) clientResponse.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    clientResponse.end(JSON.stringify({ error: `Codex bridge unavailable: ${error.message}` }));
  });
  clientRequest.pipe(proxy);
}

function startWebServer(rootDirectory, port = 47831) {
  const images=createChatImageArtifacts(join(desktopStorageDirectory(app.getPath('home')),'images'));
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if(url.pathname.startsWith('/api/')&&!authorized(request)){response.writeHead(403,{'content-type':'application/json','cache-control':'no-store'});return response.end(JSON.stringify({error:'Local application access denied'}));}
    if(images.handle(request,response,url))return;
    if (url.pathname === '/api/app/version') {response.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});return response.end(JSON.stringify({version:app.getVersion()}));}
    if (url.pathname.startsWith('/api/content/')) {
      if(url.searchParams.get('profile')!==desktopStateStore.currentProfile()){response.writeHead(409,{'content-type':'application/json'});return response.end(JSON.stringify({error:'The active storage profile changed. Reopen the workspace before editing.'}));}
      const address=webServer?.address();
      const expected=address&&typeof address==='object'?`http://127.0.0.1:${address.port}`:'';
      const origin=String(request.headers.origin??'');
      if(request.method!=='GET'&&origin!==expected){response.writeHead(403,{'content-type':'application/json'});return response.end(JSON.stringify({error:'Editorial changes must come from MainsAgents.'}));}
      return void contentWorkflowBridge.handle(request,response,url);
    }
    if (url.pathname === '/api/codex/reconnect' && request.method === 'POST') {
      if (codexBridge?.isAlive()) {response.writeHead(200,{'content-type':'application/json'});return response.end(JSON.stringify({ready:true}));}
      const workspaceDirectory=join(app.getPath('documents'),'MainsAgents Workspace');
      void (async()=>{if(codexBridge){await codexBridge.close();codexBridge=null}return startCodexBridge({port:0,cwd:workspaceDirectory,runtimeHome:join(app.getPath('userData'),'codex-runtime'),actions:contentWorkflowBridge.actions,getBinding:contentWorkflowBridge.binding,getAgents:contentWorkflowBridge.agents,delegations:contentWorkflowBridge.delegations})})().then((bridge)=>{codexBridge=bridge;response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({ready:true}))}).catch((error)=>{response.writeHead(503,{'content-type':'application/json'});response.end(JSON.stringify({ready:false,error:error instanceof Error?error.message:String(error)}))});return;
    }
    if (url.pathname.startsWith('/api/codex/')) {
      if (codexBridge) return proxyToCodex(request,response,codexBridge);
      response.writeHead(503,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
      return response.end(JSON.stringify({ready:false,status:'not-installed',error:'Codex is unavailable. Install and sign in to Codex, then reconnect.'}));
    }
    if(url.pathname.startsWith('/api/canvas/')){
      const address=webServer?.address();
      const appOrigin=address&&typeof address==='object'?`http://127.0.0.1:${address.port}`:'';
      const requestOrigin=String(request.headers.origin??'');
      if((request.method==='POST'&&!requestOrigin)||(requestOrigin&&requestOrigin!==appOrigin)){response.writeHead(403,{'content-type':'application/json','cache-control':'no-store'});return response.end(JSON.stringify({error:'Canvas terminal requests must come from MainsAgents.'}));}
      return void canvasRuntimeBridge.handle(request,response,url);
    }
    if(url.pathname==='/api/providers/claude/diagnostics')return void claudeCodeBridge.diagnostics().then(data=>{response.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify(data));});
    if(url.pathname.startsWith('/api/providers/claude/'))return void claudeCodeBridge.handle(request,response,url);
    if(url.pathname.startsWith('/api/providers/'))return void externalProviders.handle(request,response,url);

    const requestedPath = url.pathname === '/' ? '/app.html' : decodeURIComponent(url.pathname);
    const normalizedPath = normalize(requestedPath).replace(/^([/\\])+/, '');
    let filePath = join(rootDirectory, normalizedPath);
    if (!filePath.startsWith(rootDirectory) || !existsSync(filePath) || statSync(filePath).isDirectory()) filePath = join(rootDirectory, 'app.html');

    if (filePath.endsWith('.html')) {
      const html=readFileSync(filePath,'utf8').replace('<head>','<head><meta name="mainsagents-storage" content="desktop-sqlite">');
      response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
      response.end(html); return;
    }
    response.writeHead(200, {
      'content-type': mimeTypes[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': filePath.endsWith('.html') ? 'no-store' : 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    });
    createReadStream(filePath).on('error', () => response.end()).pipe(response);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      resolve({ server, port: typeof address === 'object' && address ? address.port : 0 });
    });
  });
}

let desktopStateStore;
registerEditorialFilesIpc({ipcMain,dialog,shell,getWindow:()=>mainWindow,getStore:()=>desktopStateStore});
ipcMain.on('state:profile', event => {
  event.returnValue=event.sender===mainWindow?.webContents ? desktopStateStore?.currentProfile() : undefined;
});
ipcMain.handle('state:getProfile', event => {
  assertTrustedSender(event);
  if (!desktopStateStore) throw new Error('Local storage is not ready');
  return desktopStateStore.currentProfile() ?? 'default';
});
ipcMain.on('state:writeSync', (event, profile, key, value, revision) => {
  try {
    assertTrustedSender(event);
    if (!desktopStateStore || shuttingDown) throw new Error('Local storage is not ready');
    if(profile!==desktopStateStore.currentProfile()) throw new Error('The active profile changed. Reopen the workspace before saving.');
    const receipt=desktopStateStore.write(profile, key, value, revision);
    event.returnValue = { saved: true, ...receipt };
  } catch (error) {
    event.returnValue = { saved: false, error: error instanceof Error ? error.message : String(error) };
  }
});
ipcMain.handle('inbox:notify',(event,title,body)=>{assertTrustedSender(event);if(event.senderFrame!==event.sender.mainFrame)throw new Error('Untrusted notification frame');if(typeof title!=='string'||typeof body!=='string'||title.length>160||body.length>500)throw new Error('Invalid notification');const preferences=desktopStateStore?.read(desktopStateStore.currentProfile(),'chat-inbox');if(preferences?.muted!==false||!Notification.isSupported())return false;const notification=new Notification({title,body});notification.on('click',()=>{mainWindow?.show();mainWindow?.focus();});notification.show();return true;});
ipcMain.handle('state:checkpoint',event=>{assertTrustedSender(event);return desktopStateStore.recoverySnapshot();});
ipcMain.handle('backup:snapshot',(event)=>{assertTrustedSender(event);return desktopStateStore.workspaceSnapshot(desktopStateStore.currentProfile());});
ipcMain.handle('backup:files',(event,paths)=>{assertTrustedSender(event);return inspectBackupFileLinks(paths);});
ipcMain.handle('backup:restore',(event,values,editorial,expected,execution)=>{
  assertTrustedSender(event);
  desktopStateStore.recoverySnapshot();
  return desktopStateStore.restoreWorkspace(desktopStateStore.currentProfile(),values,editorial,expected,execution);
});
for (const operation of ['hasProfile','initialize','read','write','readAll','readAllVersioned','replaceAll']) {
  ipcMain.handle(`state:${operation}`, (event, ...args) => {
    assertTrustedSender(event);
    if (!desktopStateStore) throw new Error('Local storage is not ready');
    if(['write','replaceAll'].includes(operation)&&args[0]!==desktopStateStore.currentProfile()) throw new Error('The active profile changed. Reopen the workspace before saving.');
    return desktopStateStore[operation](...args);
  });
}

async function createWindow() {
  logStartup('Starting desktop services');
  desktopStateStore=await openDesktopWorkspaceStore(app.getPath('home'),app.getPath('userData'),app.getVersion());
  logStartup(`Storage profile=${desktopStateStore.currentProfile()??'default'}; version=${app.getVersion()}; data=${desktopStorageDirectory(app.getPath('home'))}`);
  contentWorkflowBridge=openDesktopEditorialBridge(app.getPath('home'),app.getPath('userData'),{
    getRuntime:()=>codexBridge?.isAlive()?codexBridge.workflow:null,
    getChatRuntime:provider=>provider==='claude'?claudeCodeBridge.runtime:codexBridge?.isAlive()?codexBridge.chatRuntime:null,
    getAgents:profile=>desktopStateStore.read(profile,'agents')??[],
    getFlows:profile=>desktopStateStore.read(profile,'production-flows'),
    getSessions:profile=>desktopStateStore.read(profile,'sessions')??[],
    getCurrentProfile:()=>desktopStateStore.currentProfile(),
    getConnector:()=>codexBridge?.isAlive()?createNotionEditorialConnector(()=>codexBridge.notionMcp):null,
    getPublicationConnector:(provider,profile)=>provider==='zernio'?contentWorkflowBridge?.calendarCredentials.status(profile).configured?createZernioPublicationConnector(()=>contentWorkflowBridge.calendarCredentials.key(profile)):null:codexBridge?.isAlive()?createPublicationConnector(()=>codexBridge.publicationMcp):null,
    secureStorage:safeStorage,
    getCalendarConnector:(provider,profile)=>provider==='zernio'&&contentWorkflowBridge?.calendarCredentials.status(profile).configured?createZernioCalendarApi(()=>contentWorkflowBridge.calendarCredentials.key(profile)):codexBridge?.isAlive()?createCalendarConnector(()=>codexBridge.publicationMcp,provider):null,
    suggestConnection:(profile,workspaceId)=>{
      const agents=desktopStateStore.read(profile,'agents')??[];
      for(const agent of agents.filter(item=>item.workspaceId===workspaceId)){
        for(const [name,path] of Object.entries(agent.skillFiles??{})){
          if(!agent.skills?.includes(name)||agent.disabledSkills?.includes(name)||typeof path!=='string'||!path.endsWith('.md')||!existsSync(path)||statSync(path).size>1_000_000)continue;
          const source=readFileSync(path,'utf8');
          const match=source.match(/collection:\/\/([a-f0-9-]{36})/i);
          if(match)return match[1];
        }
      }
      return '';
    },
  });
  accountServer=createAccountServer({dbPath:join(app.getPath('userData'),'accounts.sqlite'),host:'127.0.0.1',port:0,googleClientId:googleClientId()});
  const accountAddress=await accountServer.listen();
  writeAccountConfig({...readAccountConfig(),serverUrl:`http://127.0.0.1:${accountAddress.port}`});
  logStartup('Local account service ready');
  const workspaceDirectory = join(app.getPath('documents'), 'MainsAgents Workspace');
  mkdirSync(workspaceDirectory, { recursive: true });
  try {codexBridge = await startCodexBridge({ port: 0, cwd: workspaceDirectory, runtimeHome: join(app.getPath('userData'),'codex-runtime'),actions:contentWorkflowBridge.actions,getBinding:contentWorkflowBridge.binding,getAgents:contentWorkflowBridge.agents,delegations:contentWorkflowBridge.delegations });logStartup(`Codex bridge ready on ${codexBridge.port}; history isolated, connections shared`);}
  catch(error){logStartup(`Codex unavailable: ${error instanceof Error?error.message:String(error)}`);}
  contentWorkflowBridge.jobs.kick();
  contentWorkflowBridge.work.kick();
  const web = await startWebServer(join(app.getAppPath(), 'dist'));
  webServer = web.server;
  logStartup(`Web application ready on ${web.port}`);

  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#0a0a0a',
    icon: join(app.getAppPath(), 'dist', 'images', 'brand', 'mainsagents-icon-black.ico'),
    show: false,
    title: 'MainsAgents',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      preload: join(app.getAppPath(), 'desktop-preload.cjs'),
    },
  });
  session.defaultSession.webRequest.onBeforeSendHeaders({urls:[`http://127.0.0.1:${web.port}/*`]},(details,callback)=>{
    if(details.webContentsId===mainWindow?.webContents.id)details.requestHeaders['x-mainsagents-app-token']=appToken;
    callback({requestHeaders:details.requestHeaders});
  });

  const appOrigin=`http://127.0.0.1:${web.port}`;
  attachCanvasBrowserPolicy(mainWindow.webContents, appOrigin, openExternalLink);
  mainWindow.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==appOrigin){event.preventDefault();openExternalLink(url)}});
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalLink(url);
    return { action: 'deny' };
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.on('preload-error',(_event,_path,error)=>logStartup(`Preload failed: ${error.message}`));
  let allowedToClose=false, preparingClose=false;
  mainWindow.on('close',event=>{
    if(allowedToClose)return;
    event.preventDefault(); if(preparingClose)return; preparingClose=true;
    void (async()=>{
      const window=mainWindow;
      try {
        const result=await window.webContents.executeJavaScript('(async()=>{if(!window.mainsAgentsSaveNow)return "not-ready";await window.mainsAgentsSaveNow();return "saved"})()');
        desktopStateStore.recoverySnapshot();
        logStartup(`Close storage verification: ${result}`);
        allowedToClose=true; window.close();
      } catch(error) {
        logStartup(`Close blocked: ${error.message}`);
        await dialog.showMessageBox(window,{type:'warning',title:'MainsAgents',message:'Não foi possível confirmar o salvamento. O app continuará aberto para preservar suas alterações.',detail:'Use Salvar agora ou exporte um backup nas Configurações antes de sair.',buttons:['Continuar no app']});
      } finally {preparingClose=false;}
    })();
  });
  await session.defaultSession.clearCache();
  await mainWindow.loadURL(`http://127.0.0.1:${web.port}/app.html?desktopVersion=${encodeURIComponent(app.getVersion())}#home`);
  const renderer=await mainWindow.webContents.executeJavaScript('({nativeStorage:!!window.mainsAgentsDesktop?.state,version:document.querySelector("meta[name=mainsagents-storage]")?.content})');
  logStartup(`Renderer storage: ${JSON.stringify(renderer)}`);
  logStartup('Main window loaded');
}

async function closeServices() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (webServer) await new Promise((resolve) => webServer.close(resolve));
  if (contentWorkflowBridge) await contentWorkflowBridge.close();
  if (codexBridge) await codexBridge.close();
  if (accountServer) await accountServer.close();
  if (desktopStateStore) desktopStateStore.close();
}

const lock = app.requestSingleInstanceLock();
logStartup(`Application launched; single-instance lock=${lock}`);
if (!lock) app.quit();
else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(createWindow).catch((error) => {
    logStartup(`Startup failed: ${error?.stack ?? error}`);
    console.error(error);
    app.quit();
  });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (shuttingDown) return;
    event.preventDefault();
    if(mainWindow&&!mainWindow.isDestroyed()){mainWindow.close();return;}
    void closeServices().finally(() => app.quit());
  });
}
