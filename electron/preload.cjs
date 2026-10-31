const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("leadjaWhatsapp", {
  show: (bounds, chatUrl = "") => ipcRenderer.invoke("whatsapp:show", { bounds, chatUrl }),
  setBounds: (bounds) => ipcRenderer.invoke("whatsapp:bounds", bounds),
  hide: () => ipcRenderer.invoke("whatsapp:hide"),
  reload: () => ipcRenderer.invoke("whatsapp:reload"),
  onStatus: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("whatsapp:status", listener);
    return () => ipcRenderer.removeListener("whatsapp:status", listener);
  },
});

contextBridge.exposeInMainWorld("leadjaShare", {
  open: (value) => ipcRenderer.invoke("lead:share", value),
});

contextBridge.exposeInMainWorld("leadjaSocial", {
  state: () => ipcRenderer.invoke("social:state"),
  saveConfig: (provider, value) => ipcRenderer.invoke("social:save-config", { provider, value }),
  connect: (provider) => ipcRenderer.invoke("social:connect", provider),
  disconnect: (accountId) => ipcRenderer.invoke("social:disconnect", accountId),
  chooseVideo: () => ipcRenderer.invoke("social:choose-video"),
  chooseCover: () => ipcRenderer.invoke("social:choose-cover"),
  publish: (value) => ipcRenderer.invoke("social:publish", value),
  onUpdate: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("social:updated", listener);
    return () => ipcRenderer.removeListener("social:updated", listener);
  },
});
