// recorder window bridge: capture control in, chunks + rendered cards out
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('rec', {
  on: (ch, cb) => ipcRenderer.on(ch, (_, data) => cb(data)),
  started: info => ipcRenderer.send('rec-started', info),
  chunk: (buf, seq) => ipcRenderer.send('rec-chunk', { buf, seq }),
  stopped: info => ipcRenderer.send('rec-stopped', info),
  failed: msg => ipcRenderer.send('rec-failed', msg),
  cards: (id, frames) => ipcRenderer.send('rec-cards', { id, frames }),
});
