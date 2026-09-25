const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pet', {
  on: (ch, cb) => ipcRenderer.on(ch, (_, data) => cb(data)),
  setIgnore: v => ipcRenderer.send('set-ignore', v),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragEnd: () => ipcRenderer.send('drag-end'),
  menu: () => ipcRenderer.send('menu'),
  focus: () => ipcRenderer.send('focus'),
  copy: t => ipcRenderer.send('copy', t),
  rename: n => ipcRenderer.send('rename', n),
  pet: () => ipcRenderer.send('pet'),
  chat: payload => ipcRenderer.invoke('chat', payload),
  setKey: k => ipcRenderer.invoke('set-key', k),
});
