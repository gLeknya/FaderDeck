const { contextBridge, ipcRenderer } = require('electron');
const { buildPreloadApi } = require('./shared/ipc-contract');

function invoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args);
}

function emit(channel, ...args) {
  ipcRenderer.send(channel, ...args);
}

const api = buildPreloadApi({ invoke, send: emit });

const legacyPywebviewBridge = Object.freeze({ api });

contextBridge.exposeInMainWorld('faderDeck', api);
contextBridge.exposeInMainWorld('pywebview', legacyPywebviewBridge);
