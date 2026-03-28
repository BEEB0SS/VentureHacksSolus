const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // Add IPC methods here as needed
})