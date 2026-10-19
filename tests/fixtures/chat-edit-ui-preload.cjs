// Test preload for the chat-edit UI journey: real renderer, desktop state store through IPC, native video picker stub.
const {contextBridge,ipcRenderer,webUtils}=require('electron');
contextBridge.exposeInMainWorld('mainsAgentsDesktop',{
 files:{pathForFile:file=>webUtils.getPathForFile(file),selectVideos:()=>ipcRenderer.invoke('files:select-videos')},
 state:{profile:'handoff-test',hasProfile:()=>Promise.resolve(true),read:(_profile,key)=>ipcRenderer.invoke('test:read',key),write:(_profile,key,value)=>ipcRenderer.invoke('test:write',key,value),readAll:()=>ipcRenderer.invoke('test:all')},
});
