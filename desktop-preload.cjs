const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mainsAgentsDesktop', {
  canvasBrowser: true,
  state: {
    profile: ipcRenderer.sendSync('state:profile'),
    hasProfile: profile => ipcRenderer.invoke('state:hasProfile', profile),
    initialize: (profile, values) => ipcRenderer.invoke('state:initialize', profile, values),
    read: (profile, key) => ipcRenderer.invoke('state:read', profile, key),
    write: (profile, key, value) => ipcRenderer.invoke('state:write', profile, key, value),
    readAll: profile => ipcRenderer.invoke('state:readAll', profile),
    replaceAll: (profile, values) => ipcRenderer.invoke('state:replaceAll', profile, values),
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
