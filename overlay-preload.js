const { contextBridge, ipcRenderer } = require('electron');

const VOLUME_HUD_UPDATE_CHANNEL = 'volume-hud:update';
const VOLUME_HUD_VISIBILITY_CHANNEL = 'volume-hud:visibility';

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

contextBridge.exposeInMainWorld(
  'volumeHud',
  Object.freeze({
    onUpdate: (listener) => subscribe(VOLUME_HUD_UPDATE_CHANNEL, listener),
    onVisibilityChange: (listener) =>
      subscribe(VOLUME_HUD_VISIBILITY_CHANNEL, listener)
  })
);
