const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('mainsAgentsDesktop',{state:{profile:'handoff-test',hasProfile:()=>Promise.resolve(true),read:(_profile,key)=>ipcRenderer.invoke('test:read',key),write:(_profile,key,value)=>ipcRenderer.invoke('test:write',key,value),readAll:()=>ipcRenderer.invoke('test:all')}});
