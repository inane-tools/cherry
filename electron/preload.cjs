const { contextBridge, ipcRenderer } = require('electron');
const events = new Set([
  'updater-state', 'updater-state', 'window-resized', 'window-focus', 'tray://action',
  'media-key://playpause', 'media-key://play', 'media-key://pause', 'media-key://toggle', 'media-key://next', 'media-key://prev',
  'media-key://stop', 'media-key://seek', 'media-key://seek-by', 'media-key://volume',
]);
contextBridge.exposeInMainWorld('cherryDesktop', {
  invoke: (command, args) => ipcRenderer.invoke('desktop:invoke', command, args),
  subscribe: (event, callback) => {
    if (!events.has(event)) throw new Error('Unknown desktop event');
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on(event, handler);
    return () => ipcRenderer.removeListener(event, handler);
  },
});
