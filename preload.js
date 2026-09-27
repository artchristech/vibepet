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
  exitDone: () => ipcRenderer.send('exit-done'),
  chat: payload => ipcRenderer.invoke('chat', payload),
  chatVia: () => ipcRenderer.invoke('chat-via'),
  setKey: k => ipcRenderer.invoke('set-key', k),
  jump: id => ipcRenderer.invoke('jump', id),
});
