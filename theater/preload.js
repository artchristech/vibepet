// theater preload: one call, the timeline for this window (main picks the file; the page can't ask for another)
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('theater', { timeline: () => ipcRenderer.invoke('theater-timeline') });
