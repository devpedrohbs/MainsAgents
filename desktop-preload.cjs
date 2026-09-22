const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mainsAgentsDesktop', {
  selectSkillDirectory: () => ipcRenderer.invoke('skills:select-directory'),
  installSkill: (source) => ipcRenderer.invoke('skills:install', source),
});
