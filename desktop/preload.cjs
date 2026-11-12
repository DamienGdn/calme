// Narrow bridge: the web app hands its pairing token to the desktop shell (used for tray counts and notifications).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('calmeDesktop', {
  platform: process.platform,
  /** Admin › Background server (macOS): where the server runs, turn the background service on or off, restart it. */
  serverStatus: () => ipcRenderer.invoke('calme:server:status'),
  setBackground: (on) => ipcRenderer.invoke('calme:server:background', Boolean(on)),
  restartServer: () => ipcRenderer.invoke('calme:server:restart'),
  setToken: (token) => {
    if (typeof token === 'string' && token.length > 0 && token.length < 200) ipcRenderer.send('calme:set-token', token);
  },
});
