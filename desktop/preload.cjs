// Narrow bridge: the web app hands its pairing token to the desktop shell (used for tray counts and notifications).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('calmeDesktop', {
  platform: process.platform,
  setToken: (token) => {
    if (typeof token === 'string' && token.length > 0 && token.length < 200) ipcRenderer.send('calme:set-token', token);
  },
});
