const { contextBridge, ipcRenderer, webUtils } = require('electron');
const revisions = new Map();
const revisionKey = (profile,key) => JSON.stringify([profile,key]);

contextBridge.exposeInMainWorld('mainsAgentsDesktop', {
  canvasBrowser: true,
  notify: (title,body) => ipcRenderer.invoke('inbox:notify',title,body),
  files: {
    pathForFile: file => webUtils.getPathForFile(file),
    selectVideos: () => ipcRenderer.invoke('files:select-videos'),
    select: (profile,contentId,multiple=true) => ipcRenderer.invoke('files:select',profile,contentId,multiple),
    inspect: (profile,contentId,paths) => ipcRenderer.invoke('files:inspect',profile,contentId,paths),
    verify: (profile,contentId) => ipcRenderer.invoke('files:verify',profile,contentId),
    reveal: (profile,contentId,assetId) => ipcRenderer.invoke('files:reveal',profile,contentId,assetId),
    open: (profile,contentId,assetId) => ipcRenderer.invoke('files:open',profile,contentId,assetId),
    preview: (profile,contentId,assetId) => ipcRenderer.invoke('files:preview',profile,contentId,assetId),
  },
  // Host delivery receipts: only an id goes to the host, which re-verifies the file before acting.
  receipts: {
    check: (profile,id) => ipcRenderer.invoke('receipts:check',profile,id),
    open: (profile,id) => ipcRenderer.invoke('receipts:open',profile,id),
    reveal: (profile,id) => ipcRenderer.invoke('receipts:reveal',profile,id),
  },
  // Local deletion of a whole content (or one chat). The host rewrites linked keys in the same transaction; their new
  // revisions replace the CAS revisions kept here, so the next save continues from the committed data.
  content: {
    deletePreview: (profile,input) => ipcRenderer.invoke('content:deletePreview',profile,input),
    deleteContent: async (profile,input) => {
      const result=await ipcRenderer.invoke('content:delete',profile,input);
      if(result?.ok)for(const [key,change] of Object.entries(result.state??{}))if(change?.revision)revisions.set(revisionKey(profile,key),change.revision);
      return result;
    },
    deleteSession: async (profile,input) => {
      const result=await ipcRenderer.invoke('content:deleteSession',profile,input);
      if(result?.ok)for(const [key,change] of Object.entries(result.state??{}))if(change?.revision)revisions.set(revisionKey(profile,key),change.revision);
      return result;
    },
  },
  backup: {
    inspectFiles: paths => ipcRenderer.invoke('backup:files',paths),
    snapshot: () => ipcRenderer.invoke('backup:snapshot'),
    restore: async (values,editorial,expected,execution) => {const result=await ipcRenderer.invoke('backup:restore',values,editorial,expected,execution);revisions.clear();return result;},
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
  selectOutputDirectory:()=>ipcRenderer.invoke('file-access:select-directory'),
  installSkill: (command, agentKey, directory) => ipcRenderer.invoke('skills:install', command, agentKey, directory),
  refreshSkillDirectory: directory => ipcRenderer.invoke('skills:refresh-directory', directory),
  saveProviderKey: (provider,key) => ipcRenderer.invoke('provider:save-key',provider,key),
  removeProviderKey: (provider) => ipcRenderer.invoke('provider:remove-key',provider),
  calendarKey: {
    status: (profile) => ipcRenderer.invoke('calendar:key:status',profile),
    save: (profile,key) => ipcRenderer.invoke('calendar:key:save',profile,key),
    remove: (profile) => ipcRenderer.invoke('calendar:key:remove',profile),
  },
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
