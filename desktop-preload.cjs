const { contextBridge, ipcRenderer, webUtils } = require('electron');
const revisions = new Map();
const revisionKey = (profile,key) => JSON.stringify([profile,key]);

contextBridge.exposeInMainWorld('mainsAgentsDesktop', {
  canvasBrowser: true,
  notify: (title,body) => ipcRenderer.invoke('inbox:notify',title,body),
  files: {
    pathForFile: file => webUtils.getPathForFile(file),
    select: (profile,contentId,multiple=true) => ipcRenderer.invoke('files:select',profile,contentId,multiple),
    inspect: (profile,contentId,paths) => ipcRenderer.invoke('files:inspect',profile,contentId,paths),
    verify: (profile,contentId) => ipcRenderer.invoke('files:verify',profile,contentId),
    reveal: (profile,contentId,assetId) => ipcRenderer.invoke('files:reveal',profile,contentId,assetId),
    open: (profile,contentId,assetId) => ipcRenderer.invoke('files:open',profile,contentId,assetId),
  },
  backup: {
    inspectFiles: paths => ipcRenderer.invoke('backup:files',paths),
    snapshot: () => ipcRenderer.invoke('backup:snapshot'),
    restore: async (values,editorial,expected,execution) => {await ipcRenderer.invoke('backup:restore',values,editorial,expected,execution);revisions.clear();},
  },
  state: {
    getProfile: () => ipcRenderer.invoke('state:getProfile'),
    hasProfile: profile => ipcRenderer.invoke('state:hasProfile', profile),
    initialize: (profile, values) => ipcRenderer.invoke('state:initialize', profile, values),
    read: (profile, key) => ipcRenderer.invoke('state:read', profile, key),
    write: async (profile, key, value) => {
      const result=await ipcRenderer.invoke('state:write',profile,key,value,revisions.get(revisionKey(profile,key))??null);
      revisions.set(revisionKey(profile,key),result.revision);
    },
    writeSync: (profile, key, value) => {
      const result = ipcRenderer.sendSync('state:writeSync', profile, key, value, revisions.get(revisionKey(profile,key))??null);
      if (!result?.saved) throw new Error(result?.error || 'Local save was not acknowledged');
      revisions.set(revisionKey(profile,key),result.revision);
    },
    readAll: async profile => {
      const result=await ipcRenderer.invoke('state:readAllVersioned',profile);
      for(const [key,value] of Object.entries(result.revisions))revisions.set(revisionKey(profile,key),value);
      return result.values;
    },
    replaceAll: async (profile, values) => { await ipcRenderer.invoke('state:replaceAll', profile, values); revisions.clear(); },
    saveCheckpoint: () => ipcRenderer.invoke('state:checkpoint'),
  },
  selectSkillDirectory: () => ipcRenderer.invoke('skills:select-directory'),
  installSkill: (command, agentKey, directory) => ipcRenderer.invoke('skills:install', command, agentKey, directory),
  refreshSkillDirectory: directory => ipcRenderer.invoke('skills:refresh-directory', directory),
  saveProviderKey: (provider,key) => ipcRenderer.invoke('provider:save-key',provider,key),
  removeProviderKey: (provider) => ipcRenderer.invoke('provider:remove-key',provider),
  account: {
    status: () => ipcRenderer.invoke('account:status'),
    googleConfigured: () => ipcRenderer.invoke('account:google-configured'),
    googleSignIn: () => ipcRenderer.invoke('account:google-sign-in'),
    register: (email, password) => ipcRenderer.invoke('account:register', email, password),
    login: (email, password) => ipcRenderer.invoke('account:login', email, password),
    recover: (email, recoveryCode, newPassword) => ipcRenderer.invoke('account:recover', email, recoveryCode, newPassword),
    logout: () => ipcRenderer.invoke('account:logout'),
    deleteAccount: (password) => ipcRenderer.invoke('account:delete-account', password),
  },
});
