const { contextBridge, ipcRenderer } = require('electron');
const { buildPreloadApi } = require('./shared/ipc-contract');

const APP_FOCUS_STATE_CHANNEL = 'app:focus-state';

function invoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args);
}

function emit(channel, ...args) {
  ipcRenderer.send(channel, ...args);
}

function subscribe(channel, listener) {
  if (typeof listener !== 'function') {
    return () => {};
  }

  const handler = (_event, payload) => {
    listener(payload);
  };

  ipcRenderer.on(channel, handler);

  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const generatedApi = buildPreloadApi({ invoke, send: emit });
const api = Object.freeze({
  ...generatedApi,
  onAppFocusStateChanged: (listener) =>
    subscribe(APP_FOCUS_STATE_CHANNEL, listener)
});

// Legacy bridge name is kept so older renderer/bootstrap code can keep working
// while the current preload API lives under window.faderDeck.
const legacyPywebviewBridge = Object.freeze({ api });

contextBridge.exposeInMainWorld('faderDeck', api);
contextBridge.exposeInMainWorld('pywebview', legacyPywebviewBridge);
