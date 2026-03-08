const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopConfig", {
  get: () => ipcRenderer.invoke("desktop-config:get"),
  save: (payload) => ipcRenderer.invoke("desktop-config:save", payload),
  reset: () => ipcRenderer.invoke("desktop-config:reset")
});
